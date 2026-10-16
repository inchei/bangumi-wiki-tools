package config

import (
	"fmt"
	"strconv"
	"strings"

	"github.com/inchei/bangumi-query/internal/model"
)

// countFilterTree recursively counts filter nodes and the maximum nesting depth.
// depth is the depth of the current node (top-level = 1).
func countFilterTree(filters []Filter, depth int) (count int, maxDepth int) {
	for _, f := range filters {
		count++
		if depth > maxDepth {
			maxDepth = depth
		}
		childDepth := depth + 1
		var nested [][]Filter
		switch {
		case f.Logic != nil:
			nested = append(nested, f.Logic.Items)
		case f.Relation != nil:
			nested = append(nested, f.Relation.Conditions)
		case f.PersonRelation != nil:
			nested = append(nested, f.PersonRelation.Conditions)
		case f.CharacterRelation != nil:
			nested = append(nested, f.CharacterRelation.Conditions)
		case f.Staff != nil:
			nested = append(nested, f.Staff.Conditions)
		case f.Character != nil:
			nested = append(nested, f.Character.Conditions)
		case f.PersonCharacter != nil:
			nested = append(nested, f.PersonCharacter.Conditions, f.PersonCharacter.SubjectConditions)
		case f.PersonCastSubject != nil:
			nested = append(nested, f.PersonCastSubject.Conditions, f.PersonCastSubject.CharacterConditions)
		case f.SubjectCast != nil:
			nested = append(nested, f.SubjectCast.PersonConditions, f.SubjectCast.CharacterConditions)
		case f.CharacterPerson != nil:
			nested = append(nested, f.CharacterPerson.Conditions, f.CharacterPerson.SubjectConditions)
		case f.Episode != nil:
			if f.Episode.Logic != nil {
				nested = append(nested, f.Episode.Logic.Items)
			}
		}
		for _, ns := range nested {
			c, m := countFilterTree(ns, childDepth)
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
	switch c.Target {
	case "", "subject", "person", "character", "episode":
	default:
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

	for i, f := range c.Filters {
		set := 0
		if f.Type != nil {
			set++
		}
		if f.Field != nil {
			set++
		}
		if f.Global != nil {
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
			return fmt.Errorf("筛选条件 %d: 至少需要指定一个过滤类型", i+1)
		}
		if set > 1 {
			return fmt.Errorf("筛选条件 %d: 每个条件只能指定一种过滤类型", i+1)
		}

		// Validate specific filter types.
		// Empty type/position values are legal wildcards (builder treats
		// "" / "任意" as "any"), matching how the Web UI emits unselected
		// filters; only malformed values are rejected here.
		switch {
		case f.Type != nil:
			if err := validateTypeValue(f.Type.Value); err != nil {
				return fmt.Errorf("筛选条件 %d: %w", i+1, err)
			}
		case f.Field != nil:
			if f.Field.Field == "" {
				return fmt.Errorf("筛选条件 %d: field 名称不能为空", i+1)
			}
			if err := validateOperator(f.Field.Operator); err != nil {
				return fmt.Errorf("筛选条件 %d: %w", i+1, err)
			}
		case f.Global != nil:
			if err := validateOperator(f.Global.Operator); err != nil {
				return fmt.Errorf("筛选条件 %d: %w", i+1, err)
			}
		case f.Tag != nil:
			if err := validateOperator(f.Tag.Operator); err != nil {
				return fmt.Errorf("筛选条件 %d: %w", i+1, err)
			}
		case f.MetaTag != nil:
			if err := validateOperator(f.MetaTag.Operator); err != nil {
				return fmt.Errorf("筛选条件 %d: %w", i+1, err)
			}
		case f.Relation != nil:
			if f.Relation.Mode == "" {
				f.Relation.Mode = "any"
			}
			if err := validateMode(f.Relation.Mode); err != nil {
				return fmt.Errorf("筛选条件 %d: %w", i+1, err)
			}
		case f.PersonRelation != nil:
			if f.PersonRelation.Mode == "" {
				f.PersonRelation.Mode = "any"
			}
			if err := validateMode(f.PersonRelation.Mode); err != nil {
				return fmt.Errorf("筛选条件 %d: %w", i+1, err)
			}
		case f.CharacterRelation != nil:
			if f.CharacterRelation.Mode == "" {
				f.CharacterRelation.Mode = "any"
			}
			if err := validateMode(f.CharacterRelation.Mode); err != nil {
				return fmt.Errorf("筛选条件 %d: %w", i+1, err)
			}
		case f.Staff != nil:
			if f.Staff.Mode == "" {
				f.Staff.Mode = "any"
			}
			if err := validateMode(f.Staff.Mode); err != nil {
				return fmt.Errorf("筛选条件 %d: %w", i+1, err)
			}
		case f.Character != nil:
			if f.Character.Mode == "" {
				f.Character.Mode = "any"
			}
			if err := validateMode(f.Character.Mode); err != nil {
				return fmt.Errorf("筛选条件 %d: %w", i+1, err)
			}
		case f.PersonCharacter != nil:
			if f.PersonCharacter.Mode == "" {
				f.PersonCharacter.Mode = "any"
			}
			if err := validateMode(f.PersonCharacter.Mode); err != nil {
				return fmt.Errorf("筛选条件 %d: %w", i+1, err)
			}
		case f.PersonCastSubject != nil:
			if f.PersonCastSubject.Mode == "" {
				f.PersonCastSubject.Mode = "any"
			}
			if err := validateMode(f.PersonCastSubject.Mode); err != nil {
				return fmt.Errorf("筛选条件 %d: %w", i+1, err)
			}
			if f.PersonCastSubject.CharacterMode != "" {
				if err := validateMode(f.PersonCastSubject.CharacterMode); err != nil {
					return fmt.Errorf("筛选条件 %d: %w", i+1, err)
				}
			}
		case f.SubjectCast != nil:
			if f.SubjectCast.Mode == "" {
				f.SubjectCast.Mode = "any"
			}
			if err := validateMode(f.SubjectCast.Mode); err != nil {
				return fmt.Errorf("筛选条件 %d: %w", i+1, err)
			}
		case f.CharacterPerson != nil:
			if f.CharacterPerson.Mode == "" {
				f.CharacterPerson.Mode = "any"
			}
			if err := validateMode(f.CharacterPerson.Mode); err != nil {
				return fmt.Errorf("筛选条件 %d: %w", i+1, err)
			}
		case f.Episode != nil:
			// Episode data is joined via episodes.subject_id, which only the
			// subject target exposes (the builder references s.id directly), so
			// reject the combination up front instead of failing in DuckDB.
			if c.Target != "" && c.Target != "subject" {
				return fmt.Errorf("筛选条件 %d: episode 筛选仅支持 target: subject", i+1)
			}
			if f.Episode.Mode == "" {
				f.Episode.Mode = "any"
			}
			if err := validateMode(f.Episode.Mode); err != nil {
				return fmt.Errorf("筛选条件 %d: %w", i+1, err)
			}
			// Episode filters implement any/all/count only; none would silently
			// fall through to any in the builder.
			if f.Episode.Mode == "none" {
				return fmt.Errorf("筛选条件 %d: episode 筛选不支持 mode: none", i+1)
			}
			// Without a condition tree the builder cannot tell which episodes to
			// match (a missing logic previously matched every subject).
			if f.Episode.Logic == nil || len(f.Episode.Logic.Items) == 0 {
				return fmt.Errorf("筛选条件 %d: episode 筛选需要提供 logic 条件", i+1)
			}
		case f.Logic != nil:
			if f.Logic.Op != "and" && f.Logic.Op != "or" {
				return fmt.Errorf("筛选条件 %d: logic op 必须为 and 或 or", i+1)
			}
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

// validateMode checks a quantifier mode against the set the builder
// understands (unknown modes currently fall back to "any" silently, which
// hides typos).
func validateMode(mode string) error {
	switch mode {
	case "any", "all", "none", "count":
		return nil
	}
	return fmt.Errorf("mode「%s」不存在", mode)
}

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
