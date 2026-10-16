package query

import "fmt"

// JSON-mode CTE projections. Each JSONLines source is rendered in exactly one
// place so the definitions cannot drift apart.
const (
	selectAllColumns    = "*"
	selectPersonCols    = "id as person_id, name, type as person_type, career, COALESCE(infobox,'') as infobox, summary, collects, comments"
	selectCharacterCols = "id as character_id, role, name, COALESCE(infobox,'') as infobox, summary, comments, collects"
	selectEpisodeCols   = "id AS episode_id, * EXCLUDE (id)"
)

// jsonCTE renders `<name> AS (SELECT <cols> FROM read_json_auto('<dir>/<file>', format='newline_delimited')<where>)`.
func (b *SQLBuilder) jsonCTE(name, file, cols, where string) string {
	cte := fmt.Sprintf("%s AS (SELECT %s FROM read_json_auto('%s', format='newline_delimited')",
		name, cols, EscapeLiteral(b.dataDir+"/"+file))
	if where != "" {
		cte += " WHERE " + where
	}
	return cte + ")"
}

func (b *SQLBuilder) subjectsCTE() string {
	return b.jsonCTE("subjects", "subject.jsonlines", selectAllColumns, "")
}

func (b *SQLBuilder) personsCTE() string {
	return b.jsonCTE("persons", "person.jsonlines", selectPersonCols, "")
}

func (b *SQLBuilder) charactersCTE() string {
	return b.jsonCTE("characters", "character.jsonlines", selectCharacterCols, "")
}

func (b *SQLBuilder) episodesCTE() string {
	return b.jsonCTE("episodes", "episode.jsonlines", selectEpisodeCols, "")
}

func (b *SQLBuilder) subjectRelationsCTE() string {
	return b.jsonCTE("subject_relations", "subject-relations.jsonlines", selectAllColumns, "")
}

func (b *SQLBuilder) subjectPersonsCTE() string {
	return b.jsonCTE("subject_persons", "subject-persons.jsonlines", selectAllColumns, "")
}

func (b *SQLBuilder) personRelationsCTE() string {
	return b.jsonCTE("person_relations", "person-relations.jsonlines", selectAllColumns, "person_type = 'prsn'")
}

func (b *SQLBuilder) characterRelationsCTE() string {
	return b.jsonCTE("character_relations", "person-relations.jsonlines", selectAllColumns, "person_type = 'crt'")
}

func (b *SQLBuilder) subjectCharactersCTE() string {
	return b.jsonCTE("subject_characters", "subject-characters.jsonlines", selectAllColumns, "")
}

func (b *SQLBuilder) personCharactersCTE() string {
	return b.jsonCTE("person_characters", "person-characters.jsonlines", selectAllColumns, "")
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
	loaded := map[string]bool{}
	add := func(name, cte string) {
		if loaded[name] {
			return
		}
		loaded[name] = true
		ctes = append(ctes, cte)
	}

	add("subjects", b.subjectsCTE())

	// Person/character targets read their entity table as the main table.
	if b.target == "person" {
		add("persons", b.personsCTE())
	}
	if b.target == "character" {
		add("characters", b.charactersCTE())
	}

	if b.cfg.NeedsRelations() || needs.relations {
		add("subject_relations", b.subjectRelationsCTE())
	}
	if b.cfg.NeedsPersons() || needs.persons {
		add("subject_persons", b.subjectPersonsCTE())
		// Related person lookups (name/infobox) need the persons table too.
		add("persons", b.personsCTE())
	}
	if b.cfg.NeedsPersonRelations() || needs.personRelations {
		add("person_relations", b.personRelationsCTE())
		add("persons", b.personsCTE())
	}
	if b.cfg.NeedsCharacterRelations() || needs.characterRelations {
		add("character_relations", b.characterRelationsCTE())
		add("characters", b.charactersCTE())
	}
	if b.cfg.NeedsCharacters() || needs.characters {
		add("subject_characters", b.subjectCharactersCTE())
		add("characters", b.charactersCTE())
	}
	if b.cfg.NeedsPersonCharacters() || needs.personCharacters {
		add("person_characters", b.personCharactersCTE())
		add("characters", b.charactersCTE())
		add("persons", b.personsCTE())
	}
	if b.target == "episode" || b.cfg.NeedsEpisodes() || needs.episodes {
		add("episodes", b.episodesCTE())
	}

	return ctes, nil
}
