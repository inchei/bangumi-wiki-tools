package missingpersons

import (
	"context"
	"fmt"
	"sort"
	"strconv"
	"strings"

	"github.com/inchei/bangumi-query/internal/query"
)

const missingRelatedMinCount = 1

func collectRelated(personSubjects map[string]*missingPerson, existing map[string]bool, knownIDs map[string][]int, idToName map[int]string, aliasNorm map[string]bool) []*missingRelatedPerson {
	var related []*missingRelatedPerson
	for keyNorm, entry := range personSubjects {
		if !existing[keyNorm] {
			continue
		}
		ids := knownIDs[keyNorm]
		if len(ids) == 0 {
			continue
		}
		if len(entry.Subjects) < missingRelatedMinCount {
			continue
		}
		entry.Count = len(entry.Subjects)
		entry.DisplayName = entry.Subjects[firstSubjectKey(entry.Subjects)].DisplayName
		pairs := make([]personIDName, len(ids))
		for i, pid := range ids {
			name := idToName[pid]
			if name == "" {
				name = fmt.Sprintf("ID:%d", pid)
			}
			pairs[i] = personIDName{ID: pid, Name: name}
		}
		related = append(related, &missingRelatedPerson{
			DisplayName:       entry.DisplayName,
			KeyNorm:           keyNorm,
			Count:             entry.Count,
			Subjects:          entry.Subjects,
			TypeCounts:        entry.TypeCounts,
			ExistingPersonIDs: pairs,
			FromAlias:         aliasNorm[keyNorm],
		})
	}
	sort.Slice(related, func(i, j int) bool {
		return related[i].Count > related[j].Count
	})
	return related
}

func filterAlreadyLinked(ctx context.Context, dbPath string, related []*missingRelatedPerson, keepEmpty bool) ([]*missingRelatedPerson, error) {
	if len(related) == 0 {
		return related, nil
	}

	personIDSet := make(map[int]bool)
	for _, rp := range related {
		for _, p := range rp.ExistingPersonIDs {
			personIDSet[p.ID] = true
		}
	}

	if len(personIDSet) == 0 {
		return related, nil
	}

	var idList strings.Builder
	first := true
	for pid := range personIDSet {
		if !first {
			idList.WriteString(",")
		}
		fmt.Fprintf(&idList, "%d", pid)
		first = false
	}

	sql := fmt.Sprintf(`
SELECT sp.subject_id, sp.person_id, sp.position
FROM subject_persons sp
WHERE sp.person_id IN (%s)
`, idList.String())

	engine := query.NewEngine(dbPath, "")
	result, err := engine.ExecuteRaw(ctx, sql)
	if err != nil {
		return nil, fmt.Errorf("查询已关联数据失败（数据库是否缺少 subject_persons 表？请使用 bgq ingest 建库）: %w", err)
	}

	// linkedMap: personID -> subjectID -> set of positionIDs
	linkedMap := make(map[int]map[int]map[int]bool)
	for _, row := range result.Rows {
		if len(row) < 3 {
			continue
		}
		pid, _ := strconv.Atoi(row[1])
		sid, _ := strconv.Atoi(row[0])
		pos, _ := strconv.Atoi(row[2])
		pos = canonicalPosID(pos)
		if linkedMap[pid] == nil {
			linkedMap[pid] = make(map[int]map[int]bool)
		}
		if linkedMap[pid][sid] == nil {
			linkedMap[pid][sid] = make(map[int]bool)
		}
		linkedMap[pid][sid][pos] = true
	}

	filtered := make([]*missingRelatedPerson, 0, len(related))
	for _, rp := range related {
		newSubjects := make(map[string]*subjectInfo)
		for skey, si := range rp.Subjects {
			sid := parseSubjectID(skey)
			newPosIDs := make(map[int]struct{})
			for pos := range si.PosIDs {
				isLinked := false
				for _, p := range rp.ExistingPersonIDs {
					if linkedMap[p.ID] != nil && linkedMap[p.ID][sid] != nil && linkedMap[p.ID][sid][pos] {
						isLinked = true
						break
					}
				}
				if !isLinked {
					newPosIDs[pos] = struct{}{}
				}
			}
			if len(newPosIDs) > 0 {
				newSubjects[skey] = &subjectInfo{
					SubjectName: si.SubjectName,
					DisplayName: si.DisplayName,
					SubjectType: si.SubjectType,
					PosIDs:      newPosIDs,
				}
			}
		}
		if len(newSubjects) > 0 {
			newTypeCounts := make(map[int]int)
			for _, si := range newSubjects {
				newTypeCounts[si.SubjectType]++
			}
			rr := *rp
			rr.Subjects = newSubjects
			rr.Count = len(newSubjects)
			rr.TypeCounts = newTypeCounts
			filtered = append(filtered, &rr)
		} else if keepEmpty {
			// All subjects already linked to the existing person — keep the
			// entry with an empty list so it still prompts adding the variant
			// spelling as an alias. Keep original TypeCounts so the entry is
			// still grouped under its subject types.
			rr := *rp
			rr.Subjects = map[string]*subjectInfo{}
			rr.Count = 0
			filtered = append(filtered, &rr)
		}
	}
	// Re-sort after Count may have changed
	sort.Slice(filtered, func(i, j int) bool {
		return filtered[i].Count > filtered[j].Count
	})
	return filtered, nil
}

func parseSubjectID(skey string) int {
	// skey format: "{type}:{id}" (e.g., "2:123")
	parts := strings.SplitN(skey, ":", 2)
	if len(parts) == 2 {
		id, _ := strconv.Atoi(parts[1])
		return id
	}
	return 0
}
