<script>
  import { tick } from "svelte";
  import {
    queryTarget,
    lastResult,
    lastQueryTarget,
    queryLoading,
    outputColumns,
    sortRules,
    sortState,
    resultLimit,
    assocLimit,
    ctxFields,
    CTX_SUBJECT,
    CTX_PERSON,
    CTX_CHARACTER,
    EPISODE_FIELDS,
    subjectRootLogic,
    personRootLogic,
    characterRootLogic,
    episodeRootLogic,
    manualAssoc,
    assocSeeded,
    nextAssocId,
    removeSortRule,
    undoSortRuleRemove,
    removeManualAssocRow,
    undoManualAssocRowRemove,
    DEFAULT_SETTINGS,
    announce,
    bumpSortStructureVersion,
    bumpAssocStructureVersion,
  } from "../stores.js";
  import { getFiltersForAPI } from "../logic-tree.js";
  import { highlightPatterns, deriveHighlightPatterns } from "../highlight.js";
  import { PERSON_CHAR_TYPES } from "../schema-data.js";
  import {
    assocRowsFromFilters,
    assocFieldsFromFilters,
    assocPrefixesForTarget,
    parseAssocToken,
    buildAssocToken,
    makeOutputTokenLister,
    sortColumnSuggestions,
    prioritize,
    detectSubjectTypeCode,
    prioritizedPositions,
    subjectFieldsForType,
    ENTITY_FIELDS,
    ENTITY_LABELS,
    DEFAULT_ROW_FIELDS,
  } from "../columns.js";
  import { runQuery } from "../api.js";
  import { get } from "svelte/store";
  import { SvelteMap } from "svelte/reactivity";
  import AwesompleteInput from "./AwesompleteInput.svelte";
  import PendingDelete from "./PendingDelete.svelte";
  import { TextMorph } from "torph/svelte";
  import { MorphIcon } from "morphicons/svelte";
  import {
    ArrowDownWideNarrow,
    ArrowDownNarrowWide,
    Loader,
    Search,
    X,
  } from "lucide";

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

  // ---- Association output rows ----
  // Rows are manual entries (persisted), seeded once from first-level filter
  // associations. Each row's prefix is editable; field boxes manage the
  // corresponding token in the main input (limit via assocLimit).

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

  let assocRows = $derived.by(() => {
    return ($manualAssoc[target] || [])
      .map(({ prefix, _id, _pendingDelete, _pendingDeleteToken }) => {
        if (!prefix)
          return {
            key: `a${_id}`,
            _id,
            prefix: "",
            entity: null,
            dual: false,
            _pendingDelete,
            _pendingDeleteToken,
          };
        const info = prefixInfoMap.get(prefix);
        return info
          ? {
              key: `a${_id}`,
              _id,
              prefix,
              entity: info.entity,
              dual: !!info.dual,
              _pendingDelete,
              _pendingDeleteToken,
            }
          : null;
      })
      .filter(Boolean);
  });

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

  function rowFieldSuggestions(row, kind) {
    const entity = kind === "subject" ? "subject" : row.entity;
    const base =
      entity === "subject"
        ? subjectFieldsForType(subjectType)
        : ENTITY_FIELDS[entity];
    const extra = filterAssocFieldMap.get(row.prefix);
    const names = kind === "subject" ? extra?.subjectFields : extra?.fields;
    if (!names || names.length === 0) return base;
    return [...new Set([...names, ...base])];
  }

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

  // Prefixes not yet used by any row — candidates for "+ 关联"/renames.
  let addablePrefixes = $derived.by(() => {
    const have = new Set(assocRows.map((r) => r.prefix));
    return [...prefixInfoMap.keys()].filter((p) => !have.has(p));
  });

  function prefixSuggestionsFor(row) {
    const have = new Set(
      assocRows.filter((r) => r._id !== row._id).map((r) => r.prefix),
    );
    return [...prefixInfoMap.keys()].filter((p) => !have.has(p));
  }

  // Cleanup invalid rows/tokens left by IME intermediate pinyin (e.g. "d",
  // "da" for "导演"). Runs once per target.
  $effect(() => {
    const rows = $manualAssoc[target] || [];
    const validRows = rows.filter(
      (r) => !r.prefix || prefixInfoMap.has(r.prefix),
    );
    if (validRows.length !== rows.length) {
      manualAssoc.update((m) => ({ ...m, [target]: validRows }));
      bumpAssocStructureVersion();
    }
    const tokens = splitTokens(get(outputColumns));
    const validTokens = tokens.filter((tok) => {
      if (!tok.includes(".")) return true;
      const pfx = tok.slice(0, tok.indexOf("."));
      // Keep association tokens only if prefix is known for this target
      return prefixInfoMap.has(pfx);
    });
    if (validTokens.length !== tokens.length) writeTokens(validTokens);
    const seeded = $assocSeeded[target] || [];
    const validSeeded = seeded.filter((p) => prefixInfoMap.has(p));
    if (validSeeded.length !== seeded.length) {
      assocSeeded.update((m) => ({ ...m, [target]: validSeeded }));
    }
  });

  // Seed one row per first-level filter association (once per prefix).
  // Removing the row or clearing its fields suppresses re-seeding until the
  // filter itself disappears (assocSeeded is pruned on filter removal).
  $effect(() => {
    const filters = new Set(
      filterAssocPrefixes.filter((p) => prefixInfoMap.has(p)),
    );
    const seeded = new Set($assocSeeded[target] || []);
    const rows = $manualAssoc[target] || [];
    const have = new Set(rows.map((r) => r.prefix));
    const kept = [...seeded].filter((p) => filters.has(p));
    const toMark = [];
    const toSeed = [];
    for (const p of filters) {
      if (seeded.has(p)) continue;
      toMark.push(p);
      if (!have.has(p)) toSeed.push(p);
    }
    if (kept.length !== seeded.size || toMark.length > 0) {
      assocSeeded.update((m) => ({
        ...m,
        [target]: [...new Set([...kept, ...toMark])],
      }));
    }
    if (toSeed.length > 0) {
      manualAssoc.update((m) => ({
        ...m,
        [target]: [
          ...(m[target] || []),
          ...toSeed.map((p) => ({ prefix: p, _id: nextAssocId() })),
        ],
      }));
      bumpAssocStructureVersion();
      const tokens = splitTokens(get(outputColumns));
      let added = false;
      for (const p of toSeed) {
        if (findManagedIndex(tokens, p) >= 0) continue;
        const info = prefixInfoMap.get(p);
        const tk = buildAssocToken(
          p,
          DEFAULT_ROW_FIELDS,
          info?.dual ? DEFAULT_ROW_FIELDS : [],
        );
        if (tk) {
          tokens.push(tk);
          added = true;
        }
      }
      if (added) writeTokens(tokens);
    }
  });

  function splitTokens(str) {
    return str
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }

  function writeTokens(tokens) {
    outputColumns.set(tokens.length > 0 ? tokens.join(",") + "," : "");
  }

  // The row editor manages only group/scalar tokens ("前缀.{...}"/"前缀.f");
  // count / ~min / ~max / 前缀.s.* tokens stay manual (see columns.js).
  function findManagedIndex(tokens, prefix) {
    return tokens.findIndex((tk) => {
      const p = parseAssocToken(tk, prefix);
      return p && !p.raw;
    });
  }

  // View state per row: derived from the managed token when present. An
  // empty/cleared field input means "don't output this column".
  function rowState(row, colsStr) {
    const tokens = splitTokens(colsStr);
    const idx = findManagedIndex(tokens, row.prefix);
    if (idx >= 0) {
      const p = parseAssocToken(tokens[idx], row.prefix);
      return {
        fields: p.fields,
        subjectFields: p.subjectFields || [],
      };
    }
    return { fields: [], subjectFields: [] };
  }

  let assocRowViews = $derived(
    assocRows.map((r) => ({ ...r, ...rowState(r, $outputColumns) })),
  );

  function updateRowToken(row, fields, subjectFields) {
    const tokens = splitTokens(get(outputColumns));
    const tk = buildAssocToken(row.prefix, fields, subjectFields);
    const idx = findManagedIndex(tokens, row.prefix);
    if (idx >= 0) {
      if (tk) tokens[idx] = tk;
      else tokens.splice(idx, 1);
    } else if (tk) {
      tokens.push(tk);
    }
    writeTokens(tokens);
  }

  // Rename a row's prefix in place, carrying its token (and fields) over.
  // Clearing the prefix removes the token; picking a prefix for an empty row
  // creates a default token so the field boxes become useful immediately.
  function renameRow(row, newPrefix) {
    newPrefix = (newPrefix || "").trim();
    if (newPrefix === row.prefix) return;
    if (newPrefix) {
      if (!prefixInfoMap.has(newPrefix)) return;
      if (assocRows.some((r) => r._id !== row._id && r.prefix === newPrefix))
        return;
    }
    manualAssoc.update((m) => ({
      ...m,
      [target]: (m[target] || []).map((r) =>
        r._id === row._id ? { ...r, prefix: newPrefix } : r,
      ),
    }));
    const tokens = splitTokens(get(outputColumns));
    if (!newPrefix) {
      const idx = row.prefix ? findManagedIndex(tokens, row.prefix) : -1;
      if (idx >= 0) {
        tokens.splice(idx, 1);
        writeTokens(tokens);
      }
      return;
    }
    if (!row.prefix) {
      // Empty → prefix chosen: create default token if none exists yet.
      if (findManagedIndex(tokens, newPrefix) >= 0) return;
      const info = prefixInfoMap.get(newPrefix);
      const tk = buildAssocToken(
        newPrefix,
        DEFAULT_ROW_FIELDS,
        info?.dual ? DEFAULT_ROW_FIELDS : [],
      );
      if (tk) {
        tokens.push(tk);
        writeTokens(tokens);
      }
      return;
    }
    const idx = findManagedIndex(tokens, row.prefix);
    if (idx >= 0) {
      const p = parseAssocToken(tokens[idx], row.prefix);
      const tk =
        p && !p.raw
          ? buildAssocToken(newPrefix, p.fields, p.subjectFields || [])
          : null;
      if (tk) tokens[idx] = tk;
      else tokens.splice(idx, 1);
      writeTokens(tokens);
    }
  }

  function removeRow(row) {
    const tokens = splitTokens(get(outputColumns));
    const idx = findManagedIndex(tokens, row.prefix);
    const removedToken = idx >= 0 ? tokens[idx] : null;
    if (idx >= 0) {
      tokens.splice(idx, 1);
      writeTokens(tokens);
    }
    // Suppress re-seeding: refresh confirms deletes, so a deliberately
    // removed prefix that slides back with a live filter must not return
    // with default fields (auto-seeded rows already carry this mark).
    if (row.prefix) {
      assocSeeded.update((m) => ({
        ...m,
        [target]: [...new Set([...(m[target] || []), row.prefix])],
      }));
    }
    removeManualAssocRow(target, row._id, removedToken);
  }

  function undoRow(row) {
    undoManualAssocRowRemove(target, row._id);
    if (row._pendingDeleteToken) {
      const tokens = splitTokens(get(outputColumns));
      tokens.push(row._pendingDeleteToken);
      writeTokens(tokens);
    }
  }

  // "+ 关联": append an empty row — the prefix input is focused and the
  // field boxes are present immediately; picking a prefix creates the token.
  // A live empty row blocks stacking another one (focus it instead);
  // pending-delete rows don't count (the version bump below purges them).
  async function addManualRow() {
    if (addablePrefixes.length === 0) return;
    const emptyRow = assocRows.find((r) => !r.prefix && !r._pendingDelete);
    if (emptyRow) {
      focusRowPrefixBox(emptyRow._id);
      return;
    }
    const newId = nextAssocId();
    manualAssoc.update((m) => ({
      ...m,
      [target]: [...(m[target] || []), { prefix: "", _id: newId }],
    }));
    bumpAssocStructureVersion();
    await tick();
    focusRowPrefixBox(newId);
  }

  function focusRowPrefixBox(rowId) {
    document
      .querySelector(
        `.assoc-row[data-assoc-id="${rowId}"] .assoc-prefix-box input`,
      )
      ?.focus();
  }

  function parseFieldList(v) {
    return v
      .split("|")
      .map((s) => s.trim())
      .filter(Boolean);
  }

  async function addSortRule() {
    sortRules.update((rules) => [...rules, { field: "", direction: "asc" }]);
    bumpSortStructureVersion();
    await tick();
    const rows = document.querySelectorAll(".sort-row");
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

  async function handleRun() {
    const filters = getFiltersForAPI();
    const sort = $sortRules.filter((r) => r.field);
    if (filters.length === 0 && sort.length === 0) {
      lastResult.set({ error: "请先添加筛选条件或排序" });
      announce("请先添加筛选条件或排序");
      return;
    }
    loading = true;
    queryLoading.set(true);
    lastResult.set(null);
    announce("查询中");
    const cols =
      $outputColumns
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean) || [];
    const limit = parseInt($resultLimit) || 500;
    const al = Math.min(100, Math.max(1, parseInt($assocLimit) || 1));
    try {
      const savedTarget = get(queryTarget);
      const data = await runQuery(
        filters,
        cols,
        savedTarget,
        limit,
        sort.length > 0 ? sort : undefined,
        al,
      );
      lastQueryTarget.set(savedTarget);
      lastResult.set(data);
      highlightPatterns.set(deriveHighlightPatterns(filters));
      // Sync sort state to match the first sort rule if its field is in the result
      // columns (also matching group-column sub-fields like 导演.生日+ ↔
      // 导演.{name|生日|id}+).
      if (sort.length > 0 && data?.columns) {
        const f = sort[0].field;
        let colIdx = data.columns.indexOf(f);
        let field = "";
        if (colIdx < 0) {
          // "导演.生日" ↔ 导演.{name|生日|id}；"CV.s.date" 的子字段名带 s. 前缀
          const m =
            f.match(/^(.+)\.s\.([^.{}]+)$/) || f.match(/^(.+)\.([^.{}]+)$/);
          if (m) {
            const prefix = m[1];
            const sub = f.includes(".s.") ? "s." + m[2] : m[2];
            colIdx = data.columns.findIndex((c) => {
              const gm = c.match(/^(.+)\.\{([^}]+)\}$/);
              if (!gm || gm[1] !== prefix) return false;
              return gm[2]
                .split("|")
                .map((s) => s.trim())
                .includes(sub);
            });
            if (colIdx >= 0) field = sub;
          }
        }
        if (colIdx >= 0) {
          sortState.set({
            col: colIdx,
            asc: sort[0].direction === "asc",
            field,
          });
        }
      }
    } catch (e) {
      lastResult.set({ error: e.message });
      announce(`查询失败，${e.message}`);
    } finally {
      loading = false;
      queryLoading.set(false);
    }
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
  {#if assocRowViews.length > 0 || addablePrefixes.length > 0}
    <div class="form-group">
      <span class="form-label">关联输出</span>
      {#each assocRowViews as row (row.key)}
        {#if row._pendingDelete}
          <PendingDelete
            label="已删除关联输出"
            margin="0 0 6px 0"
            focusOnMount={true}
            onUndo={() => undoRow(row)}
          />
        {:else}
          <div class="assoc-row" data-assoc-id={row._id}>
            <div
              class="assoc-prefix-box"
              title="切换该行输出的关联前缀；清空右侧字段即不输出该列"
            >
              <AwesompleteInput
                value={row.prefix}
                suggestions={prefixSuggestionsFor(row)}
                sort={false}
                placeholder="关联前缀"
                onchange={(v) => renameRow(row, v)}
              />
            </div>
            {#if !row.prefix}
              <div class="assoc-fields">
                <AwesompleteInput
                  value=""
                  suggestions={[]}
                  placeholder=""
                  multiple={true}
                  separator="|"
                  disabled={true}
                />
              </div>
            {:else if row.dual}
              <!-- Dual boxes stacked full-width; persistent left labels tell
                   the two boxes apart even when filled. -->
              <div class="assoc-fields assoc-dual">
                <div class="assoc-field-line">
                  <span class="assoc-entity">{ENTITY_LABELS[row.entity]}</span>
                  <AwesompleteInput
                    value={row.fields.length ? row.fields.join("|") + "|" : ""}
                    suggestions={rowFieldSuggestions(row)}
                    sort={false}
                    placeholder="{ENTITY_LABELS[row.entity]}字段"
                    multiple={true}
                    separator="|"
                    onchange={(v) =>
                      updateRowToken(row, parseFieldList(v), row.subjectFields)}
                  />
                </div>
                <div class="assoc-field-line">
                  <span class="assoc-entity">{ENTITY_LABELS.subject}</span>
                  <AwesompleteInput
                    value={row.subjectFields.length
                      ? row.subjectFields.join("|") + "|"
                      : ""}
                    suggestions={rowFieldSuggestions(row, "subject")}
                    sort={false}
                    placeholder="{ENTITY_LABELS.subject}字段"
                    multiple={true}
                    separator="|"
                    onchange={(v) =>
                      updateRowToken(row, row.fields, parseFieldList(v))}
                  />
                </div>
              </div>
            {:else}
              <div class="assoc-fields">
                <AwesompleteInput
                  value={row.fields.length ? row.fields.join("|") + "|" : ""}
                  suggestions={rowFieldSuggestions(row)}
                  sort={false}
                  placeholder="{ENTITY_LABELS[row.entity]}字段"
                  multiple={true}
                  separator="|"
                  onchange={(v) =>
                    updateRowToken(row, parseFieldList(v), row.subjectFields)}
                />
              </div>
            {/if}
            <button
              class="tag-remove"
              title="删除该关联行"
              aria-label="删除该关联行"
              onclick={() => removeRow(row)}
            >
              <MorphIcon icon={X} size={14} />
            </button>
          </div>
        {/if}
      {/each}
      {#if addablePrefixes.length > 0}
        <button class="btn btn-outline btn-xs" onclick={addManualRow}>
          + 关联
        </button>
      {/if}
    </div>
  {/if}
  <div class="form-group">
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
  <div class="form-group limit-row">
    <div>
      <label class="form-label" for="resultLimit">结果数量上限</label>
      <input
        class="input"
        id="resultLimit"
        bind:value={$resultLimit}
        type="number"
        min="1"
        max="10000"
        style="width:120px"
      />
    </div>
    <div>
      <label class="form-label" for="assocLimit">关联列出上限</label>
      <input
        class="input"
        id="assocLimit"
        bind:value={$assocLimit}
        type="number"
        min="1"
        max="100"
        style="width:100px"
      />
    </div>
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

  .sort-row {
    display: flex;
    gap: 6px;
    align-items: center;
    margin-bottom: 6px;
  }

  .assoc-row {
    display: flex;
    gap: 8px;
    align-items: center;
    margin-bottom: 6px;
  }

  .limit-row {
    display: flex;
    gap: 16px;
    flex-wrap: wrap;
  }

  .assoc-prefix-box {
    flex-shrink: 0;
  }

  /* Hug the prefix text (same trick as FilterTree inputs): .input is
     width:100% globally, so override with field-sizing:content. */
  .assoc-prefix-box :global(input.input) {
    field-sizing: content;
    width: auto;
    min-width: 5em;
    font-size: 0.8rem;
    font-weight: 500;
  }

  /* iOS Safari auto-zooms on focus when form text < 16px: phones only */
  @media (pointer: coarse) and (width < 768px) {
    .assoc-prefix-box :global(input.input) {
      font-size: 1rem;
    }
  }

  .assoc-fields {
    flex: 1;
    display: flex;
    gap: 6px;
    min-width: 0;
  }

  /* Dual (person_character/character_person) rows: the two field boxes stack
     vertically at full width, each with a persistent entity label. */
  .assoc-fields.assoc-dual {
    flex-direction: column;
    gap: 4px;
  }

  .assoc-field-line {
    display: flex;
    gap: 6px;
    align-items: center;
    min-width: 0;
  }

  .assoc-entity {
    flex-shrink: 0;
    font-size: 0.7rem;
    line-height: 1;
    color: var(--text-secondary);
    background: var(--bg-alt);
    border: 1px solid var(--border-light);
    border-radius: 4px;
    padding: 3px 6px;
  }

  .assoc-fields :global(.aw-wrap) {
    flex: 1;
    min-width: 0;
  }
</style>
