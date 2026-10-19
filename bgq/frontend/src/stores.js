import { writable, get } from "svelte/store";

import { platformsByType } from "./schema-data.js";
import {
  INFOBOX_FIELDS_PERSON,
  INFOBOX_FIELDS_CHARACTER,
} from "./infobox-fields.js";

// Subject direct fields for autocomplete
const SUBJECT_DIRECT_FIELDS = [
  "id",
  "type",
  "name",
  "name_cn",
  "platform",
  "summary",
  "nsfw",
  "score",
  "rank",
  "date",
  "series",
];

// Version counter — incremented on every mutation to trigger reactivity
const logicVersion = writable(0);

// Focus request — set after add operations so FilterTree can focus the new element
export const focusRequest = writable(null);
function bumpVersion() {
  logicVersion.update((n) => n + 1);
}

export const lastResult = writable(null);
export const queryLoading = writable(false);

export const liveMsg = writable("");
let liveTimer = 0;
export function announce(msg, ms = 4000) {
  clearTimeout(liveTimer);
  liveMsg.set("");
  setTimeout(() => liveMsg.set(msg), 100);
  liveTimer = setTimeout(() => liveMsg.set(""), ms + 100);
}

export const sortState = writable({ col: -1, asc: true, field: "" });
export const queryTarget = writable("subject");
export const lastQueryTarget = writable("subject");
export const outputColumns = writable("id,name,name_cn,type,");
export const sortRules = writable([]); // [{field: string, direction: "asc"|"desc"}]
export const RESULT_LIMIT_DEFAULT = 500;
export const resultLimit = writable(RESULT_LIMIT_DEFAULT);
export const ASSOC_LIMIT_DEFAULT = 1;
export const assocLimit = writable(ASSOC_LIMIT_DEFAULT);

// Per-target output settings: { [target]: { outputColumns, sortRules, resultLimit } }
const _targetSettings = {};

// Manually managed association output rows per target ("+ 关联" and rows
// seeded from first-level filters): { [target]: [{ prefix, _id }] }.
// Rows are ordinary manual entries — freely renamable/removable; filters only
// seed new rows once (assocSeeded suppresses re-seeding until the filter
// itself disappears).
export const manualAssoc = writable({});

// Prefixes already seeded from filters, per target: { [target]: string[] }.
export const assocSeeded = writable({});

let _assocIdCounter = 0;
export function nextAssocId() {
  return ++_assocIdCounter;
}

let _pendingDeleteExempt = null;
export function getPendingDeleteExempt() {
  return _pendingDeleteExempt;
}
export function setPendingDeleteExempt(id) {
  _pendingDeleteExempt = id;
  if (id != null) {
    setTimeout(() => {
      if (_pendingDeleteExempt === id) _pendingDeleteExempt = null;
    }, 0);
  }
}

// Per-scope structure versions: only increment on add/remove (not edit).
// Used to decide when pending-delete undo windows expire.
export const conditionStructureVersion = writable(0);
export const sortStructureVersion = writable(0);
export const assocStructureVersion = writable(0);

export function bumpConditionStructureVersion() {
  conditionStructureVersion.update((n) => n + 1);
}
export function bumpSortStructureVersion() {
  sortStructureVersion.update((n) => n + 1);
}
export function bumpAssocStructureVersion() {
  assocStructureVersion.update((n) => n + 1);
}
export function resetStructureVersions() {
  conditionStructureVersion.set(0);
  sortStructureVersion.set(0);
  assocStructureVersion.set(0);
}

// ---- Pending-delete helpers for in-place undo ----

export function removeSortRule(idx) {
  setPendingDeleteExempt(`sort:${idx}`);
  announce("已删除排序");
  sortRules.update((rules) =>
    rules.map((r, i) => (i === idx ? { ...r, _pendingDelete: true } : r)),
  );
  bumpSortStructureVersion();
}

export function undoSortRuleRemove(idx) {
  sortRules.update((rules) =>
    rules.map((r, i) => {
      if (i !== idx) return r;
      const rest = { ...r };
      delete rest._pendingDelete;
      return rest;
    }),
  );
}

export function purgeSortRulePendingDeletes(exempt = null) {
  const rules = get(sortRules);
  const purged = rules.filter(
    (r, i) => !r._pendingDelete || `sort:${i}` === exempt,
  );
  if (purged.length !== rules.length) sortRules.set(purged);
}

export function removeManualAssocRow(target, rowId, removedToken = null) {
  setPendingDeleteExempt(`assoc:${target}:${rowId}`);
  announce("已删除关联输出");
  manualAssoc.update((m) => {
    const rows = m[target] || [];
    return {
      ...m,
      [target]: rows.map((r) =>
        r._id === rowId
          ? { ...r, _pendingDelete: true, _pendingDeleteToken: removedToken }
          : r,
      ),
    };
  });
  bumpAssocStructureVersion();
}

export function undoManualAssocRowRemove(target, rowId) {
  manualAssoc.update((m) => {
    const rows = m[target] || [];
    return {
      ...m,
      [target]: rows.map((r) => {
        if (r._id !== rowId) return r;
        const rest = { ...r };
        delete rest._pendingDelete;
        delete rest._pendingDeleteToken;
        return rest;
      }),
    };
  });
}

export function purgeManualAssocPendingDeletes(
  exempt = null,
  target = get(queryTarget),
) {
  const m = get(manualAssoc);
  const rows = m[target];
  if (!Array.isArray(rows)) return;
  const list = rows.filter(
    (r) => !r._pendingDelete || `assoc:${target}:${r._id}` === exempt,
  );
  if (list.length !== rows.length) {
    const out = { ...m };
    if (list.length > 0) out[target] = list;
    else delete out[target];
    manualAssoc.set(out);
  }
}

// Old localStorage shape was { [target]: string[] } — upgrade to objects.
function normalizeManualAssoc(v) {
  if (!v || typeof v !== "object") return null;
  const out = {};
  for (const [t, list] of Object.entries(v)) {
    if (!Array.isArray(list)) continue;
    const rows = [];
    for (const e of list) {
      if (typeof e === "string" && e)
        rows.push({ prefix: e, _id: nextAssocId() });
      else if (e && typeof e === "object" && e.prefix) rows.push(e);
    }
    if (rows.length > 0) out[t] = rows;
  }
  return out;
}

export const DEFAULT_SETTINGS = {
  subject: {
    outputColumns: "id,name,name_cn,type,",
    sortRules: [],
    resultLimit: 500,
  },
  person: {
    outputColumns: "id,name,简体中文名,",
    sortRules: [],
    resultLimit: 500,
  },
  character: {
    outputColumns: "id,name,简体中文名,",
    sortRules: [],
    resultLimit: 500,
  },
  episode: {
    outputColumns: "id,name,name_cn,",
    sortRules: [],
    resultLimit: 500,
  },
};

export function saveTargetSettings() {
  const target = get(queryTarget);
  const oc = get(outputColumns);
  _targetSettings[target] = {
    outputColumns: oc ?? "",
    sortRules: get(sortRules),
    resultLimit: get(resultLimit),
  };
}

export function restoreTargetSettings(target) {
  const saved =
    _targetSettings[target] ||
    DEFAULT_SETTINGS[target] ||
    DEFAULT_SETTINGS.subject;
  outputColumns.set(saved.outputColumns);
  sortRules.set(saved.sortRules);
  resultLimit.set(saved.resultLimit);
}

export function clearOutputSettings() {
  outputColumns.set("");
  sortRules.set([]);
  sortState.set({ col: -1, asc: true, field: "" });
  resultLimit.set(RESULT_LIMIT_DEFAULT);
  assocLimit.set(ASSOC_LIMIT_DEFAULT);
  manualAssoc.set({});
  assocSeeded.set({});
  for (const k of Object.keys(_targetSettings)) delete _targetSettings[k];
}

let _clearSnapshot = null;

export function captureClearSnapshot() {
  _clearSnapshot = {
    subject: JSON.parse(JSON.stringify(get(subjectRootLogic))),
    person: JSON.parse(JSON.stringify(get(personRootLogic))),
    character: JSON.parse(JSON.stringify(get(characterRootLogic))),
    episode: JSON.parse(JSON.stringify(get(episodeRootLogic))),
    outputColumns: get(outputColumns),
    sortRules: JSON.parse(JSON.stringify(get(sortRules))),
    resultLimit: get(resultLimit),
    assocLimit: get(assocLimit),
    manualAssoc: JSON.parse(JSON.stringify(get(manualAssoc))),
    assocSeeded: JSON.parse(JSON.stringify(get(assocSeeded))),
    targetSettings: JSON.parse(JSON.stringify(_targetSettings)),
    logicIdCounter: _logicIdCounter,
    assocIdCounter: _assocIdCounter,
    sortState: JSON.parse(JSON.stringify(get(sortState))),
    queryTarget: get(queryTarget),
  };
}

export function restoreClearSnapshot() {
  if (!_clearSnapshot) return false;
  const s = _clearSnapshot;
  subjectRootLogic.set(s.subject);
  personRootLogic.set(s.person);
  characterRootLogic.set(s.character);
  episodeRootLogic.set(s.episode);
  outputColumns.set(s.outputColumns);
  sortRules.set(s.sortRules);
  resultLimit.set(s.resultLimit);
  if (s.assocLimit != null) assocLimit.set(s.assocLimit);
  manualAssoc.set(s.manualAssoc);
  assocSeeded.set(s.assocSeeded);
  for (const k of Object.keys(_targetSettings)) delete _targetSettings[k];
  Object.assign(_targetSettings, s.targetSettings);
  _logicIdCounter = s.logicIdCounter;
  _assocIdCounter = s.assocIdCounter;
  sortState.set(s.sortState);
  queryTarget.set(s.queryTarget);
  _clearSnapshot = null;
  bumpVersion();
  resetStructureVersions();
  saveToStorage();
  return true;
}

export function clearClearSnapshot() {
  _clearSnapshot = null;
}

let _logicIdCounter = 0;

export function newLogicGroup(op) {
  return { op: op || "and", items: [], _id: ++_logicIdCounter };
}

export function resetLogicIdCounter() {
  _logicIdCounter = 0;
}
export function incLogicIdCounter() {
  return ++_logicIdCounter;
}

export function ensureLogicIds(node) {
  if (!node || typeof node !== "object") return node;
  if (!node._id) node._id = incLogicIdCounter();
  for (const item of node.items || []) {
    if (!item || typeof item !== "object") continue;
    if (item.logic && typeof item.logic === "object") {
      ensureLogicIds(item.logic);
      if (!item._id) item._id = item.logic._id;
      continue;
    }
    if (!item._id) item._id = incLogicIdCounter();
  }
  walkCondArrayItems(node);
  return node;
}

function walkCondArrayItems(node) {
  for (const item of node.items || []) {
    if (!item || typeof item !== "object" || item.logic) continue;
    walkWrapItem(item);
  }
}

function walkWrapItem(item) {
  for (const key of [
    "relation",
    "person_relation",
    "character_relation",
    "staff",
    "character",
    "person_character",
    "person_cast_subject",
    "character_person",
    "subject_cast",
  ]) {
    const v = item[key];
    if (!v) continue;
    for (const arrKey of [
      "conditions",
      "subject_conditions",
      "character_conditions",
      "person_conditions",
    ]) {
      const arr = v[arrKey];
      if (!Array.isArray(arr)) continue;
      for (const c of arr) {
        if (!c || typeof c !== "object" || !c.logic) continue;
        ensureLogicIds(c.logic);
        if (!c._id) c._id = c.logic._id;
      }
    }
  }
  if (item.episode?.logic) {
    ensureLogicIds(item.episode.logic);
    if (!item.episode._id) item.episode._id = item.episode.logic._id;
  }
}

const STORAGE_KEY = "bgq_state";

function saveToStorage() {
  try {
    const oc = get(outputColumns);
    const cleanedTargetSettings = {};
    for (const [k, v] of Object.entries(_targetSettings)) {
      if (!v) continue;
      cleanedTargetSettings[k] = v;
    }
    const state = {
      target: get(queryTarget),
      subject: get(subjectRootLogic),
      person: get(personRootLogic),
      character: get(characterRootLogic),
      episode: get(episodeRootLogic),
      outputColumns: oc ?? "",
      sortRules: get(sortRules),
      resultLimit: get(resultLimit),
      assocLimit: get(assocLimit),
      targetSettings: cleanedTargetSettings,
      manualAssoc: get(manualAssoc),
      assocSeeded: get(assocSeeded),
      _assocIdCounter,
      _idCounter: _logicIdCounter,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // ignore quota errors
  }
}

// Initialize from localStorage or defaults
let saved = null;
try {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw) saved = JSON.parse(raw);
} catch {
  /* ignore */
}

export const subjectRootLogic = writable(
  saved?.subject || newLogicGroup("and"),
);
export const personRootLogic = writable(saved?.person || newLogicGroup("and"));
export const characterRootLogic = writable(
  saved?.character || newLogicGroup("and"),
);
export const episodeRootLogic = writable(
  saved?.episode || newLogicGroup("and"),
);

if (saved?._idCounter != null) _logicIdCounter = saved._idCounter;
if (saved) {
  for (const k of ["subject", "person", "character", "episode"]) {
    if (saved[k]) ensureLogicIds(saved[k]);
  }
}
if (saved?.target) queryTarget.set(saved.target);
if (saved?.outputColumns != null) outputColumns.set(saved.outputColumns);
if (saved?.sortRules != null) sortRules.set(saved.sortRules);
if (saved?.resultLimit != null) resultLimit.set(saved.resultLimit);
if (saved?.assocLimit != null)
  assocLimit.set(
    Math.min(100, Math.max(1, Number(saved.assocLimit) || ASSOC_LIMIT_DEFAULT)),
  );
if (saved?.targetSettings) {
  const cleaned = {};
  for (const [k, v] of Object.entries(saved.targetSettings)) {
    if (!v) continue;
    cleaned[k] = v;
  }
  Object.assign(_targetSettings, cleaned);
}
if (saved?.manualAssoc) {
  const norm = normalizeManualAssoc(saved.manualAssoc);
  if (norm) manualAssoc.set(norm);
}
if (saved?.assocSeeded) assocSeeded.set(saved.assocSeeded);
if (saved?._assocIdCounter != null) _assocIdCounter = saved._assocIdCounter;

// Auto-save to localStorage on any change
subjectRootLogic.subscribe(() => saveToStorage());
personRootLogic.subscribe(() => saveToStorage());
characterRootLogic.subscribe(() => saveToStorage());
episodeRootLogic.subscribe(() => saveToStorage());
queryTarget.subscribe(() => saveToStorage());
outputColumns.subscribe(() => saveToStorage());
sortRules.subscribe(() => saveToStorage());
resultLimit.subscribe(() => saveToStorage());
assocLimit.subscribe(() => saveToStorage());

export function getTargetStore() {
  const target = get(queryTarget);
  if (target === "person") return personRootLogic;
  if (target === "character") return characterRootLogic;
  if (target === "episode") return episodeRootLogic;
  return subjectRootLogic;
}

export function getRootLogic() {
  return get(getTargetStore());
}

function resetLogicBuilder() {
  _logicIdCounter = 0;
  subjectRootLogic.set(newLogicGroup("and"));
  personRootLogic.set(newLogicGroup("and"));
  characterRootLogic.set(newLogicGroup("and"));
  episodeRootLogic.set(newLogicGroup("and"));
}

// ---- Field config constants ----

export const CTX_SUBJECT = "subject";
export const CTX_PERSON = "person";
export const CTX_STAFF_PERSON = "person_in_staff";
export const CTX_CHARACTER = "character";
export const CTX_EPISODE = "episode";

export function isPersonCtx(ctx) {
  return ctx === CTX_PERSON || ctx === CTX_STAFF_PERSON;
}

export const EPISODE_FIELDS = [
  "name",
  "name_cn",
  "description",
  "airdate",
  "duration",
  "sort",
  "type",
  "disc",
  "episode_id",
];
export const EPISODE_FIELD_LABELS = {
  name: "名称",
  name_cn: "中文名",
  description: "简介",
  airdate: "播出日期",
  duration: "时长",
  sort: "排序",
  type: "类型",
  disc: "碟片",
  episode_id: "ID",
};

export const EPISODE_FIELD_CONFIGS = {
  type: {
    label: "类型",
    ops: ["eq"],
    type: "select",
    options: [
      ["0", "本篇"],
      ["1", "特别篇"],
      ["2", "OP"],
      ["3", "ED"],
      ["4", "CM"],
      ["5", "MAD"],
      ["6", "其他"],
    ],
  },
};

const PERSON_FIELDS = [
  ...new Set([
    "name",
    "id",
    "type",
    "career",
    "summary",
    "collects",
    "comments",
    ...INFOBOX_FIELDS_PERSON,
  ]),
];

const CHARACTER_FIELDS = [
  ...new Set([
    "name",
    "id",
    "role",
    "summary",
    "comments",
    "collects",
    ...INFOBOX_FIELDS_CHARACTER,
  ]),
];

const SUBJECT_FIELD_CONFIGS = {
  type: { label: "类型", ops: ["eq"], type: "select", dynamic: "type" },
  platform: {
    label: "子类型",
    ops: ["eq"],
    type: "select",
    dynamic: "platform",
  },
  nsfw: {
    label: "NSFW",
    ops: ["eq"],
    type: "select",
    options: [
      ["true", "是"],
      ["false", "否"],
    ],
  },
  score: {
    label: "评分",
    ops: ["gt", "gte", "lt", "lte", "eq", "empty"],
    type: "number",
    step: "0.1",
  },
  rank: {
    label: "排名",
    ops: ["gt", "gte", "lt", "lte", "eq", "empty"],
    type: "number",
    step: "1",
  },
  date: { label: "日期", ops: ["before", "after", "empty"], type: "date" },
  series: {
    label: "系列",
    ops: ["eq"],
    type: "select",
    options: [
      ["true", "是"],
      ["false", "否"],
    ],
  },
};

export const CAREER_OPTIONS = [
  ["mangaka", "漫画家"],
  ["writer", "作家"],
  ["illustrator", "绘师"],
  ["seiyu", "声优"],
  ["actor", "演员"],
  ["artist", "音乐家"],
  ["producer", "制作人员"],
];

const PERSON_FIELD_CONFIGS = {
  type: {
    label: "类型",
    ops: ["eq"],
    type: "select",
    options: [
      ["1", "个人"],
      ["2", "公司"],
      ["3", "组合"],
    ],
  },
  性别: {
    label: "性别",
    ops: ["contains"],
    type: "select",
    options: [
      ["男", "男"],
      ["女", "女"],
      ["其他", "其他"],
    ],
  },
  生日: { label: "生日", ops: ["before", "after", "empty"], type: "date" },
  career: {
    label: "职业",
    ops: ["contains", "not_contains", "empty"],
    type: "text",
    ac: "career",
  },
};

const CHARACTER_FIELD_CONFIGS = {
  role: {
    label: "类型",
    ops: ["eq"],
    type: "select",
    options: [
      ["1", "角色"],
      ["2", "机体"],
      ["3", "舰船"],
      ["4", "组织机构"],
    ],
  },
  性别: {
    label: "性别",
    ops: ["contains"],
    type: "select",
    options: [
      ["男", "男"],
      ["女", "女"],
      ["其他", "其他"],
    ],
  },
};

export function ctxFieldConfigs(ctx) {
  if (isPersonCtx(ctx)) return PERSON_FIELD_CONFIGS;
  if (ctx === CTX_CHARACTER) return CHARACTER_FIELD_CONFIGS;
  if (ctx === CTX_EPISODE) return EPISODE_FIELD_CONFIGS;
  return SUBJECT_FIELD_CONFIGS;
}

export function ctxFields(ctx) {
  if (ctx === CTX_EPISODE) return EPISODE_FIELDS;
  if (isPersonCtx(ctx)) return PERSON_FIELDS;
  if (ctx === CTX_CHARACTER) return CHARACTER_FIELDS;
  return SUBJECT_DIRECT_FIELDS;
}

export function fieldSelectOptions(fc, typeCode = 0) {
  if (fc.dynamic === "type") {
    return [
      ["1", "书籍"],
      ["2", "动画"],
      ["3", "音乐"],
      ["4", "游戏"],
      ["6", "三次元"],
    ];
  }
  if (fc.dynamic === "platform") {
    const all = platformsByType(0);
    let ordered = all;
    if (typeCode) {
      const preferred = platformsByType(typeCode);
      const seen = new Set(preferred.map((p) => p.code + ":" + p.name));
      ordered = [...preferred];
      for (const p of all) {
        if (!seen.has(p.code + ":" + p.name)) ordered.push(p);
      }
    }
    return ordered.map((p) => [String(p.code), p.name]);
  }
  return fc.options || [];
}

export function opLabel(op) {
  const m = {
    eq: "=",
    contains: "包含",
    not_contains: "不包含",
    not_regex: "正则不符合",
    regex: "正则",
    gt: ">",
    gte: ">=",
    lt: "<",
    lte: "<=",
    before: "早于",
    after: "晚于",
    empty: "为空",
  };
  return m[op] || op;
}

export function opInputType(op) {
  if (["gt", "gte", "lt", "lte"].includes(op)) return "number";
  if (["before", "after"].includes(op)) return "date";
  return "text";
}

export function clearFilters() {
  resetLogicBuilder();
  bumpVersion();
}

// ---- Bangumi host (mirror support) ----
// Host used when generating subject/person/character links in results.
// Persisted separately so mirror users can point links at their mirror.
const HOST_KEY = "bgm_host";

function loadBgmHost() {
  try {
    return localStorage.getItem(HOST_KEY) || "bgm.tv";
  } catch {
    return "bgm.tv";
  }
}

export const bgmHost = writable(loadBgmHost());

bgmHost.subscribe((v) => {
  try {
    localStorage.setItem(HOST_KEY, v);
  } catch {
    // ignore quota errors
  }
});
