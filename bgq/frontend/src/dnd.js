import { get } from "svelte/store";
import { announce, getRootLogic, isPersonCtx, queryTarget } from "./stores.js";
import {
  findItemLocation,
  moveLogicItem,
  eachLogicInstance,
} from "./logic-tree.js";
import { isConditionAllowedInGroup } from "./dnd-model.js";

const COMPOSITE_KEYS = [
  "relation",
  "person_relation",
  "character_relation",
  "character",
  "staff",
  "person_character",
  "person_cast_subject",
  "subject_cast",
  "character_person",
];
const COND_ARRAY_KEYS = [
  "conditions",
  "subject_conditions",
  "character_conditions",
  "person_conditions",
];

let drag = null;
let slots = [];
let kbOrder = [];
let kbIndex = 0;
let curSlot = null;
let scrollRaf = 0;
let pointerClientY = null;
let scroller = null;

function canAccept(entry, ctx) {
  if (!ctx) return false;
  return isConditionAllowedInGroup(entry, ctx, get(queryTarget));
}

function ctxClass(ctx) {
  return isPersonCtx(ctx) ? "person" : ctx;
}

function ctxMatch(a, b) {
  if (!a || !b) return true;
  return ctxClass(a) === ctxClass(b);
}

function collectSlots(rootEl, entry, sourceCtx, srcLoc) {
  const selfGroups = new Set();
  const visitLogic = (g) =>
    eachLogicInstance(g, (inst) => selfGroups.add(inst._id), null);
  if (entry?.logic) visitLogic(entry.logic);
  for (const key of COMPOSITE_KEYS) {
    const v = entry?.[key];
    if (!v || typeof v !== "object") continue;
    for (const arrKey of COND_ARRAY_KEYS) {
      const arr = v[arrKey];
      if (Array.isArray(arr))
        for (const c of arr) if (c?.logic) visitLogic(c.logic);
    }
    // episode-mounted group (val.logic, not a conditions-array shape)
    if (v.logic && typeof v.logic === "object" && !Array.isArray(v.conditions))
      visitLogic(v.logic);
  }
  const sameSpotSlot = (slot) =>
    srcLoc !== null &&
    slot.groupId === srcLoc.groupId &&
    convertIdx(slot, srcLoc.idx, srcLoc.groupId) === srcLoc.idx;
  const list = [];
  const visited = new Set();
  const walk = (groupEl) => {
    if (visited.has(groupEl)) return;
    visited.add(groupEl);
    const ctx = groupEl.dataset.dndCtx || "";
    const groupId = Number(groupEl.dataset.logicId);
    const rows = [...groupEl.children].filter((el) =>
      el.hasAttribute("data-item-id"),
    );
    for (let i = 0; i <= rows.length; i++) {
      const rowEl = i < rows.length ? rows[i] : null;
      const pending =
        rowEl?.classList.contains("pending-delete") ||
        rowEl?.dataset.pending === "1";
      const slot = {
        groupId,
        ctx,
        idx: i,
        rowEl,
        groupEl,
        valid:
          !pending &&
          canAccept(entry, ctx) &&
          ctxMatch(ctx, sourceCtx) &&
          !selfGroups.has(groupId),
        append: i === rows.length,
      };
      if (slot.valid && sameSpotSlot(slot)) slot.valid = false;
      list.push(slot);
      if (rowEl?.dataset.logicId !== undefined) {
        walk(rowEl);
      } else if (rowEl) {
        for (const nested of rowEl.querySelectorAll(":scope [data-logic-id]"))
          walk(nested);
      }
    }
  };
  walk(rootEl);
  return list;
}

function reachRoot(handleEl) {
  const card = handleEl.closest(".card-filter") || document;
  return card.querySelector(".logic-group.root");
}

function panelFor(el) {
  let node = el;
  while (node && node !== document.body) {
    if (node.classList?.contains("panel-left")) return node;
    node = node.parentElement;
  }
  return document.scrollingElement || null;
}

function applyVisual(slot) {
  if (curSlot === slot) return;
  if (curSlot) {
    if (curSlot.append) {
      curSlot.groupEl.classList.remove("dnd-append", "dnd-forbid");
    } else {
      curSlot.rowEl?.classList.remove("dnd-before", "dnd-forbid");
    }
  }
  curSlot = slot;
  if (!slot) return;
  if (slot.append) {
    slot.groupEl.classList.add("dnd-append");
    if (!slot.valid) slot.groupEl.classList.add("dnd-forbid");
  } else {
    slot.rowEl?.classList.add("dnd-before");
    if (!slot.valid) slot.rowEl?.classList.add("dnd-forbid");
  }
}

function slotLabel(slot) {
  if (slot.append) return "插入到组末尾";
  const label = slot.rowEl?.dataset.itemLabel;
  return label ? `插入到「${label}」之前` : "插入到此位置之前";
}

function teardownDrag() {
  const d = drag;
  if (!d) return null;
  drag = null;
  slots = [];
  kbOrder = [];
  curSlot = null;
  kbIndex = 0;
  pointerClientY = null;
  scroller = null;
  if (scrollRaf) cancelAnimationFrame(scrollRaf);
  scrollRaf = 0;
  document.removeEventListener("pointermove", onPointerMove, true);
  document.removeEventListener("pointerup", onPointerUp, true);
  document.removeEventListener("pointercancel", onPointerCancel, true);
  window.removeEventListener("keydown", onPointerKey, true);
  window.removeEventListener("keydown", onKbKey, true);
  document.body.classList.remove(
    "dnd-active",
    "dnd-cursor-forbid",
    "dnd-selecting",
  );
  document.getSelection?.()?.removeAllRanges?.();
  d.rowEl?.classList.remove("dnd-lift");
  document.querySelectorAll(".dnd-before, .dnd-append").forEach((el) => {
    el.classList.remove("dnd-before", "dnd-append", "dnd-forbid");
  });
  return d;
}

function moveResult(res, slot, label) {
  if (res?.ok && !res.unchanged) {
    announce(`已移动${label}，${slotLabel(slot)}`);
  } else {
    announce("未移动");
  }
}

function refocusHandle(id) {
  if (id == null) return;
  requestAnimationFrame(() => {
    document.querySelector(`[data-dnd-handle="${id}"]`)?.focus();
  });
}

function sourceCtxOf(handleEl) {
  return handleEl.closest("[data-logic-id]")?.dataset.dndCtx || "";
}

export function beginKeyboardDrag(handleEl, source) {
  if (drag) return;
  const rootEl = reachRoot(handleEl);
  if (!rootEl) return;
  const sourceCtx = sourceCtxOf(handleEl);
  const loc = findItemLocation(getRootLogic(), source.sourceId);
  const srcLoc = loc ? { groupId: loc.group._id, idx: loc.idx } : null;
  const all = collectSlots(rootEl, source.entry, sourceCtx, srcLoc);
  const validSlots = all.filter((s) => s.valid);
  if (!validSlots.length) {
    announce("没有可放置的位置");
    return;
  }
  const rowEl = handleEl.closest("[data-item-id]");
  drag = {
    sourceId: source.sourceId,
    kind: source.kind,
    entry: source.entry,
    label: source.label,
    via: "kb",
    active: true,
    startX: 0,
    startY: 0,
    rowEl,
  };
  slots = all;
  rowEl?.classList.add("dnd-lift");
  document.body.classList.add("dnd-active");
  kbOrder = [];
  all.forEach((s, i) => {
    if (s.valid) kbOrder.push(i);
  });
  let start = kbOrder[0];
  all.forEach((s, i) => {
    if (s.rowEl === rowEl && s.valid) start = i;
  });
  kbIndex = Math.max(0, kbOrder.indexOf(start));
  moveCursor(kbIndex, false);
  announce(`已抓取${source.label}。上下方向键选择位置，回车放置，Esc 取消`);
  window.addEventListener("keydown", onKbKey, true);
}

function onKbKey(e) {
  if (!drag || drag.via !== "kb") return;
  if (e.key === "ArrowUp" || e.key === "ArrowDown") {
    e.preventDefault();
    e.stopPropagation();
    moveCursor(kbIndex + (e.key === "ArrowDown" ? 1 : -1), true);
  } else if (e.key === "Home" && kbOrder.length) {
    e.preventDefault();
    e.stopPropagation();
    moveCursor(0, true);
  } else if (e.key === "End" && kbOrder.length) {
    e.preventDefault();
    e.stopPropagation();
    moveCursor(kbOrder.length - 1, true);
  } else if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    e.stopPropagation();
    commitSlot();
  } else if (e.key === "Escape" || e.key === "Tab") {
    e.preventDefault();
    e.stopPropagation();
    finishKb("已取消拖动");
  }
}

function finishKb(msg) {
  const d = teardownDrag();
  announce(msg);
  refocusHandle(d?.sourceId);
}

function moveCursor(pos, quiet) {
  if (!kbOrder.length) return;
  kbIndex = Math.min(Math.max(pos, 0), kbOrder.length - 1);
  const slot = slots[kbOrder[kbIndex]];
  applyVisual(slot);
  if (quiet) announce(slotLabel(slot));
  if (slot.rowEl) {
    slot.rowEl.scrollIntoView({ block: "nearest" });
  } else {
    slot.groupEl.scrollIntoView({ block: "nearest" });
  }
}

function convertIdx(slot, srcIdx, srcGroupId) {
  if (slot.groupId !== srcGroupId) return slot.idx;
  return slot.idx > srcIdx ? slot.idx - 1 : slot.idx;
}

function commitSlot() {
  const slot = curSlot;
  const d = drag;
  if (!d || !slot) {
    finishKb("已取消拖动");
    return;
  }
  const loc = findItemLocation(getRootLogic(), d.sourceId);
  if (!loc) {
    finishKb("已取消拖动");
    return;
  }
  const insertIdx = convertIdx(slot, loc.idx, loc.group._id);
  const sameSpot = slot.groupId === loc.group._id && insertIdx === loc.idx;
  teardownDrag();
  if (sameSpot) {
    announce("未移动");
  } else {
    moveResult(
      moveLogicItem(d.sourceId, slot.groupId, insertIdx),
      slot,
      d.label,
    );
  }
  refocusHandle(d.sourceId);
}

export function beginPointerDrag(handleEl, event, source) {
  if (drag) return;
  event.preventDefault();
  const rootEl = reachRoot(handleEl);
  if (!rootEl) return;
  const rowEl = handleEl.closest("[data-item-id]");
  const sourceCtx = sourceCtxOf(handleEl);
  drag = {
    sourceId: source.sourceId,
    kind: source.kind,
    entry: source.entry,
    label: source.label,
    via: "pointer",
    active: false,
    startX: event.clientX,
    startY: event.clientY,
    rowEl,
  };
  slots = collectSlots(rootEl, source.entry, sourceCtx, null);
  scroller = panelFor(handleEl);
  document.body.classList.add("dnd-selecting");
  document.addEventListener("pointermove", onPointerMove, true);
  document.addEventListener("pointerup", onPointerUp, true);
  document.addEventListener("pointercancel", onPointerCancel, true);
  window.addEventListener("keydown", onPointerKey, true);
}

function activateDrag(event) {
  if (drag.active) return true;
  if (
    Math.abs(event.clientX - drag.startX) < 5 &&
    Math.abs(event.clientY - drag.startY) < 5
  ) {
    return false;
  }
  if (!slots.some((s) => s.valid)) {
    announce("没有可放置的位置");
    teardownDrag();
    return false;
  }
  drag.active = true;
  drag.rowEl?.classList.add("dnd-lift");
  document.body.classList.add("dnd-active");
  announce(`已抓取${drag.label}。拖动到目标位置松开，Esc 取消`);
  return true;
}

function slotAt(slotsAll, x, y) {
  const firstOfGroup = new Map();
  for (const s of slotsAll) {
    if (!firstOfGroup.has(s.groupId)) firstOfGroup.set(s.groupId, s);
  }
  let best = null;
  let bestArea = Infinity;
  for (const s of firstOfGroup.values()) {
    const r = s.groupEl.getBoundingClientRect();
    if (x >= r.left && x <= r.right && y >= r.top - 2 && y <= r.bottom + 2) {
      const area = r.width * r.height;
      if (area < bestArea) {
        best = s;
        bestArea = area;
      }
    }
  }
  if (!best) return null;
  let pick = null;
  for (const s of slotsAll) {
    if (s.groupId !== best.groupId) continue;
    pick = s;
    if (s.rowEl) {
      const rr = s.rowEl.getBoundingClientRect();
      if (y < rr.top + rr.height / 2) break;
    }
  }
  return pick;
}

function onPointerMove(event) {
  if (!drag) return;
  event.preventDefault();
  event.stopPropagation();
  if (!activateDrag(event)) return;
  const slot = slotAt(slots, event.clientX, event.clientY);
  applyVisual(slot);
  document.body.classList.toggle("dnd-cursor-forbid", !slot?.valid);
  pointerClientY = event.clientY;
  if (scroller) {
    const r = scroller.getBoundingClientRect();
    if (pointerClientY < r.top + 40 || pointerClientY > r.bottom - 40) {
      scrollRaf = scrollRaf || requestAnimationFrame(autoScrollFrame);
    }
  }
}

function autoScrollFrame() {
  scrollRaf = 0;
  if (!drag?.active || !scroller) return;
  const r = scroller.getBoundingClientRect();
  let dy = 0;
  if (pointerClientY != null && pointerClientY < r.top + 40) dy = -12;
  else if (pointerClientY != null && pointerClientY > r.bottom - 40) dy = 12;
  if (!dy) return;
  scroller.scrollTop += dy;
  scrollRaf = requestAnimationFrame(autoScrollFrame);
}

function onPointerKey(e) {
  if (!drag || drag.via !== "pointer") return;
  if (e.key === "Escape") {
    e.preventDefault();
    e.stopPropagation();
    finishPointer("已取消拖动");
  }
}

function finishPointer(msg) {
  const d = teardownDrag();
  if (msg) announce(msg);
  refocusHandle(d?.sourceId);
}

function onPointerUp(event) {
  const d = drag;
  if (!d) return;
  if (!d.active) {
    teardownDrag();
    refocusHandle(d.sourceId);
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  const slot = curSlot;
  if (!slot) {
    finishPointer("已取消拖动");
    return;
  }
  if (!slot.valid) {
    finishPointer("该位置不接受此条件");
    return;
  }
  const loc = findItemLocation(getRootLogic(), d.sourceId);
  if (!loc) {
    finishPointer("已取消拖动");
    return;
  }
  const insertIdx = convertIdx(slot, loc.idx, loc.group._id);
  const sameSpot = slot.groupId === loc.group._id && insertIdx === loc.idx;
  teardownDrag();
  if (sameSpot) {
    announce("未移动");
  } else {
    moveResult(
      moveLogicItem(d.sourceId, slot.groupId, insertIdx),
      slot,
      d.label,
    );
  }
  refocusHandle(d.sourceId);
}

function onPointerCancel() {
  finishPointer("已取消拖动");
}
