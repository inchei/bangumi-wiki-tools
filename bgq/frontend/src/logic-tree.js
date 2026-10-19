import {
  newLogicGroup,
  getTargetStore,
  getRootLogic,
  focusRequest,
  ctxFieldConfigs,
  EPISODE_FIELD_CONFIGS,
  resetLogicIdCounter,
  incLogicIdCounter,
  ensureLogicIds,
  setPendingDeleteExempt,
  announce,
  bumpConditionStructureVersion,
} from "./stores.js";

// ---- Logic tree helpers ----

// Iterate all condition arrays in an item (relation, staff, character, etc.)
// Calls fn(conditions, key, condKey) for each `.conditions` and
// `.subject_conditions` array. `key` is the filter kind ("person_character"
// etc.), `condKey` is the array field name so callers can write updates back
// to the correct array.
function forEachCondArray(item, fn) {
  for (const key of Object.keys(item)) {
    const val = item[key];
    if (val && typeof val === "object") {
      if (Array.isArray(val.conditions)) fn(val.conditions, key, "conditions");
      if (Array.isArray(val.subject_conditions))
        fn(val.subject_conditions, key, "subject_conditions");
      if (Array.isArray(val.character_conditions))
        fn(val.character_conditions, key, "character_conditions");
      if (Array.isArray(val.person_conditions))
        fn(val.person_conditions, key, "person_conditions");
    }
  }
}

// Immutable tree replacement: find node by `id`, apply `replacer`, propagate new refs up.
function findAndReplace(node, id, replacer) {
  if (node._id === id) return replacer(node);
  const newItems = [];
  let changed = false;
  for (const item of node.items) {
    let found = false;
    // Direct logic group: { logic: { _id, op, items } }
    if (
      item.logic &&
      typeof item.logic === "object" &&
      !Array.isArray(item.logic)
    ) {
      const updated = findAndReplace(item.logic, id, replacer);
      if (updated !== item.logic) {
        newItems.push({ ...item, logic: updated });
        found = true;
        changed = true;
      }
    }
    if (!found) {
      // Nested conditions: { relation: { conditions: [{ logic: ... }] } }
      forEachCondArray(item, (conds, key, condKey) => {
        if (found) return;
        const newConds = [];
        let condChanged = false;
        for (const c of conds) {
          if (c.logic) {
            const updated = findAndReplace(c.logic, id, replacer);
            if (updated !== c.logic) {
              condChanged = true;
              newConds.push({ logic: updated });
              continue;
            }
          }
          newConds.push(c);
        }
        if (condChanged) {
          const val = item[key];
          const newVal = { ...val, [condKey]: newConds };
          newItems.push({ ...item, [key]: newVal });
          found = true;
          changed = true;
        }
      });
    }
    if (!found) {
      // Nested logic in other structures: { episode: { logic: ... } }
      for (const key of Object.keys(item)) {
        if (found) break;
        const val = item[key];
        if (
          val &&
          typeof val === "object" &&
          val.logic &&
          typeof val.logic === "object" &&
          !Array.isArray(val.logic)
        ) {
          const updated = findAndReplace(val.logic, id, replacer);
          if (updated !== val.logic) {
            newItems.push({ ...item, [key]: { ...val, logic: updated } });
            found = true;
            changed = true;
          }
        }
      }
    }
    if (!found) newItems.push(item);
  }
  return changed ? { ...node, items: newItems } : node;
}

export function eachLogicInstance(node, fn, parentOf) {
  fn(node, parentOf);
  const items = node.items || [];
  for (let idx = 0; idx < items.length; idx++) {
    const item = items[idx];
    if (!item || typeof item !== "object") continue;
    if (
      item.logic &&
      typeof item.logic === "object" &&
      !Array.isArray(item.logic)
    ) {
      eachLogicInstance(item.logic, fn, { kind: "items", group: node, idx });
    }
    forEachCondArray(item, (conds) => {
      for (const c of conds) {
        if (c.logic && typeof c.logic === "object") {
          eachLogicInstance(c.logic, fn, { kind: "cond", group: node, idx });
        }
      }
    });
    for (const key of Object.keys(item)) {
      const val = item[key];
      if (
        val &&
        typeof val === "object" &&
        val.logic &&
        typeof val.logic === "object" &&
        !Array.isArray(val.logic) &&
        !val.conditions
      ) {
        eachLogicInstance(val.logic, fn, {
          kind: "holder",
          group: node,
          idx,
        });
      }
    }
  }
}

function hasLogicId(root, id) {
  let found = false;
  eachLogicInstance(
    root,
    (instance) => {
      if (instance._id === id) found = true;
    },
    null,
  );
  return found;
}

export function findItemLocation(root, id) {
  let found = null;
  eachLogicInstance(
    root,
    (instance, parentOf) => {
      if (found) return;
      for (let idx = 0; idx < instance.items.length; idx++) {
        const e = instance.items[idx];
        if (!e || typeof e !== "object") continue;
        if (
          (e._id != null && e._id === id) ||
          (e.logic && e.logic._id != null && e.logic._id === id)
        ) {
          found = { group: instance, idx, parentOf };
          return;
        }
      }
    },
    null,
  );
  return found;
}

export function moveLogicItem(sourceId, targetGroupId, insertIdx) {
  const root = getRootLogic();
  const src = findItemLocation(root, sourceId);
  if (!src) return null;
  const entry = src.group.items[src.idx];
  let cycle = false;
  if (entry.logic) {
    eachLogicInstance(
      entry.logic,
      (instance) => {
        if (instance._id === targetGroupId) cycle = true;
      },
      null,
    );
  }
  if (cycle) return null;
  const removed = findAndReplace(root, src.group._id, (n) => ({
    ...n,
    items: n.items.filter((_, i) => i !== src.idx),
  }));
  if (!hasLogicId(removed, targetGroupId)) return null;
  const final = findAndReplace(removed, targetGroupId, (n) => {
    const items = [...n.items];
    const at = Math.min(Math.max(insertIdx, 0), items.length);
    items.splice(at, 0, entry);
    return { ...n, items };
  });
  if (src.group._id === targetGroupId && insertIdx === src.idx) {
    return { ok: true, unchanged: true };
  }
  getTargetStore().set(final);
  bumpConditionStructureVersion();
  return { ok: true, unchanged: false };
}

function stripPrivate(value) {
  if (Array.isArray(value)) return value.map(stripPrivate);
  if (!value || typeof value !== "object") return value;
  const out = {};
  for (const key of Object.keys(value)) {
    if (key.startsWith("_")) continue;
    out[key] = stripPrivate(value[key]);
  }
  return out;
}

function logicToFilter(lg) {
  return {
    logic: {
      op: lg.op,
      items: lg.items.map((item) => {
        if (item.logic) return logicToFilter(item.logic);
        return stripPrivate(item);
      }),
    },
  };
}

function purgeNode(node, exempt = null) {
  const newItems = [];
  let changed = false;
  for (let idx = 0; idx < node.items.length; idx++) {
    const item = node.items[idx];
    if (item._pendingDelete) {
      const id = item.logic
        ? `group:${item.logic._id}`
        : `leaf:${node._id}:${idx}`;
      if (id === exempt) {
        newItems.push(item);
        continue;
      }
      changed = true;
      continue;
    }
    const newItem = { ...item };
    let itemChanged = false;
    if (
      item.logic &&
      typeof item.logic === "object" &&
      !Array.isArray(item.logic)
    ) {
      const updated = purgeNode(item.logic, exempt);
      if (updated !== item.logic) {
        newItem.logic = updated;
        itemChanged = true;
      }
    }
    forEachCondArray(item, (conds, key, condKey) => {
      const newConds = [];
      let condChanged = false;
      for (const c of conds) {
        if (c._pendingDelete) {
          condChanged = true;
          continue;
        }
        if (c.logic) {
          const updated = purgeNode(c.logic, exempt);
          if (updated !== c.logic) {
            newConds.push({ ...c, logic: updated });
            condChanged = true;
            continue;
          }
        }
        newConds.push(c);
      }
      if (condChanged) {
        newItem[key] = { ...item[key], [condKey]: newConds };
        itemChanged = true;
      }
    });
    let dropItem = false;
    for (const key of Object.keys(item)) {
      const val = item[key];
      if (
        val &&
        typeof val === "object" &&
        val.logic &&
        typeof val.logic === "object" &&
        !Array.isArray(val.logic) &&
        !val.conditions
      ) {
        if (val._pendingDelete) {
          dropItem = true;
          break;
        }
        const updated = purgeNode(val.logic, exempt);
        if (updated !== val.logic) {
          newItem[key] = { ...val, logic: updated };
          itemChanged = true;
        }
      }
    }
    if (dropItem) {
      changed = true;
      continue;
    }
    newItems.push(itemChanged ? newItem : item);
    if (itemChanged) changed = true;
  }
  return changed ? { ...node, items: newItems } : node;
}

function mutateGroupWrapper(node, groupId, mutator) {
  const newItems = [];
  let changed = false;
  for (const item of node.items) {
    if (item.logic && item.logic._id === groupId) {
      newItems.push(mutator(item));
      changed = true;
      continue;
    }
    if (
      item.logic &&
      typeof item.logic === "object" &&
      !Array.isArray(item.logic)
    ) {
      const updated = mutateGroupWrapper(item.logic, groupId, mutator);
      if (updated !== item.logic) {
        newItems.push({ ...item, logic: updated });
        changed = true;
        continue;
      }
    }
    let found = false;
    forEachCondArray(item, (conds, key, condKey) => {
      if (found) return;
      const newConds = [];
      let condChanged = false;
      for (const c of conds) {
        if (c.logic) {
          const updated = mutateGroupWrapper(c.logic, groupId, mutator);
          if (updated !== c.logic) {
            condChanged = true;
            newConds.push({ logic: updated });
            continue;
          }
        }
        newConds.push(c);
      }
      if (condChanged) {
        newItems.push({
          ...item,
          [key]: { ...item[key], [condKey]: newConds },
        });
        found = true;
        changed = true;
      }
    });
    if (!found) {
      for (const key of Object.keys(item)) {
        if (found) break;
        const val = item[key];
        if (
          val?.logic &&
          typeof val.logic === "object" &&
          !Array.isArray(val.logic) &&
          !val.conditions
        ) {
          if (val.logic._id === groupId) {
            newItems.push({ ...item, [key]: mutator(val) });
            found = true;
            changed = true;
            break;
          }
          const updated = mutateGroupWrapper(val.logic, groupId, mutator);
          if (updated !== val.logic) {
            newItems.push({ ...item, [key]: { ...val, logic: updated } });
            found = true;
            changed = true;
          }
        }
      }
    }
    if (!found) newItems.push(item);
  }
  return changed ? { ...node, items: newItems } : node;
}

function markGroupWrapperPendingDelete(node, groupId) {
  return mutateGroupWrapper(node, groupId, (item) => ({
    ...item,
    _pendingDelete: true,
  }));
}

function unmarkGroupWrapperPendingDelete(node, groupId) {
  return mutateGroupWrapper(node, groupId, (item) => {
    const rest = { ...item };
    delete rest._pendingDelete;
    return rest;
  });
}

export function purgeLogicPendingDeletes(exempt = null) {
  const root = getRootLogic();
  const purged = purgeNode(root, exempt);
  if (purged !== root) {
    getTargetStore().set(purged);
  }
}

export function getFiltersForAPI() {
  const root = purgeNode(getRootLogic());
  if (root.items.length === 0) return [];
  return [logicToFilter(root)];
}

function createEmptyCondition(type) {
  switch (type) {
    case "field":
      return { field: { field: "", operator: "contains", value: "" } };
    case "tag":
      return { tag: { operator: "contains", value: "", negate: false } };
    case "meta_tag":
      return { meta_tag: { operator: "contains", value: "", negate: false } };
    case "global":
      return { global: { operator: "contains", value: "" } };
    case "type":
      return { type: { value: "" } };
    case "relation":
      return {
        relation: {
          type: "",
          mode: "any",
          conditions: [{ logic: newLogicGroup("and") }],
        },
      };
    case "person_relation":
      return {
        person_relation: {
          type: "",
          mode: "any",
          conditions: [{ logic: newLogicGroup("and") }],
        },
      };
    case "character_relation":
      return {
        character_relation: {
          type: "",
          mode: "any",
          conditions: [{ logic: newLogicGroup("and") }],
        },
      };
    case "character":
      return {
        character: {
          type: "",
          mode: "any",
          conditions: [{ logic: newLogicGroup("and") }],
        },
      };
    case "person_character":
      return {
        person_character: {
          type: "",
          mode: "any",
          subject_mode: "any",
          conditions: [{ logic: newLogicGroup("and") }],
          subject_conditions: [{ logic: newLogicGroup("and") }],
        },
      };
    case "character_person":
      return {
        character_person: {
          type: "",
          mode: "any",
          subject_mode: "any",
          conditions: [{ logic: newLogicGroup("and") }],
          subject_conditions: [{ logic: newLogicGroup("and") }],
        },
      };
    case "person_cast_subject":
      return {
        person_cast_subject: {
          type: "",
          mode: "any",
          character_mode: "any",
          conditions: [{ logic: newLogicGroup("and") }],
          character_conditions: [{ logic: newLogicGroup("and") }],
        },
      };
    case "subject_cast":
      return {
        subject_cast: {
          type: "",
          mode: "any",
          person_conditions: [{ logic: newLogicGroup("and") }],
          character_conditions: [{ logic: newLogicGroup("and") }],
        },
      };
    case "appear_eps":
      return {
        field: { field: "appear_eps", operator: "contains", value: "" },
      };
    case "staff":
      return {
        staff: {
          position: "",
          positions: [],
          mode: "any",
          conditions: [{ logic: newLogicGroup("and") }],
        },
      };
    case "episode":
      return { episode: { mode: "any", logic: newLogicGroup("and") } };
    default:
      return { field: { field: "", operator: "contains", value: "" } };
  }
}

// Clone the tree path to `targetId`, applying `mutator` to the target group's new items array.
// Returns a new root with new references at every level — Svelte detects the change.
function updateGroupInTree(node, targetId, mutator) {
  return findAndReplace(node, targetId, (n) => ({
    ...n,
    items: mutator([...n.items]),
  }));
}

function applyMutation(targetGroupId, mutator) {
  getTargetStore().update((root) =>
    updateGroupInTree(root, targetGroupId, mutator),
  );
}

function addToGroup(group, filter) {
  const stamped = filter.logic
    ? filter
    : { ...filter, _id: incLogicIdCounter() };
  applyMutation(group._id, (items) => {
    items.push(stamped);
    return items;
  });
}

// Default operator for episode fields
const EP_FIELD_DEFAULT_OP = {
  airdate: "before",
  sort: "gte",
  type: "eq",
  disc: "gte",
  episode_id: "eq",
};

export function addCondition(group, type, ctx) {
  if (type.startsWith("ep_")) {
    const fieldName = type.slice(3);
    const fc = EPISODE_FIELD_CONFIGS[fieldName];
    if (fc) {
      const val = fc.type === "select" ? fc.options?.[0]?.[0] || "" : "";
      addToGroup(group, {
        field: {
          field: fieldName,
          operator: fc.ops[0],
          value: val,
          _special: true,
        },
      });
    } else {
      const op = EP_FIELD_DEFAULT_OP[fieldName] || "contains";
      addToGroup(group, {
        field: { field: fieldName, operator: op, value: "" },
      });
    }
  } else {
    ctx = ctx || group._ctx || "subject";
    const fc = ctxFieldConfigs(ctx)[type];
    if (fc) {
      const val = fc.type === "select" ? fc.options?.[0]?.[0] || "" : "";
      addToGroup(group, {
        field: { field: type, operator: fc.ops[0], value: val, _special: true },
      });
    } else {
      addToGroup(group, createEmptyCondition(type));
    }
  }
  bumpConditionStructureVersion();
  focusRequest.set({ groupId: group._id, isGroup: false });
}

export function removeLogicGroup(groupId) {
  setPendingDeleteExempt(`group:${groupId}`);
  announce("已删除条件组");
  getTargetStore().update((root) =>
    markGroupWrapperPendingDelete(root, groupId),
  );
  bumpConditionStructureVersion();
}

export function undoLogicGroupDelete(groupId) {
  getTargetStore().update((root) =>
    unmarkGroupWrapperPendingDelete(root, groupId),
  );
}

export function removeLogicLeaf(group, idx) {
  setPendingDeleteExempt(`leaf:${group._id}:${idx}`);
  announce("已删除条件");
  applyMutation(group._id, (items) => {
    items[idx] = { ...items[idx], _pendingDelete: true };
    return items;
  });
  bumpConditionStructureVersion();
}

export function undoLogicLeafDelete(group, idx) {
  applyMutation(group._id, (items) => {
    const rest = { ...items[idx] };
    delete rest._pendingDelete;
    items[idx] = rest;
    return items;
  });
}

export function addLogicGroupTo(group) {
  const ng = newLogicGroup(group.op === "and" ? "or" : "and");
  applyMutation(group._id, (items) => {
    items.push({ _id: ng._id, logic: ng });
    return items;
  });
  bumpConditionStructureVersion();
  focusRequest.set({ groupId: group._id, isGroup: true });
}

export function toggleLogicOp(group, val) {
  getTargetStore().update((root) =>
    findAndReplace(root, group._id, (n) => ({ ...n, op: val })),
  );
}

export function updateStaffPositions(group, idx, parts) {
  applyMutation(group._id, (items) => {
    const oldItem = items[idx];
    const oldTarget = oldItem.staff || {};
    const updated = {
      ...oldTarget,
      position: parts[0] || "",
      positions: parts,
    };
    items[idx] = { ...oldItem, staff: updated };
    return items;
  });
}

export function updateCondition(group, idx, kind, field, value) {
  if (!group || !group.items[idx]) return;
  const oldItem = group.items[idx];
  const oldTarget = oldItem[kind];
  if (!oldTarget || typeof oldTarget !== "object") return;
  // Create new item with updated field — immutable so Svelte detects the change
  const updated = { ...oldTarget, [field]: value };
  // When switching to "count" mode, initialize count_op/count_val defaults
  if (field === "mode" && value === "count") {
    if (!updated.count_op) updated.count_op = "gte";
    if (!updated.count_val) updated.count_val = "";
  }
  // When switching subject_mode to "count", initialize subject_count_op/subject_count_val defaults
  if (field === "subject_mode" && value === "count") {
    if (!updated.subject_count_op) updated.subject_count_op = "gte";
    if (!updated.subject_count_val) updated.subject_count_val = "";
  }
  // When switching character_mode to "count", initialize character_count_op/character_count_val defaults
  if (field === "character_mode" && value === "count") {
    if (!updated.character_count_op) updated.character_count_op = "gte";
    if (!updated.character_count_val) updated.character_count_val = "";
  }
  const newItem = { ...oldItem, [kind]: updated };
  applyMutation(group._id, (items) => {
    items[idx] = newItem;
    return items;
  });
}

export function applyFiltersFromAPI(apiFilters) {
  resetLogicIdCounter();
  let newRoot;
  if (apiFilters.length === 1 && apiFilters[0].logic) {
    newRoot = apiFilters[0].logic;
  } else {
    newRoot = { op: "and", items: apiFilters };
  }
  ensureLogicIds(newRoot);
  getTargetStore().set(newRoot);
}
