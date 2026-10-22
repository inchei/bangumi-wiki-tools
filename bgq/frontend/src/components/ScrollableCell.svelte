<script>
  import { MorphIcon } from "morphicons/svelte";
  import { ChevronDown, ChevronUp } from "lucide";
  import { tick } from "svelte";

  let { html, value, epoch = 0 } = $props();

  let moreAbove = $state(false);
  let moreBelow = $state(false);
  let boxEl = $state(null);

  function measure() {
    const el = boxEl;
    if (!el) {
      moreAbove = false;
      moreBelow = false;
      return;
    }
    moreBelow = el.scrollTop < el.scrollHeight - el.clientHeight - 1;
    moreAbove = el.scrollTop > 1;
  }

  function scrollBox(dir) {
    boxEl?.scrollBy({ top: dir * boxEl.clientHeight, behavior: "smooth" });
  }

  $effect(() => {
    void epoch;
    void value;
    if (boxEl) boxEl.scrollTop = 0;
    tick().then(measure);
  });

  $effect(() => {
    if (!boxEl) return;
    const ro = new ResizeObserver(measure);
    ro.observe(boxEl);
    document.fonts?.ready?.then(measure);
    return () => ro.disconnect();
  });
</script>

<div class="cell-box">
  <div class="cell-scroll" bind:this={boxEl} onscroll={measure}>
    <!-- eslint-disable-next-line svelte/no-at-html-tags -->
    {@html html}
  </div>
  {#if moreAbove}
    <button
      type="button"
      class="cell-arrow cell-arrow-up"
      aria-hidden="true"
      tabindex="-1"
      onclick={() => scrollBox(-1)}
    >
      <MorphIcon icon={ChevronUp} size={12} />
    </button>
  {/if}
  {#if moreBelow}
    <button
      type="button"
      class="cell-arrow cell-arrow-down"
      aria-hidden="true"
      tabindex="-1"
      onclick={() => scrollBox(1)}
    >
      <MorphIcon icon={ChevronDown} size={12} />
    </button>
  {/if}
</div>

<style>
  .cell-box {
    position: relative;
  }

  .cell-scroll {
    line-height: 1.6;
    max-height: calc(1.6em * 8);
    overflow-y: auto;
  }

  .cell-arrow {
    position: absolute;
    right: 4px;
    z-index: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    padding: 0;
    border-radius: 50%;
    border: 1px solid var(--border-light);
    background: color-mix(in srgb, var(--white) 92%, transparent);
    box-shadow: var(--shadow);
    color: var(--text-secondary);
    cursor: pointer;
    transition:
      color 0.15s,
      border-color 0.15s;
  }

  .cell-arrow-up {
    top: 4px;
  }

  .cell-arrow-down {
    bottom: 4px;
  }

  .cell-arrow:hover {
    color: var(--accent-strong);
    border-color: var(--accent-strong);
  }
</style>
