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

  const STATE_LABEL = {
    saved: 'Saved',
    pending: 'Saving…',
    offline: 'Offline · will retry',
    signin: 'Sign in to save',
    error: 'Not saved',
  } as const;

  function renameFile() {
    const n = prompt('File name', app.file?.name ?? '');
    if (n) app.renameFile(n);
  }

  function remove(id: string, name: string) {
    if (confirm(`Delete sheet "${name}" and all its tables?`)) app.deleteSheet(id);
  }
</script>

<nav class="tabs">
  <a class="back" href="#/" title="All files">‹ Files</a>
  {#if app.snapshot}
    <span class="file">{app.file?.name}</span>
    <span class="snap">Snapshot: {app.snapshot.label} · read-only</span>
    <a class="back" href="#/f/{app.file?.id}" target="_blank" rel="noopener">Open live file</a>
  {:else}
    <button class="file" onclick={renameFile} title="Rename file">{app.file?.name}</button>
    <span class="state {app.saveState}">{STATE_LABEL[app.saveState]}</span>
  {/if}
  <span class="sep"></span>
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
          <button class="mini" onclick={() => remove(s.id, s.name)} title="Delete sheet">×</button>
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
    padding: 6px 12px;
    background: var(--panel);
    border-bottom: 1px solid var(--line);
    overflow-x: auto;
    flex-shrink: 0;
  }
  .back {
    color: var(--accent);
    text-decoration: none;
    white-space: nowrap;
    padding: 4px 6px;
  }
  .file {
    border: none;
    background: transparent;
    font-weight: 600;
    white-space: nowrap;
    max-width: 240px;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .state {
    color: var(--muted);
    font-size: 12px;
    white-space: nowrap;
    min-width: 56px;
  }
  .snap {
    background: #fff4e5;
    color: #7a4a00;
    border-radius: 6px;
    padding: 3px 8px;
    white-space: nowrap;
    font-size: 12px;
  }
  .state.offline,
  .state.signin,
  .state.error {
    color: var(--neg);
  }
  .sep {
    width: 1px;
    align-self: stretch;
    background: var(--line);
    margin: 2px 8px;
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
