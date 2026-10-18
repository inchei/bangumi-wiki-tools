package missingpersons

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"
)

// Options configures a missing-persons run.
type Options struct {
	DBPath     string // DuckDB database path
	ArchiveDir string // archive directory (person.jsonlines, data_version.json)
	AliasFile  string // person_alias.json (optional)
	PersonFile string // person.jsonlines override (defaults to archive dir)
	OutputDir  string // HTML output directory
	StatsOnly  bool   // only write stats JSON, skip HTML
	StatsJSON  string // stats JSON path ("" = stdout)
}

// Run performs the full missing-persons analysis and writes the report. It
// prints progress to stderr and returns an error on failure; callers decide the
// process exit code.
func Run(ctx context.Context, opts Options) error {
	t0 := time.Now()

	fmt.Fprintf(os.Stderr, "查询条目中...\n")
	records, err := loadSubjectsFromDB(ctx, opts.DBPath)
	if err != nil {
		fmt.Fprintf(os.Stderr, "错误: %v\n", err)
		return err
	}
	t1 := time.Now()
	fmt.Fprintf(os.Stderr, "  总条目数: %d\n", len(records))
	fmt.Fprintf(os.Stderr, "  耗时: %.1fs\n", t1.Sub(t0).Seconds())

	fmt.Fprintf(os.Stderr, "解析条目 infobox 中...\n")
	personSubjects := parseSubjects(records)
	t2 := time.Now()
	fmt.Fprintf(os.Stderr, "  唯一人物名: %d\n", len(personSubjects))
	fmt.Fprintf(os.Stderr, "  耗时: %.1fs\n", t2.Sub(t1).Seconds())

	fmt.Fprintf(os.Stderr, "加载已创建人物中...\n")
	personFile := opts.PersonFile
	if personFile == "" {
		personFile = filepath.Join(opts.ArchiveDir, "person.jsonlines")
	}
	existing, knownIDs, idToName, idToRawName, aliasNorm, err := loadKnownPersons(personFile, opts.AliasFile)
	if err != nil {
		fmt.Fprintf(os.Stderr, "错误: %v\n", err)
		return err
	}
	t2b := time.Now()
	fmt.Fprintf(os.Stderr, "  已有人员数: %d\n", len(existing))
	fmt.Fprintf(os.Stderr, "  耗时: %.1fs\n", t2b.Sub(t2).Seconds())

	fmt.Fprintf(os.Stderr, "加载角色名中...\n")
	charNames, err := loadCharacterNames(opts.ArchiveDir, opts.DBPath)
	if err == nil {
		before := len(existing)
		for name := range charNames {
			existing[name] = true
		}
		fmt.Fprintf(os.Stderr, "  角色名: %d, 已合并排除: %d\n", len(charNames), len(existing)-before)
	}
	fmt.Fprintf(os.Stderr, "  耗时: %.1fs\n", time.Since(t2b).Seconds())

	fmt.Fprintf(os.Stderr, "筛选缺失人物中...\n")
	missing := filterMissing(personSubjects, existing)
	related := collectRelated(personSubjects, existing, knownIDs, idToName, aliasNorm)
	t3 := time.Now()
	fmt.Fprintf(os.Stderr, "  初步缺失: %d, 初步关联缺失: %d\n", len(missing), len(related))
	fmt.Fprintf(os.Stderr, "  耗时: %.1fs\n", t3.Sub(t2b).Seconds())

	fmt.Fprintf(os.Stderr, "检测变体字同名人物中...\n")
	variantExistingIDs := buildVariantExistingIDs(knownIDs)
	var variantDupes []*missingRelatedPerson
	missing, variantDupes = splitVariantDupes(missing, variantExistingIDs, idToRawName)
	fmt.Fprintf(os.Stderr, "  变体字归一后同名已存在: %d, 剩余实际缺失: %d\n", len(variantDupes), len(missing))

	var relatedBare []*missingRelatedPerson
	if len(variantDupes) > 0 || len(related) > 0 {
		// One linked-index query covers the variant list and the related list,
		// and the 无关联 query runs concurrently (the DuckDB CLI startup
		// dominates both queries, so overlapping them hides it).
		personIDs := filterPersonIDs(variantDupes, related)
		var noRel map[int]bool
		var rerr, nerr error
		var wg sync.WaitGroup
		wg.Add(1)
		go func() {
			defer wg.Done()
			noRel, nerr = loadNoRelationPersonIDs(ctx, opts.DBPath)
		}()
		var li linkedIndex
		li, rerr = buildLinkedIndex(ctx, opts.DBPath, personIDs)
		wg.Wait()
		if nerr != nil {
			fmt.Fprintf(os.Stderr, "错误: %v\n", nerr)
			return nerr
		}
		if rerr != nil {
			fmt.Fprintf(os.Stderr, "错误: %v\n", rerr)
			return rerr
		}

		if len(variantDupes) > 0 {
			fmt.Fprintf(os.Stderr, "过滤变体同名已关联条目中...\n")
			beforeVariant := len(variantDupes)
			variantDupes = filterLinkedInto(variantDupes, li, true)
			fmt.Fprintf(os.Stderr, "  变体同名过滤后: %d → %d (排除已关联 %d)\n", beforeVariant, len(variantDupes), beforeVariant-len(variantDupes))
		}

		if len(related) > 0 {
			fmt.Fprintf(os.Stderr, "过滤已关联人物中...\n")
			beforeFilter := len(related)
			related = filterLinkedInto(related, li, false)
			fmt.Fprintf(os.Stderr, "  关联缺失过滤后: %d → %d (移除已关联 %d)\n", beforeFilter, len(related), beforeFilter-len(related))
			fmt.Fprintf(os.Stderr, "  耗时: %.1fs\n", time.Since(t3).Seconds())

			fmt.Fprintf(os.Stderr, "区分无关联人物中...\n")
			relatedBare = make([]*missingRelatedPerson, 0, len(related))
			normal := related[:0]
			for _, rp := range related {
				isBare := false
				for _, p := range rp.ExistingPersonIDs {
					if noRel[p.ID] {
						isBare = true
						break
					}
				}
				if isBare {
					relatedBare = append(relatedBare, rp)
				} else {
					normal = append(normal, rp)
				}
			}
			related = normal
			fmt.Fprintf(os.Stderr, "  其中无关联人物: %d, 其余关联缺失: %d\n", len(relatedBare), len(related))
		}
	}

	totalMissing := len(missing)
	totalRelated := len(related)
	totalBare := len(relatedBare)
	totalVariant := len(variantDupes)

	fmt.Fprintf(os.Stderr, "  缺失且 ≥%d 次出现的人数: %d\n", missingPersonsMinCount, totalMissing)
	fmt.Fprintf(os.Stderr, "  关联缺失且 ≥%d 次出现的人数: %d (其中无关联 %d)\n", missingRelatedMinCount, totalRelated, totalBare)
	fmt.Fprintf(os.Stderr, "  变体字同名且已存在的人数: %d\n", totalVariant)

	// 统计 JSON（供外层 Python 趋势图使用）
	createdAt := statsCreatedAt(opts.ArchiveDir)
	dateStr := ""
	if len(createdAt) >= 10 {
		dateStr = createdAt[:10]
	} else {
		dateStr = time.Now().Format("2006-01-02")
	}
	stats := missingStats{
		CreatedAt:     createdAt,
		Date:          dateStr,
		TotalSubjects: len(records),
		TotalMissing:  totalMissing,
		TotalRelated:  totalRelated,
		TotalBare:     totalBare,
		TotalVariant:  totalVariant,
		Remaining:     totalMissing + totalRelated + totalBare,
		ByType:        buildStatsByType(missing, related, relatedBare, variantDupes),
	}
	if opts.StatsOnly {
		if err := writeStatsJSON(opts.StatsJSON, stats); err != nil {
			fmt.Fprintf(os.Stderr, "写入统计失败: %v\n", err)
			return err
		}
		fmt.Fprintf(os.Stderr, "\n总计耗时: %.1fs\n", time.Since(t0).Seconds())
		return nil
	}
	if opts.StatsJSON != "" {
		if err := writeStatsJSON(opts.StatsJSON, stats); err != nil {
			fmt.Fprintf(os.Stderr, "写入统计失败: %v\n", err)
			return err
		}
	}

	if totalMissing == 0 && totalRelated == 0 && totalBare == 0 && totalVariant == 0 {
		fmt.Fprintln(os.Stderr, "没有需要处理的人物")
		return nil
	}

	fmt.Fprintf(os.Stderr, "生成分类型 HTML...\n")
	outputDir := opts.OutputDir
	if outputDir == "" {
		outputDir = "docs/missing-persons"
	}
	if err := writeMultiTypePages(missing, related, relatedBare, variantDupes, outputDir, len(records)); err != nil {
		fmt.Fprintf(os.Stderr, "错误: %v\n", err)
		return err
	}
	t4 := time.Now()
	fmt.Fprintf(os.Stderr, "  输出目录: %s\n", outputDir)
	fmt.Fprintf(os.Stderr, "  耗时: %.1fs\n", t4.Sub(t3).Seconds())

	fmt.Fprintf(os.Stderr, "\n总计耗时: %.1fs\n", time.Since(t0).Seconds())
	return nil
}
