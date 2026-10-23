<script>
  import { tick } from "svelte";
  import {
    sortRules,
    removeSortRule,
    undoSortRuleRemove,
    bumpSortStructureVersion,
  } from "../../stores.js";
  import AwesompleteInput from "../AwesompleteInput.svelte";
  import PendingDelete from "../PendingDelete.svelte";
  import { MorphIcon } from "morphicons/svelte";
  import { ArrowDownWideNarrow, ArrowDownNarrowWide, X } from "lucide";

  let { sortSuggestions, getSortTokenList } = $props();
  let containerEl = $state(null);

  async function addSortRule() {
    sortRules.update((rules) => [...rules, { field: "", direction: "asc" }]);
    bumpSortStructureVersion();
    await tick();
    const rows = containerEl.querySelectorAll(".sort-row");
    const last = rows[rows.length - 1];
    last?.querySelector("input")?.focus();
  }

  function undoSortRule(idx) {
    undoSortRuleRemove(idx);
  }

  function removeSortRuleLocal(idx) {
    removeSortRule(idx);
  }

  function updateSortField(idx, field) {
    sortRules.update((rules) => {
      const next = [...rules];
      next[idx] = { ...next[idx], field };
      return next;
    });
  }

  function toggleSortDirection(idx) {
    sortRules.update((rules) => {
      const next = [...rules];
      next[idx] = {
        ...next[idx],
        direction: next[idx].direction === "asc" ? "desc" : "asc",
      };
      return next;
    });
  }
</script>

<div class="form-group" bind:this={containerEl}>
  <span class="form-label">排序</span>
  {#each $sortRules as rule, i (i)}
    {#if rule._pendingDelete}
      <PendingDelete
        label="已删除排序"
        margin="0 0 6px 0"
        focusOnMount={true}
        onUndo={() => undoSortRule(i)}
      />
    {:else}
      <div class="sort-row">
        <div style="flex:1">
          <AwesompleteInput
            value={rule.field}
            suggestions={sortSuggestions}
            getTokenList={getSortTokenList}
            sort={false}
            maxItems={30}
            onchange={(v) => updateSortField(i, v)}
            oninput={(v) => updateSortField(i, v)}
            placeholder="字段名"
          />
        </div>
        <button
          class="btn btn-sm btn-default"
          onclick={() => toggleSortDirection(i)}
        >
          <MorphIcon
            icon={rule.direction === "asc"
              ? ArrowDownNarrowWide
              : ArrowDownWideNarrow}
            size={14}
          />
          {rule.direction === "asc" ? "升序" : "降序"}
        </button>
        <button
          class="tag-remove"
          onclick={() => removeSortRuleLocal(i)}
          title="删除"
          aria-label="删除排序"
        >
          <MorphIcon icon={X} size={14} />
        </button>
      </div>
    {/if}
  {/each}
  <button class="btn btn-outline btn-xs" onclick={addSortRule}>+ 排序</button>
</div>

<style>
  .sort-row {
    display: flex;
    gap: 6px;
    align-items: center;
    margin-bottom: 6px;
  }
</style>
