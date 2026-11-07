<script lang="ts">
  import { app } from '../lib/store.svelte';
  import { formatNumber } from '../lib/format';
  import { selectionStats } from '../lib/grid';

  const stats = $derived(selectionStats(app.selectedValues()));
</script>

{#if app.notice || stats.count > 0}
  <div class="status" role="status">
    {#if app.notice}
      <span class="notice">{app.notice}</span>
    {:else}
      <span><b>Sum</b> {formatNumber(stats.sum)}</span>
      <span><b>Average</b> {formatNumber(stats.avg)}</span>
      <span><b>Count</b> {stats.count}</span>
    {/if}
  </div>
{/if}

<style>
  .status {
    position: fixed;
    right: 16px;
    bottom: calc(16px + env(safe-area-inset-bottom));
    display: flex;
    gap: 14px;
    padding: 8px 14px;
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 10px;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
    font-variant-numeric: tabular-nums;
    z-index: 2000;
    pointer-events: none;
  }
  b {
    color: var(--muted);
    font-weight: 500;
    margin-right: 4px;
  }
  .notice {
    color: var(--neg);
  }
</style>
