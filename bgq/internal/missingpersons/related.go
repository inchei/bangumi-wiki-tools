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

// linkedIndex packs (personID, subjectID) into one uint64 key whose value is
// the list of positions the person holds in the subject — one hash lookup per
// pair instead of three nested map lookups.
type linkedIndex map[uint64][]int

func linkedKey(pid, sid int) uint64 {
	return uint64(uint32(pid))<<32 | uint64(uint32(sid))
}

func (li linkedIndex) has(pid, sid, pos int) bool {
	for _, p := range li[linkedKey(pid, sid)] {
		if p == pos {
			return true
		}
	}
	return false
}

// filterPersonIDs collects the union of existing person IDs across the result
// lists so the linked-index query runs once for all of them.
func filterPersonIDs(lists ...[]*missingRelatedPerson) []int {
	seen := make(map[int]bool)
	var ids []int
	for _, list := range lists {
		for _, rp := range list {
			for _, p := range rp.ExistingPersonIDs {
				if !seen[p.ID] {
					seen[p.ID] = true
					ids = append(ids, p.ID)
				}
			}
		}
	}
	return ids
}

func buildLinkedIndex(ctx context.Context, dbPath string, personIDs []int) (linkedIndex, error) {
	if len(personIDs) == 0 {
		return nil, nil
	}

	var idList strings.Builder
	for i, pid := range personIDs {
		if i > 0 {
			idList.WriteString(",")
		}
		fmt.Fprintf(&idList, "%d", pid)
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

	li := make(linkedIndex, result.TotalRows)
	for _, row := range result.Rows {
		if len(row) < 3 {
			continue
		}
		pid, _ := strconv.Atoi(row[1])
		sid, _ := strconv.Atoi(row[0])
		pos, _ := strconv.Atoi(row[2])
		pos = canonicalPosID(pos)
		key := linkedKey(pid, sid)
		li[key] = append(li[key], pos)
	}
	return li, nil
}

func filterLinkedInto(list []*missingRelatedPerson, li linkedIndex, keepEmpty bool) []*missingRelatedPerson {
	if len(list) == 0 {
		return list
	}
	filtered := make([]*missingRelatedPerson, 0, len(list))
	for _, rp := range list {
		newSubjects := make(map[string]*subjectInfo)
		for skey, si := range rp.Subjects {
			sid := parseSubjectID(skey)
			newPosIDs := make(map[int]struct{}, len(si.PosIDs))
			for pos := range si.PosIDs {
				isLinked := false
				for _, p := range rp.ExistingPersonIDs {
					if li.has(p.ID, sid, pos) {
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
	return filtered
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
