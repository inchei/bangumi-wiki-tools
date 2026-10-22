<script>
  import { MorphIcon } from "morphicons/svelte";
  import {
    Copy,
    Share2,
    ArrowUpDown,
    ArrowDownWideNarrow,
    ArrowDownNarrowWide,
    Download,
    Inbox,
    ClipboardList,
    ChevronLeft,
    ChevronRight,
  } from "lucide";
  import {
    lastResult,
    sortState,
    lastQueryTarget,
    queryLoading,
    bgmHost,
  } from "../stores.js";
  import {
    positionsByType,
    PERSON_CHAR_TYPES,
    PERSON_RELATIONS,
    CHARACTER_RELATIONS,
    relationsByType,
    CHARACTER_ASSOC_TYPES,
  } from "../schema-data.js";
  import {
    buildShareURL,
    buildShareState,
    encodeShareState,
    MAX_PAYLOAD_LEN,
    SHARE_PARAM,
  } from "../share.js";
  import { SvelteURL } from "svelte/reactivity";
  import { get } from "svelte/store";
  import { tick } from "svelte";
  import ActionButton from "./ActionButton.svelte";
  import BgmHostSetting from "./BgmHostSetting.svelte";
  import ScrollableCell from "./ScrollableCell.svelte";

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

  function headerId(dc) {
    return "colh-" + dc.ci;
  }

  const idRegex = /^((person|character|episode)_)?id$/;

  function isIDColumn(colName) {
    let field = String(colName).toLowerCase();
    const dot = field.lastIndexOf(".");
    if (dot >= 0) field = field.slice(dot + 1);
    return idRegex.test(field);
  }

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

  let wrapEl = $state(null);
  let tableEl = $state(null);
  let theadEl = $state(null);
  let stripEl = $state(null);
  let colWidths = $state([]);
  let theadH = $state(0);
  let canScrollLeft = $state(false);
  let canScrollRight = $state(false);
  // Fill mode: the CAPPED layout fits without horizontal scrolling, so
  // cells drop their 20ch caps and stretch with their tracks to fill the
  // container, matching the header strip (which always spans the full
  // track width). When scrolling IS needed the caps stay on, keeping the
  // scrollable width small. Toggling re-runs the effect below (fillMode
  // dep), which re-measures track widths after the class lands.
  let fillMode = $state(false);

  // Native-sticky header bar. The in-grid thead can't be sticky itself: the
  // wrap's overflow-x:auto forces overflow-y to compute to auto per spec,
  // trapping sticky to the wrap's scrollport (which never scrolls
  // vertically). Chasing the outer scroll with translateY lags the
  // compositor by a frame and ghosts badly on touch devices. So the real
  // thead stays in the grid purely as the layout/width source (hidden once
  // measured), and a separate bar OUTSIDE the horizontal scroller renders
  // the visible header with measured per-column widths. Vertical: zero-lag
  // native position:sticky on both layouts. Horizontal: the strip is
  // translateX(-scrollLeft)-synced via the scroll watchdog below.
  let barReady = $derived(
    theadH > 0 && colWidths.length === displayCols.length,
  );

  function measureHeader() {
    const thead = theadEl;
    const table = tableEl;
    if (!thead || !table) return;
    theadH = thead.getBoundingClientRect().height;
    // Read the resolved GRID TRACK widths, not the th elements: th cells are
    // capped by max-width (20ch at the header's font-size) while body cells
    // can stretch tracks wider, so th rects can be narrower than the track.
    colWidths = getComputedStyle(table)
      .gridTemplateColumns.split(" ")
      .map(parseFloat);
  }

  function syncStrip() {
    const strip = stripEl;
    const el = wrapEl;
    if (!strip || !el) return;
    // Clamp: iOS Safari reports out-of-range scrollLeft during rubber-band
    // bounces; syncing it raw would slide the header into blank space.
    // Evidence: https://github.com/discourse/discourse/commit/d567108
    const max = Math.max(el.scrollWidth - el.clientWidth, 0);
    const x = Math.min(Math.max(el.scrollLeft, 0), max);
    strip.style.transform = `translateX(${-Math.round(x)}px)`;
  }

  // Keyboard nav: focusing a strip cell beyond the visible width must NOT
  // displace anything (the bar is a non-scrollable overflow:clip box, so
  // the browser's scroll-into-view cannot move it). Instead reveal the
  // corresponding column by shifting wrap.scrollLeft — the strip is
  // translateX-synced to scrollLeft, so column and its header slide in
  // together and stay aligned.
  function handleStripFocus(ev) {
    const wrap = wrapEl;
    const cell = ev.target.closest(".sticky-th");
    if (!wrap || !cell) return;
    const view = wrap.getBoundingClientRect();
    const rect = cell.getBoundingClientRect();
    let d = 0;
    if (rect.left < view.left) d = rect.left - view.left;
    else if (rect.right > view.right) d = rect.right - view.right;
    if (d) wrap.scrollLeft += d;
  }

  function updateScrollHints() {
    const el = wrapEl;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    canScrollLeft = el.scrollLeft > 2;
    canScrollRight = max > 8 && el.scrollLeft < max - 2;
  }

  // Decide fill mode by measuring the CAPPED layout: in fill mode the
  // table is pinned to width:100% and grid sizing compresses all tracks
  // into the container, so scrollWidth can never overflow and the mode
  // would latch on forever. Briefly drop the class, force a reflow, and
  // restore it — all within one JS task, so nothing paints in between
  // and Svelte's class:fill binding stays in sync (its value is unchanged).
  function updateFillMode() {
    const el = wrapEl;
    const table = tableEl;
    if (!el || !table) return;
    const had = table.classList.contains("fill");
    if (had) table.classList.remove("fill");
    const max = el.scrollWidth - el.clientWidth;
    if (had) table.classList.add("fill");
    fillMode = max <= 8;
  }

  function nudgeScroll(dir) {
    const el = wrapEl;
    if (!el) return;
    // Absolute clamped target: iOS Safari doesn't clamp smooth programmatic
    // scrolls, so a relative scrollBy near an edge rubber-bands into blank
    // overscroll space instead of stopping at the content edge.
    // Evidence: https://github.com/discourse/discourse/commit/d567108
    const max = Math.max(el.scrollWidth - el.clientWidth, 0);
    const target = Math.min(
      Math.max(el.scrollLeft + dir * Math.max(160, el.clientWidth * 0.75), 0),
      max,
    );
    el.scrollTo({ left: target, behavior: "smooth" });
  }

  $effect(() => {
    void displayCols;
    void $lastResult?.rows?.length;
    // Dependency: updateFillMode() may toggle fillMode, which changes
    // the layout; re-run so measureHeader() reads the post-toggle tracks.
    void fillMode;
    updateScrollHints();
    updateFillMode();
    measureHeader();
    syncStrip();
    const el = wrapEl;
    if (!el) return;
    // Watchdog: async (compositor-driven) horizontal scrolling can delay or
    // coalesce scroll events; poll scrollLeft every frame while scrolling
    // and stop after a few stable frames.
    let rafId = 0;
    let lastPos = -1;
    let stable = 0;
    const rafLoop = () => {
      syncStrip();
      const p = el.scrollLeft;
      if (p !== lastPos) {
        lastPos = p;
        stable = 0;
      } else if (++stable >= 3) {
        rafId = 0;
        return;
      }
      rafId = requestAnimationFrame(rafLoop);
    };
    const onScroll = () => {
      syncStrip();
      if (!rafId) {
        lastPos = -1;
        stable = 0;
        rafId = requestAnimationFrame(rafLoop);
      }
    };
    const ro = new ResizeObserver(() => {
      updateScrollHints();
      updateFillMode();
      measureHeader();
    });
    ro.observe(el);
    if (theadEl) ro.observe(theadEl);
    if (tableEl) ro.observe(tableEl);
    el.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    // Force main-thread scrolling for pans over the wrap, so the strip's
    // translateX update lands in the same frame as the scroll.
    const noop = () => {};
    el.addEventListener("wheel", noop, { passive: false });
    el.addEventListener("touchstart", noop, { passive: false });
    el.addEventListener("touchmove", noop, { passive: false });
    return () => {
      ro.disconnect();
      if (rafId) cancelAnimationFrame(rafId);
      el.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      el.removeEventListener("wheel", noop);
      el.removeEventListener("touchstart", noop);
      el.removeEventListener("touchmove", noop);
    };
  });

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

  const MAX_RENDER_LEN = 2000;

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

  function cellHtml(col, val, host) {
    if (isIDColumn(col)) return bgmLink(val, col, host);
    if (val === null || val === undefined || val === "")
      return '<span class="cell-null">—</span>';
    let s = String(val);
    if (s.length > MAX_RENDER_LEN) s = s.slice(0, MAX_RENDER_LEN) + "…";
    return `<span${langAttr(s)}>${escapeHtml(s).replace(/\n/g, "<br>")}</span>`;
  }

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

  function sortIcon(di) {
    const dc = displayCols[di];
    const active = $sortState.col === dc.ci && $sortState.field === dc.field;
    if (active)
      return $sortState.asc ? ArrowDownNarrowWide : ArrowDownWideNarrow;
    return ArrowUpDown;
  }

  function isSortPlaceholder(di) {
    const dc = displayCols[di];
    return !($sortState.col === dc.ci && $sortState.field === dc.field);
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

<!-- Shared header cell, rendered in two places: the sticky bar (width =
     measured px) and the in-grid thead (width = null, natural sizing that
     drives column widths). -->
{#snippet headerCell(dc, di, width)}
  <div
    class="results-th sortable"
    class:sticky-th={width !== null}
    class:sort-asc={$sortState.col === dc.ci &&
      $sortState.field === dc.field &&
      $sortState.asc}
    class:sort-desc={$sortState.col === dc.ci &&
      $sortState.field === dc.field &&
      !$sortState.asc}
    role="columnheader"
    aria-sort={$sortState.col === dc.ci && $sortState.field === dc.field
      ? $sortState.asc
        ? "ascending"
        : "descending"
      : "none"}
    title={`${dc.label}${$sortState.col === dc.ci && $sortState.field === dc.field ? ($sortState.asc ? "（升序）" : "（降序）") : ""}`}
    style:width={width === null ? undefined : `${width}px`}
  >
    <span
      class="sort-btn"
      onclick={() => handleHeaderClick(di)}
      onkeydown={(e) => e.key === "Enter" && handleHeaderClick(di)}
      tabindex="0"
      role="button"
      aria-label={`按${dc.label}排序${$sortState.col === dc.ci && $sortState.field === dc.field ? ($sortState.asc ? "，当前升序" : "，当前降序") : ""}`}
      ><span class="th-label"
        >{dc.label.length > 20
          ? dc.label.substring(0, 18) + "…"
          : dc.label}</span
      >
      <MorphIcon
        icon={sortIcon(di)}
        class={isSortPlaceholder(di) ? "sort-placeholder" : ""}
        size={14}
      />
    </span>
  </div>
{/snippet}

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
      <BgmHostSetting />
    </div>
    {#if res.rows.length === 0}
      <div class="results-empty">
        <div class="icon"><MorphIcon icon={Inbox} size={48} /></div>
        <div>没有找到符合条件的条目</div>
      </div>
    {:else}
      <div class="results-table-frame">
        <!-- Visible sticky header: native position:sticky works here because
             the bar sits outside the horizontal scroller (see measureHeader).
             Height + negative margin make it exactly overlay the hidden
             in-grid thead, which remains as the column-width source. -->
        <div
          class="results-sticky-bar"
          class:bar-ready={barReady}
          style:--thead-h="{theadH}px"
        >
          <div
            class="sticky-strip"
            bind:this={stripEl}
            onfocusin={handleStripFocus}
          >
            {#each displayCols as dc, di (dc.ci + ":" + dc.field)}
              {@render headerCell(dc, di, colWidths[di] ?? 0)}
            {/each}
          </div>
          <button
            type="button"
            class="scroll-arrow scroll-arrow-left"
            class:visible={canScrollLeft}
            aria-hidden="true"
            tabindex="-1"
            onclick={() => nudgeScroll(-1)}
          >
            <MorphIcon icon={ChevronLeft} size={16} />
          </button>
          <button
            type="button"
            class="scroll-arrow scroll-arrow-right"
            class:visible={canScrollRight}
            aria-hidden="true"
            tabindex="-1"
            onclick={() => nudgeScroll(1)}
          >
            <MorphIcon icon={ChevronRight} size={16} />
          </button>
        </div>
        <div
          class="results-table-wrap"
          bind:this={wrapEl}
          onscroll={updateScrollHints}
          /* Firefox grants scroll containers a sequential-focus tab stop
             even when they contain focusable descendants (Chrome skips
             them), which adds an invisible stop between the header bar and
             the first body link — an intentional Firefox feature, see
             https://bugzilla.mozilla.org/show_bug.cgi?id=1069739. tabindex=-1 removes it; arrow-key
             scrolling still works while a descendant holds focus. */
          tabindex="-1"
        >
          <div
            class="results-table"
            class:fill={fillMode}
            role="table"
            aria-label="查询结果表"
            bind:this={tableEl}
            style="grid-template-columns: repeat({displayCols.length}, minmax(0, auto))"
          >
            <div class="sr-only" role="row">
              {#each displayCols as dc, di (dc.ci + ":" + dc.field)}
                {#if di === 0 || displayCols[di - 1].ci !== dc.ci}
                  <span role="columnheader" id={headerId(dc)}
                    >{dc.prefix || dc.label}</span
                  >
                {/if}
              {/each}
            </div>
            <div
              class="results-thead"
              class:thead-hidden={barReady}
              role="rowgroup"
              bind:this={theadEl}
            >
              {#each displayCols as dc, di (dc.ci + ":" + dc.field)}
                {@render headerCell(dc, di, null)}
              {/each}
            </div>
            {#each res.rows as row, ri (ri)}
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
                                    $bgmHost,
                                  )}
                                  <div
                                    class="cell-mini-cell cell-sub-line {isIDColumn(
                                      f,
                                    )
                                      ? 'col-id'
                                      : ''}"
                                    class:cell-sub-sep={vi + 1 < workRows}
                                    style="grid-column: {fi +
                                      1}; grid-row: {vi + 1}"
                                  >
                                    <span class="sr-only"
                                      >{bc.prefix}.{f}：</span
                                    >
                                    {#if vhref}
                                      <a
                                        href={vhref}
                                        target="_blank"
                                        rel="noopener"
                                        lang={detectLang(v) ?? undefined}>{v}</a
                                      >
                                    {:else}
                                      {@const vl = detectLang(v)}
                                      {#if vl}
                                        <span lang={vl}>{v}</span>
                                      {:else}
                                        {v}
                                      {/if}
                                    {/if}
                                  </div>
                                {/each}
                              {/if}
                            {:else}
                              {@const href = groupCellIdHref(
                                m.entry,
                                f,
                                bc.prefix,
                                $bgmHost,
                              )}
                              <div
                                class="cell-mini-cell {isIDColumn(f)
                                  ? 'col-id'
                                  : ''}"
                                style="grid-column: {fi +
                                  1}; grid-row: 1 / span {workRows}"
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
                                    >{m.entry[f]}</a
                                  >
                                {:else}
                                  {@const ml = detectLang(m.entry[f])}
                                  {#if ml}
                                    <span lang={ml}>{m.entry[f]}</span>
                                  {:else}
                                    {m.entry[f]}
                                  {/if}
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
                      {@html cellHtml(bc.label, row[bc.ci], $bgmHost)}
                    </div>
                  {:else}
                    {@const val = row[bc.ci]}
                    <div
                      class="results-td {cellClass(bc.label)}"
                      role="cell"
                      aria-describedby={headerId(displayCols[bc.ci])}
                    >
                      <ScrollableCell
                        html={cellHtml(bc.label, val, $bgmHost)}
                        value={val}
                        epoch={cellScrollEpoch}
                      />
                    </div>
                  {/if}
                {/each}
                <!-- eslint-enable svelte/no-at-html-tags -->
              </div>
            {/each}
          </div>
        </div>
      </div>
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

  @container (width < 555px) {
    .host-line {
      justify-content: flex-start;
    }
  }

  .results-table-frame {
    position: relative;
    border-radius: var(--radius);
    box-shadow: var(--shadow);
    border: 1px solid var(--border-light);

    /* Clip (not hidden/auto): clips the sticky bar's overhang at the table
       bottom without becoming a scroll container, so the bar's sticky
       positioning still resolves against the outer scroller. */
    overflow: clip;
  }

  .results-table-wrap {
    overflow-x: auto;
    border-radius: inherit;
  }

  /* Visible sticky header bar. Sits outside the horizontal scroller so
     position:sticky engages natively (zero-lag on compositor/touch scroll).
     height + negative margin-bottom make it exactly overlay the hidden
     in-grid thead, which remains as the column-width source. Its sticky
     containing block is the frame, so it releases with the table bottom. */
  .results-sticky-bar {
    position: sticky;

    /* Sticky insets resolve against the scroller's content-box top, i.e.
       BELOW .panel-right's padding — compensate so the bar sticks flush
       with the scrollport edge instead of leaving a padding-wide gap. */
    top: calc(-1 * var(--panel-pad-top, 0px));
    z-index: 4;
    height: var(--thead-h, 0);
    margin-bottom: calc(0px - var(--thead-h, 0px));
    overflow: clip;

    /* Keep the focus ring visible despite clipping. The default outline
       paints outside the border box; without a margin it would be clipped. */
    overflow-clip-margin: 4px;
    visibility: hidden;
    background: var(--bg-alt);
    border-bottom: 2px solid var(--border);
    border-radius: calc(var(--radius) - 1px) calc(var(--radius) - 1px) 0 0;
  }

  .results-sticky-bar.bar-ready {
    visibility: visible;
  }

  /* UA ring paints just OUTSIDE the border box — into the adjacent sibling
     cells / the bar's clip edge — where Firefox effectively hides it. Inset
     it like .results-td does so the native ring stays fully visible. */
  .results-th .sort-btn:focus-visible {
    outline-offset: -2px;
  }

  .sticky-strip {
    display: flex;
    width: max-content;
    will-change: transform;
  }

  /* Specificity must beat `.results-th { max-width: 20ch }` below: width
     comes from the measured grid track, which can legitimately exceed the
     header's own 20ch cap when few columns stretch to fill the container. */
  .results-th.sticky-th {
    flex: none;
    max-width: none;
  }

  .scroll-arrow {
    position: absolute;
    top: 7px;
    z-index: 3;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    padding: 0;
    border-radius: 50%;
    border: 1px solid var(--border-light);
    background: color-mix(in srgb, var(--white) 92%, transparent);
    box-shadow: var(--shadow);
    color: var(--text-secondary);
    cursor: pointer;
    opacity: 0;
    pointer-events: none;

    /* Arrows live inside the sticky bar, so they follow the header
       natively; `translate` only drives the slide-in animation. */
    transition:
      opacity 0.15s,
      translate 0.15s,
      color 0.15s,
      border-color 0.15s;
  }

  .scroll-arrow-left {
    left: 10px;
    translate: -4px 0;
  }

  .scroll-arrow-right {
    right: 10px;
    translate: 4px 0;
  }

  .scroll-arrow.visible {
    opacity: 1;
    pointer-events: auto;
    translate: 0 0;
  }

  .scroll-arrow:hover {
    color: var(--accent-strong);
    border-color: var(--accent-strong);
  }

  .results-table {
    display: grid;
    grid-auto-rows: auto;
    width: max-content;
    min-width: 100%;
    font-size: 0.8rem;
    background: var(--white);
  }

  /* Fill mode (no horizontal scrolling needed): pin the table to the
     container width — with caps removed, `width: max-content` would size
     it to the full content length and CREATE the overflow fill mode is
     meant to avoid (oscillating between modes). Uncapped cells then
     stretch with their tracks, which grid sizing distributes across the
     container up to each column's content length. */
  .results-table.fill {
    width: 100%;
  }

  .results-table.fill .results-th,
  .results-table.fill .results-td,
  .results-table.fill .cell-mini-cell {
    max-width: none;
  }

  .results-thead,
  .results-tr {
    display: grid;
    grid-template-columns: subgrid;
    grid-column: 1 / -1;
  }

  /* The in-grid thead is only the layout/width source; the visible header
     is the sticky bar (see .results-sticky-bar). Kept visible until the
     bar has been measured to avoid a headerless first frame. */
  .results-thead {
    background: var(--bg-alt);
    border-bottom: 2px solid var(--border);
  }

  .results-thead.thead-hidden {
    visibility: hidden;
  }

  .results-th {
    padding: 10px 14px;
    text-align: left;
    font-weight: 600;
    color: var(--text-secondary);
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    max-width: 20ch;
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .results-th.sortable {
    user-select: none;
    padding: 0;
  }

  .results-th.sortable .sort-btn {
    display: flex;
    align-items: center;
    padding: 10px 14px;
    cursor: pointer;
    transition: background 0.15s;
  }

  .results-th .th-label {
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .results-th.sortable .sort-btn:hover {
    background: var(--accent-light);
    color: var(--text);
  }

  .results-th:first-child {
    border-top-left-radius: calc(var(--radius) - 1px);
  }

  .results-th:last-child {
    border-top-right-radius: calc(var(--radius) - 1px);
  }

  .results-th :global(svg) {
    font-size: 0.65rem;
    margin-left: 4px;
    opacity: 0.7;
    vertical-align: middle;
    flex-shrink: 0;
  }

  .results-td {
    padding: 8px 14px;
    border-bottom: 1px solid var(--bg-alt);
    max-width: 20ch;
    min-width: 0;
    overflow-wrap: anywhere;
  }

  .results-tr {
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
    /* Window is the scroller in the narrow layout: stick below the sticky
       site header (z-index 100), which would otherwise cover the bar. */
    .results-sticky-bar {
      top: var(--header-h);
      border-radius: 0;
    }

    .results-table-frame {
      margin-left: calc(-1 * max(24px, env(safe-area-inset-left)));
      margin-right: calc(-1 * max(24px, env(safe-area-inset-right)));
      border-radius: 0;
      border-inline: 0;
    }

    .results-th:first-child,
    .results-th:last-child {
      border-radius: 0;
    }

    .scroll-arrow-left {
      left: 6px;
    }

    .scroll-arrow-right {
      right: 6px;
    }

    /* Narrow layout scrolls the window, so keep the loader compact. */
    .results-loading {
      min-height: 40vh;
    }
  }

  @media (horizontal-viewport-segments: 2), (vertical-viewport-segments: 2) {
    .results-sticky-bar {
      top: calc(-1 * var(--panel-pad-top, 0px));
    }

    .results-table-frame {
      margin-left: 0;
      margin-right: 0;
      border-radius: var(--radius);
      border: 1px solid var(--border-light);
    }

    .scroll-arrow-left {
      left: 10px;
    }

    .scroll-arrow-right {
      right: 10px;
    }
  }
</style>
