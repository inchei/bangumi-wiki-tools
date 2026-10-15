<script>
  import { MorphIcon } from "morphicons/svelte";
  import { Link2 } from "lucide";
  import { bgmHost } from "../stores.js";

  // Plaintext-looking button showing the current Bangumi host; prompts to
  // change it (stored in localStorage via the bgmHost store), so mirror
  // users can point result links at their mirror.

  function normalizeHost(raw) {
    const t = String(raw || "").trim();
    if (!t) return "bgm.tv";
    try {
      return new URL(t.includes("://") ? t : `https://${t}`).host;
    } catch {
      return t;
    }
  }

  function editHost() {
    const v = prompt(
      "Bangumi 主机（结果内链接将使用此主机，默认 bgm.tv）",
      $bgmHost,
    );
    if (v === null) return; // cancelled
    bgmHost.set(normalizeHost(v));
  }
</script>

<button class="bgm-host-btn" onclick={editHost} aria-label="修改 Bangumi 主机">
  <MorphIcon icon={Link2} size={12} />
  <span aria-hidden="true">{$bgmHost}</span>
</button>

<style>
  .bgm-host-btn {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 0;
    min-height: 24px;

    /* Matches .btn-sm's right padding so the host text edge aligns with the
       button text edge in the right-aligned layout. */
    margin-right: 12px;
    border: none;
    background: none;
    color: var(--text-secondary);
    font-family: inherit;
    font-size: 0.75rem;
    cursor: pointer;
    transition: var(--transition);
    white-space: nowrap;
  }

  .bgm-host-btn:hover {
    color: var(--accent-strong);
  }

  .bgm-host-btn :global(svg) {
    opacity: 0.7;
  }
</style>
