// Package archive describes the JSONLines files bgq reads and the column
// projection both consumers must agree on: the JSON-mode CTEs
// (internal/query) and the ingest CREATE TABLE statements (cmd/bgq).
package archive

import "fmt"

// Table is one JSONLines source plus the projection every consumer uses.
type Table struct {
	Name   string // table / CTE name
	File   string // file name inside the archive directory
	Select string // SELECT list
	Where  string // optional row filter
}

// Source renders the `SELECT ... FROM read_json_auto(...)` expression shared
// by the JSON-mode CTEs and the ingest CREATE TABLE statements. dataDir is
// interpolated as-is, so callers pass an already-escaped path.
func (t Table) Source(dataDir string) string {
	src := fmt.Sprintf("SELECT %s FROM read_json_auto('%s/%s', format='newline_delimited')", t.Select, dataDir, t.File)
	if t.Where != "" {
		src += " WHERE " + t.Where
	}
	return src
}

var (
	Subjects           = Table{Name: "subjects", File: "subject.jsonlines", Select: "*"}
	Persons            = Table{Name: "persons", File: "person.jsonlines", Select: "id as person_id, name, type as person_type, career, COALESCE(infobox,'') as infobox, summary, collects, comments"}
	Characters         = Table{Name: "characters", File: "character.jsonlines", Select: "id as character_id, role, name, COALESCE(infobox,'') as infobox, summary, comments, collects"}
	SubjectRelations   = Table{Name: "subject_relations", File: "subject-relations.jsonlines", Select: "*"}
	SubjectPersons     = Table{Name: "subject_persons", File: "subject-persons.jsonlines", Select: "*"}
	SubjectCharacters  = Table{Name: "subject_characters", File: "subject-characters.jsonlines", Select: "*"}
	Episodes           = Table{Name: "episodes", File: "episode.jsonlines", Select: "id AS episode_id, * EXCLUDE (id)"}
	PersonRelations    = Table{Name: "person_relations", File: "person-relations.jsonlines", Select: "*", Where: "person_type = 'prsn'"}
	CharacterRelations = Table{Name: "character_relations", File: "person-relations.jsonlines", Select: "*", Where: "person_type = 'crt'"}
	PersonCharacters   = Table{Name: "person_characters", File: "person-characters.jsonlines", Select: "*"}

	// AllTables is the ingest order.
	AllTables = []Table{
		Subjects, Persons, Characters, SubjectRelations, SubjectPersons,
		SubjectCharacters, Episodes, PersonRelations, CharacterRelations,
		PersonCharacters,
	}
)
