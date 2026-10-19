<script>
  import { beginKeyboardDrag, beginPointerDrag } from "../dnd.js";
  import { MorphIcon } from "morphicons/svelte";
  import { GripVertical } from "lucide";

  /** @type {{ sourceId: number, kind: string, entry: object, label: string }} */
  let { sourceId, kind, entry, label } = $props();

  let btn;

  function source() {
    return {
      sourceId,
      kind,
      entry,
      label,
      sourceCtx: btn?.closest("[data-logic-id]")?.dataset.dndCtx || "",
    };
  }

  function onPointerDown(e) {
    if (e.button !== 0) return;
    beginPointerDrag(btn, e, source());
  }

  function onKeydown(e) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      beginKeyboardDrag(btn, source());
    }
  }
</script>

<button
  bind:this={btn}
  type="button"
  class="drag-handle"
  title="拖动排序"
  draggable="false"
  aria-label={`拖动：${label}`}
  aria-describedby="dnd-lift-help"
  data-dnd-handle={sourceId}
  onpointerdown={onPointerDown}
  onkeydown={onKeydown}
  ondragstart={(e) => e.preventDefault()}
>
  <MorphIcon icon={GripVertical} size={12} />
</button>

<style>
  .drag-handle {
    appearance: none;
    background: none;
    border: none;
    cursor: grab;
    color: var(--text-placeholder);
    padding: 0;
    width: 24px;
    height: 24px;
    min-height: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    line-height: 1;
    flex-shrink: 0;
    touch-action: none;
  }

  .drag-handle:hover {
    color: var(--accent-strong);
  }

  .drag-handle:focus-visible {
    outline: 2px solid var(--accent-strong);
    outline-offset: 0;
  }
</style>
