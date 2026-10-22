package query

import (
	"fmt"
	"strconv"

	"github.com/inchei/bangumi-query/internal/config"
	"github.com/inchei/bangumi-query/internal/model"
)

func (b *SQLBuilder) typeFilter(f *config.TypeFilter) (string, error) {
	col := b.mainAlias + "." + b.tc.typeColumn
	switch v := f.Value.(type) {
	case int:
		return fmt.Sprintf("%s = %d", col, v), nil
	case float64:
		return fmt.Sprintf("%s = %d", col, int(v)), nil
	case string:
		if num, err := strconv.Atoi(v); err == nil {
			return fmt.Sprintf("%s = %d", col, num), nil
		}
		typeNum, ok := model.TypeCNToNum[v]
		if !ok {
			return "", fmt.Errorf("未知的条目类型: %s", v)
		}
		return fmt.Sprintf("%s = %d", col, typeNum), nil
	default:
		return "", fmt.Errorf("type filter value must be int or string, got %T", v)
	}
}

func (b *SQLBuilder) tagFilter(f *config.TagFilter) (string, error) {
	switch f.Operator {
	case "contains", "eq":
		cond := fmt.Sprintf("EXISTS (SELECT 1 FROM (SELECT UNNEST(%s.tags) AS t) WHERE t.name = '%s')",
			b.mainAlias, EscapeLiteral(f.Value))
		if f.Negate {
			return "NOT " + cond, nil
		}
		return cond, nil
	default:
		return "", fmt.Errorf("tag filter: unsupported operator %q", f.Operator)
	}
}

// metaTagFilter handles meta tag filtering.
// meta_tags is a simple string array (unlike tags which is array of {name, count} objects).
// Some entries have meta_tags as null, so we COALESCE to empty list.
func (b *SQLBuilder) metaTagFilter(f *config.TagFilter) (string, error) {
	switch f.Operator {
	case "contains", "eq":
		// DuckDB: LIST_CONTAINS for simple arrays
		// COALESCE to handle NULL meta_tags (some entries don't have meta tags)
		cond := fmt.Sprintf("LIST_CONTAINS(COALESCE(%s.meta_tags, []), '%s')", b.mainAlias, EscapeLiteral(f.Value))
		if f.Negate {
			return "NOT " + cond, nil
		}
		return cond, nil
	default:
		return "", fmt.Errorf("meta_tag filter: unsupported operator %q", f.Operator)
	}
}

// buildCondition generates a SQL comparison expression.
func (b *SQLBuilder) buildCondition(expr, op, value string) (string, error) {
	switch op {
	case "eq":
		return fmt.Sprintf("CAST(%s AS VARCHAR) = '%s'", expr, EscapeLiteral(value)), nil
	case "contains":
		return fmt.Sprintf("CAST(%s AS VARCHAR) LIKE '%%%s%%' ESCAPE '\\'", expr, escapeLike(value)), nil
	case "not_contains":
		return fmt.Sprintf("CAST(%s AS VARCHAR) NOT LIKE '%%%s%%' ESCAPE '\\' AND TRIM(CAST(%s AS VARCHAR)) <> ''", expr, escapeLike(value), expr), nil
	case "regex":
		// CAST is required: regexp_matches has no overload for non-VARCHAR
		// first arguments (e.g. DOUBLE columns like s.score).
		return fmt.Sprintf("regexp_matches(CAST(%s AS VARCHAR), '%s')", expr, EscapeLiteral(value)), nil
	case "not_regex":
		return fmt.Sprintf("NOT regexp_matches(CAST(%s AS VARCHAR), '%s') AND TRIM(CAST(%s AS VARCHAR)) <> ''", expr, EscapeLiteral(value), expr), nil
	case "empty":
		return fmt.Sprintf("COALESCE(CAST(%s AS VARCHAR), '') = ''", expr), nil
	case "gt":
		num, err := safeNum(value)
		if err != nil {
			return "", err
		}
		return fmt.Sprintf("CAST(%s AS DOUBLE) > %s", expr, num), nil
	case "gte":
		num, err := safeNum(value)
		if err != nil {
			return "", err
		}
		return fmt.Sprintf("CAST(%s AS DOUBLE) >= %s", expr, num), nil
	case "lt":
		num, err := safeNum(value)
		if err != nil {
			return "", err
		}
		return fmt.Sprintf("CAST(%s AS DOUBLE) < %s", expr, num), nil
	case "lte":
		num, err := safeNum(value)
		if err != nil {
			return "", err
		}
		return fmt.Sprintf("CAST(%s AS DOUBLE) <= %s", expr, num), nil
	case "before":
		return fmt.Sprintf("%s < CAST('%s' AS DATE)", normalizeDate(expr), EscapeLiteral(value)), nil
	case "after":
		return fmt.Sprintf("%s > CAST('%s' AS DATE)", normalizeDate(expr), EscapeLiteral(value)), nil
	default:
		return "", fmt.Errorf("unknown operator: %q (supported: eq, contains, regex, gt, gte, lt, lte, before, after)", op)
	}
}

// isNumericOp returns true if the operator performs numeric comparison.
func isNumericOp(op string) bool {
	switch op {
	case "gt", "gte", "lt", "lte":
		return true
	}
	return false
}

// extractNum wraps an expression to safely extract a numeric value from a string.
// Handles values like "NT$160", "1,200円", "JPY 3,980", "17.00." → 160, 1200, 3980, 17.0.
// Uses TRY_CAST to silently return NULL for unparseable values instead of throwing errors.
func extractNum(expr string) string {
	return fmt.Sprintf(
		"TRY_CAST(NULLIF(REPLACE(regexp_extract(%s, '(\\d[\\d,]*(?:\\.\\d+)?)', 1), ',', ''), '') AS DOUBLE)",
		expr,
	)
}

// normalizeDate wraps an expression to safely parse various date formats.
// Handles: "2007-12-15", "2007-12", "2007年12月15日", "2007年12月", "2007年"
// All partial dates default to the 1st. Invalid dates return NULL via TRY_CAST.
func normalizeDate(expr string) string {
	// Replace Chinese date markers and trim; TRY_CAST handles trailing control chars
	normalized := fmt.Sprintf(
		"replace(replace(replace(TRIM(%s), '年', '-'), '月', '-'), '日', '')",
		expr,
	)
	padded := fmt.Sprintf(
		"CASE "+
			"WHEN regexp_matches(%[1]s, '^\\d{4}$') THEN %[1]s || '-01-01' "+
			"WHEN regexp_matches(%[1]s, '^\\d{4}-\\d{1,2}$') THEN %[1]s || '-01' "+
			"ELSE %[1]s END",
		normalized,
	)
	return fmt.Sprintf("TRY_CAST(%s AS DATE)", padded)
}
