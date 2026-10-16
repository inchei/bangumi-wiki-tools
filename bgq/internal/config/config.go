package config

const (
	// maxFilterCount caps the total number of filter nodes in a query to bound
	// SQL generation and execution cost.
	maxFilterCount = 500
	// maxFilterDepth caps filter nesting depth to prevent pathological recursion.
	maxFilterDepth = 10
)

// Config is the top-level YAML configuration.
type Config struct {
	Database string     `yaml:"database,omitempty" json:"database,omitempty"`
	DataDir  string     `yaml:"data_dir,omitempty" json:"data_dir,omitempty"`
	Target   string     `yaml:"target,omitempty" json:"target,omitempty"` // subject (default), person, character, episode
	Filters  []Filter   `yaml:"filters,omitempty" json:"filters,omitempty"`
	Output   *Output    `yaml:"output,omitempty" json:"output,omitempty"`
	Sort     []SortRule `yaml:"sort,omitempty" json:"sort,omitempty"`
	Limit    int        `yaml:"limit,omitempty" json:"limit,omitempty"`
}

// Filter is a single filter condition. Exactly one of the pointer fields should be set.
type Filter struct {
	Type              *TypeFilter              `yaml:"type,omitempty" json:"type,omitempty"`
	Field             *FieldFilter             `yaml:"field,omitempty" json:"field,omitempty"`
	Global            *GlobalFilter            `yaml:"global,omitempty" json:"global,omitempty"`
	Tag               *TagFilter               `yaml:"tag,omitempty" json:"tag,omitempty"`
	MetaTag           *TagFilter               `yaml:"meta_tag,omitempty" json:"meta_tag,omitempty"`
	Relation          *RelationFilter          `yaml:"relation,omitempty" json:"relation,omitempty"`
	PersonRelation    *PersonRelationFilter    `yaml:"person_relation,omitempty" json:"person_relation,omitempty"`
	CharacterRelation *CharacterRelationFilter `yaml:"character_relation,omitempty" json:"character_relation,omitempty"`
	Staff             *StaffFilter             `yaml:"staff,omitempty" json:"staff,omitempty"`
	Character         *CharacterFilter         `yaml:"character,omitempty" json:"character,omitempty"`
	PersonCharacter   *PersonCharacterFilter   `yaml:"person_character,omitempty" json:"person_character,omitempty"`
	PersonCastSubject *PersonCastSubjectFilter `yaml:"person_cast_subject,omitempty" json:"person_cast_subject,omitempty"`
	CharacterPerson   *CharacterPersonFilter   `yaml:"character_person,omitempty" json:"character_person,omitempty"`
	SubjectCast       *SubjectCastFilter       `yaml:"subject_cast,omitempty" json:"subject_cast,omitempty"`
	Episode           *EpisodeFilter           `yaml:"episode,omitempty" json:"episode,omitempty"`
	Logic             *LogicFilter             `yaml:"logic,omitempty" json:"logic,omitempty"`
}

// LogicFilter combines child filters with AND or OR logic.
type LogicFilter struct {
	Op    string   `yaml:"op" json:"op"`       // "and" or "or"
	Items []Filter `yaml:"items" json:"items"` // child filters
}

// TypeFilter filters by subject type.
type TypeFilter struct {
	Value interface{} `yaml:"value" json:"value"` // int or string (Chinese name)
}

// FieldFilter filters a specific field (JSON field or infobox field).
type FieldFilter struct {
	Field    string      `yaml:"field" json:"field"`
	Operator string      `yaml:"operator" json:"operator"` // eq, contains, regex, gt, gte, lt, lte, before, after
	Value    interface{} `yaml:"value" json:"value"`
}

// GlobalFilter searches across all fields (including infobox).
type GlobalFilter struct {
	Operator string      `yaml:"operator" json:"operator"`
	Value    interface{} `yaml:"value" json:"value"`
}

// TagFilter filters by tag name.
type TagFilter struct {
	Operator string `yaml:"operator" json:"operator"` // contains, eq
	Value    string `yaml:"value" json:"value"`
	Negate   bool   `yaml:"negate" json:"negate"`
}

// RelationFilter filters by subject relation.
// Conditions support all filter types (nested), allowing full filtering on related subjects.
type RelationFilter struct {
	Type       string      `yaml:"type" json:"type"`                               // Chinese relation name (e.g., "单行本")
	Mode       string      `yaml:"mode" json:"mode"`                               // any, all, none, count
	CountOp    string      `yaml:"count_op,omitempty" json:"count_op,omitempty"`   // count mode operator: gt, gte, lt, lte, eq
	CountVal   interface{} `yaml:"count_val,omitempty" json:"count_val,omitempty"` // count mode threshold
	Conditions []Filter    `yaml:"conditions" json:"conditions"`                   // conditions on the related subject (full filter types)
}

// PersonRelationFilter filters by person-to-person relation (person_type=prsn).
// Conditions support person-level filter types on the related person.
type PersonRelationFilter struct {
	Type       string      `yaml:"type" json:"type"`                               // Chinese relation name (e.g., "同事")
	Mode       string      `yaml:"mode" json:"mode"`                               // any, all, none, count
	CountOp    string      `yaml:"count_op,omitempty" json:"count_op,omitempty"`   // count mode operator
	CountVal   interface{} `yaml:"count_val,omitempty" json:"count_val,omitempty"` // count mode threshold
	Conditions []Filter    `yaml:"conditions" json:"conditions"`                   // conditions on the related person
}

// CharacterRelationFilter filters by character-to-character relation (person_type=crt).
// Conditions support character-level filter types on the related character.
type CharacterRelationFilter struct {
	Type       string      `yaml:"type" json:"type"`                               // Chinese relation name (e.g., "朋友")
	Mode       string      `yaml:"mode" json:"mode"`                               // any, all, none, count
	CountOp    string      `yaml:"count_op,omitempty" json:"count_op,omitempty"`   // count mode operator
	CountVal   interface{} `yaml:"count_val,omitempty" json:"count_val,omitempty"` // count mode threshold
	Conditions []Filter    `yaml:"conditions" json:"conditions"`                   // conditions on the related character
}

// StaffFilter filters by staff/person.
// Conditions support all filter types (nested), allowing full filtering on persons (subject target) or subjects (person target).
// Use field=appear_eps inside conditions to filter on the junction table's appear_eps column.
// When Positions has multiple values, checks that the same person holds all positions
// (self-join on subject_persons matching person_id across position groups).
type StaffFilter struct {
	Position   string      `yaml:"position,omitempty" json:"position,omitempty"`   // single Chinese position name (e.g., "原作")
	Positions  []string    `yaml:"positions,omitempty" json:"positions,omitempty"` // multiple positions for same-person check
	Mode       string      `yaml:"mode" json:"mode"`                               // any, all, none, count
	CountOp    string      `yaml:"count_op,omitempty" json:"count_op,omitempty"`   // count mode operator
	CountVal   interface{} `yaml:"count_val,omitempty" json:"count_val,omitempty"` // count mode threshold
	Conditions []Filter    `yaml:"conditions" json:"conditions"`                   // conditions on person (subject target) or subject (person target)
}

// CharacterFilter filters by character in a subject.
// Conditions support character-level filter types on the associated character.
type CharacterFilter struct {
	Type       string      `yaml:"type,omitempty" json:"type,omitempty"`           // association type name (e.g., "主角")
	Mode       string      `yaml:"mode" json:"mode"`                               // any, all, none, count
	CountOp    string      `yaml:"count_op,omitempty" json:"count_op,omitempty"`   // count mode operator
	CountVal   interface{} `yaml:"count_val,omitempty" json:"count_val,omitempty"` // count mode threshold
	Conditions []Filter    `yaml:"conditions" json:"conditions"`                   // conditions on the character
}

// PersonCharacterFilter filters persons by their associated characters (via person_characters).
// Supports filtering by character conditions AND related subject conditions.
type PersonCharacterFilter struct {
	Type              string      `yaml:"type,omitempty" json:"type,omitempty"`                             // CV type name (e.g., "CV", "演员")
	Mode              string      `yaml:"mode" json:"mode"`                                                 // any, all, none, count — character-level quantifier
	CountOp           string      `yaml:"count_op,omitempty" json:"count_op,omitempty"`                     // count mode operator
	CountVal          interface{} `yaml:"count_val,omitempty" json:"count_val,omitempty"`                   // count mode threshold
	SubjectMode       string      `yaml:"subject_mode,omitempty" json:"subject_mode,omitempty"`             // any, all, count — subject-level quantifier per character
	SubjectCountOp    string      `yaml:"subject_count_op,omitempty" json:"subject_count_op,omitempty"`     // subject count mode operator
	SubjectCountVal   interface{} `yaml:"subject_count_val,omitempty" json:"subject_count_val,omitempty"`   // subject count mode threshold
	Conditions        []Filter    `yaml:"conditions" json:"conditions"`                                     // conditions on the character
	SubjectConditions []Filter    `yaml:"subject_conditions,omitempty" json:"subject_conditions,omitempty"` // conditions on the related subject
}

// CharacterPersonFilter filters characters by their associated persons (via person_characters).
// Supports filtering by person conditions AND related subject conditions.
type CharacterPersonFilter struct {
	Type              string      `yaml:"type,omitempty" json:"type,omitempty"`                             // CV type name (e.g., "CV", "演员")
	Mode              string      `yaml:"mode" json:"mode"`                                                 // any, all, none, count — person-level quantifier
	CountOp           string      `yaml:"count_op,omitempty" json:"count_op,omitempty"`                     // count mode operator
	CountVal          interface{} `yaml:"count_val,omitempty" json:"count_val,omitempty"`                   // count mode threshold
	SubjectMode       string      `yaml:"subject_mode,omitempty" json:"subject_mode,omitempty"`             // any, all, count — subject-level quantifier per person
	SubjectCountOp    string      `yaml:"subject_count_op,omitempty" json:"subject_count_op,omitempty"`     // subject count mode operator
	SubjectCountVal   interface{} `yaml:"subject_count_val,omitempty" json:"subject_count_val,omitempty"`   // subject count mode threshold
	Conditions        []Filter    `yaml:"conditions" json:"conditions"`                                     // conditions on the person
	SubjectConditions []Filter    `yaml:"subject_conditions,omitempty" json:"subject_conditions,omitempty"` // conditions on the related subject
}

// PersonCastSubjectFilter filters persons by their cast subjects (via person_characters),
// subject-centered: subjects are the counted entity, characters are per-subject secondary.
type PersonCastSubjectFilter struct {
	Type                string      `yaml:"type,omitempty" json:"type,omitempty"`                                 // CV type name (e.g., "CV", "演员")
	Mode                string      `yaml:"mode" json:"mode"`                                                     // any, all, none, count — subject-level quantifier
	CountOp             string      `yaml:"count_op,omitempty" json:"count_op,omitempty"`                         // count mode operator
	CountVal            interface{} `yaml:"count_val,omitempty" json:"count_val,omitempty"`                       // count mode threshold
	CharacterMode       string      `yaml:"character_mode,omitempty" json:"character_mode,omitempty"`             // any, all, count — per-subject character quantifier
	CharacterCountOp    string      `yaml:"character_count_op,omitempty" json:"character_count_op,omitempty"`     // per-subject character count mode operator
	CharacterCountVal   interface{} `yaml:"character_count_val,omitempty" json:"character_count_val,omitempty"`   // per-subject character count mode threshold
	Conditions          []Filter    `yaml:"conditions" json:"conditions"`                                         // conditions on the subject (rs)
	CharacterConditions []Filter    `yaml:"character_conditions,omitempty" json:"character_conditions,omitempty"` // conditions on the character (c)
}

// SubjectCastFilter filters subjects by their cast (via subject_characters + person_characters).
// Reuses CV prefix semantics; type is character association type (主角/配角...).
type SubjectCastFilter struct {
	Type                string      `yaml:"type,omitempty" json:"type,omitempty"` // 角色关联类型 (主角/配角/客串...)
	Mode                string      `yaml:"mode" json:"mode"`                     // any, all, none, count — distinct persons
	CountOp             string      `yaml:"count_op,omitempty" json:"count_op,omitempty"`
	CountVal            interface{} `yaml:"count_val,omitempty" json:"count_val,omitempty"`
	PersonConditions    []Filter    `yaml:"person_conditions,omitempty" json:"person_conditions,omitempty"`       // on persons p
	CharacterConditions []Filter    `yaml:"character_conditions,omitempty" json:"character_conditions,omitempty"` // on characters c
}

// EpisodeFilter filters by episode.
type EpisodeFilter struct {
	Mode     string       `yaml:"mode" json:"mode"`                             // any, all, none, count
	CountOp  string       `yaml:"count_op,omitempty" json:"count_op,omitempty"` // count mode operator
	CountVal interface{}  `yaml:"count_val,omitempty" json:"count_val,omitempty"`
	Logic    *LogicFilter `yaml:"logic,omitempty" json:"logic,omitempty"` // episode condition tree
}

// Output configures the query output.
type Output struct {
	Format     string   `yaml:"format,omitempty" json:"format,omitempty"`           // csv, json, table
	Path       string   `yaml:"path,omitempty" json:"path,omitempty"`               // output file path (empty = stdout)
	Columns    []string `yaml:"columns,omitempty" json:"columns,omitempty"`         // columns to include
	AssocLimit int      `yaml:"assoc_limit,omitempty" json:"assoc_limit,omitempty"` // max items for association columns (0 = default 1)
}

// SortRule defines a sort order.
type SortRule struct {
	Field     string `yaml:"field" json:"field"`
	Direction string `yaml:"direction" json:"direction"` // asc, desc
}
