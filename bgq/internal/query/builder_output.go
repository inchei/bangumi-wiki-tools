package query

import (
	"strings"
)

// outputCTENeeds records which junction CTEs are required purely by
// association references (e.g. "原作.name" output columns or "导演.生日" sort
// fields), independent of the filters. Prefix resolution mirrors the switch in
// assocOutputColumn.
type outputCTENeeds struct {
	relations          bool // subject_relations
	persons            bool // subject_persons + persons
	characters         bool // subject_characters + characters
	personRelations    bool // person_relations
	characterRelations bool // character_relations
	personCharacters   bool // person_characters
	episodes           bool
}

func (b *SQLBuilder) assocLimit() int {
	if b.cfg.Output != nil && b.cfg.Output.AssocLimit > 0 {
		return b.cfg.Output.AssocLimit
	}
	return 1
}

// addCTENeed classifies a "prefix.field" association reference (from an output
// column or a sort field) and records the junction CTE it requires.
func (b *SQLBuilder) addCTENeed(n *outputCTENeeds, prefix string) {
	switch {
	case prefix == "episode":
		n.episodes = true
	case len(b.getRelationIDsForName(prefix)) > 0:
		n.relations = true
	case b.target == "subject" && len(b.getPositionIDsForName(prefix)) > 0:
		n.persons = true
	case b.target == "subject":
		if _, ok := b.getCharacterAssociationTypeID(prefix); ok {
			n.characters = true
		}
	case b.target == "person" && len(b.getPersonRelationIDsForName(prefix)) > 0:
		n.personRelations = true
	case b.target == "character" && len(b.getCharacterRelationIDsForName(prefix)) > 0:
		n.characterRelations = true
	case (b.target == "person" || b.target == "character") && b.isPersonCharacterTypeName(prefix):
		n.personCharacters = true
	}
}

// assocCTENeeds scans association references in output columns and sort fields
// and reports which junction CTEs they require. Sort fields must be included:
// ordering by "导演.生日" builds the same correlated subquery as an output
// column, so omitting them leaves the referenced CTE undefined in JSON mode.
func (b *SQLBuilder) assocCTENeeds() outputCTENeeds {
	var n outputCTENeeds
	if b.cfg.Output != nil {
		for _, col := range b.cfg.Output.Columns {
			if prefix, _, ok := strings.Cut(col, "."); ok {
				b.addCTENeed(&n, prefix)
			}
		}
	}
	for _, s := range b.cfg.Sort {
		if prefix, _, ok := strings.Cut(s.Field, "."); ok {
			b.addCTENeed(&n, prefix)
		}
	}
	return n
}

func (b *SQLBuilder) buildSelect() []string {
	var cols []string
	if b.cfg.Output != nil {
		cols = b.cfg.Output.Columns
	}
	a := b.mainAlias
	tc := b.tc

	if len(cols) == 0 {
		cols = tc.defaultCols
	}

	var result []string
	for _, col := range cols {
		// Association output column syntax: "类型.字段名" or "类型.s.字段名"
		// or group form "类型.{f1|f2|...}" / "类型.s.{f1|f2|...}" (e.g. CV.s.name).
		if subquery, ok, err := b.assocOutputColumn(col); ok && err == nil {
			result = append(result, subquery)
			continue
		}

		realCol := b.actualColumn(col)
		switch {
		case col == "id" || col == "ID":
			result = append(result, a+"."+quoteIdent(realCol))
		case col == "subject_id" && b.target == "episode":
			result = append(result, a+".subject_id")
		case col == "type" && tc.typeColumn != "type":
			result = append(result, a+"."+quoteIdent(tc.typeColumn)+" AS type")
		case b.isDirectField(realCol):
			result = append(result, a+"."+quoteIdent(realCol))
		case col == "name_cn" && b.target == "person":
			result = append(result, a+".name AS name_cn")
		default:
			expr := b.infoboxExtractExpr(col, a)
			result = append(result, expr+" AS "+quotedLabel(col))
		}
	}
	return result
}

// assocOutputColumn resolves an association output column ("类型.字段" or
// "类型.s.字段" or group "类型.{f1|f2|...}") into its correlated subquery (WITH the "AS label").
// Returns ("", false, nil) when col is not an association column.
func (b *SQLBuilder) assocOutputColumn(col string) (string, bool, error) {
	prefix, rest, found := strings.Cut(col, ".")
	if !found {
		return "", false, nil
	}
	field := rest
	isSubjectLevel := false
	// Brace-aware split: group fields ("{f1|f2|...}") may contain dots in
	// "s.xxx" members, so a leading "{" consumes the whole rest as field.
	// Otherwise a second dot is only valid as the "s." subject-level marker.
	if !strings.HasPrefix(rest, "{") {
		if mid, tail, ok := strings.Cut(rest, "."); ok {
			if mid != "s" {
				return "", false, nil
			}
			isSubjectLevel = true
			field = tail
		}
	}

	var subquery string
	var err error
	switch {
	case prefix == "episode":
		if !isSubjectLevel {
			subquery, err = b.buildEpisodeOutput(field)
		}
	case len(b.getRelationIDsForName(prefix)) > 0:
		if !isSubjectLevel {
			subquery, err = b.buildRelationOutput(prefix, field)
		}
	case b.target == "subject" && len(b.getPositionIDsForName(prefix)) > 0:
		if !isSubjectLevel {
			subquery, err = b.buildStaffOutput(prefix, field)
		}
	case b.target == "subject":
		if !isSubjectLevel {
			if id, ok := b.getCharacterAssociationTypeID(prefix); ok {
				subquery, err = b.buildCharacterOutput(prefix, field, id)
			}
		}
	case b.target == "person" && len(b.getPersonRelationIDsForName(prefix)) > 0:
		if !isSubjectLevel {
			subquery, err = b.buildPersonRelationOutput(prefix, field)
		}
	case b.target == "person" && len(b.getPositionIDsForName(prefix)) > 0:
		if !isSubjectLevel {
			subquery, err = b.buildStaffOutputForPerson(prefix, field)
		}
	case b.target == "character" && len(b.getCharacterRelationIDsForName(prefix)) > 0:
		if !isSubjectLevel {
			subquery, err = b.buildCharacterRelationOutput(prefix, field)
		}
	case b.target == "person" && b.isPersonCharacterTypeName(prefix):
		if isSubjectLevel {
			subquery, err = b.buildPersonCharacterSubjectOutput(prefix, field)
		} else {
			subquery, err = b.buildPersonCharacterOutput(prefix, field)
		}
	case b.target == "character" && b.isPersonCharacterTypeName(prefix):
		if isSubjectLevel {
			subquery, err = b.buildCharacterPersonSubjectOutput(prefix, field)
		} else {
			subquery, err = b.buildCharacterPersonOutput(prefix, field)
		}
	}
	if err != nil {
		return "", false, err
	}
	if subquery == "" {
		return "", false, nil
	}
	return subquery, true, nil
}

// assocOrderExpr returns the association subquery expression (WITHOUT its
// trailing "AS label") for use in ORDER BY, or ("", false, nil) if col is not
// an association column.
func (b *SQLBuilder) assocOrderExpr(col string) (string, bool, error) {
	sql, ok, err := b.assocOutputColumn(col)
	if !ok || err != nil {
		return "", ok, err
	}
	return stripAssocLabel(sql), true, nil
}

// stripAssocLabel removes the trailing ` AS "<label>"` from an association
// subquery. The label is always the last ` AS "..."` because we generate it.
func stripAssocLabel(sql string) string {
	if i := strings.LastIndex(sql, ` AS "`); i >= 0 {
		return sql[:i]
	}
	return sql
}
