package config

import (
	"strings"
	"testing"
)

func TestValidateFilterTreeLimits(t *testing.T) {
	mkField := func(name string) Filter {
		return Filter{Field: &FieldFilter{Field: name, Operator: "contains", Value: "x"}}
	}

	t.Run("over total count", func(t *testing.T) {
		items := make([]Filter, 0, maxFilterCount+1)
		for i := 0; i < maxFilterCount+1; i++ {
			items = append(items, mkField("name"))
		}
		cfg := &Config{Filters: []Filter{{Logic: &LogicFilter{Op: "and", Items: items}}}}
		err := cfg.Validate()
		if err == nil || !strings.Contains(err.Error(), "超过上限") {
			t.Fatalf("expected count limit error, got %v", err)
		}
	})

	t.Run("within total count", func(t *testing.T) {
		// The outer Logic node counts too, so keep 499 items + 1 wrapper = 500.
		items := make([]Filter, 0, maxFilterCount-1)
		for i := 0; i < maxFilterCount-1; i++ {
			items = append(items, mkField("name"))
		}
		cfg := &Config{Filters: []Filter{{Logic: &LogicFilter{Op: "and", Items: items}}}}
		if err := cfg.Validate(); err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
	})

	t.Run("over nesting depth", func(t *testing.T) {
		inner := mkField("name")
		for i := 0; i < maxFilterDepth; i++ {
			inner = Filter{Logic: &LogicFilter{Op: "and", Items: []Filter{inner}}}
		}
		cfg := &Config{Filters: []Filter{inner}}
		err := cfg.Validate()
		if err == nil || !strings.Contains(err.Error(), "深度") {
			t.Fatalf("expected depth limit error, got %v", err)
		}
	})
}

func TestValidateRejectsGroupSort(t *testing.T) {
	cfg := &Config{
		Filters: []Filter{{Field: &FieldFilter{Field: "name", Operator: "contains", Value: "x"}}},
		Sort:    []SortRule{{Field: "导演.{name|生日|id}", Direction: "desc"}},
	}
	err := cfg.Validate()
	if err == nil || !strings.Contains(err.Error(), "不能包含 {}") {
		t.Fatalf("expected group-sort rejection, got %v", err)
	}
}

func TestValidateTarget(t *testing.T) {
	for _, target := range []string{"", "subject", "person", "character", "episode"} {
		cfg := &Config{Target: target, Filters: []Filter{{Field: &FieldFilter{Field: "name", Operator: "contains", Value: "x"}}}}
		if err := cfg.Validate(); err != nil {
			t.Fatalf("target %q should be valid, got %v", target, err)
		}
	}
	cfg := &Config{Target: "music", Filters: []Filter{{Field: &FieldFilter{Field: "name", Operator: "contains", Value: "x"}}}}
	err := cfg.Validate()
	if err == nil || !strings.Contains(err.Error(), "target「music」不存在") {
		t.Fatalf("expected unknown target error, got %v", err)
	}
}

func TestValidateEpisodeFilter(t *testing.T) {
	episode := func(mode string, logic *LogicFilter) Filter {
		return Filter{Episode: &EpisodeFilter{Mode: mode, Logic: logic}}
	}
	validLogic := &LogicFilter{Op: "and", Items: []Filter{
		{Field: &FieldFilter{Field: "name", Operator: "contains", Value: "x"}},
	}}

	t.Run("subject target with logic is valid", func(t *testing.T) {
		cfg := &Config{Target: "subject", Filters: []Filter{episode("any", validLogic)}}
		if err := cfg.Validate(); err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
	})

	t.Run("non-subject target is rejected", func(t *testing.T) {
		for _, target := range []string{"person", "character", "episode"} {
			cfg := &Config{Target: target, Filters: []Filter{episode("any", validLogic)}}
			err := cfg.Validate()
			if err == nil || !strings.Contains(err.Error(), "仅支持 target: subject") {
				t.Fatalf("target %q: expected subject-only error, got %v", target, err)
			}
		}
	})

	t.Run("mode none is accepted", func(t *testing.T) {
		cfg := &Config{Filters: []Filter{episode("none", validLogic)}}
		if err := cfg.Validate(); err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
	})

	t.Run("missing logic is rejected", func(t *testing.T) {
		cfg := &Config{Filters: []Filter{episode("any", nil)}}
		err := cfg.Validate()
		if err == nil || !strings.Contains(err.Error(), "需要提供 logic") {
			t.Fatalf("expected logic-required error, got %v", err)
		}
		cfg = &Config{Filters: []Filter{episode("any", &LogicFilter{Op: "and"})}}
		if err := cfg.Validate(); err == nil {
			t.Fatalf("expected empty logic items to be rejected")
		}
	})
}

func TestValidateLimitUncapped(t *testing.T) {
	// The 1..10000 window is a Web UI/API concern (frontend validation +
	// server-side clamp); the CLI must stay uncapped for bulk exports.
	cfg := &Config{
		Filters: []Filter{{Field: &FieldFilter{Field: "name", Operator: "contains", Value: "x"}}},
		Limit:   1000000,
	}
	if err := cfg.Validate(); err != nil {
		t.Fatalf("CLI limit should be uncapped, got %v", err)
	}
}

func TestParseYAMLKnownFields(t *testing.T) {
	t.Run("unknown top-level key", func(t *testing.T) {
		_, err := ParseYAML([]byte("filters: []\nlimt: 500\n"))
		if err == nil || !strings.Contains(err.Error(), "limt") {
			t.Fatalf("expected unknown key error, got %v", err)
		}
	})

	t.Run("unknown nested filter key", func(t *testing.T) {
		_, err := ParseYAML([]byte("filters:\n  - field:\n      field: name\n      operator: contains\n      value: x\n      typo: 1\n"))
		if err == nil || !strings.Contains(err.Error(), "typo") {
			t.Fatalf("expected unknown nested key error, got %v", err)
		}
	})

	t.Run("empty input skips decode but fails validation", func(t *testing.T) {
		_, err := ParseYAML([]byte(""))
		if err == nil || !strings.Contains(err.Error(), "至少需要一个筛选条件") {
			t.Fatalf("expected filters-required error (not EOF), got %v", err)
		}
	})
}
