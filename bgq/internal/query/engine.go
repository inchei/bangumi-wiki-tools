package query

import (
	"bytes"
	"context"
	"encoding/csv"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"strings"
	"time"

	"github.com/inchei/bangumi-query/internal/config"
)

// DuckDBPath is the path to the DuckDB CLI binary.
var DuckDBPath = "duckdb"

// execSem limits the number of concurrent DuckDB subprocesses to protect the
// server from unbounded concurrency (each query spawns a heavy DuckDB CLI
// process against a multi-GB database).
var execSem = make(chan struct{}, 4)

// SetDuckDBPath allows setting the DuckDB binary path.
func SetDuckDBPath(path string) {
	DuckDBPath = path
}

// GetDuckDBPath returns the current DuckDB path.
func GetDuckDBPath() string {
	return DuckDBPath
}

// QueryResult holds the results of a query execution.
type QueryResult struct {
	Columns   []string      `json:"columns"`
	Rows      [][]string    `json:"rows"`
	TotalRows int           `json:"total_rows"`
	Duration  time.Duration `json:"duration"`
	SQL       string        `json:"sql"`
}

// Engine executes queries via DuckDB CLI.
type Engine struct {
	dbPath  string // persistent database path (empty = in-memory JSON reading)
	dataDir string
}

// NewEngine creates a new query engine.
func NewEngine(dbPath, dataDir string) *Engine {
	return &Engine{
		dbPath:  dbPath,
		dataDir: dataDir,
	}
}

// Execute runs a query config and returns results.
func (e *Engine) Execute(ctx context.Context, cfg *config.Config) (*QueryResult, error) {
	start := time.Now()

	builder := NewSQLBuilder(cfg, e.dataDir)
	sql, err := builder.Build()
	if err != nil {
		return nil, fmt.Errorf("生成SQL失败: %w", err)
	}

	result, err := e.executeSQL(ctx, sql)
	if err != nil {
		return nil, err
	}

	result.Duration = time.Since(start)
	result.SQL = sql
	return result, nil
}

// ExecuteRaw runs a raw SQL string directly and returns results.
func (e *Engine) ExecuteRaw(ctx context.Context, sql string) (*QueryResult, error) {
	return e.executeSQL(ctx, sql)
}

const lockdownPrefix = "SET enable_external_access=false;\n"

func (e *Engine) applyLockdown(sql string) string {
	if e.dbPath != "" {
		return lockdownPrefix + sql
	}
	return sql
}

// executeSQL runs a SQL query via DuckDB CLI and returns parsed results.
func (e *Engine) executeSQL(ctx context.Context, sql string) (*QueryResult, error) {
	// Validate DuckDB binary exists
	if _, err := os.Stat(DuckDBPath); os.IsNotExist(err) {
		return nil, fmt.Errorf("DuckDB 可执行文件不存在: %s\n请设置 DUCKDB_PATH 环境变量或确保 duckdb 在 PATH 中", DuckDBPath)
	}

	sql = e.applyLockdown(sql)

	// Write SQL to temp file (avoids shell escaping issues)
	tmpFile, err := os.CreateTemp("", "bgq-query-*.sql")
	if err != nil {
		return nil, fmt.Errorf("创建临时SQL文件失败: %w", err)
	}
	tmpPath := tmpFile.Name()
	defer func() { _ = os.Remove(tmpPath) }()

	if _, err := tmpFile.WriteString(sql); err != nil {
		_ = tmpFile.Close()
		return nil, fmt.Errorf("写入SQL文件失败: %w", err)
	}
	_ = tmpFile.Close()

	// Build DuckDB CLI command — use CSV mode (preserves column order, handles empty results)
	args := []string{"-csv", "-f", tmpPath}

	// If a persistent database exists, use it in read-only mode so a query can
	// never modify the underlying database file.
	if e.dbPath != "" {
		args = append([]string{"-readonly", e.dbPath}, args...)
	}

	var stderr bytes.Buffer
	cmd := exec.CommandContext(ctx, DuckDBPath, args...)
	cmd.Stderr = &stderr

	// Acquire a concurrency slot, aborting promptly if the context is cancelled.
	select {
	case execSem <- struct{}{}:
		defer func() { <-execSem }()
	case <-ctx.Done():
		return nil, ctx.Err()
	}

	output, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("DuckDB查询失败: %w\nStderr: %s\nSQL:\n%s",
			err, stderr.String(), sql)
	}

	// Empty output with stderr = real error; empty output without stderr = empty result set
	if len(output) == 0 {
		if stderr.Len() > 0 {
			return nil, fmt.Errorf("DuckDB 查询失败\nStderr: %s\nSQL:\n%s",
				stderr.String(), sql)
		}
		return &QueryResult{Columns: []string{}, Rows: [][]string{}, TotalRows: 0}, nil
	}

	return parseDuckDBCSV(output)
}

// parseDuckDBCSV parses CSV output from DuckDB (preserves column order).
func parseDuckDBCSV(data []byte) (*QueryResult, error) {
	r := csv.NewReader(bytes.NewReader(data))
	records, err := r.ReadAll()
	if err != nil {
		return nil, fmt.Errorf("解析DuckDB CSV输出失败: %w\n原始输出: %s", err, string(data[:min(len(data), 500)]))
	}

	if len(records) == 0 {
		return &QueryResult{Columns: []string{}, Rows: [][]string{}, TotalRows: 0}, nil
	}

	// First row = header
	columns := records[0]
	rows := records[1:]

	return &QueryResult{
		Columns:   columns,
		Rows:      rows,
		TotalRows: len(rows),
	}, nil
}

// WriteCSVTo writes CSV output to w (without BOM).
func (r *QueryResult) WriteCSVTo(w io.Writer) error {
	cw := csv.NewWriter(w)
	if err := cw.Write(r.Columns); err != nil {
		return fmt.Errorf("写入CSV表头失败: %w", err)
	}
	for _, row := range r.Rows {
		if err := cw.Write(row); err != nil {
			return fmt.Errorf("写入CSV行失败: %w", err)
		}
	}
	cw.Flush()
	return cw.Error()
}

// WriteCSV writes the query results to a CSV file (with BOM for Excel).
func (r *QueryResult) WriteCSV(path string) error {
	f, err := os.Create(path)
	if err != nil {
		return fmt.Errorf("创建CSV文件失败: %w", err)
	}
	defer func() { _ = f.Close() }()
	_, _ = f.Write([]byte{0xEF, 0xBB, 0xBF})
	return r.WriteCSVTo(f)
}

// WriteJSONTo writes JSON output to w.
func (r *QueryResult) WriteJSONTo(w io.Writer) error {
	var objs []map[string]string
	for _, row := range r.Rows {
		obj := make(map[string]string)
		for i, col := range r.Columns {
			obj[col] = row[i]
		}
		objs = append(objs, obj)
	}
	enc := json.NewEncoder(w)
	enc.SetIndent("", "  ")
	return enc.Encode(objs)
}

// WriteJSON writes the query results to a JSON file.
func (r *QueryResult) WriteJSON(path string) error {
	f, err := os.Create(path)
	if err != nil {
		return fmt.Errorf("创建JSON文件失败: %w", err)
	}
	defer func() { _ = f.Close() }()
	return r.WriteJSONTo(f)
}

// ExecuteDuckDBSQL executes raw SQL against a DuckDB database (for ingest).
func ExecuteDuckDBSQL(ctx context.Context, dbPath, sql string) error {
	tmpFile, err := os.CreateTemp("", "bgq-ingest-*.sql")
	if err != nil {
		return fmt.Errorf("创建临时SQL文件失败: %w", err)
	}
	defer func() { _ = os.Remove(tmpFile.Name()) }()

	if _, err := tmpFile.WriteString(sql); err != nil {
		_ = tmpFile.Close()
		return fmt.Errorf("写入SQL文件失败: %w", err)
	}
	_ = tmpFile.Close()

	cmd := exec.CommandContext(ctx, DuckDBPath, dbPath, "-f", tmpFile.Name())
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	return cmd.Run()
}

// FormatTable returns a formatted table string (for terminal display).
func (r *QueryResult) FormatTable(maxRows int) string {
	if len(r.Rows) == 0 {
		return "没有找到符合条件的条目。\n"
	}

	var sb strings.Builder

	// Calculate column widths
	widths := make([]int, len(r.Columns))
	for i, col := range r.Columns {
		widths[i] = len(col)
	}
	for _, row := range r.Rows {
		for i, val := range row {
			if len(val) > widths[i] {
				widths[i] = len(val)
			}
		}
		// Clamp column width
		for i := range widths {
			if widths[i] > 80 {
				widths[i] = 80
			}
		}
	}

	// Header
	for i, col := range r.Columns {
		fmt.Fprintf(&sb, "%-*s", widths[i]+2, col)
	}
	sb.WriteString("\n")

	// Separator
	for _, w := range widths {
		sb.WriteString(strings.Repeat("-", w+2))
	}
	sb.WriteString("\n")

	// Rows
	limit := len(r.Rows)
	if maxRows > 0 && limit > maxRows {
		limit = maxRows
	}
	for _, row := range r.Rows[:limit] {
		for i, val := range row {
			display := val
			if len(display) > 80 {
				display = display[:77] + "..."
			}
			fmt.Fprintf(&sb, "%-*s", widths[i]+2, display)
		}
		sb.WriteString("\n")
	}

	if maxRows > 0 && len(r.Rows) > maxRows {
		fmt.Fprintf(&sb, "... 还有 %d 行未显示\n", len(r.Rows)-maxRows)
	}

	fmt.Fprintf(&sb, "\n共 %d 行, 耗时 %v\n", r.TotalRows, r.Duration.Round(time.Millisecond))
	return sb.String()
}
