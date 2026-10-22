import { writable, derived } from "svelte/store";

const LS_KEY = "bgq_results_highlight";

function loadHighlightOn() {
  try {
    return localStorage.getItem(LS_KEY) === "1";
  } catch {
    return false;
  }
}

export const highlightOn = writable(loadHighlightOn());

highlightOn.subscribe((v) => {
  try {
    localStorage.setItem(LS_KEY, v ? "1" : "0");
  } catch {
    return;
  }
});

export const highlightPatterns = writable(null);

export const highlightActivePatterns = derived(
  [highlightOn, highlightPatterns],
  ([$on, $patterns]) => ($on ? $patterns : null),
);

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function validRegexSource(source) {
  try {
    new RegExp(source, "g");
  } catch {
    return false;
  }
  return true;
}

function literalPattern(source) {
  const s = String(source ?? "").trim();
  return s ? escapeRegExp(s) : null;
}

function fieldHit(v) {
  const key = String(v.field ?? "").trim();
  if (!key) return null;
  if (v.operator === "contains" || v.operator === "eq") {
    const pattern = literalPattern(v.value);
    return pattern ? { key, pattern } : null;
  }
  if (v.operator === "regex" && v.value && validRegexSource(v.value)) {
    return { key, pattern: String(v.value) };
  }
  return null;
}

function tagHit(v, tagName) {
  if (v.negate || (v.operator !== "contains" && v.operator !== "eq")) {
    return null;
  }
  const pattern = literalPattern(v.value);
  if (!pattern) return null;
  return { key: tagName === "tag" ? "tags" : "meta_tags", pattern };
}

function collectPatterns(node, out) {
  if (Array.isArray(node)) {
    for (const n of node) collectPatterns(n, out);
    return;
  }
  if (!node || typeof node !== "object") return;
  if (node.logic) {
    collectPatterns(node.logic.items ?? [], out);
    return;
  }
  for (const key of Object.keys(node)) {
    collectInCondition(key, node[key], out);
  }
}

function collectInCondition(key, v, out) {
  if (Array.isArray(v)) {
    for (const c of v) collectPatterns(c, out);
    return;
  }
  if (!v || typeof v !== "object") return;
  if (v.logic) {
    collectPatterns(v.logic.items ?? [], out);
    return;
  }
  const hit =
    key === "field"
      ? fieldHit(v)
      : key === "tag" || key === "meta_tag"
        ? tagHit(v, key)
        : null;
  if (hit) out.push(hit);
}

export function deriveHighlightPatterns(filters) {
  const hits = [];
  collectPatterns(filters, hits);
  if (hits.length === 0) return null;
  const groups = new Map();
  for (const hit of hits) {
    const list = groups.get(hit.key) ?? [];
    if (!list.includes(hit.pattern)) list.push(hit.pattern);
    groups.set(hit.key, list);
  }
  const out = [];
  for (const [field, list] of groups) {
    const source = list.join("|");
    try {
      out.push({ field, source, regex: new RegExp(source, "g") });
    } catch {
      continue;
    }
  }
  return out.length > 0 ? out : null;
}
