<script lang="ts">
  import { tick } from 'svelte';
  import { app } from '../lib/store.svelte';

  let renaming = $state<string | null>(null);
  let draft = $state('');
  let inputEl = $state<HTMLInputElement | null>(null);

  async function onTab(id: string) {
    if (app.activeSheetId === id) {
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

  function remove(id: string, name: string) {
    if (confirm(`Delete sheet "${name}" and all its tables?`)) app.deleteSheet(id);
  }
</script>

<nav class="tabs">
  <span class="brand">Cashflow</span>
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
      {#if s.id === app.activeSheetId && renaming !== s.id}
        <button class="mini" onclick={() => app.moveSheet(s.id, -1)} title="Move left">‹</button>
        <button class="mini" onclick={() => app.moveSheet(s.id, 1)} title="Move right">›</button>
        {#if app.wb.sheets.length > 1}
          <button class="mini" onclick={() => remove(s.id, s.name)} title="Delete sheet">×</button>
        {/if}
      {/if}
    </div>
  {/each}
  <button class="add" onclick={() => app.addSheet()} title="Add sheet">+ Sheet</button>
</nav>

<style>
  .tabs {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 6px 12px;
    background: var(--panel);
    border-bottom: 1px solid var(--line);
    overflow-x: auto;
    flex-shrink: 0;
  }
  .brand {
    font-weight: 600;
    margin-right: 10px;
    white-space: nowrap;
  }
  .tab {
    display: flex;
    align-items: center;
    border-radius: 8px;
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
    min-height: 26px;
    color: var(--muted);
  }
  .tab input {
    width: 140px;
    padding: 4px 6px;
    border: 1px solid var(--accent);
    border-radius: 6px;
  }
  .add {
    white-space: nowrap;
    color: var(--muted);
  }
</style>
