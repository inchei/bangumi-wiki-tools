package query

import "fmt"

// AnthologyTag marks multi-author short-story-collection volumes that bypass
// the series-member exclusion.
const AnthologyTag = "短篇集"

// SeriesRelationType links a book volume (subject_id) to its series
// (related_subject_id).
const SeriesRelationType = 1002

// SeriesVolumeKeepFilter returns a WHERE predicate (true = keep) for a
// subjects-table alias: non-members, or anthology-tagged volumes. The member
// subquery requires a book series (sp.type = 1): 1002 means 系列 only between
// books, while cross-type 1002 rows are mislabeled 改编 links.
func SeriesVolumeKeepFilter(alias string) string {
	return fmt.Sprintf(`(%[1]s.id NOT IN (
    SELECT sr.subject_id FROM subject_relations sr
    JOIN subjects sp ON sp.id = sr.related_subject_id
    WHERE sr.relation_type = %[2]d AND sp.type = 1
  ) OR LIST_CONTAINS(COALESCE(%[1]s.meta_tags, []), '%[3]s'))`,
		alias, SeriesRelationType, AnthologyTag)
}
