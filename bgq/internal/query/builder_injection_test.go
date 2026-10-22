package query

import (
	"strings"
	"testing"

	"github.com/inchei/bangumi-query/internal/config"
)

// TestBuildConditionNumericRejectsInjection verifies that numeric comparison
// values are validated as plain numeric literals, so SQL injection via
// gt/gte/lt/lte operators is rejected at SQL-generation time.
func TestBuildConditionNumericRejectsInjection(t *testing.T) {
	b := NewSQLBuilder(&config.Config{Target: "subject", Limit: 10}, "/tmp/data")

	for _, bad := range []string{
		"9.5 OR 1=1",
		"9.5) OR 1=1 --",
		"0; DROP TABLE subjects --",
		"x",
		"1e5' OR 1=1 --",
		"Inf",
		"NaN",
		"0x1p-2",
	} {
		if _, err := b.buildCondition("s.score", "gt", bad); err == nil {
			t.Errorf("expected error for value %q, got none", bad)
		}
	}

	// Valid numeric literals must still be accepted unchanged (trimmed).
	for _, ok := range []string{"0", "9.5", "-3", "+4", "1e3", "1.25E-2", " 42 ", ""} {
		want := "0"
		if ok != "" {
			want = strings.TrimSpace(ok)
		}
		got, err := safeNum(ok)
		if err != nil {
			t.Errorf("unexpected error for value %q: %v", ok, err)
			continue
		}
		if got != want {
			t.Errorf("safeNum(%q) = %q, want %q", ok, got, want)
		}
	}
}

// TestRegexQuoteEscaping verifies that regex operator values are escaped
// as SQL string literals (single quotes doubled) while preserving regex
// metacharacters, so apostrophes can't break the SQL and patterns stay real
// regexes.
func TestRegexQuoteEscaping(t *testing.T) {
	// career regex on person target: same escaping rules apply.
	bp := NewSQLBuilder(&config.Config{Target: "person", Limit: 10}, "/tmp/data")
	sql, err := bp.fieldFilter(&config.FieldFilter{Field: "career", Operator: "regex", Value: "a'b|c"}, "p")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(sql, "'a''b|c'") {
		t.Errorf("career regex not escaped correctly: %s", sql)
	}
}

// TestRegexCastsNonVarchar verifies that regex comparisons cast the field
// expression to VARCHAR, since DuckDB's regexp_matches has no overload for
// numeric columns (e.g. s.score is DOUBLE).
func TestRegexCastsNonVarchar(t *testing.T) {
	b := NewSQLBuilder(&config.Config{Target: "subject", Limit: 10}, "/tmp/data")

	sql, err := b.buildCondition("s.score", "regex", "^9")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(sql, "CAST(s.score AS VARCHAR)") {
		t.Errorf("regex on numeric field missing VARCHAR cast: %s", sql)
	}

	sql, err = b.buildCondition("s.score", "not_regex", "^9")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(sql, "CAST(s.score AS VARCHAR)") {
		t.Errorf("not_regex on numeric field missing VARCHAR cast: %s", sql)
	}

	// Field-to-field regex compare casts both sides.
	sql, err = b.buildFieldCompare("score", "name", "", "regex", "s", "rs")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(sql, `CAST(s."score" AS VARCHAR)`) || !strings.Contains(sql, `CAST(rs."name" AS VARCHAR)`) {
		t.Errorf("field-compare regex missing VARCHAR casts: %s", sql)
	}
}

// TestOutputColumnsTriggerCTELoading verifies that association output columns
// (e.g. "原作.name", "单行本.id", "episode.name") load the junction CTEs even
// when no filter of that kind is present, instead of failing with a missing
// table error in JSON mode.
func TestOutputColumnsTriggerCTELoading(t *testing.T) {
	cfg := &config.Config{
		Target:  "subject",
		Limit:   10,
		Output:  &config.Output{Format: "table", Columns: []string{"id", "原作.name", "单行本.name", "主角.name", "episode.name"}},
		Filters: []config.Filter{{Type: &config.TypeFilter{Value: 1}}},
	}
	b := NewSQLBuilder(cfg, "/tmp/data")
	sql, err := b.Build()
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{"subject_relations AS (", "subject_persons AS (", "persons AS (", "subject_characters AS (", "characters AS (", "episodes AS ("} {
		if !strings.Contains(sql, want) {
			t.Errorf("generated SQL missing CTE %s:\n%s", want, sql)
		}
	}

	// Output columns must not drag in CTEs they don't need.
	cfgMin := &config.Config{
		Target:  "subject",
		Limit:   10,
		Output:  &config.Output{Format: "table", Columns: []string{"id", "name"}},
		Filters: []config.Filter{{Type: &config.TypeFilter{Value: 1}}},
	}
	bMin := NewSQLBuilder(cfgMin, "/tmp/data")
	sqlMin, err := bMin.Build()
	if err != nil {
		t.Fatal(err)
	}
	for _, unwanted := range []string{"subject_relations AS (", "subject_persons AS (", "subject_characters AS (", "episodes AS ("} {
		if strings.Contains(sqlMin, unwanted) {
			t.Errorf("generated SQL unexpectedly includes %s:\n%s", unwanted, sqlMin)
		}
	}
}

// TestAssocIDOutputColumn verifies that "entity.id" output columns reference
// the entity's actual primary key column (persons/characters/episodes rename
// id to person_id/character_id/episode_id in both the CTEs and the ingested DB).
func TestAssocIDOutputColumn(t *testing.T) {
	cfg := &config.Config{
		Target:  "subject",
		Limit:   10,
		Output:  &config.Output{Format: "table", Columns: []string{"原作.id", "主角.id", "episode.id"}},
		Filters: []config.Filter{{Type: &config.TypeFilter{Value: 1}}},
	}
	b := NewSQLBuilder(cfg, "/tmp/data")
	sql, err := b.Build()
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{"p.person_id", "c.character_id", "e.episode_id"} {
		if !strings.Contains(sql, want) {
			t.Errorf("generated SQL missing %s:\n%s", want, sql)
		}
	}
	for _, bad := range []string{"SELECT p.id FROM", "SELECT c.id FROM", "SELECT e.id FROM"} {
		if strings.Contains(sql, bad) {
			t.Errorf("generated SQL still references nonexistent %s:\n%s", bad, sql)
		}
	}

	// Aggregation mode orders by the entity PK, not the main id column.
	cfgAll := &config.Config{
		Target:  "subject",
		Limit:   10,
		Output:  &config.Output{Format: "table", Columns: []string{"原作.name"}},
		Filters: []config.Filter{{Type: &config.TypeFilter{Value: 1}}},
	}
	ba := NewSQLBuilder(cfgAll, "/tmp/data")
	sqlAll, err := ba.Build()
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(sqlAll, "ORDER BY p.person_id") {
		t.Errorf("aggregation ORDER BY uses wrong column:\n%s", sqlAll)
	}
}

// TestGroupColumnSubjectFields verifies that group output columns with "s."
// members (person_character / character_person) join subjects and resolve
// those members against it, and that an output-only column loads the
// person_characters CTE even without a matching filter.
func TestGroupColumnSubjectFields(t *testing.T) {
	cfg := &config.Config{
		Target:  "person",
		Limit:   10,
		Output:  &config.Output{Format: "table", Columns: []string{"person_id", "CV.{id|name|s.id|s.name}"}},
		Filters: []config.Filter{{Field: &config.FieldFilter{Field: "name", Operator: "contains", Value: "x"}}},
	}
	b := NewSQLBuilder(cfg, "/tmp/data")
	sql, err := b.Build()
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{
		"person_characters AS (",
		"LEFT JOIN subjects rs ON pc.subject_id = rs.id",
		`"s.id" := NULLIF(CAST(rs.id AS VARCHAR), '')`,
		`"s.name" := NULLIF(CAST(rs."name" AS VARCHAR), '')`,
		`"id" := NULLIF(CAST(c.character_id AS VARCHAR), '')`,
		`AS "CV.{id|name|s.id|s.name}"`,
	} {
		if !strings.Contains(sql, want) {
			t.Errorf("generated SQL missing %q:\n%s", want, sql)
		}
	}

	// Group-internal sort by an "s." member resolves against the subjects join.
	cfgSort := &config.Config{
		Target:  "person",
		Limit:   10,
		Output:  &config.Output{Format: "table", Columns: []string{"person_id", "CV.{name|s.date}"}},
		Filters: []config.Filter{{Field: &config.FieldFilter{Field: "name", Operator: "contains", Value: "x"}}},
		Sort:    []config.SortRule{{Field: "CV.s.date", Direction: "desc"}},
	}
	bs := NewSQLBuilder(cfgSort, "/tmp/data")
	sqlSort, err := bs.Build()
	if err != nil {
		t.Fatal(err)
	}
	// normalizeDate wraps rs."date" in a CASE; just verify the ORDER BY
	// expression operates on rs."date" (not the character alias).
	if !strings.Contains(sqlSort, `ORDER BY TRY_CAST(CASE WHEN regexp_matches(replace(replace(replace(TRIM(rs."date")`) {
		t.Errorf("group-internal ORDER BY does not resolve s.date against rs:\n%s", sqlSort)
	}
}

// TestBuildSubjectCountValRejectsInjection verifies the person_character /
// character_person subject-count threshold is validated before interpolation.
func TestBuildSubjectCountValRejectsInjection(t *testing.T) {
	cfg := &config.Config{
		Target: "person",
		Limit:  10,
		Output: &config.Output{Format: "table"},
		Filters: []config.Filter{
			{PersonCharacter: &config.PersonCharacterFilter{
				Mode: "any", SubjectMode: "count",
				SubjectCountOp: "gte", SubjectCountVal: "1) OR 1=1 --",
				SubjectConditions: []config.Filter{
					{Field: &config.FieldFilter{Field: "name", Operator: "contains", Value: "test"}},
				},
			}},
		},
	}
	b := NewSQLBuilder(cfg, "/tmp/data")
	if _, err := b.Build(); err == nil {
		t.Fatal("expected error for injected subject_count_val, got none")
	}
}
