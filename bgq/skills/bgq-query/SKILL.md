---
name: bgq-query
description: >
  Query Bangumi (bgm.tv) subject/person/character/episode data using bgq CLI or API.
  Translate natural language into YAML filter configs, execute queries, export CSV/JSON
  for further analysis.
tags: [bangumi, anime, manga, query, duckdb, data-analysis]
---

# bgq-query — Bangumi Query Skill

Use `bgq` to query Bangumi Archive data (subjects, persons, characters, episodes) via DuckDB.
Supports CLI YAML config and HTTP API.

## Prerequisites

- `bgq` binary at `bgq/bin/bgq` (or in PATH)
- `duckdb` CLI at `bgq/bin/duckdb` (or in PATH)
- Data directory with Bangumi Archive JSONLines (default: `bgq/bangumi_archive/`)
- Or a pre-built DuckDB database (via `bgq ingest`)

## Query Targets

| Target | Description | Key Direct Fields |
|--------|-------------|-------------------|
| `subject` | 条目 (anime/manga/game/music/drama) | see `SUBJECT_DIRECT_FIELDS` in stores.js |
| `person` | 人物 | see `PERSON_FIELDS` in stores.js |
| `character` | 角色 | see `CHARACTER_FIELDS` in stores.js |
| `episode` | 剧集 | see `EPISODE_FIELDS` in stores.js |

**Infobox fields** (not direct columns — extracted via `regexp_extract(infobox, ...)`):
Chinese field names like 出版社, 作者, 生日, 性别, 别名, 简体中文名 are infobox fields.
Available per-type infobox names are generated into `bgq/frontend/src/infobox-fields.js`
(`INFOBOX_FIELDS_BY_TYPE` by subject type code, `INFOBOX_FIELDS_PERSON`/`INFOBOX_FIELDS_CHARACTER`
from the shared `Crt` template) — from `bangumi/common/wiki_template.yml`.
Check `SUBJECT_FIELD_CONFIGS`, `PERSON_FIELD_CONFIGS`, `CHARACTER_FIELD_CONFIGS` in stores.js for specialized operators.

## YAML Config Format

```yaml
target: subject          # subject (default) | person | character | episode
data_dir: ./bangumi_archive  # or database: ./bangumi.db
limit: 500
sort:
  - { field: score, direction: desc }
output:
  columns: [id, name, name_cn, score, rank]
  format: csv            # table | csv | json
  path: results.csv
filters:
  - type: 书籍            # 书籍|动画|音乐|游戏|三次元 (auto-converted to numeric)
  - field: { field: score, operator: gte, value: "8.0" }
  - tag: { value: "轻小说", operator: contains }
  - meta_tag: { value: "已完结", operator: contains }
  - staff: { position: 作者, mode: any }
  - relation: { type: 单行本, mode: any }
  - episode: { mode: any }
  - logic:
      op: or
      items:
        - field: { field: name, operator: contains, value: "进击" }
        - field: { field: name_cn, operator: contains, value: "进击" }
```

## Filter Operators

| Operator | Meaning | Example |
|----------|---------|---------|
| `contains` | contains (default) | `value: "角川"` |
| `not_contains` | not contains | `value: "绝版"` |
| `eq` | equals | `value: "2"` |
| `gt` / `gte` | greater than / >= | `value: "8.0"` |
| `lt` / `lte` | less than / <= | `value: "2020-01-01"` |
| `before` / `after` | date before/after | `value: "2020-01-01"` |
| `regex` | regex match (DuckDB syntax) | `value: "^\\\\s*$"` |
| `empty` | is null/empty | (no value needed) |

## Output Columns

Empty `output.columns` uses per-target defaults; explicit list fully overrides.

**Direct / infobox fields**: same names as `field` filters (`id`, `score`, `发售日`, `出版社`, …). `infobox` itself is not recommended.

**Association output** (`前缀.字段`):

| Syntax | Meaning | Targets |
|--------|---------|---------|
| `前缀.字段` | association field (comma-joined, limit via `assoc_limit`) | see below |
| `前缀.count` | count | same |
| `前缀.{f1\|f2\|...}` | JSON array of objects | same |
| `前缀.s.字段` / `前缀.s.{...}` | subject-level field (only `person_character`/`character_person`) | `person`/`character` |

Prefix depends on `target`:

| target | prefixes |
|--------|----------|
| `subject` | relation types (`单行本`…), positions (`导演`…), character types (`主角`…), `episode` |
| `person` | positions (→ subject fields), person relations, cast types (`CV` with `CV.s.` for subject) |
| `character` | character relations, cast types (`CV.s.` for subject) |
| `episode` | direct fields only (`subject_id` etc.) |

Examples:

```yaml
output: { columns: [id, name, 导演.name, 导演.生日] }
output: { columns: [id, name, 单行本.发售日] }
output: { columns: [id, name, 导演.{name|生日|id}] }
output: { columns: [person_id, name, CV.{id|name|s.id|s.name}] }
output: { columns: [id, name, 单行本.count] }
```

Sort supports association fields (dates/numbers normalized); `{...}` group columns are not sortable.

## CLI Usage

```bash
./bin/bgq query --config query.yaml                      # basic
./bin/bgq query --config query.yaml --format csv -o out.csv --verbose  # with SQL output
```

## API Usage (when server is running)

```bash
curl -X POST http://localhost:8080/api/query \
  -H "Content-Type: application/json" \
  -d '{"target":"subject","filters":[{"type":{"value":"动画"}},{"field":{"field":"score","operator":"gte","value":"8.0"}}],"columns":["id","name","score"],"limit":100}'
```

## Natural Language → Query Workflow

1. **Parse intent** — identify target, conditions, sort, columns
2. **Look up valid values** — read `bgq/frontend/src/schema-data.js` for platform codes, relation types, positions, meta tags
3. **Generate YAML** — write to a temp file
4. **Execute** — `bgq query --config <yaml> --format csv --output <file>`
5. **Return results** — show summary, provide CSV path, or pipe into further analysis

### Example Translations

**"找评分8分以上的动画"**
```yaml
target: subject
filters:
  - type: 动画
  - field: { field: score, operator: gte, value: "8.0" }
sort: [{ field: score, direction: desc }]
output: { columns: [id, name, name_cn, score, rank] }
```

**"找连载结束但没标完结的书"**
```yaml
target: subject
filters:
  - type: 书籍
  - field: { field: 连载结束, operator: regex, value: "\\d" }
  - meta_tag: { value: "已完结", operator: contains, negate: true }
```

**"找花泽香菜配音的角色"**
```yaml
target: character
filters:
  - person_character:
      type: CV
      mode: any
      conditions:
        - field: { field: name, operator: contains, value: "花泽香菜" }
```

## Cross-Entity Queries

### Key pattern: conditions go INSIDE staff/relation, NOT at top level

Subject fields (score, rank, date) in staff conditions must be nested:

```yaml
# CORRECT
target: person
filters:
  - staff:
      position: 导演
      mode: any
      conditions:
        - field: { field: score, operator: gte, value: "8.0" }

# WRONG — score is not a person field, DuckDB error
target: person
filters:
  - staff: { position: 导演, mode: any }
  - field: { field: score, operator: gte, value: "8.0" }
```

### Reverse query: find subjects by person_id

```yaml
# Find anime directed by person_id 31113
target: subject
filters:
  - staff:
      position: 导演
      mode: any
      conditions:
        - field: { field: person_id, operator: eq, value: "31113" }
```

Batch with OR:
```yaml
      conditions:
        - logic: { op: or, items:
            - field: { field: person_id, operator: eq, value: "31113" }
            - field: { field: person_id, operator: eq, value: "28355" } }
```

### Three-way joins (person_character)

```yaml
target: person
filters:
  - person_character:
      type: CV
      mode: any
      subject_mode: any
      conditions:
        - field: { field: name, operator: contains, value: "绫波丽" }
      subject_conditions:
        - field: { field: score, operator: gte, value: "8.0" }
```

## Count Mode (no sorting)

`mode: count` filters by related entity count but cannot sort by it.
Use threshold stepping to rank:

```yaml
# Find authors with ≥50 manga
target: person
filters:
  - staff:
      position: 作者
      mode: count
      count_op: gte
      count_val: 50
      conditions:
        - field: { field: platform, operator: eq, value: "1001" }
```

To rank: query thresholds 200→100→80→60→50→40→30→20, collect new names at each step.

## Schema Reference

All valid values are in `bgq/frontend/src/schema-data.js`:
- **Platform codes** (numeric!): `BOOK_PLATFORMS`, `ANIME_PLATFORMS`, `GAME_PLATFORMS`, `REAL_PLATFORMS`
- **Relation types**: `ANIME_RELATIONS`, `BOOK_RELATIONS`, `GAME_RELATIONS`, `MUSIC_RELATIONS`
- **Staff positions**: `ANIME_POSITIONS`, `BOOK_POSITIONS`, `GAME_POSITIONS`, `REAL_POSITIONS`
- **Meta tags**: `META_TAGS_TYPE_1` (书籍), `META_TAGS_TYPE_2` (动画), `META_TAGS_TYPE_3` (音乐)
- **Person/character relations**: `PERSON_RELATIONS`, `CHARACTER_RELATIONS`, `CHARACTER_ASSOC_TYPES`, `PERSON_CHAR_TYPES`
- **Infobox field names**: `INFOBOX_FIELDS_BY_TYPE` (subject type → fields), `INFOBOX_FIELDS_PERSON`/`INFOBOX_FIELDS_CHARACTER`, `INFOBOX_FIELDS_ALL`

Go source: `bgq/internal/model/` (relation_data.go, staff_data.go, metatags.go)

Domain classification notes (特摄 vs 动画, position names by type): `references/domain-classification.md`

## Pitfalls

| Pitfall | Detail |
|---------|--------|
| **platform is numeric** | 漫画=`1001`, 小说=`1002`, TV=`1`, OVA=`2`, 剧场版=`3`, WEB=`5`, 游戏=`4001`. NOT `"漫画"` |
| **type auto-converts** | `type: 书籍` → `1` automatically. But `platform` does NOT — must use numeric code |
| **改编 relations are bidirectional** | A→B and B→A both stored. Use `mode: none, conditions: [{type: 动画}]` to exclude anime adaptations |
| **书籍区 meta_tag 标注不全** | Book (书籍) meta_tags have low coverage — many entries lack "日本", "系列" etc. Prefer `series` direct field instead. |
| **导演 not 监督** | Director position is `导演` (ID 2). `监督` is not a valid position name |
| **Position names vary by subject type** | `脚本` = screenplay (书籍/游戏), `编剧` = screenplay (三次元). `原作` exists in multiple types with different IDs. Always check `schema-data.js` `*_POSITIONS` arrays for the target type |
| **person_id in staff conditions** | Maps to `p.person_id` directly (fixed). Do NOT use infobox field names for person_id/name/career |
| **infobox fields** | 出版社, 作者, 生日, etc. are NOT direct columns — extracted via `regexp_extract(infobox, ...)` |
| **count mode: no sort** | Can filter by count but not order results. Use threshold stepping |
| **Use bgq not raw DuckDB** | bgq normalizes dates (中文→YYYY-MM-DD), handles infobox extraction, maps Chinese field names |
| **CSV has BOM** | Output starts with `\ufeff`. Use `encoding='utf-8-sig'` in Python |
| **Don't quote numbers** | `count_val: 200` not `count_val: "200"` |
| **regex syntax** | DuckDB regex, not PCRE. Escape backslashes in YAML |
| **Direct fields vary by target** | Read `stores.js` for exact lists: `SUBJECT_DIRECT_FIELDS`, `PERSON_FIELDS`, `CHARACTER_FIELDS`, `EPISODE_FIELDS`. These are DB columns usable in `field:` filters. Anything else is an infobox field. |

## Combining with Other Skills

- **bgm-cli-operate**: Online API (real-time data, collections, posts). bgq = offline bulk, bgm-cli = live. Cross-ref: bgq IDs → `bgm subject get <id>`
- **data-analysis**: Pipe CSV into pandas/polars
- **wikiBatch**: CSV output → batch wiki editing
