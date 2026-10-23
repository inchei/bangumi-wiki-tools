<script>
  import { onDestroy } from "svelte";
  import {
    outputColumns,
    sortRules,
    resultLimit,
    assocLimit,
    RESULT_LIMIT_DEFAULT,
    ASSOC_LIMIT_DEFAULT,
    queryTarget,
    subjectRootLogic,
    personRootLogic,
    characterRootLogic,
    episodeRootLogic,
    announce,
    resetStructureVersions,
  } from "../stores.js";
  import { getFiltersForAPI, applyFiltersFromAPI } from "../logic-tree.js";
  import { filtersToYAML, parseYAML, validateConfig } from "../yaml.js";
  import { get } from "svelte/store";
  import { MorphIcon } from "morphicons/svelte";
  import { ChevronDown, ChevronUp } from "lucide";

  const INDENT = "  ";
  const FLASH_MS = 1500;

  let expanded = $state(false);
  let yamlText = $state("");
  let dirty = $state(false);
  let undoState = $state(null);
  let taEl = $state(null);

  let appliedFlash = $state(false);
  let syncedFlash = $state(false);
  let copyFlash = $state(false);
  let applyTimer = 0;
  let syncTimer = 0;
  let copyTimer = 0;

  function pulse(which) {
    if (which === "apply") {
      appliedFlash = true;
      announce("已应用当前配置");
      clearTimeout(applyTimer);
      applyTimer = setTimeout(() => {
        appliedFlash = false;
      }, FLASH_MS);
    } else {
      syncedFlash = true;
      announce("已从筛选器同步配置");
      clearTimeout(syncTimer);
      syncTimer = setTimeout(() => {
        syncedFlash = false;
      }, FLASH_MS);
    }
  }

  function copyYaml() {
    const copy = (text) => {
      const t = document.createElement("textarea");
      t.value = text;
      t.style.position = "fixed";
      t.style.opacity = "0";
      document.body.appendChild(t);
      t.select();
      let ok;
      try {
        ok = document.execCommand("copy");
      } catch {
        ok = false;
      }
      t.remove();
      return ok;
    };
    const text = yamlText;
    if (navigator.clipboard?.writeText)
      navigator.clipboard.writeText(text).catch(() => copy(text));
    else copy(text);
    copyFlash = true;
    announce("已复制 YAML");
    clearTimeout(copyTimer);
    copyTimer = setTimeout(() => {
      copyFlash = false;
    }, FLASH_MS);
  }

  onDestroy(() => {
    clearTimeout(applyTimer);
    clearTimeout(syncTimer);
    clearTimeout(copyTimer);
  });

  function syncFromFilters() {
    dirty = false;
    try {
      yamlText = filtersToYAML(
        get(queryTarget),
        getFiltersForAPI(),
        get(outputColumns),
        get(resultLimit),
        get(sortRules),
        get(assocLimit),
      );
      pulse("sync");
      if (taEl) {
        taEl.focus();
        const end = taEl.value.length;
        taEl.setSelectionRange(end, end);
      }
    } catch (e) {
      alert("导出失败: " + e.message);
    }
  }

  function handleApply() {
    if (!yamlText.trim()) {
      alert("YAML 内容为空");
      return;
    }
    let data;
    try {
      data = parseYAML(yamlText);
    } catch (e) {
      alert("解析失败: " + e.message);
      return;
    }
    const errors = validateConfig(data);
    if (errors.length > 0) {
      const shown = errors.slice(0, 5).join("\n");
      const more = errors.length > 5 ? `\n…等共 ${errors.length} 处` : "";
      alert("配置有误:\n" + shown + more);
      return;
    }
    undoState = {
      target: get(queryTarget),
      filters: getFiltersForAPI(),
      columns: get(outputColumns),
      sort: get(sortRules),
      limit: get(resultLimit),
      assocLimit: get(assocLimit),
    };
    dirty = false;
    // Full replace: the YAML is the whole config — settings it omits reset
    // to defaults. Scoped to the current target (its filter tree; the target
    // itself only switches when the YAML specifies one).
    if (data.target) queryTarget.set(data.target);
    applyFiltersFromAPI(data.filters ?? []);
    outputColumns.set((data.output?.columns ?? []).join(","));
    sortRules.set(data.sort ?? []);
    resultLimit.set(data.limit ?? RESULT_LIMIT_DEFAULT);
    assocLimit.set(
      data.assocLimit != null
        ? Math.min(
            100,
            Math.max(1, Number(data.assocLimit) || ASSOC_LIMIT_DEFAULT),
          )
        : data.output?.assoc_limit != null
          ? Math.min(
              100,
              Math.max(
                1,
                Number(data.output.assoc_limit) || ASSOC_LIMIT_DEFAULT,
              ),
            )
          : ASSOC_LIMIT_DEFAULT,
    );
    pulse("apply");
    resetStructureVersions();
    document.getElementById("btn-run")?.focus();
  }

  function handleUndo() {
    if (!undoState) return;
    const u = undoState;
    undoState = null;
    announce("已撤销 YAML 更改");
    dirty = false;
    queryTarget.set(u.target);
    applyFiltersFromAPI(u.filters);
    outputColumns.set(u.columns);
    sortRules.set(u.sort);
    resultLimit.set(u.limit);
    if (u.assocLimit != null) assocLimit.set(u.assocLimit);
    resetStructureVersions();
  }

  $effect(() => {
    const target = $queryTarget;
    const cols = $outputColumns;
    const lim = $resultLimit;
    const al = $assocLimit;
    const sr = $sortRules;
    void $subjectRootLogic;
    void $personRootLogic;
    void $characterRootLogic;
    void $episodeRootLogic;
    if (!expanded || dirty) return;
    try {
      yamlText = filtersToYAML(target, getFiltersForAPI(), cols, lim, sr, al);
    } catch (e) {
      console.error("YAML 自动同步失败: " + e.message);
    }
  });

  function replaceRange(el, start, end, text, selStart, selEnd) {
    el.focus();
    el.setSelectionRange(start, end);
    let ok;
    try {
      ok = document.execCommand("insertText", false, text);
    } catch {
      ok = false;
    }
    if (!ok) {
      const v = el.value;
      el.value = v.slice(0, start) + text + v.slice(end);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }
    const caret = selStart ?? start + text.length;
    el.setSelectionRange(caret, selEnd ?? caret);
  }

  function deleteRange(el, start, end) {
    el.focus();
    el.setSelectionRange(start, end);
    let ok;
    try {
      ok = document.execCommand("delete", false);
    } catch {
      ok = false;
    }
    if (!ok) {
      const v = el.value;
      el.value = v.slice(0, start) + v.slice(end);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.setSelectionRange(start, start);
    }
  }

  function handleKeyDown(e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.isComposing || e.keyCode === 229) return;
    if (e.key === "Enter") onEnter(e);
    else if (e.key === "Backspace") onBackspace(e);
  }

  function onEnter(e) {
    e.preventDefault();
    const el = e.currentTarget;
    const v = el.value;
    const s = el.selectionStart;
    const t = el.selectionEnd;
    const lineStart = v.lastIndexOf("\n", s - 1) + 1;
    const line = v.slice(lineStart, s);
    const ws = /^[ \t]*/.exec(line)[0];
    const body = line.trimEnd();
    const deeper = body.endsWith(":") || body.trim() === "-" ? INDENT : "";
    replaceRange(el, s, t, "\n" + ws + deeper);
  }

  function onBackspace(e) {
    const el = e.currentTarget;
    const v = el.value;
    const s = el.selectionStart;
    if (s !== el.selectionEnd) return;
    if (s === 0) return;
    const lineStart = v.lastIndexOf("\n", s - 1) + 1;
    const prefix = v.slice(lineStart, s);
    if (/\S/.test(prefix)) return;
    const cut = Math.min(INDENT.length, prefix.length);
    if (cut === 0) return;
    e.preventDefault();
    deleteRange(el, s - cut, s);
  }
</script>

<div class="card" class:collapsed={!expanded}>
  <div
    class="card-header yaml-toggle"
    onclick={() => (expanded = !expanded)}
    role="button"
    tabindex="0"
    aria-expanded={expanded}
    onkeydown={(e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        expanded = !expanded;
      }
    }}
  >
    <h2 class="card-title">YAML 配置</h2>
    <span class="yaml-chevron">
      <MorphIcon
        icon={expanded ? ChevronUp : ChevronDown}
        size={16}
        reducedMotion="always"
      />
    </span>
  </div>
  {#if expanded}
    <div class="yaml-editor-wrap">
      <textarea
        class="yaml-editor"
        bind:this={taEl}
        bind:value={yamlText}
        oninput={() => (dirty = true)}
        onkeydown={handleKeyDown}
        spellcheck="false"
        autocapitalize="off"
        autocorrect="off"
        placeholder="在此编辑 YAML 配置..."></textarea>
    </div>
    <div class="yaml-actions">
      <div class="yaml-actions-left">
        <button class="btn btn-primary btn-sm" onclick={handleApply}>
          {appliedFlash ? "已应用" : "应用"}
        </button>
        {#if undoState}
          <button class="btn btn-default btn-sm" onclick={handleUndo}
            >撤销</button
          >
        {/if}
        <button class="btn btn-default btn-sm" onclick={copyYaml}>
          {copyFlash ? "已复制" : "复制"}
        </button>
      </div>
      <button class="btn btn-default btn-sm" onclick={syncFromFilters}>
        {syncedFlash ? "已同步" : "同步当前配置"}
      </button>
    </div>
  {/if}
</div>

<style>
  .collapsed .card-header {
    margin-bottom: 0;
  }

  .yaml-toggle {
    cursor: pointer;
    user-select: none;
  }

  .yaml-chevron {
    margin-left: auto;
    color: var(--text-secondary);
    display: flex;
    align-items: center;
  }

  /* Outer panel owns the rounded corners and clips the scrolling textarea,
     so the scrollbar track never paints over the corners. */
  .yaml-editor-wrap {
    border: 1px solid var(--border);
    border-radius: var(--radius-xs);
    background: var(--white);
    overflow: hidden;
  }

  .yaml-editor-wrap:focus-within {
    border-color: var(--accent-strong);
    box-shadow: 0 0 0 2px rgb(240 145 153 / 15%);
  }

  .yaml-editor {
    display: block;
    width: 100%;
    min-height: 200px;
    font-family: var(--font-mono);
    font-size: 0.75rem;
    padding: 11px;
    border: none;
    border-radius: 0;
    resize: vertical;
    outline: none;
    background: transparent;
    color: var(--text);
    line-height: 1.6;
    tab-size: 2;
  }

  /* iOS Safari auto-zooms on focus when form text < 16px: phones only */
  @media (pointer: coarse) and (width < 768px) {
    .yaml-editor {
      font-size: 1rem;
    }
  }

  @media (pointer: coarse) and (orientation: landscape) and (width < 1024px) {
    .yaml-editor {
      font-size: 1rem;
    }
  }

  .yaml-actions {
    margin-top: 8px;
    display: flex;
    justify-content: space-between;
    gap: 8px;
    align-items: center;
  }

  .yaml-actions-left {
    display: flex;
    gap: 8px;
  }
</style>
