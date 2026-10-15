<script>
  import { onMount, untrack } from "svelte";
  import Awesomplete from "awesomplete";

  /**
   * @type {{
   *   value?: string,
   *   suggestions?: string[],
   *   onchange?: (v: string) => void,
   *   placeholder?: string,
   *   restrict?: boolean,
   *   multiple?: boolean,
   *   separator?: string,
   *   id?: undefined | string,
   *   maxItems?: number,
   *   getTokenList?: null | ((
   *     token: string,
   *     inner: { fieldFragment: string } | null,
   *   ) => string[]),
   *   disabled?: boolean,
   *   sort?: false | undefined
   * }}
   */
  let {
    value = "",
    suggestions = [],
    onchange = () => {},
    oninput = () => {},
    placeholder = "",
    restrict = false,
    multiple = false,
    separator = ",",
    id = undefined,
    maxItems = Infinity,
    getTokenList = null,
    disabled = false,
    // Accessible name; falls back to the placeholder text.
    label = "",
    // Awesomplete sort option; false keeps the caller's list order (e.g.
    // priority-pinned items) instead of the default length-based sort.
    sort = undefined,
  } = $props();

  let inputEl;
  let aw = $state(null);
  let tabPressed = false;
  let isComposing = false;
  // eslint-disable-next-line svelte/prefer-writable-derived -- lastValidValue is also mutated in event handlers
  let lastValidValue = $state(untrack(() => value));
  $effect(() => {
    lastValidValue = value;
  });

  // Keep Awesomplete list in sync when suggestions prop changes (dynamic
  // per-token lists via getTokenList manage aw.list themselves).
  $effect(() => {
    if (aw && !getTokenList) {
      aw.list = suggestions;
    }
  });

  // Token at the cursor (whole value when not multiple). For multiple
  // inputs this is the comma-separated column (or pipe-separated field)
  // under the caret, so editing a middle column still triggers the correct
  // dynamic list (e.g. third-stage inside `{}`).
  function currentToken() {
    if (!inputEl) return "";
    const v = inputEl.value;
    if (!multiple) return v;
    const cursor = inputEl.selectionStart ?? v.length;
    const left = v.lastIndexOf(separator, cursor - 1);
    const right = v.indexOf(separator, cursor);
    const start = left === -1 ? 0 : left + 1;
    const end = right === -1 ? v.length : right;
    return v.slice(start, end);
  }

  // When the caret is inside `{...}` of the current column (e.g.
  // `导演.{id|name}+`), the field fragment between `|`s under the caret is the
  // effective token. Returns null when the caret is outside braces.
  function getInnerFieldInfo() {
    if (!inputEl || !multiple || !getTokenList) return null;
    const val = inputEl.value;
    const cursor = inputEl.selectionStart ?? val.length;
    const left = val.lastIndexOf(separator, cursor - 1);
    const right = val.indexOf(separator, cursor);
    const colStart = left === -1 ? 0 : left + 1;
    const colEnd = right === -1 ? val.length : right;
    const col = val.slice(colStart, colEnd);
    const bracePos = col.indexOf("{");
    if (bracePos === -1) return null;
    const closePos = col.indexOf("}", bracePos);
    const absBrace = colStart + bracePos;
    if (cursor <= absBrace) return null;
    if (closePos !== -1 && cursor > colStart + closePos) return null;
    // Content between braces; closePos is col-relative.
    const content =
      closePos === -1
        ? col.slice(bracePos + 1)
        : col.slice(bracePos + 1, closePos);
    const innerCursor = cursor - (absBrace + 1);
    const leftPipe = content.lastIndexOf("|", innerCursor - 1);
    const rightPipe = content.indexOf("|", innerCursor);
    const fieldStart = leftPipe === -1 ? 0 : leftPipe + 1;
    const fieldEnd = rightPipe === -1 ? content.length : rightPipe;
    const dotPos = col.indexOf(".");
    const prefix = dotPos === -1 ? "" : col.slice(0, dotPos).trim();
    if (!prefix) return null;
    return {
      fieldFragment: content.slice(fieldStart, fieldEnd).trim(),
      fieldStartAbs: absBrace + 1 + fieldStart,
      fieldEndAbs: absBrace + 1 + fieldEnd,
      // Synthetic lister token: the group with the fragment under the caret
      // blanked out, so suggestions exclude all OTHER existing members.
      synthetic:
        prefix + ".{" + content.slice(0, fieldStart) + content.slice(fieldEnd),
    };
  }

  function updateDynamicList() {
    if (!aw || !getTokenList) return;
    const inner = getInnerFieldInfo();
    // `inner` is non-null while the caret is inside "{...}" of a group column;
    // callers use it to tell stage-3 (field fragment) from whole-token stages.
    aw.list = getTokenList(inner ? inner.synthetic : currentToken(), inner);
  }

  // A suggestion ending in "{" or "|" (or ".") is a continuation into a
  // deeper completion stage — don't close the token with a separator.
  function isContinuation(text) {
    return /[{|.]$/.test(text);
  }

  // Text of the most recently picked suggestion (set in opts.replace), used
  // by selectcomplete to decide whether to reopen for the next stage.
  let lastPicked = "";

  onMount(() => {
    if (!inputEl) return;
    const opts = {
      list: suggestions,
      minChars: 0,
      maxItems,
      autoFirst: true,
    };
    if (sort !== undefined) opts.sort = sort;
    if (multiple) {
      const sep = separator;
      // Inside braces, filter/highlight against the field fragment under the
      // caret; otherwise against the whole column under the caret.
      opts.filter = (text) => {
        const inner = getInnerFieldInfo();
        return Awesomplete.FILTER_CONTAINS(
          text,
          inner ? inner.fieldFragment : currentToken().trim(),
        );
      };
      opts.item = (text) => {
        const inner = getInnerFieldInfo();
        return Awesomplete.ITEM(
          text,
          inner ? inner.fieldFragment : currentToken().trim(),
        );
      };
      opts.replace = (text) => {
        lastPicked = text;
        // Field pick inside braces (stage-3 items are bare "字段|"): splice
        // the fragment under the caret instead of replacing the whole column.
        const inner = getInnerFieldInfo();
        if (inner && text.endsWith("|")) {
          const val = inputEl.value;
          const before = val.slice(0, inner.fieldStartAbs);
          const after = val.slice(inner.fieldEndAbs);
          inputEl.value = before + text + after;
          const pos = before.length + text.length;
          inputEl.setSelectionRange(pos, pos);
          return;
        }
        const val = inputEl.value;
        const cursor = inputEl.selectionStart;
        const left = val.lastIndexOf(sep, cursor - 1);
        const right = val.indexOf(sep, cursor);
        const start = left === -1 ? 0 : left + 1;
        const end = right === -1 ? val.length : right;
        const before = val.slice(0, start);
        const after = val.slice(end);
        inputEl.value = isContinuation(text)
          ? before + text + after
          : (before + text + sep + after).replace(/,\s*,/g, ",");
        // Move the caret to the end of the inserted text so a stage-2 pick
        // ("前缀.{") lands INSIDE the braces and stage 3 can take over.
        const pos = before.length + text.length;
        inputEl.setSelectionRange(pos, pos);
      };
    }
    aw = new Awesomplete(inputEl, opts);
    inputEl.addEventListener("focus", () => {
      updateDynamicList();
      aw.evaluate();
    });
    inputEl.addEventListener("awesomplete-selectcomplete", () => {
      // Single-value inputs (e.g. association prefix) commit immediately so
      // dependent UI (field boxes) enables without waiting for blur.
      if (!multiple) {
        const trimmed = inputEl.value.trim();
        if (restrict) {
          if (trimmed && suggestions.includes(trimmed)) {
            lastValidValue = trimmed;
            onchange(trimmed);
          } else if (!trimmed) {
            lastValidValue = "";
            onchange("");
          } else {
            inputEl.value = lastValidValue;
            onchange(lastValidValue);
          }
        } else {
          lastValidValue = trimmed;
          onchange(trimmed);
        }
        oninput(inputEl.value);
      } else {
        // Multiple-value inputs (e.g. output columns) replace the token
        // programmatically without firing input, so sync immediately —
        // otherwise a query run right after picking reads the stale value.
        oninput(inputEl.value);
      }
      // Reopen for the next stage when the picked item was a continuation
      // ("前缀.{" opens stage 3; "字段|" continues the member list).
      if (!getTokenList) return;
      updateDynamicList();
      if (lastPicked && isContinuation(lastPicked)) aw.evaluate();
    });
    inputEl.addEventListener("keydown", (e) => {
      if (e.key === "Tab") {
        tabPressed = true;
        if (aw?.opened) aw.close();
      }
    });
    inputEl.addEventListener("compositionstart", () => {
      isComposing = true;
    });
    inputEl.addEventListener("compositionend", () => {
      isComposing = false;
      if (getTokenList) {
        updateDynamicList();
        aw.evaluate();
      }
      oninput(inputEl.value);
    });
    inputEl.addEventListener("input", () => {
      if (isComposing) return;
      // Awesomplete's own input listener runs first (registered in the
      // constructor above) and evaluates against the PREVIOUS token's list;
      // refresh the list for the current token and re-evaluate.
      if (getTokenList) {
        updateDynamicList();
        aw.evaluate();
      }
      oninput(inputEl.value);
    });
    // Keep the dynamic list in sync when the caret moves (click/arrow keys)
    // inside a comma-separated value; reopen only when entering braces, so
    // editing a middle column's `{}` surfaces the remaining fields.
    // Dropdown navigation keys (ArrowUp/Down/Enter/Tab) must NOT re-evaluate —
    // evaluate() re-renders the list and autoFirst resets the selection.
    inputEl.addEventListener("click", () => {
      if (!getTokenList) return;
      updateDynamicList();
      if (getInnerFieldInfo()) aw.evaluate();
    });
    const NAV_KEYS = new Set([
      "ArrowUp",
      "ArrowDown",
      "Enter",
      "Escape",
      "Tab",
    ]);
    inputEl.addEventListener("keyup", (e) => {
      if (!getTokenList || NAV_KEYS.has(e.key)) return;
      updateDynamicList();
      if (getInnerFieldInfo()) aw.evaluate();
    });
    inputEl.addEventListener("blur", () => {
      const d = tabPressed ? 0 : 150;
      tabPressed = false;
      setTimeout(() => {
        if (!inputEl) return;
        if (multiple) {
          const parts = inputEl.value
            .split(separator)
            .map((s) => s.trim())
            .filter(Boolean);
          const clean = restrict
            ? parts.filter((s) => suggestions.includes(s))
            : parts;
          const val = clean.length > 0 ? clean.join(separator) + separator : "";
          inputEl.value = val;
          onchange(val);
          lastValidValue = val;
          return;
        }
        if (restrict) {
          const trimmed = inputEl.value.trim();
          if (trimmed && suggestions.includes(trimmed)) {
            lastValidValue = trimmed;
            onchange(trimmed);
          } else {
            inputEl.value = lastValidValue;
            onchange(lastValidValue);
          }
        } else {
          onchange(inputEl.value.trim());
        }
      }, d);
    });
    return () => {
      aw = null;
    };
  });
</script>

<div class="aw-wrap">
  <input
    bind:this={inputEl}
    class="input aw-input"
    {value}
    {placeholder}
    {id}
    {disabled}
    aria-label={label || placeholder}
  />
</div>

<style>
  .aw-wrap :global(.awesomplete) {
    position: relative;
    display: inline-block;
  }

  .aw-input :global(~ ul) {
    position: absolute;
    left: 0;
    width: auto;
    z-index: 100;
    max-height: 200px;
    overflow-y: auto;
    background: var(--dropdown-bg);
    backdrop-filter: blur(10px);
    border: 1px solid var(--border);
    border-radius: 12px;
    box-shadow: var(--dropdown-shadow);
    list-style: none;
    padding: 4px 0;
    margin: 2px 0 0;
    font-size: 0.75rem;
    transition: none;
    animation: none;
    scrollbar-width: thin;
  }

  .aw-input :global(~ ul > li) {
    padding: 5px 10px;
    line-height: 20px;
    cursor: pointer;
    white-space: nowrap;
    color: var(--text);
    background: transparent;
    transition: none;
  }

  .aw-input :global(~ ul > li:hover) {
    background: var(--accent-light);
    color: var(--text);
  }

  .aw-input :global(~ ul > li[aria-selected="true"]) {
    background: var(--accent);
    color: #fff;
  }

  .aw-input :global(~ ul > li:hover mark) {
    background: transparent;
    color: var(--accent);
    font-weight: 600;
  }

  .aw-input :global(~ ul > li[aria-selected="true"] mark) {
    background: transparent;
    color: #fff;
    font-weight: 600;
  }

  .aw-input :global(~ ul > li mark) {
    background: transparent;
    color: var(--accent);
    font-weight: 600;
    padding: 0;
  }

  .aw-input :global(~ ul:empty) {
    display: none;
  }

  .aw-input :global(~ ul::before) {
    display: none;
  }
</style>
