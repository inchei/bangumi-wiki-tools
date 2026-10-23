<script>
  import {
    queryTarget,
    subjectRootLogic,
    opLabel,
    CTX_SUBJECT,
    CTX_PERSON,
    CTX_STAFF_PERSON,
    CTX_CHARACTER,
    CTX_EPISODE,
    isPersonCtx,
  } from "../../stores.js";
  import {
    removeLogicLeaf,
    undoLogicLeafDelete,
    updateCondition,
    updateStaffPositions,
  } from "../../logic-tree.js";
  import {
    PERSON_RELATIONS,
    CHARACTER_RELATIONS,
    CHARACTER_ASSOC_TYPES,
  } from "../../schema-data.js";
  import {
    detectSubjectTypeCode,
    prioritizedRelations,
    prioritizedPositions,
    prioritizedMetaTags,
  } from "../../columns.js";
  import { getConditionKind, describeItem } from "../../dnd-model.js";
  import FilterTree from "../FilterTree.svelte";
  import AwesompleteInput from "../AwesompleteInput.svelte";
  import PendingDelete from "../PendingDelete.svelte";
  import DragHandle from "../DragHandle.svelte";
  import RelationCondition from "./RelationCondition.svelte";
  import CastCondition from "./CastCondition.svelte";
  import FieldCondition from "./FieldCondition.svelte";
  import { MorphIcon } from "morphicons/svelte";
  import { X } from "lucide";

  /** @type {{ item: object, group: object, idx: number, ctx: string }} */
  let { item, group, idx, ctx } = $props();

  const condType = $derived(getConditionKind(item));
  const COMPOSITE_KINDS = new Set([
    "relation",
    "person_relation",
    "character_relation",
    "character",
    "staff",
    "person_character",
    "person_cast_subject",
    "subject_cast",
    "episode",
  ]);
  const subjectType = $derived(
    $queryTarget === "subject"
      ? detectSubjectTypeCode($subjectRootLogic?.items)
      : 0,
  );
  const relationSuggestions = $derived(
    ["任意"].concat(prioritizedRelations(subjectType)),
  );
  const positionSuggestions = $derived(
    ["任意"].concat(prioritizedPositions(subjectType)),
  );
  const metaTagSuggestions = $derived(prioritizedMetaTags(subjectType));
</script>

<div
  class="cond-row"
  role="group"
  aria-labelledby={`rowtitle-${group._id}-${idx}`}
  data-item-id={item._id}
  data-item-label={describeItem(item, ctx)}
  data-pending={item._pendingDelete ? "1" : undefined}
>
  {#if item._pendingDelete}
    <PendingDelete
      label="已删除条件"
      focusOnMount={true}
      onUndo={() => undoLogicLeafDelete(group, idx)}
    />
  {:else}
    {#snippet dragHandle()}
      <DragHandle
        sourceId={item._id}
        kind="leaf"
        entry={item}
        label={describeItem(item, ctx)}
      />
    {/snippet}
    {#if condType && !COMPOSITE_KINDS.has(condType)}
      {@render dragHandle()}
    {/if}
    {#if condType === "field"}
      <FieldCondition {item} {group} {idx} {ctx} {subjectType} />
    {:else if condType === "tag"}
      <span class="cond-type" id={`rowtitle-${group._id}-${idx}`}>标签</span>
      <input
        class="input"
        aria-label="标签"
        value={item.tag.value}
        onchange={(e) =>
          updateCondition(group, idx, "tag", "value", e.target.value)}
      />
      <select
        class="select"
        value={item.tag.negate ? "negate" : "contains"}
        aria-label="筛选方式"
        onchange={(e) =>
          updateCondition(
            group,
            idx,
            "tag",
            "negate",
            e.target.value === "negate",
          )}
      >
        <option value="contains">包含</option>
        <option value="negate">排除</option>
      </select>
    {:else if condType === "meta_tag"}
      <span class="cond-type" id={`rowtitle-${group._id}-${idx}`}>公共标签</span
      >
      <AwesompleteInput
        restrict={true}
        value={item.meta_tag.value}
        suggestions={metaTagSuggestions}
        sort={false}
        onchange={(v) => updateCondition(group, idx, "meta_tag", "value", v)}
        placeholder="公共标签"
      />
      <select
        class="select"
        value={item.meta_tag.negate ? "negate" : "contains"}
        aria-label="筛选方式"
        onchange={(e) =>
          updateCondition(
            group,
            idx,
            "meta_tag",
            "negate",
            e.target.value === "negate",
          )}
      >
        <option value="contains">包含</option>
        <option value="negate">排除</option>
      </select>
    {:else if condType === "type"}
      {@const typeOpts = isPersonCtx(ctx)
        ? [
            ["", "全部"],
            ["1", "个人"],
            ["2", "公司"],
            ["3", "组合"],
          ]
        : [
            ["", "全部"],
            ["1", "书籍"],
            ["2", "动画"],
            ["3", "音乐"],
            ["4", "游戏"],
            ["6", "三次元"],
          ]}
      <span class="cond-type" id={`rowtitle-${group._id}-${idx}`}>分类</span>
      <select
        class="select"
        value={String(item.type.value)}
        aria-label="条目类型"
        onchange={(e) =>
          updateCondition(group, idx, "type", "value", e.target.value)}
      >
        {#each typeOpts as [v, l] (v)}
          <option value={v}>{l}</option>
        {/each}
      </select>
    {:else if condType === "relation"}
      <RelationCondition
        label="条目关系"
        handle={dragHandle}
        typeValue={item.relation.type}
        typeSuggestions={relationSuggestions}
        onTypeChange={(v) => updateCondition(group, idx, "relation", "type", v)}
        mode={item.relation.mode}
        onModeChange={(v) => updateCondition(group, idx, "relation", "mode", v)}
        countOp={item.relation.count_op}
        onCountOpChange={(v) =>
          updateCondition(group, idx, "relation", "count_op", v)}
        countVal={item.relation.count_val}
        onCountValChange={(v) =>
          updateCondition(group, idx, "relation", "count_val", v)}
        onDelete={() => removeLogicLeaf(group, idx)}
        logic={item.relation}
        nestedCtx={CTX_SUBJECT}
      />
    {:else if condType === "person_relation"}
      <RelationCondition
        label="人物关系"
        handle={dragHandle}
        typeValue={item.person_relation.type}
        typeSuggestions={["任意"].concat(PERSON_RELATIONS)}
        onTypeChange={(v) =>
          updateCondition(group, idx, "person_relation", "type", v)}
        mode={item.person_relation.mode}
        onModeChange={(v) =>
          updateCondition(group, idx, "person_relation", "mode", v)}
        countOp={item.person_relation.count_op}
        onCountOpChange={(v) =>
          updateCondition(group, idx, "person_relation", "count_op", v)}
        countVal={item.person_relation.count_val}
        onCountValChange={(v) =>
          updateCondition(group, idx, "person_relation", "count_val", v)}
        onDelete={() => removeLogicLeaf(group, idx)}
        logic={item.person_relation}
        nestedCtx={CTX_PERSON}
      />
    {:else if condType === "character_relation"}
      <RelationCondition
        label="角色关系"
        handle={dragHandle}
        typeValue={item.character_relation.type}
        typeSuggestions={["任意"].concat(CHARACTER_RELATIONS)}
        onTypeChange={(v) =>
          updateCondition(group, idx, "character_relation", "type", v)}
        mode={item.character_relation.mode}
        onModeChange={(v) =>
          updateCondition(group, idx, "character_relation", "mode", v)}
        countOp={item.character_relation.count_op}
        onCountOpChange={(v) =>
          updateCondition(group, idx, "character_relation", "count_op", v)}
        countVal={item.character_relation.count_val}
        onCountValChange={(v) =>
          updateCondition(group, idx, "character_relation", "count_val", v)}
        onDelete={() => removeLogicLeaf(group, idx)}
        logic={item.character_relation}
        nestedCtx={CTX_CHARACTER}
      />
    {:else if condType === "character"}
      <RelationCondition
        label="角色"
        handle={dragHandle}
        typeValue={item.character.type}
        typeSuggestions={["任意"].concat(CHARACTER_ASSOC_TYPES)}
        onTypeChange={(v) =>
          updateCondition(group, idx, "character", "type", v)}
        mode={item.character.mode}
        onModeChange={(v) =>
          updateCondition(group, idx, "character", "mode", v)}
        countOp={item.character.count_op}
        onCountOpChange={(v) =>
          updateCondition(group, idx, "character", "count_op", v)}
        countVal={item.character.count_val}
        onCountValChange={(v) =>
          updateCondition(group, idx, "character", "count_val", v)}
        onDelete={() => removeLogicLeaf(group, idx)}
        logic={item.character}
        nestedCtx={$queryTarget === "character" ? CTX_SUBJECT : CTX_CHARACTER}
      />
    {:else if condType === "person_character" || condType === "character_person" || condType === "person_cast_subject" || condType === "subject_cast"}
      <CastCondition {item} {group} {idx} {condType} handle={dragHandle} />
    {:else if condType === "staff"}
      {@const s = item.staff}
      {@const posText =
        s.positions?.length > 0 ? s.positions.join(",") : s.position || ""}
      <RelationCondition
        label={$queryTarget === "person" ? "关联" : "人物"}
        handle={dragHandle}
        mode={s.mode}
        onModeChange={(v) => updateCondition(group, idx, "staff", "mode", v)}
        countOp={s.count_op}
        onCountOpChange={(v) =>
          updateCondition(group, idx, "staff", "count_op", v)}
        countVal={s.count_val}
        onCountValChange={(v) =>
          updateCondition(group, idx, "staff", "count_val", v)}
        onDelete={() => removeLogicLeaf(group, idx)}
        logic={s}
        nestedCtx={$queryTarget === "person" ? CTX_SUBJECT : CTX_STAFF_PERSON}
      >
        <AwesompleteInput
          value={posText}
          suggestions={positionSuggestions}
          oninput={(v) => {
            const parts = v
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean);
            updateStaffPositions(group, idx, parts);
          }}
          onchange={(v) => {
            const parts = v
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean);
            updateStaffPositions(group, idx, parts);
          }}
          placeholder="职位"
          multiple={true}
          separator=","
          restrict={true}
          sort={false}
        />
      </RelationCondition>
    {:else if condType === "episode"}
      {@const ep = item.episode}
      <div class="cond-row-inner" role="group" aria-label="剧集">
        {@render dragHandle()}
        <span class="cond-type" id={`rowtitle-${group._id}-${idx}`}>剧集</span>
        <select
          class="select"
          value={ep.mode || "any"}
          aria-label="限定方式"
          onchange={(e) =>
            updateCondition(group, idx, "episode", "mode", e.target.value)}
        >
          <option value="any">任意</option>
          <option value="all">全部</option>
          <option value="none">排除</option>
          <option value="count">数量</option>
        </select>
        {#if ep.mode === "count"}
          <select
            class="select"
            value={ep.count_op || "gte"}
            aria-label="比较方式"
            onchange={(e) =>
              updateCondition(
                group,
                idx,
                "episode",
                "count_op",
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
            value={ep.count_val || ""}
            aria-label="数量"
            onchange={(e) =>
              updateCondition(
                group,
                idx,
                "episode",
                "count_val",
                e.target.value,
              )}
          />
        {/if}
        <button
          class="tag-remove"
          onclick={() => removeLogicLeaf(group, idx)}
          title="删除"
          aria-label="删除条件"><MorphIcon icon={X} size={14} /></button
        >
      </div>
      {#if ep.logic}
        <div class="nested">
          <FilterTree
            lg={ep.logic}
            isRoot={false}
            ctx={CTX_EPISODE}
            hideDelete={true}
          />
        </div>
      {/if}
    {:else}
      <span class="cond-unknown">{JSON.stringify(item)}</span>
    {/if}

    {#if !["relation", "staff", "character", "person_relation", "character_relation", "person_character", "person_cast_subject", "subject_cast", "character_person", "episode"].includes(condType)}
      <button
        class="tag-remove"
        onclick={() => removeLogicLeaf(group, idx)}
        title="删除"
        aria-label="删除条件"><MorphIcon icon={X} size={14} /></button
      >
    {/if}
  {/if}
</div>

<style>
  .cond-row {
    display: flex;
    gap: 3px;
    align-items: center;
    flex-wrap: wrap;
    margin: 2px 0;
    width: 100%;
  }

  .cond-unknown {
    font-size: 0.75rem;
    flex: 1;
  }
</style>
