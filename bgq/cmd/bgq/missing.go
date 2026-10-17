package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/inchei/bangumi-query/internal/model"
	"github.com/inchei/bangumi-query/internal/query"
)

const missingQueryTimeout = 5 * time.Minute

func findDefaultDB(candidates []string) string {
	for _, p := range candidates {
		if fi, err := os.Stat(p); err == nil && !fi.IsDir() {
			return p
		}
	}
	return ""
}

func cmdMissing(args []string) {
	if len(args) < 1 {
		printMissingUsage()
		os.Exit(1)
	}

	subcommand := args[0]
	switch subcommand {
	case "subjects":
		cmdMissingSubjects(args[1:])
	case "episodes":
		cmdMissingEpisodes(args[1:])
	default:
		fmt.Fprintf(os.Stderr, "未知子命令: %s\n", subcommand)
		printMissingUsage()
		os.Exit(1)
	}
}

func printMissingUsage() {
	fmt.Fprintln(os.Stderr, "用法: bgq missing subjects --type <条目类型> [--position <职位ID>] [--db <数据库>] <人名>")
	fmt.Fprintln(os.Stderr, "       bgq missing episodes [--db <数据库>] <人名>")
}

func cmdMissingSubjects(args []string) {
	fs := flag.NewFlagSet("missing subjects", flag.ExitOnError)
	dbPath := addMissingDBFlags(fs)
	var typeCode int
	fs.IntVar(&typeCode, "type", 0, "条目类型: 1(书籍) 2(动画) 3(音乐) 4(游戏) 6(三次元)")
	positionID := fs.Int("position", 0, "限制仅检查指定职位 ID（默认检查全部职位）")
	name := mustParseMissingNameArg(fs, args)

	if typeCode == 0 {
		fmt.Fprintln(os.Stderr, "需要 --type 参数: 1(书籍) 2(动画) 3(音乐) 4(游戏) 6(三次元)")
		os.Exit(1)
	}
	dbPathStr := mustResolveMissingDB(*dbPath)

	ctx, cancel := context.WithTimeout(context.Background(), missingQueryTimeout)
	defer cancel()
	runMissingSubjects(ctx, name, typeCode, *positionID, dbPathStr)
}

func cmdMissingEpisodes(args []string) {
	fs := flag.NewFlagSet("missing episodes", flag.ExitOnError)
	dbPath := addMissingDBFlags(fs)
	name := mustParseMissingNameArg(fs, args)

	dbPathStr := mustResolveMissingDB(*dbPath)

	ctx, cancel := context.WithTimeout(context.Background(), missingQueryTimeout)
	defer cancel()
	runMissingEpisodes(ctx, name, dbPathStr)
}

// addMissingDBFlags registers the common --db/--data-dir/-d flags shared by
// the missing subcommands and returns a pointer to the parsed db path.
func addMissingDBFlags(fs *flag.FlagSet) *string {
	var dbPath string
	var ignoredDataDir string
	fs.StringVar(&dbPath, "db", "", "数据库路径")
	fs.StringVar(&ignoredDataDir, "data-dir", "", "数据目录（兼容参数，missing 只使用已导入的数据库）")
	fs.StringVar(&ignoredDataDir, "d", "", "数据目录（兼容参数）")
	return &dbPath
}

// mustParseMissingNameArg parses flags and returns the required positional
// <人名> argument, exiting with usage on absence.
func mustParseMissingNameArg(fs *flag.FlagSet, args []string) string {
	_ = fs.Parse(args)
	posArgs := fs.Args()
	if len(posArgs) < 1 {
		printMissingUsage()
		os.Exit(1)
	}
	return posArgs[0]
}

// mustResolveMissingDB fills in the default bangumi.db, exiting with a usage
// error when no database can be found.
func mustResolveMissingDB(dbPath string) string {
	if dbPath == "" {
		dbPath = findDefaultDB([]string{"bangumi.db"})
	}
	if dbPath == "" {
		fmt.Fprintln(os.Stderr, "错误: 未找到 bangumi.db，请先运行 bgq ingest 或在当前目录放置 bangumi.db，或指定 --db 参数")
		os.Exit(1)
	}
	return dbPath
}

// narrowPositions returns all positions, or only the requested one when posID
// is set. Staff position IDs start at 1, so 0 means "no restriction".
func narrowPositions(typeCode int, all map[int]string, posID int) (map[int]string, error) {
	if posID == 0 {
		return all, nil
	}
	name, ok := all[posID]
	if !ok {
		return nil, fmt.Errorf("条目类型 %d 没有职位 ID %d", typeCode, posID)
	}
	return map[int]string{posID: name}, nil
}

func runMissingSubjects(ctx context.Context, name string, typeCode, positionID int, dbPath string) {
	allPositions := model.StaffPositions[typeCode]
	if len(allPositions) == 0 {
		fmt.Fprintf(os.Stderr, "条目类型 %d 没有职位定义\n", typeCode)
		os.Exit(1)
	}
	positions, err := narrowPositions(typeCode, allPositions, positionID)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}

	sql := buildCheckSQL(typeCode, name, positions, 0)
	engine := query.NewEngine(dbPath, "")
	result, err := engine.ExecuteRaw(ctx, sql)
	if err != nil {
		fmt.Fprintf(os.Stderr, "查询失败: %v\n", err)
		os.Exit(1)
	}

	if len(result.Rows) == 0 {
		fmt.Println("未发现缺失")
		return
	}

	fmt.Printf("共发现 %d 个可能缺失的条目:\n\n", len(result.Rows))
	for _, row := range result.Rows {
		if len(row) >= 3 {
			fmt.Printf("  %s (id=%s) 缺少职位: %s\n", row[1], row[0], positionsName(row[2]))
		}
	}
}

func runMissingEpisodes(ctx context.Context, name string, dbPath string) {
	// Anime-only position table, matching the HTTP handler: episode scanning
	// is restricted to type-2 subjects, and merging the per-type tables
	// collides same-ID different-name entries, making literal→position
	// bindings vary between runs.
	positions := model.StaffPositions[2]

	lit2pid, combinedRe := buildEpPositionTable(positions)
	if combinedRe == nil {
		fmt.Fprintln(os.Stderr, "构建职位正则失败")
		os.Exit(1)
	}

	nameClean := strings.ReplaceAll(strings.ReplaceAll(name, "　", ""), " ", "")
	nameRe := regexp.MustCompile(fmt.Sprintf(`(?i)(^|%s|\n)%s($|%s|\n)`,
		delimClass, regexp.QuoteMeta(nameClean), delimClass))

	escapedNameSQL := query.EscapeLiteral(name)
	// CLI has no archive dataDir and no target person-ID ("0" → name lookup).
	// The two queries are independent DuckDB invocations; overlapping them
	// hides the linked-subjects lookup behind the episode scan.
	var (
		linked   map[int]map[int]map[string]bool
		result   *query.QueryResult
		queryErr error
	)
	var wg sync.WaitGroup
	wg.Add(2)
	go func() {
		defer wg.Done()
		linked = queryLinked(ctx, dbPath, "", escapedNameSQL, 0)
	}()
	go func() {
		defer wg.Done()
		engine := query.NewEngine(dbPath, "")
		result, queryErr = engine.ExecuteRaw(ctx, buildEpSearchSQL(escapedNameSQL))
	}()
	wg.Wait()

	if queryErr != nil {
		fmt.Fprintf(os.Stderr, "查询失败: %v\n", queryErr)
		os.Exit(1)
	}

	temp := collectEpMatches(result.Rows, lit2pid, combinedRe, nameRe, linked)

	matchedCount := 0
	for sid, subj := range temp {
		m, _ := splitMatched(subj.Episodes)
		if len(m) > 0 {
			matchedCount++
			fmt.Printf("✓ %s (id=%d):\n", subj.Name, sid)
			for pid, labels := range m {
				fmt.Printf("    %s: %s\n", positionsName(strconv.Itoa(pid)), strings.Join(labels, ", "))
			}
		}
	}

	if matchedCount == 0 {
		fmt.Println("未发现匹配剧集")
	}
}

func positionsName(pidStr string) string {
	pid, err := strconv.Atoi(pidStr)
	if err != nil {
		return pidStr
	}
	for _, m := range model.StaffPositions {
		if name, ok := m[pid]; ok {
			return name
		}
	}
	return pidStr
}
