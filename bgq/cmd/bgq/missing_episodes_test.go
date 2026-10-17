package main

import (
	"regexp"
	"strconv"
	"testing"

	"github.com/inchei/bangumi-query/internal/query"
)

func TestExpandAppearEps_Single(t *testing.T) {
	got := expandAppearEps("1")
	if !got["1"] {
		t.Error("should include episode 1")
	}
	if len(got) != 1 {
		t.Errorf("expected 1 episode, got %d", len(got))
	}
}

func TestExpandAppearEps_Range(t *testing.T) {
	got := expandAppearEps("1-3")
	for i := 1; i <= 3; i++ {
		if !got[strconv.Itoa(i)] {
			t.Errorf("should include episode %d", i)
		}
	}
	if len(got) != 3 {
		t.Errorf("expected 3 episodes, got %d", len(got))
	}
}

func TestExpandAppearEps_Multi(t *testing.T) {
	got := expandAppearEps("1,3,5-7")
	for _, e := range []string{"1", "3", "5", "6", "7"} {
		if !got[e] {
			t.Errorf("should include episode %s", e)
		}
	}
	if len(got) != 5 {
		t.Errorf("expected 5 episodes, got %d", len(got))
	}
}

func TestExpandAppearEps_Empty(t *testing.T) {
	got := expandAppearEps("")
	if len(got) != 0 {
		t.Errorf("expected empty, got %d", len(got))
	}
}

func TestEpLabel_Normal(t *testing.T) {
	got := epLabel(1, 0)
	if got != "1" {
		t.Errorf("expected '1', got '%s'", got)
	}
}

func TestEpLabel_SP(t *testing.T) {
	got := epLabel(2, 1)
	if got != "SP2" {
		t.Errorf("expected 'SP2', got '%s'", got)
	}
}

func TestEpLabel_OP(t *testing.T) {
	got := epLabel(1, 2)
	if got != "OP1" {
		t.Errorf("expected 'OP1', got '%s'", got)
	}
}

func TestEpLabel_ED(t *testing.T) {
	got := epLabel(1, 3)
	if got != "ED1" {
		t.Errorf("expected 'ED1', got '%s'", got)
	}
}

func TestResolveOverlaps_NoOverlap(t *testing.T) {
	matches := [][]int{{0, 3}, {5, 8}}
	got := resolveOverlaps(matches)
	if len(got) != 2 {
		t.Errorf("expected 2, got %d", len(got))
	}
}

func TestResolveOverlaps_WithOverlap(t *testing.T) {
	matches := [][]int{{0, 5}, {3, 8}}
	got := resolveOverlaps(matches)
	if len(got) != 1 {
		t.Errorf("expected 1 non-overlapping match, got %d", len(got))
	}
}

func TestBuildEpPositionTable_ProducesRegex(t *testing.T) {
	positions := map[int]string{1: "原作", 46: "系列构成"}
	lit2pid, re := buildEpPositionTable(positions)
	if re == nil {
		t.Fatal("should produce a regex")
	}
	if _, ok := lit2pid["原作"]; !ok {
		t.Error("should map 原作 to position ID")
	}
	if !re.MatchString("原作") {
		t.Error("regex should match 原作")
	}
}

func TestEscapedNameSpaceTolerantPattern(t *testing.T) {
	cases := []struct {
		name string
		want string
	}{
		{"今石洋之", `今[ 　]*石[ 　]*洋[ 　]*之`},
		{"C.C.", `C[ 　]*\.[ 　]*C[ 　]*\.`},
		{"OVA*版", `O[ 　]*V[ 　]*A[ 　]*\*[ 　]*版`},
		{"今 石 洋之", `今[ 　]*石[ 　]*洋[ 　]*之`},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := escapedNameSpaceTolerantPattern(query.EscapeLiteral(tc.name))
			if got != tc.want {
				t.Errorf("got %q, want %q", got, tc.want)
			}
		})
	}
}

// TestEscapedNameSpaceTolerantPattern_ContainsSlices pins the space-tolerant
// substring semantics the wide filter must keep for the Go exact-match phase.
func TestEscapedNameSpaceTolerantPattern_ContainsSlices(t *testing.T) {
	cases := []struct {
		esc string
		ok  bool
	}{
		{"今石洋之", true},
		{"今 石洋之", true},
		{"今石 洋之", true},
		{"今　石　洋　之", true},
		{"今石X洋之", false},
		{"今\t石洋之", false},
		{"今石洋", false},
	}
	for _, tc := range cases {
		re := regexp.MustCompile(escapedNameSpaceTolerantPattern(query.EscapeLiteral("今石洋之")))
		if got := re.MatchString(tc.esc); got != tc.ok {
			t.Errorf("pattern against %q = %v, want %v", tc.esc, got, tc.ok)
		}
	}
}
