package main

import (
	"context"
	"fmt"
	"net/http"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"

	"github.com/inchei/bangumi-query/internal/model"
	"github.com/inchei/bangumi-query/internal/query"
)

// positionLiterals maps StaffPositions Chinese name → literal strings extracted
// from wikiEpStaffRelate.user.js POSITIONS array patterns.
// Longest strings are matched first; overlaps are resolved by keeping longer matches.
var positionLiterals = map[string][]string{
	"脚本":   {"脚本", "シナリオ", "剧本", "编剧", "プロット", "大纲"},
	"分镜":   {"分镜", "コンテ", "ストーリーボード", "絵コンテ", "画コンテ"},
	"演出":   {"演出"},
	"构图":   {"レイアウト", "构图", "layout", "レイアウター"},
	"作画监督": {"作監", "作画監督", "作监", "作画监督", "作艦", "アニメーション演出"},
	"总作画监督": {"総作監", "総作画監督", "総作监", "総作画監督", "総作艦",
		"总作監", "总作画監督", "总作画监督", "总作监", "总作艦",
		"作画総監督", "チーフ作画監督"},
	"动作作画监督": {"アクション作監", "アクション作画監督", "动作作监", "动作作画监督",
		"アクション作画监督", "动作作監"},
	"机械作画监督": {"メカ作監", "メカ作画監督", "メカニック作監", "メカニック作画監督", "机械作监", "机械作画监督", "机械作監"},
	"特效作画监督": {"エフェクト作監", "エフェクト作画監督", "特效作监", "特效作画监督", "特技作監", "特效作監"},
	"道具作画监督": {"プロップ作画監督", "プロップ作監", "道具作画监督"},
	"角色作画监督": {"キャラクター作画監督", "角色作画监督"},
	"作画监督助理": {"作監補", "作監補佐", "作監补佐", "作監协力", "作監協力", "作監辅佐", "作監辅助", "作監助理",
		"作画監督補", "作画監督補佐", "作画監督协力", "作画監督協力", "作画监督补佐", "作画监督协力", "作画监督助理",
		"作艦補", "作艦補佐", "作艦协力", "作艦協力"},
	"原画":       {"原画", "作画"},
	"第二原画":     {"第二原画", "二原", "原画協力"},
	"演出助理":     {"演出補", "演出補佐", "演出补佐", "演出协力", "演出協力", "演出辅佐", "演出辅助", "演出助理", "演出助手"},
	"导演":       {"監督", "导演", "ディレクター", "シリーズ監督"},
	"副导演":      {"副監督", "副导演"},
	"主演出":      {"チーフ演出", "主演出"},
	"OP・ED 分镜": {"OP・ED分鏡", "OP・ED分镜", "OP絵コンテ"},
	"OP・ED 演出": {"OP・ED演出", "OP・ED 演出"},
	"监修":       {"監修", "监修", "シリーズ監修", "スーパーバイザー"},
	"人物设定":     {"キャラクターデザイン", "キャラ設定", "人物設定", "人物设计", "人物设定", "キャラデザ", "人设"},
	"系列构成":     {"シリーズ構成", "系列构成", "系列構成", "シナリオディレクター", "構成", "脚本構成"},
	"系列监督":     {"シリーズ監督", "系列监督"},
	"色彩设计":     {"色彩設計", "色彩设计", "色彩設定", "カラーデザイン"},
	"色彩指定":     {"色彩指定", "色指定"},
	"色彩检查":     {"色検查", "色検査", "色彩检查"},
	"上色":       {"仕上", "仕上げ", "上色"},
	"上色检查":     {"仕上検查", "仕上検査", "上色检查", "仕上げ検査"},
	"色彩设计助理":   {"色彩設計補佐", "色彩设计助理"},
	"摄影监督":     {"撮影監督", "撮影监督", "摄影監督", "摄影监督"},
	"摄影":       {"撮影", "摄影"},
	"摄影监督助理":   {"撮影監督補佐", "摄影监督助理"},
	"音响监督":     {"音響監督", "音響监督", "音响監督", "音响监督"},
	"音响":       {"音響", "音声", "音响"},
	"音效":       {"音響効果", "効果音", "音效"},
	"音乐":       {"音楽", "音乐", "楽曲"},
	"音乐监督":     {"音楽ディレクター", "音乐监督"},
	"选曲":       {"選曲", "选曲"},
	"录音":       {"録音", "录音"},
	"录音助理":     {"録音アシスタント", "録音助手", "录音助理"},
	"配音监督":     {"配音監督", "配音监督", "配音导演"},
	"剪辑":       {"剪辑", "編集"},
	"在线剪辑":     {"オンライン編集", "在线剪辑"},
	"离线剪辑":     {"オフライン編集", "离线剪辑"},
	"美术监督":     {"美術監督", "美术监督", "アートディレクション", "背景監督"},
	"美术":       {"美術", "美术"},
	"美术设计":     {"美術設定", "美术设定", "美術設計", "美术设计"},
	"美术监督助理":   {"美術監督補佐", "美术监督助理"},
	"背景美术":     {"背景"},
	"美术板":      {"美術ボード", "美术板"},
	"背景设定":     {"基本設定", "場面設定", "場面設計", "背景设定"},
	"人物原案":     {"キャラ原案", "人物原案"},
	"机械设定":     {"メカニック設定", "机械设定", "機械設定"},
	"道具设计":     {"プロップデザイン", "道具設計", "道具设计", "小物設定"},
	"概念设计":     {"コンセプトデザイン", "概念设计"},
	"概念艺术":     {"コンセプトアート", "概念艺术"},
	"画面设计":     {"画面設計", "画面设计"},
	"服装设计":     {"衣装デザイン", "衣装設定", "服装设计", "服裝設計"},
	"标题设计":     {"タイトルデザイン", "标题设计"},
	"设定":       {"設定", "设定"},
	"设定协力":     {"設定協力", "デザイン協力", "设定协力"},
	"原作":       {"原作"},
	"原案":       {"原案"},
	"补间动画":     {"動画", "补间动画"},
	"动画检查":     {"動画検査", "动画检查", "動检", "動画チェック"},
	"动画制作":     {"アニメーション制作", "アニメ制作", "动画制作"},
	"作画监修":     {"作画監修", "作画监修"},
	"构图监修":     {"レイアウト監修", "构图监修"},
	"构图作画监督":   {"レイアウト作画監督", "レイアウト作監", "构图作画监督"},
	"总导演":      {"総監督", "チーフディレクター", "总导演"},
	"CG 导演":    {"CGディレクター", "CG导演", "CG監督"},
	"3DCG 导演":  {"3DCGディレクター", "3DCG导演", "3DCG監督"},
	"3DCG":     {"3DCG", "3DCG"},
	"主动画师":     {"メインアニメーター", "主動畫師", "主动画师"},
	"制作进行":     {"制作进行", "制作進行"},
	"制作进行协力":   {"制作進行協力", "制作进行协力"},
	"设定制作":     {"设定制作", "設定制作", "制作設定"},
	"设定制作助理":   {"設定制作補佐", "设定制作助理"},
	"制作管理":     {"制作デスク", "制作管理", "制作主任", "制作マネージャー", "制作担当", "制作班長"},
	"制作管理助理":   {"制作デスク補佐", "制作管理助理"},
	"制作协力":     {"制作協力", "制作协力", "協力プロダクション", "作品協力"},
	"制作":       {"製作", "制作"},
	"制作助理":     {"制作アシスタント", "制作補佐", "製作補", "制作助理"},
	"制作协调":     {"制作コーディネーター", "制作协调"},
	"制作统括":     {"制作統括", "制作统括"},
	"制片人":      {"プロデュース", "プロデューサー", "制片人"},
	"总制片人":     {"チーフプロデューサー", "チーフ制作", "総合プロデューサー", "总制片人"},
	"执行制片人":    {"製作総指揮", "执行制片人"},
	"副制片人":     {"アソシエイトプロデューサー", "副制片人"},
	"现场制片人":    {"ラインプロデューサー", "现场制片人"},
	"创意制片人":    {"クリエイティブプロデューサー"},
	"音乐制作人":    {"音楽プロデューサー"},
	"美术制作人":    {"美術プロデューサー", "美术制作人"},
	"音响制作人":    {"音響プロデューサー", "音响制作人"},
	"CG 制作人":   {"CGプロデューサー"},
	"宣传制片人":    {"宣伝プロデューサー", "宣传制片人"},
	"企画":       {"企画", "企划", "プランニング", "企画開発"},
	"企划制作人":    {"企画プロデューサー"},
	"企画协力":     {"企画協力", "企画协力"},
	"创意总监":     {"クリエイティブスーパーバイザー", "クリエイティブディレクター", "创意总监"},
	"协力":       {"協力", "协力"},
	"特别鸣谢":     {"友情協力", "特别鸣谢"},
	"特效":       {"特殊効果"},
	"特摄效果":     {"特撮", "特摄效果"},
	"视觉效果":     {"ビジュアルエフェクト", "视觉效果"},
	"动作导演":     {"アクション監督", "动作导演"},
	"分镜协力":     {"コンテ協力", "分镜协力", "分鏡協力", "絵コンテ協力"},
	"分镜抄写":     {"絵コンテ清書", "コンテ清書", "分镜抄写"},
	"宣传":       {"パブリシティ", "宣伝", "広告宣伝", "番組宣伝", "宣传"},
	"台词编辑":     {"台詞編集", "台词编辑"},
	"剧本协调":     {"シナリオコーディネーター", "剧本协调"},
	"脚本协力":     {"脚本協力", "脚本协力"},
	"副系列构成":    {"副シリーズ構成", "副系列构成"},
	"构成协力":     {"構成協力", "构成协力"},
	"插画":       {"イラスト", "插画", "挿絵", "片尾插画"},
	"印象板":      {"イメージボード"},
	"色彩脚本":     {"カラースクリプト"},
	"总作画监督助理": {"総作監補", "総作監補佐", "総作監协力", "総作監協力",
		"総作画監督補", "総作画監督補佐", "総作画監督协力", "総作画監督協力",
		"作画総監督補", "作画総監督補佐", "作画総監督协力", "作画総監督協力",
		"总作监补佐", "总作监协力", "总作监助理", "总作画监督补佐", "总作画监督协力", "总作画监督助理"},
	"录音工作室":     {"録音スタジオ", "录音工作室"},
	"整音":        {"整音"},
	"音响制作担当":    {"音響制作担当"},
	"CG 制作进行":   {"CG制作進行", "CG制作进行"},
	"美术制作进行":    {"美術制作進行", "美术制作进行"},
	"监制":        {"监制"},
	"视觉导演":      {"ビジュアルディレクター", "视觉导演"},
	"转场绘":       {"転場絵"},
	"机设原案":      {"メカ原案"},
	"怪物设计":      {"怪物設計"},
	"故事概念":      {"ストーリーコンセプト"},
	"Bank 分镜演出": {"バンク演出"},
	"Live 分镜演出": {"ライブ演出"},
	"剧中剧分镜演出":   {"劇中劇演出"},
	"剧中剧人设":     {"劇中劇人設"},
	"音乐助理":      {"音楽アシスタント", "音乐助理"},
	"联合导演":      {"共同監督"},
	"联合制片人":     {"共同プロデューサー", "联合制片人"},
	"后期制片协调":    {"ポスプロコーディネーター"},
	"演员监督":      {"キャスティング監督", "演员监督"},
	"文艺制作":      {"文芸制作"},
	"数码绘图":      {"デジタル作画", "数码绘图"},
	"主题歌编曲":     {"OP編曲", "ED編曲"},
	"主题歌作曲":     {"OP作曲", "ED作曲"},
	"主题歌作词":     {"OP作詞", "ED作詞"},
	"主题歌演出":     {"OP歌手", "ED歌手"},
	"插入歌作词":     {"挿入歌作詞"},
	"插入歌作曲":     {"挿入歌作曲"},
	"插入歌编曲":     {"挿入歌編曲"},
	"插入歌演出":     {"挿入歌歌手"},
}

func (s *server) handleMissingEpisodes(w http.ResponseWriter, r *http.Request) {
	if r.Method != "GET" {
		writeJSON(w, http.StatusMethodNotAllowed, apiError{Error: "只支持GET请求"})
		return
	}

	if s.dbPath == "" {
		writeJSON(w, http.StatusBadRequest, apiError{Error: "需要 --db 参数指向已 ingest 的数据库"})
		return
	}

	if !s.allowedReferrer(r) {
		writeJSON(w, http.StatusForbidden, apiError{Error: "请求来源不在允许列表中"})
		return
	}

	name := r.PathValue("name")
	targetStr := r.URL.Query().Get("target")

	if name == "" {
		writeJSON(w, http.StatusBadRequest, apiError{Error: "name 为必填参数"})
		return
	}

	targetID, _ := strconv.Atoi(targetStr)

	positions := model.StaffPositions[2]

	lit2pid, combinedRe := buildEpPositionTable(positions)
	if combinedRe == nil {
		writeJSON(w, http.StatusInternalServerError, apiError{Error: "构建职位正则失败"})
		return
	}

	nameClean := strings.ReplaceAll(strings.ReplaceAll(name, "　", ""), " ", "")
	nameRe := regexp.MustCompile(fmt.Sprintf(`(?i)(^|%s|\n)%s($|%s|\n)`,
		delimClass, regexp.QuoteMeta(nameClean), delimClass))

	escapedNameSQL := query.EscapeLiteral(name)

	// Phases 0+1 run concurrently: the linked-subjects lookup and the wide
	// episode filter are independent DuckDB invocations, so overlapping them
	// hides the smaller query's latency behind the scan.
	var (
		linked   map[int]map[int]map[string]bool
		result   *query.QueryResult
		queryErr error
	)
	var wg sync.WaitGroup
	wg.Add(2)
	go func() {
		defer wg.Done()
		linked = queryLinked(r.Context(), s.dbPath, s.dataDir, escapedNameSQL, targetID)
	}()
	go func() {
		defer wg.Done()
		engine := query.NewEngine(s.dbPath, s.dataDir)
		result, queryErr = engine.ExecuteRaw(r.Context(), buildEpSearchSQL(escapedNameSQL))
	}()
	wg.Wait()

	if queryErr != nil {
		id := s.logQueryFailure(r, "missing-episodes", queryErr)
		writeJSON(w, http.StatusInternalServerError, apiError{Error: "查询失败（请求 ID: " + id + "）"})
		return
	}
	// Phase 2: Go position matching
	temp := collectEpMatches(result.Rows, lit2pid, combinedRe, nameRe, linked)

	type epSubjectMatched struct {
		Name     string           `json:"name"`
		Episodes map[int][]string `json:"episodes"`
	}

	type epSubjectUnmatched struct {
		Name     string        `json:"name"`
		Episodes []unmatchedEp `json:"episodes"`
	}

	matched := make(map[int]epSubjectMatched)
	unmatched := make(map[int]epSubjectUnmatched)
	for sid, subj := range temp {
		m, matchedSet := splitMatched(subj.Episodes)
		if len(m) > 0 {
			matched[sid] = epSubjectMatched{Name: subj.Name, Episodes: m}
		}
		var ue []unmatchedEp
		for _, ep := range subj.AllEps {
			if !matchedSet[ep.Label] && !subj.LinkedSet[ep.Label] {
				ue = append(ue, ep)
			}
		}
		if len(ue) > 0 {
			unmatched[sid] = epSubjectUnmatched{Name: subj.Name, Episodes: ue}
		}
	}

	resp := map[string]interface{}{
		"matched":   matched,
		"unmatched": unmatched,
	}

	writeJSON(w, http.StatusOK, resp)

}

func resolveOverlaps(matches [][]int) [][2]int {
	accepted := make([][2]int, 0, len(matches))
	for _, m := range matches {
		overlaps := false
		for _, a := range accepted {
			if m[0] < a[1] && m[1] > a[0] {
				overlaps = true
				break
			}
		}
		if !overlaps {
			accepted = append(accepted, [2]int{m[0], m[1]})
		}
	}
	return accepted
}

func buildEpPositionTable(positions map[int]string) (map[string]int, *regexp.Regexp) {
	lit2pid := make(map[string]int)
	var literals []string

	for posID, posName := range positions {
		lits, ok := positionLiterals[posName]
		if !ok {
			lits = []string{posName}
		}
		for _, lit := range lits {
			if _, exists := lit2pid[lit]; !exists {
				lit2pid[lit] = posID
				literals = append(literals, lit)
			}
		}
	}

	sort.Slice(literals, func(i, j int) bool {
		return len([]rune(literals[i])) > len([]rune(literals[j]))
	})

	for i, lit := range literals {
		literals[i] = regexp.QuoteMeta(lit)
	}

	pattern := strings.Join(literals, "|")
	re, err := regexp.Compile(pattern)
	if err != nil {
		return nil, nil
	}
	return lit2pid, re
}

func queryLinked(ctx context.Context, dbPath, dataDir, escapedNameSQL string, targetID int) map[int]map[int]map[string]bool {
	var sql string
	if targetID > 0 {
		sql = fmt.Sprintf(`
SELECT subject_id, position, COALESCE(appear_eps, '') AS appear_eps
FROM subject_persons sp
WHERE sp.person_id = %d
`, targetID)
	} else {
		sql = fmt.Sprintf(`
SELECT subject_id, position, COALESCE(appear_eps, '') AS appear_eps
FROM subject_persons sp
JOIN persons p ON sp.person_id = p.person_id
WHERE LOWER(REPLACE(REPLACE(TRIM(p.name), '　', ''), ' ', '')) = LOWER(REPLACE(REPLACE('%s', '　', ''), ' ', ''))
`, escapedNameSQL)
	}

	engine := query.NewEngine(dbPath, dataDir)
	result, err := engine.ExecuteRaw(ctx, sql)
	if err != nil {
		return make(map[int]map[int]map[string]bool)
	}

	linked := make(map[int]map[int]map[string]bool)
	for _, row := range result.Rows {
		if len(row) < 3 {
			continue
		}
		pid, _ := strconv.Atoi(row[1])
		sid, _ := strconv.Atoi(row[0])
		epSet := expandAppearEps(row[2])
		if linked[pid] == nil {
			linked[pid] = make(map[int]map[string]bool)
		}
		linked[pid][sid] = epSet
	}
	return linked
}

// unmatchedEp is a single episode that matched the description filter.
type unmatchedEp struct {
	EpisodeID int    `json:"episode_id"`
	Label     string `json:"label"`
}

// epSubject accumulates per-subject episode match state. Shared by the
// `missing episodes` CLI and the HTTP handler.
type epSubject struct {
	Name      string
	Episodes  map[int][]string
	AllEps    []unmatchedEp
	LinkedSet map[string]bool // labels already linked (to exclude from unmatched)
}

// buildEpSearchSQL returns the DuckDB wide-filter query for episode
// descriptions mentioning a person name. `escapedNameSQL` must already
// have single quotes escaped and name-space normalization is handled by
// the pattern below.
func buildEpSearchSQL(escapedNameSQL string) string {
	return fmt.Sprintf(`
SELECT e.episode_id, e.subject_id, s.name AS subject_name, e.sort, e.type, e.description
FROM episodes e
JOIN subjects s ON e.subject_id = s.id
WHERE e.disc = 0
  AND s.type = 2
  AND regexp_matches(e.description, '%s')
ORDER BY e.subject_id, e.sort, e.type
`, escapedNameSpaceTolerantPattern(escapedNameSQL))
}

// escapedNameSpaceTolerantPattern turns an escaped SQL name literal into a
// DuckDB regex matching its characters with optional U+3000/ASCII spaces
// between them: contains(N(desc), N(name)) — N stripping those spaces on
// both sides — is true exactly when a span of the description is the name's
// characters interleaved arbitrarily with such spaces, which is what this
// pattern accepts.
func escapedNameSpaceTolerantPattern(escapedNameSQL string) string {
	raw := strings.ReplaceAll(escapedNameSQL, "''", "'")

	var pat strings.Builder
	for _, r := range raw {
		switch r {
		case ' ', '　':
			continue
		}
		if pat.Len() > 0 {
			pat.WriteString(`[ 　]*`)
		}
		pat.WriteString(regexp.QuoteMeta(string(r)))
	}
	return pat.String()
}

// collectEpMatches runs position matching over DuckDB episode rows and
// returns per-subject accumulation. Shared by the `missing episodes` CLI
// and the HTTP handler; callers render CLI text or JSON.
func collectEpMatches(rows [][]string, lit2pid map[string]int, combinedRe, nameRe *regexp.Regexp, linked map[int]map[int]map[string]bool) map[int]*epSubject {
	temp := make(map[int]*epSubject)
	for _, row := range rows {
		if len(row) < 6 {
			continue
		}
		episodeID, _ := strconv.Atoi(row[0])
		sid, _ := strconv.Atoi(row[1])
		subjName := row[2]
		sortNum, _ := strconv.ParseFloat(row[3], 64)
		epType, _ := strconv.Atoi(row[4])
		desc := row[5]

		label := epLabel(sortNum, epType)
		cleanDesc := strings.ReplaceAll(desc, "\r", "")

		if temp[sid] == nil {
			temp[sid] = &epSubject{
				Name:     subjName,
				Episodes: make(map[int][]string),
			}
		}
		temp[sid].AllEps = append(temp[sid].AllEps, unmatchedEp{EpisodeID: episodeID, Label: label})

		allMatches := combinedRe.FindAllStringIndex(cleanDesc, -1)
		if allMatches == nil {
			continue
		}

		accepted := resolveOverlaps(allMatches)

		for i, m := range accepted {
			matchedStr := cleanDesc[m[0]:m[1]]
			posID, ok := lit2pid[matchedStr]
			if !ok {
				continue
			}

			if linked[posID] != nil {
				if epLabels, ok := linked[posID][sid]; ok {
					if epLabels[label] {
						if temp[sid].LinkedSet == nil {
							temp[sid].LinkedSet = make(map[string]bool)
						}
						temp[sid].LinkedSet[label] = true
						continue
					}
				}
			}

			segEnd := len(cleanDesc)
			if i+1 < len(accepted) {
				segEnd = accepted[i+1][0]
			}
			seg := cleanDesc[m[1]:segEnd]

			if !nameRe.MatchString(seg) {
				continue
			}

			temp[sid].Episodes[posID] = append(temp[sid].Episodes[posID], label)
		}
	}
	return temp
}

// splitMatched partitions a subject's position→labels map, returning the
// map along with the set of matched labels (used to exclude matched
// episodes from the unmatched list).
func splitMatched(episodes map[int][]string) (map[int][]string, map[string]bool) {
	matchedSet := make(map[string]bool)
	m := make(map[int][]string)
	for pid, labels := range episodes {
		m[pid] = labels
		for _, l := range labels {
			matchedSet[l] = true
		}
	}
	return m, matchedSet
}

func expandAppearEps(appearEps string) map[string]bool {
	result := make(map[string]bool)
	for _, part := range strings.Split(appearEps, ",") {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		if i := strings.Index(part, "-"); i > 0 {
			a, errA := strconv.Atoi(strings.TrimSpace(part[:i]))
			b, errB := strconv.Atoi(strings.TrimSpace(part[i+1:]))
			if errA == nil && errB == nil {
				if a > b {
					a, b = b, a
				}
				for v := a; v <= b; v++ {
					result[strconv.Itoa(v)] = true
				}
				continue
			}
		}
		result[part] = true
	}
	return result
}

func epLabel(sortNum float64, epType int) string {
	s := strconv.FormatFloat(sortNum, 'f', -1, 64)
	switch epType {
	case 0:
		return s
	case 1:
		return "SP" + s
	case 2:
		return "OP" + s
	case 3:
		return "ED" + s
	case 4:
		return "CM" + s
	case 5:
		return "MAD" + s
	default:
		return s
	}
}
