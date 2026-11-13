package query

import "fmt"

// AnthologyTag marks multi-author short-story-collection volumes that bypass
// the series-member exclusion.
const AnthologyTag = "短篇集"

// SeriesRelationType links a book volume (subject_id) to its series
// (related_subject_id).
const SeriesRelationType = 1002

// SeriesVolumeKeepFilter returns a WHERE predicate (true = keep) for a
// subjects-table alias: non-members, or anthology-tagged volumes.
func SeriesVolumeKeepFilter(alias string) string {
	return fmt.Sprintf(`(%[1]s.id NOT IN (
    SELECT subject_id FROM subject_relations WHERE relation_type = %[2]d
  ) OR LIST_CONTAINS(COALESCE(%[1]s.meta_tags, []), '%[3]s'))`,
		alias, SeriesRelationType, AnthologyTag)
}
