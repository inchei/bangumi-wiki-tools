<script>
  import { onMount, tick } from "svelte";
  import { MorphIcon } from "morphicons/svelte";
  import { Sun, Moon, Book, User, Drama, Film } from "lucide";
  import {
    queryTarget,
    clearFilters,
    clearOutputSettings,
    captureClearSnapshot,
    restoreClearSnapshot,
    clearClearSnapshot,
    saveTargetSettings,
    restoreTargetSettings,
    subjectRootLogic,
    personRootLogic,
    characterRootLogic,
    episodeRootLogic,
    outputColumns,
    sortRules,
    resultLimit,
    manualAssoc,
    assocSeeded,
    sortState,
    liveMsg,
    getPendingDeleteExempt,
    purgeSortRulePendingDeletes,
    purgeManualAssocPendingDeletes,
    conditionStructureVersion,
    sortStructureVersion,
    assocStructureVersion,
  } from "./stores.js";
  import { purgeLogicPendingDeletes } from "./logic-tree.js";
  import { decodeShareState, applyShareState, SHARE_PARAM } from "./share.js";
  import FilterTree from "./components/FilterTree.svelte";
  import ResultTable from "./components/ResultTable.svelte";
  import YamlEditor from "./components/YamlEditor.svelte";
  import QuerySettings from "./components/QuerySettings.svelte";
  import PanelSplitter from "./components/PanelSplitter.svelte";

  let themeMode = $state("system");

  const SPLIT_DEFAULT = 420;
  const STORE_LEFT_WIDTH = "panelLeftWidth";
  let leftWidth = $state(initLeftWidth());

  function initLeftWidth() {
    try {
      const stored = Number(localStorage.getItem(STORE_LEFT_WIDTH));
      if (Number.isFinite(stored) && stored >= 280 && stored <= 5000) {
        return stored;
      }
    } catch {
      /* storage unavailable */
    }
    return SPLIT_DEFAULT;
  }

  $effect(() => {
    const apply = () => {
      const max = Math.max(280, Math.floor(window.innerWidth * 0.5));
      document.documentElement.style.setProperty(
        "--panel-left-w",
        `${Math.min(Math.round(leftWidth), max)}px`,
      );
    };
    apply();
    window.addEventListener("resize", apply);
    return () => window.removeEventListener("resize", apply);
  });

  // Sprite logo: horizontal strip, only X changes
  const spriteCols = 7;
  const col = Math.floor(Math.random() * spriteCols);
  let logoX = $state(-col * 40);
  const logoY = 0;

  function cycleLogo() {
    const currentCol = Math.round(-logoX / 40);
    const nextCol = (currentCol + 1) % spriteCols;
    logoX = -nextCol * 40;
  }

  function applyTheme(mode) {
    const isDark =
      mode === "dark" ||
      (mode === "system" &&
        window.matchMedia("(prefers-color-scheme: dark)").matches);
    if (isDark) {
      document.documentElement.setAttribute("data-theme", "dark");
    } else {
      document.documentElement.removeAttribute("data-theme");
    }
  }

  function systemTheme() {
    return window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  }

  function resolvedTheme() {
    return themeMode === "system" ? systemTheme() : themeMode;
  }

  function cycleTheme() {
    if (themeMode === "system") {
      // Following the system theme: toggle to the opposite of what's visible
      // and store the literal value.
      themeMode = systemTheme() === "dark" ? "light" : "dark";
      localStorage.setItem("theme", themeMode);
    } else {
      // Explicit override: toggle to the opposite. If that happens to match
      // the system default, go back to system and remove the stored value.
      const next = themeMode === "dark" ? "light" : "dark";
      if (next === systemTheme()) {
        themeMode = "system";
        localStorage.removeItem("theme");
      } else {
        themeMode = next;
        localStorage.setItem("theme", themeMode);
      }
    }
    applyTheme(themeMode);
  }

  function setTarget(t) {
    saveTargetSettings();
    queryTarget.set(t);
    restoreTargetSettings(t);
  }

  let canUndo = $state(false);
  let ignoreNextChange = false;

  function clearAll() {
    if (canUndo) {
      restoreClearSnapshot();
      canUndo = false;
      return;
    }
    captureClearSnapshot();
    ignoreNextChange = true;
    clearFilters();
    clearOutputSettings();
    canUndo = true;
    tick().then(() => {
      ignoreNextChange = false;
    });
  }

  // Clear-all undo window: any mutation besides the clear itself invalidates it.
  $effect(() => {
    void $subjectRootLogic;
    void $personRootLogic;
    void $characterRootLogic;
    void $episodeRootLogic;
    void $outputColumns;
    void $sortRules;
    void $resultLimit;
    void $manualAssoc;
    void $assocSeeded;
    void $sortState;
    void $queryTarget;
    if (canUndo && !ignoreNextChange) {
      clearClearSnapshot();
      canUndo = false;
    }
  });

  // Pending-delete undo windows: only expire when the same scope adds/removes
  // an item. Edits within the scope keep the undo opportunity.
  let prevConditionVersion = 0;
  let prevSortVersion = 0;
  let prevAssocVersion = 0;
  $effect(() => {
    const cv = $conditionStructureVersion;
    const sv = $sortStructureVersion;
    const av = $assocStructureVersion;
    const exempt = getPendingDeleteExempt();
    if (cv !== prevConditionVersion) {
      prevConditionVersion = cv;
      purgeLogicPendingDeletes(exempt);
    }
    if (sv !== prevSortVersion) {
      prevSortVersion = sv;
      purgeSortRulePendingDeletes(exempt);
    }
    if (av !== prevAssocVersion) {
      prevAssocVersion = av;
      purgeManualAssocPendingDeletes(exempt);
    }
  });

  onMount(async () => {
    // Guard against the global color transition flashing on load while the
    // saved/system theme is being applied (see html.no-transitions in
    // global.css); re-enable after the initial paint.
    const root = document.documentElement;
    root.classList.add("no-transitions");

    // Restore theme
    const saved = localStorage.getItem("theme");
    if (saved === "dark" || saved === "light") {
      themeMode = saved;
    }
    applyTheme(themeMode);

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        root.classList.remove("no-transitions");
      });
    });

    // Listen for system theme changes
    window
      .matchMedia("(prefers-color-scheme: dark)")
      .addEventListener("change", () => {
        if (themeMode === "system") applyTheme("system");
      });

    // Restore query from share link (?q=<payload>)
    const payload = new URLSearchParams(window.location.search).get(
      SHARE_PARAM,
    );
    if (payload) {
      try {
        const state = await decodeShareState(payload);
        applyShareState(state);
      } catch (e) {
        console.error("分享链接还原失败，已忽略:", e);
      }
    }
  });
</script>

<!-- Header -->
<header class="header">
  <div class="header-logo">
    <div
      class="logo-sprite"
      style="background-position: {logoX}px {logoY}px"
      onclick={cycleLogo}
      aria-hidden="true"
    ></div>
    <h1 class="app-name">Bangumi Query</h1>
  </div>
  <div class="header-actions">
    <a
      class="btn btn-default"
      href="https://github.com/inchei/bangumi-wiki-tools/tree/main/bgq"
      target="_blank"
      rel="noopener"
      title="GitHub"
    >
      <svg
        viewBox="0 0 24 24"
        width="16"
        height="16"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        style="transform: translateY(1px)"
        ><path
          d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"
        /></svg
      >
    </a>
    <button
      class="btn btn-default"
      onclick={cycleTheme}
      title="主题: {resolvedTheme() === 'dark' ? '深色' : '浅色'}"
      aria-label="切换主题"
    >
      <MorphIcon icon={resolvedTheme() === "light" ? Sun : Moon} size={16} />
    </button>
  </div>
</header>

<!-- Main Container -->
<main class="container">
  <span class="sr-only" role="status">{$liveMsg}</span>
  <div class="sr-only" id="dnd-lift-help">按 Enter 或空格拿取</div>
  <!-- Left Panel -->
  <div class="panel panel-left">
    <div class="target-toggle-bar">
      <div class="target-toggle" role="radiogroup" aria-label="查询类型">
        <label class="radio-pill" class:active={$queryTarget === "subject"}>
          <input
            class="sr-radio"
            type="radio"
            name="target"
            value="subject"
            checked={$queryTarget === "subject"}
            onchange={() => setTarget("subject")}
          /><MorphIcon icon={Book} size={14} /> 条目</label
        >
        <label class="radio-pill" class:active={$queryTarget === "person"}>
          <input
            class="sr-radio"
            type="radio"
            name="target"
            value="person"
            checked={$queryTarget === "person"}
            onchange={() => setTarget("person")}
          /><MorphIcon icon={User} size={14} /> 人物</label
        >
        <label class="radio-pill" class:active={$queryTarget === "character"}>
          <input
            class="sr-radio"
            type="radio"
            name="target"
            value="character"
            checked={$queryTarget === "character"}
            onchange={() => setTarget("character")}
          /><MorphIcon icon={Drama} size={14} /> 角色</label
        >
        <label class="radio-pill" class:active={$queryTarget === "episode"}>
          <input
            class="sr-radio"
            type="radio"
            name="target"
            value="episode"
            checked={$queryTarget === "episode"}
            onchange={() => setTarget("episode")}
          /><MorphIcon icon={Film} size={14} /> 剧集</label
        >
      </div>
      <button class="btn btn-outline btn-xs" onclick={clearAll}
        >{canUndo ? "撤销" : "清空"}</button
      >
    </div>
    <div class="card card-filter">
      <div class="card-header">
        <h2 class="card-title">筛选条件</h2>
      </div>
      <FilterTree />
    </div>

    <QuerySettings />
    <YamlEditor />
  </div>

  <PanelSplitter bind:width={leftWidth} />

  <!-- Right Panel -->
  <div class="panel panel-right">
    <ResultTable />
  </div>
</main>

<style>
  /* ===== Header ===== */
  .header {
    background: var(--white);
    border-bottom: 1px solid var(--border);
    padding-left: max(24px, env(safe-area-inset-left));
    padding-right: max(24px, env(safe-area-inset-right));
    height: var(--header-h);
    display: flex;
    align-items: center;
    gap: 20px;
    box-shadow: var(--shadow);
    position: sticky;
    top: 0;
    z-index: 100;

    .btn {
      padding: 0;
      border: none;
      font-size: 1rem;
      min-width: 30px;
    }
  }

  .header-logo {
    font-size: 1.15rem;
    font-weight: 700;
    color: var(--text);
    display: flex;
    align-items: center;
  }

  /* Real h1 for the app name; reset UA heading styles to inherit the
     header-logo typography above. */
  .app-name {
    margin: 0;
    font-size: inherit;
    font-weight: inherit;
  }

  .logo-sprite {
    width: 40px;
    height: 50px;
    background: url("/img/bg_musume_2x.png") no-repeat;
    background-size: 280px 75px;
    border-radius: var(--radius-xs);
  }

  @media (width <= 320px) {
    .logo-sprite {
      display: none;
    }
  }

  .header-actions {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-left: auto;
  }

  /* ===== Layout ===== */
  :global(.container) {
    display: flex;
    height: calc(100vh - var(--header-h));
  }

  :global(.panel) {
    overflow-y: auto;
  }

  :global(.panel-left) {
    width: var(--panel-left-w, 420px);
    min-width: 280px;
    background: var(--white);
    padding: 20px 15px;
    padding-left: max(15px, env(safe-area-inset-left));
    padding-right: max(15px, env(safe-area-inset-right));
    display: flex;
    flex-direction: column;
    gap: 20px;
    scrollbar-gutter: stable both-edges;
  }

  :global(.panel-right) {
    flex: 1;
    background: var(--bg);
    padding: 20px 24px;
    padding-left: max(24px, env(safe-area-inset-left));
    padding-right: max(24px, env(safe-area-inset-right));

    /* ResultTable's sticky header bar compensates for this padding:
       sticky insets resolve against the scroller's content-box top, so the
       bar uses top: calc(-1 * var(--panel-pad-top)) to stick flush with the
       scrollport edge. Keep the two in sync. */
    --panel-pad-top: 20px;
  }

  .target-toggle-bar {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .target-toggle-bar .btn {
    margin-left: auto;
  }

  .target-toggle-bar :global(.target-toggle) {
    margin-bottom: 0;
  }

  :global(.target-toggle) {
    display: flex;
    gap: 6px;
    margin-bottom: 12px;
  }

  /* ===== Responsive ===== */
  @media (width <= 900px) {
    :global(.container) {
      flex-direction: column;
      height: auto;
      min-height: calc(100vh - var(--header-h));
    }

    :global(.panel-left) {
      width: 100%;
      min-width: 100%;
      max-height: none;
      overflow-y: visible;
      border-right: 1px solid var(--border);
    }

    :global(.panel-right) {
      flex: none;
      overflow-y: visible;
    }
  }

  /* ===== Foldable / dual-screen ===== */
  @media (horizontal-viewport-segments: 2) {
    :global(.container) {
      flex-direction: row;
      height: calc(100vh - var(--header-h));
      min-height: calc(100vh - var(--header-h));
    }

    :global(.panel-left) {
      width: env(viewport-segment-width 0 0, 50vw);
      min-width: 0;
      max-width: none;
      flex: none;
      overflow-y: auto;
      border-right: 1px solid var(--border);
    }

    :global(.panel-right) {
      width: env(viewport-segment-width 1 0, 50vw);
      min-width: 0;
      flex: none;
      overflow-y: auto;
      margin-left: calc(
        env(viewport-segment-left 1 0, 0px) -
          env(viewport-segment-right 0 0, 0px)
      );
    }
  }

  @media (vertical-viewport-segments: 2) {
    :global(.container) {
      flex-direction: column;
      height: calc(100vh - var(--header-h));
      min-height: calc(100vh - var(--header-h));
    }

    :global(.panel-left) {
      width: 100%;
      min-width: 0;
      max-height: none;
      height: calc(env(viewport-segment-height 0 0, 50vh) - var(--header-h));
      overflow-y: auto;
      border-right: 1px solid var(--border);
    }

    :global(.panel-right) {
      width: 100%;
      flex: none;
      height: env(viewport-segment-height 0 1, 50vh);
      overflow-y: auto;
      margin-top: calc(
        env(viewport-segment-top 0 1, 0px) -
          env(viewport-segment-bottom 0 0, 0px)
      );
    }
  }
</style>
