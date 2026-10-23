<script>
  import { MorphIcon } from "morphicons/svelte";
  import { Copy, Share2, Download, Inbox, ClipboardList } from "lucide";
  import { lastResult, sortState, queryLoading, bgmHost } from "../stores.js";
  import {
    buildShareURL,
    buildShareState,
    encodeShareState,
    MAX_PAYLOAD_LEN,
    SHARE_PARAM,
  } from "../share.js";
  import { SvelteURL } from "svelte/reactivity";
  import { tick } from "svelte";
  import ActionButton from "./ActionButton.svelte";
  import BgmHostSetting from "./BgmHostSetting.svelte";
  import ResultTableGrid from "./ResultTableGrid.svelte";
  import { isIDColumn } from "./result-table-utils.js";
  import { highlightOn, highlightActivePatterns } from "../highlight.js";

  // Parse a group JSON column: "导演.{name|生日|id}" → { prefix, fields }.
  function parseGroupCol(col) {
    const m = col.match(/^(.+)\.\{([^}]+)\}$/);
    if (!m) return null;
    return {
      prefix: m[1],
      fields: m[2]
        .split("|")
        .map((s) => s.trim())
        .filter(Boolean),
    };
  }

  // Expand group columns ({f1|f2|...}) into one sortable column per
  // sub-field, so each displays as an independent column (e.g. 导演.生日).
  function expandColumns(columns) {
    const out = [];
    (columns || []).forEach((col, ci) => {
      const gc = parseGroupCol(col);
      if (gc) {
        for (const f of gc.fields) {
          out.push({
            ci,
            field: f,
            prefix: gc.prefix,
            label: `${gc.prefix}.${f}`,
          });
        }
      } else {
        out.push({ ci, field: "", prefix: "", label: col });
      }
    });
    return out;
  }

  let displayCols = $derived(expandColumns($lastResult?.columns));

  let countEl = $state(null);
  let prevResult = null;
  $effect(() => {
    const result = $lastResult;
    if (result?.rows && prevResult === null) {
      tick().then(() => countEl?.focus());
    }
    prevResult = result;
  });

  // Body columns merge a group's sub-field columns into one spanning cell so
  // the entries render as real aligned sub-rows (not just <br>-separated).
  function buildBodyCols(cols) {
    const out = [];
    let i = 0;
    while (i < cols.length) {
      const dc = cols[i];
      if (dc.field) {
        const span = [];
        while (i < cols.length && cols[i].field && cols[i].ci === dc.ci) {
          span.push(cols[i]);
          i++;
        }
        out.push({
          kind: "group",
          ci: dc.ci,
          prefix: span[0].prefix,
          span: span.length,
          fields: span.map((s) => s.field),
        });
      } else {
        out.push({ kind: "single", ci: dc.ci, label: dc.label });
        i++;
      }
    }
    return out;
  }

  let bodyCols = $derived(buildBodyCols(displayCols));

  let suppressCellReset = false;
  let prevResForCells = null;
  let cellScrollEpoch = $state(0);
  $effect(() => {
    const res = $lastResult;
    if (res === prevResForCells) return;
    prevResForCells = res;
    if (suppressCellReset) {
      suppressCellReset = false;
      return;
    }
    cellScrollEpoch++;
  });

  // Date sort applies to date fields only (mirrors backend dateFields in
  // builder_util.go; sub-field names like "导演.生日" / "s.date" match by the
  // part after the last "."). Other columns sort numeric → string so plain
  // numbers never get misread as years.
  const DATE_FIELDS = new Set([
    "date",
    "airdate",
    "生日",
    "放送开始",
    "播放结束",
    "发售日",
    "连载开始",
    "连载结束",
    "开始",
    "结束",
  ]);

  function isDateField(name) {
    let f = String(name ?? "");
    const dot = f.lastIndexOf(".");
    if (dot >= 0) f = f.slice(dot + 1);
    return DATE_FIELDS.has(f);
  }

  // Keep in sync with backend builder.go:
  // - extractNum() — first number from multi-value fields like "{ [121页] [128页] }"
  // - infoboxFirstDateExpr + normalizeDate — first date from "|发售日={ [2004-08-14] }" / "13 June 1892"
  //   Backend: regexp_extract(infobox, '(\d{4}(?:[-年]\d{1,2}(?:[-月]\d{1,2})?)?)') → normalizeDate (pad YYYY / YYYY-MM to YYYY-01-01 / YYYY-MM-01)
  function parseSortVal(v) {
    if (v === null || v === undefined || v === "")
      return { empty: true, num: NaN, ts: NaN, str: "" };
    const s = String(v).trim();
    const m = s.match(/\d[\d,.]*(?:\.\d+)?/);
    const num = m ? parseFloat(m[0].replace(/,/g, "")) : NaN;
    // Backend-compatible date extraction: first YYYY(-M(-D)) / YYYY年M(月D) occurrence
    let ts = NaN;
    const dm = s.match(/(\d{4})(?:[-年](\d{1,2})(?:[-月](\d{1,2}))?)?/);
    if (dm) {
      const y = parseInt(dm[1], 10);
      const mo = dm[2] ? parseInt(dm[2], 10) : 1;
      const da = dm[3] ? parseInt(dm[3], 10) : 1;
      // Use UTC to avoid local TZ shifting (aligns with DuckDB DATE semantics)
      const t = Date.UTC(y, mo - 1, da);
      if (!isNaN(t)) ts = t;
    }
    return { empty: false, num, ts, str: s.toLowerCase() };
  }

  function sortTable(di, ci) {
    const res = $lastResult;
    if (!res?.rows) return;
    const isActive = $sortState.col === ci && $sortState.field === "";
    const newSort = {
      col: ci,
      asc: isActive ? !$sortState.asc : true,
      field: "",
    };
    sortState.set(newSort);

    const label = displayCols[di]?.label ?? res.columns[ci] ?? "";
    const isRank = label === "rank";
    const rankZero = (v) => isRank && String(v ?? "").trim() === "0";
    const rows = [...res.rows];
    const vals = rows.map((r) => parseSortVal(r[ci]));
    const hasDate =
      isDateField(label) && vals.some((p) => !p.empty && !isNaN(p.ts));
    const hasNumeric = vals.some((p) => !p.empty && !isNaN(p.num));
    rows.sort((a, b) => {
      const pa = parseSortVal(a[ci]),
        pb = parseSortVal(b[ci]);
      const aEmpty = pa.empty || rankZero(a[ci]);
      const bEmpty = pb.empty || rankZero(b[ci]);
      if (aEmpty && bEmpty) return 0;
      if (aEmpty) return 1;
      if (bEmpty) return -1;
      let cmp;
      if (hasDate && !isNaN(pa.ts) && !isNaN(pb.ts)) cmp = pa.ts - pb.ts;
      else if (hasNumeric && !isNaN(pa.num) && !isNaN(pb.num))
        cmp = pa.num - pb.num;
      else cmp = pa.str.localeCompare(pb.str, "zh");
      return newSort.asc ? cmp : -cmp;
    });
    suppressCellReset = true;
    lastResult.set({ ...res, rows });
  }

  function handleHeaderClick(di) {
    const dc = displayCols[di];
    if (dc.field) sortGroupField(di, dc);
    else sortTable(di, dc.ci);
  }

  // Extract a sub-field's values across a group cell's entries and pick the
  // sort key: min for asc, max for desc — mirroring the backend's "导演.生日"
  // (min(ASC) / max(DESC)) semantics.
  function groupSortKey(entries, field, asc) {
    const rankZero = (v) => field === "rank" && String(v ?? "").trim() === "0";
    const vals = entries
      .map((e) => e[field])
      .filter((v) => v !== null && v !== undefined && v !== "" && !rankZero(v));
    if (vals.length === 0) return { empty: true, key: 0 };
    const parsed = vals.map((v) => parseSortVal(v));
    const hasDate =
      isDateField(field) && parsed.some((p) => !p.empty && !isNaN(p.ts));
    const hasNumeric = parsed.some((p) => !p.empty && !isNaN(p.num));
    let best = null;
    for (const p of parsed) {
      if (p.empty) continue;
      const k =
        hasDate && !isNaN(p.ts)
          ? p.ts
          : hasNumeric && !isNaN(p.num)
            ? p.num
            : p.str;
      if (best === null || (asc ? k < best : k > best)) best = k;
    }
    return { empty: best === null, key: best };
  }

  function sortGroupField(di, dc) {
    const res = $lastResult;
    if (!res?.rows) return;
    const isActive = $sortState.col === dc.ci && $sortState.field === dc.field;
    const asc = isActive ? !$sortState.asc : true;
    sortState.set({ col: dc.ci, asc, field: dc.field });
    const rows = [...res.rows];
    rows.sort((a, b) => {
      let pa, pb;
      try {
        pa = groupSortKey(JSON.parse(a[dc.ci]), dc.field, asc);
      } catch {
        pa = { empty: true, key: 0 };
      }
      try {
        pb = groupSortKey(JSON.parse(b[dc.ci]), dc.field, asc);
      } catch {
        pb = { empty: true, key: 0 };
      }
      if (pa.empty && pb.empty) return 0;
      if (pa.empty) return 1;
      if (pb.empty) return -1;
      let cmp;
      if (typeof pa.key === "number" && typeof pb.key === "number")
        cmp = pa.key - pb.key;
      else cmp = String(pa.key).localeCompare(String(pb.key), "zh");
      return asc ? cmp : -cmp;
    });
    // Re-order the sub-rows inside each cell by the sub-field, matching the
    // backend's cell-internal ORDER BY (导演.生日 → entries by 生日).
    const reordered = rows.map((r) => {
      let entries;
      try {
        const d = JSON.parse(r[dc.ci]);
        if (!Array.isArray(d)) return r;
        entries = d;
      } catch {
        return r;
      }
      const sorted = [...entries].sort((x, y) => {
        const isRank = dc.field === "rank";
        const rankZero = (v) => isRank && String(v ?? "").trim() === "0";
        const px0 = rankZero(x[dc.field])
          ? { empty: true }
          : parseSortVal(x[dc.field]);
        const py0 = rankZero(y[dc.field])
          ? { empty: true }
          : parseSortVal(y[dc.field]);
        if (px0.empty && py0.empty) return 0;
        if (px0.empty) return 1;
        if (py0.empty) return -1;
        const px = parseSortVal(x[dc.field]);
        const py = parseSortVal(y[dc.field]);
        if (px.empty && py.empty) return 0;
        if (px.empty) return 1;
        if (py.empty) return -1;
        let cmp;
        if (isDateField(dc.field) && !isNaN(px.ts) && !isNaN(py.ts))
          cmp = px.ts - py.ts;
        else if (!isNaN(px.num) && !isNaN(py.num)) cmp = px.num - py.num;
        else cmp = px.str.localeCompare(py.str, "zh");
        return asc ? cmp : -cmp;
      });
      const next = [...r];
      next[dc.ci] = JSON.stringify(sorted);
      return next;
    });
    suppressCellReset = true;
    lastResult.set({ ...res, rows: reordered });
  }

  function csvEscape(s) {
    if (s === null || s === undefined) return "";
    const str = String(s);
    if (str.includes('"') || str.includes(",") || str.includes("\n"))
      return '"' + str.replace(/"/g, '""') + '"';
    return str;
  }

  function handleExportCSV() {
    const res = $lastResult;
    if (!res?.rows) return;
    const cols = res.columns;
    let text = cols.map(csvEscape).join(",") + "\n";
    for (const row of res.rows) text += row.map(csvEscape).join(",") + "\n";
    const blob = new Blob(["\ufeff" + text], {
      type: "text/csv;charset=utf-8",
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "bangumi_results.csv";
    a.click();
  }

  function tsvEscape(s) {
    if (s === null || s === undefined) return "";
    const str = String(s);
    if (str.includes('"') || str.includes("\t") || str.includes("\n"))
      return '"' + str.replace(/"/g, '""') + '"';
    return str;
  }

  function clipboardErr(e) {
    let detail;
    if (e?.name === "NotAllowedError") detail = "剪贴板权限被拒绝";
    else if (e?.name === "NotFoundError") detail = "剪贴板不可用";
    else if (e instanceof Error && e.message) detail = e.message;
    else if (e?.name) detail = e.name;
    else if (e) detail = String(e);
    else detail = "未知错误";
    if (!window.isSecureContext && !detail.includes("需 https"))
      detail += "（需 https）";
    return `复制错误：${detail}，请复制YAML配置分享`;
  }

  async function writeClipboard(text) {
    if (!navigator.clipboard?.writeText) {
      throw new Error(
        `剪贴板不可用${!window.isSecureContext ? "（需 https）" : "（需授权或现代浏览器）"}`,
      );
    }
    return navigator.clipboard.writeText(text);
  }

  async function copyTableAction() {
    const res = $lastResult;
    if (!res?.rows) return "无可复制数据";
    const cols = res.columns;
    let text = cols.map(tsvEscape).join("\t") + "\n";
    for (const row of res.rows) text += row.map(tsvEscape).join("\t") + "\n";
    try {
      await writeClipboard(text);
      return "";
    } catch (e) {
      return clipboardErr(e);
    }
  }

  async function copyIdsAction() {
    const res = $lastResult;
    const rows = res.rows;
    if (!rows) return "无可复制数据";
    const cols = res.columns;
    const idCol = cols.findIndex((col) => isIDColumn(col));
    if (idCol < 0) return "未找到id列";
    const text = `bgm_id=${rows.map((row) => row[idCol]).join(",")}`;
    try {
      await writeClipboard(text);
      return "";
    } catch (e) {
      return clipboardErr(e);
    }
  }

  async function copyErrorAction() {
    const text = $lastResult?.error;
    if (!text) return "无可复制的错误信息";
    try {
      await writeClipboard(text);
      return "";
    } catch (e) {
      return clipboardErr(e);
    }
  }

  // Clipboard activation must happen within the user-gesture task. Build the
  // URL synchronously, then defer clipboard-write+encode to the gesture tick.
  function shareAction() {
    return (async () => {
      let url;
      try {
        const payloadPromise = encodeShareState(buildShareState());
        // Force synchronous clipboard write BEFORE await: Safari only allows
        // writeText within the click handler's synchronous phase. Using
        // ClipboardItem with a Promise lets us hand Safari the clipboard
        // synchronously while still resolving content asynchronously.
        if (!window.ClipboardItem || !navigator.clipboard?.write) {
          throw new Error("该浏览器不支持异步剪贴板写入");
        }
        const item = new window.ClipboardItem({
          "text/plain": payloadPromise.then(async (payload) => {
            if (payload.length > MAX_PAYLOAD_LEN) {
              throw new Error("查询过大");
            }
            const u = new SvelteURL(window.location.href);
            u.search = "";
            u.searchParams.set(SHARE_PARAM, payload);
            return u.toString();
          }),
        });
        await navigator.clipboard.write([item]);
        return "";
      } catch (e) {
        if (e instanceof Error && e.message === "查询过大") {
          return "查询过大，请复制YAML配置分享";
        }
        // Fallback for browsers without ClipboardItem: prebuild then copy
        try {
          url = await buildShareURL();
        } catch (e2) {
          return `生成失败${e2 instanceof Error && e2.message ? `：${e2.message}` : ""}，请复制YAML配置分享`;
        }
        if (url === null) return "查询过大，请复制YAML配置分享";
        try {
          await writeClipboard(url);
          return "";
        } catch (e2) {
          return clipboardErr(e2);
        }
      }
    })();
  }
</script>

<div class="results-panel" role="region" aria-label="查询结果">
  {#if $lastResult?.error}
    <div class="error-card">
      <div class="error-header">
        <div class="error-title">查询失败</div>
        <ActionButton
          icon={Copy}
          text="复制信息"
          variant="outline"
          action={copyErrorAction}
        />
      </div>
      <pre>{$lastResult.error}</pre>
    </div>
  {:else if $queryLoading}
    <div class="results-loading">
      <div class="bouncy">
        <div class="bouncy-cube"><div class="bouncy-cube-inner"></div></div>
        <div class="bouncy-cube"><div class="bouncy-cube-inner"></div></div>
        <div class="bouncy-cube"><div class="bouncy-cube-inner"></div></div>
      </div>
    </div>
  {:else if $lastResult?.rows}
    {@const res = $lastResult}
    <div class="results-toolbar">
      <span class="results-count" tabindex="-1" bind:this={countEl}
        >共 <b>{res.total_rows}</b> 条结果<span class="time"
          >{res.duration}</span
        ></span
      >
      <span class="results-actions">
        <button class="btn btn-outline btn-sm" onclick={handleExportCSV}
          ><MorphIcon icon={Download} size={14} /> 下载 CSV</button
        >
        <ActionButton icon={Copy} text="复制表格" action={copyTableAction} />
        <ActionButton icon={Copy} text="复制bgm_id" action={copyIdsAction} />
        <ActionButton
          icon={Share2}
          text="分享链接"
          title="分享当前查询链接"
          action={shareAction}
        />
      </span>
    </div>
    <div class="host-line">
      <label class="highlight-toggle">
        <input type="checkbox" bind:checked={$highlightOn} />
        结果高亮
      </label>
      <BgmHostSetting />
    </div>
    {#if res.rows.length === 0}
      <div class="results-empty">
        <div class="icon"><MorphIcon icon={Inbox} size={48} /></div>
        <div>没有找到符合条件的条目</div>
      </div>
    {:else}
      <ResultTableGrid
        rows={res.rows}
        {displayCols}
        {bodyCols}
        {cellScrollEpoch}
        host={$bgmHost}
        patterns={$highlightActivePatterns}
        sort={$sortState}
        onSort={handleHeaderClick}
      />
    {/if}
  {:else}
    <div class="results-empty">
      <div class="icon"><MorphIcon icon={ClipboardList} size={48} /></div>
      <div>点击 <b>"执行查询"</b> 开始筛选</div>
      <div class="results-empty-hint">
        或访问 <a href="/api/debug" target="_blank">/api/debug</a> 检查状态
      </div>
    </div>
  {/if}
</div>

<style>
  .results-empty {
    text-align: center;
    padding: 60px 20px;
    color: var(--text-placeholder);
  }

  .results-empty .icon {
    font-size: 3rem;
    margin-bottom: 16px;
    opacity: 0.5;
  }

  @media (forced-colors: active) {
    .results-empty .icon {
      opacity: 1;
    }
  }

  .results-empty-hint {
    font-size: 0.75rem;
    margin-top: 8px;
  }

  .results-loading {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    min-height: calc(100vh - var(--header-h) - 40px);
    padding: 60px 20px;

    /* Optical centering: sit slightly above the geometric center. */
    padding-bottom: calc(60px + 10vh);
    color: var(--text-secondary);
  }

  /* Bouncy loader from https://github.com/GriffinJohnston/ldrs (MIT).
     Tune via --uib-size / --uib-color / --uib-speed. */
  .bouncy {
    --uib-size: 45px;
    --uib-color: var(--accent-strong);
    --uib-speed: 1.75s;

    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    width: var(--uib-size);
    height: calc(var(--uib-size) * 0.6);

    /* Delayed show: fast queries resolve before this lands, so no flash. */
    opacity: 0;
    animation: bouncy-fade-in 0.2s ease 250ms forwards;
  }

  .bouncy-cube {
    flex-shrink: 0;
    width: calc(var(--uib-size) * 0.2);
    height: calc(var(--uib-size) * 0.2);
    animation: bouncy-jump var(--uib-speed) ease-in-out infinite;
  }

  .bouncy-cube-inner {
    display: block;
    height: 100%;
    width: 100%;
    border-radius: 25%;
    background-color: var(--uib-color);
    transform-origin: center bottom;
    animation: bouncy-morph var(--uib-speed) ease-in-out infinite;
    transition: background-color 0.3s ease;
  }

  .bouncy-cube:nth-child(2) {
    animation-delay: calc(var(--uib-speed) * -0.36);
  }

  .bouncy-cube:nth-child(2) .bouncy-cube-inner {
    animation-delay: calc(var(--uib-speed) * -0.36);
  }

  .bouncy-cube:nth-child(3) {
    animation-delay: calc(var(--uib-speed) * -0.2);
  }

  .bouncy-cube:nth-child(3) .bouncy-cube-inner {
    animation-delay: calc(var(--uib-speed) * -0.2);
  }

  @keyframes bouncy-jump {
    0% {
      transform: translateY(0);
    }

    30% {
      transform: translateY(0);
      animation-timing-function: ease-out;
    }

    50% {
      transform: translateY(-200%);
      animation-timing-function: ease-in;
    }

    75% {
      transform: translateY(0);
      animation-timing-function: ease-in;
    }
  }

  @keyframes bouncy-morph {
    0% {
      transform: scaleY(1);
    }

    10% {
      transform: scaleY(1);
    }

    20%,
    25% {
      transform: scaleY(0.6) scaleX(1.3);
      animation-timing-function: ease-in-out;
    }

    30% {
      transform: scaleY(1.15) scaleX(0.9);
      animation-timing-function: ease-in-out;
    }

    40% {
      transform: scaleY(1);
    }

    70%,
    85%,
    100% {
      transform: scaleY(1);
    }

    75% {
      transform: scaleY(0.8) scaleX(1.2);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .bouncy {
      opacity: 1;
      animation: none;
    }

    .bouncy-cube,
    .bouncy-cube-inner {
      animation: none;
    }
  }

  @keyframes bouncy-fade-in {
    to {
      opacity: 1;
    }
  }

  .results-panel {
    /* Container for the host-line alignment query below: its inline size
       equals the toolbar's, which wraps exactly when it drops under the
       count+actions width. */
    container-type: inline-size;
  }

  .results-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 8px;
    flex-wrap: wrap;
    gap: 8px;
  }

  .results-count {
    min-width: 0;
    font-size: 0.9rem;
    color: var(--text-secondary);
  }

  .results-count b {
    color: var(--text);
    font-weight: 600;
  }

  .results-count .time {
    color: var(--text-placeholder);
    font-size: 0.75rem;
    margin-left: 8px;
  }

  .results-actions {
    min-width: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  /* Host line: always its own row below the toolbar. Right-aligned under
     the button text edge on wide screens; when the toolbar is too narrow
     for count+buttons to share a line (buttons wrap left below the count),
     anchor it left like the buttons. Threshold ≈ the real wrap point:
     count (~120-150px) + gap 8 + sizer-fixed actions row (~412px). */
  .host-line {
    display: flex;
    justify-content: flex-end;
    margin-bottom: 16px;
  }

  .highlight-toggle {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    margin-right: 12px;
    color: var(--text-secondary);
    font-size: 0.75rem;
    cursor: pointer;
    white-space: nowrap;
    user-select: none;
    transition: var(--transition);
  }

  .highlight-toggle:hover {
    color: var(--accent-strong);
  }

  .highlight-toggle input {
    margin: 0;
    accent-color: var(--accent-strong);
    cursor: pointer;
  }

  @container (width < 555px) {
    .host-line {
      justify-content: flex-start;
    }
  }

  .error-card {
    background: var(--error-bg);
    border: 1px solid var(--error-border);
    border-radius: var(--radius);
    padding: 16px 20px;
    color: var(--error-text);
    font-size: 0.9rem;
  }

  .error-card .error-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 8px;
  }

  .error-card .error-title {
    font-weight: 600;
  }

  .error-card pre {
    background: var(--error-pre-bg);
    padding: 12px;
    border-radius: var(--radius-xs);
    font-size: 0.75rem;
    font-family: var(--font-mono);
    overflow-x: auto;
    max-height: 200px;
  }

  @media (width <= 900px) {
    .results-loading {
      min-height: 40vh;
    }
  }
</style>
