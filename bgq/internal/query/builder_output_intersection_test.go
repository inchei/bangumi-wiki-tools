package query

import (
	"encoding/json"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/inchei/bangumi-query/internal/config"
)

func TestStaffIntersectionOutput(t *testing.T) {
	for _, db := range []bool{false, true} {
		cfg := &config.Config{
			Filters: []config.Filter{{Field: &config.FieldFilter{Field: "id", Operator: "gt", Value: "0"}}},
			Output:  &config.Output{Columns: []string{"id", "{原作|导演}.{id|name}", "{原作|导演}.count"}, AssocLimit: 2},
			Limit:   5,
		}
		if db {
			cfg.Database = "test"
		}
		sql, err := NewSQLBuilder(cfg, testExecuteDataDir()).Build()
		if err != nil {
			t.Fatal(err)
		}
		if !db && (!strings.Contains(sql, "subject_persons AS (") || !strings.Contains(sql, "persons AS (")) {
			t.Fatalf("missing archive CTEs: %s", sql)
		}
		if !strings.Contains(sql, "sp2.person_id = sp1.person_id") || !strings.Contains(sql, `AS "{原作|导演}.{id|name}"`) {
			t.Fatalf("missing intersection output: %s", sql)
		}
		if *execute {
			SetDuckDBPath(filepath.Join(testBinDir(), "duckdb"))
			dbPath := ""
			if db {
				dbPath = testDBPath
			}
			result, err := NewEngine(dbPath, testExecuteDataDir()).executeSQL(t.Context(), sql)
			if err != nil {
				t.Fatal(err)
			}
			for _, row := range result.Rows {
				var people []struct {
					ID string `json:"id"`
				}
				if row[1] != "" && row[1] != "null" && row[1] != "NULL" {
					if err := json.Unmarshal([]byte(row[1]), &people); err != nil {
						t.Fatal(err)
					}
				}
				if len(people) > 2 {
					t.Fatalf("assoc_limit ignored: %v", row)
				}
			}
		}
	}
}

func TestStaffIntersectionOutputOnlySharedPeople(t *testing.T) {
	cfg := &config.Config{
		Database: "test",
		Filters:  []config.Filter{{Field: &config.FieldFilter{Field: "id", Operator: "eq", Value: "8"}}},
		Output:   &config.Output{Columns: []string{"{原作|导演}.{id|name}", "{原作|导演}.count"}, AssocLimit: 10},
	}
	sql, err := NewSQLBuilder(cfg, "").Build()
	if err != nil {
		t.Fatal(err)
	}
	if *execute {
		SetDuckDBPath(filepath.Join(testBinDir(), "duckdb"))
		fixture := `WITH subjects(id) AS (VALUES (8)),
subject_persons(subject_id, person_id, position) AS (VALUES
 (8, 185, 1), (8, 185, 2), (8, 185, 1),
 (8, 389, 1), (8, 390, 2), (8, 391, 1), (8, 391, 2)),
persons(person_id, name) AS (VALUES (185, 'A'), (389, 'B'), (390, 'C'), (391, 'D'))
`
		result, err := NewEngine("", "").executeSQL(t.Context(), fixture+sql)
		if err != nil {
			t.Fatal(err)
		}
		if len(result.Rows) != 1 {
			t.Fatalf("unexpected rows: %v", result.Rows)
		}
		var people []struct {
			ID string `json:"id"`
		}
		if err := json.Unmarshal([]byte(result.Rows[0][0]), &people); err != nil {
			t.Fatal(err)
		}
		var ids []string
		for _, person := range people {
			ids = append(ids, person.ID)
		}
		if !reflect.DeepEqual(ids, []string{"185", "391"}) || result.Rows[0][1] != "2" {
			t.Fatalf("unexpected shared people: %v", ids)
		}
	}
}
