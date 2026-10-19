package main

import (
	"fmt"
	"net/http"
	"net/url"
	"regexp"
	"sort"
	"strconv"
	"strings"

	"github.com/inchei/bangumi-query/internal/model"
	"github.com/inchei/bangumi-query/internal/query"
)

const delimClass = `[()\[\]{}（）<>《》「」『』【】+×·→/／、,，;；：&＆\\等]`

// infoboxPairPattern extracts all `|key= value` single-line pairs from an
// infobox template string. Group 1 = key, group 2 = value (up to newline or
// pipe). Multi-line brace values (`|key: { ... }`) are intentionally NOT
// supported — `bgq missing` only checks single-line staff fields.
// Anchored to start-of-line with (?im) so `^` matches each line, not just
// the start of the whole string.
const infoboxPairPattern = `(?im)^\|([^|=\n]+?)\s*=\s*([^\n\r|]*)`

func (s *server) handleCheckMissingStaff(w http.ResponseWriter, r *http.Request) {
	if r.Method != "GET" {
		writeJSON(w, http.StatusMethodNotAllowed, apiError{Error: "只支持GET请求"})
		return
	}

	if !s.allowedReferrer(r) {
		writeJSON(w, http.StatusForbidden, apiError{Error: "请求来源不在允许列表中"})
		return
	}

	if s.dbPath == "" {
		writeJSON(w, http.StatusBadRequest, apiError{Error: "需要 --db 参数指向已 ingest 的数据库，请先运行 bgq ingest"})
		return
	}

	name := r.PathValue("name")
	typeStr := r.URL.Query().Get("type")
	posStr := r.URL.Query().Get("position")
	targetStr := r.URL.Query().Get("target")

	if name == "" || typeStr == "" {
		writeJSON(w, http.StatusBadRequest, apiError{Error: "name 和 type 为必填参数"})
		return
	}

	typeCode, err := strconv.Atoi(typeStr)
	if err != nil || typeCode < 1 || typeCode > 6 {
		writeJSON(w, http.StatusBadRequest, apiError{Error: "type 无效，可用值: 1(书籍) 2(动画) 3(音乐) 4(游戏) 6(三次元)"})
		return
	}

	allPositions := model.StaffPositions[typeCode]
	if len(allPositions) == 0 {
		writeJSON(w, http.StatusBadRequest, apiError{Error: fmt.Sprintf("条目类型 %d 没有职位定义", typeCode)})
		return
	}

	positions := allPositions
	if posStr != "" {
		posID, err := strconv.Atoi(posStr)
		if err != nil {
			writeJSON(w, http.StatusBadRequest, apiError{Error: "position 必须为数字 ID"})
			return
		}
		posName, ok := allPositions[posID]
		if !ok {
			writeJSON(w, http.StatusBadRequest, apiError{Error: fmt.Sprintf("条目类型 %d 没有职位 ID %d", typeCode, posID)})
			return
		}
		positions = map[int]string{posID: posName}
	}

	targetID, _ := strconv.Atoi(targetStr)

	sql := buildCheckSQL(typeCode, name, positions, targetID)

	engine := query.NewEngine(s.dbPath, s.dataDir)
	result, err := engine.ExecuteRaw(r.Context(), sql)
	if err != nil {
		id := s.logQueryFailure(r, "missing-subjects", err)
		writeJSON(w, http.StatusInternalServerError, apiError{Error: "查询失败（请求 ID: " + id + "）"})
		return
	}

	type subjectEntry struct {
		Name      string `json:"name"`
		Positions []int  `json:"positions"`
	}
	agg := make(map[int]subjectEntry)
	for _, row := range result.Rows {
		if len(row) < 3 {
			continue
		}
		sid, _ := strconv.Atoi(row[0])
		pid, _ := strconv.Atoi(row[2])
		entry := agg[sid]
		entry.Name = row[1]
		entry.Positions = append(entry.Positions, pid)
		agg[sid] = entry
	}

	writeJSON(w, http.StatusOK, agg)
}

func buildCheckSQL(typeCode int, personName string, positions map[int]string, targetID int) string {
	cleanName := strings.ReplaceAll(strings.ReplaceAll(personName, "　", ""), " ", "")
	escapedName := regexp.QuoteMeta(cleanName)
	escapedNameSQL := query.EscapeLiteral(personName)
	snamePattern := strings.ReplaceAll(
		fmt.Sprintf(`(?i)(^|%s|\n)%s($|%s|\n)`, delimClass, escapedName, delimClass),
		"'", "''",
	)

	// Case-insensitive substring prefilter over the space-stripped infobox is
	// a strict superset of the delimited name match below: any pair value that
	// can hit snamePattern must contain the clean name, and the pair value is
	// a substring of the infobox. Must stay case-insensitive to cover ASCII
	// case variants the final pattern accepts.
	var prefilter string
	if cleanName != "" {
		prefilterPattern := strings.ReplaceAll(`(?i)`+regexp.QuoteMeta(cleanName), "'", "''")
		prefilter = fmt.Sprintf(
			"\n    AND regexp_matches(REPLACE(REPLACE(s.infobox, '　', ''), ' ', ''), '%s')",
			prefilterPattern,
		)
	}

	posIDs := sortedKeys(positions)
	hasSeries := typeCode == 1

	// Build positions_map VALUES list: (id, '职位名'), (id, '职位名'), ...
	var posValues strings.Builder
	for i, posID := range posIDs {
		if i > 0 {
			posValues.WriteString(",")
		}
		posNameSQL := query.EscapeLiteral(positions[posID])
		fmt.Fprintf(&posValues, "(%d, '%s')", posID, posNameSQL)
	}

	// infobox pair pattern (single-quoted SQL string; no single quotes in
	// the pattern itself, so no doubling needed).
	infoboxPatternSQL := query.EscapeLiteral(infoboxPairPattern)

	var sb strings.Builder

	// CTE 1 (optional): series_ids — only for book type (1).
	cteCount := 0
	if hasSeries {
		sb.WriteString(`WITH series_ids AS (
  SELECT DISTINCT subject_id AS id FROM subject_relations WHERE relation_type = 1002
),
`)
		cteCount++
	}

	// CTE: linked — pre-compute (subject_id, position) where this person is
	// already a registered staff member.
	if targetID > 0 {
		fmt.Fprintf(&sb, `%slinked AS (
  SELECT sp.subject_id, sp.position
  FROM subject_persons sp
  WHERE sp.person_id = %d
),
`, withPrefix(cteCount), targetID)
	} else {
		fmt.Fprintf(&sb, `%slinked AS (
  SELECT sp.subject_id, sp.position
  FROM subject_persons sp
  JOIN persons p ON sp.person_id = p.person_id
  WHERE LOWER(REPLACE(REPLACE(TRIM(p.name), '　', ''), ' ', '')) = LOWER(REPLACE(REPLACE('%s', '　', ''), ' ', ''))
),
`, withPrefix(cteCount), escapedNameSQL)
	}
	cteCount++

	// CTE: positions_map — (position_id, position_name) tuples for this type.
	fmt.Fprintf(&sb, `%spositions_map(id, name) AS (
  VALUES %s
),
`, withPrefix(cteCount), posValues.String())
	cteCount++

	// CTE: pairs — single-pass extraction of all `|key= value` pairs per
	// subject. Multiple UNNEST in the same SELECT expand in lockstep (DuckDB
	// pairs them positionally), giving directly accessible columns without
	// needing struct access (avoids struct_extract issues across DuckDB
	// versions).
	fmt.Fprintf(&sb, `%spairs AS (
  SELECT s.id AS subject_id,
         s.name AS subject_name,
         UNNEST(regexp_extract_all(s.infobox, '%s', 1)) AS k,
         UNNEST(regexp_extract_all(s.infobox, '%s', 2)) AS v
  FROM subjects s
  WHERE s.type = %d%s
%s
)
`, withPrefix(cteCount), infoboxPatternSQL, infoboxPatternSQL, typeCode, prefilter,
		indentSeriesFilter(hasSeries))

	// Final SELECT: subjects whose infobox value for a position key mentions
	// the person (with delimiter boundaries), but no linked staff entry
	// exists for that (subject, position).
	sb.WriteString(`SELECT pairs.subject_id, pairs.subject_name, pm.id
FROM pairs
JOIN positions_map pm ON pm.name = pairs.k
WHERE regexp_matches(REPLACE(REPLACE(pairs.v, '　', ''), ' ', ''), '`)
	sb.WriteString(snamePattern)
	sb.WriteString(`')
  AND NOT EXISTS (SELECT 1 FROM linked l WHERE l.subject_id = pairs.subject_id AND l.position = pm.id)
ORDER BY pairs.subject_id, pm.id;`)

	return sb.String()
}

func withPrefix(cteCount int) string {
	if cteCount == 0 {
		return "WITH "
	}
	return ""
}

// seriesFilter returns the AND-clause that excludes series subjects (only
// applied for book type 1, where series subjects are aggregate entries that
// should not themselves be checked for missing staff).
func seriesFilter(hasSeries bool) string {
	if hasSeries {
		return "AND s.id NOT IN (SELECT id FROM series_ids)"
	}
	return ""
}

// indentSeriesFilter returns seriesFilter() indented for embedding inside the
// pairs subquery's WHERE clause (two-level indent: 4 + 4 spaces).
func indentSeriesFilter(hasSeries bool) string {
	s := seriesFilter(hasSeries)
	if s == "" {
		return ""
	}
	return "    " + s
}

// isAllowedOrigin reports whether an Origin/Referer header value is from one of
// the allowed hosts (or a subdomain thereof). Host parsing prevents the
// previous HasSuffix matching from accepting lookalike domains such as
// "evilbgm.tv".
func (s *server) isAllowedOrigin(origin string) bool {
	u, err := url.Parse(origin)
	if err != nil {
		return false
	}
	host := strings.ToLower(u.Hostname())
	// Always allow localhost for Vite dev server (5173 -> 8080 proxy)
	if host == "localhost" || host == "127.0.0.1" || host == "::1" {
		return true
	}
	if len(s.allowedHosts) == 0 {
		return false
	}
	for _, h := range s.allowedHosts {
		if host == h || strings.HasSuffix(host, "."+h) {
			return true
		}
	}
	return false
}

// sameOrigin reports whether the given Origin value is the same origin as the
// request itself. Browsers send an Origin header on same-origin fetch POSTs,
// so this must be allowed regardless of the cross-origin allow-list, otherwise
// the SPA's own API calls are rejected.
func (s *server) sameOrigin(r *http.Request, origin string) bool {
	u, err := url.Parse(origin)
	if err != nil {
		return false
	}
	return strings.EqualFold(u.Host, r.Host)
}

func (s *server) allowedReferrer(r *http.Request) bool {
	src := r.Header.Get("Origin")
	if src == "" {
		src = r.Header.Get("Referer")
	}
	if src == "" {
		return true // direct access (new tab, curl without referrer)
	}
	return s.sameOrigin(r, src) || s.isAllowedOrigin(src)
}

func sortedKeys(m map[int]string) []int {
	keys := make([]int, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Ints(keys)
	return keys
}
