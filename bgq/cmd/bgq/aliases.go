package main

import (
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/inchei/bangumi-query/internal/aliases"
)

type personAliasEntry = aliases.Entry

type aliasData = aliases.Data

const aliasesRetryMillis int64 = 1000

const aliasesBatchLimit = 50

func loadAliasesFile(path string) (*aliasData, error) {
	return aliases.Load(path)
}

func normalizeAlias(name string) string {
	return aliases.Normalize(name)
}

func (s *server) reloadAliasesIfStale() {
	if s.aliasesFile == "" {
		return
	}
	cur := s.aliases.Load()
	fi, err := os.Stat(s.aliasesFile)
	if err != nil {
		return
	}
	if cur != nil && !fi.ModTime().After(cur.ModTime) {
		return
	}
	now := time.Now().UnixMilli()
	if now-s.aliasesTryAt.Load() < aliasesRetryMillis {
		return
	}
	if !s.aliasesBusy.CompareAndSwap(false, true) {
		return
	}
	s.aliasesTryAt.Store(now)
	if cur == nil {
		s.loadAliasesSnapshot()
		return
	}
	go s.loadAliasesSnapshot()
}

func (s *server) loadAliasesSnapshot() {
	defer s.aliasesBusy.Store(false)
	ad, err := loadAliasesFile(s.aliasesFile)
	if err != nil {
		log.Printf("⚠ 热加载别名文件失败: %v", err)
		return
	}
	s.aliases.Store(ad)
}

func (s *server) handleAliases(w http.ResponseWriter, r *http.Request) {
	if r.Method != "GET" {
		writeJSON(w, http.StatusMethodNotAllowed, apiError{Error: "只支持GET请求"})
		return
	}

	s.reloadAliasesIfStale()
	ad := s.aliases.Load()

	if ad == nil {
		w.Header().Set("Cache-Control", "no-store")
		writeJSON(w, http.StatusServiceUnavailable, apiError{Error: "别名数据未加载，请使用 --aliases-file 参数指定 person_alias.json 文件"})
		return
	}

	alias := r.PathValue("alias")
	if alias == "" {
		writeJSON(w, http.StatusBadRequest, apiError{Error: "alias 为必填参数"})
		return
	}

	if beginConditional(w, r, ad.ModTime, ad.Size) {
		return
	}

	writeJSON(w, http.StatusOK, aliasEntriesFor(ad, alias))
}

func aliasEntriesFor(ad *aliasData, alias string) []personAliasEntry {
	key := normalizeAlias(alias)
	result := []personAliasEntry{}
	if indices, ok := ad.Aliases[key]; ok {
		result = make([]personAliasEntry, 0, len(indices))
		for _, idx := range indices {
			if idx >= 0 && idx < len(ad.Persons) {
				entry := ad.Persons[idx]
				if entry.Name != "" {
					result = append(result, entry)
				}
			}
		}
	}
	return result
}

func (s *server) handleAliasesBatch(w http.ResponseWriter, r *http.Request) {
	if r.Method != "GET" {
		writeJSON(w, http.StatusMethodNotAllowed, apiError{Error: "只支持GET请求"})
		return
	}

	s.reloadAliasesIfStale()
	ad := s.aliases.Load()

	if ad == nil {
		w.Header().Set("Cache-Control", "no-store")
		writeJSON(w, http.StatusServiceUnavailable, apiError{Error: "别名数据未加载，请使用 --aliases-file 参数指定 person_alias.json 文件"})
		return
	}

	var names []string
	seen := make(map[string]bool)
	for _, raw := range r.URL.Query()["names"] {
		for _, part := range strings.Split(raw, ",") {
			part = strings.TrimSpace(part)
			if part == "" || seen[part] {
				continue
			}
			seen[part] = true
			names = append(names, part)
		}
	}
	if len(names) == 0 {
		writeJSON(w, http.StatusBadRequest, apiError{Error: "names 为必填参数"})
		return
	}
	if len(names) > aliasesBatchLimit {
		names = names[:aliasesBatchLimit]
	}

	if beginConditional(w, r, ad.ModTime, ad.Size) {
		return
	}

	result := make(map[string][]personAliasEntry, len(names))
	for _, name := range names {
		result[name] = aliasEntriesFor(ad, name)
	}
	writeJSON(w, http.StatusOK, map[string]map[string][]personAliasEntry{"names": result})
}
