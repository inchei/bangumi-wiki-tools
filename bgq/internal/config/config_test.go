package config

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"

	"gopkg.in/yaml.v3"
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

func TestValidateNestedFilters(t *testing.T) {
	logic := func(items ...Filter) Filter {
		return Filter{Logic: &LogicFilter{Op: "and", Items: items}}
	}
	field := func(op string) Filter {
		return Filter{Field: &FieldFilter{Field: "name", Operator: op, Value: "x"}}
	}
	episode := &EpisodeFilter{Mode: "any", Logic: &LogicFilter{Op: "and", Items: []Filter{field("contains")}}}
	staff := func(mode string) Filter {
		return Filter{Staff: &StaffFilter{Position: "导演", Mode: mode, Conditions: []Filter{field("contains")}}}
	}

	t.Run("wrong target for episode", func(t *testing.T) {
		cfg := &Config{Target: "person", Filters: []Filter{logic(Filter{Episode: episode})}}
		err := cfg.Validate()
		if err == nil || !strings.Contains(err.Error(), "episode 筛选仅支持 target: subject") {
			t.Fatalf("expected nested target error, got %v", err)
		}
	})

	t.Run("bad mode", func(t *testing.T) {
		cfg := &Config{Filters: []Filter{logic(staff("bogus_mode"))}}
		err := cfg.Validate()
		if err == nil || !strings.Contains(err.Error(), "mode「bogus_mode」不存在") {
			t.Fatalf("expected nested mode error, got %v", err)
		}
	})

	t.Run("deep nesting is validated", func(t *testing.T) {
		cfg := &Config{Filters: []Filter{logic(logic(staff("bogus_mode")))}}
		err := cfg.Validate()
		if err == nil || !strings.Contains(err.Error(), "mode「bogus_mode」不存在") {
			t.Fatalf("expected deep path error, got %v", err)
		}
	})

	t.Run("episode without logic", func(t *testing.T) {
		cfg := &Config{Filters: []Filter{logic(Filter{Episode: &EpisodeFilter{Mode: "any"}})}}
		err := cfg.Validate()
		if err == nil || !strings.Contains(err.Error(), "episode 筛选需要提供 logic 条件") {
			t.Fatalf("expected nested logic error, got %v", err)
		}
	})

	t.Run("bad logic op", func(t *testing.T) {
		cfg := &Config{Filters: []Filter{logic(Filter{Logic: &LogicFilter{Op: "xor", Items: []Filter{field("contains")}}})}}
		err := cfg.Validate()
		if err == nil || !strings.Contains(err.Error(), "logic op 必须为 and 或 or") {
			t.Fatalf("expected nested op error, got %v", err)
		}
	})

	t.Run("bad operator", func(t *testing.T) {
		cfg := &Config{Filters: []Filter{logic(field("bogus_op"))}}
		err := cfg.Validate()
		if err == nil || !strings.Contains(err.Error(), "operator「bogus_op」不存在") {
			t.Fatalf("expected nested operator error, got %v", err)
		}
	})

	t.Run("empty nested filter", func(t *testing.T) {
		cfg := &Config{Filters: []Filter{logic(Filter{})}}
		err := cfg.Validate()
		if err == nil || !strings.Contains(err.Error(), "至少需要指定一个过滤类型") {
			t.Fatalf("expected nested empty-filter error, got %v", err)
		}
	})

	t.Run("labeled subject conditions", func(t *testing.T) {
		cfg := &Config{Filters: []Filter{logic(Filter{PersonCharacter: &PersonCharacterFilter{
			Mode:              "any",
			Conditions:        []Filter{field("contains")},
			SubjectConditions: []Filter{field("bogus_op")},
		}})}}
		err := cfg.Validate()
		if err == nil || !strings.Contains(err.Error(), "operator「bogus_op」不存在") {
			t.Fatalf("expected labeled path error, got %v", err)
		}
	})

	t.Run("valid nested filters still pass", func(t *testing.T) {
		cfg := &Config{Filters: []Filter{logic(
			staff("any"),
			logic(Filter{Episode: episode}),
			Filter{PersonCharacter: &PersonCharacterFilter{
				Mode:              "any",
				Conditions:        []Filter{field("contains")},
				SubjectConditions: []Filter{field("eq")},
			}},
		)}}
		if err := cfg.Validate(); err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
	})
}

func TestFilterJSONMatchesYAML(t *testing.T) {
	pairs := []struct {
		name string
		yaml string
		json string
	}{
		{"field", `field: { field: name, operator: contains, value: "x" }`, `{"field":{"field":"name","operator":"contains","value":"x"}}`},
		{"type", `type: 2`, `{"type":2}`},
		{"tag", `tag: { operator: contains, value: TV, negate: true }`, `{"tag":{"operator":"contains","value":"TV","negate":true}}`},
		{"relation", `relation: { type: 系列, mode: any, conditions: [{ field: { field: name, operator: eq, value: y } }] }`,
			`{"relation":{"type":"系列","mode":"any","conditions":[{"field":{"field":"name","operator":"eq","value":"y"}}]}}`},
		{"episode", `episode: { mode: none, logic: { op: or, items: [{ field: { field: type, operator: eq, value: OP } }] } }`,
			`{"episode":{"mode":"none","logic":{"op":"or","items":[{"field":{"field":"type","operator":"eq","value":"OP"}}]}}}`},
		{"logic", `logic: { op: and, items: [{ tag: { operator: contains, value: TV } }] }`,
			`{"logic":{"op":"and","items":[{"tag":{"operator":"contains","value":"TV"}}]}}`},
	}

	for _, p := range pairs {
		t.Run(p.name, func(t *testing.T) {
			var fromYAML, fromJSON Filter
			if err := yaml.Unmarshal([]byte(p.yaml), &fromYAML); err != nil {
				t.Fatalf("yaml: %v", err)
			}
			if err := json.Unmarshal([]byte(p.json), &fromJSON); err != nil {
				t.Fatalf("json: %v", err)
			}
			if !reflect.DeepEqual(fromYAML, fromJSON) {
				t.Fatalf("decoders disagree:\nyaml: %+v\njson: %+v", fromYAML, fromJSON)
			}
		})
	}

	invalid := []struct {
		name string
		yaml string
		json string
	}{
		{"unknown item key", `typo: { value: 1 }`, `{"typo":{"value":1}}`},
		{"unknown nested key", `field: { field: name, operator: contains, value: x, typo: 1 }`,
			`{"field":{"field":"name","operator":"contains","value":"x","typo":1}}`},
	}
	for _, p := range invalid {
		t.Run(p.name, func(t *testing.T) {
			var fromYAML, fromJSON Filter
			yamlErr := yaml.Unmarshal([]byte(p.yaml), &fromYAML)
			jsonErr := json.Unmarshal([]byte(p.json), &fromJSON)
			if yamlErr == nil || jsonErr == nil {
				t.Fatalf("both decoders should reject: yaml=%v json=%v", yamlErr, jsonErr)
			}
			if yamlErr.Error() != jsonErr.Error() {
				t.Fatalf("error mismatch: yaml=%q json=%q", yamlErr, jsonErr)
			}
		})
	}
}

func TestFilterJSONMultiTypeRejectedByValidate(t *testing.T) {
	var f Filter
	body := `{"field":{"field":"name","operator":"contains","value":"x"},"tag":{"operator":"contains","value":"TV"}}`
	if err := json.Unmarshal([]byte(body), &f); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	cfg := &Config{Filters: []Filter{f}}
	err := cfg.Validate()
	if err == nil || !strings.Contains(err.Error(), "每个条件只能指定一种过滤类型") {
		t.Fatalf("expected multi-type rejection, got %v", err)
	}
}

func TestFilterJSONToleratesPrivateKeys(t *testing.T) {
	var f Filter
	body := `{"field":{"field":"name","operator":"contains","value":"x","_special":true},"_id":7}`
	if err := json.Unmarshal([]byte(body), &f); err != nil {
		t.Fatalf("private keys should be tolerated, got %v", err)
	}
	if f.Field == nil || f.Field.Field != "name" {
		t.Fatalf("field filter not decoded: %+v", f)
	}
}
