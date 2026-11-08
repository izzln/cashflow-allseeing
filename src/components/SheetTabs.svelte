<script lang="ts">
  import { tick } from 'svelte';
  import { app } from '../lib/store.svelte';

  let renaming = $state<string | null>(null);
  let draft = $state('');
  let inputEl = $state<HTMLInputElement | null>(null);

  async function onTab(id: string) {
    if (app.activeSheetId === id && !app.readonly) {
      // A second click on the active tab renames it (works on iPad, unlike double-click).
      renaming = id;
      draft = app.sheet.name;
      await tick();
      inputEl?.focus();
      inputEl?.select();
    } else {
      app.setSheet(id);
    }
  }

  function finish(save: boolean) {
    if (save && renaming) app.renameSheet(renaming, draft);
    renaming = null;
  }

  function remove(id: string) {
    app.deleteSheet(id); // undoable; the notice offers Undo
  }
</script>

<nav class="tabs">

  {#each app.wb.sheets as s (s.id)}
    <div class="tab" class:active={s.id === app.activeSheetId}>
      {#if renaming === s.id}
        <input
          bind:this={inputEl}
          bind:value={draft}
          onblur={() => finish(true)}
          onkeydown={(e) => {
            if (e.key === 'Enter' && !e.isComposing) finish(true);
            if (e.key === 'Escape') finish(false);
          }}
        />
      {:else}
        <button class="name" onclick={() => onTab(s.id)} title="Click again to rename">{s.name}</button>
      {/if}
      {#if s.id === app.activeSheetId && renaming !== s.id && !app.readonly}
        <button class="mini" onclick={() => app.moveSheet(s.id, -1)} title="Move left">‹</button>
        <button class="mini" onclick={() => app.moveSheet(s.id, 1)} title="Move right">›</button>
        {#if app.wb.sheets.length > 1}
          <button class="mini" onclick={() => remove(s.id)} title="Delete sheet">×</button>
        {/if}
      {/if}
    </div>
  {/each}
  {#if !app.readonly}
    <button class="add" onclick={() => app.addSheet()} title="Add sheet">+ Sheet</button>
  {/if}
</nav>

<style>
  .tabs {
    display: flex;
    align-items: center;
    gap: 4px;
    overflow-x: auto;
    padding: 4px 12px;
    background: var(--panel);
    border-bottom: 1px solid var(--line);
    flex-shrink: 0;
  }
  .tab {
    display: flex;
    align-items: center;
    border-radius: var(--radius-8);
    padding: 2px;
  }
  .tab.active {
    background: var(--accent-soft);
  }
  .tab button {
    border: none;
    background: transparent;
    white-space: nowrap;
  }
  .tab.active .name {
    color: var(--accent);
    font-weight: 600;
  }
  .mini {
    padding: 2px 6px;
    min-height: var(--control-h);
    color: var(--muted);
  }
  .tab input {
    width: 140px;
    padding: 4px 6px;
    border: 1px solid var(--accent);
    border-radius: var(--radius-6);
  }
  .add {
    white-space: nowrap;
    color: var(--muted);
  }
</style>
