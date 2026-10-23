package query

import (
	"fmt"

	"github.com/inchei/bangumi-query/internal/config"
)

func (b *SQLBuilder) episodeFilter(f *config.EpisodeFilter) (string, error) {
	episodeWhere := "TRUE"
	if f.Logic != nil {
		var err error
		episodeWhere, err = b.buildClausesWithOp(f.Logic.Items, clauseContext{alias: "e", isEpisodeCtx: true}, f.Logic.Op)
		if err != nil {
			return "", fmt.Errorf("episode logic: %w", err)
		}
	}
	if f.Mode == "none" {
		return fmt.Sprintf(
			`NOT EXISTS (SELECT 1 FROM episodes e WHERE e.subject_id = s.id AND %s)`,
			episodeWhere), nil
	}
	if f.Mode == "all" {
		return fmt.Sprintf(
			`EXISTS (SELECT 1 FROM episodes e WHERE e.subject_id = s.id) AND
			 (SELECT COUNT(*) FROM episodes e WHERE e.subject_id = s.id AND %s) =
			 (SELECT COUNT(*) FROM episodes e WHERE e.subject_id = s.id)`,
			episodeWhere), nil
	}
	if f.Mode == "count" {
		countExpr := fmt.Sprintf(
			"(SELECT COUNT(*) FROM episodes e WHERE e.subject_id = s.id AND %s)",
			episodeWhere)
		return b.buildCondition(countExpr, f.CountOp, fmt.Sprintf("%v", f.CountVal))
	}
	return fmt.Sprintf(
		"EXISTS (SELECT 1 FROM episodes e WHERE e.subject_id = s.id AND %s)",
		episodeWhere), nil
}

// episodeFieldFilter builds a field filter on episode data.
func (b *SQLBuilder) episodeFieldFilter(f *config.FieldFilter) (string, error) {
	valueStr := fmt.Sprintf("%v", f.Value)
	switch f.Field {
	case "id", "episode_id":
		return b.buildCondition("e.episode_id", f.Operator, valueStr)
	case "name", "name_cn", "description", "airdate", "duration", "sort", "disc", "subject_id":
		return b.buildCondition("e."+quoteIdent(f.Field), f.Operator, valueStr)
	case "type":
		// Map Chinese episode type names to numbers
		epTypes := map[string]int{
			"本篇": 0, "特别篇": 1, "SP": 1, "sp": 1,
			"OP": 2, "op": 2, "ED": 3, "ed": 3,
			"CM": 4, "cm": 4, "MAD": 5, "mad": 5, "其他": 6,
		}
		if typeNum, ok := epTypes[valueStr]; ok {
			return b.buildCondition("e.type", f.Operator, fmt.Sprintf("%d", typeNum))
		}
		return b.buildCondition("e.type", f.Operator, valueStr)
	default:
		return "", fmt.Errorf("unknown episode field: %s", f.Field)
	}
}
