package missingpersons

import (
	_ "embed"
	"encoding/json"
	"fmt"
	"html"
	"html/template"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

func pendingJS(missing []*missingPerson) template.JS {
	type pendPerson struct {
		PersonName   string             `json:"personName"`
		SubjectsData map[string]subData `json:"subjectsData"`
		EpisodesData interface{}        `json:"episodesData"`
	}

	var result []pendPerson
	for _, mp := range missing {
		pp := pendPerson{
			PersonName:   mp.DisplayName,
			SubjectsData: subjectDataMap(mp.Subjects),
			EpisodesData: nil,
		}
		result = append(result, pp)
	}
	b, _ := json.Marshal(result)
	return template.JS(b)
}

func pendingRelatedJS(related []*missingRelatedPerson) template.JS {
	type relPerson struct {
		PersonName       string             `json:"personName"`
		SubjectsData     map[string]subData `json:"subjectsData"`
		EpisodesData     interface{}        `json:"episodesData"`
		RelatedPersonIDs []idName           `json:"relatedPersonIds"`
	}

	var result []relPerson
	for _, mp := range related {
		ids := make([]idName, len(mp.ExistingPersonIDs))
		for i, p := range mp.ExistingPersonIDs {
			ids[i] = idName(p)
		}
		rp := relPerson{
			PersonName:       mp.DisplayName,
			SubjectsData:     subjectDataMap(mp.Subjects),
			EpisodesData:     nil,
			RelatedPersonIDs: ids,
		}
		result = append(result, rp)
	}
	b, _ := json.Marshal(result)
	return template.JS(b)
}

func subjectDataMap(subjects map[string]*subjectInfo) map[string]subData {
	m := make(map[string]subData, len(subjects))
	for skey, si := range subjects {
		posIDs := make([]int, 0, len(si.PosIDs))
		for pid := range si.PosIDs {
			posIDs = append(posIDs, pid)
		}
		sort.Ints(posIDs)
		m[skey] = subData{
			Name:      si.SubjectName,
			Positions: posIDs,
			Type:      si.SubjectType,
		}
	}
	return m
}

func posTableJS() template.JS {
	var parts []string
	for _, id := range allPosIDs {
		name := strings.ReplaceAll(strings.ReplaceAll(allPosIDToName[id], `\`, `\\`), `"`, `\"`)
		parts = append(parts, fmt.Sprintf(`%d:"%s"`, id, name))
	}
	return template.JS(strings.Join(parts, ","))
}

//go:embed templates/missing_persons.css
var pageCSS string

//go:embed templates/missing_page.js
var missingPageJS string

//go:embed templates/related_page.js
var relatedPageJS string

//go:embed templates/relate_common.js
var relateCommonJS string

//go:embed templates/esc_html.js
var escHtmlJS string

//go:embed templates/config_bar.html
var configBarHTML string

//go:embed templates/nav.html
var navHTML string

//go:embed templates/index.html
var indexHTML string

//go:embed templates/missing_page.html
var missingPageHTML string

//go:embed templates/related_page.html
var relatedPageHTML string

//go:embed templates/search_page.html
var searchPageHTML string

func buildTpl(name, body string) *template.Template {
	base := template.New(name)
	template.Must(base.Parse(configBarHTML))
	template.Must(base.Parse(navHTML))
	template.Must(base.Parse(`{{define "esc_html"}}` + escHtmlJS + `{{end}}`))
	return template.Must(base.Parse(body))
}

var indexTpl = buildTpl("index", indexHTML)
var missingPageTpl = buildTpl("missing", missingPageHTML)
var relatedPageTpl = buildTpl("related", relatedPageHTML)
var searchPageTpl = buildTpl("search", searchPageHTML)

// searchItem is a single homepage-search row: one unique person with the link
// to the first page they appear on. Each person is in exactly one category
// (missing/related/variant/bare), so one href suffices. Only name + href are
// embedded to keep search.html small.
func indexSearchJS(items []searchItem) template.JS {
	b, _ := json.Marshal(items)
	return template.JS(b)
}

// missingSearchItem builds a homepage-search row for a missing person. The href
// is generated at render time so the embedded JSON stays compact.
func missingSearchItem(mp *missingPerson, href string) searchItem {
	return searchItem{DisplayName: mp.DisplayName, Href: href}
}

func relatedSearchItem(rp *missingRelatedPerson, href string) searchItem {
	return searchItem{DisplayName: rp.DisplayName, Href: href}
}

// mergeSearchItems dedupes homepage search entries by display name, keeping the
// first page link per person.
func mergeSearchItems(items []searchItem) []searchItem {
	byName := make(map[string]bool)
	out := make([]searchItem, 0, len(items))
	for _, it := range items {
		if byName[it.DisplayName] {
			continue
		}
		byName[it.DisplayName] = true
		out = append(out, it)
	}
	return out
}

func writeIndexHTML(outputDir string, subjCount, totalMissing, totalRelated, totalBare, totalVariant int, missingLinks, relatedLinks, bareLinks, variantLinks []typeLinkTplData) error {
	f, err := os.Create(filepath.Join(outputDir, "index.html"))
	if err != nil {
		return err
	}
	defer func() { _ = f.Close() }()
	return indexTpl.Execute(f, map[string]interface{}{
		"CSS":           template.CSS(pageCSS),
		"SubjectCount":  subjCount,
		"TotalMissing":  totalMissing,
		"TotalRelated":  totalRelated,
		"TotalBare":     totalBare,
		"TotalVariant":  totalVariant,
		"MinCount":      missingPersonsMinCount,
		"GeneratedDate": time.Now().Format("2006-01-02"),
		"TypeLinks":     append(missingLinks, relatedLinks...),
		"BareLinks":     bareLinks,
		"VariantLinks":  variantLinks,
	})
}

// writeSearchPage writes search.html — the standalone page that embeds the full
// person index (the heavy data) so the homepage can stay light.
func writeSearchPage(outputDir string, searchItems []searchItem) error {
	f, err := os.Create(filepath.Join(outputDir, "search.html"))
	if err != nil {
		return err
	}
	defer func() { _ = f.Close() }()
	return searchPageTpl.Execute(f, map[string]interface{}{
		"CSS":         template.CSS(pageCSS),
		"SearchItems": indexSearchJS(searchItems),
		"Total":       len(searchItems),
	})
}

func writeMissingPage(outputDir, tname string, tcode int, entries []*missingPerson, partNum, totalParts int, genTS string) error {
	var filename string
	if totalParts == 1 {
		filename = fmt.Sprintf("type-%d", tcode)
	} else {
		filename = fmt.Sprintf("type-%d-part-%d", tcode, partNum)
	}

	var prevLink, nextLink string
	if partNum > 1 {
		prevLink = fmt.Sprintf("type-%d-part-%d.html?v=%s", tcode, partNum-1, genTS)
	}
	if partNum < totalParts {
		nextLink = fmt.Sprintf("type-%d-part-%d.html?v=%s", tcode, partNum+1, genTS)
	}

	var title string
	if totalParts > 1 {
		title = fmt.Sprintf("%s中缺失的人物 - 第 %d/%d 页", tname, partNum, totalParts)
	} else {
		title = fmt.Sprintf("%s中缺失的人物", tname)
	}

	var pageInfo string
	if totalParts > 1 {
		pageInfo = fmt.Sprintf("第 %d/%d 页", partNum, totalParts)
	}

	persons := make([]personTplData, len(entries))
	for i, mp := range entries {
		persons[i] = personTplData{Idx: i, Name: mp.DisplayName, Count: mp.Count}
	}

	f, err := os.Create(filepath.Join(outputDir, filename+".html"))
	if err != nil {
		return err
	}
	defer func() { _ = f.Close() }()
	return missingPageTpl.Execute(f, typePageTplData{
		CSS:         template.CSS(pageCSS),
		JS:          template.JS(relateCommonJS + missingPageJS),
		Title:       title,
		PrevLink:    prevLink,
		NextLink:    nextLink,
		PageInfo:    pageInfo,
		PendingData: pendingJS(entries),
		PosTable:    posTableJS(),
		Persons:     persons,
		PageKind:    tname,
	})
}

func writeRelatedPage(outputDir, tname string, tcode int, entries []*missingRelatedPerson, partNum, totalParts int, suffix string, genTS string) error {
	var filename string
	if totalParts == 1 {
		filename = fmt.Sprintf("type-%d-%s", tcode, suffix)
	} else {
		filename = fmt.Sprintf("type-%d-%s-part-%d", tcode, suffix, partNum)
	}

	var prevLink, nextLink string
	if partNum > 1 {
		prevLink = fmt.Sprintf("type-%d-%s-part-%d.html?v=%s", tcode, suffix, partNum-1, genTS)
	}
	if partNum < totalParts {
		nextLink = fmt.Sprintf("type-%d-%s-part-%d.html?v=%s", tcode, suffix, partNum+1, genTS)
	}

	var title string
	switch suffix {
	case "related-bare":
		if totalParts > 1 {
			title = fmt.Sprintf("%s中缺失关联的无关联人物 - 第 %d/%d 页", tname, partNum, totalParts)
		} else {
			title = fmt.Sprintf("%s中缺失关联的无关联人物", tname)
		}
	case "variant":
		if totalParts > 1 {
			title = fmt.Sprintf("%s中变体字同名的人物 - 第 %d/%d 页", tname, partNum, totalParts)
		} else {
			title = fmt.Sprintf("%s中变体字同名的人物", tname)
		}
	default:
		if totalParts > 1 {
			title = fmt.Sprintf("%s中缺失关联的人物 - 第 %d/%d 页", tname, partNum, totalParts)
		} else {
			title = fmt.Sprintf("%s中缺失关联的人物", tname)
		}
	}

	var pageInfo string
	if totalParts > 1 {
		pageInfo = fmt.Sprintf("第 %d/%d 页", partNum, totalParts)
	}

	persons := make([]personTplData, len(entries))
	for i, rp := range entries {
		pd := personTplData{Idx: i, Name: rp.DisplayName, Count: rp.Count, FromAlias: rp.FromAlias}
		if len(rp.ExistingPersonIDs) > 0 {
			pd.FirstPersonID = rp.ExistingPersonIDs[0].ID
			pd.FirstPersonName = rp.ExistingPersonIDs[0].Name
			pd.MultiMatch = len(rp.ExistingPersonIDs) > 1
			if pd.MultiMatch {
				var opts strings.Builder
				for _, p := range rp.ExistingPersonIDs {
					fmt.Fprintf(&opts, `<option value="%d">%s (ID:%d)</option>`, p.ID, html.EscapeString(p.Name), p.ID)
				}
				pd.SelectOptions = template.HTML(opts.String())
			}
		}
		persons[i] = pd
	}

	f, err := os.Create(filepath.Join(outputDir, filename+".html"))
	if err != nil {
		return err
	}
	defer func() { _ = f.Close() }()
	return relatedPageTpl.Execute(f, typePageTplData{
		CSS:         template.CSS(pageCSS),
		JS:          template.JS(relateCommonJS + relatedPageJS),
		Title:       title,
		PrevLink:    prevLink,
		NextLink:    nextLink,
		PageInfo:    pageInfo,
		PendingData: pendingRelatedJS(entries),
		PosTable:    posTableJS(),
		Persons:     persons,
		PageKind:    suffix,
	})
}

const chunkSize = 2000

// pageJob is one renderable HTML page: the closure writes the page and returns
// its search rows plus the exact progress line the sequential version printed.
type pageJob struct {
	run func() ([]searchItem, string, error)
}

type pageResult struct {
	items []searchItem
	log   string
	err   error
}

func runPageJobs(jobs []pageJob) ([]searchItem, error) {
	if len(jobs) == 0 {
		return nil, nil
	}
	results := make([]pageResult, len(jobs))
	workCh := make(chan int, len(jobs))
	for i := range jobs {
		workCh <- i
	}
	close(workCh)

	workers := runtime.GOMAXPROCS(0)
	if workers > len(jobs) {
		workers = len(jobs)
	}
	if workers > 6 {
		workers = 6
	}
	var wg sync.WaitGroup
	for w := 0; w < workers; w++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for i := range workCh {
				items, log, err := jobs[i].run()
				results[i] = pageResult{items: items, log: log, err: err}
			}
		}()
	}
	wg.Wait()

	var searchItems []searchItem
	for i, res := range results {
		if res.err != nil {
			return nil, fmt.Errorf("生成页面失败: %w", res.err)
		}
		searchItems = append(searchItems, res.items...)
		fmt.Fprint(os.Stderr, res.log)
		_ = i
	}
	return searchItems, nil
}

func writeMultiTypePages(missing []*missingPerson, related, relatedBare, variantDupes []*missingRelatedPerson, outputDir string, subjCount int) error {
	if err := os.MkdirAll(outputDir, 0755); err != nil {
		return fmt.Errorf("创建输出目录失败: %w", err)
	}

	// genTS 是本次生成的唯一时间戳。所有页面间链接都带上 ?v=<genTS>，
	// 使每次重新生成后 URL 变化，浏览器 :visited 历史不再命中旧链接，
	// 避免网页更新后不对应的链接仍显示为已访问。
	genTS := strconv.FormatInt(time.Now().Unix(), 10)

	typeMissing := make(map[int][]*missingPerson)
	for _, mp := range missing {
		for t := range mp.TypeCounts {
			typeMissing[t] = append(typeMissing[t], mp)
		}
	}

	typeRelated := make(map[int][]*missingRelatedPerson)
	for _, rp := range related {
		for t := range rp.TypeCounts {
			typeRelated[t] = append(typeRelated[t], rp)
		}
	}

	typeBare := make(map[int][]*missingRelatedPerson)
	for _, rp := range relatedBare {
		for t := range rp.TypeCounts {
			typeBare[t] = append(typeBare[t], rp)
		}
	}

	typeVariant := make(map[int][]*missingRelatedPerson)
	for _, rp := range variantDupes {
		for t := range rp.TypeCounts {
			typeVariant[t] = append(typeVariant[t], rp)
		}
	}

	var missingLinks, relatedLinks, bareLinks, variantLinks []typeLinkTplData
	var jobs []pageJob

	// Missing persons pages
	for _, t := range sortedTypesByCountLens(typeMissing) {
		t := t
		people := typeMissing[t]
		tname := subjectTypeNames[t]
		totalType := len(people)
		totalParts := (totalType + chunkSize - 1) / chunkSize
		if totalParts == 0 {
			totalParts = 1
		}

		var partLinks []partLinkTplData
		for partNum := 1; partNum <= totalParts; partNum++ {
			partNum := partNum
			start := (partNum - 1) * chunkSize
			end := start + chunkSize
			if end > totalType {
				end = totalType
			}
			chunk := people[start:end]

			var fname string
			if totalParts == 1 {
				fname = fmt.Sprintf("type-%d", t)
			} else {
				fname = fmt.Sprintf("type-%d-part-%d", t, partNum)
			}
			jobs = append(jobs, pageJob{run: func() ([]searchItem, string, error) {
				if err := writeMissingPage(outputDir, tname, t, chunk, partNum, totalParts, genTS); err != nil {
					return nil, "", err
				}
				items := make([]searchItem, 0, len(chunk))
				for _, mp := range chunk {
					items = append(items, missingSearchItem(mp, fname+".html?v="+genTS))
				}
				return items, fmt.Sprintf("  [%s] %s/%s.html (缺失:%d)\n", tname, outputDir, fname, len(chunk)), nil
			}})
			label := "浏览"
			if totalParts > 1 {
				label = fmt.Sprintf("第%d页", partNum)
			}
			partLinks = append(partLinks, partLinkTplData{Href: fname + ".html?v=" + genTS, Label: label})
		}
		missingLinks = append(missingLinks, typeLinkTplData{TypeName: tname + "缺失", Count: totalType, Parts: partLinks})
	}

	// Related persons pages
	relatedJobs, relatedLinkData := relatedPageJobs(outputDir, typeRelated, "related", "关联缺失", "关联缺失", genTS)
	jobs = append(jobs, relatedJobs...)
	relatedLinks = relatedLinkData

	// No-relation (无关联) related persons pages
	bareJobs, bareLinkData := relatedPageJobs(outputDir, typeBare, "related-bare", "无关联", "无关联关联缺失", genTS)
	jobs = append(jobs, bareJobs...)
	bareLinks = bareLinkData

	// Variant-spelling same-name (变体同名) pages — to-be-created persons whose
	// variant-normalized name matches an existing person, listed at the end.
	variantJobs, variantLinkData := relatedPageJobs(outputDir, typeVariant, "variant", "变体同名", "变体同名", genTS)
	jobs = append(jobs, variantJobs...)
	variantLinks = variantLinkData

	searchItems, err := runPageJobs(jobs)
	if err != nil {
		return err
	}

	totalMissing := len(missing)
	totalRelated := len(related)
	totalBare := len(relatedBare)
	totalVariant := len(variantDupes)
	if err := writeIndexHTML(outputDir, subjCount, totalMissing, totalRelated, totalBare, totalVariant, missingLinks, relatedLinks, bareLinks, variantLinks); err != nil {
		return err
	}
	return writeSearchPage(outputDir, mergeSearchItems(searchItems))
}

// relatedPageJobs enumerates the per-type page jobs (and directory links) for
// one related-family list, preserving the exact enumeration and log order of
// the previous sequential buildRelatedTypeLinks.
func relatedPageJobs(outputDir string, typeMap map[int][]*missingRelatedPerson, suffix, linkLabel, logLabel string, genTS string) ([]pageJob, []typeLinkTplData) {
	var jobs []pageJob
	var links []typeLinkTplData
	for _, t := range sortedTypesByCountLens(typeMap) {
		t := t
		people := typeMap[t]
		tname := subjectTypeNames[t]
		totalType := len(people)
		totalParts := (totalType + chunkSize - 1) / chunkSize
		if totalParts == 0 {
			totalParts = 1
		}

		var partLinks []partLinkTplData
		for partNum := 1; partNum <= totalParts; partNum++ {
			partNum := partNum
			start := (partNum - 1) * chunkSize
			end := start + chunkSize
			if end > totalType {
				end = totalType
			}
			chunk := people[start:end]

			var fname string
			if totalParts == 1 {
				fname = fmt.Sprintf("type-%d-%s", t, suffix)
			} else {
				fname = fmt.Sprintf("type-%d-%s-part-%d", t, suffix, partNum)
			}
			jobs = append(jobs, pageJob{run: func() ([]searchItem, string, error) {
				if err := writeRelatedPage(outputDir, tname, t, chunk, partNum, totalParts, suffix, genTS); err != nil {
					return nil, "", err
				}
				items := make([]searchItem, 0, len(chunk))
				for _, rp := range chunk {
					items = append(items, relatedSearchItem(rp, fname+".html?v="+genTS))
				}
				return items, fmt.Sprintf("  [%s] %s/%s.html (%s:%d)\n", tname, outputDir, fname, logLabel, len(chunk)), nil
			}})
			label := "浏览"
			if totalParts > 1 {
				label = fmt.Sprintf("第%d页", partNum)
			}
			partLinks = append(partLinks, partLinkTplData{Href: fname + ".html?v=" + genTS, Label: label})
		}
		links = append(links, typeLinkTplData{TypeName: tname + linkLabel, Count: totalType, Parts: partLinks})
	}
	return jobs, links
}

func sortedTypesByCountLens[T any](typeMap map[int][]T) []int {
	types := make([]int, 0, len(typeMap))
	for t := range typeMap {
		types = append(types, t)
	}
	sort.Slice(types, func(i, j int) bool {
		return len(typeMap[types[i]]) > len(typeMap[types[j]])
	})
	return types
}
