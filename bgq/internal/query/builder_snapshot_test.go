package query

import (
	"context"
	"flag"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"testing"

	"github.com/inchei/bangumi-query/internal/config"
)

var update = flag.Bool("update", false, "update golden files")
var execute = flag.Bool("execute", false, "also execute SQL against DuckDB")

// testDBPath is a persistent DuckDB database for db-mode tests, built via bgq ingest in TestMain.
var testDBPath string

func TestMain(m *testing.M) {
	flag.Parse()
	if *execute {
		// Build bgq ingest binary
		_, filename, _, _ := runtime.Caller(0)
		repoRoot := filepath.Join(filepath.Dir(filename), "..", "..", "..")
		bgqDir := filepath.Join(repoRoot, "bgq")
		ingestBin := filepath.Join(os.TempDir(), "bgq-ingest-test")
		cmd := exec.CommandContext(context.Background(), "go", "build", "-o", ingestBin, "./cmd/bgq/")
		cmd.Dir = bgqDir
		if out, err := cmd.CombinedOutput(); err != nil {
			fmt.Fprintf(os.Stderr, "Failed to build bgq ingest: %v\nOutput: %s\n", err, string(out))
			os.Exit(1)
		}

		// Create test database
		testDBPath = filepath.Join(os.TempDir(), "bgq-test-"+strconv.Itoa(os.Getpid())+".db")
		archiveDir := testExecuteDataDir()
		cmd = exec.CommandContext(context.Background(), ingestBin, "ingest", "--db", testDBPath, "--data-dir", archiveDir)
		if out, err := cmd.CombinedOutput(); err != nil {
			_ = os.Remove(testDBPath)
			fmt.Fprintf(os.Stderr, "Failed to create test database: %v\nOutput: %s\n", err, string(out))
			os.Exit(1)
		}
	}
	code := m.Run()
	if testDBPath != "" {
		_ = os.Remove(testDBPath)
	}
	os.Exit(code)
}

// inClauseRe matches IN (val1, val2, ...) clauses.
var inClauseRe = regexp.MustCompile(`IN \(([^)]+)\)`)

// normalizeSQL sorts values in IN clauses to make output deterministic.
func normalizeSQL(sql string) string {
	return inClauseRe.ReplaceAllStringFunc(sql, func(match string) string {
		inner := match[4 : len(match)-1] // strip "IN (" and ")"
		parts := strings.Split(inner, ", ")
		var nums []int
		for _, p := range parts {
			n, err := strconv.Atoi(strings.TrimSpace(p))
			if err != nil {
				return match // not numeric, leave as-is
			}
			nums = append(nums, n)
		}
		sort.Ints(nums)
		strs := make([]string, len(nums))
		for i, n := range nums {
			strs[i] = strconv.Itoa(n)
		}
		return "IN (" + strings.Join(strs, ", ") + ")"
	})
}

// generateAllSQL returns all valid target × filter × mode combinations as name→SQL pairs.
func generateAllSQL() map[string]string {
	type combo struct {
		filterName string
		targets    []string
	}
	modes := []string{"any", "all", "none", "count"}
	combos := []combo{
		{"staff", []string{"subject", "person"}},
		{"staff_multi", []string{"subject", "person"}},
		{"character", []string{"subject", "character"}},
		{"relation", []string{"subject"}},
		{"person_relation", []string{"person"}},
		{"character_relation", []string{"character"}},
		{"person_character", []string{"person"}},
		{"character_person", []string{"character"}},
	}

	results := make(map[string]string)

	for _, c := range combos {
		for _, target := range c.targets {
			for _, mode := range modes {
				var f config.Filter
				switch c.filterName {
				case "staff":
					f = config.Filter{Staff: &config.StaffFilter{
						Position: "原作", Mode: mode, CountOp: "gte", CountVal: 1,
						Conditions: []config.Filter{{Field: &config.FieldFilter{Field: "name", Operator: "contains", Value: "test"}}},
					}}
				case "staff_multi":
					f = config.Filter{Staff: &config.StaffFilter{
						Positions: []string{"原作", "脚本"}, Mode: mode, CountOp: "gte", CountVal: 1,
						Conditions: []config.Filter{{Field: &config.FieldFilter{Field: "name", Operator: "contains", Value: "test"}}},
					}}
				case "character":
					f = config.Filter{Character: &config.CharacterFilter{
						Type: "主角", Mode: mode, CountOp: "gte", CountVal: 1,
						Conditions: []config.Filter{{Field: &config.FieldFilter{Field: "name", Operator: "contains", Value: "test"}}},
					}}
				case "relation":
					f = config.Filter{Relation: &config.RelationFilter{
						Type: "单行本", Mode: mode, CountOp: "gte", CountVal: 1,
						Conditions: []config.Filter{{Field: &config.FieldFilter{Field: "score", Operator: "gt", Value: "8"}}},
					}}
				case "person_relation":
					f = config.Filter{PersonRelation: &config.PersonRelationFilter{Type: "同事", Mode: mode, CountOp: "gte", CountVal: 1}}
				case "character_relation":
					f = config.Filter{CharacterRelation: &config.CharacterRelationFilter{Type: "朋友", Mode: mode, CountOp: "gte", CountVal: 1}}
				case "person_character":
					f = config.Filter{PersonCharacter: &config.PersonCharacterFilter{
						Type: "CV", Mode: mode, CountOp: "gte", CountVal: 1,
						SubjectConditions: []config.Filter{{Field: &config.FieldFilter{Field: "score", Operator: "gt", Value: "8"}}},
					}}
				case "character_person":
					f = config.Filter{CharacterPerson: &config.CharacterPersonFilter{
						Type: "CV", Mode: mode, CountOp: "gte", CountVal: 1,
						SubjectConditions: []config.Filter{{Field: &config.FieldFilter{Field: "score", Operator: "gt", Value: "8"}}},
					}}
				}
				name := fmt.Sprintf("%s_%s_%s", c.filterName, target, mode)
				cfg := &config.Config{
					DataDir: testDataDir(), Limit: 10, Target: target,
					Output:  &config.Output{Format: "table", Columns: []string{"id", "name"}},
					Filters: []config.Filter{f},
				}
				sql, err := NewSQLBuilder(cfg, cfg.DataDir).Build()
				if err != nil {
					results[name] = "ERROR: " + err.Error()
				} else {
					results[name] = sql
				}
			}
		}
	}

	// Three-way: mode × subjectMode
	subjectModes := []string{"any", "all", "count"}
	threeWay := []struct {
		name   string
		target string
		make   func(mode, subjMode string) config.Filter
	}{
		{"person_character", "person", func(mode, subjMode string) config.Filter {
			return config.Filter{PersonCharacter: &config.PersonCharacterFilter{
				Type: "CV", Mode: mode, CountOp: "gte", CountVal: 1,
				SubjectMode: subjMode, SubjectCountOp: "gte", SubjectCountVal: 1,
				SubjectConditions: []config.Filter{{Field: &config.FieldFilter{Field: "score", Operator: "gt", Value: "8"}}},
			}}
		}},
		{"character_person", "character", func(mode, subjMode string) config.Filter {
			return config.Filter{CharacterPerson: &config.CharacterPersonFilter{
				Type: "CV", Mode: mode, CountOp: "gte", CountVal: 1,
				SubjectMode: subjMode, SubjectCountOp: "gte", SubjectCountVal: 1,
				SubjectConditions: []config.Filter{{Field: &config.FieldFilter{Field: "score", Operator: "gt", Value: "8"}}},
			}}
		}},
	}
	for _, tw := range threeWay {
		for _, mode := range modes {
			for _, subjMode := range subjectModes {
				name := fmt.Sprintf("%s_%s_%s_subj%s", tw.name, tw.target, mode, subjMode)
				f := tw.make(mode, subjMode)
				cfg := &config.Config{
					DataDir: testDataDir(), Limit: 10, Target: tw.target,
					Output:  &config.Output{Format: "table", Columns: []string{"id", "name"}},
					Filters: []config.Filter{f},
				}
				sql, err := NewSQLBuilder(cfg, cfg.DataDir).Build()
				if err != nil {
					results[name] = "ERROR: " + err.Error()
				} else {
					results[name] = sql
				}
			}
		}
	}

	// Nested entity conditions must target the real entity columns
	// (summary/collects/comments) and the correct alias (the related entity for
	// person_relation/character_relation), not fall back to infobox keys.
	nestedFieldTests := []struct {
		name   string
		target string
		filter config.Filter
	}{
		{"nested_staff_person_collects", "subject", config.Filter{Staff: &config.StaffFilter{
			Position: "导演", Mode: "any",
			Conditions: []config.Filter{{Field: &config.FieldFilter{Field: "collects", Operator: "gt", Value: 100}}},
		}}},
		{"nested_staff_person_summary", "subject", config.Filter{Staff: &config.StaffFilter{
			Position: "导演", Mode: "any",
			Conditions: []config.Filter{{Field: &config.FieldFilter{Field: "summary", Operator: "contains", Value: "test"}}},
		}}},
		{"nested_person_character_summary", "person", config.Filter{PersonCharacter: &config.PersonCharacterFilter{
			Type: "CV", Mode: "any",
			Conditions: []config.Filter{{Field: &config.FieldFilter{Field: "summary", Operator: "contains", Value: "test"}}},
		}}},
		{"nested_subject_cast_character_summary", "subject", config.Filter{SubjectCast: &config.SubjectCastFilter{
			CharacterConditions: []config.Filter{{Field: &config.FieldFilter{Field: "summary", Operator: "contains", Value: "test"}}},
		}}},
		{"nested_person_relation_name", "person", config.Filter{PersonRelation: &config.PersonRelationFilter{
			Type: "同事", Mode: "any",
			Conditions: []config.Filter{{Field: &config.FieldFilter{Field: "name", Operator: "contains", Value: "test"}}},
		}}},
		{"nested_character_relation_name", "character", config.Filter{CharacterRelation: &config.CharacterRelationFilter{
			Type: "朋友", Mode: "any",
			Conditions: []config.Filter{{Field: &config.FieldFilter{Field: "name", Operator: "contains", Value: "test"}}},
		}}},
	}
	for _, nt := range nestedFieldTests {
		cfg := &config.Config{
			DataDir: testDataDir(), Limit: 10, Target: nt.target,
			Output:  &config.Output{Format: "table", Columns: []string{"id", "name"}},
			Filters: []config.Filter{nt.filter},
		}
		sql, err := NewSQLBuilder(cfg, cfg.DataDir).Build()
		if err != nil {
			results[nt.name] = "ERROR: " + err.Error()
		} else {
			results[nt.name] = sql
		}
	}

	// Simple filters
	simpleFilters := []struct {
		name    string
		targets []string
		filter  config.Filter
	}{
		{"type", []string{"subject", "person", "character"}, config.Filter{Type: &config.TypeFilter{Value: 1}}},
		{"field", []string{"subject", "person", "character", "episode"}, config.Filter{Field: &config.FieldFilter{Field: "name", Operator: "contains", Value: "test"}}},
		{"tag", []string{"subject"}, config.Filter{Tag: &config.TagFilter{Operator: "contains", Value: "test"}}},
		{"meta_tag", []string{"subject"}, config.Filter{MetaTag: &config.TagFilter{Operator: "contains", Value: "TV"}}},
		{"global", []string{"subject", "person", "character"}, config.Filter{Global: &config.GlobalFilter{Operator: "contains", Value: "test"}}},
		{"episode", []string{"subject"}, config.Filter{Episode: &config.EpisodeFilter{
			Mode: "any", Logic: &config.LogicFilter{Op: "and", Items: []config.Filter{
				{Field: &config.FieldFilter{Field: "name", Operator: "contains", Value: "test"}},
			}},
		}}},
		{"episode_all", []string{"subject"}, config.Filter{Episode: &config.EpisodeFilter{
			Mode: "all", Logic: &config.LogicFilter{Op: "and", Items: []config.Filter{
				{Field: &config.FieldFilter{Field: "name", Operator: "contains", Value: "test"}},
			}},
		}}},
		{"episode_count", []string{"subject"}, config.Filter{Episode: &config.EpisodeFilter{
			Mode: "count", CountOp: "gte", CountVal: 1, Logic: &config.LogicFilter{Op: "and", Items: []config.Filter{
				{Field: &config.FieldFilter{Field: "name", Operator: "contains", Value: "test"}},
			}},
		}}},
	}
	for _, sf := range simpleFilters {
		for _, target := range sf.targets {
			name := fmt.Sprintf("%s_%s", sf.name, target)
			cfg := &config.Config{
				DataDir: testDataDir(), Limit: 10, Target: target,
				Output:  &config.Output{Format: "table", Columns: []string{"id", "name"}},
				Filters: []config.Filter{sf.filter},
			}
			sql, err := NewSQLBuilder(cfg, cfg.DataDir).Build()
			if err != nil {
				results[name] = "ERROR: " + err.Error()
			} else {
				results[name] = sql
			}
		}
	}

	// Special cases
	specials := []struct {
		name   string
		filter config.Filter
	}{
		{"staff_appear_eps", config.Filter{Staff: &config.StaffFilter{
			Position: "原作", Mode: "any",
			Conditions: []config.Filter{
				{Field: &config.FieldFilter{Field: "appear_eps", Operator: "contains", Value: "1,2,3"}},
			},
		}}},
		{"logic_or", config.Filter{Logic: &config.LogicFilter{Op: "or", Items: []config.Filter{
			{Field: &config.FieldFilter{Field: "score", Operator: "gt", Value: "8"}},
			{Tag: &config.TagFilter{Operator: "contains", Value: "test"}},
		}}}},
		{"tag_negate", config.Filter{Tag: &config.TagFilter{Operator: "contains", Value: "test", Negate: true}}},
		{"meta_tag_negate", config.Filter{MetaTag: &config.TagFilter{Operator: "contains", Value: "TV", Negate: true}}},
		{"field_ref", config.Filter{Field: &config.FieldFilter{Field: "发售日", Operator: "before", Value: "$连载开始"}}},
		{"field_ref_mod", config.Filter{Field: &config.FieldFilter{Field: "发售日", Operator: "after", Value: "$连载开始+300"}}},
	}
	for _, sp := range specials {
		cfg := &config.Config{
			DataDir: testDataDir(), Limit: 10,
			Output:  &config.Output{Format: "table", Columns: []string{"id", "name"}},
			Filters: []config.Filter{sp.filter},
		}
		sql, err := NewSQLBuilder(cfg, cfg.DataDir).Build()
		if err != nil {
			results[sp.name] = "ERROR: " + err.Error()
		} else {
			results[sp.name] = sql
		}
	}

	// Relation output columns
	relOutputFilters := []struct {
		name    string
		columns []string
		filter  config.Filter
	}{
		{"relation_output", []string{"id", "name", "单行本.name", "单行本.发售日"}, config.Filter{Relation: &config.RelationFilter{
			Type: "单行本", Mode: "any",
			Conditions: []config.Filter{{Field: &config.FieldFilter{Field: "name", Operator: "contains", Value: "1"}}},
		}}},
		{"relation_output_count", []string{"id", "name", "单行本.count"}, config.Filter{Relation: &config.RelationFilter{
			Type: "单行本", Mode: "any",
			Conditions: []config.Filter{{Field: &config.FieldFilter{Field: "name", Operator: "contains", Value: "1"}}},
		}}},
		{"staff_output", []string{"id", "name", "原作.name", "原作.count"}, config.Filter{Staff: &config.StaffFilter{
			Position: "原作", Mode: "any",
			Conditions: []config.Filter{{Field: &config.FieldFilter{Field: "name", Operator: "contains", Value: "test"}}},
		}}},
		{"character_output", []string{"id", "name", "主角.name", "主角.count"}, config.Filter{Character: &config.CharacterFilter{
			Type: "主角", Mode: "any",
			Conditions: []config.Filter{{Field: &config.FieldFilter{Field: "name", Operator: "contains", Value: "test"}}},
		}}},
		{"episode_output", []string{"id", "name", "episode.name", "episode.count"}, config.Filter{Episode: &config.EpisodeFilter{
			Mode: "any", Logic: &config.LogicFilter{Op: "and", Items: []config.Filter{
				{Field: &config.FieldFilter{Field: "name", Operator: "contains", Value: "test"}},
			}},
		}}},
	}
	for _, ro := range relOutputFilters {
		cfg := &config.Config{
			DataDir: testDataDir(), Limit: 10,
			Output:  &config.Output{Format: "table", Columns: ro.columns},
			Filters: []config.Filter{ro.filter},
		}
		sql, err := NewSQLBuilder(cfg, cfg.DataDir).Build()
		if err != nil {
			results[ro.name] = "ERROR: " + err.Error()
		} else {
			results[ro.name] = sql
		}
	}

	// Person output columns (person target)
	personOutTests := []struct {
		name    string
		columns []string
		filter  config.Filter
	}{
		{"person_relation_output", []string{"person_id", "name", "同事.name", "同事.count"}, config.Filter{PersonRelation: &config.PersonRelationFilter{
			Type: "同事", Mode: "any",
		}}},
		{"person_staff_output", []string{"person_id", "name", "系列构成.name"}, config.Filter{Staff: &config.StaffFilter{
			Position: "系列构成", Mode: "any",
			Conditions: []config.Filter{{Field: &config.FieldFilter{Field: "rank", Operator: "lt", Value: "1500"}}},
		}}},
		{"person_character_output", []string{"person_id", "name", "CV.name"}, config.Filter{PersonCharacter: &config.PersonCharacterFilter{
			Type: "CV", Mode: "any",
		}}},
		{"person_character_subject_output", []string{"person_id", "name", "CV.s.name"}, config.Filter{PersonCharacter: &config.PersonCharacterFilter{
			Type: "CV", Mode: "any",
			Conditions:        []config.Filter{{Field: &config.FieldFilter{Field: "name", Operator: "contains", Value: "アル"}}},
			SubjectConditions: []config.Filter{{Field: &config.FieldFilter{Field: "rank", Operator: "lt", Value: "5000"}}},
		}}},
		{"person_character_group_subject_fields", []string{"person_id", "name", "CV.{id|name|s.id|s.name}"}, config.Filter{PersonCharacter: &config.PersonCharacterFilter{
			Type: "CV", Mode: "any",
		}}},
		{"person_staff_group_json", []string{"person_id", "name", "系列构成.{name|rank|id}"}, config.Filter{Staff: &config.StaffFilter{
			Position: "系列构成", Mode: "any",
			Conditions: []config.Filter{{Field: &config.FieldFilter{Field: "rank", Operator: "lt", Value: "1500"}}},
		}}},
	}
	for _, pt := range personOutTests {
		cfg := &config.Config{
			DataDir: testDataDir(), Limit: 10, Target: "person",
			Output:  &config.Output{Format: "table", Columns: pt.columns},
			Filters: []config.Filter{pt.filter},
		}
		sql, err := NewSQLBuilder(cfg, cfg.DataDir).Build()
		if err != nil {
			results[pt.name] = "ERROR: " + err.Error()
		} else {
			results[pt.name] = sql
		}
	}

	// Character output columns (character target)
	charOutTests := []struct {
		name    string
		columns []string
		filter  config.Filter
	}{
		{"character_relation_output", []string{"character_id", "name", "朋友.name", "朋友.count"}, config.Filter{CharacterRelation: &config.CharacterRelationFilter{
			Type: "朋友", Mode: "any",
		}}},
		{"character_person_output", []string{"character_id", "name", "CV.name"}, config.Filter{CharacterPerson: &config.CharacterPersonFilter{
			Type: "CV", Mode: "any",
		}}},
		{"character_person_subject_output", []string{"character_id", "name", "CV.s.name"}, config.Filter{CharacterPerson: &config.CharacterPersonFilter{
			Type: "CV", Mode: "any",
			Conditions:        []config.Filter{{Field: &config.FieldFilter{Field: "name", Operator: "contains", Value: "水树"}}},
			SubjectConditions: []config.Filter{{Field: &config.FieldFilter{Field: "rank", Operator: "lt", Value: "5000"}}},
		}}},
		{"character_person_group_subject_fields", []string{"character_id", "name", "CV.{id|name|s.id|s.name}"}, config.Filter{CharacterPerson: &config.CharacterPersonFilter{
			Type: "CV", Mode: "any",
		}}},
	}
	for _, ct := range charOutTests {
		cfg := &config.Config{
			DataDir: testDataDir(), Limit: 10, Target: "character",
			Output:  &config.Output{Format: "table", Columns: ct.columns},
			Filters: []config.Filter{ct.filter},
		}
		sql, err := NewSQLBuilder(cfg, cfg.DataDir).Build()
		if err != nil {
			results[ct.name] = "ERROR: " + err.Error()
		} else {
			results[ct.name] = sql
		}
	}

	// Sort by association output column (e.g. 导演.生日 desc)
	assocSortTests := []struct {
		name   string
		target string
		cols   []string
		filter config.Filter
		sort   []config.SortRule
	}{
		{"sort_assoc_staff_date", "subject",
			[]string{"id", "name", "导演.生日"},
			config.Filter{Staff: &config.StaffFilter{Position: "导演", Mode: "any"}},
			[]config.SortRule{{Field: "导演.生日", Direction: "desc"}}},
		{"sort_assoc_staff_count", "subject",
			[]string{"id", "name", "原作.count"},
			config.Filter{Staff: &config.StaffFilter{Position: "原作", Mode: "any"}},
			[]config.SortRule{{Field: "原作.count", Direction: "desc"}}},
		{"sort_assoc_group_json", "subject",
			[]string{"id", "name", "导演.{name|生日|id}"},
			config.Filter{Staff: &config.StaffFilter{Position: "导演", Mode: "any"}},
			[]config.SortRule{{Field: "导演.生日", Direction: "desc"}}},
		{"sort_assoc_group_subject_field", "person",
			[]string{"person_id", "name", "CV.{name|s.date}"},
			config.Filter{PersonCharacter: &config.PersonCharacterFilter{Type: "CV", Mode: "any"}},
			[]config.SortRule{{Field: "CV.s.date", Direction: "desc"}}},
		// Regression: sorting by an association with neither a matching filter
		// nor an association output column must still load the junction CTE.
		{"sort_assoc_no_filter_no_column", "subject",
			[]string{"id", "name"},
			config.Filter{Type: &config.TypeFilter{Value: 2}},
			[]config.SortRule{{Field: "导演.生日", Direction: "desc"}}},
	}
	for _, st := range assocSortTests {
		cfg := &config.Config{
			DataDir: testDataDir(), Limit: 10, Target: st.target,
			Output:  &config.Output{Format: "table", Columns: st.cols},
			Filters: []config.Filter{st.filter},
			Sort:    st.sort,
		}
		sql, err := NewSQLBuilder(cfg, cfg.DataDir).Build()
		if err != nil {
			results[st.name] = "ERROR: " + err.Error()
		} else {
			results[st.name] = sql
		}
	}

	return results
}

func TestAllCombinations(t *testing.T) {
	results := generateAllSQL()

	// Build stable output (sorted by name), normalize paths
	var names []string
	for name := range results {
		names = append(names, name)
	}
	sort.Strings(names)
	var lines []string
	dataDir := testDataDir()
	for _, name := range names {
		sql := normalizeSQL(results[name])
		sql = strings.ReplaceAll(sql, dataDir, "$DATA_DIR")
		lines = append(lines, name+"\t"+sql)
	}
	output := strings.Join(lines, "\n") + "\n"

	golden := filepath.Join("testdata", "all_combinations.golden")

	if *update {
		_ = os.MkdirAll("testdata", 0755)
		if err := os.WriteFile(golden, []byte(output), 0644); err != nil {
			t.Fatalf("Failed to write golden file: %v", err)
		}
		t.Logf("Updated golden file: %s (%d combinations)", golden, len(results))
		return
	}

	expected, err := os.ReadFile(golden)
	if err != nil {
		t.Fatalf("Golden file not found. Run with -update to create it.\nPath: %s\nError: %v", golden, err)
	}

	if output != string(expected) {
		t.Fatalf("SQL output changed. Run with -update to accept.\nGolden: %s", golden)
	}

	// Optional: also execute against DuckDB
	if *execute {
		SetDuckDBPath(filepath.Join(testBinDir(), "duckdb"))
		executeDir := testExecuteDataDir()

		// data-dir mode (JSONLines → CTEs)
		engine := NewEngine("", executeDir)
		for name, sql := range results {
			if strings.HasPrefix(sql, "ERROR:") {
				continue
			}
			t.Run(name, func(t *testing.T) {
				testSQL := strings.ReplaceAll(sql, testDataDir(), executeDir)
				if _, err := engine.executeSQL(t.Context(), testSQL); err != nil {
					t.Fatalf("Execute failed:\nSQL: %s\nError: %v", testSQL, err)
				}
			})
		}

		// db mode (persistent database built by bgq ingest)
		engineDB := NewEngine(testDBPath, "")
		dbResults := generateAllSQLDB()
		for name, sql := range dbResults {
			if strings.HasPrefix(sql, "ERROR:") {
				continue
			}
			t.Run("db_"+name, func(t *testing.T) {
				if _, err := engineDB.executeSQL(t.Context(), sql); err != nil {
					t.Fatalf("Execute failed:\nSQL: %s\nError: %v", sql, err)
				}
			})
		}
	}
}

// generateAllSQLDB returns all filter × mode combinations in persistent database mode (no CTEs).
func generateAllSQLDB() map[string]string {
	type combo struct {
		filterName string
		targets    []string
	}
	modes := []string{"any", "all", "none", "count"}
	combos := []combo{
		{"staff", []string{"subject", "person"}},
		{"staff_multi", []string{"subject", "person"}},
		{"character", []string{"subject", "character"}},
		{"relation", []string{"subject"}},
		{"person_relation", []string{"person"}},
		{"character_relation", []string{"character"}},
		{"person_character", []string{"person"}},
		{"character_person", []string{"character"}},
	}

	makeCfg := func(target string, f config.Filter) *config.Config {
		return &config.Config{Database: "test", Limit: 10, Target: target,
			Output:  &config.Output{Format: "table", Columns: []string{"id", "name"}},
			Filters: []config.Filter{f},
		}
	}

	results := make(map[string]string)
	for _, c := range combos {
		for _, target := range c.targets {
			for _, mode := range modes {
				var f config.Filter
				switch c.filterName {
				case "staff":
					f = config.Filter{Staff: &config.StaffFilter{
						Position: "原作", Mode: mode, CountOp: "gte", CountVal: 1,
						Conditions: []config.Filter{{Field: &config.FieldFilter{Field: "name", Operator: "contains", Value: "test"}}},
					}}
				case "staff_multi":
					f = config.Filter{Staff: &config.StaffFilter{
						Positions: []string{"原作", "脚本"}, Mode: mode, CountOp: "gte", CountVal: 1,
						Conditions: []config.Filter{{Field: &config.FieldFilter{Field: "name", Operator: "contains", Value: "test"}}},
					}}
				case "character":
					f = config.Filter{Character: &config.CharacterFilter{
						Type: "主角", Mode: mode, CountOp: "gte", CountVal: 1,
						Conditions: []config.Filter{{Field: &config.FieldFilter{Field: "name", Operator: "contains", Value: "test"}}},
					}}
				case "relation":
					f = config.Filter{Relation: &config.RelationFilter{
						Type: "单行本", Mode: mode, CountOp: "gte", CountVal: 1,
						Conditions: []config.Filter{{Field: &config.FieldFilter{Field: "score", Operator: "gt", Value: "8"}}},
					}}
				case "person_relation":
					f = config.Filter{PersonRelation: &config.PersonRelationFilter{Type: "同事", Mode: mode, CountOp: "gte", CountVal: 1}}
				case "character_relation":
					f = config.Filter{CharacterRelation: &config.CharacterRelationFilter{Type: "朋友", Mode: mode, CountOp: "gte", CountVal: 1}}
				case "person_character":
					f = config.Filter{PersonCharacter: &config.PersonCharacterFilter{
						Type: "CV", Mode: mode, CountOp: "gte", CountVal: 1,
						SubjectConditions: []config.Filter{{Field: &config.FieldFilter{Field: "score", Operator: "gt", Value: "8"}}},
					}}
				case "character_person":
					f = config.Filter{CharacterPerson: &config.CharacterPersonFilter{
						Type: "CV", Mode: mode, CountOp: "gte", CountVal: 1,
						SubjectConditions: []config.Filter{{Field: &config.FieldFilter{Field: "score", Operator: "gt", Value: "8"}}},
					}}
				}
				name := fmt.Sprintf("%s_%s_%s", c.filterName, target, mode)
				cfg := makeCfg(target, f)
				sql, err := NewSQLBuilder(cfg, "").Build()
				if err != nil {
					results[name] = "ERROR: " + err.Error()
				} else {
					results[name] = sql
				}
			}
		}
	}

	subjectModes := []string{"any", "all", "count"}
	for _, mode := range modes {
		for _, subjMode := range subjectModes {
			for _, pair := range [][2]string{
				{"person_character_person", "person"},
				{"character_person_character", "character"},
			} {
				name := fmt.Sprintf("%s_%s_subj%s", pair[0], mode, subjMode)
				var f config.Filter
				if pair[0] == "person_character_person" {
					f = config.Filter{PersonCharacter: &config.PersonCharacterFilter{
						Type: "CV", Mode: mode, CountOp: "gte", CountVal: 1,
						SubjectMode: subjMode, SubjectCountOp: "gte", SubjectCountVal: 1,
						SubjectConditions: []config.Filter{{Field: &config.FieldFilter{Field: "score", Operator: "gt", Value: "8"}}},
					}}
				} else {
					f = config.Filter{CharacterPerson: &config.CharacterPersonFilter{
						Type: "CV", Mode: mode, CountOp: "gte", CountVal: 1,
						SubjectMode: subjMode, SubjectCountOp: "gte", SubjectCountVal: 1,
						SubjectConditions: []config.Filter{{Field: &config.FieldFilter{Field: "score", Operator: "gt", Value: "8"}}},
					}}
				}
				cfg := makeCfg(pair[1], f)
				sql, err := NewSQLBuilder(cfg, "").Build()
				if err != nil {
					results[name] = "ERROR: " + err.Error()
				} else {
					results[name] = sql
				}
			}
		}
	}

	simpleFilters := []struct {
		name    string
		targets []string
		filter  config.Filter
	}{
		{"type", []string{"subject", "person", "character"}, config.Filter{Type: &config.TypeFilter{Value: 1}}},
		{"field", []string{"subject", "person", "character", "episode"}, config.Filter{Field: &config.FieldFilter{Field: "name", Operator: "contains", Value: "test"}}},
		{"tag", []string{"subject"}, config.Filter{Tag: &config.TagFilter{Operator: "contains", Value: "test"}}},
		{"meta_tag", []string{"subject"}, config.Filter{MetaTag: &config.TagFilter{Operator: "contains", Value: "TV"}}},
		{"global", []string{"subject", "person", "character"}, config.Filter{Global: &config.GlobalFilter{Operator: "contains", Value: "test"}}},
		{"episode", []string{"subject"}, config.Filter{Episode: &config.EpisodeFilter{
			Mode: "any", Logic: &config.LogicFilter{Op: "and", Items: []config.Filter{
				{Field: &config.FieldFilter{Field: "name", Operator: "contains", Value: "test"}},
			}},
		}}},
	}
	for _, sf := range simpleFilters {
		for _, target := range sf.targets {
			cfg := makeCfg(target, sf.filter)
			sql, err := NewSQLBuilder(cfg, "").Build()
			name := fmt.Sprintf("%s_%s", sf.name, target)
			if err != nil {
				results[name] = "ERROR: " + err.Error()
			} else {
				results[name] = sql
			}
		}
	}

	specials := []struct {
		name   string
		filter config.Filter
	}{
		{"staff_appear_eps", config.Filter{Staff: &config.StaffFilter{
			Position: "原作", Mode: "any",
			Conditions: []config.Filter{
				{Field: &config.FieldFilter{Field: "appear_eps", Operator: "contains", Value: "1,2,3"}},
			},
		}}},
		{"logic_or", config.Filter{Logic: &config.LogicFilter{Op: "or", Items: []config.Filter{
			{Field: &config.FieldFilter{Field: "score", Operator: "gt", Value: "8"}},
			{Tag: &config.TagFilter{Operator: "contains", Value: "test"}},
		}}}},
		{"tag_negate", config.Filter{Tag: &config.TagFilter{Operator: "contains", Value: "test", Negate: true}}},
		{"meta_tag_negate", config.Filter{MetaTag: &config.TagFilter{Operator: "contains", Value: "TV", Negate: true}}},
	}
	for _, sp := range specials {
		cfg := makeCfg("subject", sp.filter)
		sql, err := NewSQLBuilder(cfg, "").Build()
		if err != nil {
			results[sp.name] = "ERROR: " + err.Error()
		} else {
			results[sp.name] = sql
		}
	}

	return results
}
