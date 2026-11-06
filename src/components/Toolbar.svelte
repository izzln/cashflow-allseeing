<script lang="ts">
  import { app } from '../lib/store.svelte';
  import { normalizeWorkbook } from '../lib/model';
  import { STYLES } from '../lib/styles';

  let { showInspector = $bindable() }: { showInspector: boolean } = $props();
  let fileEl = $state<HTMLInputElement | null>(null);

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

  function backup() {
    const blob = new Blob([app.exportJSON()], { type: 'application/json' });
    const a = document.createElement('a');
    const d = new Date();
    const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
    a.href = URL.createObjectURL(blob);
    a.download = `cashflow-backup-${stamp}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  async function restore(e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0];
    (e.target as HTMLInputElement).value = '';
    if (!file) return;
    try {
      const wb = normalizeWorkbook(JSON.parse(await file.text()));
      if (!wb) throw new Error('bad');
      if (confirm('Replace the current workbook with this backup? (You can undo.)')) app.replaceWorkbook(wb);
    } catch {
      alert('That file is not a valid backup.');
    }
  }
</script>

<div class="toolbar">
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
  <div class="group">
    <button onclick={copy} disabled={!hasSel}>Copy</button>
    <button onclick={paste} disabled={!hasSel}>Paste</button>
  </div>
  <div class="group right">
    <button onclick={backup} title="Download all data as a file">Backup</button>
    <button onclick={() => fileEl?.click()} title="Load a backup file">Restore</button>
    <input bind:this={fileEl} type="file" accept="application/json,.json" hidden onchange={restore} />
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
