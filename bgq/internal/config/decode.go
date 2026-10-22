package config

import (
	"bytes"
	"fmt"
	"io"
	"os"
	"reflect"
	"strings"
	"sync"

	"gopkg.in/yaml.v3"
)

// UnmarshalJSON decodes a filter from the JSON sent by the HTTP API / Web UI.
// JSON is a subset of YAML, so the payload is handed to the YAML decoder:
// both entry points share one implementation (UnmarshalYAML) and cannot drift.
func (f *Filter) UnmarshalJSON(data []byte) error {
	var doc yaml.Node
	if err := yaml.Unmarshal(data, &doc); err != nil {
		return err
	}
	if len(doc.Content) == 0 {
		return nil
	}
	return f.UnmarshalYAML(doc.Content[0])
}

// UnmarshalYAML implements custom YAML unmarshaling for Filter.
// Supports both shorthand (type: 2) and full (type: {value: 2}) forms.
func (f *Filter) UnmarshalYAML(value *yaml.Node) error {
	if value.Kind != yaml.MappingNode {
		return fmt.Errorf("filter must be a mapping, got %v", value.Kind)
	}

	for i := 0; i < len(value.Content); i += 2 {
		key := value.Content[i].Value
		val := value.Content[i+1]

		switch key {
		case "type":
			f.Type = &TypeFilter{}
			if val.Kind == yaml.ScalarNode {
				f.Type.Value = parseYAMLValue(val)
			} else {
				if err := decodeStrict(val, key, f.Type); err != nil {
					return err
				}
			}
		case "field":
			f.Field = &FieldFilter{}
			if val.Kind == yaml.ScalarNode {
				// Shorthand: field: <field_name> (just the field name, no condition)
				f.Field.Field = val.Value
				f.Field.Operator = "contains"
				f.Field.Value = ""
			} else {
				if err := decodeStrict(val, key, f.Field); err != nil {
					return err
				}
			}
		case "tag":
			if val.Kind == yaml.ScalarNode {
				// Shorthand: tag: <tag_name>
				f.Tag = &TagFilter{Operator: "contains", Value: val.Value}
			} else {
				f.Tag = &TagFilter{}
				if err := decodeStrict(val, key, f.Tag); err != nil {
					return err
				}
			}
		case "meta_tag":
			if val.Kind == yaml.ScalarNode {
				// Shorthand: meta_tag: <tag_name>
				f.MetaTag = &TagFilter{Operator: "contains", Value: val.Value}
			} else {
				f.MetaTag = &TagFilter{}
				if err := decodeStrict(val, key, f.MetaTag); err != nil {
					return err
				}
			}
		case "relation":
			if val.Kind == yaml.ScalarNode {
				f.Relation = &RelationFilter{Type: val.Value, Mode: "any"}
			} else {
				f.Relation = &RelationFilter{}
				if err := decodeStrict(val, key, f.Relation); err != nil {
					return err
				}
			}
		case "person_relation":
			if val.Kind == yaml.ScalarNode {
				f.PersonRelation = &PersonRelationFilter{Type: val.Value, Mode: "any"}
			} else {
				f.PersonRelation = &PersonRelationFilter{}
				if err := decodeStrict(val, key, f.PersonRelation); err != nil {
					return err
				}
			}
		case "character_relation":
			if val.Kind == yaml.ScalarNode {
				f.CharacterRelation = &CharacterRelationFilter{Type: val.Value, Mode: "any"}
			} else {
				f.CharacterRelation = &CharacterRelationFilter{}
				if err := decodeStrict(val, key, f.CharacterRelation); err != nil {
					return err
				}
			}
		case "staff":
			if val.Kind == yaml.ScalarNode {
				f.Staff = &StaffFilter{Position: val.Value, Mode: "any"}
			} else {
				f.Staff = &StaffFilter{}
				if err := decodeStrict(val, key, f.Staff); err != nil {
					return err
				}
			}
		case "character":
			f.Character = &CharacterFilter{}
			if err := decodeStrict(val, key, f.Character); err != nil {
				return err
			}
		case "person_character":
			f.PersonCharacter = &PersonCharacterFilter{}
			if err := decodeStrict(val, key, f.PersonCharacter); err != nil {
				return err
			}
		case "person_cast_subject":
			f.PersonCastSubject = &PersonCastSubjectFilter{}
			if err := decodeStrict(val, key, f.PersonCastSubject); err != nil {
				return err
			}
		case "subject_cast":
			f.SubjectCast = &SubjectCastFilter{}
			if err := decodeStrict(val, key, f.SubjectCast); err != nil {
				return err
			}
		case "character_person":
			f.CharacterPerson = &CharacterPersonFilter{}
			if err := decodeStrict(val, key, f.CharacterPerson); err != nil {
				return err
			}
		case "episode":
			f.Episode = &EpisodeFilter{}
			if err := decodeStrict(val, key, f.Episode); err != nil {
				return err
			}
		case "logic":
			f.Logic = &LogicFilter{}
			if err := decodeStrict(val, key, f.Logic); err != nil {
				return err
			}
		default:
			// The Web UI stores private bookkeeping keys (e.g. field._special)
			// inside filter objects and its validator exempts "_"-prefixed keys.
			if !strings.HasPrefix(key, "_") {
				return fmt.Errorf("未知筛选键「%s」", key)
			}
		}
	}
	return nil
}

// strictYAMLKeys caches the yaml-tagged field names per struct type.
var strictYAMLKeys sync.Map // reflect.Type -> map[string]struct{}

func strictYAMLKeysFor(t reflect.Type) map[string]struct{} {
	if cached, ok := strictYAMLKeys.Load(t); ok {
		return cached.(map[string]struct{})
	}
	keys := make(map[string]struct{})
	for i := 0; i < t.NumField(); i++ {
		name := strings.Split(t.Field(i).Tag.Get("yaml"), ",")[0]
		if name == "" || name == "-" {
			continue
		}
		keys[name] = struct{}{}
	}
	actual, _ := strictYAMLKeys.LoadOrStore(t, keys)
	return actual.(map[string]struct{})
}

// decodeStrict decodes a mapping node into target, rejecting keys that are
// not yaml-tagged fields of the target struct. KnownFields(true) does not
// propagate through custom UnmarshalYAML → node.Decode, so nested filter
// values would otherwise silently drop unknown keys while the Web UI's YAML
// editor rejects them (kind names the error like the frontend does).
// "_"-prefixed keys are the Web UI's private bookkeeping fields and pass
// through, matching the frontend validator.
func decodeStrict(node *yaml.Node, kind string, target interface{}) error {
	if node.Kind == yaml.MappingNode {
		t := reflect.TypeOf(target)
		if t.Kind() == reflect.Pointer {
			t = t.Elem()
		}
		if t.Kind() == reflect.Struct {
			allowed := strictYAMLKeysFor(t)
			for i := 0; i < len(node.Content); i += 2 {
				key := node.Content[i].Value
				if strings.HasPrefix(key, "_") {
					continue
				}
				if _, ok := allowed[key]; !ok {
					return fmt.Errorf("%s 中未知键「%s」", kind, key)
				}
			}
		}
	}
	return node.Decode(target)
}

// parseYAMLValue converts a YAML scalar node to a Go value.
func parseYAMLValue(node *yaml.Node) interface{} {
	switch node.Tag {
	case "!!int":
		var v int
		_ = node.Decode(&v)
		return v
	case "!!float":
		var v float64
		_ = node.Decode(&v)
		return v
	case "!!bool":
		var v bool
		_ = node.Decode(&v)
		return v
	default:
		return node.Value
	}
}

// Load reads a YAML config file.
func Load(path string) (*Config, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("读取配置文件失败: %w", err)
	}
	return ParseYAML(data)
}

// ParseYAML parses YAML (or JSON) config from bytes.
func ParseYAML(data []byte) (*Config, error) {
	cfg := &Config{}
	// KnownFields mirrors the Web UI's YAML editor: unknown top-level and
	// nested keys (e.g. a typo'd "limt:") are rejected instead of silently
	// dropped.
	dec := yaml.NewDecoder(bytes.NewReader(data))
	dec.KnownFields(true)
	if err := dec.Decode(cfg); err != nil && err != io.EOF {
		return nil, fmt.Errorf("解析YAML配置失败: %w", err)
	}

	if err := cfg.Validate(); err != nil {
		return nil, fmt.Errorf("配置验证失败: %w", err)
	}

	return cfg, nil
}
