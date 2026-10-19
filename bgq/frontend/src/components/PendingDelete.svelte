<script>
  import { onMount } from "svelte";

  let {
    label,
    onUndo,
    margin = "0",
    focusOnMount = false,
    itemId = undefined,
    itemLabel = undefined,
  } = $props();

  let undoBtn = $state(null);

  onMount(() => {
    if (focusOnMount) undoBtn?.focus();
  });
</script>

<div
  class="pending-delete"
  style:margin
  data-item-id={itemId}
  data-item-label={itemLabel}
>
  <span class="pending-delete-label">{label}</span>
  <button bind:this={undoBtn} class="btn btn-outline btn-xs" onclick={onUndo}
    >撤销</button
  >
</div>

<style>
  .pending-delete {
    box-sizing: border-box;
    display: flex;
    align-items: center;
    justify-content: flex-end;
    min-height: 36px;
    padding: 0 6px;
    gap: 8px;
    border: 1px dashed var(--border-light);
    border-radius: 4px;
  }

  .pending-delete-label {
    font-size: 0.75rem;
    color: var(--text-muted);
    cursor: default;
  }
</style>
