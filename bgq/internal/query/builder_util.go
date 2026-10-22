package query

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"

	"github.com/inchei/bangumi-query/internal/model"
)

func (b *SQLBuilder) buildJoins() []string {
	// With CTEs, we don't need explicit JOINs in the main query
	// Relations, persons, and episodes are accessed via subqueries
	return nil
}

var dateFields = map[string]bool{
	"date": true, "airdate": true,
	"生日": true, "放送开始": true, "播放结束": true, "发售日": true,
	"连载开始": true, "连载结束": true, "开始": true, "结束": true,
}

var numericFields = map[string]bool{
	"话数": true, "册数": true, "页数": true, "集数": true, "价格": true,
}

func (b *SQLBuilder) buildOrderBy() string {
	if len(b.cfg.Sort) == 0 {
		return ""
	}

	a := b.mainAlias
	var parts []string
	for _, s := range b.cfg.Sort {
		dir := "ASC"
		if s.Direction == "desc" {
			dir = "DESC"
		}

		// Association output column sort: all associations are aggregated via assocLimit.
		sortField := s.Field
		// count is already aggregated (COUNT(*)), no min/max needed.
		isCount := false
		if idx := strings.LastIndex(sortField, "."); idx >= 0 {
			if sortField[idx+1:] == "count" {
				isCount = true
			}
		}
		if !isCount {
			agg := "min"
			if dir == "DESC" {
				agg = "max"
			}
			candidate := sortField + "~" + agg
			if expr, ok, err := b.assocOrderExpr(candidate); ok && err == nil {
				parts = append(parts, fmt.Sprintf("%s %s", expr, dir))
				continue
			}
		}
		if expr, ok, err := b.assocOrderExpr(sortField); ok && err == nil {
			// Fallback for count or plain field
			// Normalize date/num for single-value fallback
			fieldPart := sortField
			if i := strings.LastIndex(fieldPart, "."); i >= 0 {
				fieldPart = fieldPart[i+1:]
			}
			if dateFields[fieldPart] {
				expr = normalizeDate(expr)
			} else if numericFields[fieldPart] {
				expr = extractNum(expr)
			}
			parts = append(parts, fmt.Sprintf("%s %s", expr, dir))
			continue
		}

		fieldName := b.actualColumn(s.Field)
		var expr string
		if b.isDirectField(fieldName) {
			expr = a + "." + quoteIdent(fieldName)
		} else if dateFields[s.Field] {
			expr = normalizeDate(b.infoboxFirstDateExpr(s.Field, a))
		} else if numericFields[s.Field] {
			expr = extractNum(b.infoboxExtractExpr(s.Field, a))
		} else {
			expr = b.infoboxExtractExpr(s.Field, a)
		}
		if dateFields[s.Field] && b.isDirectField(fieldName) {
			expr = normalizeDate(expr)
		}
		// rank 0 means no ranking → always last regardless of ASC/DESC
		if s.Field == "rank" || fieldName == "rank" {
			parts = append(parts, fmt.Sprintf("CASE WHEN %s IS NULL OR %s = 0 THEN 1 ELSE 0 END", expr, expr))
			parts = append(parts, fmt.Sprintf("%s %s", expr, dir))
		} else {
			parts = append(parts, fmt.Sprintf("%s %s", expr, dir))
		}
	}
	return strings.Join(parts, ", ")
}

// infoboxExtractExpr generates a DuckDB expression to extract a field value from infobox.
func (b *SQLBuilder) infoboxExtractExpr(fieldName, alias string) string {
	// Extract |fieldName: value or |fieldName= value.
	// Handles both simple values and multi-value blocks:
	//   Simple:  |field= value
	//   Multi:   |field={\n[val1]\n[val2]\n}
	// Excludes \r to avoid CRLF line-ending artifacts in comparison operators.
	escapedField := regexEscapeLiteral(fieldName)
	pattern := fmt.Sprintf(`(?i)\|%s\s*[:=]\s*(\{(?:[^}]|\n)*\}|[^|}\n\r]*)`, escapedField)
	return fmt.Sprintf("regexp_extract(%s.infobox, '%s', 1)", alias, EscapeLiteral(pattern))
}

// infoboxFirstDateExpr extracts the first date from an infobox field value.
// Handles multi-value dates like |发售日={ [18禁版|2004-08-14] [全年龄总集篇|2007-12-30] }
// by looking for the first date pattern. Accepts YYYY-M-D, YYYY-MM, YYYY (day/month optional):
//
//	YYYY-MM-DD | YYYY年M月D日 | YYYY-MM | YYYY年M月 | YYYY
//
// normalizeDate handles partial dates by padding to the 1st.
func (b *SQLBuilder) infoboxFirstDateExpr(fieldName, alias string) string {
	raw := b.infoboxExtractExpr(fieldName, alias)
	return fmt.Sprintf("regexp_extract(%s, '(\\d{4}(?:[-年]\\d{1,2}(?:[-月]\\d{1,2})?)?)', 1)", raw)
}

// regexEscapeLiteral escapes a literal string for use inside a regex pattern.
// Only escapes characters that are regex meta-characters.
func regexEscapeLiteral(s string) string {
	// RE2 meta-characters: . * + ? ( ) [ ] { } \ ^ $ |
	var result strings.Builder
	for _, ch := range s {
		switch ch {
		case '.', '*', '+', '?', '(', ')', '[', ']', '{', '}', '\\', '^', '$', '|':
			result.WriteRune('\\')
			result.WriteRune(ch)
		default:
			result.WriteRune(ch)
		}
	}
	return result.String()
}

func EscapeLiteral(s string) string {
	return strings.ReplaceAll(s, "'", "''")
}

// getRelationIDsForName returns all relation type IDs for a given Chinese name.
// A name may map to different IDs across different subject types.
func (b *SQLBuilder) getRelationIDsForName(name string) []int {
	seen := make(map[int]bool)
	var ids []int
	for _, relMap := range model.RelationTypes {
		for id, cnName := range relMap {
			if cnName == name && !seen[id] {
				ids = append(ids, id)
				seen[id] = true
			}
		}
	}
	return ids
}

// getPositionIDsForName returns all position IDs for a given Chinese name.
func (b *SQLBuilder) getPositionIDsForName(name string) []int {
	seen := make(map[int]bool)
	var ids []int
	for _, posMap := range model.StaffPositions {
		for id, cnName := range posMap {
			if cnName == name && !seen[id] {
				ids = append(ids, id)
				seen[id] = true
			}
		}
	}
	return ids
}

// actualColumn returns the real column name for a conceptual field name,
// mapping id to the target's idColumn (person_id/character_id/episode_id).
func (b *SQLBuilder) actualColumn(field string) string {
	if field != "id" || b.tc.idColumn == "id" {
		return field
	}
	return b.tc.idColumn
}

// isDirectField returns true if the field is a direct JSON column (not infobox).
// Uses the target config's directFields map when available, falls back to checking all fields.
func (b *SQLBuilder) isDirectField(field string) bool {
	if b.tc != nil {
		return b.tc.directFields[field]
	}
	// Fallback for when tc is not set (should not happen in practice)
	return subjectDirectFields[field] || personDirectFields[field] ||
		characterDirectFields[field] || episodeDirectFields[field]
}

func quoteIdent(s string) string {
	// Always quote identifiers and escape embedded double quotes.
	// DuckDB uses double quotes for identifiers; quoting prevents
	// injection via user-controlled column/sort names (e.g. `a"b`).
	return `"` + strings.ReplaceAll(s, `"`, `""`) + `"`
}

func quotedLabel(parts ...string) string {
	return quoteIdent(strings.Join(parts, "."))
}

// toSQLOp converts a config operator (gt, gte, lt, lte, eq) to a SQL operator.
func toSQLOp(op string) string {
	switch op {
	case "gt":
		return ">"
	case "gte":
		return ">="
	case "lt":
		return "<"
	case "lte":
		return "<="
	case "eq":
		return "="
	default:
		return ">="
	}
}

func intListToSQL(ids []int) string {
	strs := make([]string, len(ids))
	for i, id := range ids {
		strs[i] = strconv.Itoa(id)
	}
	return strings.Join(strs, ", ")
}

func escapeLike(s string) string {
	s = EscapeLiteral(s)
	s = strings.ReplaceAll(s, "\\", "\\\\")
	s = strings.ReplaceAll(s, "%", "\\%")
	s = strings.ReplaceAll(s, "_", "\\_")
	return s
}

func varcharNoCR(expr string) string {
	return fmt.Sprintf("replace(CAST(%s AS VARCHAR), chr(13), '')", expr)
}

// numericLiteralRe matches plain decimal/float literals (optional sign, decimal
// point, and exponent). Deliberately rejects hex floats, Inf, and NaN so that
// values interpolated into SQL are always safe numeric literals.
var numericLiteralRe = regexp.MustCompile(`^[+-]?(\d+(\.\d+)?|\.\d+)([eE][+-]?\d+)?$`)

// safeNum validates a value as a plain numeric literal for safe SQL
// interpolation, preventing injection via numeric comparison operators.
// Empty input maps to "0"; anything non-numeric is rejected with an error.
func safeNum(v string) (string, error) {
	v = strings.TrimSpace(v)
	if v == "" {
		return "0", nil
	}
	if !numericLiteralRe.MatchString(v) {
		return "", fmt.Errorf("无效的数字: %q", v)
	}
	return v, nil
}
