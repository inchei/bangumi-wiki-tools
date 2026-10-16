package query

import (
	"fmt"
	"strings"

	"github.com/inchei/bangumi-query/internal/config"
)

// Filter type identifiers for findFilter.
type filterType int

const (
	filterTypeRelation filterType = iota
	filterTypeStaff
	filterTypeCharacter
	filterTypeEpisode
	filterTypePersonRelation
	filterTypeCharacterRelation
	filterTypePersonCharacter
	filterTypeCharacterPerson
	filterTypePersonCastSubject
	filterTypeSubjectCast
)

// SQLBuilder generates DuckDB SQL from a Config.
type SQLBuilder struct {
	cfg       *config.Config
	dataDir   string
	useDB     bool   // if true, reference tables directly instead of JSON CTEs
	target    string // "subject", "person", or "character"
	mainAlias string // "s", "p", or "c"
	tc        *targetConfig
}

// clauseContext controls how filters are generated in different SQL contexts.
type clauseContext struct {
	alias          string // table alias: "s" (main subject), "rs" (related subject), "p" (person), "c" (character), "rc" (related character)
	isPersonCtx    bool   // true when filtering person-level conditions (uses personFilterForAlias)
	isCharacterCtx bool   // true when filtering character-level conditions (uses characterFilterForAlias)
	isEpisodeCtx   bool   // true when filtering episode conditions (direct fields only, no infobox)
	junctionAlias  string // junction table alias for appear_eps in staff person context
}

// NewSQLBuilder creates a new SQL builder.
func NewSQLBuilder(cfg *config.Config, dataDir string) *SQLBuilder {
	target := cfg.Target
	if target == "" {
		target = "subject"
	}
	tc := newTargetConfig(target)
	return &SQLBuilder{
		cfg:       cfg,
		dataDir:   dataDir,
		useDB:     cfg.HasDatabase(),
		target:    target,
		mainAlias: tc.mainAlias,
		tc:        tc,
	}
}

// Build generates the complete DuckDB SQL query.
func (b *SQLBuilder) Build() (string, error) {
	// Generate CTEs for data sources
	ctes, err := b.buildCTEs()
	if err != nil {
		return "", err
	}

	// Generate WHERE clauses
	where, err := b.buildWhere()
	if err != nil {
		return "", err
	}

	// Generate SELECT columns
	selectCols := b.buildSelect()

	// Generate ORDER BY
	orderBy := b.buildOrderBy()

	// Generate LIMIT
	limit := b.cfg.Limit
	if limit <= 0 {
		limit = 1000
	}

	// Assemble the query
	var sql strings.Builder
	if len(ctes) > 0 {
		sql.WriteString("WITH ")
		sql.WriteString(strings.Join(ctes, ",\n"))
		sql.WriteString("\n")
	}

	sql.WriteString("SELECT ")
	sql.WriteString(strings.Join(selectCols, ", "))
	fmt.Fprintf(&sql, "\nFROM %s %s\n", b.tc.mainTable, b.mainAlias)

	// Add JOINs for relations, persons, episodes
	joins := b.buildJoins()
	for _, j := range joins {
		sql.WriteString(j)
		sql.WriteString("\n")
	}

	if where != "" {
		sql.WriteString("WHERE ")
		sql.WriteString(where)
		sql.WriteString("\n")
	}

	if orderBy != "" {
		sql.WriteString("ORDER BY ")
		sql.WriteString(orderBy)
		sql.WriteString("\n")
	}

	fmt.Fprintf(&sql, "LIMIT %d", limit)

	return sql.String(), nil
}

func (b *SQLBuilder) buildCTEs() ([]string, error) {
	// If using a persistent database, no CTEs needed — tables already exist
	if b.useDB {
		return nil, nil
	}

	// Association output columns reference junction tables even when no filter
	// of that kind is present, so include them in CTE loading decisions.
	needs := b.assocCTENeeds()

	var ctes []string

	// Main subjects CTE — reads the JSONLines file
	subjectFile := b.dataDir + "/subject.jsonlines"
	ctes = append(ctes, fmt.Sprintf(
		`subjects AS (SELECT * FROM read_json_auto('%s', format='newline_delimited'))`,
		EscapeLiteral(subjectFile),
	))

	// For person target: also load persons as main table
	personsLoaded := false
	if b.target == "person" {
		personFile := b.dataDir + "/person.jsonlines"
		ctes = append(ctes, fmt.Sprintf(
			`persons AS (SELECT id as person_id, name, type as person_type, career, COALESCE(infobox,'') as infobox, summary, collects, comments FROM read_json_auto('%s', format='newline_delimited'))`,
			EscapeLiteral(personFile),
		))
		personsLoaded = true
	}

	// For character target: load characters as main table
	charactersLoaded := false
	if b.target == "character" {
		charFile := b.dataDir + "/character.jsonlines"
		ctes = append(ctes, fmt.Sprintf(
			`characters AS (SELECT id as character_id, role, name, COALESCE(infobox,'') as infobox, summary, comments, collects FROM read_json_auto('%s', format='newline_delimited'))`,
			EscapeLiteral(charFile),
		))
		charactersLoaded = true
	}

	// Relations CTE
	if b.cfg.NeedsRelations() || needs.relations {
		relFile := b.dataDir + "/subject-relations.jsonlines"
		ctes = append(ctes, fmt.Sprintf(
			`subject_relations AS (SELECT * FROM read_json_auto('%s', format='newline_delimited'))`,
			EscapeLiteral(relFile),
		))
	}

	// Persons CTE
	if b.cfg.NeedsPersons() || needs.persons {
		persFile := b.dataDir + "/subject-persons.jsonlines"
		ctes = append(ctes, fmt.Sprintf(
			`subject_persons AS (SELECT * FROM read_json_auto('%s', format='newline_delimited'))`,
			EscapeLiteral(persFile),
		))
		// Also load person data for name lookups and infobox field extraction (skip if already loaded as main)
		if !personsLoaded {
			personFile := b.dataDir + "/person.jsonlines"
			ctes = append(ctes, fmt.Sprintf(
				`persons AS (SELECT id as person_id, name, type as person_type, career, COALESCE(infobox,'') as infobox, summary, collects, comments FROM read_json_auto('%s', format='newline_delimited'))`,
				EscapeLiteral(personFile),
			))
		}
	}

	// Person Relations CTE (person-to-person, filtered by person_type='prsn')
	if b.cfg.NeedsPersonRelations() || needs.personRelations {
		persRelFile := b.dataDir + "/person-relations.jsonlines"
		ctes = append(ctes, fmt.Sprintf(
			`person_relations AS (SELECT * FROM read_json_auto('%s', format='newline_delimited') WHERE person_type = 'prsn')`,
			EscapeLiteral(persRelFile),
		))
		// Ensure persons table is loaded for related person lookups
		if !personsLoaded {
			personFile := b.dataDir + "/person.jsonlines"
			ctes = append(ctes, fmt.Sprintf(
				`persons AS (SELECT id as person_id, name, type as person_type, career, COALESCE(infobox,'') as infobox, summary, collects, comments FROM read_json_auto('%s', format='newline_delimited'))`,
				EscapeLiteral(personFile),
			))
			personsLoaded = true
		}
	}

	// Character Relations CTE (character-to-character, filtered by person_type='crt')
	if b.cfg.NeedsCharacterRelations() || needs.characterRelations {
		charRelFile := b.dataDir + "/person-relations.jsonlines"
		ctes = append(ctes, fmt.Sprintf(
			`character_relations AS (SELECT * FROM read_json_auto('%s', format='newline_delimited') WHERE person_type = 'crt')`,
			EscapeLiteral(charRelFile),
		))
		// Ensure characters table is loaded for related character lookups
		if !charactersLoaded {
			charFile := b.dataDir + "/character.jsonlines"
			ctes = append(ctes, fmt.Sprintf(
				`characters AS (SELECT id as character_id, role, name, COALESCE(infobox,'') as infobox, summary, comments, collects FROM read_json_auto('%s', format='newline_delimited'))`,
				EscapeLiteral(charFile),
			))
			charactersLoaded = true
		}
	}

	// Subject Characters CTE
	if b.cfg.NeedsCharacters() || needs.characters {
		subCharFile := b.dataDir + "/subject-characters.jsonlines"
		ctes = append(ctes, fmt.Sprintf(
			`subject_characters AS (SELECT * FROM read_json_auto('%s', format='newline_delimited'))`,
			EscapeLiteral(subCharFile),
		))
		// Ensure characters table is loaded for character lookups
		if !charactersLoaded {
			charFile := b.dataDir + "/character.jsonlines"
			ctes = append(ctes, fmt.Sprintf(
				`characters AS (SELECT id as character_id, role, name, COALESCE(infobox,'') as infobox, summary, comments, collects FROM read_json_auto('%s', format='newline_delimited'))`,
				EscapeLiteral(charFile),
			))
			charactersLoaded = true
		}
	}

	// Person Characters CTE (three-way join: person-character-subject)
	if b.cfg.NeedsPersonCharacters() || needs.personCharacters {
		perCharFile := b.dataDir + "/person-characters.jsonlines"
		ctes = append(ctes, fmt.Sprintf(
			`person_characters AS (SELECT * FROM read_json_auto('%s', format='newline_delimited'))`,
			EscapeLiteral(perCharFile),
		))
		// Ensure characters table is loaded
		if !charactersLoaded {
			charFile := b.dataDir + "/character.jsonlines"
			ctes = append(ctes, fmt.Sprintf(
				`characters AS (SELECT id as character_id, role, name, COALESCE(infobox,'') as infobox, summary, comments, collects FROM read_json_auto('%s', format='newline_delimited'))`,
				EscapeLiteral(charFile),
			))
		}
		// Ensure persons table is loaded
		if !personsLoaded {
			personFile := b.dataDir + "/person.jsonlines"
			ctes = append(ctes, fmt.Sprintf(
				`persons AS (SELECT id as person_id, name, type as person_type, career, COALESCE(infobox,'') as infobox, summary, collects, comments FROM read_json_auto('%s', format='newline_delimited'))`,
				EscapeLiteral(personFile),
			))
		}
	}

	// Episodes CTE
	episodesLoaded := false
	if b.target == "episode" {
		epFile := b.dataDir + "/episode.jsonlines"
		ctes = append(ctes, fmt.Sprintf(
			`episodes AS (SELECT id AS episode_id, * EXCLUDE (id) FROM read_json_auto('%s', format='newline_delimited'))`,
			EscapeLiteral(epFile),
		))
		episodesLoaded = true
	}
	if !episodesLoaded && (b.cfg.NeedsEpisodes() || needs.episodes) {
		epFile := b.dataDir + "/episode.jsonlines"
		ctes = append(ctes, fmt.Sprintf(
			`episodes AS (SELECT id AS episode_id, * EXCLUDE (id) FROM read_json_auto('%s', format='newline_delimited'))`,
			EscapeLiteral(epFile),
		))
	}

	return ctes, nil
}

func (b *SQLBuilder) buildWhere() (string, error) {
	return b.buildClauses(b.cfg.Filters, clauseContext{alias: b.mainAlias})
}

// buildClauses recursively builds WHERE clauses from a list of filters.
// Logic filters are handled recursively, with OR groups wrapped in parentheses.
func (b *SQLBuilder) buildClauses(filters []config.Filter, ctx clauseContext) (string, error) {
	return b.buildClausesWithOp(filters, ctx, "and")
}

// buildClausesWithOp recursively builds clauses and joins with the given op ("and" or "or").
// OR groups are wrapped in parentheses for correct precedence.
func (b *SQLBuilder) buildClausesWithOp(filters []config.Filter, ctx clauseContext, op string) (string, error) {
	var clauses []string
	sep := " AND "
	if op == "or" {
		sep = " OR "
	}
	for i, f := range filters {
		clause, err := b.filterToCtx(f, ctx, i)
		if err != nil {
			return "", err
		}
		if clause != "" {
			clauses = append(clauses, clause)
		}
	}
	if len(clauses) == 0 {
		return "TRUE", nil
	}
	joined := strings.Join(clauses, sep)
	if op == "or" && len(clauses) > 1 {
		joined = "(" + joined + ")"
	}
	return joined, nil
}

// filterToCtx dispatches a single filter to the appropriate handler based on context.
func (b *SQLBuilder) filterToCtx(f config.Filter, ctx clauseContext, idx int) (string, error) {
	// Logic filter: recursively build clauses with the specified op
	if f.Logic != nil {
		return b.buildClausesWithOp(f.Logic.Items, ctx, f.Logic.Op)
	}

	// Episode context: only field and count filters, direct fields only
	if ctx.isEpisodeCtx {
		return b.episodeFilterForCtx(f, idx)
	}

	// Person context: use person-specific handlers
	if ctx.isPersonCtx {
		return b.personFilterForAlias(f, idx, ctx.junctionAlias)
	}

	// Character context: use character-specific handlers
	if ctx.isCharacterCtx {
		return b.characterFilterForAlias(f, idx)
	}

	// Main alias context (top-level): use main handlers
	if ctx.alias == b.mainAlias {
		return b.filterToSQLMain(f, idx)
	}

	// Nested alias context (rs, etc.): use alias handlers
	return b.filterForAlias(f, ctx.alias, idx)
}

func (b *SQLBuilder) episodeFilterForCtx(f config.Filter, idx int) (string, error) {
	switch {
	case f.Field != nil:
		return b.episodeFieldFilter(f.Field)
	default:
		return "", fmt.Errorf("剧集筛选不支持此条件类型 (index %d)", idx)
	}
}

// filterToSQLMain dispatches a single filter using main-table handlers.
func (b *SQLBuilder) filterToSQLMain(f config.Filter, idx int) (string, error) {
	// Episode target: only field filters are supported
	if b.target == "episode" {
		switch {
		case f.Field != nil:
			return b.episodeFieldFilter(f.Field)
		default:
			return "", fmt.Errorf("剧集筛选不支持此条件类型 (index %d)", idx)
		}
	}

	switch {
	case f.Type != nil:
		return b.typeFilter(f.Type)
	case f.Field != nil:
		return b.fieldFilter(f.Field, b.mainAlias)
	case f.Global != nil:
		return b.globalFilter(f.Global)
	case f.Tag != nil:
		return b.tagFilter(f.Tag)
	case f.MetaTag != nil:
		return b.metaTagFilter(f.MetaTag)
	case f.Relation != nil:
		return b.relationFilter(f.Relation)
	case f.PersonRelation != nil:
		return b.personRelationFilter(f.PersonRelation)
	case f.CharacterRelation != nil:
		return b.characterRelationFilter(f.CharacterRelation)
	case f.Staff != nil:
		return b.staffFilter(f.Staff)
	case f.Character != nil:
		return b.characterFilter(f.Character)
	case f.PersonCharacter != nil:
		return b.personCharacterFilter(f.PersonCharacter)
	case f.PersonCastSubject != nil:
		return b.personCastSubjectFilter(f.PersonCastSubject)
	case f.CharacterPerson != nil:
		return b.characterPersonFilter(f.CharacterPerson)
	case f.SubjectCast != nil:
		return b.subjectCastFilter(f.SubjectCast)
	case f.Episode != nil:
		return b.episodeFilter(f.Episode)
	default:
		return "", fmt.Errorf("unknown filter type at index %d", idx)
	}
}
