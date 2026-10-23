<script>
  import { MorphIcon } from "morphicons/svelte";
  import {
    ArrowUpDown,
    ArrowDownWideNarrow,
    ArrowDownNarrowWide,
    ChevronLeft,
    ChevronRight,
  } from "lucide";
  import ResultTableBody from "./ResultTableBody.svelte";
  import { headerId } from "./result-table-utils.js";

  let {
    rows,
    displayCols,
    bodyCols,
    cellScrollEpoch,
    host,
    patterns,
    sort,
    onSort,
  } = $props();

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
    void rows.length;
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

  function sortIcon(di) {
    const dc = displayCols[di];
    const active = sort.col === dc.ci && sort.field === dc.field;
    if (active) return sort.asc ? ArrowDownNarrowWide : ArrowDownWideNarrow;
    return ArrowUpDown;
  }

  function isSortPlaceholder(di) {
    const dc = displayCols[di];
    return !(sort.col === dc.ci && sort.field === dc.field);
  }
</script>

<!-- Shared header cell, rendered in two places: the sticky bar (width =
     measured px) and the in-grid thead (width = null, natural sizing that
     drives column widths). -->
{#snippet headerCell(dc, di, width)}
  <div
    class="results-th sortable"
    class:sticky-th={width !== null}
    class:sort-asc={sort.col === dc.ci && sort.field === dc.field && sort.asc}
    class:sort-desc={sort.col === dc.ci && sort.field === dc.field && !sort.asc}
    role="columnheader"
    aria-sort={sort.col === dc.ci && sort.field === dc.field
      ? sort.asc
        ? "ascending"
        : "descending"
      : "none"}
    title={`${dc.label}${sort.col === dc.ci && sort.field === dc.field ? (sort.asc ? "（升序）" : "（降序）") : ""}`}
    style:width={width === null ? undefined : `${width}px`}
  >
    <span
      class="sort-btn"
      onclick={() => onSort(di)}
      onkeydown={(e) => e.key === "Enter" && onSort(di)}
      tabindex="0"
      role="button"
      aria-label={`按${dc.label}排序${sort.col === dc.ci && sort.field === dc.field ? (sort.asc ? "，当前升序" : "，当前降序") : ""}`}
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
    <div class="sticky-strip" bind:this={stripEl} onfocusin={handleStripFocus}>
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
      <ResultTableBody
        {rows}
        {bodyCols}
        {displayCols}
        {cellScrollEpoch}
        {host}
        {patterns}
      />
    </div>
  </div>
</div>

<style>
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

  .results-table.fill .results-th {
    max-width: none;
  }

  /* The in-grid thead is only the layout/width source; the visible header
     is the sticky bar (see .results-sticky-bar). Kept visible until the
     bar has been measured to avoid a headerless first frame. */
  .results-thead {
    display: grid;
    grid-template-columns: subgrid;
    grid-column: 1 / -1;
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

  .results-th :global(svg) {
    font-size: 0.65rem;
    margin-left: 4px;
    opacity: 0.7;
    vertical-align: middle;
    flex-shrink: 0;
  }

  @media (forced-colors: active) {
    .results-sticky-bar {
      border-radius: calc(var(--radius) - 1px) calc(var(--radius) - 1px) 0 0;
    }

    .results-th:first-child {
      border-top-left-radius: calc(var(--radius) - 1px);
    }

    .results-th:last-child {
      border-top-right-radius: calc(var(--radius) - 1px);
    }
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

    .results-table,
    .sticky-strip {
      padding-left: env(safe-area-inset-left);
      padding-right: env(safe-area-inset-right);
    }

    .results-th:first-child,
    .results-th:last-child {
      border-radius: 0;
    }

    .scroll-arrow-left {
      left: calc(6px + env(safe-area-inset-left));
    }

    .scroll-arrow-right {
      right: calc(6px + env(safe-area-inset-right));
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

    .results-table,
    .sticky-strip {
      padding-left: 0;
      padding-right: 0;
    }

    .scroll-arrow-left {
      left: 10px;
    }

    .scroll-arrow-right {
      right: 10px;
    }
  }
</style>
