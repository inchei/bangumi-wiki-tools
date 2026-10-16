package query

import (
	"fmt"

	"github.com/inchei/bangumi-query/internal/archive"
)

// jsonCTE renders `<name> AS (<source>)` for the JSONLines CTE list.
func (b *SQLBuilder) jsonCTE(t archive.Table) string {
	return fmt.Sprintf("%s AS (%s)", t.Name, t.Source(EscapeLiteral(b.dataDir)))
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
	add := func(t archive.Table) {
		if loaded[t.Name] {
			return
		}
		loaded[t.Name] = true
		ctes = append(ctes, b.jsonCTE(t))
	}

	add(archive.Subjects)

	// Person/character targets read their entity table as the main table.
	if b.target == "person" {
		add(archive.Persons)
	}
	if b.target == "character" {
		add(archive.Characters)
	}

	if b.cfg.NeedsRelations() || needs.relations {
		add(archive.SubjectRelations)
	}
	if b.cfg.NeedsPersons() || needs.persons {
		add(archive.SubjectPersons)
		// Related person lookups (name/infobox) need the persons table too.
		add(archive.Persons)
	}
	if b.cfg.NeedsPersonRelations() || needs.personRelations {
		add(archive.PersonRelations)
		add(archive.Persons)
	}
	if b.cfg.NeedsCharacterRelations() || needs.characterRelations {
		add(archive.CharacterRelations)
		add(archive.Characters)
	}
	if b.cfg.NeedsCharacters() || needs.characters {
		add(archive.SubjectCharacters)
		add(archive.Characters)
	}
	if b.cfg.NeedsPersonCharacters() || needs.personCharacters {
		add(archive.PersonCharacters)
		add(archive.Characters)
		add(archive.Persons)
	}
	if b.target == "episode" || b.cfg.NeedsEpisodes() || needs.episodes {
		add(archive.Episodes)
	}

	return ctes, nil
}
