package query

import (
	"fmt"
	"strconv"
	"strings"

	"github.com/inchei/bangumi-query/internal/config"
)

// buildFieldExpr builds a DuckDB expression to read a field value from an alias,
// handling direct fields, infobox extraction, date normalization, and numeric extraction.
func (b *SQLBuilder) buildFieldExpr(field, alias string, isDate, isNumeric bool) string {
	var expr string
	if b.isDirectField(field) {
		expr = alias + "." + quoteIdent(field)
	} else {
		expr = b.infoboxExtractExpr(field, alias)
	}
	switch {
	case isDate:
		expr = b.infoboxFirstDateExpr(field, alias)
	case isNumeric:
		expr = extractNum(expr)
	}
	return expr
}

// splitFieldRef splits a field reference like "连载开始+300" into ("连载开始", "+300").
func splitFieldRef(s string) (field, modifier string) {
	for i := 1; i < len(s); i++ {
		if s[i] == '+' || s[i] == '-' || s[i] == '*' || s[i] == '/' {
			return s[:i], s[i:]
		}
	}
	return s, ""
}

// buildFieldCompare generates a field-to-field comparison condition.
// rhsModifier is an optional arithmetic suffix like "+300" to apply to the RHS expression.
func (b *SQLBuilder) buildFieldCompare(lhsField, rhsField, rhsModifier, op, lhsAlias, rhsAlias string) (string, error) {
	isDate := dateFields[lhsField] && dateFields[rhsField] && (op == "before" || op == "after")
	isNumeric := isNumericOp(op)
	lhs := b.buildFieldExpr(lhsField, lhsAlias, isDate, isNumeric)
	rhs := b.buildFieldExpr(rhsField, rhsAlias, isDate, isNumeric)

	switch op {
	case "eq":
		return fmt.Sprintf("%s = %s", varcharNoCR(lhs), varcharNoCR(rhs)), nil
	case "gt":
		return fmt.Sprintf("%s > %s", lhs, rhs), nil
	case "gte":
		return fmt.Sprintf("%s >= %s", lhs, rhs), nil
	case "lt":
		return fmt.Sprintf("%s < %s", lhs, rhs), nil
	case "lte":
		return fmt.Sprintf("%s <= %s", lhs, rhs), nil
	case "before":
		rm, err := b.applyDateModifier(normalizeDate(rhs), rhsModifier)
		if err != nil {
			return "", err
		}
		return fmt.Sprintf("%s < %s", normalizeDate(lhs), rm), nil
	case "after":
		rm, err := b.applyDateModifier(normalizeDate(rhs), rhsModifier)
		if err != nil {
			return "", err
		}
		return fmt.Sprintf("%s > %s", normalizeDate(lhs), rm), nil
	case "contains":
		return fmt.Sprintf("%s LIKE '%%' || %s || '%%'", varcharNoCR(lhs), varcharNoCR(rhs)), nil
	case "not_contains":
		return fmt.Sprintf("%s NOT LIKE '%%' || %s || '%%' AND TRIM(%s) <> ''", varcharNoCR(lhs), varcharNoCR(rhs), varcharNoCR(lhs)), nil
	case "regex":
		return fmt.Sprintf("regexp_matches(%s, %s)", varcharNoCR(lhs), varcharNoCR(rhs)), nil
	default:
		return "", fmt.Errorf("field compare: unsupported operator %q", op)
	}
}

// applyDateModifier wraps a date expression with an optional arithmetic modifier.
// E.g., for expr=TRY_CAST(date AS DATE) and modifier="+300" → (TRY_CAST(date AS DATE) + 300)
func (b *SQLBuilder) applyDateModifier(expr, modifier string) (string, error) {
	if modifier == "" {
		return expr, nil
	}
	if len(modifier) < 2 || !strings.Contains("+-*/", modifier[:1]) {
		return "", fmt.Errorf("无效的日期偏移: %q", modifier)
	}
	if _, err := strconv.Atoi(modifier[1:]); err != nil {
		return "", fmt.Errorf("无效的日期偏移: %q", modifier)
	}
	return fmt.Sprintf("(%s %s)", expr, modifier), nil
}

func (b *SQLBuilder) fieldFilter(f *config.FieldFilter, tableAlias string) (string, error) {
	// Field-to-field comparison: value starting with "$" references another field
	// "$main." prefix references the main entity (e.g., parent subject's id)
	valueStr := fmt.Sprintf("%v", f.Value)
	if strings.HasPrefix(valueStr, "$") {
		refValue := valueStr[1:]
		refAlias := tableAlias
		if strings.HasPrefix(refValue, "main.") {
			refAlias = b.mainAlias
			refValue = refValue[5:]
		}
		refField, modifier := splitFieldRef(refValue)
		return b.buildFieldCompare(f.Field, refField, modifier, f.Operator, tableAlias, refAlias)
	}

	fieldName := f.Field

	// Map "type" to "person_type" for person target
	if b.target == "person" && fieldName == "type" {
		fieldName = "person_type"
	}
	// Map "id" to actual column name (differs when CTE renames id→person_id etc.)
	if fieldName == "id" {
		fieldName = b.actualColumn("id")
	}

	// Handle career as LIST_CONTAINS for person target
	if b.target == "person" && fieldName == "career" {
		switch f.Operator {
		case "regex":
			return fmt.Sprintf("regexp_matches(%s.career::VARCHAR, '%s')", tableAlias, EscapeLiteral(valueStr)), nil
		case "not_contains":
			return fmt.Sprintf("NOT LIST_CONTAINS(COALESCE(%s.career, []), '%s')", tableAlias, EscapeLiteral(valueStr)), nil
		case "empty":
			return fmt.Sprintf("LEN(COALESCE(%s.career, [])) = 0", tableAlias), nil
		default:
			return fmt.Sprintf("LIST_CONTAINS(COALESCE(%s.career, []), '%s')", tableAlias, EscapeLiteral(valueStr)), nil
		}
	}

	// Special case: rank 0 means no ranking
	if fieldName == "rank" {
		col := tableAlias + "." + quoteIdent(fieldName)
		switch f.Operator {
		case "empty":
			return fmt.Sprintf("(%s = 0 OR %s IS NULL)", col, col), nil
		case "gt", "gte", "lt", "lte":
			cond, _ := b.buildCondition(col, f.Operator, valueStr)
			return fmt.Sprintf("%s != 0 AND %s", col, cond), nil
		}
	}

	// Determine if this is a direct JSON field or infobox field
	if b.isDirectField(fieldName) {
		return b.buildCondition(tableAlias+"."+quoteIdent(fieldName), f.Operator, valueStr)
	}

	// Special case: 性别=其他 means gender exists and is not 男/♀
	if f.Field == "性别" && valueStr == "其他" && f.Operator == "contains" {
		expr := b.infoboxExtractExpr("性别", tableAlias)
		return fmt.Sprintf("COALESCE(%s, '') != '' AND %s NOT LIKE '%%男%%' AND %s NOT LIKE '%%♂%%' AND %s NOT LIKE '%%女%%' AND %s NOT LIKE '%%♀%%'", expr, expr, expr, expr, expr), nil
	}

	// Infobox field — extract with regex, and apply numeric/date extraction for comparison ops
	fieldExpr := b.infoboxExtractExpr(f.Field, tableAlias)
	if dateFields[f.Field] && (f.Operator == "before" || f.Operator == "after") {
		fieldExpr = b.infoboxFirstDateExpr(f.Field, tableAlias)
	}
	if isNumericOp(f.Operator) {
		fieldExpr = extractNum(fieldExpr)
	}
	return b.buildCondition(fieldExpr, f.Operator, valueStr)
}
