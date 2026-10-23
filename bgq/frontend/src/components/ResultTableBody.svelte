<script>
  import { get } from "svelte/store";
  import { lastQueryTarget } from "../stores.js";
  import {
    positionsByType,
    PERSON_CHAR_TYPES,
    PERSON_RELATIONS,
    CHARACTER_RELATIONS,
    relationsByType,
    CHARACTER_ASSOC_TYPES,
  } from "../schema-data.js";
  import ScrollableCell from "./ScrollableCell.svelte";
  import { headerId, isIDColumn } from "./result-table-utils.js";

  let { rows, bodyCols, displayCols, cellScrollEpoch, host, patterns } =
    $props();

  const ALL_POSITIONS = new Set(positionsByType(0));
  const ALL_RELATIONS = new Set(relationsByType(0));
  const PERSON_CHAR_SET = new Set(PERSON_CHAR_TYPES);
  const PERSON_REL_SET = new Set(PERSON_RELATIONS);
  const CHAR_REL_SET = new Set(CHARACTER_RELATIONS);
  const CHAR_ASSOC_SET = new Set(CHARACTER_ASSOC_TYPES);

  function groupIdLinkType(prefix, target) {
    const isSubjectLevel = prefix.endsWith(".s");
    const base = isSubjectLevel ? prefix.slice(0, -2) : prefix;
    if (isSubjectLevel) return "subject";
    if (target === "subject") {
      if (ALL_POSITIONS.has(base)) return "person";
      if (ALL_RELATIONS.has(base)) return "subject";
      if (CHAR_ASSOC_SET.has(base)) return "character";
    } else if (target === "person") {
      if (ALL_POSITIONS.has(base)) return "subject";
      if (PERSON_REL_SET.has(base)) return "person";
      if (PERSON_CHAR_SET.has(base)) return "character";
    } else if (target === "character") {
      if (CHAR_REL_SET.has(base)) return "character";
      if (PERSON_CHAR_SET.has(base)) return "person";
    } else if (target === "episode") {
      return "subject";
    }
    return "subject";
  }

  function groupCellIdHref(entry, field, prefix, host) {
    if (!isIDColumn(field)) return null;
    const v = entry[field];
    if (v === null || v === undefined || v === "") return null;
    // "s." members are subject-level fields (person_character/character_person)
    const type = field.startsWith("s.")
      ? "subject"
      : groupIdLinkType(prefix, get(lastQueryTarget));
    return `https://${host}/${type}/${encodeURIComponent(String(v))}`;
  }

  function escapeHtml(s) {
    if (s === null || s === undefined) return "";
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function detectLang(s) {
    if (/[\u3040-\u30FF]/.test(s)) return "ja";
    if (/[\uAC00-\uD7AF]/.test(s)) return "ko";
    if (/[\u4E00-\u9FFF]/.test(s)) return "zh";
    if (/[A-Za-z]/.test(s)) return "en";
    return null;
  }

  function langAttr(s) {
    const lang = detectLang(s);
    return lang ? ` lang="${lang}"` : "";
  }

  const idRegex = /^((person|character|episode)_)?id$/;

  function bgmLink(id, colName, host) {
    if (id === null || id === undefined || id === "")
      return escapeHtml(String(id));
    const raw = String(colName);
    const s = String(id);
    // Handle comma-separated list for association columns (e.g. 导演.id -> "1, 2, 3")
    if (s.includes(",") && raw.includes(".")) {
      return s
        .split(",")
        .map((p) => p.trim())
        .filter(Boolean)
        .map((p) => bgmLink(p, raw, host))
        .join(", ");
    }
    const cn = raw.toLowerCase();
    const target = get(lastQueryTarget);
    const h = escapeHtml(host);
    // Try association-aware type for "prefix.id" columns
    const dot = cn.lastIndexOf(".");
    if (dot >= 0) {
      const prefix = raw.slice(0, dot);
      // Only use assoc logic for id fields
      const fieldPart = cn.slice(dot + 1);
      if (idRegex.test(fieldPart)) {
        const t = groupIdLinkType(prefix, target);
        // groupIdLinkType returns "subject" as fallback; only use it if prefix is recognized
        const base = prefix.endsWith(".s") ? prefix.slice(0, -2) : prefix;
        const lowerBase = base.toLowerCase();
        const recognized =
          ALL_POSITIONS.has(base) ||
          ALL_POSITIONS.has(lowerBase) ||
          ALL_RELATIONS.has(base) ||
          PERSON_CHAR_SET.has(base) ||
          PERSON_REL_SET.has(base) ||
          CHAR_REL_SET.has(base) ||
          CHAR_ASSOC_SET.has(base) ||
          prefix.toLowerCase().endsWith(".s");
        if (recognized) {
          return `<a href="https://${h}/${t}/${encodeURIComponent(s)}" target="_blank" rel="noopener">${escapeHtml(s)}</a>`;
        }
      }
    }
    let type = "subject";
    if (target === "person" || cn.includes("person")) type = "person";
    else if (target === "character" || cn.includes("character"))
      type = "character";
    else if (target === "episode" || cn.includes("episode")) type = "ep";
    return `<a href="https://${h}/${type}/${encodeURIComponent(s)}" target="_blank" rel="noopener">${escapeHtml(s)}</a>`;
  }

  function cellClass(col) {
    if (isIDColumn(col)) return "col-id";
    if (col === "score" || col === "评分") return "col-score";
    if (col === "name" || col === "name_cn") return "col-name";
    return "";
  }

  // Parse a group cell's JSON into an array of entries for subgrid rendering.
  function groupEntries(val) {
    if (val === null || val === undefined || val === "") return [];
    try {
      const d = JSON.parse(val);
      return Array.isArray(d) ? d : [d];
    } catch {
      return [];
    }
  }

  // Merge group entries sharing identical entity-field values (fields without
  // the "s." prefix): one visual sub-row per distinct entity, with each
  // subject-level ("s.*") field collected into a list of its values — the
  // same character/person appears once, its works listed separately.
  // Returns [{ entry, subject }] where subject maps "s.x" → value list
  // (null when there is no entity field to group by — rows kept as-is).
  function mergedGroupRows(val, fields) {
    const entries = groupEntries(val);
    if (entries.length === 0) return [];
    const entityFields = fields.filter((f) => !f.startsWith("s."));
    const subjectFields = fields.filter((f) => f.startsWith("s."));
    if (entityFields.length === 0) {
      return entries.map((entry) => ({ entry, subject: null }));
    }
    const rows = [];
    const byKey = Object.create(null);
    for (const entry of entries) {
      const key = JSON.stringify(entityFields.map((f) => entry[f] ?? null));
      let m = byKey[key];
      if (!m) {
        m = { entry, subject: {} };
        for (const f of subjectFields) m.subject[f] = [];
        byKey[key] = m;
        rows.push(m);
      }
      for (const f of subjectFields) {
        const v = entry[f];
        if (v === null || v === undefined || v === "") continue;
        if (!m.subject[f].some((x) => String(x) === String(v)))
          m.subject[f].push(v);
      }
    }
    return rows;
  }

  // Grid rows a merged entry spans: the longest subject-level value list.
  // Entity cells span all of them so works align across the s.* columns.
  function workRowCount(m, fields) {
    if (!m || !m.subject) return 1;
    let n = 1;
    for (const f of fields) {
      if (!f.startsWith("s.")) continue;
      const len = (m.subject[f] || []).length;
      if (len > n) n = len;
    }
    return n;
  }

  function cellHtml(col, val, host, patterns) {
    if (isIDColumn(col)) return bgmLink(val, col, host);
    if (val === null || val === undefined || val === "")
      return '<span class="cell-null">—</span>';
    let s = String(val);
    let html = escapeHtml(s);
    if (patterns) html = insertMarks(html, patterns);
    html = html.replace(/\n/g, "<br>");
    return `<span${langAttr(s)}>${html}</span>`;
  }

  function insertMarks(escaped, re) {
    return escaped
      .split(/(<[^>]*>)/)
      .map((seg) =>
        seg.startsWith("<") ? seg : seg.replace(re, (m) => `<mark>${m}</mark>`),
      )
      .join("");
  }

  function markedTextHtml(s, patterns) {
    let html = escapeHtml(s);
    if (patterns) html = insertMarks(html, patterns);
    return html;
  }

  function columnPatterns(scope, patterns) {
    if (!patterns || patterns.length === 0) return null;
    const hits = patterns.filter((p) => scopeMatchesField(scope, p.field));
    if (hits.length === 0) return null;
    if (hits.length === 1) return hits[0].regex;
    return columnRegexMerge(hits);
  }

  function scopeMatchesField(scope, field) {
    if (scope === field) return true;
    const suffix = "." + field;
    if (!scope.endsWith(suffix)) return false;
    return !scope.slice(0, -suffix.length).endsWith(".s");
  }

  function columnRegexMerge(hits, i = 0) {
    if (!hits[i]) return null;
    try {
      return new RegExp(
        hits
          .slice(i)
          .map((p) => p.source)
          .join("|"),
        "g",
      );
    } catch {
      return columnRegexMerge(hits, i + 1);
    }
  }
</script>

{#each rows as row, ri (ri)}
  <div class="results-tr" role="row">
    <!-- eslint-disable svelte/no-at-html-tags -->
    {#each bodyCols as bc (bc.kind + ":" + bc.ci)}
      {#if bc.kind === "group"}
        <div
          class="results-td results-td-group"
          role="cell"
          aria-describedby={headerId(displayCols[bc.ci])}
          style="grid-column: span {bc.span}"
        >
          {#each mergedGroupRows(row[bc.ci], bc.fields) as m, ei (ei)}
            {@const workRows = workRowCount(m, bc.fields)}
            <div class="cell-mini-row">
              {#each bc.fields as f, fi (f)}
                {@const subScope = bc.prefix ? `${bc.prefix}.${f}` : f}
                {@const subPatterns = columnPatterns(subScope, patterns)}
                {#if f.startsWith("s.") && m.subject}
                  {#if m.subject[f].length === 0}
                    <div
                      class="cell-mini-cell"
                      style="grid-column: {fi + 1}; grid-row: 1"
                    >
                      <span class="cell-null">—</span>
                    </div>
                  {:else}
                    {#each m.subject[f] as v, vi (vi)}
                      {@const vhref = groupCellIdHref(
                        { [f]: v },
                        f,
                        bc.prefix,
                        host,
                      )}
                      <div
                        class="cell-mini-cell cell-sub-line {isIDColumn(f)
                          ? 'col-id'
                          : ''}"
                        class:cell-sub-sep={vi + 1 < workRows}
                        style="grid-column: {fi + 1}; grid-row: {vi + 1}"
                      >
                        <span class="sr-only">{bc.prefix}.{f}：</span>
                        {#if vhref}
                          <a
                            href={vhref}
                            target="_blank"
                            rel="noopener"
                            lang={detectLang(v) ?? undefined}
                            >{@html markedTextHtml(v, subPatterns)}</a
                          >
                        {:else}
                          <ScrollableCell
                            html={cellHtml(subScope, v, host, subPatterns)}
                            value={v}
                            epoch={cellScrollEpoch}
                            markScroll={!!subPatterns}
                          />
                        {/if}
                      </div>
                    {/each}
                  {/if}
                {:else}
                  {@const href = groupCellIdHref(m.entry, f, bc.prefix, host)}
                  <div
                    class="cell-mini-cell {isIDColumn(f) ? 'col-id' : ''}"
                    style="grid-column: {fi + 1}; grid-row: 1 / span {workRows}"
                  >
                    <span class="sr-only">{bc.prefix}.{f}：</span>
                    {#if m.entry[f] === null || m.entry[f] === undefined || m.entry[f] === ""}
                      <span class="cell-null">—</span>
                    {:else if href}
                      <a
                        {href}
                        target="_blank"
                        rel="noopener"
                        lang={detectLang(m.entry[f]) ?? undefined}
                        >{@html markedTextHtml(m.entry[f], subPatterns)}</a
                      >
                    {:else}
                      <ScrollableCell
                        html={cellHtml(subScope, m.entry[f], host, subPatterns)}
                        value={m.entry[f]}
                        epoch={cellScrollEpoch}
                        markScroll={!!subPatterns}
                      />
                    {/if}
                  </div>
                {/if}
              {/each}
            </div>
          {/each}
        </div>
      {:else if isIDColumn(bc.label)}
        <div
          class="results-td col-id"
          role="cell"
          aria-describedby={headerId(displayCols[bc.ci])}
        >
          {@html cellHtml(bc.label, row[bc.ci], host, patterns)}
        </div>
      {:else}
        {@const val = row[bc.ci]}
        {@const cellPatterns = columnPatterns(bc.label, patterns)}
        <div
          class="results-td {cellClass(bc.label)}"
          role="cell"
          aria-describedby={headerId(displayCols[bc.ci])}
        >
          <ScrollableCell
            html={cellHtml(bc.label, val, host, cellPatterns)}
            value={val}
            epoch={cellScrollEpoch}
            markScroll={!!cellPatterns}
          />
        </div>
      {/if}
    {/each}
    <!-- eslint-enable svelte/no-at-html-tags -->
  </div>
{/each}

<style>
  :global(.results-table.fill) .results-td,
  :global(.results-table.fill) .cell-mini-cell {
    max-width: none;
  }

  .results-td {
    padding: 8px 14px;
    border-bottom: 1px solid var(--bg-alt);
    max-width: 20ch;
    min-width: 0;
    overflow-wrap: anywhere;
  }

  .results-tr {
    display: grid;
    grid-template-columns: subgrid;
    grid-column: 1 / -1;
    transition: var(--transition);
  }

  .results-tr:hover {
    background: var(--accent-light);
  }

  /* When hovering a sub-row, suppress the main-row highlight so only the
     hovered sub-row is highlighted — other sub-rows stay unhighlighted. */
  .results-tr:has(.cell-mini-row:hover) {
    background: transparent;
  }

  .results-tr:has(.cell-mini-row:hover) .cell-mini-row:not(:hover) {
    background: transparent;
  }

  /* Group cell: subgrid spanning its sub-field columns so the header's
     sub-column tracks are shared — sub-rows align with the header. */

  /* Subgrid: the group cell spans its sub-field tracks and reuses the header's
     column definitions, so sub-rows align exactly with the sub-field headers. */
  .results-td-group {
    display: grid;
    grid-template-columns: subgrid;
    grid-auto-rows: auto;
    padding: 0;
    max-width: none;
  }

  /* Chained subgrid: each sub-row is a real box reusing the parent's tracks,
     so cells stay aligned with the header even when content wraps. */
  .cell-mini-row {
    display: grid;
    grid-template-columns: subgrid;
    grid-column: 1 / -1;
  }

  .cell-mini-row:not(:last-child) {
    border-bottom: 1px solid var(--border-light);
  }

  .cell-mini-row:hover {
    background: color-mix(in srgb, var(--accent) 14%, transparent);
  }

  .cell-mini-cell {
    padding: 8px 14px;
    max-width: 20ch;
    min-width: 0;
    overflow-wrap: anywhere;
  }

  /* Subject-level values inside a merged entity row: one grid row per work,
     aligned across the s.* columns (entity cells span all work rows). */
  .cell-sub-sep {
    border-top: 1px dashed var(--border-light);
  }

  :global(.results-table .col-id) {
    font-family: var(--font-mono);
    font-size: 0.75rem;
    font-weight: 500;
  }

  :global(.results-table .col-id a) {
    color: var(--link);
  }

  :global(.results-table .col-id a:hover) {
    color: var(--link-hover);
    text-decoration: underline;
  }

  :global(.results-table .col-score) {
    font-weight: 600;
    color: var(--accent-strong);
  }

  :global(.results-table .col-name) {
    font-weight: 500;
  }

  :global(.results-table .cell-null) {
    color: var(--text-placeholder);
    font-style: italic;
  }
</style>
