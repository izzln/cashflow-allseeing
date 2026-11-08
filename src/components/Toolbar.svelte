<script lang="ts">
  import { app } from '../lib/store.svelte';
  import { commands, isEnabled, labelOf, run, shortcutText } from '../lib/commands';
  import { STYLES } from '../lib/styles';
  import SnapshotsMenu from './SnapshotsMenu.svelte';

  /** Toolbar buttons are shortcuts to commands; tooltips show the keyboard shortcut. */
  const tip = (id: string) => {
    const c = commands[id];
    const keys = shortcutText(c.keys);
    return keys ? `${labelOf(c)} (${keys})` : labelOf(c);
  };
  const on = (id: string) => isEnabled(commands[id]);

  async function toNewFile() {
    const id = await app.snapshotToNewFile();
    if (id) location.hash = `#/f/${id}`;
  }
</script>

<div class="toolbar" role="toolbar" aria-label="Toolbar">
  {#if !app.readonly}
    <div class="group">
      <button onclick={() => run('edit.undo')} disabled={!on('edit.undo')} title={tip('edit.undo')}>↶ Undo</button>
      <button onclick={() => run('edit.redo')} disabled={!on('edit.redo')} title={tip('edit.redo')}>↷ Redo</button>
    </div>
    <div class="group">
      <button onclick={() => run('insert.table')} title="Insert a month-by-month cash-flow table">+ Table</button>
      <button onclick={() => run('insert.ledger')} title="Insert a list of entries (typed in or imported)">+ Ledger</button>
    </div>
    <div class="group">
      <button onclick={() => run('insert.rowAbove')} disabled={!on('insert.rowAbove')} title={tip('insert.rowAbove')}>+ Row ↑</button>
      <button onclick={() => run('insert.rowBelow')} disabled={!on('insert.rowBelow')} title={tip('insert.rowBelow')}>+ Row ↓</button>
      <button onclick={() => run('table.deleteRows')} disabled={!on('table.deleteRows')} title={tip('table.deleteRows')}>− Row</button>
    </div>
    <div class="group swatches" aria-label="Cell colors">
      {#each STYLES as s (s.id)}
        <button
          class="swatch"
          style="background:{s.bg};color:{s.fg}"
          title={s.name}
          aria-label={`Color: ${s.name}`}
          disabled={!app.selection}
          onclick={() => app.applyStyle(s.id)}>A</button
        >
      {/each}
    </div>
  {/if}
  <div class="group">
    <button onclick={() => run('edit.copy')} disabled={!on('edit.copy')} title={tip('edit.copy')}>Copy</button>
    {#if !app.readonly}<button onclick={() => run('edit.paste')} disabled={!on('edit.paste')} title={tip('edit.paste')}>Paste</button>{/if}
  </div>
  <div class="group right">
    {#if app.readonly}
      <button onclick={toNewFile} title="Make an editable file from this snapshot">Save as new file</button>
    {/if}
    <SnapshotsMenu />
    <button onclick={() => run('file.download')} title={tip('file.download')}>Download</button>
    <button onclick={() => run('view.inspector')} class:on={app.showInspector} title={tip('view.inspector')} aria-pressed={app.showInspector}>Panel</button>
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
  @media (pointer: coarse) {
    .toolbar button {
      min-height: 40px;
    }
    .swatch {
      width: 40px;
    }
  }
  .on {
    background: var(--accent-soft);
    border-color: var(--accent);
  }
</style>
