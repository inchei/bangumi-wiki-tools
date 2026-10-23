<script>
  import {
    ctxFieldConfigs,
    fieldSelectOptions,
    opLabel,
    opInputType,
    ctxFields,
    CTX_SUBJECT,
    CTX_EPISODE,
    EPISODE_FIELD_LABELS,
    CAREER_OPTIONS,
  } from "@/stores.js";
  import { updateCondition } from "@/logic-tree.js";
  import { subjectFieldSuggestions } from "@/columns.js";
  import AwesompleteInput from "../AwesompleteInput.svelte";

  let { item, group, idx, ctx, subjectType } = $props();

  const fc = $derived(
    item.field._special ? ctxFieldConfigs(ctx)[item.field.field] || null : null,
  );
  const isEpCtx = $derived(ctx === CTX_EPISODE);
  const availOps = $derived(
    fc
      ? fc.ops
      : [
          "contains",
          "not_contains",
          "eq",
          "regex",
          "not_regex",
          "gt",
          "lt",
          "gte",
          "lte",
          "before",
          "after",
          "empty",
        ],
  );
  const fieldSuggestions = $derived(
    ctx === CTX_SUBJECT ? subjectFieldSuggestions(subjectType) : ctxFields(ctx),
  );
  const valueAriaByOp = {
    before: "日期",
    after: "日期",
    gt: "数量",
    gte: "数量",
    lt: "数量",
    lte: "数量",
    eq: "字段值",
    regex: "正则表达式",
    not_regex: "正则表达式",
  };
  const selectOpts = $derived(
    fc && fc.type === "select" ? fieldSelectOptions(fc, subjectType) : [],
  );
</script>

{#if fc}
  <span class="cond-type" id={`rowtitle-${group._id}-${idx}`}>{fc.label}</span>
{:else if isEpCtx}
  <span class="cond-type" id={`rowtitle-${group._id}-${idx}`}
    >{EPISODE_FIELD_LABELS[item.field.field] || item.field.field}</span
  >
{:else}
  <span class="cond-type" id={`rowtitle-${group._id}-${idx}`}>字段</span>
  <AwesompleteInput
    value={item.field.field}
    suggestions={fieldSuggestions}
    sort={false}
    onchange={(v) => updateCondition(group, idx, "field", "field", v)}
    oninput={(v) => updateCondition(group, idx, "field", "field", v)}
    placeholder="字段名"
  />
{/if}

{#if availOps.length > 1}
  <select
    class="select"
    value={item.field.operator}
    aria-label="匹配方式"
    onchange={(e) =>
      updateCondition(group, idx, "field", "operator", e.target.value)}
  >
    {#each availOps as op (op)}
      <option value={op}>{opLabel(op)}</option>
    {/each}
  </select>
{/if}

{#if item.field.operator !== "empty"}
  {#if fc && fc.type === "select" && fc.dynamic === "platform"}
    <AwesompleteInput
      value={selectOpts.find(
        (opt) => opt[0] === String(item.field.value || ""),
      )?.[1] || ""}
      suggestions={selectOpts.map((opt) => opt[1])}
      restrict={true}
      sort={false}
      onchange={(label) => {
        const code = selectOpts.find((opt) => opt[1] === label)?.[0] ?? "";
        updateCondition(group, idx, "field", "value", code);
      }}
      placeholder="子类型"
    />
  {:else if fc && fc.type === "select" && fc.dynamic !== "platform"}
    <span class="radio-group" role="radiogroup" aria-label={fc.label}>
      {#each selectOpts as [v, l] (v)}
        <label class="radio-pill" class:active={v === String(item.field.value)}>
          <input
            class="sr-radio"
            type="radio"
            name="field-{group._id}-{idx}"
            value={v}
            checked={v === String(item.field.value)}
            onchange={() => updateCondition(group, idx, "field", "value", v)}
          />{l}</label
        >
      {/each}
    </span>
  {:else if fc?.ac === "career"}
    <AwesompleteInput
      value={CAREER_OPTIONS.find((opt) => opt[0] === item.field.value)?.[1] ||
        ""}
      suggestions={CAREER_OPTIONS.map((opt) => opt[1])}
      restrict={true}
      onchange={(label) => {
        const code = CAREER_OPTIONS.find((opt) => opt[1] === label)?.[0] ?? "";
        updateCondition(group, idx, "field", "value", code);
      }}
      placeholder="职业"
    />
  {:else}
    {@const isRef =
      typeof item.field.value === "string" && item.field.value.startsWith("$")}
    <input
      class="input"
      class:input-ref={isRef}
      type={isRef
        ? "text"
        : fc
          ? fc.type || "text"
          : opInputType(item.field.operator)}
      aria-label={isRef
        ? "字段值"
        : (valueAriaByOp[item.field.operator] ?? "关键字")}
      value={item.field.value || ""}
      onchange={(e) =>
        updateCondition(group, idx, "field", "value", e.target.value)}
      placeholder={isEpCtx && item.field.field === "duration"
        ? "如: 24m / 00:23:30"
        : isRef
          ? "输入 $字段名 引用其他字段"
          : ""}
      step={fc?.step || undefined}
    />
  {/if}
{/if}

<style>
  .radio-group {
    display: inline-flex;
    flex-wrap: wrap;
    gap: 4px;
    min-width: 0;
  }

  :global(.input-ref) {
    background: var(--bg-alt);
    border-color: var(--accent-strong);
  }
</style>
