<script>
  import { tick } from "svelte";
  import { get } from "svelte/store";
  import {
    manualAssoc,
    assocSeeded,
    nextAssocId,
    outputColumns,
    removeManualAssocRow,
    undoManualAssocRowRemove,
    bumpAssocStructureVersion,
  } from "@/stores.js";
  import {
    parseAssocToken,
    buildAssocToken,
    subjectFieldsForType,
    ENTITY_FIELDS,
    ENTITY_LABELS,
    DEFAULT_ROW_FIELDS,
  } from "@/columns.js";
  import { splitTokens, findManagedIndex } from "./association-output-utils.js";
  import AwesompleteInput from "../AwesompleteInput.svelte";
  import PendingDelete from "../PendingDelete.svelte";
  import { MorphIcon } from "morphicons/svelte";
  import { X } from "lucide";

  let {
    target,
    subjectType,
    prefixInfoMap,
    filterAssocPrefixes,
    filterAssocFieldMap,
  } = $props();

  let containerEl = $state(null);

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

  function replaceSeededStaffColumns(tokens, prefix, filters) {
    if (target !== "subject" || !prefix.startsWith("{")) return [];
    const replaced = [];
    for (const position of prefix.slice(1, -1).split("|")) {
      if (filters.has(position)) continue;
      const oldIndex = tokens.indexOf(
        buildAssocToken(position, DEFAULT_ROW_FIELDS, []),
      );
      if (oldIndex >= 0) {
        tokens.splice(oldIndex, 1);
        replaced.push(position);
      }
    }
    return replaced;
  }

  // Cleanup invalid rows/tokens left by IME intermediate pinyin (e.g. "d",
  // "da" for "导演"). Runs once per target.
  $effect(() => {
    const rows = $manualAssoc[target] || [];
    const active = new Set(filterAssocPrefixes);
    const tokens = splitTokens(get(outputColumns));
    const intersectionPositions = new Set(
      target === "subject"
        ? filterAssocPrefixes
            .filter((prefix) => prefix.startsWith("{"))
            .flatMap((prefix) => prefix.slice(1, -1).split("|"))
        : [],
    );
    const validRows = rows.filter(
      (r) =>
        (!r.prefix || prefixInfoMap.has(r.prefix)) &&
        (!intersectionPositions.has(r.prefix) ||
          active.has(r.prefix) ||
          findManagedIndex(tokens, r.prefix) >= 0),
    );
    if (validRows.length !== rows.length) {
      manualAssoc.update((m) => ({ ...m, [target]: validRows }));
      bumpAssocStructureVersion();
    }
    const validTokens = tokens.filter((tok) => {
      if (!tok.includes(".")) return true;
      const pfx = tok.slice(0, tok.indexOf("."));
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

    // Auto-migrate, independent of seeding: an active intersection swaps the
    // pristine default columns of its member positions (token + row), in
    // either direction.
    const tokens = splitTokens(get(outputColumns));
    let tokensChanged = false;
    const migrated = [];
    for (const p of filters) {
      for (const position of replaceSeededStaffColumns(tokens, p, filters)) {
        migrated.push(position);
        tokensChanged = true;
      }
    }
    // Migrated positions were removed programmatically, not by a user row
    // delete — un-mark them so dropping back to fewer positions re-seeds.
    if (migrated.length > 0) {
      assocSeeded.update((m) => ({
        ...m,
        [target]: (m[target] || []).filter((p) => !migrated.includes(p)),
      }));
    }

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
        tokensChanged = true;
      }
    }
    if (migrated.length > 0 || toSeed.length > 0) {
      manualAssoc.update((m) => ({
        ...m,
        [target]: [
          ...(m[target] || []).filter((r) => !migrated.includes(r.prefix)),
          ...toSeed.map((p) => ({ prefix: p, _id: nextAssocId() })),
        ],
      }));
      bumpAssocStructureVersion();
    }
    if (tokensChanged) writeTokens(tokens);
  });

  function writeTokens(tokens) {
    outputColumns.set(tokens.length > 0 ? tokens.join(",") + "," : "");
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
    containerEl
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
</script>

{#if assocRowViews.length > 0 || addablePrefixes.length > 0}
  <div class="form-group" bind:this={containerEl}>
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

<style>
  .assoc-row {
    display: flex;
    gap: 8px;
    align-items: center;
    margin-bottom: 6px;
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
