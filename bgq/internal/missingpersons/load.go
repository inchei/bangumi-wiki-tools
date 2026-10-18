package missingpersons

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strconv"

	"github.com/inchei/bangumi-query/internal/aliases"
	"github.com/inchei/bangumi-query/internal/query"
)

const seriesRelationType = 1002

// noRelationQuery hard-codes the "无关联人物" (invalid person) filter: a person
// with no staff entries, no character associations, and no person relations.
// This is the filter previously defined in index_filters/invalid_person.yaml,
// inlined so the missing persons check can flag such people directly.
const noRelationQuery = `
SELECT p.person_id, p.name
FROM persons p
WHERE NOT EXISTS (SELECT 1 FROM subject_persons sp WHERE sp.person_id = p.person_id)
  AND NOT EXISTS (SELECT 1 FROM person_characters pc WHERE pc.person_id = p.person_id)
  AND NOT EXISTS (SELECT 1 FROM person_relations pr WHERE pr.person_id = p.person_id)
ORDER BY p.person_id
LIMIT 2000`

// loadNoRelationPersonIDs returns the set of "无关联人物" (invalid person) IDs —
// persons with no staff entries, no character associations, and no person
// relations. Missing persons check uses this to classify related persons that
// currently have no relations (i.e. worth linking, not garbage).
func loadNoRelationPersonIDs(ctx context.Context, dbPath string) (map[int]bool, error) {
	engine := query.NewEngine(dbPath, "")
	res, err := engine.ExecuteRaw(ctx, noRelationQuery)
	if err != nil {
		return nil, err
	}
	ids := make(map[int]bool, len(res.Rows))
	for _, row := range res.Rows {
		if len(row) < 1 {
			continue
		}
		id, _ := strconv.Atoi(row[0])
		if id > 0 {
			ids[id] = true
		}
	}
	return ids, nil
}

func loadKnownPersons(personFile, aliasFile string) (map[string]bool, map[string][]int, map[int]string, map[int]string, map[string]bool, error) {
	known := make(map[string]bool)
	knownIDs := make(map[string][]int)
	idToName := make(map[int]string)
	idToRawName := make(map[int]string)
	aliasNorm := make(map[string]bool)

	f, err := os.Open(personFile)
	if err != nil {
		return nil, nil, nil, nil, nil, fmt.Errorf("打开 person.jsonlines 失败: %w", err)
	}
	defer func() { _ = f.Close() }()

	scanner := bufio.NewScanner(f)
	scanner.Buffer(make([]byte, 1024*1024), 10*1024*1024)
	for scanner.Scan() {
		var p struct {
			ID      int    `json:"id"`
			Name    string `json:"name"`
			Infobox string `json:"infobox"`
		}
		if err := json.Unmarshal(scanner.Bytes(), &p); err != nil {
			continue
		}
		if p.Name != "" {
			norm := normalizePersonName(p.Name)
			known[norm] = true
			knownIDs[norm] = append(knownIDs[norm], p.ID)
			if p.ID > 0 {
				idToRawName[p.ID] = p.Name
				display := p.Name
				if cn := extractPersonCNName(p.Infobox); cn != "" {
					display = cn
				}
				idToName[p.ID] = display
			}
		}
		cn := extractPersonCNName(p.Infobox)
		// Also match by CN name from infobox
		if cn != "" && cn != p.Name {
			normCN := normalizePersonName(cn)
			if normCN != normalizePersonName(p.Name) {
				known[normCN] = true
				knownIDs[normCN] = append(knownIDs[normCN], p.ID)
			}
		}
	}
	if err := scanner.Err(); err != nil {
		return nil, nil, nil, nil, nil, fmt.Errorf("读取 person.jsonlines 失败: %w", err)
	}

	if aliasFile != "" {
		ad, err := aliases.Load(aliasFile)
		if err == nil {
			for alias := range ad.Aliases {
				if !known[alias] {
					aliasNorm[alias] = true
				}
				known[alias] = true
				indices := ad.Aliases[alias]
				for _, idx := range indices {
					if idx >= 0 && idx < len(ad.Persons) {
						pid := ad.Persons[idx].ID
						already := false
						for _, existing := range knownIDs[alias] {
							if existing == pid {
								already = true
								break
							}
						}
						if !already {
							knownIDs[alias] = append(knownIDs[alias], pid)
						}
					}
				}
			}
		}
	}

	return known, knownIDs, idToName, idToRawName, aliasNorm, nil
}

func loadCharacterNames(archiveDir string, dbPath string) (map[string]bool, error) {
	names := make(map[string]bool)

	charFile := filepath.Join(archiveDir, "character.jsonlines")
	f, err := os.Open(charFile)
	if err != nil {
		return names, nil
	}
	defer func() { _ = f.Close() }()

	scanner := bufio.NewScanner(f)
	scanner.Buffer(make([]byte, 1024*1024), 10*1024*1024)
	for scanner.Scan() {
		var c struct {
			Name string `json:"name"`
		}
		if err := json.Unmarshal(scanner.Bytes(), &c); err != nil {
			continue
		}
		if c.Name != "" {
			names[normalizePersonName(c.Name)] = true
		}
	}
	return names, scanner.Err()
}

func loadSubjectsFromDB(ctx context.Context, dbPath string) ([]subjectRecord, error) {
	sql := fmt.Sprintf(`SELECT id, name, type, infobox FROM subjects
		WHERE type IN (1, 2, 3, 4, 6)
		  AND NOT (type = 1 AND id IN (
			SELECT subject_id FROM subject_relations WHERE relation_type = %d
		  ))`, seriesRelationType)
	engine := query.NewEngine(dbPath, "")
	result, err := engine.ExecuteRaw(ctx, sql)
	if err != nil {
		return nil, fmt.Errorf("DuckDB 查询失败: %w", err)
	}

	colIdx := make(map[string]int, len(result.Columns))
	for i, col := range result.Columns {
		colIdx[col] = i
	}

	records := make([]subjectRecord, 0, result.TotalRows)
	for _, row := range result.Rows {
		id, _ := strconv.Atoi(row[colIdx["id"]])
		stype, _ := strconv.Atoi(row[colIdx["type"]])
		records = append(records, subjectRecord{
			ID:      id,
			Name:    row[colIdx["name"]],
			Type:    stype,
			Infobox: row[colIdx["infobox"]],
		})
	}
	return records, nil
}
