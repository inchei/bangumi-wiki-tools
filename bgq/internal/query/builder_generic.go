package query

import (
	"fmt"
	"strings"
)

// manyToManyConfig configures a generic many-to-many filter.
type manyToManyConfig struct {
	junction       string // junction table name
	alias          string // short alias for junction table (optional, defaults to full table name)
	mainAlias      string // main entity alias
	mainPK         string // primary key column on main entity (e.g. "id", "person_id")
	junctionMainFK string // FK column in junction referencing main entity (e.g. "subject_id", "person_id")
	relatedAlias   string // related entity alias
	relatedTable   string // related entity table
	relatedPK      string // primary key column on related entity (e.g. "id", "person_id", "character_id")
	relatedFK      string // FK column in junction referencing related entity (e.g. "person_id", "subject_id", "character_id")
	extraCond      string // additional junction condition (already compiled, uses junction alias)
	relatedWhere   string // conditions on related entity (already compiled, uses relatedAlias)
	relatedJoin    string // JOIN clause for related entity (empty if no conditions)
	mode           string
	countOp        string
	countVal       interface{}
	countDistinct  bool
}

// manyToManyFilter generates SQL for a generic many-to-many relationship filter.
// Handles none/any/all/count modes. Used by staffFilter and characterFilter.
func (b *SQLBuilder) manyToManyFilter(cfg manyToManyConfig) (string, error) {
	jc := cfg.junction
	ja := cfg.alias
	if ja == "" {
		ja = jc
	}
	ma := cfg.mainAlias
	mp := cfg.mainPK
	jmf := cfg.junctionMainFK
	extra := cfg.extraCond
	if extra == "" {
		extra = "TRUE"
	}
	relWhere := cfg.relatedWhere
	if relWhere == "" {
		relWhere = "TRUE"
	}
	relJoin := cfg.relatedJoin

	// none mode
	if cfg.mode == "none" {
		// Build combined predicate including related entity conditions
		nonePred := extra
		if relWhere != "TRUE" {
			if nonePred == "TRUE" {
				nonePred = relWhere
			} else {
				nonePred = nonePred + " AND " + relWhere
			}
		}
		if nonePred == "TRUE" {
			return fmt.Sprintf("NOT EXISTS (SELECT 1 FROM %s %s WHERE %s.%s = %s.%s)",
				jc, ja, ja, jmf, ma, mp), nil
		}
		joinClause := strings.TrimSpace(relJoin)
		if joinClause != "" {
			joinClause = " " + joinClause
		}
		return fmt.Sprintf("NOT EXISTS (SELECT 1 FROM %s %s%s WHERE %s.%s = %s.%s AND %s)",
			jc, ja, joinClause, ja, jmf, ma, mp, nonePred), nil
	}

	// Build subquery predicates
	pred := extra
	if relWhere != "TRUE" {
		if pred == "TRUE" {
			pred = relWhere
		} else {
			pred = pred + " AND " + relWhere
		}
	}

	// all mode
	if cfg.mode == "all" {
		existsExtra := extra
		if existsExtra == "" {
			existsExtra = "TRUE"
		}
		// Ensure at least one row exists
		existsClause := fmt.Sprintf("EXISTS (SELECT 1 FROM %s %s WHERE %s.%s = %s.%s AND %s)",
			jc, ja, ja, jmf, ma, mp, existsExtra)

		// Count rows matching all conditions vs total rows with extra condition
		var matchCount, totalCount string
		if cfg.countDistinct {
			matchCount = fmt.Sprintf("(SELECT COUNT(DISTINCT %s.%s) FROM %s %s %s WHERE %s.%s = %s.%s AND %s)",
				ja, cfg.relatedFK, jc, ja, relJoin, ja, jmf, ma, mp, pred)
			totalCount = fmt.Sprintf("(SELECT COUNT(DISTINCT %s.%s) FROM %s %s WHERE %s.%s = %s.%s AND %s)",
				ja, cfg.relatedFK, jc, ja, ja, jmf, ma, mp, existsExtra)
		} else {
			matchCount = fmt.Sprintf("(SELECT COUNT(*) FROM %s %s %s WHERE %s.%s = %s.%s AND %s)",
				jc, ja, relJoin, ja, jmf, ma, mp, pred)
			totalCount = fmt.Sprintf("(SELECT COUNT(*) FROM %s %s WHERE %s.%s = %s.%s AND %s)",
				jc, ja, ja, jmf, ma, mp, existsExtra)
		}

		return fmt.Sprintf("%s AND\n %s =\n %s", existsClause, matchCount, totalCount), nil
	}

	// count mode
	if cfg.mode == "count" {
		var countExpr string
		if cfg.countDistinct {
			countExpr = fmt.Sprintf("(SELECT COUNT(DISTINCT %s.%s) FROM %s %s %s WHERE %s.%s = %s.%s AND %s)",
				ja, cfg.relatedFK, jc, ja, relJoin, ja, jmf, ma, mp, pred)
		} else {
			countExpr = fmt.Sprintf("(SELECT COUNT(*) FROM %s %s %s WHERE %s.%s = %s.%s AND %s)",
				jc, ja, relJoin, ja, jmf, ma, mp, pred)
		}
		return b.buildCondition(countExpr, cfg.countOp, fmt.Sprintf("%v", cfg.countVal))
	}

	// any mode (default)
	return fmt.Sprintf("EXISTS (SELECT 1 FROM %s %s %s WHERE %s.%s = %s.%s AND %s)",
		jc, ja, relJoin, ja, jmf, ma, mp, pred), nil
}

// threeWayConfig configures a generic three-way join filter (person_characters table).
type threeWayConfig struct {
	mainAlias        string        // main entity alias ("p" or "c")
	mainFK           string        // main FK in junction ("person_id" or "character_id")
	sideAlias        string        // side entity alias ("c" or "p" / "rs" for subject-centered)
	sideTable        string        // side entity table
	sideFK           string        // side FK in junction ("character_id" or "person_id" / "subject_id")
	sideCtx          clauseContext // context for side conditions
	typeCond         string        // type condition (already compiled)
	mode             string
	countOp          string
	countVal         interface{}
	sideWhere        string // conditions on side entity (already compiled)
	sideJoin         string // JOIN clause for side entity
	countDistinctCol string // column for COUNT(DISTINCT pc.X) when mode==count flat or with third conds
	thirdTable       string // e.g. "subjects" or "characters"
	thirdAlias       string // e.g. "rs" or "c"
	thirdFK          string // column in pc (subject_id / character_id)
	thirdPK          string // PK column on third entity (id / character_id)
	thirdWhere       string // conditions on third entity (already compiled)
	thirdMode        string
	thirdCountOp     string
	thirdCountVal    interface{}
}

// threeWayFilter generates SQL for a three-way join filter (person_characters).
// Handles none/any/all/count modes × any/all/count third modes.
// Used by personCharacterFilter, characterPersonFilter and personCastSubjectFilter.
func (b *SQLBuilder) threeWayFilter(cfg threeWayConfig) (string, error) {
	ma := cfg.mainAlias
	mf := cfg.mainFK
	typeCond := cfg.typeCond
	sideWhere := cfg.sideWhere
	if sideWhere == "" {
		sideWhere = "TRUE"
	}
	sideJoin := cfg.sideJoin
	thirdWhere := cfg.thirdWhere
	if thirdWhere == "" {
		thirdWhere = "TRUE"
	}
	thirdMode := cfg.thirdMode
	if thirdMode == "" {
		thirdMode = "any"
	}
	thirdCountOp := cfg.thirdCountOp
	thirdCountVal := cfg.thirdCountVal
	thirdTable := cfg.thirdTable
	thirdAlias := cfg.thirdAlias
	thirdFK := cfg.thirdFK
	thirdPK := cfg.thirdPK
	if thirdAlias == "" {
		thirdTable = "subjects"
		thirdAlias = "rs"
		thirdFK = "subject_id"
		thirdPK = "id"
	}
	hasThirdConds := thirdWhere != "TRUE"

	// Build predicates
	charPred := typeCond
	if sideWhere != "TRUE" {
		if charPred == "TRUE" {
			charPred = sideWhere
		} else {
			charPred = charPred + " AND " + sideWhere
		}
	}

	thirdJoinOuter := ""
	thirdJoinInner := ""
	if hasThirdConds {
		thirdJoinOuter = fmt.Sprintf(" LEFT JOIN %s %s ON pc.%s = %s.%s", thirdTable, thirdAlias, thirdFK, thirdAlias, thirdPK)
		thirdJoinInner = fmt.Sprintf(" LEFT JOIN %s %s ON pc2.%s = %s.%s", thirdTable, thirdAlias, thirdFK, thirdAlias, thirdPK)
	}

	// none mode
	if cfg.mode == "none" {
		if !hasThirdConds || thirdMode == "any" {
			if typeCond == "TRUE" && sideWhere == "TRUE" {
				return fmt.Sprintf("NOT EXISTS (SELECT 1 FROM person_characters pc WHERE pc.%s = %s.%s)",
					mf, ma, mf), nil
			}
			return fmt.Sprintf("NOT EXISTS (SELECT 1 FROM person_characters pc %s WHERE pc.%s = %s.%s AND %s)",
				sideJoin, mf, ma, mf, charPred), nil
		}
		// third_mode=all
		if typeCond == "TRUE" && sideWhere == "TRUE" {
			return fmt.Sprintf(
				`NOT EXISTS (
				   SELECT 1 FROM person_characters pc
				   WHERE pc.%s = %s.%s
				   AND NOT EXISTS (
				     SELECT 1 FROM person_characters pc2%s
				     WHERE pc2.%s = %s.%s AND pc2.%s = pc.%s
				     AND NOT (%s)
				   )
				 )`, mf, ma, mf, thirdJoinInner, mf, ma, mf, cfg.sideFK, cfg.sideFK, thirdWhere), nil
		}
		return fmt.Sprintf(
			`NOT EXISTS (
			   SELECT 1 FROM person_characters pc %s
			   WHERE pc.%s = %s.%s AND %s
			   AND NOT EXISTS (
			     SELECT 1 FROM person_characters pc2%s
			     WHERE pc2.%s = %s.%s AND pc2.%s = pc.%s
			     AND NOT (%s)
			   )
			 )`, sideJoin, mf, ma, mf, charPred, thirdJoinInner, mf, ma, mf, cfg.sideFK, cfg.sideFK, thirdWhere), nil
	}

	// No third conditions — simple flat query
	if !hasThirdConds {
		fromClause := "person_characters pc"
		if sideJoin != "" {
			fromClause = "person_characters pc " + sideJoin
		}
		cond := charPred

		if cfg.mode == "all" {
			return fmt.Sprintf(
				`EXISTS (SELECT 1 FROM person_characters pc WHERE pc.%s = %s.%s AND %s) AND
				 (SELECT COUNT(DISTINCT pc.%s) FROM %s WHERE pc.%s = %s.%s AND %s) =
				 (SELECT COUNT(DISTINCT pc.%s) FROM person_characters pc WHERE pc.%s = %s.%s AND %s)`,
				mf, ma, mf, typeCond, cfg.countDistinctCol, fromClause, mf, ma, mf, cond, cfg.countDistinctCol, mf, ma, mf, typeCond), nil
		}
		if cfg.mode == "count" {
			countExpr := fmt.Sprintf("(SELECT COUNT(DISTINCT pc.%s) FROM %s WHERE pc.%s = %s.%s AND %s)",
				cfg.countDistinctCol, fromClause, mf, ma, mf, cond)
			return b.buildCondition(countExpr, cfg.countOp, fmt.Sprintf("%v", cfg.countVal))
		}
		return fmt.Sprintf("EXISTS (SELECT 1 FROM %s WHERE pc.%s = %s.%s AND %s)",
			fromClause, mf, ma, mf, cond), nil
	}

	// Has third conditions — two-level quantifier
	// Count mode with third conditions
	if cfg.mode == "count" {
		countExpr := fmt.Sprintf(
			"(SELECT COUNT(DISTINCT pc.%s) FROM person_characters pc %s%s WHERE pc.%s = %s.%s AND %s AND %s)",
			cfg.countDistinctCol, sideJoin, thirdJoinOuter, mf, ma, mf, charPred, thirdWhere)
		return b.buildCondition(countExpr, cfg.countOp, fmt.Sprintf("%v", cfg.countVal))
	}

	switch {
	case cfg.mode == "any" && thirdMode == "any":
		return fmt.Sprintf(
			`EXISTS (SELECT 1 FROM person_characters pc %s%s
			 WHERE pc.%s = %s.%s AND %s AND %s)`,
			sideJoin, thirdJoinOuter, mf, ma, mf, charPred, thirdWhere), nil

	case cfg.mode == "any" && thirdMode == "all":
		return fmt.Sprintf(
			`EXISTS (
		   SELECT 1 FROM person_characters pc %s
		   WHERE pc.%s = %s.%s AND %s
		   AND NOT EXISTS (
		     SELECT 1 FROM person_characters pc2%s
		     WHERE pc2.%s = %s.%s AND pc2.%s = pc.%s
		     AND NOT (%s)
		   )
		 )`, sideJoin, mf, ma, mf, charPred, thirdJoinInner, mf, ma, mf, cfg.sideFK, cfg.sideFK, thirdWhere), nil

	case cfg.mode == "all" && thirdMode == "any":
		return fmt.Sprintf(
			`EXISTS (SELECT 1 FROM person_characters pc WHERE pc.%s = %s.%s AND %s) AND
			 (SELECT COUNT(*) FROM (
			   SELECT pc.%s FROM person_characters pc %s%s
			   WHERE pc.%s = %s.%s AND %s AND %s
			   GROUP BY pc.%s
			 ) t) =
			 (SELECT COUNT(DISTINCT pc.%s) FROM person_characters pc WHERE pc.%s = %s.%s AND %s)`,
			mf, ma, mf, typeCond,
			cfg.sideFK, sideJoin, thirdJoinOuter, mf, ma, mf, charPred, thirdWhere, cfg.sideFK,
			cfg.countDistinctCol, mf, ma, mf, typeCond), nil

	case cfg.mode == "all" && thirdMode == "all":
		return fmt.Sprintf(
			`EXISTS (SELECT 1 FROM person_characters pc WHERE pc.%s = %s.%s AND %s) AND
			 NOT EXISTS (
			   SELECT 1 FROM person_characters pc %s
			   WHERE pc.%s = %s.%s AND %s
			   AND EXISTS (
			     SELECT 1 FROM person_characters pc2%s
			     WHERE pc2.%s = %s.%s AND pc2.%s = pc.%s
			     AND NOT (%s)
			   )
			 )`,
			mf, ma, mf, typeCond,
			sideJoin, mf, ma, mf, charPred,
			thirdJoinInner, mf, ma, mf, cfg.sideFK, cfg.sideFK, thirdWhere), nil

	case cfg.mode == "any" && thirdMode == "count":
		subjCountOp := toSQLOp(thirdCountOp)
		num, err := safeNum(fmt.Sprintf("%v", thirdCountVal))
		if err != nil {
			return "", err
		}
		return fmt.Sprintf(
			`EXISTS (
		   SELECT 1 FROM person_characters pc %s
		   WHERE pc.%s = %s.%s AND %s
		   AND (SELECT COUNT(*) FROM person_characters pc2%s
		     WHERE pc2.%s = %s.%s AND pc2.%s = pc.%s
		     AND %s) %s %s
		 )`,
			sideJoin, mf, ma, mf, charPred,
			thirdJoinInner, mf, ma, mf, cfg.sideFK, cfg.sideFK,
			thirdWhere, subjCountOp, num), nil

	case cfg.mode == "all" && thirdMode == "count":
		subjCountOp := toSQLOp(thirdCountOp)
		num, err := safeNum(fmt.Sprintf("%v", thirdCountVal))
		if err != nil {
			return "", err
		}
		return fmt.Sprintf(
			`EXISTS (SELECT 1 FROM person_characters pc WHERE pc.%s = %s.%s AND %s) AND
			 NOT EXISTS (
			   SELECT 1 FROM person_characters pc %s
			   WHERE pc.%s = %s.%s AND %s
			   AND NOT ((SELECT COUNT(*) FROM person_characters pc2%s
			     WHERE pc2.%s = %s.%s AND pc2.%s = pc.%s
			     AND %s) %s %s)
			 )`,
			mf, ma, mf, typeCond,
			sideJoin, mf, ma, mf, charPred,
			thirdJoinInner, mf, ma, mf, cfg.sideFK, cfg.sideFK,
			thirdWhere, subjCountOp, num), nil
	}

	return "TRUE", nil
}
