package query

import (
	"bytes"
	"context"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

// testBinDir returns the absolute path to bgq/bin.
func testBinDir() string {
	_, filename, _, _ := runtime.Caller(0)
	return filepath.Join(filepath.Dir(filename), "..", "..", "bin")
}

func TestExecuteSimple(t *testing.T) {
	SetDuckDBPath(filepath.Join(testBinDir(), "duckdb"))

	// Test that DuckDB execution works via temp file
	result, err := executeSQLDirectly(context.Background(), "SELECT 1 AS test, 2 AS num;")
	if err != nil {
		t.Fatalf("executeSQLDirectly failed: %v", err)
	}
	t.Logf("Columns: %v", result.Columns)
	t.Logf("Rows: %v", result.Rows)
	if len(result.Rows) != 1 {
		t.Errorf("Expected 1 row, got %d", len(result.Rows))
	}
}

func TestExecuteWithJSON(t *testing.T) {
	SetDuckDBPath(filepath.Join(testBinDir(), "duckdb"))

	archiveDir := testDataDir()
	engine := NewEngine("", archiveDir)
	// Use direct executeSQL
	sql := "WITH subjects AS (SELECT * FROM read_json_auto('" + filepath.Join(archiveDir, "subject.jsonlines") + "', format='newline_delimited'))\n" +
		`SELECT s.id, s.name, s.score
FROM subjects s
WHERE s.type = 2 AND CAST(s.score AS DOUBLE) > 8.5
ORDER BY s.score DESC
LIMIT 3;`

	result, err := engine.executeSQL(context.Background(), sql)
	if err != nil {
		t.Fatalf("executeSQL failed: %v", err)
	}
	t.Logf("Got %d results", result.TotalRows)
	if result.TotalRows == 0 {
		t.Error("Expected results, got 0")
	}
}

// executeSQLDirectly calls executeSQL on a zero-value Engine (accessing unexported method via test in same package).
func executeSQLDirectly(ctx context.Context, sql string) (*QueryResult, error) {
	e := &Engine{}
	return e.executeSQL(ctx, sql)
}

func TestWriteJSONToEmptyResult(t *testing.T) {
	var buf bytes.Buffer
	r := &QueryResult{Columns: []string{"id"}, Rows: [][]string{}}
	if err := r.WriteJSONTo(&buf); err != nil {
		t.Fatalf("WriteJSONTo failed: %v", err)
	}
	if got := strings.TrimSpace(buf.String()); got != "[]" {
		t.Fatalf("empty result should encode as [], got %q", got)
	}
}
