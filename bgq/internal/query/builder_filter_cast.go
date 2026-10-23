package query

import (
	"fmt"

	"github.com/inchei/bangumi-query/internal/config"
	"github.com/inchei/bangumi-query/internal/model"
)

func (b *SQLBuilder) characterFilter(f *config.CharacterFilter) (string, error) {
	nested := getNestedConfig(b.target, "character")
	if nested == nil {
		return "", fmt.Errorf("character filter not supported for target %s", b.target)
	}
	ja := nested.junctionTable // junction alias (use full table name)

	// Resolve association type name to ID; empty or "任意" means any type
	anyType := f.Type == "" || f.Type == "任意"
	var typeCond string
	if anyType {
		typeCond = "TRUE"
	} else {
		typeID, found := b.getCharacterAssociationTypeID(f.Type)
		if !found {
			return "", fmt.Errorf("未找到角色关联类型: %s", f.Type)
		}
		typeCond = fmt.Sprintf("%s.type = %d", ja, typeID)
	}

	// Build related entity conditions
	var relatedWhere string
	var relatedJoin string
	if b.target == "character" {
		// Character target: conditions on associated subjects
		if len(f.Conditions) > 0 {
			var err error
			relatedWhere, err = b.buildWhereForAlias(f.Conditions, "rs")
			if err != nil {
				return "", fmt.Errorf("character condition: %w", err)
			}
		}
		relatedJoin = fmt.Sprintf("LEFT JOIN %s %s ON %s.%s = %s.%s",
			nested.relatedTable, nested.relatedAlias, ja, nested.relatedFK, nested.relatedAlias, nested.relatedPK)
	} else {
		// Subject target: conditions on associated characters
		if len(f.Conditions) > 0 {
			var err error
			relatedWhere, err = b.buildCharacterWhereForAlias(f.Conditions)
			if err != nil {
				return "", fmt.Errorf("character condition: %w", err)
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
		extraCond:      typeCond,
		relatedWhere:   relatedWhere,
		relatedJoin:    relatedJoin,
		mode:           f.Mode,
		countOp:        f.CountOp,
		countVal:       f.CountVal,
	})
}

// getCharacterAssociationTypeID returns the ID for a Chinese association type name.
func (b *SQLBuilder) getCharacterAssociationTypeID(name string) (int, bool) {
	for id, cnName := range model.CharacterAssociationTypes {
		if cnName == name {
			return id, true
		}
	}
	return 0, false
}

// buildCharacterWhereForAlias generates WHERE clauses for character-level nested conditions.
func (b *SQLBuilder) buildCharacterWhereForAlias(filters []config.Filter) (string, error) {
	return b.buildClauses(filters, clauseContext{alias: "c", isCharacterCtx: true})
}

// personCharacterFilter filters persons by their associated characters (via person_characters).
func (b *SQLBuilder) personCharacterFilter(f *config.PersonCharacterFilter) (string, error) {
	if b.target != "person" {
		return "", fmt.Errorf("person_character filter only supported for person target")
	}

	anyType := f.Type == "" || f.Type == "任意"
	var typeCond string
	if anyType {
		typeCond = "TRUE"
	} else {
		typeID, found := b.getPersonCharacterTypeID(f.Type)
		if !found {
			return "", fmt.Errorf("未找到出演类型: %s", f.Type)
		}
		typeCond = fmt.Sprintf("pc.type = %d", typeID)
	}

	// Build character-level conditions
	sideWhere := "TRUE"
	if len(f.Conditions) > 0 {
		var err error
		sideWhere, err = b.buildPersonCharCharacterWhere(f.Conditions)
		if err != nil {
			return "", fmt.Errorf("person_character condition: %w", err)
		}
	}

	// Build subject-level conditions (相关条目)
	subjectWhere := "TRUE"
	if len(f.SubjectConditions) > 0 {
		var err error
		subjectWhere, err = b.buildWhereForAlias(f.SubjectConditions, "rs")
		if err != nil {
			return "", fmt.Errorf("person_character subject condition: %w", err)
		}
	}

	// Build side join
	sideJoin := ""
	if sideWhere != "TRUE" {
		sideJoin = "LEFT JOIN characters c ON pc.character_id = c.character_id"
	}

	return b.threeWayFilter(threeWayConfig{
		mainAlias:        "p",
		mainFK:           "person_id",
		sideAlias:        "c",
		sideTable:        "characters",
		sideFK:           "character_id",
		sideCtx:          clauseContext{alias: "c", isCharacterCtx: true},
		typeCond:         typeCond,
		mode:             f.Mode,
		countOp:          f.CountOp,
		countVal:         f.CountVal,
		sideWhere:        sideWhere,
		sideJoin:         sideJoin,
		thirdTable:       "subjects",
		thirdAlias:       "rs",
		thirdFK:          "subject_id",
		thirdPK:          "id",
		thirdWhere:       subjectWhere,
		thirdMode:        f.SubjectMode,
		thirdCountOp:     f.SubjectCountOp,
		thirdCountVal:    f.SubjectCountVal,
		countDistinctCol: "character_id",
	})
}

// buildPersonCharCharacterWhere generates WHERE clauses for character conditions in person_characters context.
func (b *SQLBuilder) buildPersonCharCharacterWhere(filters []config.Filter) (string, error) {
	return b.buildClauses(filters, clauseContext{alias: "c", isCharacterCtx: true})
}

// characterPersonFilter filters characters by their associated persons (via person_characters).
func (b *SQLBuilder) characterPersonFilter(f *config.CharacterPersonFilter) (string, error) {
	if b.target != "character" {
		return "", fmt.Errorf("character_person filter only supported for character target")
	}

	anyType := f.Type == "" || f.Type == "任意"
	var typeCond string
	if anyType {
		typeCond = "TRUE"
	} else {
		typeID, found := b.getPersonCharacterTypeID(f.Type)
		if !found {
			return "", fmt.Errorf("未找到出演类型: %s", f.Type)
		}
		typeCond = fmt.Sprintf("pc.type = %d", typeID)
	}

	// Build person-level conditions
	sideWhere := "TRUE"
	if len(f.Conditions) > 0 {
		var err error
		sideWhere, err = b.buildCharPersonPersonWhere(f.Conditions)
		if err != nil {
			return "", fmt.Errorf("character_person condition: %w", err)
		}
	}

	// Build subject-level conditions (相关条目)
	subjectWhere := "TRUE"
	if len(f.SubjectConditions) > 0 {
		var err error
		subjectWhere, err = b.buildWhereForAlias(f.SubjectConditions, "rs")
		if err != nil {
			return "", fmt.Errorf("character_person subject condition: %w", err)
		}
	}

	// Build side join
	sideJoin := ""
	if sideWhere != "TRUE" {
		sideJoin = "LEFT JOIN persons p ON pc.person_id = p.person_id"
	}

	return b.threeWayFilter(threeWayConfig{
		mainAlias:        "c",
		mainFK:           "character_id",
		sideAlias:        "p",
		sideTable:        "persons",
		sideFK:           "person_id",
		sideCtx:          clauseContext{alias: "p", isPersonCtx: true},
		typeCond:         typeCond,
		mode:             f.Mode,
		countOp:          f.CountOp,
		countVal:         f.CountVal,
		sideWhere:        sideWhere,
		sideJoin:         sideJoin,
		thirdTable:       "subjects",
		thirdAlias:       "rs",
		thirdFK:          "subject_id",
		thirdPK:          "id",
		thirdWhere:       subjectWhere,
		thirdMode:        f.SubjectMode,
		thirdCountOp:     f.SubjectCountOp,
		thirdCountVal:    f.SubjectCountVal,
		countDistinctCol: "person_id",
	})
}

// buildCharPersonPersonWhere generates WHERE clauses for person conditions in character_person context.
func (b *SQLBuilder) buildCharPersonPersonWhere(filters []config.Filter) (string, error) {
	return b.buildClauses(filters, clauseContext{alias: "p", isPersonCtx: true})
}

// personCastSubjectFilter filters persons by their cast subjects (via person_characters), subject-centered.
func (b *SQLBuilder) personCastSubjectFilter(f *config.PersonCastSubjectFilter) (string, error) {
	if b.target != "person" {
		return "", fmt.Errorf("person_cast_subject filter only supported for person target")
	}

	anyType := f.Type == "" || f.Type == "任意"
	var typeCond string
	if anyType {
		typeCond = "TRUE"
	} else {
		typeID, found := b.getPersonCharacterTypeID(f.Type)
		if !found {
			return "", fmt.Errorf("未找到出演类型: %s", f.Type)
		}
		typeCond = fmt.Sprintf("pc.type = %d", typeID)
	}

	// Build subject-level conditions (primary, counted entity)
	subjWhere := "TRUE"
	if len(f.Conditions) > 0 {
		var err error
		subjWhere, err = b.buildWhereForAlias(f.Conditions, "rs")
		if err != nil {
			return "", fmt.Errorf("person_cast_subject condition: %w", err)
		}
	}

	// Build character-level conditions (per-subject secondary)
	charWhere := "TRUE"
	if len(f.CharacterConditions) > 0 {
		var err error
		charWhere, err = b.buildPersonCharCharacterWhere(f.CharacterConditions)
		if err != nil {
			return "", fmt.Errorf("person_cast_subject character condition: %w", err)
		}
	}

	sideJoin := ""
	if subjWhere != "TRUE" {
		sideJoin = "LEFT JOIN subjects rs ON pc.subject_id = rs.id"
	}

	return b.threeWayFilter(threeWayConfig{
		mainAlias:        "p",
		mainFK:           "person_id",
		sideAlias:        "rs",
		sideTable:        "subjects",
		sideFK:           "subject_id",
		typeCond:         typeCond,
		mode:             f.Mode,
		countOp:          f.CountOp,
		countVal:         f.CountVal,
		sideWhere:        subjWhere,
		sideJoin:         sideJoin,
		thirdTable:       "characters",
		thirdAlias:       "c",
		thirdFK:          "character_id",
		thirdPK:          "character_id",
		thirdWhere:       charWhere,
		thirdMode:        f.CharacterMode,
		thirdCountOp:     f.CharacterCountOp,
		thirdCountVal:    f.CharacterCountVal,
		countDistinctCol: "subject_id",
	})
}

// subjectCastFilter filters subjects by their cast (via subject_characters + person_characters), distinct persons.
func (b *SQLBuilder) subjectCastFilter(f *config.SubjectCastFilter) (string, error) {
	if b.target != "subject" {
		return "", fmt.Errorf("subject_cast filter only supported for subject target")
	}
	anyType := f.Type == "" || f.Type == "任意"
	var typeCond string
	if anyType {
		typeCond = "TRUE"
	} else {
		typeID, found := b.getCharacterAssociationTypeID(f.Type)
		if !found {
			return "", fmt.Errorf("未找到角色关联类型: %s", f.Type)
		}
		typeCond = fmt.Sprintf("sc.type = %d", typeID)
	}
	personWhere := "TRUE"
	if len(f.PersonConditions) > 0 {
		var err error
		personWhere, err = b.buildClauses(f.PersonConditions, clauseContext{alias: "p", isPersonCtx: true})
		if err != nil {
			return "", fmt.Errorf("subject_cast person condition: %w", err)
		}
	}
	charWhere := "TRUE"
	if len(f.CharacterConditions) > 0 {
		var err error
		charWhere, err = b.buildClauses(f.CharacterConditions, clauseContext{alias: "c", isCharacterCtx: true})
		if err != nil {
			return "", fmt.Errorf("subject_cast character condition: %w", err)
		}
	}
	// combined predicate at row level
	pred := typeCond
	if charWhere != "TRUE" {
		if pred == "TRUE" {
			pred = charWhere
		} else {
			pred = pred + " AND " + charWhere
		}
	}
	if personWhere != "TRUE" {
		if pred == "TRUE" {
			pred = personWhere
		} else {
			pred = pred + " AND " + personWhere
		}
	}
	baseFrom := "subject_characters sc JOIN characters c ON c.character_id = sc.character_id JOIN person_characters pc ON pc.subject_id = sc.subject_id AND pc.character_id = sc.character_id JOIN persons p ON p.person_id = pc.person_id"
	switch f.Mode {
	case "none":
		return fmt.Sprintf("NOT EXISTS (SELECT 1 FROM %s WHERE sc.subject_id = s.id AND %s)", baseFrom, pred), nil
	case "count":
		countExpr := fmt.Sprintf("(SELECT COUNT(DISTINCT p.person_id) FROM %s WHERE sc.subject_id = s.id AND %s)", baseFrom, pred)
		return b.buildCondition(countExpr, f.CountOp, fmt.Sprintf("%v", f.CountVal))
	case "all":
		// every distinct cast person for this subject (with type) must satisfy pred
		matchCount := fmt.Sprintf("(SELECT COUNT(DISTINCT p.person_id) FROM %s WHERE sc.subject_id = s.id AND %s)", baseFrom, pred)
		totalCond := typeCond
		if totalCond == "TRUE" {
			totalCount := fmt.Sprintf("(SELECT COUNT(DISTINCT p.person_id) FROM %s WHERE sc.subject_id = s.id)", baseFrom)
			return fmt.Sprintf("EXISTS (SELECT 1 FROM %s WHERE sc.subject_id = s.id AND %s) AND %s = %s", baseFrom, typeCond, matchCount, totalCount), nil
		}
		totalCount := fmt.Sprintf("(SELECT COUNT(DISTINCT p.person_id) FROM %s WHERE sc.subject_id = s.id AND %s)", baseFrom, totalCond)
		return fmt.Sprintf("EXISTS (SELECT 1 FROM %s WHERE sc.subject_id = s.id AND %s) AND %s = %s", baseFrom, typeCond, matchCount, totalCount), nil
	default: // any
		return fmt.Sprintf("EXISTS (SELECT 1 FROM %s WHERE sc.subject_id = s.id AND %s)", baseFrom, pred), nil
	}
}

// getPersonCharacterTypeID returns the ID for a Chinese CV type name.
func (b *SQLBuilder) getPersonCharacterTypeID(name string) (int, bool) {
	for id, cnName := range model.PersonCharacterTypes {
		if cnName == name {
			return id, true
		}
	}
	return 0, false
}

// isPersonCharacterTypeName reports whether name is a person_character type
// (CV, 演员, 日配, ...).
func (b *SQLBuilder) isPersonCharacterTypeName(name string) bool {
	for _, cnName := range model.PersonCharacterTypes {
		if cnName == name {
			return true
		}
	}
	return false
}
