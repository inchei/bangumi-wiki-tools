<script>
  import { tick } from "svelte";
  import {
    subjectRootLogic,
    personRootLogic,
    characterRootLogic,
    episodeRootLogic,
    queryTarget,
    ctxFieldConfigs,
    CTX_SUBJECT,
    CTX_PERSON,
    CTX_STAFF_PERSON,
    CTX_CHARACTER,
    CTX_EPISODE,
    EPISODE_FIELDS,
    EPISODE_FIELD_LABELS,
    focusRequest,
    isPersonCtx,
  } from "../stores.js";
  import {
    toggleLogicOp,
    addCondition,
    addLogicGroupTo,
    removeLogicGroup,
    undoLogicGroupDelete,
  } from "../logic-tree.js";
  import ConditionRow from "./ConditionRow.svelte";
  import PendingDelete from "./PendingDelete.svelte";
  import Self from "./FilterTree.svelte";
  import { MorphIcon } from "morphicons/svelte";
  import { X } from "lucide";

  /** @type {{ lg?: object, isRoot?: boolean, ctx?: string, hideDelete?: boolean }} */
  let {
    lg = undefined,
    isRoot = true,
    ctx = CTX_SUBJECT,
    hideDelete = false,
  } = $props();

  const effectiveCtx = $derived(
    isRoot
      ? $queryTarget === "person"
        ? CTX_PERSON
        : $queryTarget === "character"
          ? CTX_CHARACTER
          : $queryTarget === "episode"
            ? CTX_EPISODE
            : CTX_SUBJECT
      : ctx,
  );
  const logic = $derived(
    lg ||
      ($queryTarget === "person"
        ? $personRootLogic
        : $queryTarget === "character"
          ? $characterRootLogic
          : $queryTarget === "episode"
            ? $episodeRootLogic
            : $subjectRootLogic),
  );

  let containerEl;
  // Per-context state for the "add condition" dropdown (nested FilterTrees
  // for relation/staff subject_conditions use a different ctx than the root)
  let newTypeSelectMap = $state({
    [CTX_SUBJECT]: "field",
    [CTX_PERSON]: "field",
    [CTX_STAFF_PERSON]: "field",
    [CTX_CHARACTER]: "field",
    [CTX_EPISODE]: "field",
  });
  let newTypeSelect = $derived(newTypeSelectMap[effectiveCtx] || "field");
  function setNewTypeSelect(val) {
    newTypeSelectMap[effectiveCtx] = val;
  }

  // Reset newTypeSelect when options change and current value is no longer valid
  const typeOptions = $derived(getNewTypeOptions(effectiveCtx, $queryTarget));
  $effect(() => {
    if (!typeOptions.some((opt) => opt.value === newTypeSelect)) {
      newTypeSelectMap[$queryTarget] = typeOptions[0]?.value || "field";
    }
  });

  $effect(() => {
    const req = $focusRequest;
    if (!req || req.groupId !== logic._id || !containerEl) return;
    tick().then(() => {
      if (req.isGroup) {
        // Nested group added — focus first focusable in the last .logic-group child
        const groups = containerEl.querySelectorAll(":scope > .logic-group");
        const lastGroup = groups[groups.length - 1];
        if (lastGroup)
          lastGroup
            .querySelector(
              'button, [href], input, select, [tabindex]:not([tabindex="-1"])',
            )
            ?.focus();
      } else {
        // Condition added — focus first input in the last .cond-row
        const rows = containerEl.querySelectorAll(":scope > .cond-row");
        const lastRow = rows[rows.length - 1];
        if (lastRow)
          lastRow
            .querySelector(
              'input, select, button, [tabindex]:not([tabindex="-1"])',
            )
            ?.focus();
      }
      focusRequest.set(null);
    });
  });

  function handleAdd(e) {
    e.stopPropagation();
    addCondition(logic, newTypeSelect, effectiveCtx);
  }
  function handleAddGroup(e) {
    e.stopPropagation();
    addLogicGroupTo(logic);
  }

  function getNewTypeOptions(currentCtx, qTarget) {
    const opts = [];
    if (currentCtx === CTX_EPISODE) {
      // Episode fields, both as primary target and as nested context (inside subject query)
      for (const f of EPISODE_FIELDS)
        opts.push({ value: "ep_" + f, label: EPISODE_FIELD_LABELS[f] });
    } else if (currentCtx === CTX_CHARACTER) {
      opts.push({ value: "field", label: "字段" });
      opts.push({ value: "global", label: "全局" });
      const cfc = ctxFieldConfigs(CTX_CHARACTER);
      for (const k in cfc) opts.push({ value: k, label: cfc[k].label });
      if (qTarget === "character") {
        opts.push({ value: "character_relation", label: "角色关系" });
        opts.push({ value: "character_person", label: "人物" });
        opts.push({ value: "character", label: "条目" });
      }
    } else if (isPersonCtx(currentCtx)) {
      opts.push({ value: "field", label: "字段" });
      opts.push({ value: "global", label: "全局" });
      const pfc = ctxFieldConfigs(CTX_PERSON);
      for (const k in pfc) opts.push({ value: k, label: pfc[k].label });
      if (currentCtx === CTX_STAFF_PERSON) {
        opts.push({ value: "appear_eps", label: "参与" });
      }
      if (qTarget === "person") {
        opts.push({ value: "person_relation", label: "人物关系" });
        opts.push({ value: "person_character", label: "角色" });
        opts.push({ value: "person_cast_subject", label: "出演作品" });
      }
      opts.push({ value: "staff", label: "条目" });
    } else {
      opts.push({ value: "field", label: "字段" });
      const fc = ctxFieldConfigs(effectiveCtx);
      for (const k in fc) opts.push({ value: k, label: fc[k].label });
      opts.push({ value: "tag", label: "标签" });
      opts.push({ value: "meta_tag", label: "公共标签" });
      opts.push({ value: "global", label: "全局" });
      if (qTarget === "subject") {
        opts.push({ value: "relation", label: "条目关系" });
        opts.push({ value: "character", label: "角色" });
        opts.push({ value: "episode", label: "剧集" });
        opts.push({ value: "subject_cast", label: "出演" });
      }
      opts.push({
        value: "staff",
        label: qTarget === "person" ? "条目" : "人物",
      });
    }
    return opts;
  }
</script>

<div
  class="logic-group"
  class:root={isRoot}
  bind:this={containerEl}
  role="group"
  aria-label="条件组"
>
  <div class="logic-header">
    <div class="logic-op-toggle" role="radiogroup" aria-label="条件逻辑">
      <label class="op-btn" class:active={logic.op === "and"}>
        <input
          class="sr-radio"
          type="radio"
          name="op-{logic._id}"
          value="and"
          checked={logic.op === "and"}
          onclick={(e) => {
            e.stopPropagation();
            toggleLogicOp(logic, "and");
          }}
        />AND</label
      >
      <label class="op-btn" class:active={logic.op === "or"}>
        <input
          class="sr-radio"
          type="radio"
          name="op-{logic._id}"
          value="or"
          checked={logic.op === "or"}
          onclick={(e) => {
            e.stopPropagation();
            toggleLogicOp(logic, "or");
          }}
        />OR</label
      >
    </div>
    {#if !isRoot && !hideDelete}
      <button
        class="tag-remove"
        onclick={(e) => {
          e.stopPropagation();
          removeLogicGroup(logic._id);
        }}
        title="删除此组"
        aria-label="删除此组"><MorphIcon icon={X} size={14} /></button
      >
    {/if}
  </div>

  {#each logic.items as item, i (item.logic?._id ?? i)}
    {#if item._pendingDelete && item.logic}
      <PendingDelete
        label="已删除条件组"
        margin="2px 0"
        focusOnMount={true}
        onUndo={() => undoLogicGroupDelete(item.logic._id)}
      />
    {:else if item.logic}
      <Self
        lg={item.logic}
        isRoot={false}
        ctx={item.logic._ctx || effectiveCtx}
      />
    {:else}
      <ConditionRow {item} group={logic} idx={i} ctx={effectiveCtx} />
    {/if}
  {/each}

  <div class="add-row">
    <select
      class="select"
      value={newTypeSelect}
      aria-label="条件类型"
      onchange={(e) => setNewTypeSelect(e.target.value)}
    >
      {#each typeOptions as opt (opt.value)}
        <option value={opt.value}>{opt.label}</option>
      {/each}
    </select>
    <button class="btn btn-outline btn-xs" onclick={handleAdd}>+ 条件</button>
    <button class="btn btn-outline btn-xs" onclick={handleAddGroup}
      >+ 嵌套组</button
    >
  </div>
</div>

<style>
  .logic-group {
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 8px;
    margin: 2px 0;
    cursor: default;
    transition: border-color 0.15s;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .logic-group.root {
    cursor: default;
  }

  .logic-header {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 4px;
  }

  .logic-op-toggle {
    display: inline-flex;
    border: 1px solid var(--border);
    border-radius: 4px;
  }

  .op-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 1px 8px;
    font-size: 0.7rem;
    font-weight: 600;
    cursor: pointer;
    background: var(--bg);
    color: var(--text-secondary);
    transition: all 0.15s;
    border: none;
    font-family: inherit;
    min-height: 24px;
  }

  .op-btn:focus-within {
    outline: 2px solid var(--accent-strong);
    outline-offset: 1px;
  }

  .op-btn.active {
    background: var(--accent-strong);
    color: var(--on-accent-strong);
  }

  .add-row {
    display: flex;
    gap: 4px;
    align-items: center;
    margin-top: 4px;
    flex-wrap: wrap;
  }

  .tag-remove {
    margin-left: auto;
  }

  .logic-group :global(select),
  .logic-group :global(input.input) {
    field-sizing: content;
    width: auto;
    min-width: 40px;
    height: 36px;
    padding: 0 12px;
  }

  .logic-group :global(select) {
    padding-right: 30px !important;
  }
</style>
