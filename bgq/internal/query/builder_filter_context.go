package query

import (
	"fmt"
	"strconv"
	"strings"

	"github.com/inchei/bangumi-query/internal/config"
	"github.com/inchei/bangumi-query/internal/model"
)

// buildWhereForAlias generates WHERE clauses for a given table alias, supporting all filter types.
// Used for nested filtering on related subjects (rs), persons (sp), or episodes (e).
func (b *SQLBuilder) buildWhereForAlias(filters []config.Filter, alias string) (string, error) {
	return b.buildClauses(filters, clauseContext{alias: alias})
}

// filterForAlias generates SQL for a single filter on a given alias.
func (b *SQLBuilder) filterForAlias(f config.Filter, alias string, idx int) (string, error) {
	switch {
	case f.Type != nil:
		return b.typeFilterForAlias(f.Type, alias)
	case f.Field != nil:
		return b.fieldFilterForAlias(f.Field, alias)
	case f.Tag != nil:
		return b.tagFilterForAlias(f.Tag, alias)
	case f.MetaTag != nil:
		return b.metaTagFilterForAlias(f.MetaTag, alias)
	default:
		return "", fmt.Errorf("unsupported nested filter type at index %d", idx)
	}
}

func (b *SQLBuilder) typeFilterForAlias(f *config.TypeFilter, alias string) (string, error) {
	switch v := f.Value.(type) {
	case int:
		return fmt.Sprintf("%s.type = %d", alias, v), nil
	case float64:
		return fmt.Sprintf("%s.type = %d", alias, int(v)), nil
	case string:
		if num, err := strconv.Atoi(v); err == nil {
			return fmt.Sprintf("%s.type = %d", alias, num), nil
		}
		typeNum, ok := model.TypeCNToNum[v]
		if !ok {
			return "", fmt.Errorf("未知的条目类型: %s", v)
		}
		return fmt.Sprintf("%s.type = %d", alias, typeNum), nil
	default:
		return "", fmt.Errorf("type filter value must be int or string, got %T", v)
	}
}

func (b *SQLBuilder) fieldFilterForAlias(f *config.FieldFilter, alias string) (string, error) {
	valueStr := fmt.Sprintf("%v", f.Value)
	if strings.HasPrefix(valueStr, "$") {
		refValue := valueStr[1:]
		refAlias := alias
		if strings.HasPrefix(refValue, "main.") {
			refAlias = b.mainAlias
			refValue = refValue[5:]
		}
		refField, modifier := splitFieldRef(refValue)
		return b.buildFieldCompare(f.Field, refField, modifier, f.Operator, alias, refAlias)
	}
	// Special case: rank 0 means no ranking
	if f.Field == "rank" {
		col := alias + "." + quoteIdent("rank")
		switch f.Operator {
		case "empty":
			return fmt.Sprintf("(%s = 0 OR %s IS NULL)", col, col), nil
		case "gt", "gte", "lt", "lte":
			cond, _ := b.buildCondition(col, f.Operator, valueStr)
			return fmt.Sprintf("%s != 0 AND %s", col, cond), nil
		}
	}
	if b.isDirectField(f.Field) {
		return b.buildCondition(alias+"."+quoteIdent(f.Field), f.Operator, valueStr)
	}
	fieldExpr := b.infoboxExtractExpr(f.Field, alias)
	if isNumericOp(f.Operator) {
		fieldExpr = extractNum(fieldExpr)
	}
	return b.buildCondition(fieldExpr, f.Operator, valueStr)
}

func (b *SQLBuilder) tagFilterForAlias(f *config.TagFilter, alias string) (string, error) {
	cond := fmt.Sprintf("EXISTS (SELECT 1 FROM (SELECT UNNEST(%s.tags) AS t) WHERE t.name = '%s')",
		alias, EscapeLiteral(f.Value))
	if f.Negate {
		return "NOT " + cond, nil
	}
	return cond, nil
}

func (b *SQLBuilder) metaTagFilterForAlias(f *config.TagFilter, alias string) (string, error) {
	cond := fmt.Sprintf("LIST_CONTAINS(COALESCE(%s.meta_tags, []), '%s')", alias, EscapeLiteral(f.Value))
	if f.Negate {
		return "NOT " + cond, nil
	}
	return cond, nil
}

// buildPersonWhereForAlias generates WHERE clauses for person-level nested conditions.
func (b *SQLBuilder) buildPersonWhereForAlias(filters []config.Filter, junctionAlias string) (string, error) {
	return b.buildClauses(filters, clauseContext{alias: "p", isPersonCtx: true, junctionAlias: junctionAlias})
}

// personFilterForAlias dispatches a single filter for person-level conditions.
// filterForNestedContext dispatches a single filter for nested entity conditions (person/character).
func (b *SQLBuilder) filterForNestedContext(f config.Filter, idx int, nestedAlias string, fieldMap map[string]string, typeCol string, junctionAlias string) (string, error) {
	switch {
	case f.Field != nil:
		return b.fieldFilterForNested(f.Field, nestedAlias, fieldMap, junctionAlias)
	case f.Type != nil:
		if typeCol == "" {
			return "", fmt.Errorf("此上下文不支持类型筛选 (index %d)", idx)
		}
		return fmt.Sprintf("%s = '%s'", typeCol, EscapeLiteral(fmt.Sprintf("%v", f.Type.Value))), nil
	default:
		return "", fmt.Errorf("此上下文不支持此条件类型 (index %d)", idx)
	}
}

// fieldFilterForNested builds a field filter for a nested entity context using a field map.
func (b *SQLBuilder) fieldFilterForNested(f *config.FieldFilter, nestedAlias string, fieldMap map[string]string, junctionAlias string) (string, error) {
	valueStr := fmt.Sprintf("%v", f.Value)
	if strings.HasPrefix(valueStr, "$") {
		refValue := valueStr[1:]
		refAlias := nestedAlias
		if strings.HasPrefix(refValue, "main.") {
			refAlias = b.mainAlias
			refValue = refValue[5:]
		}
		refField, modifier := splitFieldRef(refValue)
		return b.buildFieldCompare(f.Field, refField, modifier, f.Operator, nestedAlias, refAlias)
	}

	// Special case: appear_eps in staff person context references junction table
	if f.Field == "appear_eps" && junctionAlias != "" {
		return b.buildCondition(junctionAlias+".appear_eps", f.Operator, valueStr)
	}

	// Check field map for direct column mapping
	if col, ok := fieldMap[f.Field]; ok {
		expr := nestedAlias + "." + col
		// Special case: rank 0 means no ranking
		if f.Field == "rank" {
			switch f.Operator {
			case "empty":
				return fmt.Sprintf("(%s = 0 OR %s IS NULL)", expr, expr), nil
			case "gt", "gte", "lt", "lte":
				cond, _ := b.buildCondition(expr, f.Operator, valueStr)
				return fmt.Sprintf("%s != 0 AND %s", expr, cond), nil
			}
		}
		return b.buildCondition(expr, f.Operator, valueStr)
	}

	// Special case: rank on infobox fields (not in fieldMap)
	if f.Field == "rank" {
		col := nestedAlias + "." + quoteIdent("rank")
		switch f.Operator {
		case "empty":
			return fmt.Sprintf("(%s = 0 OR %s IS NULL)", col, col), nil
		case "gt", "gte", "lt", "lte":
			cond, _ := b.buildCondition(col, f.Operator, valueStr)
			return fmt.Sprintf("%s != 0 AND %s", col, cond), nil
		}
	}

	// Special case: career field (person only) — LIST_CONTAINS
	if f.Field == "career" {
		if f.Operator == "regex" {
			return fmt.Sprintf("regexp_matches(%s.career::VARCHAR, '%s')", nestedAlias, EscapeLiteral(valueStr)), nil
		}
		return fmt.Sprintf("LIST_CONTAINS(COALESCE(%s.career, []), '%s')", nestedAlias, EscapeLiteral(valueStr)), nil
	}

	// Special case: 性别=其他
	if f.Field == "性别" && valueStr == "其他" && f.Operator == "contains" {
		expr := b.infoboxExtractExpr("性别", nestedAlias)
		return fmt.Sprintf("COALESCE(%s, '') != '' AND %s NOT LIKE '%%男%%' AND %s NOT LIKE '%%♂%%' AND %s NOT LIKE '%%女%%' AND %s NOT LIKE '%%♀%%'", expr, expr, expr, expr, expr), nil
	}

	// Default: infobox field extraction
	fieldExpr := b.infoboxExtractExpr(f.Field, nestedAlias)
	if dateFields[f.Field] && (f.Operator == "before" || f.Operator == "after") {
		fieldExpr = b.infoboxFirstDateExpr(f.Field, nestedAlias)
	}
	if isNumericOp(f.Operator) {
		fieldExpr = extractNum(fieldExpr)
	}
	return b.buildCondition(fieldExpr, f.Operator, valueStr)
}

// personEntityFieldMap maps person field names to direct columns on the persons
// table. The column is resolved against the actual nested alias (p for the main
// person, rp for a person_relation's related person).
var personEntityFieldMap = map[string]string{
	"person_id": "person_id",
	"id":        "person_id",
	"name":      "name",
	"type":      "person_type",
	"career":    "career",
	"infobox":   "infobox",
	"summary":   "summary",
	"collects":  "collects",
	"comments":  "comments",
}

// characterEntityFieldMap maps character field names to direct columns on the
// characters table. The column is resolved against the actual nested alias
// (c for the main character, rc for a character_relation's related character).
var characterEntityFieldMap = map[string]string{
	"character_id": "character_id",
	"id":           "character_id",
	"name":         "name",
	"role":         "role",
	"infobox":      "infobox",
	"summary":      "summary",
	"comments":     "comments",
	"collects":     "collects",
}

// personFilterForAlias dispatches a single filter for person-level conditions.
func (b *SQLBuilder) personFilterForAlias(f config.Filter, idx int, alias string, junctionAlias string) (string, error) {
	return b.filterForNestedContext(f, idx, alias, personEntityFieldMap, alias+".person_type", junctionAlias)
}

// characterFilterForAlias dispatches a single filter for character-level conditions.
func (b *SQLBuilder) characterFilterForAlias(f config.Filter, idx int, alias string) (string, error) {
	return b.filterForNestedContext(f, idx, alias, characterEntityFieldMap, "", "")
}
