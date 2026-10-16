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

	wikiMPDir := "../../../wikiMissingPositions/src"
	if _, err := os.Stat(wikiMPDir); err == nil {
		fmt.Println("  Generating position-ids.js...")
		generatePositionIDs(staffYAML, wikiMPDir)
	}

	wikiBatchDir := "../../../wikiBatch/src"
	if _, err := os.Stat(wikiBatchDir); err == nil {
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
