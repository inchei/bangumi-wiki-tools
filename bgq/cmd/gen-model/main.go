package main

import (
	"encoding/json"
	"fmt"
	"go/ast"
	"go/format"
	"go/parser"
	"go/token"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"text/template"
	"unicode"

	"gopkg.in/yaml.v3"
)

// const bangumiCommonBase = "https://raw.githubusercontent.com/bangumi/common/master"
const bangumiCommonBase = "https://ghfast.top/https://raw.githubusercontent.com/bangumi/common/master"

// bangumiServerBase hosts the archive command whose record structs define the
// columns of every jsonlines file in the archive release.
const bangumiServerBase = "https://ghfast.top/https://raw.githubusercontent.com/bangumi/server/master"

//go:generate cp -r templates ../../internal/model/templates

func main() {
	dataDir := "../bangumi_archive"
	outDir := "internal/model"
	noMetaTags := false
	archiveOnly := false

	for i := 1; i < len(os.Args); i++ {
		switch os.Args[i] {
		case "--data-dir":
			if i+1 < len(os.Args) {
				dataDir = os.Args[i+1]
				i++
			}
		case "--out-dir":
			if i+1 < len(os.Args) {
				outDir = os.Args[i+1]
				i++
			}
		case "--no-meta-tags":
			// Skip archive-dependent outputs (metatags.go, schema-data.js
			// meta tags) so the rest can regenerate without a local archive.
			noMetaTags = true
		case "--archive-only":
			// Only regenerate internal/archive from the upstream schema.
			archiveOnly = true
		}
	}

	if archiveOnly {
		fmt.Println("Generating archive schema...")
		fmt.Println("  Downloading from bangumi/server...")
		generateArchiveTables(
			downloadFile(bangumiServerBase+"/cmd/archive/main.go"),
			findArchiveDir(),
			findTemplatesDir(),
		)
		fmt.Println("Done!")
		return
	}

	if outDir == "internal/model" {
		if _, err := os.Stat("model.go"); err == nil {
			outDir = "."
		}
	}

	// Find templates directory
	tmplDir := findTemplatesDir()

	fmt.Println("Generating model data...")
	fmt.Println("  Downloading from bangumi/common...")

	archiveSrc := downloadFile(bangumiServerBase + "/cmd/archive/main.go")
	platformsYAML := downloadFile(bangumiCommonBase + "/subject_platforms.yml")
	subjectRelationsYAML := downloadFile(bangumiCommonBase + "/subject_relations.yml")
	personRelationsYAML := downloadFile(bangumiCommonBase + "/person_relations.yml")
	staffYAML := downloadFile(bangumiCommonBase + "/subject_staffs.yml")
	wikiTemplateYAML := downloadFile(bangumiCommonBase + "/wiki_template.yml")

	var data StaffYAML
	if err := yaml.Unmarshal(staffYAML, &data); err != nil {
		fmt.Fprintf(os.Stderr, "Failed to parse subject_staffs.yml: %v\n", err)
		os.Exit(1)
	}

	if types, ok := data.Define.Types["anime"]; ok {
		delete(types, 23)
		var err error
		if staffYAML, err = yaml.Marshal(data); err != nil {
			fmt.Fprintf(os.Stderr, "Failed to marshal staff data: %v\n", err)
			os.Exit(1)
		}
	}

	fmt.Println("  Generating platform.go...")
	generatePlatform(platformsYAML, outDir, tmplDir)

	fmt.Println("  Generating internal/archive tables...")
	generateArchiveTables(archiveSrc, findArchiveDir(), tmplDir)

	fmt.Println("  Generating relation_data.go...")
	generateRelationData(subjectRelationsYAML, personRelationsYAML, outDir, tmplDir)

	fmt.Println("  Generating staff_data.go...")
	generateStaffData(staffYAML, outDir, tmplDir)

	frontendDir := "../../frontend/src"
	if _, err := os.Stat(frontendDir); err == nil {
		fmt.Println("  Generating infobox-fields.js...")
		generateInfoboxFields(wikiTemplateYAML, frontendDir)
		if noMetaTags {
			fmt.Println("  Skipping schema-data.js (meta tags need local archive, --no-meta-tags)")
		} else {
			fmt.Println("  Generating schema-data.js...")
			generateSchemaData(platformsYAML, subjectRelationsYAML, personRelationsYAML, staffYAML, dataDir, frontendDir, tmplDir)
		}
	}

	commonDir := findPackageDir("userscripts/userscript-common")
	if commonDir != "" {
		fmt.Println("  Generating position-ids.js...")
		generatePositionIDs(staffYAML, commonDir)
	}

	wikiEpStaffRelateDir := findPackageDir("userscripts/wikiEpStaffRelate/src")
	if wikiEpStaffRelateDir != "" {
		fmt.Println("  Generating positions.generated.js...")
		generateStaffFallbackPositions(staffYAML, wikiEpStaffRelateDir)
	}

	wikiBatchDir := findPackageDir("userscripts/wikiBatch/src")
	if wikiBatchDir != "" {
		fmt.Println("  Generating infobox-field-order.ts...")
		generateInfoboxFieldOrder(wikiTemplateYAML, wikiBatchDir)
	}

	if noMetaTags {
		fmt.Println("  Skipping metatags.go (--no-meta-tags)")
	} else {
		fmt.Println("  Generating metatags.go...")
		generateMetaTags(dataDir, outDir, tmplDir)
	}

	fmt.Println("Done!")
}

// findArchiveDir locates internal/archive/ so the generator can write
// tables_gen.go next to the hand-written archive.go.
func findArchiveDir() string {
	for _, p := range []string{"../archive", "internal/archive", "../../internal/archive"} {
		if st, err := os.Stat(p); err == nil && st.IsDir() {
			return p
		}
	}
	fmt.Fprintf(os.Stderr, "Cannot find internal/archive directory\n")
	os.Exit(1)
	return ""
}

// archiveTableSpec maps an upstream record struct to a bgq table.
type archiveTableSpec struct {
	Var      string            // generated variable name
	Struct   string            // struct in bangumi/server cmd/archive
	Name     string            // table / CTE name
	File     string            // jsonlines file name
	Where    string            // optional row filter
	Renames  map[string]string // column -> alias
	Coalesce map[string]bool   // columns wrapped in COALESCE(x,'')
}

func archiveTableSpecs() []archiveTableSpec {
	return []archiveTableSpec{
		{Var: "Subjects", Struct: "Subject", Name: "subjects", File: "subject.jsonlines"},
		{Var: "Persons", Struct: "Person", Name: "persons", File: "person.jsonlines",
			Renames:  map[string]string{"id": "person_id", "type": "person_type"},
			Coalesce: map[string]bool{"infobox": true}},
		{Var: "Characters", Struct: "Character", Name: "characters", File: "character.jsonlines",
			Renames:  map[string]string{"id": "character_id"},
			Coalesce: map[string]bool{"infobox": true}},
		{Var: "SubjectRelations", Struct: "SubjectRelation", Name: "subject_relations", File: "subject-relations.jsonlines"},
		{Var: "SubjectPersons", Struct: "SubjectPerson", Name: "subject_persons", File: "subject-persons.jsonlines"},
		{Var: "SubjectCharacters", Struct: "SubjectCharacter", Name: "subject_characters", File: "subject-characters.jsonlines"},
		{Var: "Episodes", Struct: "Episode", Name: "episodes", File: "episode.jsonlines",
			Renames: map[string]string{"id": "episode_id"}},
		{Var: "PersonRelations", Struct: "PersonRelation", Name: "person_relations", File: "person-relations.jsonlines",
			Where: "person_type = 'prsn'"},
		{Var: "CharacterRelations", Struct: "PersonRelation", Name: "character_relations", File: "person-relations.jsonlines",
			Where: "person_type = 'crt'"},
		{Var: "PersonCharacters", Struct: "PersonCharacter", Name: "person_characters", File: "person-characters.jsonlines"},
	}
}

// parseArchiveRecordFields returns the json field names of an upstream record
// struct, in declaration order. Parsing (not type-checking) the downloaded
// source keeps this independent of the upstream module's dependencies.
func parseArchiveRecordFields(src []byte, structName string) []string {
	fset := token.NewFileSet()
	file, err := parser.ParseFile(fset, "archive_main.go", src, parser.SkipObjectResolution)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Failed to parse bangumi/server archive command: %v\n", err)
		os.Exit(1)
	}
	for _, decl := range file.Decls {
		gen, ok := decl.(*ast.GenDecl)
		if !ok || gen.Tok != token.TYPE {
			continue
		}
		for _, spec := range gen.Specs {
			ts, ok := spec.(*ast.TypeSpec)
			if !ok || ts.Name.Name != structName {
				continue
			}
			st, ok := ts.Type.(*ast.StructType)
			if !ok {
				fmt.Fprintf(os.Stderr, "%s is not a struct\n", structName)
				os.Exit(1)
			}
			var fields []string
			for _, field := range st.Fields.List {
				if len(field.Names) == 0 || field.Tag == nil {
					continue
				}
				m := jsonTagRe.FindStringSubmatch(field.Tag.Value)
				if m == nil || m[1] == "-" {
					continue
				}
				fields = append(fields, m[1])
			}
			if len(fields) == 0 {
				fmt.Fprintf(os.Stderr, "%s has no json-tagged fields\n", structName)
				os.Exit(1)
			}
			return fields
		}
	}
	fmt.Fprintf(os.Stderr, "Struct %s not found in bangumi/server archive command\n", structName)
	os.Exit(1)
	return nil
}

var jsonTagRe = regexp.MustCompile(`json:"([^",]+)"`)

func archiveSelect(fields []string, spec archiveTableSpec) string {
	parts := make([]string, 0, len(fields))
	for _, name := range fields {
		col := quoteIdent(name)
		switch {
		case spec.Renames[name] != "":
			parts = append(parts, col+" as "+spec.Renames[name])
		case spec.Coalesce[name]:
			parts = append(parts, "COALESCE("+col+",'') as "+name)
		default:
			parts = append(parts, col)
		}
	}
	return strings.Join(parts, ", ")
}

// quoteIdent quotes an archive column so reserved words (e.g. `order`) stay
// usable and future ones cannot break the generated schema.
func quoteIdent(name string) string {
	return `"` + name + `"`
}

func generateArchiveTables(src []byte, archiveDir, tmplDir string) {
	type tableData struct {
		Var, Name, File, Select, Where string
	}

	var tables []tableData
	for _, spec := range archiveTableSpecs() {
		fields := parseArchiveRecordFields(src, spec.Struct)
		tables = append(tables, tableData{
			Var:    spec.Var,
			Name:   spec.Name,
			File:   spec.File,
			Select: archiveSelect(fields, spec),
			Where:  spec.Where,
		})
	}

	tmpl := loadTemplate(tmplDir, "archive_tables.go.tmpl")
	var sb strings.Builder
	if err := tmpl.Execute(&sb, struct{ Tables []tableData }{tables}); err != nil {
		log.Fatal(err)
	}
	writeToFile(filepath.Join(archiveDir, "tables_gen.go"), sb.String())
}

func findTemplatesDir() string {
	// Try relative to executable
	if _, err := os.Stat("templates"); err == nil {
		return "templates"
	}
	// Try relative to module root
	if _, err := os.Stat("cmd/gen-model/templates"); err == nil {
		return "cmd/gen-model/templates"
	}
	// Try from internal/model
	if _, err := os.Stat("../../cmd/gen-model/templates"); err == nil {
		return "../../cmd/gen-model/templates"
	}
	fmt.Fprintf(os.Stderr, "Cannot find templates directory\n")
	os.Exit(1)
	return ""
}

// --- Download ---

func downloadFile(url string) []byte {
	resp, err := http.Get(url)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Failed to download %s: %v\n", url, err)
		os.Exit(1)
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != 200 {
		fmt.Fprintf(os.Stderr, "Failed to download %s: HTTP %d\n", url, resp.StatusCode)
		os.Exit(1)
	}
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Failed to read response: %v\n", err)
		os.Exit(1)
	}
	return body
}

// --- YAML structures ---

type PlatformItem struct {
	ID     int    `yaml:"id"`
	TypeCN string `yaml:"type_cn"`
}

type PlatformYAML struct {
	Platforms map[string]map[string]PlatformItem `yaml:"platforms"`
}

type RelationItem struct {
	CN string `yaml:"cn"`
}

type RelationYAML struct {
	Define struct {
		Types map[string]map[int]RelationItem `yaml:"types"`
	} `yaml:"define"`
}

type StaffItem struct {
	CN string `yaml:"cn"`
	JP string `yaml:"jp"`
}

type StaffYAML struct {
	Define struct {
		Types map[string]map[int]StaffItem `yaml:"types"`
	} `yaml:"define"`
}

func generatePositionIDs(staffYAML []byte, outDir string) {
	var data StaffYAML
	if err := yaml.Unmarshal(staffYAML, &data); err != nil {
		fmt.Fprintf(os.Stderr, "Failed to parse subject_staffs.yml: %v\n", err)
		os.Exit(1)
	}

	yamlToCode := map[string]int{
		"book": 1, "anime": 2, "music": 3, "game": 4, "real": 6,
	}

	var sb strings.Builder
	sb.WriteString("export const POSITION_IDS = {\n")
	keys := sortedStringKeys(yamlToCode)
	for _, yt := range keys {
		tc := yamlToCode[yt]
		ps := data.Define.Types[yt]
		if len(ps) == 0 {
			continue
		}
		fmt.Fprintf(&sb, "  %d: {\n", tc)
		codes := sortedIntKeys(ps)
		for _, c := range codes {
			fmt.Fprintf(&sb, "    %d: '%s',\n", c, ps[c].CN)
		}
		sb.WriteString("  },\n")
	}
	sb.WriteString("};\n")

	writeToFile(filepath.Join(outDir, "position-ids.js"), sb.String())
}

// --- Staff fallback positions (wikiEpStaffRelate) ---
//
// skip semantics: these official positions are already covered behavior-wise
// by hand-written curated patterns, or the keyword literal cannot be
// disambiguated with assertions; no fallback is generated and matched text is
// attributed to the curated position. Entries previously reasoned as "covered
// by curated X/Y patterns" were removed in the 2024-10 assertion refinement
// (see git history).

var fallbackSkip = map[string]string{
	"製作":        "identical literal to the curated 制作 keyword (?:製作|制作): both kws match the same text, assertions cannot separate identical strings; keeping the curated merge into 制作",
	"系列监督":      "official JP シリーズ監督 is mapped to 导演 in the yml and curated includes it in its keyword by design",
	"Bank 分镜演出": "curated 分镜 (コンテ) already catches バンク( ?)コンテ・演出 via the SEP コンテ・; prefixes vary freely (バンク/Bank/space/劇中劇/ライブ), the kw lookbehind wall would need fragile optional-space alternatives; label stays 分镜",
	"Live 分镜演出": "same as Bank 分镜演出",
	"剧中剧分镜演出":   "same as Bank 分镜演出",
}

// Official JP synonyms must not produce relations on their own for these
// positions (助監督/監督補佐/監督助手 are recognition-only here, never related
// as 副导演); only the CN-name pattern is emitted.
var fallbackJpSuppress = map[string]bool{
	"副导演": true,
}

// Synonyms for positions whose official JP name is empty (jp: "" in the yml).
var fallbackSpecial = map[string]string{
	"数码绘图": "デジタル彩色|数码绘图",
}

// jpPrefixWords: leading tokens that fuse with the following word to form one
// composite synonym ("OP・ED アニメーション制作", "劇中劇 キャラクターデザイン",
// "CG 監督補佐"); everything else splits into standalone synonyms (the yml
// separates alternate spellings of one position with whitespace/slashes).
var jpPrefixWords = map[string]bool{
	"OP・ED": true,
	"OP":    true,
	"ED":    true,
	"CG":    true,
	"3DCG":  true,
	"劇中劇":   true,
}

var jpPrefixVariants = map[string][]string{
	"OP・ED": {"OP・ED", "OP", "ED"},
}

// kw guards for generated patterns whose bare keyword over-matches a longer
// official position's substring (3DCG 監督… also matches the CG keyword).
var nameKwGuards = map[string]string{
	"CG 导演助理": "(?<!3D)",
}

var fallbackReplacements = []struct {
	from string
	to   string
}{
	{"主题歌", "主題歌|主题歌"},
	{"插入歌", "挿入歌|插入歌"},
	{"制片人", "プロデューサー|制片人"},
	{"制作人", "プロデューサー|制片人|制作人"},
	{"动画师", "アニメーター|动画师"},
	{"监督", "監督|监督"},
	{"导演", "監督|导演|ディレクター"},
	{"设计", "設計|设计"},
	{"设定", "設定|设定"},
	{"协力", "協力|协力"},
	{"视觉", "ビジュアル|视觉"},
	{"概念", "コンセプト|概念"},
	{"怪物", "モンスター|怪物"},
	{"故事", "ストーリー|故事"},
	{"演员", "演員|演员"},
	{"事务", "事務|事务"},
	{"转场", "トランジション|转场"},
	{"发行", "配給|发行"},
	{"制作", "制作|製作"},
	{"动画", "アニメーション|動畫|动画"},
	{"作词", "作詞|作词"},
	{"编曲", "編曲|编曲"},
}

// findPackageDir walks up from the CWD looking for a repository-relative directory,
// so the output branches do not depend on a fixed run directory.
func findPackageDir(rel string) string {
	dir, err := os.Getwd()
	if err != nil {
		return ""
	}
	for {
		if p := filepath.Join(dir, rel); dirExists(p) {
			return p
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return ""
		}
		dir = parent
	}
}

func dirExists(p string) bool {
	info, err := os.Stat(p)
	return err == nil && info.IsDir()
}

func buildFallbackPattern(name, jp string) string {
	variants := []string{buildCNFallback(name)}
	if jp != "" && !fallbackJpSuppress[name] {
		variants = append(variants, jpSynonymAlts(name, jp)...)
	}
	p := "(?:" + strings.Join(variants, "|") + ")"
	if guard, ok := nameKwGuards[name]; ok {
		p = guard + p
	}
	return p
}

// buildCNFallback: mechanical transform of the CN name (synonym replacement
// table + optional spaces + trailing group wrap).
func buildCNFallback(name string) string {
	if alt, ok := fallbackSpecial[name]; ok {
		return "(?:" + alt + ")"
	}
	type token struct {
		text  string
		group bool
	}
	tokens := []token{{name, false}}
	for _, rep := range fallbackReplacements {
		var out []token
		changed := false
		for _, t := range tokens {
			if t.group || !strings.Contains(t.text, rep.from) {
				out = append(out, t)
				continue
			}
			changed = true
			segs := strings.Split(t.text, rep.from)
			for i, s := range segs {
				if s != "" {
					out = append(out, token{s, false})
				}
				if i < len(segs)-1 {
					out = append(out, token{"(?:" + rep.to + ")", true})
				}
			}
		}
		if changed {
			tokens = out
		}
	}
	pattern := ""
	// Wrap a trailing plain keyword segment so the pattern always ends with a
	// `(?:...)` group; regexes.js inserts fullwidth-space tolerance only inside
	// the last group.
	if !tokens[len(tokens)-1].group {
		tokens[len(tokens)-1].text = "(?:" + tokens[len(tokens)-1].text + ")"
	}
	for _, t := range tokens {
		pattern += t.text
	}
	return strings.ReplaceAll(pattern, " ", "(?: ?)")
}

// jpSynonymAlts: official JP synonyms -> regex alternatives. Spaces become
// optional; a few suffix variants (ディレクター→監督, 補佐→補, 制作/製作 before
// 進行, サブキャラ→副キャラ) close the surfaces curated assertions carve out.
func jpSynonymAlts(name, jp string) []string {
	words := strings.FieldsFunc(jp, func(r rune) bool { return r == '/' || unicode.IsSpace(r) })
	var syns []string
	for i := 0; i < len(words); i++ {
		// consecutive Latin words fuse into one synonym ("Insert Song Lyrics")
		if isLatinWord(words[i]) && i+1 < len(words) && isLatinWord(words[i+1]) {
			merged := words[i]
			for i+1 < len(words) && isLatinWord(words[i+1]) {
				i++
				merged += " " + words[i]
			}
			syns = append(syns, merged)
			continue
		}
		if jpPrefixWords[words[i]] && i+1 < len(words) {
			syns = append(syns, words[i]+" "+words[i+1])
			i++
		} else {
			syns = append(syns, words[i])
		}
	}
	var out []string
	addSyn := func(s string) {
		if skipJPSynonym(s) {
			return
		}
		// unofficial spellings starting with 監督 would match inside
		// 作画監督補佐 / (3D)CG監督補佐 etc.; guard them like the curated
		// pseudo position does with (?<!作画).
		guard := ""
		if strings.HasPrefix(s, "監督") {
			guard = "(?<!作画|CGI|3DCG|CG)"
		}
		out = append(out, "(?:"+guard+strings.ReplaceAll(s, " ", "(?: ?)")+")")
	}
	for _, s := range syns {
		variants := []string{s}
		if strings.HasSuffix(s, "ディレクター") {
			variants = append(variants, strings.TrimSuffix(s, "ディレクター")+"監督")
		}
		if strings.Contains(s, "補佐") {
			variants = append(variants, strings.Replace(s, "補佐", "補", 1))
		}
		if strings.Contains(s, "進行") {
			variants = append(variants, strings.Replace(s, "進行", "(?:制作|製作)?進行", 1))
		}
		if strings.HasPrefix(s, "サブキャラクター") {
			variants = append(variants, strings.Replace(s, "サブ", "副", 1))
		}
		for _, v := range variants {
			addSyn(v)
		}
		// composites like "OP・ED アニメーション制作": curated lookbehind
		// excludes by OP・ED/OP/ED prefix, so expand per prefix and add the
		// アニメ short form.
		for _, prefix := range sortedStringKeys(jpPrefixVariants) {
			rest, ok := strings.CutPrefix(s, prefix+" ")
			if !ok {
				continue
			}
			for _, pv := range jpPrefixVariants[prefix] {
				addSyn(pv + " " + rest)
				if strings.Contains(rest, "アニメーション") {
					addSyn(pv + " " + strings.Replace(rest, "アニメーション", "アニメ", 1))
				}
			}
		}
	}
	// dedupe identical alternatives (expanded prefix variants can collide
	// with the base synonym)
	seen := map[string]bool{}
	dedup := make([]string, 0, len(out))
	for _, v := range out {
		if seen[v] {
			continue
		}
		seen[v] = true
		dedup = append(dedup, v)
	}
	return dedup
}

// skipJPSynonym drops standalone words without kanji that are too short
// (2D, ワークス) — they would false-match generic text like studio names.
func skipJPSynonym(v string) bool {
	if len([]rune(v)) < 5 && !containsKanji(v) {
		return true
	}
	return false
}

func isLatinWord(w string) bool {
	for _, r := range w {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9', r == '-':
		default:
			return false
		}
	}
	return len(w) > 0
}

func containsKanji(s string) bool {
	for _, r := range s {
		if r >= 0x4e00 && r <= 0x9fff {
			return true
		}
	}
	return false
}

func generateStaffFallbackPositions(staffYAML []byte, outDir string) {
	var data StaffYAML
	if err := yaml.Unmarshal(staffYAML, &data); err != nil {
		fmt.Fprintf(os.Stderr, "Failed to parse subject_staffs.yml: %v\n", err)
		os.Exit(1)
	}
	positions := data.Define.Types["anime"]
	if len(positions) == 0 {
		fmt.Fprintln(os.Stderr, "No anime staff positions in subject_staffs.yml")
		os.Exit(1)
	}

	official := map[string]bool{}
	jpNames := map[string]string{}
	for _, ps := range positions {
		official[ps.CN] = true
		jpNames[ps.CN] = ps.JP
	}

	curated := map[string]bool{}
	curatedData, err := os.ReadFile(filepath.Join(outDir, "positions.js"))
	if err != nil {
		fmt.Fprintf(os.Stderr, "Failed to read positions.js: %v\n", err)
		os.Exit(1)
	}
	curatedRe := regexp.MustCompile(`name: '([^']+)'`)
	for _, m := range curatedRe.FindAllStringSubmatch(string(curatedData), -1) {
		curated[m[1]] = true
	}
	synthetic := map[string]bool{"監督補佐": true}
	for name := range curated {
		if !official[name] && !synthetic[name] {
			fmt.Fprintf(os.Stderr, "Stale curated position name (not in subject_staffs.yml): %s\n", name)
		}
	}

	jsQuote := func(s string) string { return "'" + strings.ReplaceAll(s, "'", "\\'") + "'" }

	var sb strings.Builder
	sb.WriteString("// Generated by `go generate ./internal/model/` (bgq/cmd/gen-model) from bangumi/common subject_staffs.yml.\n")
	sb.WriteString("// Curated patterns live in positions.js; do not edit generated entries by hand.\n")
	sb.WriteString("export const FALLBACK_POSITIONS = [\n")
	generated := 0
	for _, code := range sortedIntKeys(positions) {
		name := positions[code].CN
		if curated[name] {
			continue
		}
		if _, ok := fallbackSkip[name]; ok {
			continue
		}
		sb.WriteString("  { name: " + jsQuote(name) + ", pattern: " + jsQuote(buildFallbackPattern(name, jpNames[name])) + " },\n")
		generated++
	}
	sb.WriteString("];\n")
	writeToFile(filepath.Join(outDir, "positions.generated.js"), sb.String())
	fmt.Printf("  %d fallback positions generated\n", generated)
}

// --- Helpers ---

func sortedStringKeys[V any](m map[string]V) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}

func sortedIntKeys[V any](m map[int]V) []int {
	keys := make([]int, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Ints(keys)
	return keys
}

// --- Infobox Field Order ---

type infoboxTemplate struct {
	YAMLKey string
	Header  string
	Fields  []string
}

func parseInfoboxTemplates(yamlData []byte) []infoboxTemplate {
	var data map[string]string
	if err := yaml.Unmarshal(yamlData, &data); err != nil {
		fmt.Fprintf(os.Stderr, "Failed to parse wiki_template.yml: %v\n", err)
		os.Exit(1)
	}

	fieldRe := regexp.MustCompile(`(?m)^\|([^|=]+?)\s*=`)
	headerRe := regexp.MustCompile(`{{Infobox\s+(.+)`)

	var templates []infoboxTemplate
	for _, key := range sortedStringKeys(data) {
		template := data[key]
		headerMatch := headerRe.FindStringSubmatch(template)
		if headerMatch == nil {
			continue
		}
		header := strings.TrimSpace(headerMatch[1])

		var fields []string
		seen := make(map[string]bool)
		for _, m := range fieldRe.FindAllStringSubmatch(template, -1) {
			name := strings.TrimSpace(m[1])
			if name != "" && !seen[name] {
				fields = append(fields, name)
				seen[name] = true
			}
		}

		templates = append(templates, infoboxTemplate{key, header, fields})
	}
	return templates
}

func generateInfoboxFieldOrder(yamlData []byte, outDir string) {
	templates := parseInfoboxTemplates(yamlData)

	var sb strings.Builder
	sb.WriteString("// Auto-generated by go generate from bangumi/common/wiki_template.yml\n")
	sb.WriteString("\n")

	sb.WriteString("export const INFOBOX_FIELD_ORDER: Record<string, string[]> = {\n")
	for _, t := range templates {
		if len(t.Fields) == 0 {
			continue
		}
		fmt.Fprintf(&sb, "  '%s': ['", t.YAMLKey)
		for i, f := range t.Fields {
			if i > 0 {
				sb.WriteString("', '")
			}
			sb.WriteString(f)
		}
		sb.WriteString("'],\n")
	}
	sb.WriteString("};\n\n")

	sb.WriteString("export const INFOBOX_HEADER_MAP: Record<string, string> = {\n")
	for _, t := range templates {
		fmt.Fprintf(&sb, "  '%s': '%s',\n", t.Header, t.YAMLKey)
	}
	sb.WriteString("};\n")

	writeToFile(filepath.Join(outDir, "infobox-field-order.ts"), sb.String())
}

// --- Frontend Infobox Fields ---

var infoboxHeaderType = map[string]int{
	"animanga/Book":       1,
	"animanga/Manga":      1,
	"animanga/Novel":      1,
	"animanga/BookSeries": 1,
	"Book/PhotoBook":      1,
	"doujin/Book":         1,
	"animanga/TVAnime":    2,
	"animanga/OVA":        2,
	"animanga/Movie":      2,
	"animanga/Anime":      2,
	"Album":               3,
	"doujin/Album":        3,
	"Game":                4,
	"doujin/Game":         4,
	"real/Television":     6,
	"real/Movie":          6,
}

func generateInfoboxFields(yamlData []byte, outDir string) {
	templates := parseInfoboxTemplates(yamlData)

	typeFields := make(map[int][]string)
	typeSeen := make(map[int]map[string]bool)
	var all []string
	allSeen := make(map[string]bool)
	var crt []string
	crtSeen := make(map[string]bool)

	add := func(dst *[]string, seen map[string]bool, fields []string) {
		for _, f := range fields {
			if !seen[f] {
				seen[f] = true
				*dst = append(*dst, f)
			}
		}
	}

	for _, t := range templates {
		if t.Header == "Crt" {
			add(&crt, crtSeen, t.Fields)
			continue
		}
		tc, ok := infoboxHeaderType[t.Header]
		if !ok {
			continue
		}
		if typeSeen[tc] == nil {
			typeSeen[tc] = make(map[string]bool)
		}
		fields := typeFields[tc]
		add(&fields, typeSeen[tc], t.Fields)
		typeFields[tc] = fields
		add(&all, allSeen, t.Fields)
	}

	writeList := func(sb *strings.Builder, name string, fields []string) {
		fmt.Fprintf(sb, "export const %s = [", name)
		for i, f := range fields {
			if i > 0 {
				sb.WriteString(", ")
			}
			fmt.Fprintf(sb, "'%s'", f)
		}
		sb.WriteString("];\n")
	}

	var sb strings.Builder
	sb.WriteString("// Auto-generated by go generate from bangumi/common/wiki_template.yml\n")
	sb.WriteString("\n")
	sb.WriteString("export const INFOBOX_FIELDS_BY_TYPE = {\n")
	for _, tc := range []int{1, 2, 3, 4, 6} {
		fmt.Fprintf(&sb, "  %d: [", tc)
		for i, f := range typeFields[tc] {
			if i > 0 {
				sb.WriteString(", ")
			}
			fmt.Fprintf(&sb, "'%s'", f)
		}
		sb.WriteString("],\n")
	}
	sb.WriteString("};\n\n")
	writeList(&sb, "INFOBOX_FIELDS_ALL", all)
	writeList(&sb, "INFOBOX_FIELDS_PERSON", crt)
	writeList(&sb, "INFOBOX_FIELDS_CHARACTER", crt)
	sb.WriteString("\n")
	sb.WriteString("export function infoboxFieldsByType(typeCode) {\n")
	sb.WriteString("  return INFOBOX_FIELDS_BY_TYPE[typeCode] || INFOBOX_FIELDS_ALL;\n")
	sb.WriteString("}\n")

	writeToFile(filepath.Join(outDir, "infobox-fields.js"), sb.String())
}

func writeToFile(path, content string) {
	data := []byte(content)
	if strings.HasSuffix(path, ".go") {
		if formatted, err := format.Source(data); err == nil {
			data = formatted
		}
	}
	if err := os.WriteFile(path, data, 0644); err != nil {
		fmt.Fprintf(os.Stderr, "Failed to write %s: %v\n", path, err)
		os.Exit(1)
	}
}

func loadTemplate(tmplDir, name string) *template.Template {
	path := filepath.Join(tmplDir, name)
	data, err := os.ReadFile(path)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Failed to read template %s: %v\n", path, err)
		os.Exit(1)
	}
	tmpl, err := template.New(name).Parse(string(data))
	if err != nil {
		fmt.Fprintf(os.Stderr, "Failed to parse template %s: %v\n", path, err)
		os.Exit(1)
	}
	return tmpl
}

// --- Platform ---

func generatePlatform(yamlData []byte, outDir, tmplDir string) {
	var data PlatformYAML
	if err := yaml.Unmarshal(yamlData, &data); err != nil {
		fmt.Fprintf(os.Stderr, "Failed to parse subject_platforms.yml: %v\n", err)
		os.Exit(1)
	}

	type entry struct{ Code, Name string }
	type platformData struct {
		Name    string
		Entries []entry
	}

	yamlToGo := map[string]string{
		"1": "Book", "2": "Anime", "3": "Music", "4": "Game", "6": "Real",
	}

	yamlKeys := sortedStringKeys(yamlToGo)
	var platforms []platformData
	for _, yamlKey := range yamlKeys {
		goType := yamlToGo[yamlKey]
		var entries []entry
		if ps, ok := data.Platforms[yamlKey]; ok {
			ids := make([]int, 0, len(ps))
			for _, p := range ps {
				ids = append(ids, p.ID)
			}
			sort.Ints(ids)
			for _, id := range ids {
				for _, p := range ps {
					if p.ID == id {
						entries = append(entries, entry{fmt.Sprint(p.ID), p.TypeCN})
						break
					}
				}
			}
		}
		platforms = append(platforms, platformData{goType, entries})
	}

	tmpl := loadTemplate(tmplDir, "platform.go.tmpl")
	var sb strings.Builder
	if err := tmpl.Execute(&sb, struct{ Platforms []platformData }{platforms}); err != nil {
		log.Fatal(err)
	}
	writeToFile(filepath.Join(outDir, "platform.go"), sb.String())
}

// --- Relation Data ---

func generateRelationData(subjectYAML, personYAML []byte, outDir, tmplDir string) {
	var subjectData RelationYAML
	if err := yaml.Unmarshal(subjectYAML, &subjectData); err != nil {
		fmt.Fprintf(os.Stderr, "Failed to parse subject_relations.yml: %v\n", err)
		os.Exit(1)
	}
	var personData RelationYAML
	if err := yaml.Unmarshal(personYAML, &personData); err != nil {
		fmt.Fprintf(os.Stderr, "Failed to parse person_relations.yml: %v\n", err)
		os.Exit(1)
	}

	type relEntry struct{ Code, Name string }
	type relType struct {
		GoType  string
		Entries []relEntry
	}

	yamlToGo := map[string]string{
		"book": "Book", "anime": "Anime", "music": "Music",
		"game": "Game", "real": "Real",
	}

	ytKeys := sortedStringKeys(yamlToGo)
	var relTypes []relType
	for _, yt := range ytKeys {
		gt := yamlToGo[yt]
		var entries []relEntry
		if rels, ok := subjectData.Define.Types[yt]; ok {
			codes := sortedIntKeys(rels)
			for _, c := range codes {
				entries = append(entries, relEntry{fmt.Sprint(c), rels[c].CN})
			}
		}
		relTypes = append(relTypes, relType{gt, entries})
	}

	toEntries := func(m map[int]RelationItem) []relEntry {
		codes := sortedIntKeys(m)
		var entries []relEntry
		for _, c := range codes {
			entries = append(entries, relEntry{fmt.Sprint(c), m[c].CN})
		}
		return entries
	}

	var personEntries, charEntries []relEntry
	if pt, ok := personData.Define.Types["person"]; ok {
		personEntries = toEntries(pt)
	}
	if ct, ok := personData.Define.Types["character"]; ok {
		charEntries = toEntries(ct)
	}

	tmpl := loadTemplate(tmplDir, "relation_data.go.tmpl")
	data := struct {
		RelTypes      []relType
		PersonEntries []relEntry
		CharEntries   []relEntry
	}{relTypes, personEntries, charEntries}

	var sb strings.Builder
	if err := tmpl.Execute(&sb, data); err != nil {
		log.Fatal(err)
	}
	writeToFile(filepath.Join(outDir, "relation_data.go"), sb.String())
}

// --- Staff Data ---

func generateStaffData(yamlData []byte, outDir, tmplDir string) {
	var data StaffYAML
	if err := yaml.Unmarshal(yamlData, &data); err != nil {
		fmt.Fprintf(os.Stderr, "Failed to parse subject_staffs.yml: %v\n", err)
		os.Exit(1)
	}

	type staffEntry struct{ Code, Name string }
	type staffType struct {
		Prefix, Comment string
		Entries         []staffEntry
	}

	yamlToVar := map[string]string{
		"book": "book", "anime": "anime", "music": "music",
		"game": "game", "real": "real",
	}
	yamlToComment := map[string]string{
		"book": "书籍", "anime": "动画", "music": "音乐",
		"game": "游戏", "real": "三次元",
	}

	ytKeys2 := sortedStringKeys(yamlToVar)
	var staffTypes []staffType
	for _, yt := range ytKeys2 {
		vp := yamlToVar[yt]
		var entries []staffEntry
		if ps, ok := data.Define.Types[yt]; ok {
			codes := sortedIntKeys(ps)
			for _, c := range codes {
				entries = append(entries, staffEntry{fmt.Sprint(c), ps[c].CN})
			}
		}
		staffTypes = append(staffTypes, staffType{vp, yamlToComment[yt], entries})
	}

	tmpl := loadTemplate(tmplDir, "staff_data.go.tmpl")
	var sb strings.Builder
	if err := tmpl.Execute(&sb, struct{ StaffTypes []staffType }{staffTypes}); err != nil {
		log.Fatal(err)
	}
	writeToFile(filepath.Join(outDir, "staff_data.go"), sb.String())
}

// --- MetaTags ---

// collectMetaTags scans subject.jsonlines in dataDir and returns the set
// of meta tags per subject type. Shared by generateMetaTags and
// generateSchemaData.
func collectMetaTags(dataDir string) map[int]map[string]bool {
	subjectFile := filepath.Join(dataDir, "subject.jsonlines")
	file, err := os.Open(subjectFile)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Failed to open %s: %v\n", subjectFile, err)
		os.Exit(1)
	}
	defer func() { _ = file.Close() }()

	typeMetaTags := make(map[int]map[string]bool)
	decoder := json.NewDecoder(file)
	for decoder.More() {
		var subject struct {
			Type     int      `json:"type"`
			MetaTags []string `json:"meta_tags"`
		}
		if err := decoder.Decode(&subject); err != nil {
			break
		}
		if subject.MetaTags == nil {
			continue
		}
		if typeMetaTags[subject.Type] == nil {
			typeMetaTags[subject.Type] = make(map[string]bool)
		}
		for _, tag := range subject.MetaTags {
			typeMetaTags[subject.Type][tag] = true
		}
	}
	return typeMetaTags
}

// sortedTagLists returns the sorted meta tag list per subject type,
// skipping types absent from the archive data.
func sortedTagLists(typeMetaTags map[int]map[string]bool) map[int][]string {
	out := make(map[int][]string)
	for _, tc := range []int{1, 2, 3, 4, 6} {
		tags := typeMetaTags[tc]
		if tags == nil {
			continue
		}
		var tagList []string
		for tag := range tags {
			tagList = append(tagList, tag)
		}
		sort.Strings(tagList)
		out[tc] = tagList
	}
	return out
}

func generateMetaTags(dataDir, outDir, tmplDir string) {
	typeMetaTags := collectMetaTags(dataDir)

	type tagEntry struct {
		TypeCode int
		Tags     string
	}
	tagLists := sortedTagLists(typeMetaTags)
	var entries []tagEntry
	for _, tc := range []int{1, 2, 3, 4, 6} {
		tagList, ok := tagLists[tc]
		if !ok {
			continue
		}
		quoted := make([]string, len(tagList))
		for i, tag := range tagList {
			quoted[i] = `"` + tag + `"`
		}
		entries = append(entries, tagEntry{tc, strings.Join(quoted, ", ")})
	}

	tmpl := loadTemplate(tmplDir, "metatags.go.tmpl")
	var sb strings.Builder
	if err := tmpl.Execute(&sb, struct{ Entries []tagEntry }{entries}); err != nil {
		log.Fatal(err)
	}
	writeToFile(filepath.Join(outDir, "metatags.go"), sb.String())
}

// --- Frontend Schema Data ---

func generateSchemaData(platformsYAML, subjectRelationsYAML, personRelationsYAML, staffYAML []byte, dataDir, frontendDir, tmplDir string) {
	// --- Platforms ---
	var pData PlatformYAML
	if err := yaml.Unmarshal(platformsYAML, &pData); err != nil {
		fmt.Fprintf(os.Stderr, "Failed to parse subject_platforms.yml: %v\n", err)
		os.Exit(1)
	}
	type jsEntry struct{ Code, Name string }
	type platformType struct {
		GoType   string
		TypeCode string
		Entries  []jsEntry
	}
	yamlPlatToGo := map[string]string{
		"1": "BOOK", "2": "ANIME", "3": "MUSIC",
		"4": "GAME", "6": "REAL",
	}
	yplatKeys := sortedStringKeys(yamlPlatToGo)
	var platformTypes []platformType
	for _, yamlKey := range yplatKeys {
		goType := yamlPlatToGo[yamlKey]
		var entries []jsEntry
		if ps, ok := pData.Platforms[yamlKey]; ok {
			ids := make([]int, 0, len(ps))
			for _, p := range ps {
				ids = append(ids, p.ID)
			}
			sort.Ints(ids)
			for _, id := range ids {
				for _, p := range ps {
					if p.ID == id {
						entries = append(entries, jsEntry{fmt.Sprint(p.ID), p.TypeCN})
						break
					}
				}
			}
		}
		platformTypes = append(platformTypes, platformType{goType, yamlKey, entries})
	}

	// --- Relations ---
	var sRelData RelationYAML
	if err := yaml.Unmarshal(subjectRelationsYAML, &sRelData); err != nil {
		fmt.Fprintf(os.Stderr, "Failed to parse subject_relations.yml: %v\n", err)
		os.Exit(1)
	}
	type relType struct {
		GoType   string
		TypeCode string
		Entries  []jsEntry
	}
	yamlToGo := map[string]string{
		"book": "BOOK", "anime": "ANIME", "music": "MUSIC",
		"game": "GAME", "real": "REAL",
	}
	yamlToCode := map[string]string{
		"book": "1", "anime": "2", "music": "3",
		"game": "4", "real": "6",
	}
	ytKeys3 := sortedStringKeys(yamlToGo)
	var relTypes []relType
	for _, yt := range ytKeys3 {
		gt := yamlToGo[yt]
		var entries []jsEntry
		if rels, ok := sRelData.Define.Types[yt]; ok {
			codes := sortedIntKeys(rels)
			for _, c := range codes {
				entries = append(entries, jsEntry{fmt.Sprint(c), rels[c].CN})
			}
		}
		relTypes = append(relTypes, relType{gt, yamlToCode[yt], entries})
	}
	// Fallback: 三次元 uses anime relations when it has no dedicated ones
	for i, rt := range relTypes {
		if rt.GoType == "REAL" && len(rt.Entries) == 0 {
			for _, art := range relTypes {
				if art.GoType == "ANIME" {
					relTypes[i].Entries = art.Entries
					break
				}
			}
			break
		}
	}

	// Person & Character relations
	var pData2 RelationYAML
	if err := yaml.Unmarshal(personRelationsYAML, &pData2); err != nil {
		fmt.Fprintf(os.Stderr, "Failed to parse person_relations.yml: %v\n", err)
		os.Exit(1)
	}
	var personEntries, charEntries []jsEntry
	if pt, ok := pData2.Define.Types["person"]; ok {
		codes := sortedIntKeys(pt)
		for _, c := range codes {
			personEntries = append(personEntries, jsEntry{fmt.Sprint(c), pt[c].CN})
		}
	}
	if ct, ok := pData2.Define.Types["character"]; ok {
		codes := sortedIntKeys(ct)
		for _, c := range codes {
			charEntries = append(charEntries, jsEntry{fmt.Sprint(c), ct[c].CN})
		}
	}

	// Character association types & Person-character types (hardcoded)
	charAssocTypes := []string{"主角", "配角", "客串", "闲角", "旁白", "声库"}
	personCharTypes := []string{"CV", "译配", "演员", "中配", "日配", "英配", "韩配"}

	// --- Staff positions ---
	var staffData StaffYAML
	if err := yaml.Unmarshal(staffYAML, &staffData); err != nil {
		fmt.Fprintf(os.Stderr, "Failed to parse subject_staffs.yml: %v\n", err)
		os.Exit(1)
	}
	type staffType struct {
		GoType   string
		TypeCode string
		Entries  []jsEntry
	}
	ytKeys4 := sortedStringKeys(yamlToGo)
	var staffTypes []staffType
	for _, yt := range ytKeys4 {
		gt := yamlToGo[yt]
		var entries []jsEntry
		if ps, ok := staffData.Define.Types[yt]; ok {
			codes := sortedIntKeys(ps)
			for _, c := range codes {
				entries = append(entries, jsEntry{fmt.Sprint(c), ps[c].CN})
			}
		}
		staffTypes = append(staffTypes, staffType{gt, yamlToCode[yt], entries})
	}

	// --- Meta tags ---
	typeMetaTags := collectMetaTags(dataDir)

	type metaTagEntry struct {
		TypeCode string
		Tags     []string
	}
	tagLists := sortedTagLists(typeMetaTags)
	var metaTagEntries []metaTagEntry
	for _, tc := range []int{1, 2, 3, 4, 6} {
		if tagList, ok := tagLists[tc]; ok {
			metaTagEntries = append(metaTagEntries, metaTagEntry{fmt.Sprint(tc), tagList})
		}
	}

	// --- Render template ---
	tmpl := loadTemplate(tmplDir, "schema_data.js.tmpl")
	data := struct {
		PlatformTypes   []platformType
		RelTypes        []relType
		PersonEntries   []jsEntry
		CharEntries     []jsEntry
		CharAssocTypes  []string
		PersonCharTypes []string
		StaffTypes      []staffType
		MetaTagEntries  []metaTagEntry
	}{platformTypes, relTypes, personEntries, charEntries, charAssocTypes, personCharTypes, staffTypes, metaTagEntries}

	var sb strings.Builder
	if err := tmpl.Execute(&sb, data); err != nil {
		log.Fatal(err)
	}
	writeToFile(filepath.Join(frontendDir, "schema-data.js"), sb.String())
}
