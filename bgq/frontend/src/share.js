// Query sharing: serialize the current query state into a single compressed
// URL query param (gzip → base64url), and restore it on load.
//
// Length protection: URLs have practical limits (browsers, proxies, messaging
// apps). The payload is gzip-compressed to minimize length, and if the encoded
// param still exceeds MAX_PAYLOAD_LEN we refuse and suggest YAML export instead
// (which is the natural escape hatch for very large queries).

import {
  queryTarget,
  outputColumns,
  sortRules,
  resultLimit,
  manualAssoc,
  assocSeeded,
  nextAssocId,
  getRootLogic,
  resetStructureVersions,
} from "./stores.js";
import { getFiltersForAPI, applyFiltersFromAPI } from "./logic-tree.js";
import {
  assocPrefixInfos,
  assocRowsFromFilters,
  parseAssocToken,
} from "./columns.js";
import { get } from "svelte/store";

const STATE_VERSION = 1;
export const MAX_PAYLOAD_LEN = 6000;

export const SHARE_PARAM = "q";

async function readAll(stream) {
  const reader = stream.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

function compressBytes(bytes) {
  if (typeof CompressionStream === "undefined") {
    throw new Error("当前浏览器不支持压缩，无法生成分享链接");
  }
  const stream = new Blob([bytes])
    .stream()
    .pipeThrough(new CompressionStream("gzip"));
  return readAll(stream);
}

function decompressBytes(bytes) {
  if (typeof DecompressionStream === "undefined") {
    throw new Error("当前浏览器不支持解压，无法还原分享链接");
  }
  const stream = new Blob([bytes])
    .stream()
    .pipeThrough(new DecompressionStream("gzip"));
  return readAll(stream);
}

function toBase64URL(bytes) {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64URL(str) {
  let b64 = str.replace(/-/g, "+").replace(/_/g, "/");
  while (b64.length % 4) b64 += "=";
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/** Build the serializable state object for the current query. */
export function buildShareState() {
  const cols =
    (get(outputColumns) || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean) || [];
  const sort = get(sortRules).filter((r) => r.field && !r._pendingDelete);
  return {
    v: STATE_VERSION,
    target: get(queryTarget),
    filters: getFiltersForAPI(),
    columns: cols,
    sort: sort.length > 0 ? sort : undefined,
    limit: parseInt(get(resultLimit)) || 500,
  };
}

/** Encode state to a base64url string suitable for a query param. */
export async function encodeShareState(state) {
  const json = JSON.stringify(state);
  const bytes = new TextEncoder().encode(json);
  return toBase64URL(await compressBytes(bytes));
}

/** Decode a base64url payload back into a state object. */
export async function decodeShareState(payload) {
  const bytes = fromBase64URL(payload);
  const json = new TextDecoder().decode(await decompressBytes(bytes));
  return JSON.parse(json);
}

/** Apply a decoded state object to the current stores. */
export function applyShareState(state) {
  if (!state || state.v !== STATE_VERSION) {
    throw new Error("分享链接格式不兼容或已损坏");
  }
  if (state.target) queryTarget.set(state.target);
  if (state.filters?.length > 0) applyFiltersFromAPI(state.filters);
  if (state.columns?.length > 0) outputColumns.set(state.columns.join(","));
  if (state.sort) sortRules.set(state.sort);
  if (state.limit) resultLimit.set(state.limit);
  const target = get(queryTarget);
  const prefixes = new Set(
    assocPrefixInfos(target, 0, getRootLogic().items, state.columns).map(
      (r) => r.prefix,
    ),
  );
  const filters = assocRowsFromFilters(target, getRootLogic().items);
  // Only managed tokens (field/group forms) get rows; raw forms like
  // "episode.count" stay in the main input and must not spawn empty rows.
  const rowPrefix = (col) => {
    const prefix = col.slice(0, col.indexOf("."));
    const p = parseAssocToken(col, prefix);
    return p && !p.raw ? prefix : null;
  };
  const rows = [
    ...new Set(
      (Array.isArray(state.columns) ? state.columns : [])
        .filter((col) => {
          if (typeof col !== "string" || !col.includes(".")) return false;
          return rowPrefix(col) != null;
        })
        .map(rowPrefix)
        .filter((prefix) => prefixes.has(prefix)),
    ),
  ];
  manualAssoc.update((m) => ({
    ...m,
    [target]: rows.map((prefix) => ({ prefix, _id: nextAssocId() })),
  }));
  assocSeeded.update((m) => ({
    ...m,
    [target]: filters.map((r) => r.prefix).filter((p) => prefixes.has(p)),
  }));
  resetStructureVersions();
}

/** Build the full shareable URL for the current query, or null if too long. */
export async function buildShareURL() {
  const payload = await encodeShareState(buildShareState());
  if (!payload) {
    throw new Error("分享链接生成失败（内容为空）");
  }
  if (payload.length > MAX_PAYLOAD_LEN) {
    return null;
  }
  const url = new URL(window.location.href);
  url.search = "";
  url.searchParams.set(SHARE_PARAM, payload);
  return url.toString();
}
