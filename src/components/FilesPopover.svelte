<script lang="ts">
  import { app } from '../lib/store.svelte';
  import { formatSize } from '../lib/attachments';
  import Icon from './Icon.svelte';

  const target = $derived(app.filesCell);
  const table = $derived(target ? app.table(target.tableId) : undefined);
  const column = $derived(table?.kind === 'table' ? table.columns.find((c) => c.id === target?.colId) : undefined);
  const list = $derived(target ? app.attachmentsOf(target.tableId, target.rowId, target.colId) : []);
  let inputEl = $state<HTMLInputElement | null>(null);
  let busy = $state(false);
  let over = $state(false);

  // Place the popover under its cell; on narrow screens it becomes a bottom sheet.
  const place = $derived.by(() => {
    if (!target || typeof window === 'undefined') return '';
    const cell = document.querySelector<HTMLElement>(`td[data-t="${target.tableId}"][data-files]`);
    const rows = [...document.querySelectorAll<HTMLElement>(`td[data-t="${target.tableId}"]`)];
    const entryIndex = table?.kind === 'table' ? table.entries.findIndex((e) => e.id === target.rowId) : -1;
    const col = table?.kind === 'table' ? table.columns.findIndex((c) => c.id === target.colId) : -1;
    const el = rows.find((td) => td.dataset.r === String(entryIndex) && td.dataset.c === String(col)) ?? cell;
    if (!el || window.innerWidth < 600) return '';
    const r = el.getBoundingClientRect();
    const left = Math.max(8, Math.min(r.left, window.innerWidth - 348));
    const top = r.bottom + 300 > window.innerHeight ? Math.max(8, r.top - 300) : r.bottom + 4;
    return `left:${left}px;top:${top}px`;
  });

  async function add(files: FileList | File[] | null | undefined) {
    if (!target || !files?.length) return;
    busy = true;
    await app.attachFiles(target.tableId, target.rowId, target.colId, [...files]);
    busy = false;
  }

  function close() {
    app.filesCell = null;
  }
</script>

{#if target && column}
  <!-- svelte-ignore a11y_no_static_element_interactions, a11y_click_events_have_key_events -->
  <div class="backdrop" onclick={close}></div>
  <div
    class="pop"
    class:sheet={!place}
    class:over
    style={place}
    role="dialog"
    aria-label="Attached files"
    tabindex="-1"
    onkeydown={(e) => e.key === 'Escape' && close()}
    ondragover={(e) => {
      if (app.readonly) return;
      e.preventDefault();
      over = true;
    }}
    ondragleave={() => (over = false)}
    ondrop={(e) => {
      e.preventDefault();
      over = false;
      if (!app.readonly) add(e.dataTransfer?.files);
    }}
  >
    <header>
      <b>{column.name}</b>
      <button class="close" onclick={close} aria-label="Close">Done</button>
    </header>
    {#if list.length === 0}
      <p class="empty">No files yet.</p>
    {/if}
    <ul>
      {#each list as a (a.id)}
        <li>
          <button class="name" onclick={() => app.openAttachment(a)} title="Open"><Icon name="clip" size={14} /> {a.name}</button>
          <span class="size">{formatSize(a.size)}</span>
          <button class="icon" onclick={() => app.openAttachment(a, true)} title="Download" aria-label={`Download ${a.name}`}>⤓</button>
          {#if !app.readonly}
            <button class="icon danger" onclick={() => app.detachFile(target.tableId, target.rowId, target.colId, a.id)} title="Remove" aria-label={`Remove ${a.name}`}>×</button>
          {/if}
        </li>
      {/each}
    </ul>
    {#if !app.readonly}
      <div class="add">
        <button class="primary" disabled={busy} onclick={() => inputEl?.click()}>{busy ? 'Uploading…' : 'Add files…'}</button>
        <span class="hint">or drop files here · up to 25 MB each</span>
        <input bind:this={inputEl} type="file" multiple hidden onchange={(e) => {
          const input = e.target as HTMLInputElement;
          const files = input.files ? [...input.files] : [];
          input.value = '';
          add(files);
        }} />
      </div>
    {/if}
  </div>
{/if}

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: calc(var(--z-popover) - 100);
  }
  .pop {
    position: fixed;
    z-index: var(--z-popover);
    width: 340px;
    max-height: 300px;
    display: flex;
    flex-direction: column;
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: var(--radius-12);
    box-shadow: var(--shadow-menu);
    padding: 10px 12px;
  }
  .pop.sheet {
    left: 8px;
    right: 8px;
    bottom: calc(8px + env(safe-area-inset-bottom));
    width: auto;
    max-height: 60vh;
  }
  .pop.over {
    outline: 3px dashed var(--accent);
  }
  header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 6px;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    overflow-y: auto;
  }
  li {
    display: flex;
    align-items: center;
    gap: 6px;
    border-top: 1px solid var(--line);
    padding: 4px 0;
  }
  .name {
    flex: 1;
    min-width: 0;
    text-align: left;
    border: none;
    background: none;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--accent);
    min-height: 36px;
  }
  .size {
    color: var(--muted);
    font-size: 12px;
    white-space: nowrap;
  }
  .icon {
    min-width: 36px;
    min-height: 36px;
    padding: 0;
  }
  .add {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 8px;
    flex-wrap: wrap;
  }
  .primary {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--on-accent);
    min-height: 36px;
  }
  .hint,
  .empty {
    color: var(--muted);
    font-size: 12px;
  }
</style>
