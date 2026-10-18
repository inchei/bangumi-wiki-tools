package missingpersons

import (
	"fmt"
	"os"
	"sort"
	"strings"
	"time"
	"unicode/utf8"
)

const missingPersonsMinCount = 2

// nameInfo caches the isLikelyPerson verdict and normalized form of a raw
// person-name token; normalizePersonName (NFKC) dominates otherwise.
type nameInfo struct {
	likely bool
	norm   string
}

func parseSubjects(records []subjectRecord) map[string]*missingPerson {
	personSubjects := make(map[string]*missingPerson, 1<<20)
	cache := make(map[string]nameInfo, 1<<19)
	total := len(records)
	lastLog := time.Now()

	for i, subj := range records {
		if i%100000 == 0 && i > 0 {
			elapsed := time.Since(lastLog)
			fmt.Fprintf(os.Stderr, "  已处理: %d/%d (%.1fs)\n", i, total, elapsed.Seconds())
			lastLog = time.Now()
		}
		pni, ok := _typePni[subj.Type]
		if !ok {
			continue
		}

		addPersonNames(subj, pni, personSubjects, cache)
	}
	return personSubjects
}

func addPersonNames(subj subjectRecord, pni map[string]int, personSubjects map[string]*missingPerson, cache map[string]nameInfo) {
	infobox := subj.Infobox
	skey := fmt.Sprintf("%d:%d", subj.Type, subj.ID)

	start := 0
	for start < len(infobox) {
		end := strings.IndexByte(infobox[start:], '\n')
		var line string
		if end >= 0 {
			line = infobox[start : start+end]
			start = start + end + 1
		} else {
			line = infobox[start:]
			start = len(infobox)
		}
		if len(line) > 0 && line[len(line)-1] == '\r' {
			line = line[:len(line)-1]
		}
		if len(line) == 0 || line[0] != '|' {
			continue
		}

		key, value, found := strings.Cut(line[1:], "=")
		if !found {
			continue
		}
		key = strings.TrimSpace(key)
		key = strings.TrimRight(key, "：:")
		if key == "原作" {
			continue
		}
		posID, ok := pni[key]
		if !ok {
			continue
		}
		value = strings.TrimSpace(value)

		// Manual FieldsFunc(value, isDelim) tokenization so each delimiter-rune
		// run yields a subslice token; allocation only happens later for
		// cache-key insertion and normalization.
		i, n := 0, len(value)
		for i < n {
			r, sz := utf8.DecodeRuneInString(value[i:])
			if isDelim(r) {
				i += sz
				continue
			}
			tokStart := i
			for i < n {
				r, sz := utf8.DecodeRuneInString(value[i:])
				if isDelim(r) {
					break
				}
				i += sz
			}
			name := strings.TrimSpace(value[tokStart:i])
			if len(name) < 2 {
				continue
			}
			info, ok := cache[name]
			if !ok {
				info = nameInfo{likely: isLikelyPerson(name)}
				if info.likely {
					info.norm = normalizePersonName(name)
				}
				cache[name] = info
			}
			if !info.likely {
				continue
			}
			entry := personSubjects[info.norm]
			if entry == nil {
				entry = &missingPerson{
					DisplayName: name,
					KeyNorm:     info.norm,
					Subjects:    make(map[string]*subjectInfo),
					TypeCounts:  make(map[int]int),
				}
				personSubjects[info.norm] = entry
			}
			if si, ok := entry.Subjects[skey]; ok {
				si.PosIDs[posID] = struct{}{}
			} else {
				entry.Subjects[skey] = &subjectInfo{
					SubjectName: subj.Name,
					DisplayName: name,
					SubjectType: subj.Type,
					PosIDs:      map[int]struct{}{posID: {}},
				}
			}
			entry.TypeCounts[subj.Type]++
		}
	}
}

func filterMissing(personSubjects map[string]*missingPerson, existing map[string]bool) []*missingPerson {
	var missing []*missingPerson
	for keyNorm, entry := range personSubjects {
		if existing[keyNorm] {
			continue
		}
		if len(entry.Subjects) < missingPersonsMinCount {
			continue
		}
		entry.Count = len(entry.Subjects)
		entry.DisplayName = entry.Subjects[firstSubjectKey(entry.Subjects)].DisplayName
		missing = append(missing, entry)
	}
	sort.Slice(missing, func(i, j int) bool {
		return missing[i].Count > missing[j].Count
	})
	return missing
}

func firstSubjectKey(subjects map[string]*subjectInfo) string {
	for k := range subjects {
		return k
	}
	return ""
}
