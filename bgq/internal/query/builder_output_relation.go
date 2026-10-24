package query

import (
	"fmt"
	"strings"

	"github.com/inchei/bangumi-query/internal/config"
)

// buildRelationOutput generates a subquery for related subject fields (单行本.发售日).
func (b *SQLBuilder) buildRelationOutput(relType, field string) (string, error) {
	relIDs := b.getRelationIDsForName(relType)
	if len(relIDs) == 0 {
		return "", fmt.Errorf("未找到关系类型: %s", relType)
	}
	rf := b.findFilter(filterTypeRelation, relType)
	var conds *config.RelationFilter
	if rf != nil {
		conds = rf.(*config.RelationFilter)
	}

	var relatedWhere string
	relatedJoin := "LEFT JOIN subjects rs ON r.related_subject_id = rs.id"
	if conds != nil && len(conds.Conditions) > 0 {
		var err error
		relatedWhere, err = b.buildWhereForAlias(conds.Conditions, "rs")
		if err != nil {
			return "", fmt.Errorf("relation output: %w", err)
		}
	}
	typeCond := fmt.Sprintf("r.relation_type IN (%s)", intListToSQL(relIDs))
	return b.buildAssocSubquery(assocSubConfig{
		junction: "subject_relations", ja: "r", mainFK: "subject_id",
		entityJoin: relatedJoin, typeCond: typeCond, extraWhere: relatedWhere,
		entityAlias: "rs", entityPK: "id", field: field, label: quotedLabel(relType, field),
		directFields: subjectDirectFields,
	})
}

// buildStaffOutput generates a subquery for staff fields (原作.name).
func (b *SQLBuilder) buildStaffOutput(position, field string) (string, error) {
	posIDs := b.getPositionIDsForName(position)
	if len(posIDs) == 0 {
		return "", fmt.Errorf("未找到职位类型: %s", position)
	}
	sf := b.findFilter(filterTypeStaff, position)
	var personWhere string
	entityJoin := "LEFT JOIN persons p ON sp.person_id = p.person_id"
	if sf != nil {
		s := sf.(*config.StaffFilter)
		if len(s.Conditions) > 0 {
			var err error
			personWhere, err = b.buildPersonWhereForAlias(s.Conditions, "sp")
			if err != nil {
				return "", fmt.Errorf("staff output: %w", err)
			}
		}
	}
	typeCond := fmt.Sprintf("sp.position IN (%s)", intListToSQL(posIDs))
	return b.buildAssocSubquery(assocSubConfig{
		junction: "subject_persons", ja: "sp", mainFK: "subject_id",
		entityJoin: entityJoin, typeCond: typeCond, extraWhere: personWhere,
		entityAlias: "p", entityPK: "person_id", field: field, label: quotedLabel(position, field),
		directFields: personDirectFields,
	})
}

func (b *SQLBuilder) staffIntersectionPositions(prefix string) ([][]int, bool) {
	if !strings.HasPrefix(prefix, "{") || !strings.HasSuffix(prefix, "}") {
		return nil, false
	}
	names := strings.Split(prefix[1:len(prefix)-1], "|")
	if len(names) < 2 {
		return nil, false
	}
	positions := make([][]int, 0, len(names))
	for _, name := range names {
		name = strings.TrimSpace(name)
		ids := b.getPositionIDsForName(name)
		if len(ids) == 0 {
			return nil, false
		}
		positions = append(positions, ids)
	}
	return positions, true
}

func (b *SQLBuilder) buildStaffIntersectionOutput(prefix string, positions [][]int, field string) (string, error) {
	var predicates []string
	for _, ids := range positions[1:] {
		predicates = append(predicates, fmt.Sprintf("EXISTS (SELECT 1 FROM subject_persons sp2 WHERE sp2.subject_id = sp1.subject_id AND sp2.person_id = sp1.person_id AND sp2.position IN (%s))", intListToSQL(ids)))
	}
	junction := fmt.Sprintf("(SELECT DISTINCT sp1.subject_id, sp1.person_id FROM subject_persons sp1 WHERE sp1.position IN (%s) AND %s)", intListToSQL(positions[0]), strings.Join(predicates, " AND "))
	return b.buildAssocSubquery(assocSubConfig{
		junction: junction, ja: "sp", mainFK: "subject_id",
		entityJoin: "LEFT JOIN persons p ON sp.person_id = p.person_id", typeCond: "TRUE",
		entityAlias: "p", entityPK: "person_id", field: field, label: quotedLabel(prefix, field),
		directFields: personDirectFields,
	})
}

// buildStaffOutputForPerson generates a subquery for a person's staff position
// (target: person), outputting a field of the related subject — e.g.
// 系列构成.name returns the first subject where the person holds that position,
// matching the same staff filter conditions. Mirrors staffFilter's target=person
// direction (conditions apply to the related subject alias "rs").
func (b *SQLBuilder) buildStaffOutputForPerson(position, field string) (string, error) {
	posIDs := b.getPositionIDsForName(position)
	if len(posIDs) == 0 {
		return "", fmt.Errorf("未找到职位类型: %s", position)
	}
	sf := b.findFilter(filterTypeStaff, position)
	var subjectWhere string
	entityJoin := "LEFT JOIN subjects rs ON sp.subject_id = rs.id"
	if sf != nil {
		s := sf.(*config.StaffFilter)
		if len(s.Conditions) > 0 {
			var err error
			subjectWhere, err = b.buildWhereForAlias(s.Conditions, "rs")
			if err != nil {
				return "", fmt.Errorf("staff output: %w", err)
			}
		}
	}
	typeCond := fmt.Sprintf("sp.position IN (%s)", intListToSQL(posIDs))
	return b.buildAssocSubquery(assocSubConfig{
		junction: "subject_persons", ja: "sp", mainFK: "person_id",
		entityJoin: entityJoin, typeCond: typeCond, extraWhere: subjectWhere,
		entityAlias: "rs", entityPK: "id", field: field, label: quotedLabel(position, field),
		directFields: subjectDirectFields,
	})
}

// combineWhere joins two optional WHERE fragments with AND, ignoring empty/TRUE.
func combineWhere(a, b string) string {
	a = strings.TrimSpace(a)
	b = strings.TrimSpace(b)
	if a == "" || a == "TRUE" {
		return b
	}
	if b == "" || b == "TRUE" {
		return a
	}
	return a + " AND " + b
}

// buildCharacterOutput generates a subquery for character fields (主角.name).
// When a subject_cast filter with matching type exists, its person/character
// conditions are also applied so that 主角.{name|} reflects the voice-actor
// filter (e.g. 主角声优为神谷浩史).
func (b *SQLBuilder) buildCharacterOutput(charType, field string, typeID int) (string, error) {
	cf := b.findFilter(filterTypeCharacter, charType)
	var charWhere string
	entityJoin := "LEFT JOIN characters c ON sc.character_id = c.character_id"
	if cf != nil {
		c := cf.(*config.CharacterFilter)
		if len(c.Conditions) > 0 {
			var err error
			charWhere, err = b.buildCharacterWhereForAlias(c.Conditions)
			if err != nil {
				return "", fmt.Errorf("character output: %w", err)
			}
		}
	}
	// If a subject_cast filter matches this character type, narrow the output
	// to characters whose voice actor satisfies its person/character conditions.
	if sc := b.findFilter(filterTypeSubjectCast, charType); sc != nil {
		if f, ok := sc.(*config.SubjectCastFilter); ok {
			if len(f.CharacterConditions) > 0 {
				cw, err := b.buildClauses(f.CharacterConditions, clauseContext{alias: "c", isCharacterCtx: true})
				if err != nil {
					return "", fmt.Errorf("subject_cast character output: %w", err)
				}
				charWhere = combineWhere(charWhere, cw)
			}
			if len(f.PersonConditions) > 0 {
				pw, err := b.buildClauses(f.PersonConditions, clauseContext{alias: "p", isPersonCtx: true})
				if err != nil {
					return "", fmt.Errorf("subject_cast person output: %w", err)
				}
				// sc and c are in the outer assoc subquery; correlate via subject+character
				exists := fmt.Sprintf("EXISTS (SELECT 1 FROM person_characters pc2 JOIN persons p ON p.person_id = pc2.person_id WHERE pc2.subject_id = sc.subject_id AND pc2.character_id = c.character_id AND %s)", pw)
				charWhere = combineWhere(charWhere, exists)
			}
		}
	}
	typeCond := fmt.Sprintf("sc.type = %d", typeID)
	return b.buildAssocSubquery(assocSubConfig{
		junction: "subject_characters", ja: "sc", mainFK: "subject_id",
		entityJoin: entityJoin, typeCond: typeCond, extraWhere: charWhere,
		entityAlias: "c", entityPK: "character_id", field: field, label: quotedLabel(charType, field),
		directFields: characterDirectFields,
	})
}

// buildEpisodeOutput generates a subquery for episode fields (episode.name).
func (b *SQLBuilder) buildEpisodeOutput(field string) (string, error) {
	ef := b.findFilter(filterTypeEpisode, "")
	var epWhere string
	if ef != nil {
		e := ef.(*config.EpisodeFilter)
		if e.Logic != nil && len(e.Logic.Items) > 0 {
			var err error
			epWhere, err = b.buildClausesWithOp(e.Logic.Items, clauseContext{alias: "e", isEpisodeCtx: true}, e.Logic.Op)
			if err != nil {
				return "", fmt.Errorf("episode output: %w", err)
			}
		}
	}
	return b.buildAssocSubquery(assocSubConfig{
		junction: "episodes", ja: "e", mainFK: "subject_id",
		entityJoin: "", typeCond: "TRUE", extraWhere: epWhere,
		entityAlias: "e", entityPK: "episode_id", field: field, label: quotedLabel("episode", field),
		directFields: episodeDirectFields,
	})
}

// buildPersonRelationOutput generates a subquery for person relation fields (同事.name).
func (b *SQLBuilder) buildPersonRelationOutput(relType, field string) (string, error) {
	if b.target != "person" {
		return "", fmt.Errorf("person_relation output only supported for person target")
	}
	relIDs := b.getPersonRelationIDsForName(relType)
	if len(relIDs) == 0 {
		return "", fmt.Errorf("未找到人物关系类型: %s", relType)
	}
	pf := b.findFilter(filterTypePersonRelation, relType)
	var relatedWhere string
	entityJoin := "LEFT JOIN persons rp ON pr.related_person_id = rp.person_id"
	if pf != nil {
		p := pf.(*config.PersonRelationFilter)
		if len(p.Conditions) > 0 {
			var err error
			relatedWhere, err = b.buildPersonRelationWhereForAlias(p.Conditions)
			if err != nil {
				return "", fmt.Errorf("person_relation output: %w", err)
			}
		}
	}
	typeCond := fmt.Sprintf("pr.relation_type IN (%s)", intListToSQL(relIDs))
	return b.buildAssocSubquery(assocSubConfig{
		junction: "person_relations", ja: "pr", mainFK: "person_id",
		entityJoin: entityJoin, typeCond: typeCond, extraWhere: relatedWhere,
		entityAlias: "rp", entityPK: "person_id", field: field, label: quotedLabel(relType, field),
		directFields: personDirectFields,
	})
}

// buildCharacterRelationOutput generates a subquery for character relation fields (朋友.name).
func (b *SQLBuilder) buildCharacterRelationOutput(relType, field string) (string, error) {
	if b.target != "character" {
		return "", fmt.Errorf("character_relation output only supported for character target")
	}
	relIDs := b.getCharacterRelationIDsForName(relType)
	if len(relIDs) == 0 {
		return "", fmt.Errorf("未找到角色关系类型: %s", relType)
	}
	cf := b.findFilter(filterTypeCharacterRelation, relType)
	var relatedWhere string
	entityJoin := "LEFT JOIN characters rc ON cr.related_person_id = rc.character_id"
	if cf != nil {
		c := cf.(*config.CharacterRelationFilter)
		if len(c.Conditions) > 0 {
			var err error
			relatedWhere, err = b.buildCharacterRelationWhereForAlias(c.Conditions)
			if err != nil {
				return "", fmt.Errorf("character_relation output: %w", err)
			}
		}
	}
	typeCond := fmt.Sprintf("cr.relation_type IN (%s)", intListToSQL(relIDs))
	return b.buildAssocSubquery(assocSubConfig{
		junction: "character_relations", ja: "cr", mainFK: "person_id",
		entityJoin: entityJoin, typeCond: typeCond, extraWhere: relatedWhere,
		entityAlias: "rc", entityPK: "character_id", field: field, label: quotedLabel(relType, field),
		directFields: characterDirectFields,
	})
}
