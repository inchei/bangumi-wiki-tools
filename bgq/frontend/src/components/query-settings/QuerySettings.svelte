<script>
  import AssociationOutput from "./AssociationOutput.svelte";
  import SortRulesEditor from "./SortRulesEditor.svelte";
  import { splitTokens } from "./association-output-utils.js";
  import { executeQuery } from "./query-execution.js";
  import {
    queryTarget,
    outputColumns,
    sortRules,
    resultLimit,
    assocLimit,
    RESULT_LIMIT_DEFAULT,
    ASSOC_LIMIT_DEFAULT,
    ctxFields,
    CTX_SUBJECT,
    CTX_PERSON,
    CTX_CHARACTER,
    EPISODE_FIELDS,
    subjectRootLogic,
    personRootLogic,
    characterRootLogic,
    episodeRootLogic,
    DEFAULT_SETTINGS,
  } from "@/stores.js";
  import { PERSON_CHAR_TYPES } from "@/schema-data.js";
  import {
    assocRowsFromFilters,
    assocFieldsFromFilters,
    assocPrefixesForTarget,
    parseAssocToken,
    makeOutputTokenLister,
    sortColumnSuggestions,
    prioritize,
    detectSubjectTypeCode,
    prioritizedPositions,
    subjectFieldsForType,
  } from "@/columns.js";
  import { SvelteMap } from "svelte/reactivity";
  import AwesompleteInput from "../AwesompleteInput.svelte";
  import LimitInput from "../LimitInput.svelte";
  import { TextMorph } from "torph/svelte";
  import { MorphIcon } from "morphicons/svelte";
  import { Loader, Search } from "lucide";

  let loading = $state(false);

  const IS_APPLE = /mac|iphone|ipad|ipod/i.test(
    navigator.userAgentData?.platform ||
      navigator.platform ||
      navigator.userAgent ||
      "",
  );
  const SHORTCUT_HINT = IS_APPLE ? "⌘↵" : "Ctrl↵";
  const SHORTCUT_TITLE = `焦点在筛选或输出设置时按 ${SHORTCUT_HINT} 直接查询`;

  function handleShortcut(e) {
    if (e.key !== "Enter") return;
    if (e.isComposing || e.keyCode === 229) return;
    // Accept both Ctrl and Cmd regardless of platform.
    if (!e.ctrlKey && !e.metaKey) return;
    if (!document.activeElement?.closest(".card-filter, .card-settings"))
      return;
    e.preventDefault();
    e.stopPropagation();
    if (!loading) handleRun();
  }

  const TARGET_COLUMNS_BASE = {
    subject: [...ctxFields(CTX_SUBJECT)],
    // name_cn：后端 person target 特例（name AS name_cn）
    person: [...ctxFields(CTX_PERSON), "name_cn"],
    character: [...ctxFields(CTX_CHARACTER)],
    // subject_id：后端支持 episode target 输出所属条目 id。
    // 刻意不提供 infobox 原始列（整段 wiki 文本，噪声大、无筛选价值）。
    episode: [...EPISODE_FIELDS, "subject_id"],
  };
  const TARGET_COLUMNS_TAIL = {
    subject: [],
    person: [...PERSON_CHAR_TYPES],
    character: [...PERSON_CHAR_TYPES],
    episode: [],
  };

  let target = $derived($queryTarget);

  let rootItems = $derived(
    (target === "person"
      ? $personRootLogic
      : target === "character"
        ? $characterRootLogic
        : target === "episode"
          ? $episodeRootLogic
          : $subjectRootLogic
    ).items,
  );

  let filterNames = $derived.by(() => {
    const out = [];
    for (const item of rootItems) {
      if (!item || item.logic) continue;
      const f = item.field?.field?.trim();
      if (f && !out.includes(f)) out.push(f);
    }
    return out;
  });

  let subjectType = $derived(
    target === "subject" ? detectSubjectTypeCode(rootItems) : 0,
  );
  let staffPositions = $derived(prioritizedPositions(subjectType));
  let baseColumns = $derived(
    target === "subject"
      ? subjectFieldsForType(subjectType)
      : TARGET_COLUMNS_BASE[target] || TARGET_COLUMNS_BASE.subject,
  );
  let plainColumns = $derived([
    ...new Set([
      ...filterNames,
      ...baseColumns,
      ...(target === "subject" || target === "person" ? staffPositions : []),
      ...(TARGET_COLUMNS_TAIL[target] || []),
    ]),
  ]);
  let outputPlaceholder = $derived(
    (
      DEFAULT_SETTINGS[target] || DEFAULT_SETTINGS.subject
    ).outputColumns.replace(/,+$/, ""),
  );

  let prefixInfoMap = $derived(
    new Map(
      assocPrefixesForTarget(target, subjectType).map((i) => [i.prefix, i]),
    ),
  );

  let filterAssocPrefixes = $derived(
    assocRowsFromFilters(target, rootItems).map((r) => r.prefix),
  );

  let filterAssocFieldMap = $derived(assocFieldsFromFilters(target, rootItems));

  // ---- Suggestion priority (pinned to the top while not searching) ----
  // Rank sources, in order: common fields of the default output columns →
  // content referenced by first-level filters → existing output columns →
  // existing sort fields. Three views: bare tokens (output stage 1 and plain
  // sort fields), full sort entries (前缀.count etc.), and per-prefix group
  // members (stage-3 fields inside 前缀.{...}).
  let suggestionPriority = $derived.by(() => {
    const general = [...filterNames];
    const sortEntries = [...filterNames];
    const members = new SvelteMap();
    const push = (arr, v) => {
      if (v && !arr.includes(v)) arr.push(v);
    };
    const pushMember = (prefix, field) => {
      if (!prefix || !field) return;
      const arr = members.get(prefix) || [];
      push(arr, field);
      members.set(prefix, arr);
    };
    // 1. Default output columns' common fields
    for (const f of splitTokens(
      (DEFAULT_SETTINGS[target] || DEFAULT_SETTINGS.subject).outputColumns,
    )) {
      push(general, f);
      push(sortEntries, f);
    }
    // 2. First-level filter content: type + association prefixes
    for (const item of rootItems) {
      if (!item || item.logic) continue;
      if (item.type?.value) {
        push(general, "type");
        push(sortEntries, "type");
      }
    }
    for (const p of filterAssocPrefixes) {
      if (!prefixInfoMap.has(p)) continue;
      push(general, p);
      push(sortEntries, `${p}.count`);
      if (prefixInfoMap.get(p).dual) push(sortEntries, `${p}.s.count`);
    }
    for (const [p, e] of filterAssocFieldMap) {
      if (!prefixInfoMap.has(p)) continue;
      for (const f of e.fields) push(sortEntries, `${p}.${f}`);
      if (prefixInfoMap.get(p).dual) {
        for (const f of e.subjectFields) push(sortEntries, `${p}.s.${f}`);
      }
    }
    // 3. Existing output columns (assoc tokens also rank their prefix and
    //    member fields)
    for (const tok of splitTokens($outputColumns)) {
      const dot = tok.indexOf(".");
      if (dot < 0) {
        push(general, tok);
        push(sortEntries, tok);
        continue;
      }
      const pfx = tok.slice(0, dot);
      push(general, pfx);
      const p = parseAssocToken(tok, pfx);
      if (p && !p.raw) {
        for (const f of p.fields) {
          push(sortEntries, `${pfx}.${f}`);
          pushMember(pfx, f);
        }
        for (const f of p.subjectFields) {
          push(sortEntries, `${pfx}.s.${f}`);
          pushMember(pfx, `s.${f}`);
        }
      }
    }
    // 4. Existing sort fields (assoc ones also rank their prefix and the
    //    field inside stage-3 group editing)
    for (const rule of $sortRules) {
      const f = (rule.field || "").trim();
      if (!f) continue;
      push(general, f);
      push(sortEntries, f);
      const dot = f.indexOf(".");
      if (dot > 0) {
        const pfx = f.slice(0, dot);
        push(general, pfx);
        pushMember(pfx, f.slice(dot + 1));
      }
    }
    return { general, sortEntries, members };
  });

  let sortSuggestions = $derived.by(() => {
    const base = sortColumnSuggestions(target, plainColumns, subjectType);
    const extra = [];
    for (const [p, e] of filterAssocFieldMap) {
      if (!prefixInfoMap.has(p)) continue;
      for (const f of e.fields) {
        if (!extra.includes(`${p}.${f}`)) extra.push(`${p}.${f}`);
      }
      if (prefixInfoMap.get(p).dual) {
        for (const f of e.subjectFields) {
          if (!extra.includes(`${p}.s.${f}`)) extra.push(`${p}.s.${f}`);
        }
      }
    }
    if (extra.length === 0) return base;
    return [...new Set([...extra, ...base])];
  });

  // Output columns autocomplete: while the column token (or the field
  // fragment inside {...}) is empty — i.e. not searching — priority
  // suggestions are pinned to the top of the list.
  let getColumnTokenList = $derived.by(() => {
    const base = makeOutputTokenLister(target, plainColumns, subjectType);
    const { general, members } = suggestionPriority;
    return (token, inner) => {
      const list = base(token);
      if (inner) {
        if (inner.fieldFragment.trim()) return list;
        const pfx = token.slice(0, token.indexOf("."));
        const pinned = [];
        const extra = filterAssocFieldMap.get(pfx);
        if (extra) {
          for (const f of extra.fields) pinned.push(`${f}|`);
          if (prefixInfoMap.get(pfx)?.dual) {
            for (const f of extra.subjectFields) pinned.push(`s.${f}|`);
          }
        }
        const mp = members.get(pfx);
        if (mp) {
          for (const m of mp) pinned.push(`${m}|`);
        }
        if (pinned.length === 0) return list;
        return prioritize([...new Set([...pinned, ...list])], pinned);
      }
      if (token.trim()) return list;
      return prioritize(list, general);
    };
  });

  // Sort field autocomplete: priority suggestions pinned while empty.
  let getSortTokenList = $derived.by(() => {
    const base = sortSuggestions;
    const { sortEntries } = suggestionPriority;
    return (token) => {
      if ((token || "").trim()) return base;
      return prioritize(base, sortEntries);
    };
  });

  function handleRun() {
    return executeQuery((value) => (loading = value));
  }
</script>

<svelte:window onkeydowncapture={handleShortcut} />

<div class="card card-settings">
  <div class="card-header">
    <h2 class="card-title">输出设置</h2>
  </div>
  <div class="form-group">
    <label class="form-label" for="outputColumns">输出列（逗号分隔）</label>
    <AwesompleteInput
      id="outputColumns"
      value={$outputColumns}
      getTokenList={getColumnTokenList}
      onchange={(v) => outputColumns.set(v)}
      oninput={(v) => outputColumns.set(v)}
      placeholder={outputPlaceholder}
      multiple={true}
      separator=","
      sort={false}
    />
  </div>
  <AssociationOutput
    {target}
    {subjectType}
    {prefixInfoMap}
    {filterAssocPrefixes}
    {filterAssocFieldMap}
  />
  <SortRulesEditor {sortSuggestions} {getSortTokenList} />
  <div class="form-group limit-row">
    <LimitInput
      id="resultLimit"
      label="结果数量上限"
      max={10000}
      width={120}
      defaultValue={RESULT_LIMIT_DEFAULT}
      bind:value={$resultLimit}
    />
    <LimitInput
      id="assocLimit"
      label="关联列出上限"
      max={100}
      width={100}
      defaultValue={ASSOC_LIMIT_DEFAULT}
      bind:value={$assocLimit}
    />
  </div>
  <button
    id="btn-run"
    class="btn btn-primary btn-block run-btn"
    onclick={handleRun}
    disabled={loading}
    title={SHORTCUT_TITLE}
    aria-label={loading
      ? "查询中"
      : `执行查询，快捷键 ${IS_APPLE ? "Command 回车" : "Ctrl 回车"}`}
  >
    <MorphIcon icon={loading ? Loader : Search} size={16} aria-hidden="true" />
    <TextMorph
      text={loading ? "查询中..." : "执行查询"}
      ease={{ stiffness: 420, damping: 30 }}
    />
    {#if !loading}
      <kbd class="kbd-hint" aria-hidden="true">{SHORTCUT_HINT}</kbd>
    {/if}
  </button>
</div>

<style>
  .run-btn {
    height: 42px;
    font-size: 0.95rem;
  }

  .kbd-hint {
    margin-left: 8px;
    font: inherit;
    font-size: 0.75rem;
    font-weight: normal;
    line-height: 1;
    color: var(--white);
    background: rgb(0 0 0 / 5%);
    border: 1px solid rgb(0 0 0 / 8%);
    border-radius: 4px;
    padding: 3px 8px;
  }

  .limit-row {
    display: flex;
    gap: 16px;
    flex-wrap: wrap;
  }
</style>
