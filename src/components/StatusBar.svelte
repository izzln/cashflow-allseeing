<script lang="ts">
  import { app } from '../lib/store.svelte';
  import { formatNumber } from '../lib/format';
  import { selectionStats } from '../lib/grid';

  const stats = $derived(selectionStats(app.selectedValues()));
</script>

{#if app.notice || stats.count > 0}
  <div class="status" role="status">
    {#if app.notice}
      <span class="notice" class:info={app.noticeTone === 'info'}>{app.notice}</span>
      {#if app.noticeAction}
        <button class="action" onclick={() => { const a = app.noticeAction; app.notice = ''; app.noticeAction = null; a?.run(); }}>{app.noticeAction.label}</button>
      {/if}
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
    border-radius: var(--radius-10);
    box-shadow: var(--shadow-status);
    font-variant-numeric: tabular-nums;
    z-index: var(--z-status);
    pointer-events: none;
    align-items: center;
  }
  .action {
    pointer-events: auto;
    border: none;
    background: none;
    color: var(--accent);
    font-weight: 600;
    min-height: 32px;
    padding: 0 6px;
  }
  @media (pointer: coarse) {
    .action {
      min-height: var(--touch-target);
    }
  }
  b {
    color: var(--muted);
    font-weight: 500;
    margin-right: 4px;
  }
  .notice {
    color: var(--neg);
  }
  .notice.info {
    color: var(--text);
  }
</style>
