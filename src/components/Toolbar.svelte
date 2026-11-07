<script lang="ts">
  import { app } from '../lib/store.svelte';
  import { STYLES } from '../lib/styles';
  import SnapshotsMenu from './SnapshotsMenu.svelte';

  async function toNewFile() {
    const id = await app.snapshotToNewFile();
    if (id) location.hash = `#/f/${id}`;
  }

  let { showInspector = $bindable() }: { showInspector: boolean } = $props();

  const tableId = $derived(app.selection?.tableId ?? app.focusTableId);
  const hasSel = $derived(!!app.selection);

  async function copy() {
    const data = app.copyData();
    if (!data) return;
    try {
      if ('ClipboardItem' in window) {
        await navigator.clipboard.write([
          new ClipboardItem({
            'text/plain': new Blob([data.text], { type: 'text/plain' }),
            'text/html': new Blob([data.html], { type: 'text/html' }),
          }),
        ]);
      } else {
        await navigator.clipboard.writeText(data.text);
      }
    } catch {
      alert('Copy was blocked by the browser. Use ⌘C instead.');
    }
  }

  async function paste() {
    try {
      const text = await navigator.clipboard.readText();
      if (text) app.paste(text);
    } catch {
      alert('Paste was blocked by the browser. Use ⌘V instead.');
    }
  }

</script>

<div class="toolbar">
  {#if !app.readonly}
  <div class="group">
    <button onclick={() => app.undo()} disabled={!app.canUndo} title="Undo (⌘Z)">↶ Undo</button>
    <button onclick={() => app.redo()} disabled={!app.canRedo} title="Redo (⇧⌘Z)">↷ Redo</button>
  </div>
  <div class="group">
    <button onclick={() => app.addTable()}>+ Table</button>
    <button onclick={() => tableId && app.addRow(tableId)} disabled={!tableId}>+ Row</button>
    <button onclick={() => app.deleteSelectedRows()} disabled={!hasSel}>− Row</button>
    <button onclick={() => app.moveSelectedRow(-1)} disabled={!hasSel} title="Move row up">↑</button>
    <button onclick={() => app.moveSelectedRow(1)} disabled={!hasSel} title="Move row down">↓</button>
  </div>
  <div class="group swatches" aria-label="Cell colors">
    {#each STYLES as s (s.id)}
      <button
        class="swatch"
        style="background:{s.bg};color:{s.fg}"
        title={s.name}
        disabled={!hasSel}
        onclick={() => app.applyStyle(s.id)}>A</button
      >
    {/each}
  </div>
  {/if}
  <div class="group">
    <button onclick={copy} disabled={!hasSel}>Copy</button>
    {#if !app.readonly}<button onclick={paste} disabled={!hasSel}>Paste</button>{/if}
  </div>
  <div class="group right">
    {#if app.readonly}
      <button onclick={toNewFile} title="Make an editable file from this snapshot">Save as new file</button>
    {/if}
    <SnapshotsMenu />
    <button onclick={() => app.downloadFile()} title="Download this file, with its snapshots">Download</button>
    <button onclick={() => (showInspector = !showInspector)} class:on={showInspector}>Panel</button>
  </div>
</div>

<style>
  .toolbar {
    display: flex;
    flex-wrap: wrap;
    gap: 8px 14px;
    align-items: center;
    padding: 6px 12px;
    background: var(--panel);
    border-bottom: 1px solid var(--line);
    flex-shrink: 0;
  }
  .group {
    display: flex;
    gap: 4px;
    align-items: center;
  }
  .right {
    margin-left: auto;
  }
  .swatch {
    width: 30px;
    padding: 0;
    font-weight: 600;
  }
  .on {
    background: var(--accent-soft);
    border-color: var(--accent);
  }
</style>
