package config

import (
	"fmt"
	"strconv"
	"strings"

	"github.com/inchei/bangumi-query/internal/model"
)

// childLists enumerates the nested condition lists of a filter node.
func childLists(f *Filter) [][]Filter {
	var lists [][]Filter
	switch {
	case f.Logic != nil:
		lists = append(lists, f.Logic.Items)
	case f.Relation != nil:
		lists = append(lists, f.Relation.Conditions)
	case f.PersonRelation != nil:
		lists = append(lists, f.PersonRelation.Conditions)
	case f.CharacterRelation != nil:
		lists = append(lists, f.CharacterRelation.Conditions)
	case f.Staff != nil:
		lists = append(lists, f.Staff.Conditions)
	case f.Character != nil:
		lists = append(lists, f.Character.Conditions)
	case f.PersonCharacter != nil:
		lists = append(lists, f.PersonCharacter.Conditions, f.PersonCharacter.SubjectConditions)
	case f.PersonCastSubject != nil:
		lists = append(lists, f.PersonCastSubject.Conditions, f.PersonCastSubject.CharacterConditions)
	case f.SubjectCast != nil:
		lists = append(lists, f.SubjectCast.PersonConditions, f.SubjectCast.CharacterConditions)
	case f.CharacterPerson != nil:
		lists = append(lists, f.CharacterPerson.Conditions, f.CharacterPerson.SubjectConditions)
	case f.Episode != nil:
		if f.Episode.Logic != nil {
			lists = append(lists, f.Episode.Logic.Items)
		}
	}
	return lists
}

// countFilterTree recursively counts filter nodes and the maximum nesting depth.
// depth is the depth of the current node (top-level = 1).
func countFilterTree(filters []Filter, depth int) (count int, maxDepth int) {
	for i := range filters {
		f := &filters[i]
		count++
		if depth > maxDepth {
			maxDepth = depth
		}
		for _, ns := range childLists(f) {
			c, m := countFilterTree(ns, depth+1)
			count += c
			if m > maxDepth {
				maxDepth = m
			}
		}
	}
	return count, maxDepth
}

// Validate checks the configuration for errors.
func (c *Config) Validate() error {
	// Mirror the Web UI's YAML editor: unknown targets are rejected instead
	// of silently falling back to "subject".
	if c.Target != "" && !validTargets[c.Target] {
		return fmt.Errorf("target「%s」不存在", c.Target)
	}

	// data_dir/database will be provided via CLI if not in config
	if len(c.Filters) == 0 && len(c.Sort) == 0 {
		return fmt.Errorf("至少需要一个筛选条件 (filters) 或排序条件 (sort)")
	}

	// Bound filter tree size to prevent pathological query generation.
	count, maxDepth := countFilterTree(c.Filters, 1)
	if count > maxFilterCount {
		return fmt.Errorf("筛选条件总数 %d 超过上限 %d", count, maxFilterCount)
	}
	if maxDepth > maxFilterDepth {
		return fmt.Errorf("筛选嵌套深度 %d 超过上限 %d", maxDepth, maxFilterDepth)
	}

	for i := range c.Filters {
		if err := validateFilter(&c.Filters[i], c.Target); err != nil {
			return err
		}
	}

	if c.Output == nil {
		c.Output = &Output{}
	}
	if c.Output.Format == "" {
		c.Output.Format = "table"
	}
	if c.Output.AssocLimit <= 0 {
		c.Output.AssocLimit = 1
	}
	if c.Limit <= 0 {
		c.Limit = 1000
	}

	// Group JSON columns ({f1|f2|...}) are display-only — not sortable.
	for _, s := range c.Sort {
		if strings.Contains(s.Field, "{") {
			return fmt.Errorf("排序字段 %s 不能包含 {}（群组列不可排序，请用例如 %s）", s.Field, sortGroupHint(s.Field))
		}
	}

	return nil
}

// validateFilter validates one filter node and recurses into its nested
// condition lists so tree levels share the same rules as the top level.
func validateFilter(f *Filter, target string) error {
	set := 0
	if f.Type != nil {
		set++
	}
	if f.Field != nil {
		set++
	}
	if f.Tag != nil {
		set++
	}
	if f.MetaTag != nil {
		set++
	}
	if f.Relation != nil {
		set++
	}
	if f.PersonRelation != nil {
		set++
	}
	if f.CharacterRelation != nil {
		set++
	}
	if f.Staff != nil {
		set++
	}
	if f.Character != nil {
		set++
	}
	if f.PersonCharacter != nil {
		set++
	}
	if f.PersonCastSubject != nil {
		set++
	}
	if f.CharacterPerson != nil {
		set++
	}
	if f.SubjectCast != nil {
		set++
	}
	if f.Episode != nil {
		set++
	}
	if f.Logic != nil {
		set++
	}
	if set == 0 {
		return fmt.Errorf("至少需要指定一个过滤类型")
	}
	if set > 1 {
		return fmt.Errorf("每个条件只能指定一种过滤类型")
	}

	// Validate specific filter types.
	// Empty type/position values are legal wildcards (builder treats
	// "" / "任意" as "any"), matching how the Web UI emits unselected
	// filters; only malformed values are rejected here.
	switch {
	case f.Type != nil:
		if err := validateTypeValue(f.Type.Value); err != nil {
			return err
		}
	case f.Field != nil:
		if f.Field.Field == "" {
			return fmt.Errorf("field 名称不能为空")
		}
		if err := validateOperator(f.Field.Operator); err != nil {
			return err
		}
	case f.Tag != nil:
		if err := validateOperator(f.Tag.Operator); err != nil {
			return err
		}
	case f.MetaTag != nil:
		if err := validateOperator(f.MetaTag.Operator); err != nil {
			return err
		}
	case f.Relation != nil:
		if f.Relation.Mode == "" {
			f.Relation.Mode = "any"
		}
		if err := validateMode(f.Relation.Mode); err != nil {
			return err
		}
	case f.PersonRelation != nil:
		if f.PersonRelation.Mode == "" {
			f.PersonRelation.Mode = "any"
		}
		if err := validateMode(f.PersonRelation.Mode); err != nil {
			return err
		}
	case f.CharacterRelation != nil:
		if f.CharacterRelation.Mode == "" {
			f.CharacterRelation.Mode = "any"
		}
		if err := validateMode(f.CharacterRelation.Mode); err != nil {
			return err
		}
	case f.Staff != nil:
		if f.Staff.HasMultiPositionAppearEps() {
			return fmt.Errorf("多职位 staff 条件不支持 appear_eps（该字段属于单个职位）")
		}
		if f.Staff.Mode == "" {
			f.Staff.Mode = "any"
		}
		if err := validateMode(f.Staff.Mode); err != nil {
			return err
		}
	case f.Character != nil:
		if f.Character.Mode == "" {
			f.Character.Mode = "any"
		}
		if err := validateMode(f.Character.Mode); err != nil {
			return err
		}
	case f.PersonCharacter != nil:
		if f.PersonCharacter.Mode == "" {
			f.PersonCharacter.Mode = "any"
		}
		if err := validateMode(f.PersonCharacter.Mode); err != nil {
			return err
		}
	case f.PersonCastSubject != nil:
		if f.PersonCastSubject.Mode == "" {
			f.PersonCastSubject.Mode = "any"
		}
		if err := validateMode(f.PersonCastSubject.Mode); err != nil {
			return err
		}
		if f.PersonCastSubject.CharacterMode != "" {
			if err := validateMode(f.PersonCastSubject.CharacterMode); err != nil {
				return err
			}
		}
	case f.SubjectCast != nil:
		if f.SubjectCast.Mode == "" {
			f.SubjectCast.Mode = "any"
		}
		if err := validateMode(f.SubjectCast.Mode); err != nil {
			return err
		}
	case f.CharacterPerson != nil:
		if f.CharacterPerson.Mode == "" {
			f.CharacterPerson.Mode = "any"
		}
		if err := validateMode(f.CharacterPerson.Mode); err != nil {
			return err
		}
	case f.Episode != nil:
		// Episode data is joined via episodes.subject_id, which only the
		// subject target exposes (the builder references s.id directly), so
		// reject the combination up front instead of failing in DuckDB.
		if target != "" && target != "subject" {
			return fmt.Errorf("episode 筛选仅支持 target: subject")
		}
		if f.Episode.Mode == "" {
			f.Episode.Mode = "any"
		}
		if err := validateMode(f.Episode.Mode); err != nil {
			return err
		}
		if f.Episode.Mode != "count" &&
			(f.Episode.Logic == nil || len(f.Episode.Logic.Items) == 0) {
			return fmt.Errorf("episode 筛选需要提供 logic 条件")
		}
	case f.Logic != nil:
		if f.Logic.Op != "and" && f.Logic.Op != "or" {
			return fmt.Errorf("logic op 必须为 and 或 or")
		}
	}

	for _, ns := range childLists(f) {
		for j := range ns {
			if err := validateFilter(&ns[j], target); err != nil {
				return err
			}
		}
	}
	return nil
}

// validateMode checks a quantifier mode against the set the builder
// understands (unknown modes currently fall back to "any" silently, which
// hides typos).
func validateMode(mode string) error {
	if !validModes[mode] {
		return fmt.Errorf("mode「%s」不存在", mode)
	}
	return nil
}

// validTargets, validModes, and validOperators are the exact sets YAML
// validation accepts. The Web UI re-implements them in
// frontend/src/yaml.js (TARGETS/MODES/OPERATORS) — the parity test
// TestFrontendValidationParity fails when the two sides drift apart.
var (
	validTargets = map[string]bool{
		"subject":   true,
		"person":    true,
		"character": true,
		"episode":   true,
	}
	validModes = map[string]bool{
		"any":   true,
		"all":   true,
		"none":  true,
		"count": true,
	}
)

var validOperators = map[string]bool{
	"eq":           true,
	"contains":     true,
	"not_contains": true,
	"regex":        true,
	"not_regex":    true,
	"empty":        true,
	"gt":           true,
	"gte":          true,
	"lt":           true,
	"lte":          true,
	"before":       true,
	"after":        true,
}

func validateOperator(op string) error {
	if op == "" {
		return fmt.Errorf("operator 不能为空")
	}
	if !validOperators[op] {
		return fmt.Errorf("operator「%s」不存在", op)
	}
	return nil
}

// validateTypeValue mirrors the builder's type filter coercion (int, numeric
// string, or Chinese name) and rejects values it would fail on.
func validateTypeValue(v interface{}) error {
	switch t := v.(type) {
	case nil:
		return fmt.Errorf("type value 不能为空")
	case int:
		if _, ok := model.TypeNumToCN[t]; !ok {
			return fmt.Errorf("未知的条目类型: %d", t)
		}
	case float64:
		if _, ok := model.TypeNumToCN[int(t)]; !ok {
			return fmt.Errorf("未知的条目类型: %v", t)
		}
	case string:
		if t == "" {
			return nil
		}
		if num, err := strconv.Atoi(t); err == nil {
			if _, ok := model.TypeNumToCN[num]; !ok {
				return fmt.Errorf("未知的条目类型: %s", t)
			}
			return nil
		}
		if _, ok := model.TypeCNToNum[t]; !ok {
			return fmt.Errorf("未知的条目类型: %s", t)
		}
	default:
		return fmt.Errorf("type filter value must be int or string, got %T", v)
	}
	return nil
}

// sortGroupHint suggests a sortable single-field alternative for a group sort
// field (e.g. 导演.{name|生日|id} → 导演.生日).
func sortGroupHint(field string) string {
	idx := strings.Index(field, ".{")
	if idx < 0 {
		return "导演.生日"
	}
	prefix := field[:idx]
	inner := field[idx+2:]
	if end := strings.Index(inner, "}"); end >= 0 {
		first := strings.Split(inner[:end], "|")[0]
		return prefix + "." + strings.TrimSpace(first)
	}
	return prefix + ".字段"
}
