<script>
  import { announce } from "../stores.js";

  let { width = $bindable(420) } = $props();

  const MIN = 280;
  const DEFAULT = 420;
  const STEP = 24;
  const STORE_KEY = "panelLeftWidth";

  let dragging = false;
  let vmax = $state(readMax());
  let raf = 0;
  let nextW = null;

  function readMax() {
    return Math.max(
      MIN,
      Math.floor(document.documentElement.clientWidth * 0.5),
    );
  }

  function clampW(w) {
    return Math.min(Math.max(MIN, Math.round(w)), vmax);
  }

  function persist() {
    try {
      localStorage.setItem(STORE_KEY, String(width));
    } catch {
      /* storage unavailable */
    }
  }

  function onMove(e) {
    nextW = clampW(drag.startW + (e.clientX - drag.startX));
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      if (nextW != null) width = nextW;
    });
  }

  let drag;
  function onPointerDown(e) {
    if (dragging || e.button !== 0) return;
    dragging = true;
    e.preventDefault();
    drag = { startX: e.clientX, startW: width };
    nextW = null;
    document.body.classList.add("splitter-dragging");
    window.addEventListener("pointermove", onMove, true);
    window.addEventListener("pointerup", endDrag, true);
    window.addEventListener("pointercancel", endDrag, true);
  }

  function endDrag() {
    if (!dragging) return;
    dragging = false;
    if (raf) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
    document.body.classList.remove("splitter-dragging");
    document.getSelection?.()?.removeAllRanges?.();
    window.removeEventListener("pointermove", onMove, true);
    window.removeEventListener("pointerup", endDrag, true);
    window.removeEventListener("pointercancel", endDrag, true);
    persist();
  }

  function onKeydown(e) {
    const k = e.key;
    let target;
    if (k === "ArrowLeft") target = width - STEP;
    else if (k === "ArrowRight") target = width + STEP;
    else if (k === "Home") target = MIN;
    else if (k === "End") target = vmax;
    else return;
    e.preventDefault();
    const clamped = clampW(target);
    if (clamped === width) {
      announce(`已到边界，左栏宽度 ${clamped} 像素`);
      return;
    }
    width = clamped;
    persist();
    announce(`左栏宽度 ${clamped} 像素`);
  }

  function onReset() {
    if (width === DEFAULT) return;
    width = DEFAULT;
    vmax = readMax();
    persist();
    announce("左栏宽度已恢复默认");
  }

  $effect(() => {
    vmax = readMax();
    const onResize = () => {
      vmax = readMax();
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  });
</script>

<div
  class="splitter"
  role="separator"
  tabindex="0"
  aria-orientation="vertical"
  aria-label="调整左栏宽度"
  aria-valuemin={MIN}
  aria-valuemax={vmax}
  aria-valuenow={Math.round(width)}
  aria-valuetext={`左栏宽度 ${Math.round(width)} 像素`}
  aria-describedby="splitter-help"
  onpointerdown={onPointerDown}
  ondblclick={onReset}
  onkeydown={onKeydown}
></div>
<div class="sr-only" id="splitter-help">
  按左右方向键调整宽度，Home 移到最小，End 移到最大，双击恢复默认宽度
</div>

<style>
  .splitter {
    flex: none;
    width: 10px;
    align-self: stretch;
    position: relative;
    cursor: col-resize;
    touch-action: none;
    background: transparent;
  }

  .splitter::before {
    content: "";
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    width: 2px;
    background: transparent;
  }

  .splitter:hover::before,
  .splitter:active::before,
  .splitter:focus-visible::before,
  :global(body.splitter-dragging) .splitter::before {
    background: var(--accent-strong);
  }

  .splitter:focus-visible {
    outline: 2px solid var(--accent-strong);
    outline-offset: 0;
  }

  @media (width <= 900px),
    (horizontal-viewport-segments: 2),
    (vertical-viewport-segments: 2) {
    .splitter {
      display: none;
    }
  }

  @media (forced-colors: active) {
    .splitter::before {
      background: CanvasText;
      width: 1px;
    }
  }
</style>
