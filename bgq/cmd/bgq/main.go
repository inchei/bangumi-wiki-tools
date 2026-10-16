package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/inchei/bangumi-query/internal/config"
	"github.com/inchei/bangumi-query/internal/query"
)

const (
	banner = `
  ██████╗   ██████╗   ██████╗
  ██╔══██╗ ██╔════╝  ██╔═══██╗
  ██████╔╝ ██║  ███╗ ██║   ██║  Bangumi Query
  ██╔══██╗ ██║   ██║ ██║▄▄ ██║
  ██████╔╝ ╚██████╔╝ ╚██████╔╝
  ╚═════╝   ╚═════╝   ╚══▀▀═╝

`
)

func main() {
	if len(os.Args) < 2 {
		printUsage()
		os.Exit(1)
	}

	// Find DuckDB binary
	duckdbPath := query.FindDuckDB()
	query.SetDuckDBPath(duckdbPath)

	switch os.Args[1] {
	case "query":
		cmdQuery(os.Args[2:])
	case "serve":
		cmdServe(os.Args[2:])
	case "ingest":
		cmdIngest(os.Args[2:])
	case "missing":
		cmdMissing(os.Args[2:])
	case "help", "--help", "-h":
		printUsage()
	default:
		fmt.Fprintf(os.Stderr, "未知命令: %s\n", os.Args[1])
		printUsage()
		os.Exit(1)
	}
}

func printUsage() {
	fmt.Print(banner)
	fmt.Println(`用法:
  bgq query --config <yaml文件> [--data-dir <数据目录>] [--output <输出文件>]
  bgq serve [--data-dir <数据目录>] [--listen <地址:端口>] [--allowed-origins <域名列表>] [--dev]
  bgq ingest --data-dir <数据目录> --db <数据库路径>
  bgq missing subjects --type <条目类型> [--db <数据库>] <人名>
  bgq missing episodes [--db <数据库>] <人名>
  bgq help

  子命令:
  query       执行筛选查询（从YAML配置文件）
  serve       启动Web界面
  ingest      将数据导入DuckDB数据库（加速后续查询）
  missing     检查缺失的条目 staff 关联 或 剧集标注
  help        显示此帮助信息

  示例:
  bgq query --config query.yaml
  bgq serve --listen :8080
  bgq serve --allowed-origins "bgm.tv,bangumi.tv"
  bgq serve --dev
  bgq ingest --data-dir ./bangumi_archive --db ./bangumi.db
  bgq missing subjects --type 1 --db ./bangumi.db 川原砾`)
}

func cmdQuery(args []string) {
	fs := flag.NewFlagSet("query", flag.ExitOnError)
	var configFile, dataDir, outputFile, formatOverride string
	verbose := false
	fs.StringVar(&configFile, "config", "", "配置文件路径（YAML）")
	fs.StringVar(&configFile, "c", "", "配置文件路径（YAML）")
	fs.StringVar(&dataDir, "data-dir", "bangumi_archive", "数据目录")
	fs.StringVar(&dataDir, "d", "bangumi_archive", "数据目录")
	fs.StringVar(&outputFile, "output", "", "输出文件")
	fs.StringVar(&outputFile, "o", "", "输出文件")
	fs.StringVar(&formatOverride, "format", "", "输出格式（csv/json/table）")
	fs.StringVar(&formatOverride, "f", "", "输出格式（csv/json/table）")
	fs.BoolVar(&verbose, "verbose", false, "显示生成的 SQL")
	fs.BoolVar(&verbose, "v", false, "显示生成的 SQL")
	_ = fs.Parse(args)

	if configFile == "" {
		fmt.Fprintln(os.Stderr, "错误: 需要指定 --config <yaml文件>")
		os.Exit(1)
	}

	if dataDir == "" {
		dataDir = "bangumi_archive"
	}

	// Load config
	cfg, err := config.Load(configFile)
	if err != nil {
		fmt.Fprintf(os.Stderr, "加载配置文件失败: %v\n", err)
		os.Exit(1)
	}

	// Use config's data_dir if command-line didn't specify one
	if dataDir == "bangumi_archive" && cfg.DataDir != "" {
		dataDir = cfg.DataDir
	}

	// Resolve data directory relative to config file if needed
	dataDir = resolveDataDir(dataDir, configFile)

	// Override format if specified
	if formatOverride != "" {
		if cfg.Output == nil {
			cfg.Output = &config.Output{}
		}
		cfg.Output.Format = formatOverride
	}

	// Execute query
	runQuery(cfg, dataDir, outputFile, verbose)
}

func cmdServe(args []string) {
	fs := flag.NewFlagSet("serve", flag.ExitOnError)
	var dataDir, listen, dbPath, aliasesFile, allowedOrigins string
	dev := false
	fs.StringVar(&dataDir, "data-dir", "bangumi_archive", "数据目录")
	fs.StringVar(&dataDir, "d", "bangumi_archive", "数据目录")
	fs.StringVar(&listen, "listen", ":8080", "监听地址")
	fs.StringVar(&listen, "l", ":8080", "监听地址")
	fs.StringVar(&dbPath, "db", "", "数据库路径")
	fs.StringVar(&aliasesFile, "aliases-file", "", "别名文件（person_alias.json）")
	fs.StringVar(&allowedOrigins, "allowed-origins", "", "允许的来源域名列表（逗号分隔）")
	fs.BoolVar(&dev, "dev", false, "开发模式（Air 热重载）")
	_ = fs.Parse(args)

	allowedHosts := defaultAllowedHosts
	if allowedOrigins != "" {
		allowedHosts = nil
		for _, h := range strings.Split(allowedOrigins, ",") {
			if h = strings.TrimSpace(h); h != "" {
				allowedHosts = append(allowedHosts, h)
			}
		}
	}

	// If --dev is set and we're not already running under air, start air
	if dev && os.Getenv("BGQ_AIR") == "" {
		bgqDir, err := os.Getwd()
		if err != nil {
			fmt.Fprintf(os.Stderr, "cwd: %v\n", err)
			os.Exit(1)
		}
		startDevMode(bgqDir, dataDir, listen, dbPath, aliasesFile, allowedHosts)
		return
	}

	// Smart defaults
	if dbPath == "" {
		for _, p := range []string{"bangumi.db", filepath.Join(dataDir, "bangumi.db")} {
			if fi, err := os.Stat(p); err == nil && !fi.IsDir() {
				dbPath = p
				break
			}
		}
	}

	if aliasesFile == "" {
		for _, p := range []string{"../person_alias.json", "person_alias.json"} {
			if fi, err := os.Stat(p); err == nil && !fi.IsDir() {
				aliasesFile = p
				break
			}
		}
	}

	startServer(dataDir, listen, dbPath, aliasesFile, allowedHosts)
}

func cmdIngest(args []string) {
	fs := flag.NewFlagSet("ingest", flag.ExitOnError)
	var dataDir, dbPath string
	fs.StringVar(&dataDir, "data-dir", "bangumi_archive", "数据目录")
	fs.StringVar(&dataDir, "d", "bangumi_archive", "数据目录")
	fs.StringVar(&dbPath, "db", "bangumi.db", "数据库路径")
	_ = fs.Parse(args)

	fmt.Printf("正在导入数据...\n")
	fmt.Printf("数据目录: %s\n", dataDir)
	fmt.Printf("数据库: %s\n", dbPath)

	if err := runIngest(dataDir, dbPath); err != nil {
		fmt.Fprintf(os.Stderr, "导入失败: %v\n", err)
		os.Exit(1)
	}

	fmt.Println("导入完成！")
	fmt.Printf("数据库大小: ")
	if info, err := os.Stat(dbPath); err == nil {
		fmt.Printf("%.1f MB\n", float64(info.Size())/(1024*1024))
	}
}

func runQuery(cfg *config.Config, dataDir, outputFile string, verbose bool) {
	ctx := context.Background()
	engine := query.NewEngine(cfg.Database, dataDir)

	fmt.Fprintf(os.Stderr, "正在执行查询...\n")

	result, err := engine.Execute(ctx, cfg)
	if err != nil {
		fmt.Fprintf(os.Stderr, "查询失败: %v\n", err)
		os.Exit(1)
	}

	if verbose {
		fmt.Fprintf(os.Stderr, "\n--- 生成的 SQL ---\n%s\n--- 结束 ---\n\n", result.SQL)
	}

	// Output
	switch cfg.Output.Format {
	case "csv":
		path := outputFile
		if path == "" {
			path = cfg.Output.Path
		}
		if path == "" {
			// No output path: write CSV to stdout
			if err := result.WriteCSVTo(os.Stdout); err != nil {
				fmt.Fprintf(os.Stderr, "写入CSV失败: %v\n", err)
				os.Exit(1)
			}
		} else {
			if err := result.WriteCSV(path); err != nil {
				fmt.Fprintf(os.Stderr, "写入CSV失败: %v\n", err)
				os.Exit(1)
			}
			fmt.Fprintf(os.Stderr, "结果保存至: %s\n", path)
		}
		fmt.Fprintf(os.Stderr, "共 %d 行, 耗时 %v\n", result.TotalRows, result.Duration.Round(time.Millisecond))
	case "json":
		path := outputFile
		if path == "" {
			path = cfg.Output.Path
		}
		if path == "" {
			// No output path: write JSON to stdout
			if err := result.WriteJSONTo(os.Stdout); err != nil {
				fmt.Fprintf(os.Stderr, "写入JSON失败: %v\n", err)
				os.Exit(1)
			}
		} else {
			if err := result.WriteJSON(path); err != nil {
				fmt.Fprintf(os.Stderr, "写入JSON失败: %v\n", err)
				os.Exit(1)
			}
			fmt.Fprintf(os.Stderr, "结果保存至: %s\n", path)
		}
		fmt.Fprintf(os.Stderr, "共 %d 行, 耗时 %v\n", result.TotalRows, result.Duration.Round(time.Millisecond))
	default:
		fmt.Print(result.FormatTable(50))
	}
}

func resolveDataDir(dataDir, configFile string) string {
	// If absolute path, return as-is
	if strings.HasPrefix(dataDir, "/") {
		return dataDir
	}

	// Try relative to current working directory first
	if _, err := os.Stat(dataDir); err == nil {
		return dataDir
	}

	// Try relative to config file's directory
	if configFile != "" {
		configAbs, err := filepath.Abs(configFile)
		if err == nil {
			configDir := filepath.Dir(configAbs)
			resolved := filepath.Join(configDir, dataDir)
			if _, err := os.Stat(resolved); err == nil {
				return resolved
			}
		}
	}

	return dataDir
}

func runIngest(dataDir, dbPath string) error {
	// Tables are created with CREATE TABLE IF NOT EXISTS, so importing into an
	// existing database would silently keep the old data.
	if _, err := os.Stat(dbPath); err == nil {
		return fmt.Errorf("数据库已存在: %s", dbPath)
	}

	// Create DuckDB database and import JSONLines files
	ctx := context.Background()

	sql := fmt.Sprintf(`
-- Create tables from JSONLines files
CREATE TABLE IF NOT EXISTS subjects AS
  SELECT * FROM read_json_auto('%s/subject.jsonlines', format='newline_delimited');

CREATE TABLE IF NOT EXISTS persons AS
  SELECT id AS person_id, type AS person_type, * EXCLUDE (id, type) FROM read_json_auto('%s/person.jsonlines', format='newline_delimited');

CREATE TABLE IF NOT EXISTS characters AS
  SELECT id AS character_id, * EXCLUDE (id) FROM read_json_auto('%s/character.jsonlines', format='newline_delimited');

CREATE TABLE IF NOT EXISTS subject_relations AS
  SELECT * FROM read_json_auto('%s/subject-relations.jsonlines', format='newline_delimited');

CREATE TABLE IF NOT EXISTS subject_persons AS
  SELECT * FROM read_json_auto('%s/subject-persons.jsonlines', format='newline_delimited');

CREATE TABLE IF NOT EXISTS subject_characters AS
  SELECT * FROM read_json_auto('%s/subject-characters.jsonlines', format='newline_delimited');

CREATE TABLE IF NOT EXISTS episodes AS
  SELECT id AS episode_id, * EXCLUDE (id) FROM read_json_auto('%s/episode.jsonlines', format='newline_delimited');

CREATE TABLE IF NOT EXISTS person_relations AS
  SELECT * FROM read_json_auto('%s/person-relations.jsonlines', format='newline_delimited')
  WHERE person_type = 'prsn';

CREATE TABLE IF NOT EXISTS character_relations AS
  SELECT * FROM read_json_auto('%s/person-relations.jsonlines', format='newline_delimited')
  WHERE person_type = 'crt';

CREATE TABLE IF NOT EXISTS person_characters AS
  SELECT * FROM read_json_auto('%s/person-characters.jsonlines', format='newline_delimited');

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_subjects_type ON subjects(type);
CREATE INDEX IF NOT EXISTS idx_relations_subject ON subject_relations(subject_id);
CREATE INDEX IF NOT EXISTS idx_relations_type ON subject_relations(relation_type);
CREATE INDEX IF NOT EXISTS idx_persons_subject ON subject_persons(subject_id);
CREATE INDEX IF NOT EXISTS idx_persons_position ON subject_persons(position);
CREATE INDEX IF NOT EXISTS idx_persons_person ON subject_persons(person_id);
CREATE INDEX IF NOT EXISTS idx_episodes_subject ON episodes(subject_id);
CREATE INDEX IF NOT EXISTS idx_person_relations_person ON person_relations(person_id);
CREATE INDEX IF NOT EXISTS idx_person_relations_type ON person_relations(relation_type);
CREATE INDEX IF NOT EXISTS idx_person_characters_person ON person_characters(person_id);
CREATE INDEX IF NOT EXISTS idx_person_characters_character ON person_characters(character_id);
CREATE INDEX IF NOT EXISTS idx_person_characters_subject ON person_characters(subject_id);
`, dataDir, dataDir, dataDir, dataDir, dataDir, dataDir, dataDir, dataDir, dataDir, dataDir)

	return query.ExecuteDuckDBSQL(ctx, dbPath, sql)
}
