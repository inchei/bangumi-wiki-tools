package query

import (
	"fmt"
	"strings"

	"github.com/inchei/bangumi-query/internal/config"
)

func (b *SQLBuilder) staffFilter(f *config.StaffFilter) (string, error) {
	if f.HasMultiPositionAppearEps() {
		return "", fmt.Errorf("多职位 staff 条件不支持 appear_eps（该字段属于单个职位）")
	}
	nested := getNestedConfig(b.target, "staff")
	if nested == nil {
		return "", fmt.Errorf("staff filter not supported for target %s", b.target)
	}

	// Collect positions: Positions overrides single Position
	positions := f.Positions
	if len(positions) == 0 && f.Position != "" {
		positions = []string{f.Position}
	}

	if len(positions) == 0 {
		positions = []string{""} // wildcard — any position
	}

	// Resolve position names to ID sets
	posIDSets := make([][]int, len(positions))
	for i, name := range positions {
		if name == "" || name == "任意" {
			posIDSets[i] = nil // nil means wildcard
		} else {
			ids := b.getPositionIDsForName(name)
			if len(ids) == 0 {
				return "", fmt.Errorf("未找到职位类型: %s", name)
			}
			posIDSets[i] = ids
		}
	}

	// Build person conditions
	var personWhere string
	if b.target == "subject" && len(f.Conditions) > 0 {
		var err error
		personWhere, err = b.buildPersonWhereForAlias(f.Conditions, nested.junctionTable)
		if err != nil {
			return "", fmt.Errorf("staff condition: %w", err)
		}
	}

	// Multi-position: self-join to check same person across position groups
	if len(positions) > 1 {
		return b.multiStaffFilter(nested, posIDSets, personWhere, f)
	}

	// Single position: use existing manyToMany logic
	ja := nested.junctionTable
	posCond := "TRUE"
	if posIDSets[0] != nil {
		posCond = fmt.Sprintf("%s.position IN (%s)", ja, intListToSQL(posIDSets[0]))
	}

	var relatedWhere string
	var relatedJoin string
	if b.target == "person" {
		if len(f.Conditions) > 0 {
			var err error
			relatedWhere, err = b.buildWhereForAlias(f.Conditions, "rs")
			if err != nil {
				return "", fmt.Errorf("staff condition: %w", err)
			}
		}
		relatedJoin = fmt.Sprintf("LEFT JOIN %s %s ON %s.%s = %s.%s",
			nested.relatedTable, nested.relatedAlias, ja, nested.relatedFK, nested.relatedAlias, nested.relatedPK)
	} else {
		if len(f.Conditions) > 0 {
			var err error
			relatedWhere, err = b.buildPersonWhereForAlias(f.Conditions, ja)
			if err != nil {
				return "", fmt.Errorf("staff condition: %w", err)
			}
			relatedJoin = fmt.Sprintf("LEFT JOIN %s %s ON %s.%s = %s.%s",
				nested.relatedTable, nested.relatedAlias, ja, nested.relatedFK, nested.relatedAlias, nested.relatedPK)
		}
	}

	return b.manyToManyFilter(manyToManyConfig{
		junction:       nested.junctionTable,
		mainAlias:      b.mainAlias,
		mainPK:         nested.mainPK,
		junctionMainFK: nested.junctionMainFK,
		relatedAlias:   nested.relatedAlias,
		relatedTable:   nested.relatedTable,
		relatedFK:      nested.relatedFK,
		extraCond:      posCond,
		relatedWhere:   relatedWhere,
		relatedJoin:    relatedJoin,
		mode:           f.Mode,
		countOp:        f.CountOp,
		countVal:       f.CountVal,
		countDistinct:  posIDSets[0] == nil,
	})
}

func (b *SQLBuilder) multiStaffFilter(nested *nestedEntityConfig, posIDSets [][]int, personWhere string, f *config.StaffFilter) (string, error) {
	jt := nested.junctionTable
	ma := b.mainAlias
	mp := nested.mainPK
	jmf := nested.junctionMainFK

	// Build self-join chain: sp1 ↔ sp2 ↔ sp3 ... all sharing same person_id
	var joins []string
	var conds []string
	for i := range posIDSets {
		alias := fmt.Sprintf("sp%d", i+1)
		if i == 0 {
			cond := "TRUE"
			if posIDSets[i] != nil {
				cond = fmt.Sprintf("%s.position IN (%s)", alias, intListToSQL(posIDSets[i]))
			}
			conds = append(conds, fmt.Sprintf("%s.%s = %s.%s AND %s", alias, jmf, ma, mp, cond))
		} else {
			joins = append(joins, fmt.Sprintf("JOIN %s %s ON %s.%s = sp1.%s AND %s.%s = sp1.%s",
				jt, alias, alias, jmf, jmf, alias, nested.relatedFK, nested.relatedFK))
			cond := "TRUE"
			if posIDSets[i] != nil {
				cond = fmt.Sprintf("%s.position IN (%s)", alias, intListToSQL(posIDSets[i]))
			}
			conds = append(conds, cond)
		}
	}

	baseConds := strings.Join(conds, " AND ")
	joinsBase := append([]string(nil), joins...)
	allConds := baseConds
	joinsAll := joinsBase
	if personWhere != "" && personWhere != "TRUE" {
		allConds += " AND " + personWhere
		joinsAll = append(append([]string(nil), joinsBase...), fmt.Sprintf("LEFT JOIN %s %s ON sp1.%s = %s.%s",
			nested.relatedTable, nested.relatedAlias, nested.relatedFK, nested.relatedAlias, nested.relatedPK))
	}

	// count / all semantics: works (or persons) where the same entity holds all
	// the listed positions at once, counted / compared with DISTINCT dedup.
	if f.Mode == "count" {
		countExpr := fmt.Sprintf("(SELECT COUNT(DISTINCT sp1.%s) FROM %s sp1 %s WHERE %s)",
			nested.relatedFK, jt, strings.Join(joinsAll, " "), allConds)
		return b.buildCondition(countExpr, f.CountOp, fmt.Sprintf("%v", f.CountVal))
	}
	if f.Mode == "all" {
		existsClause := fmt.Sprintf("EXISTS (SELECT 1 FROM %s sp1 %s WHERE %s)",
			jt, strings.Join(joinsBase, " "), baseConds)
		matchCount := fmt.Sprintf("(SELECT COUNT(DISTINCT sp1.%s) FROM %s sp1 %s WHERE %s)",
			nested.relatedFK, jt, strings.Join(joinsAll, " "), allConds)
		totalCount := fmt.Sprintf("(SELECT COUNT(DISTINCT sp1.%s) FROM %s sp1 %s WHERE %s)",
			nested.relatedFK, jt, strings.Join(joinsBase, " "), baseConds)
		return fmt.Sprintf("%s AND\n %s =\n %s", existsClause, matchCount, totalCount), nil
	}

	// none mode
	if f.Mode == "none" {
		return fmt.Sprintf("NOT EXISTS (SELECT 1 FROM %s sp1 %s WHERE %s)",
			jt, strings.Join(joinsAll, " "), allConds), nil
	}

	// any mode
	return fmt.Sprintf("EXISTS (SELECT 1 FROM %s sp1 %s WHERE %s)",
		jt, strings.Join(joinsAll, " "), allConds), nil
}
