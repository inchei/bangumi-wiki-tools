<script>
  import {
    queryTarget,
    subjectRootLogic,
    ctxFieldConfigs,
    fieldSelectOptions,
    opLabel,
    opInputType,
    ctxFields,
    CTX_SUBJECT,
    CTX_PERSON,
    CTX_STAFF_PERSON,
    CTX_CHARACTER,
    CTX_EPISODE,
    EPISODE_FIELD_LABELS,
    CAREER_OPTIONS,
    isPersonCtx,
  } from "../stores.js";
  import {
    removeLogicLeaf,
    undoLogicLeafDelete,
    updateCondition,
    updateStaffPositions,
  } from "../logic-tree.js";
  import {
    PERSON_RELATIONS,
    CHARACTER_RELATIONS,
    CHARACTER_ASSOC_TYPES,
    PERSON_CHAR_TYPES,
  } from "../schema-data.js";
  import {
    detectSubjectTypeCode,
    prioritizedRelations,
    prioritizedPositions,
    prioritizedMetaTags,
    subjectFieldSuggestions,
  } from "../columns.js";
  import FilterTree from "./FilterTree.svelte";
  import AwesompleteInput from "./AwesompleteInput.svelte";
  import PendingDelete from "./PendingDelete.svelte";
  import RelationCondition from "./conditions/RelationCondition.svelte";
  import { MorphIcon } from "morphicons/svelte";
  import { X } from "lucide";

  /** @type {{ item: object, group: object, idx: number, ctx: string }} */
  let { item, group, idx, ctx } = $props();

  function getConditionType(item) {
    if (item.field) return "field";
    if (item.tag) return "tag";
    if (item.meta_tag) return "meta_tag";
    if (item.global) return "global";
    if (item.type) return "type";
    if (item.relation) return "relation";
    if (item.person_relation) return "person_relation";
    if (item.character_relation) return "character_relation";
    if (item.person_character) return "person_character";
    if (item.person_cast_subject) return "person_cast_subject";
    if (item.subject_cast) return "subject_cast";
    if (item.character_person) return "character_person";
    if (item.character) return "character";
    if (item.staff) return "staff";
    if (item.episode) return "episode";
    return "unknown";
  }

  const condType = $derived(getConditionType(item));
  const fc = $derived(
    condType === "field" && item.field._special
      ? ctxFieldConfigs(ctx)[item.field.field] || null
      : null,
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

  // Context-aware field suggestions for autocomplete
  const fieldSuggestions = $derived(
    ctx === CTX_SUBJECT ? subjectFieldSuggestions(subjectType) : ctxFields(ctx),
  );

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

  // Reactive field select options
  const selectOpts = $derived(
    fc && fc.type === "select" ? fieldSelectOptions(fc, subjectType) : [],
  );
</script>

<div
  class="cond-row"
  role="group"
  aria-labelledby={`rowtitle-${group._id}-${idx}`}
>
  {#if item._pendingDelete}
    <PendingDelete
      label="已删除条件"
      focusOnMount={true}
      onUndo={() => undoLogicLeafDelete(group, idx)}
    />
  {:else}
    {#if condType === "field"}
      {#if fc}
        <span class="cond-type" id={`rowtitle-${group._id}-${idx}`}
          >{fc.label}</span
        >
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
              const code =
                selectOpts.find((opt) => opt[1] === label)?.[0] ?? "";
              updateCondition(group, idx, "field", "value", code);
            }}
            placeholder="子类型"
          />
        {:else if fc && fc.type === "select" && fc.dynamic !== "platform"}
          <span class="radio-group" role="radiogroup" aria-label={fc.label}>
            {#each selectOpts as [v, l] (v)}
              <label
                class="radio-pill"
                class:active={v === String(item.field.value)}
              >
                <input
                  class="sr-radio"
                  type="radio"
                  name="field-{group._id}-{idx}"
                  value={v}
                  checked={v === String(item.field.value)}
                  onchange={() =>
                    updateCondition(group, idx, "field", "value", v)}
                />{l}</label
              >
            {/each}
          </span>
        {:else if fc?.ac === "career"}
          <AwesompleteInput
            value={CAREER_OPTIONS.find(
              (opt) => opt[0] === item.field.value,
            )?.[1] || ""}
            suggestions={CAREER_OPTIONS.map((opt) => opt[1])}
            restrict={true}
            onchange={(label) => {
              const code =
                CAREER_OPTIONS.find((opt) => opt[1] === label)?.[0] ?? "";
              updateCondition(group, idx, "field", "value", code);
            }}
            placeholder="职业"
          />
        {:else}
          {@const isRef =
            typeof item.field.value === "string" &&
            item.field.value.startsWith("$")}
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
    {:else if condType === "global"}
      <span class="cond-type" id={`rowtitle-${group._id}-${idx}`}>全局</span>
      <select
        class="select"
        value={item.global.operator}
        aria-label="匹配方式"
        onchange={(e) =>
          updateCondition(group, idx, "global", "operator", e.target.value)}
      >
        <option value="contains">包含</option>
        <option value="not_contains">不包含</option>
        <option value="not_regex">正则不符合</option>
        <option value="regex">正则</option>
      </select>
      <input
        class="input"
        aria-label="关键字"
        value={item.global.value || ""}
        onchange={(e) =>
          updateCondition(group, idx, "global", "value", e.target.value)}
      />
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
    {:else if condType === "person_character" || condType === "character_person"}
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
              updateCondition(
                group,
                idx,
                condType,
                "count_val",
                e.target.value,
              )}
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
        <span class="cond-type" id={`rowtitle-${group._id}-${idx}`}
          >出演作品</span
        >
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
              updateCondition(
                group,
                idx,
                condType,
                "count_val",
                e.target.value,
              )}
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
              updateCondition(
                group,
                idx,
                condType,
                "count_val",
                e.target.value,
              )}
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
    {:else if condType === "staff"}
      {@const s = item.staff}
      {@const posText =
        s.positions?.length > 0 ? s.positions.join(",") : s.position || ""}
      <RelationCondition
        label={$queryTarget === "person" ? "关联" : "人物"}
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
  .radio-group {
    display: inline-flex;
    flex-wrap: wrap;
    gap: 4px;
    min-width: 0;
  }

  .cond-row {
    display: flex;
    gap: 3px;
    align-items: center;
    flex-wrap: wrap;
    margin: 2px 0;
    width: 100%;
  }

  .mode-row {
    display: flex;
    align-items: center;
    gap: 4px;
    margin-bottom: 2px;
  }

  .cond-unknown {
    font-size: 0.75rem;
    flex: 1;
  }

  :global(.input-ref) {
    background: var(--bg-alt);
    border-color: var(--accent-strong);
  }
</style>
