<script>
  import { CTX_CHARACTER, CTX_PERSON, CTX_SUBJECT, opLabel } from "@/stores.js";
  import { removeLogicLeaf, updateCondition } from "@/logic-tree.js";
  import { CHARACTER_ASSOC_TYPES, PERSON_CHAR_TYPES } from "@/schema-data.js";
  import FilterTree from "../FilterTree.svelte";
  import AwesompleteInput from "../AwesompleteInput.svelte";
  import { MorphIcon } from "morphicons/svelte";
  import { X } from "lucide";

  let { item, group, idx, condType, handle } = $props();
</script>

{#if condType === "person_character" || condType === "character_person"}
  {@const ca = item[condType]}
  {@const caCfg =
    condType === "person_character"
      ? {
          label: "角色",
          condLabel: "角色条件",
          condCtx: CTX_CHARACTER,
        }
      : {
          label: "人物",
          condLabel: "人物条件",
          condCtx: CTX_PERSON,
        }}
  <div class="cond-row-inner" role="group" aria-label={caCfg.label}>
    {@render handle()}
    <span class="cond-type" id={`rowtitle-${group._id}-${idx}`}
      >{caCfg.label}</span
    >
    <AwesompleteInput
      restrict={true}
      value={ca.type || ""}
      suggestions={["任意"].concat(PERSON_CHAR_TYPES)}
      onchange={(v) => updateCondition(group, idx, condType, "type", v)}
      placeholder="出演类型"
    />
    <select
      class="select"
      value={ca.mode}
      aria-label="限定方式"
      onchange={(e) =>
        updateCondition(group, idx, condType, "mode", e.target.value)}
    >
      <option value="any">任意</option>
      <option value="all">全部</option>
      <option value="none">排除</option>
      <option value="count">数量</option>
    </select>
    {#if ca.mode === "count"}
      <select
        class="select"
        value={ca.count_op || "gte"}
        aria-label="比较方式"
        onchange={(e) =>
          updateCondition(group, idx, condType, "count_op", e.target.value)}
      >
        {#each ["gt", "gte", "lt", "lte", "eq"] as op (op)}
          <option value={op}>{opLabel(op)}</option>
        {/each}
      </select>
      <input
        class="input"
        type="number"
        value={ca.count_val || ""}
        aria-label="数量"
        onchange={(e) =>
          updateCondition(group, idx, condType, "count_val", e.target.value)}
      />
    {/if}
    <button
      class="tag-remove"
      onclick={() => removeLogicLeaf(group, idx)}
      title="删除"
      aria-label={`删除${caCfg.label}条件`}
      ><MorphIcon icon={X} size={14} /></button
    >
    {#if ca.conditions?.length > 0 && ca.conditions[0].logic}
      <div class="nested">
        <span class="cond-type">{caCfg.condLabel}</span>
        <FilterTree
          lg={ca.conditions[0].logic}
          isRoot={false}
          ctx={caCfg.condCtx}
          hideDelete={true}
        />
      </div>
    {/if}
    {#if ca.subject_conditions?.length > 0 && ca.subject_conditions[0].logic}
      <div class="nested">
        <div class="mode-row">
          <span class="cond-type">相关条目</span>
          <select
            class="select"
            value={ca.subject_mode || "any"}
            aria-label="主条目限定方式"
            onchange={(e) =>
              updateCondition(
                group,
                idx,
                condType,
                "subject_mode",
                e.target.value,
              )}
          >
            <option value="any">任意</option>
            <option value="all">全部</option>
            <option value="count">数量</option>
          </select>
          {#if (ca.subject_mode || "any") === "count"}
            <select
              class="select"
              value={ca.subject_count_op || "gte"}
              aria-label="比较方式"
              onchange={(e) =>
                updateCondition(
                  group,
                  idx,
                  condType,
                  "subject_count_op",
                  e.target.value,
                )}
            >
              {#each ["gt", "gte", "lt", "lte", "eq"] as op (op)}
                <option value={op}>{opLabel(op)}</option>
              {/each}
            </select>
            <input
              class="input"
              type="number"
              value={ca.subject_count_val || ""}
              aria-label="主条目数量"
              onchange={(e) =>
                updateCondition(
                  group,
                  idx,
                  condType,
                  "subject_count_val",
                  e.target.value,
                )}
            />
          {/if}
        </div>
        <FilterTree
          lg={ca.subject_conditions[0].logic}
          isRoot={false}
          ctx={CTX_SUBJECT}
          hideDelete={true}
        />
      </div>
    {/if}
  </div>
{:else if condType === "person_cast_subject"}
  {@const pcs = item.person_cast_subject}
  <div class="cond-row-inner" role="group" aria-label="出演作品">
    {@render handle()}
    <span class="cond-type" id={`rowtitle-${group._id}-${idx}`}>出演作品</span>
    <AwesompleteInput
      restrict={true}
      value={pcs.type || ""}
      suggestions={["任意"].concat(PERSON_CHAR_TYPES)}
      onchange={(v) => updateCondition(group, idx, condType, "type", v)}
      placeholder="出演类型"
    />
    <select
      class="select"
      value={pcs.mode}
      aria-label="限定方式"
      onchange={(e) =>
        updateCondition(group, idx, condType, "mode", e.target.value)}
    >
      <option value="any">任意</option>
      <option value="all">全部</option>
      <option value="none">排除</option>
      <option value="count">数量</option>
    </select>
    {#if pcs.mode === "count"}
      <select
        class="select"
        value={pcs.count_op || "gte"}
        aria-label="比较方式"
        onchange={(e) =>
          updateCondition(group, idx, condType, "count_op", e.target.value)}
      >
        {#each ["gt", "gte", "lt", "lte", "eq"] as op (op)}
          <option value={op}>{opLabel(op)}</option>
        {/each}
      </select>
      <input
        class="input"
        type="number"
        value={pcs.count_val || ""}
        aria-label="数量"
        onchange={(e) =>
          updateCondition(group, idx, condType, "count_val", e.target.value)}
      />
    {/if}
    <button
      class="tag-remove"
      onclick={() => removeLogicLeaf(group, idx)}
      title="删除"
      aria-label="删除出演作品条件"><MorphIcon icon={X} size={14} /></button
    >
    {#if pcs.conditions?.length > 0 && pcs.conditions[0].logic}
      <div class="nested">
        <span class="cond-type">作品条件</span>
        <FilterTree
          lg={pcs.conditions[0].logic}
          isRoot={false}
          ctx={CTX_SUBJECT}
          hideDelete={true}
        />
      </div>
    {/if}
    {#if pcs.character_conditions?.length > 0 && pcs.character_conditions[0].logic}
      <div class="nested">
        <div class="mode-row">
          <span class="cond-type">相关角色</span>
          <select
            class="select"
            value={pcs.character_mode || "any"}
            aria-label="角色限定方式"
            onchange={(e) =>
              updateCondition(
                group,
                idx,
                condType,
                "character_mode",
                e.target.value,
              )}
          >
            <option value="any">任意</option>
            <option value="all">全部</option>
            <option value="count">数量</option>
          </select>
          {#if (pcs.character_mode || "any") === "count"}
            <select
              class="select"
              value={pcs.character_count_op || "gte"}
              aria-label="比较方式"
              onchange={(e) =>
                updateCondition(
                  group,
                  idx,
                  condType,
                  "character_count_op",
                  e.target.value,
                )}
            >
              {#each ["gt", "gte", "lt", "lte", "eq"] as op (op)}
                <option value={op}>{opLabel(op)}</option>
              {/each}
            </select>
            <input
              class="input"
              type="number"
              value={pcs.character_count_val || ""}
              aria-label="角色数量"
              onchange={(e) =>
                updateCondition(
                  group,
                  idx,
                  condType,
                  "character_count_val",
                  e.target.value,
                )}
            />
          {/if}
        </div>
        <FilterTree
          lg={pcs.character_conditions[0].logic}
          isRoot={false}
          ctx={CTX_CHARACTER}
          hideDelete={true}
        />
      </div>
    {/if}
  </div>
{:else if condType === "subject_cast"}
  {@const sc = item.subject_cast}
  <div class="cond-row-inner" role="group" aria-label="出演">
    {@render handle()}
    <span class="cond-type" id={`rowtitle-${group._id}-${idx}`}>出演</span>
    <AwesompleteInput
      restrict={true}
      value={sc.type || ""}
      suggestions={["任意"].concat(CHARACTER_ASSOC_TYPES)}
      onchange={(v) => updateCondition(group, idx, condType, "type", v)}
      placeholder="角色类型"
    />
    <select
      class="select"
      value={sc.mode}
      aria-label="限定方式"
      onchange={(e) =>
        updateCondition(group, idx, condType, "mode", e.target.value)}
    >
      <option value="any">任意</option>
      <option value="all">全部</option>
      <option value="none">排除</option>
      <option value="count">数量</option>
    </select>
    {#if sc.mode === "count"}
      <select
        class="select"
        value={sc.count_op || "gte"}
        aria-label="比较方式"
        onchange={(e) =>
          updateCondition(group, idx, condType, "count_op", e.target.value)}
      >
        {#each ["gt", "gte", "lt", "lte", "eq"] as op (op)}
          <option value={op}>{opLabel(op)}</option>
        {/each}
      </select>
      <input
        class="input"
        type="number"
        value={sc.count_val || ""}
        aria-label="数量"
        onchange={(e) =>
          updateCondition(group, idx, condType, "count_val", e.target.value)}
      />
    {/if}
    <button
      class="tag-remove"
      onclick={() => removeLogicLeaf(group, idx)}
      title="删除"
      aria-label="删除出演条件"><MorphIcon icon={X} size={14} /></button
    >
    {#if sc.person_conditions?.length > 0 && sc.person_conditions[0].logic}
      <div class="nested">
        <span class="cond-type">人物条件</span>
        <FilterTree
          lg={sc.person_conditions[0].logic}
          isRoot={false}
          ctx={CTX_PERSON}
          hideDelete={true}
        />
      </div>
    {/if}
    {#if sc.character_conditions?.length > 0 && sc.character_conditions[0].logic}
      <div class="nested">
        <span class="cond-type">角色条件</span>
        <FilterTree
          lg={sc.character_conditions[0].logic}
          isRoot={false}
          ctx={CTX_CHARACTER}
          hideDelete={true}
        />
      </div>
    {/if}
  </div>
{/if}

<style>
  .mode-row {
    display: flex;
    align-items: center;
    gap: 4px;
    margin-bottom: 2px;
  }
</style>
