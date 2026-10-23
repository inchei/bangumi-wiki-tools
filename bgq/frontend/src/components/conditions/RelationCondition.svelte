<script>
  import { opLabel } from "@/stores.js";
  import { MorphIcon } from "morphicons/svelte";
  import { X } from "lucide";
  import FilterTree from "../FilterTree.svelte";
  import AwesompleteInput from "../AwesompleteInput.svelte";

  /**
   * @type {{
   *   label: string,
   *   typeValue?: string,
   *   typeSuggestions?: string[],
   *   onTypeChange?: (v: string) => void,
   *   mode: string,
   *   onModeChange: (v: string) => void,
   *   countOp?: string,
   *   onCountOpChange?: (v: string) => void,
   *   countVal?: string,
   *   onCountValChange?: (v: string) => void,
   *   onDelete: () => void,
   *   logic?: object,
   *   nestedCtx: string,
   * }}
   */
  let {
    label,
    typeValue = undefined,
    typeSuggestions = [],
    onTypeChange = undefined,
    mode,
    onModeChange,
    countOp = "gte",
    onCountOpChange = undefined,
    countVal = "",
    onCountValChange = undefined,
    onDelete,
    logic = undefined,
    nestedCtx,
    handle,
    children,
  } = $props();
</script>

<div class="cond-row-inner" role="group" aria-label={label}>
  {#if handle}{@render handle()}{/if}
  <span class="cond-type">{label}</span>
  {#if onTypeChange}
    <AwesompleteInput
      restrict={true}
      value={typeValue || ""}
      suggestions={typeSuggestions}
      sort={false}
      onchange={onTypeChange}
      placeholder="类型"
    />
  {/if}
  {@render children?.()}
  <select
    class="select"
    value={mode}
    aria-label="限定方式"
    onchange={(e) => onModeChange(e.target.value)}
  >
    <option value="any">任意</option>
    <option value="all">全部</option>
    <option value="none">排除</option>
    <option value="count">数量</option>
  </select>
  {#if mode === "count"}
    <select
      class="select"
      value={countOp || "gte"}
      aria-label="比较方式"
      onchange={(e) => onCountOpChange?.(e.target.value)}
    >
      {#each ["gt", "gte", "lt", "lte", "eq"] as op (op)}
        <option value={op}>{opLabel(op)}</option>
      {/each}
    </select>
    <input
      class="input"
      type="number"
      aria-label="数量"
      value={countVal || ""}
      onchange={(e) => onCountValChange?.(e.target.value)}
    />
  {/if}
  <button
    class="tag-remove"
    onclick={onDelete}
    title="删除"
    aria-label="删除条件"><MorphIcon icon={X} size={14} /></button
  >
  {#if logic?.conditions?.length > 0 && logic.conditions[0].logic}
    <div class="nested">
      <FilterTree
        lg={logic.conditions[0].logic}
        isRoot={false}
        ctx={nestedCtx}
        hideDelete={true}
      />
    </div>
  {/if}
</div>
