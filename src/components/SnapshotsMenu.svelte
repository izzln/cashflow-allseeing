<script lang="ts">
  import { app } from '../lib/store.svelte';

  let open = $state(false);
  const fmt = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

  function take() {
    const d = new Date();
    const label = prompt('Snapshot name', `Snapshot ${d.toLocaleDateString()}`);
    if (label === null) return;
    open = false;
    app.takeSnapshot(label);
  }

  function remove(id: string, label: string) {
    if (confirm(`Delete snapshot "${label}"?`)) app.deleteSnapshot(id);
  }

  function href(id: string) {
    return `#/f/${app.file?.id}/s/${id}`;
  }
</script>

<div class="wrap">
  <button onclick={() => (open = !open)} class:on={open}>Snapshots ({app.snapshots.length})</button>
  {#if open}
    <!-- svelte-ignore a11y_no_static_element_interactions, a11y_click_events_have_key_events -->
    <div class="backdrop" onclick={() => (open = false)}></div>
    <div class="menu">
      {#if !app.readonly}
        <button class="take" onclick={take}>Take snapshot now</button>
      {/if}
      <p class="hint">A snapshot is taken automatically at each month-end. Open one in a new window to compare side by side.</p>
      {#each app.snapshots as s (s.id)}
        <div class="item" class:current={app.snapshot?.id === s.id}>
          <div class="text">
            <span class="label">{s.label}</span>
            <span class="meta">{s.kind === 'month-end' ? 'Month-end' : 'Manual'} · {fmt.format(s.takenAt)}</span>
          </div>
          <a class="btn" href={href(s.id)} target="_blank" rel="noopener" onclick={() => (open = false)}>Open</a>
          {#if !app.readonly}
            <button class="danger" onclick={() => remove(s.id, s.label)} title="Delete snapshot">×</button>
          {/if}
        </div>
      {:else}
        <p class="hint">No snapshots yet.</p>
      {/each}
    </div>
  {/if}
</div>

<style>
  .wrap {
    position: relative;
  }
  .on {
    background: var(--accent-soft);
    border-color: var(--accent);
  }
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 2500;
  }
  .menu {
    position: absolute;
    right: 0;
    top: calc(100% + 6px);
    z-index: 2600;
    width: min(340px, calc(100vw - 32px));
    max-height: 60vh;
    overflow-y: auto;
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 10px;
    box-shadow: 0 8px 28px rgba(0, 0, 0, 0.16);
    padding: 10px;
  }
  .take {
    width: 100%;
  }
  .hint {
    color: var(--muted);
    font-size: 12px;
    line-height: 1.4;
    margin: 8px 2px;
  }
  .item {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 4px;
    border-top: 1px solid var(--line);
  }
  .item.current {
    background: var(--accent-soft);
    border-radius: 6px;
  }
  .text {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }
  .label {
    font-weight: 600;
    overflow-wrap: anywhere;
  }
  .meta {
    color: var(--muted);
    font-size: 12px;
  }
  .btn {
    display: inline-flex;
    align-items: center;
    border: 1px solid var(--line);
    border-radius: 6px;
    padding: 4px 10px;
    min-height: 30px;
    color: inherit;
    text-decoration: none;
  }
</style>
