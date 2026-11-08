<script lang="ts">
  import { app } from '../lib/store.svelte';
  import { formatNumber } from '../lib/format';
  import { selectionStats } from '../lib/grid';
  import { fadeOut } from '../lib/motion';

  const stats = $derived(selectionStats(app.selectedValues()));
</script>

{#if app.notice || stats.count > 0}
  <!-- Fades in once; a newer notice replaces the text without replaying (Stories: Motion). -->
  <div class="status anim-fade" role="status" out:fadeOut>
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
    right: calc(16px + env(safe-area-inset-right));
    bottom: calc(16px + env(safe-area-inset-bottom) + var(--kb-inset));
    max-width: calc(100vw - 32px);
    flex-wrap: wrap;
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
