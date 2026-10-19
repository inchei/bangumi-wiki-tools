package main

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/csv"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io/fs"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"time"

	"github.com/inchei/bangumi-query/internal/config"
	"github.com/inchei/bangumi-query/internal/query"
	srv "github.com/inchei/bangumi-query/internal/server"
)

type server struct {
	dataDir      string
	dbPath       string
	aliases      atomic.Pointer[aliasData]
	aliasesFile  string
	aliasesBusy  atomic.Bool
	aliasesTryAt atomic.Int64
	allowedHosts []string
}

type apiQueryRequest struct {
	Target     string            `json:"target,omitempty"`
	Filters    []config.Filter   `json:"filters,omitempty"`
	Columns    []string          `json:"columns,omitempty"`
	Sort       []config.SortRule `json:"sort,omitempty"`
	Limit      int               `json:"limit,omitempty"`
	AssocLimit int               `json:"assoc_limit,omitempty"`
	Format     string            `json:"format,omitempty"`
}

type apiError struct {
	Error   string `json:"error"`
	Message string `json:"message,omitempty"`
}

var defaultAllowedHosts = []string{"bgm.tv", "bangumi.tv", "chii.in", "chii.ink", "bgmmi.anibt.net", "bangumi.lol"}

func startServer(dataDir, listenAddr, dbPath, aliasesFile string, allowedHosts []string) {
	// Resolve dataDir to absolute path
	absDataDir := dataDir
	if !strings.HasPrefix(dataDir, "/") {
		if cwd, err := os.Getwd(); err == nil {
			absDataDir = filepath.Join(cwd, dataDir)
		}
	}
	if info, err := os.Stat(absDataDir); err != nil || !info.IsDir() {
		fmt.Printf("⚠ 警告: 数据目录不存在: %s\n", absDataDir)
	}

	s := &server{
		dataDir:      dataDir,
		dbPath:       dbPath,
		aliasesFile:  aliasesFile,
		allowedHosts: allowedHosts,
	}

	if aliasesFile != "" {
		if ad, err := loadAliasesFile(aliasesFile); err != nil {
			fmt.Printf("⚠ 警告: 加载别名文件失败: %v\n", err)
		} else {
			s.aliases.Store(ad)
		}
	}

	mux := http.NewServeMux()

	// API endpoints
	mux.HandleFunc("/api/query", s.handleQuery)
	mux.HandleFunc("/api/health", s.handleHealth)
	mux.HandleFunc("/api/debug", s.handleDebug)
	mux.HandleFunc("/api/persons/{name}/missing-subjects", s.handleCheckMissingStaff)
	mux.HandleFunc("/api/persons/{name}/missing-episodes", s.handleMissingEpisodes)
	mux.HandleFunc("/api/aliases/{alias}", s.handleAliases)

	mux.HandleFunc("/sitemap.xml", s.handleSitemap)
	mux.HandleFunc("/", s.handleStatic)

	handler := securityHeaders(s.corsMiddleware(mux))

	duckdbPath := query.GetDuckDBPath()
	duckdbOK := fileExists(duckdbPath)

	fmt.Printf("\n  Bangumi Query Web UI\n")
	fmt.Printf("  ────────────────────\n")
	fmt.Printf("  URL:      http://localhost%s\n", listenAddr)
	if dbPath != "" {
		dbOK := fileExists(dbPath)
		fmt.Printf("  Database: %s", dbPath)
		if !dbOK {
			fmt.Printf("  ⚠ 文件不存在")
		}
		fmt.Println()
	} else {
		fmt.Printf("  DataDir:  %s\n", absDataDir)
	}
	fmt.Printf("  DuckDB:   %s", duckdbPath)
	if !duckdbOK {
		fmt.Printf("  ⚠ 未找到")
	}
	fmt.Println()
	if aliasesFile != "" {
		aliasesOK := s.aliases.Load() != nil
		fmt.Printf("  Aliases:  %s", aliasesFile)
		if !aliasesOK {
			fmt.Printf("  ⚠ 加载失败")
		}
		fmt.Println()
	}
	fmt.Printf("\n  按 Ctrl+C 停止服务器\n\n")

	server := &http.Server{
		Addr:         listenAddr,
		Handler:      handler,
		ReadTimeout:  30 * time.Second,
		WriteTimeout: 5 * time.Minute, // queries can take time
		IdleTimeout:  60 * time.Second,
	}

	if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatalf("服务器启动失败: %v", err)
	}
}

func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; frame-ancestors 'self'; base-uri 'self'; form-action 'self'")
		if r.TLS != nil || r.Header.Get("X-Forwarded-Proto") == "https" {
			h.Set("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
		}
		next.ServeHTTP(w, r)
	})
}

func (s *server) corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if origin != "" {
			if !s.sameOrigin(r, origin) && !s.isAllowedOrigin(origin) {
				http.Error(w, "forbidden", http.StatusForbidden)
				return
			}
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Add("Vary", "Origin")
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Accept")
			if r.Method == "OPTIONS" {
				w.WriteHeader(http.StatusOK)
				return
			}
		} else if r.Method == "OPTIONS" {
			w.WriteHeader(http.StatusOK)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (s *server) handleQuery(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		writeJSON(w, http.StatusMethodNotAllowed, apiError{Error: "只支持POST请求"})
		return
	}

	// Bound the request body to prevent memory exhaustion from oversized payloads.
	r.Body = http.MaxBytesReader(w, r.Body, 4<<20)

	var req apiQueryRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, apiError{Error: "请求格式错误: " + err.Error()})
		return
	}

	if len(req.Filters) == 0 && len(req.Sort) == 0 {
		writeJSON(w, http.StatusBadRequest, apiError{Error: "请提供 filters 或 sort"})
		return
	}

	cfg := &config.Config{
		Target:  req.Target,
		DataDir: s.dataDir,
		Filters: req.Filters,
		Output:  &config.Output{Format: "json"},
		Sort:    req.Sort,
		Limit:   req.Limit,
	}

	// Structural validation shared with the CLI path; returns request-scoped
	// errors (400) instead of surfacing them later as query failures (500).
	if err := cfg.Validate(); err != nil {
		writeJSON(w, http.StatusBadRequest, apiError{Error: err.Error()})
		return
	}

	// Server-side clamps (Web UI/API concern, CLI stays uncapped)
	if cfg.Limit <= 0 {
		cfg.Limit = 1000
	}
	if cfg.Limit > 10000 {
		cfg.Limit = 10000
	}

	// Use database if configured
	if s.dbPath != "" && cfg.Database == "" {
		cfg.Database = s.dbPath
	}

	if len(req.Columns) > 0 {
		cfg.Output.Columns = req.Columns
	}
	if req.AssocLimit != 0 {
		cfg.Output.AssocLimit = req.AssocLimit
	}
	if cfg.Output.AssocLimit < 1 {
		cfg.Output.AssocLimit = 1
	}
	if cfg.Output.AssocLimit > 100 {
		cfg.Output.AssocLimit = 100
	}
	if req.Format != "" {
		cfg.Output.Format = req.Format
	}

	// Execute query, bounding run time so a pathological query cannot pin
	// the DuckDB subprocess indefinitely.
	ctx, cancel := context.WithTimeout(r.Context(), 60*time.Second)
	defer cancel()
	engine := query.NewEngine(s.dbPath, s.dataDir)
	result, err := engine.Execute(ctx, cfg)
	if err != nil {
		id := s.logQueryFailure(r, "handleQuery", err)
		writeJSON(w, http.StatusInternalServerError, apiError{Error: "查询执行失败（请求 ID: " + id + "）"})
		return
	}

	// Format response
	response := map[string]interface{}{
		"columns":    result.Columns,
		"rows":       result.Rows,
		"total_rows": result.TotalRows,
		"duration":   result.Duration.Round(time.Millisecond).String(),
	}

	if req.Format == "csv" {
		w.Header().Set("Content-Type", "text/csv; charset=utf-8")
		w.Header().Set("Content-Disposition", "attachment; filename=results.csv")
		if err := writeCSVToWriter(result, w); err != nil {
			log.Printf("写入CSV失败: %v", err)
		}
		return
	}

	writeJSON(w, http.StatusOK, response)
}

func (s *server) handleHealth(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (s *server) handleDebug(w http.ResponseWriter, r *http.Request) {
	var aliasesMtime time.Time
	if ad := s.aliases.Load(); ad != nil {
		aliasesMtime = ad.ModTime
	}
	resp := map[string]interface{}{
		"duckdb_mtime":  formatMtime(modTime(query.GetDuckDBPath())),
		"binary_mtime":  formatMtime(modTime(exePath())),
		"db_mtime":      formatMtime(modTime(s.dbPath)),
		"data_mtime":    formatMtime(dataVersionTime(s.dataDir)),
		"aliases_mtime": formatMtime(aliasesMtime),
	}
	writeJSON(w, http.StatusOK, resp)
}

func exePath() string {
	p, err := os.Executable()
	if err != nil {
		return ""
	}
	return p
}

func modTime(path string) time.Time {
	if path == "" {
		return time.Time{}
	}
	fi, err := os.Stat(path)
	if err != nil {
		return time.Time{}
	}
	return fi.ModTime()
}

// dataVersionTime returns the bangumi data update time recorded in
// data_version.json ({"created_at": "<RFC3339>"}), written by
// download-archive.sh. Falls back to the newest .jsonlines file mtime if the
// version file is missing or unparseable.
func dataVersionTime(dataDir string) time.Time {
	data, err := os.ReadFile(filepath.Join(dataDir, "data_version.json"))
	if err == nil {
		var v struct {
			CreatedAt string `json:"created_at"`
		}
		if json.Unmarshal(data, &v) == nil && v.CreatedAt != "" {
			if t, err := time.Parse(time.RFC3339, v.CreatedAt); err == nil {
				return t
			}
		}
	}
	return newestJSONLMtime(dataDir)
}

// newestJSONLMtime returns the newest modification time among the .jsonlines
// data files in dir, falling back to the directory mtime.
func newestJSONLMtime(dir string) time.Time {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return time.Time{}
	}
	var latest time.Time
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".jsonlines") {
			continue
		}
		if info, err := e.Info(); err == nil && info.ModTime().After(latest) {
			latest = info.ModTime()
		}
	}
	if latest.IsZero() {
		if fi, err := os.Stat(dir); err == nil {
			return fi.ModTime()
		}
	}
	return latest
}

func formatMtime(t time.Time) string {
	if t.IsZero() {
		return ""
	}
	return t.UTC().Format(time.RFC3339)
}

func fileExists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

func (s *server) handleStatic(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path == "/" || r.URL.Path == "/index.html" {
		s.handleIndex(w, r)
		return
	}
	staticFS, _ := fs.Sub(srv.StaticFS, "dist")
	http.FileServer(http.FS(staticFS)).ServeHTTP(w, r)
}

func (s *server) handleIndex(w http.ResponseWriter, r *http.Request) {
	var rb [16]byte
	_, _ = rand.Read(rb[:])
	nonce := base64.StdEncoding.EncodeToString(rb[:])
	data, err := srv.StaticFS.ReadFile("dist/index.html")
	if err != nil {
		http.NotFound(w, r)
		return
	}
	page := strings.Replace(string(data), "<script", `<script nonce="`+nonce+`"`, 1)
	h := w.Header()
	h.Set("Content-Type", "text/html; charset=utf-8")
	h.Set("Content-Security-Policy", "default-src 'self'; script-src 'self' 'nonce-"+nonce+"'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; frame-ancestors 'self'; base-uri 'self'; form-action 'self'")
	_, _ = w.Write([]byte(page))
}

func (s *server) handleSitemap(w http.ResponseWriter, r *http.Request) {
	baseURL := s.inferBaseURL(r)
	w.Header().Set("Content-Type", "application/xml; charset=utf-8")
	_, _ = w.Write([]byte(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
<url><loc>` + baseURL + `/</loc></url>
</urlset>`))
}

func (s *server) inferBaseURL(r *http.Request) string {
	scheme := "http"
	if r.TLS != nil || r.Header.Get("X-Forwarded-Proto") == "https" {
		scheme = "https"
	}
	return scheme + "://" + r.Host
}

func writeJSON(w http.ResponseWriter, status int, data interface{}) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(data)
}

func (s *server) logQueryFailure(r *http.Request, where string, err error) string {
	var id [4]byte
	_, _ = rand.Read(id[:])
	idStr := hex.EncodeToString(id[:])
	log.Printf("查询失败 [%s] %s %s: %v", idStr, where, r.URL.Path, err)
	return idStr
}

// writeCSVToWriter writes query results as CSV to an io.Writer.
func writeCSVToWriter(r *query.QueryResult, w http.ResponseWriter) error {
	_, _ = w.Write([]byte{0xEF, 0xBB, 0xBF})
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
