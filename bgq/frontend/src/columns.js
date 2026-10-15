// Association output column helpers: prefix registry, token parse/build, and
// suggestion generators for the output/sort inputs in QuerySettings.
//
// Backend syntax mirrored here (see internal/query/builder.go):
//   前缀.字段        association field (comma-joined, limit via assocLimit)
//   前缀.count       count of matches
//   前缀.{f1|f2}     group JSON array; members prefixed "s." are
//                    subject-level fields (person_character/character_person)
//
// Name collisions: a BARE token identical to an association prefix (e.g. "导演"
// alone) is a plain (infobox/direct) column — the row editors below only ever
// manage tokens containing "." with a recognized prefix and never rewrite
// bare tokens.

import {
  relationsByType,
  positionsByType,
  metaTagsByType,
  META_TAGS,
  PERSON_CHAR_TYPES,
  PERSON_RELATIONS,
  CHARACTER_RELATIONS,
  CHARACTER_ASSOC_TYPES,
} from "./schema-data.js";
import { infoboxFieldsByType } from "./infobox-fields.js";
import {
  ctxFields,
  CTX_SUBJECT,
  CTX_PERSON,
  CTX_CHARACTER,
  CTX_EPISODE,
} from "./stores.js";

export function subjectFieldsForType(typeCode = 0) {
  return [
    ...new Set([...ctxFields(CTX_SUBJECT), ...infoboxFieldsByType(typeCode)]),
  ];
}

// Curated per-entity field lists (direct fields + commonly used infobox keys,
// matching the filter UI's notion of entity fields). Stage-3 suggestions use
// these; free-form infobox fields remain allowed via manual input.
export const ENTITY_FIELDS = {
  subject: subjectFieldsForType(0),
  person: ctxFields(CTX_PERSON),
  character: ctxFields(CTX_CHARACTER),
  episode: ctxFields(CTX_EPISODE),
};

export const ENTITY_LABELS = {
  subject: "条目",
  person: "人物",
  character: "角色",
  episode: "剧集",
};

// assocPrefixesForTarget returns the association prefixes usable in output
// columns for a query target:
//   { prefix, entity, dual }
// entity = which entity the non-"s." fields resolve against; dual marks
// person_character/character_person prefixes whose group members may also
// include subject-level "s." fields (GUI exposes them as a second field box).
// When typeCode is a subject type (1/2/3/4/6), relation/position prefixes of
// that type sort first; other prefixes keep their relative order. For the
// subject target the matching relations AND positions come before the rest
// of either kind (rather than all relations first, then all positions).
export function assocPrefixesForTarget(target, typeCode = 0) {
  const positions = prioritizedPositions(typeCode);
  const relations = prioritizedRelations(typeCode);
  switch (target) {
    case "person":
      return [
        ...positions.map((prefix) => ({ prefix, entity: "subject" })),
        ...PERSON_RELATIONS.map((prefix) => ({ prefix, entity: "person" })),
        ...PERSON_CHAR_TYPES.map((prefix) => ({
          prefix,
          entity: "character",
          dual: true,
        })),
      ];
    case "character":
      return [
        ...CHARACTER_RELATIONS.map((prefix) => ({
          prefix,
          entity: "character",
        })),
        ...PERSON_CHAR_TYPES.map((prefix) => ({
          prefix,
          entity: "person",
          dual: true,
        })),
      ];
    case "episode":
      return [];
    default: {
      let rels = relations;
      let poss = positions;
      if (typeCode) {
        const relSet = new Set(relationsByType(typeCode));
        const posSet = new Set(positionsByType(typeCode));
        rels = relations.filter((r) => relSet.has(r));
        poss = positions.filter((p) => posSet.has(p));
      }
      const rest = (all, kept) => {
        const want = new Set(kept);
        return all.filter((x) => !want.has(x));
      };
      const toSubject = (prefix) => ({ prefix, entity: "subject" });
      const toPerson = (prefix) => ({ prefix, entity: "person" });
      return [
        ...rels.map(toSubject),
        ...poss.map(toPerson),
        ...rest(relations, rels).map(toSubject),
        ...rest(positions, poss).map(toPerson),
        ...CHARACTER_ASSOC_TYPES.map((prefix) => ({
          prefix,
          entity: "character",
        })),
        { prefix: "episode", entity: "episode" },
      ];
    }
  }
}

// assocRowsFromFilters scans the FIRST level of the filter tree (root logic
// group's direct items; nested associations intentionally have no GUI) and
// returns one row descriptor per distinct association prefix.
export function assocRowsFromFilters(target, rootItems) {
  const rows = [];
  const seen = new Set();
  const push = (prefix, entity, dual) => {
    if (!prefix || seen.has(prefix)) return;
    seen.add(prefix);
    rows.push({ key: `${target}:${prefix}`, prefix, entity, dual: !!dual });
  };
  for (const item of rootItems || []) {
    if (!item || item.logic || item._pendingDelete) continue;
    if (target === "subject") {
      if (item.relation) push(item.relation.type, "subject");
      if (item.staff) {
        const parts =
          item.staff.positions?.length > 0
            ? item.staff.positions
            : [item.staff.position];
        for (const p of parts) push(p, "person");
      }
      if (item.character) push(item.character.type, "character");
      if (item.subject_cast) push(item.subject_cast.type, "character");
      if (item.episode) push("episode", "episode");
    } else if (target === "person") {
      if (item.staff) {
        const parts =
          item.staff.positions?.length > 0
            ? item.staff.positions
            : [item.staff.position];
        for (const p of parts) push(p, "subject");
      }
      if (item.person_relation) push(item.person_relation.type, "person");
      if (item.person_character)
        push(item.person_character.type, "character", true);
      if (item.person_cast_subject)
        push(item.person_cast_subject.type, "character", true);
    } else if (target === "character") {
      if (item.character_relation)
        push(item.character_relation.type, "character");
      if (item.character_person)
        push(item.character_person.type, "person", true);
    }
  }
  return rows;
}

export function assocFieldsFromFilters(target, rootItems) {
  const map = new Map();
  const entry = (prefix) => {
    if (!prefix) return null;
    let e = map.get(prefix);
    if (!e) {
      e = { fields: [], subjectFields: [] };
      map.set(prefix, e);
    }
    return e;
  };
  const pushName = (arr, v) => {
    const s = typeof v === "string" ? v.trim() : v;
    if (s && !arr.includes(s)) arr.push(s);
  };
  const scan = (arr, list) => {
    for (const item of list || []) {
      if (!item || typeof item !== "object" || item._pendingDelete) continue;
      if (item.logic) {
        scan(arr, item.logic.items);
        continue;
      }
      if (item.field?.field) pushName(arr, item.field.field);
      for (const key of Object.keys(item)) {
        const val = item[key];
        if (!val || typeof val !== "object") continue;
        for (const ck of [
          "conditions",
          "subject_conditions",
          "character_conditions",
          "person_conditions",
        ]) {
          if (Array.isArray(val[ck])) {
            for (const c of val[ck]) {
              if (c?.logic) scan(arr, c.logic.items);
            }
          }
        }
        if (
          val.logic &&
          typeof val.logic === "object" &&
          !Array.isArray(val.logic)
        ) {
          scan(arr, val.logic.items);
        }
      }
    }
  };
  const collectInto = (arr, node) => {
    if (!node) return;
    if (Array.isArray(node)) {
      for (const c of node) {
        if (c?.logic) scan(arr, c.logic.items);
      }
      return;
    }
    if (typeof node === "object") {
      if (node.logic && typeof node.logic === "object") {
        scan(arr, node.logic.items);
      } else if (Array.isArray(node.items)) {
        scan(arr, node.items);
      }
    }
  };
  const harvest = (prefix, assoc, fieldKeys, subjectKeys) => {
    const e = entry(prefix);
    if (!e || !assoc) return;
    for (const k of fieldKeys || []) collectInto(e.fields, assoc[k]);
    for (const k of subjectKeys || []) collectInto(e.subjectFields, assoc[k]);
  };
  const harvestStaff = (staff) => {
    const parts =
      staff.positions?.length > 0 ? staff.positions : [staff.position];
    for (const p of parts) harvest(p, staff, ["conditions"], []);
  };
  for (const item of rootItems || []) {
    if (!item || item.logic || item._pendingDelete) continue;
    if (target === "subject") {
      if (item.relation)
        harvest(item.relation.type, item.relation, ["conditions"], []);
      if (item.staff) harvestStaff(item.staff);
      if (item.character)
        harvest(item.character.type, item.character, ["conditions"], []);
      if (item.subject_cast)
        harvest(
          item.subject_cast.type,
          item.subject_cast,
          ["character_conditions", "person_conditions"],
          [],
        );
      if (item.episode) harvest("episode", item.episode, ["logic"], []);
    } else if (target === "person") {
      if (item.staff) harvestStaff(item.staff);
      if (item.person_relation)
        harvest(
          item.person_relation.type,
          item.person_relation,
          ["conditions"],
          [],
        );
      if (item.person_character)
        harvest(
          item.person_character.type,
          item.person_character,
          ["conditions"],
          ["subject_conditions"],
        );
      if (item.person_cast_subject)
        harvest(
          item.person_cast_subject.type,
          item.person_cast_subject,
          ["character_conditions"],
          ["conditions"],
        );
    } else if (target === "character") {
      if (item.character_relation)
        harvest(
          item.character_relation.type,
          item.character_relation,
          ["conditions"],
          [],
        );
      if (item.character_person)
        harvest(
          item.character_person.type,
          item.character_person,
          ["conditions"],
          ["subject_conditions"],
        );
    }
  }
  return map;
}

// parseAssocToken parses one output-column token belonging to `prefix`.
// Returns null when the token does not belong to the prefix, and { raw: true }
// for forms the row editor does not manage (count / ~min / ~max), leaving them
// to manual editing in the main input. "前缀.s.*" tokens are NOT managed here
// either (GUI merges subject fields into the shared group token instead).
export function parseAssocToken(token, prefix) {
  const head = prefix + ".";
  if (!token.startsWith(head) || token.startsWith(head + "s.")) return null;
  const rest = token.slice(head.length);
  if (!rest) return null;
  if (rest === "count" || /~min|~max/.test(rest)) return { raw: true };
  if (rest.startsWith("{")) {
    const m = rest.match(/^\{([^}]*)\}$/);
    if (!m) return { raw: true };
    const fields = [];
    const subjectFields = [];
    for (const f of m[1].split("|")) {
      const v = f.trim();
      if (!v) continue;
      if (v.startsWith("s.")) subjectFields.push(v.slice(2));
      else fields.push(v);
    }
    return { fields, subjectFields };
  }
  const field = rest;
  if (!field || field.includes(".")) return { raw: true };
  return { fields: [field], subjectFields: [] };
}

// buildAssocToken renders a row's fields back into a token.
export function buildAssocToken(prefix, fields, subjectFields) {
  const all = [
    ...(fields || []),
    ...(subjectFields || []).map((f) => "s." + f),
  ].filter(Boolean);
  if (all.length === 0) return null;
  if (all.length === 1) return `${prefix}.${all[0]}`;
  return `${prefix}.{${all.join("|")}}`;
}

// Default fields when an association filter first appears: {id|name}
// (dual rows also get the subject-level pair → CV.{id|name|s.id|s.name}).
export const DEFAULT_ROW_FIELDS = ["id", "name"];

// makeOutputTokenLister builds the 3-stage autocomplete for the output
// columns input:
//   stage 1 (no "."):          plain fields + bare prefixes (full tokens)
//   stage 2 ("前缀."):          前缀.count and 前缀.{  (full tokens; non-field
//                              entries only — fields live inside the group,
//                              per UX design)
//   stage 3 ("前缀.{..." open): BARE field names suffixed "|" (e.g. "生日|",
//                              "s.发售日|" for dual prefixes). They are spliced
//                              into the braces at the caret position by the
//                              input (whole-column replacement only happens
//                              for full-token stages). Trailing "|" is
//                              harmless — the backend skips empty members.
export function makeOutputTokenLister(target, plainFields, typeCode = 0) {
  const infos = assocPrefixesForTarget(target, typeCode);
  const prefixMap = new Map(infos.map((i) => [i.prefix, i]));
  const stage1 = [...new Set([...plainFields, ...infos.map((i) => i.prefix)])];
  const subjectFields = subjectFieldsForType(typeCode);
  const fieldsFor = (entity) =>
    entity === "subject" ? subjectFields : ENTITY_FIELDS[entity];
  return (token) => {
    const t = token.trim();
    if (!t.includes(".")) return stage1;
    const dot = t.indexOf(".");
    const prefix = t.slice(0, dot);
    const info = prefixMap.get(prefix);
    if (!info) return [];
    const rest = t.slice(dot + 1);
    if (rest.startsWith("{")) {
      if (rest.includes("}")) return [];
      const content = rest.slice(1);
      const members = content
        .split("|")
        .map((s) => s.trim())
        .filter(Boolean);
      const existing = new Set(members);
      const out = [];
      for (const f of fieldsFor(info.entity)) {
        if (!existing.has(f)) out.push(f + "|");
      }
      if (info.dual) {
        for (const f of subjectFields) {
          if (!existing.has("s." + f)) out.push("s." + f + "|");
        }
      }
      return out;
    }
    // Stage 2: count is available as 前缀.count (character/person count); for dual
    // prefixes an extra 前缀.s.count (distinct works) is also valid.
    if (rest === "" || (rest !== "count" && "count".startsWith(rest))) {
      const out = [`${prefix}.count`, `${prefix}.{`];
      if (info.dual) out.splice(1, 0, `${prefix}.s.count`);
      return out;
    }
    if (info.dual && (rest === "s" || "s.count".startsWith(rest))) {
      return [`${prefix}.s.count`];
    }
    return [];
  };
}

// sortColumnSuggestions: flat combos for the sort field input (sorting uses
// scalar fields; group columns are not sortable, count is). When typeCode is
// a subject type, that type's relation/position prefixes sort first.
export function sortColumnSuggestions(target, plainFields, typeCode = 0) {
  const out = [...plainFields];
  const subjectFields = subjectFieldsForType(typeCode);
  const fieldsFor = (entity) =>
    entity === "subject" ? subjectFields : ENTITY_FIELDS[entity];
  for (const info of assocPrefixesForTarget(target, typeCode)) {
    out.push(`${info.prefix}.count`);
    if (info.dual) out.push(`${info.prefix}.s.count`);
    for (const f of fieldsFor(info.entity)) {
      out.push(`${info.prefix}.${f}`);
    }
    if (info.dual) {
      for (const f of subjectFields) {
        out.push(`${info.prefix}.s.${f}`);
      }
    }
  }
  return [...new Set(out)];
}

// prioritize reorders `list` so entries present in `priority` come first
// (following `priority` order); all other entries keep their relative order.
// Priority entries missing from `list` are ignored.
export function prioritize(list, priority) {
  if (!Array.isArray(list) || !Array.isArray(priority) || priority.length === 0)
    return list;
  const rank = new Map();
  for (const p of priority) {
    if (p && !rank.has(p)) rank.set(p, rank.size);
  }
  if (rank.size === 0) return list;
  const max = priority.length;
  return [...list].sort(
    (a, b) =>
      (rank.has(a) ? rank.get(a) : max) - (rank.has(b) ? rank.get(b) : max),
  );
}

// normalizeSubjectType maps a type filter value (numeric code, numeric
// string, or Chinese name) to a subject type code (1/2/3/4/6); 0 = all/unknown.
function normalizeSubjectType(v) {
  if (v == null || v === "" || v === "任意") return 0;
  const s = String(v).trim();
  const byName = { 书籍: 1, 动画: 2, 音乐: 3, 游戏: 4, 三次元: 6 };
  if (byName[s]) return byName[s];
  const n = Number(s);
  if ([1, 2, 3, 4, 6].includes(n)) return n;
  return 0;
}

// detectSubjectTypeCode returns the subject type code when the FIRST level
// of the filter tree contains exactly one distinct subject-type constraint
// (`type.value` or `field.field === "type"`); 0 otherwise. Nested groups
// and other targets' `type` (e.g. person 个人/公司/组合) never count.
export function detectSubjectTypeCode(items) {
  const found = new Set();
  for (const item of items || []) {
    if (!item || typeof item !== "object" || item.logic || item._pendingDelete)
      continue;
    if (item.type) found.add(normalizeSubjectType(item.type.value));
    if (item.field?.field === "type")
      found.add(normalizeSubjectType(item.field.value));
  }
  found.delete(0);
  return found.size === 1 ? [...found][0] : 0;
}

// orderByTypePriority returns `all` reordered so `preferred` entries come
// first (in `preferred` order); the rest keep their `all` order.
function orderByTypePriority(all, preferred) {
  if (!Array.isArray(all)) return all;
  if (!Array.isArray(preferred) || preferred.length === 0) return [...all];
  const want = new Set(preferred);
  const first = [];
  for (const p of preferred) {
    if (all.includes(p) && !first.includes(p)) first.push(p);
  }
  for (const a of all) {
    if (!want.has(a)) first.push(a);
  }
  return first;
}

export function prioritizedRelations(typeCode) {
  const all = relationsByType(0);
  if (!typeCode) return [...all];
  return orderByTypePriority(all, relationsByType(typeCode));
}

export function prioritizedPositions(typeCode) {
  const all = positionsByType(0);
  if (!typeCode) return [...all];
  return orderByTypePriority(all, positionsByType(typeCode));
}

export function prioritizedMetaTags(typeCode) {
  if (!typeCode) return [...META_TAGS];
  const preferred = metaTagsByType(typeCode);
  const want = new Set(preferred);
  const out = [...preferred];
  for (const t of META_TAGS) {
    if (!want.has(t)) out.push(t);
  }
  return out;
}

export function subjectFieldSuggestions(typeCode = 0) {
  return [...subjectFieldsForType(typeCode), ...prioritizedPositions(typeCode)];
}
