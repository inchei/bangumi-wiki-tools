package main

import (
	"strings"
	"testing"

	"github.com/inchei/bangumi-query/internal/model"
)

func TestNarrowPositions(t *testing.T) {
	all := map[int]string{2001: "作者", 2002: "作画"}

	got, err := narrowPositions(1, all, 0)
	if err != nil || len(got) != 2 {
		t.Fatalf("posID 0 should keep all positions, got %v (err %v)", got, err)
	}

	got, err = narrowPositions(1, all, 2001)
	if err != nil || len(got) != 1 || got[2001] != "作者" {
		t.Fatalf("posID 2001 should narrow to 作者, got %v (err %v)", got, err)
	}

	_, err = narrowPositions(1, all, 9999)
	if err == nil || !strings.Contains(err.Error(), "没有职位 ID 9999") {
		t.Fatalf("unknown position should error, got %v", err)
	}
}

func TestBuildCheckSQL_BookExcludesSeries(t *testing.T) {
	positions := map[int]string{2001: "作者"}
	sql := buildCheckSQL(1, "川原砾", positions, 0)

	if !strings.Contains(sql, "series_ids") {
		t.Error("book type (1) should include series_ids CTE")
	}
	if !strings.Contains(sql, "relation_type = 1002") {
		t.Error("series_ids should filter relation_type = 1002")
	}
	if !strings.Contains(sql, "s.type = 1") {
		t.Error("should filter subjects.type = 1")
	}
	// series filter should appear inside the pairs subquery, not as UNION ALL
	if !strings.Contains(sql, "AND s.id NOT IN (SELECT id FROM series_ids)") {
		t.Error("series filter clause should be present for book type")
	}
}

func TestBuildCheckSQL_AnimeNoSeriesFilter(t *testing.T) {
	positions := map[int]string{1: "原作"}
	sql := buildCheckSQL(2, "川原砾", positions, 0)

	if strings.Contains(sql, "series_ids") {
		t.Error("anime type (2) should NOT include series_ids CTE")
	}
	if !strings.Contains(sql, "s.type = 2") {
		t.Error("should filter subjects.type = 2")
	}
	if strings.Contains(sql, "NOT IN (SELECT id FROM series_ids)") {
		t.Error("anime type (2) should NOT apply the series filter")
	}
}

func TestBuildCheckSQL_PositionsMapContainsAllPositions(t *testing.T) {
	positions := map[int]string{1: "原作", 46: "系列构成"}
	sql := buildCheckSQL(2, "川原砾", positions, 0)

	if !strings.Contains(sql, "positions_map(id, name) AS") {
		t.Error("should include positions_map CTE")
	}
	if !strings.Contains(sql, "(1, '原作')") {
		t.Error("positions_map VALUES should include position id=1 '原作'")
	}
	if !strings.Contains(sql, "(46, '系列构成')") {
		t.Error("positions_map VALUES should include position id=46 '系列构成'")
	}
}

func TestBuildCheckSQL_NoUnionAll(t *testing.T) {
	// Phase 1 design replaces the per-position UNION ALL with a single
	// SELECT joining against positions_map.
	positions := map[int]string{1: "原作", 46: "系列构成", 20: "原画"}
	sql := buildCheckSQL(2, "川原砾", positions, 0)

	if strings.Contains(sql, "UNION ALL") {
		t.Error("Phase 1 SQL should NOT use UNION ALL (replaced by positions_map join)")
	}
}

func TestBuildCheckSQL_PairsCTEUsesSingleRegex(t *testing.T) {
	positions := map[int]string{1: "原作"}
	sql := buildCheckSQL(2, "川原砾", positions, 0)

	if !strings.Contains(sql, "pairs AS") {
		t.Error("should include pairs CTE")
	}
	if !strings.Contains(sql, "regexp_extract_all") {
		t.Error("pairs CTE should use regexp_extract_all for single-pass extraction")
	}
	if strings.Contains(sql, "LIST_ZIP") {
		t.Error("pairs CTE should UNNEST lists directly without LIST_ZIP")
	}
	// Count occurrences of the infobox pattern — should appear exactly twice
	// (one for group 1, one for group 2) regardless of how many positions
	// are being checked.
	patternCount := strings.Count(sql, infoboxPairPattern)
	if patternCount != 2 {
		t.Errorf("infobox pattern should appear exactly twice (group 1 + group 2), got %d", patternCount)
	}
}

func TestBuildCheckSQL_NoMatchColumns(t *testing.T) {
	// Phase 1 removed the m_<id> boolean-column scheme from buildMatchCols.
	positions := map[int]string{1: "原作", 46: "系列构成"}
	sql := buildCheckSQL(2, "川原砾", positions, 0)

	if strings.Contains(sql, "m_1") || strings.Contains(sql, "m_46") {
		t.Error("Phase 1 SQL should NOT reference m_<id> match columns")
	}
	if strings.Contains(sql, "AS m_") {
		t.Error("Phase 1 SQL should NOT define any m_<id> columns")
	}
}

func TestBuildCheckSQL_GameType(t *testing.T) {
	positions := make(map[int]string)
	for id, posName := range model.StaffPositions[4] {
		positions[id] = posName
	}
	sql := buildCheckSQL(4, "虚淵玄", positions, 0)

	if !strings.Contains(sql, "s.type = 4") {
		t.Error("should filter subjects.type = 4")
	}
	if strings.Contains(sql, "series_ids") {
		t.Error("game type (4) should NOT include series_ids CTE")
	}
}

func TestBuildCheckSQL_ContainsLinkedCTE(t *testing.T) {
	positions := map[int]string{1: "原作"}
	sql := buildCheckSQL(2, "川原砾", positions, 0)

	if !strings.Contains(sql, "linked AS") {
		t.Error("should include linked CTE for existing staff check")
	}
	if !strings.Contains(sql, "subject_persons sp") {
		t.Error("linked CTE should join subject_persons")
	}
	if !strings.Contains(sql, "persons p") {
		t.Error("linked CTE should join persons")
	}
}

func TestBuildCheckSQL_NameEscaping(t *testing.T) {
	positions := map[int]string{2001: "作者"}
	sql := buildCheckSQL(1, "O'Brien", positions, 0)

	if !strings.Contains(sql, "O''Brien") {
		t.Error("should escape single quotes in name")
	}
}

func TestBuildCheckSQL_FinalSelectShape(t *testing.T) {
	positions := map[int]string{1: "原作"}
	sql := buildCheckSQL(2, "川原砾", positions, 0)

	if !strings.Contains(sql, "SELECT pairs.subject_id, pairs.subject_name, pm.id") {
		t.Error("final SELECT should project (pairs.subject_id, pairs.subject_name, pm.id)")
	}
	if strings.Contains(sql, "FROM subjects s\nJOIN pairs") {
		t.Error("final SELECT should not re-join subjects (pairs carries the name)")
	}
	if !strings.Contains(sql, "JOIN positions_map pm ON pm.name = pairs.k") {
		t.Error("final SELECT should join positions_map on name = pairs.k")
	}
	if !strings.Contains(sql, "NOT EXISTS (SELECT 1 FROM linked l") {
		t.Error("final SELECT should anti-join linked via NOT EXISTS")
	}
	if !strings.Contains(sql, "ORDER BY pairs.subject_id, pm.id") {
		t.Error("final SELECT should order by (subject_id, pm.id) for stable output")
	}
}

func TestBuildCheckSQL_NamePrefilter(t *testing.T) {
	positions := map[int]string{1: "原作"}
	sql := buildCheckSQL(2, "川原砾", positions, 0)

	if !strings.Contains(sql, "regexp_matches(REPLACE(REPLACE(s.infobox, '　', ''), ' ', ''), '(?i)川原砾')") {
		t.Error("pairs CTE should prefilter subjects by case-insensitive literal name match")
	}

	// ASCII case must be covered: the prefilter literal is case-insensitive,
	// regex-escaped, and built from the space-stripped name
	sql = buildCheckSQL(4, "George Wada", positions, 0)
	if !strings.Contains(sql, `(?i)GeorgeWada`) {
		t.Error("prefilter literal should be regex-escaped, space-stripped, case-insensitive")
	}

	// A name made only of whitespace cannot prefilter anything
	empty := strings.Contains(buildCheckSQL(2, " ", positions, 0), "regexp_matches(REPLACE(REPLACE(s.infobox")
	if empty {
		t.Error("blank name should skip the prefilter")
	}
}

func TestBuildCheckSQL_SinglePositionStillUsesPositionsMap(t *testing.T) {
	// Even with one position, Phase 1 uses the positions_map join shape
	// (no special-casing back to the old m_<id> scheme).
	positions := map[int]string{5: "插图"}
	sql := buildCheckSQL(1, "川原砾", positions, 0)

	if !strings.Contains(sql, "positions_map") {
		t.Error("single position should still use positions_map CTE")
	}
	if strings.Contains(sql, "UNION ALL") {
		t.Error("single position should not have UNION ALL")
	}
}
