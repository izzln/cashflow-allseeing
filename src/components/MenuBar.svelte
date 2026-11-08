<script lang="ts">
  import { tick } from 'svelte';
  import { app } from '../lib/store.svelte';
  import { MENU_BAR } from '../lib/commands';
  import MenuList from './MenuList.svelte';

  let open = $state<number | null>(null);
  let lists = $state<(MenuList | null)[]>([]);

  const STATE_LABEL = {
    saved: 'Saved',
    pending: 'Saving…',
    offline: 'Offline · will retry',
    signin: 'Sign in to save',
    error: 'Not saved',
  } as const;

  async function toggle(i: number, viaKeyboard = false) {
    open = open === i ? null : i;
    app.menu = null;
    if (viaKeyboard && open !== null) {
      await tick();
      lists[i]?.focusFirst();
    }
  }

  // ----- renaming the file in place -----
  let draft = $state('');
  let inputEl = $state<HTMLInputElement | null>(null);
  $effect(() => {
    if (app.renamingFile) {
      draft = app.file?.name ?? '';
      tick().then(() => {
        inputEl?.focus();
        inputEl?.select();
      });
    }
  });
  function finishRename(save: boolean) {
    if (save) app.renameFile(draft);
    app.renamingFile = false;
  }
</script>

<header class="bar">
  <a class="back" href="#/" title="All files">‹ Files</a>
  <nav class="menus" aria-label="Menu bar">
    {#each MENU_BAR as m, i (m.title)}
      <div class="menu-wrap">
        <button
          class="title"
          class:open={open === i}
          aria-haspopup="menu"
          aria-expanded={open === i}
          onclick={(e) => toggle(i, e.detail === 0)}
          onpointerenter={(e) => e.pointerType === 'mouse' && open !== null && open !== i && (open = i)}
        >{m.title}</button>
        {#if open === i}
          <div class="drop"><MenuList bind:this={lists[i]} items={m.items} onclose={() => (open = null)} /></div>
        {/if}
      </div>
    {/each}
  </nav>
  <span class="spacer"></span>
  {#if app.renamingFile}
    <input
      class="rename"
      bind:this={inputEl}
      bind:value={draft}
      aria-label="File name"
      onblur={() => finishRename(true)}
      onkeydown={(e) => {
        if (e.isComposing || e.keyCode === 229) return;
        if (e.key === 'Enter') finishRename(true);
        if (e.key === 'Escape') finishRename(false);
      }}
    />
  {:else}
    <button class="file" ondblclick={() => app.startRenameFile()} onclick={(e) => e.detail === 0 && app.startRenameFile()}
      title={app.readonly ? app.file?.name : 'Double-click to rename'}>{app.file?.name}</button>
  {/if}
  {#if app.snapshot}
    <span class="snap">Snapshot: {app.snapshot.label} · read-only</span>
    <a class="back" href="#/f/{app.file?.id}" target="_blank" rel="noopener">Open live file</a>
  {:else}
    <span class="state {app.saveState}">{STATE_LABEL[app.saveState]}</span>
  {/if}
</header>
{#if open !== null}
  <!-- svelte-ignore a11y_no_static_element_interactions, a11y_click_events_have_key_events -->
  <div class="backdrop" onclick={() => (open = null)}></div>
{/if}

<style>
  .bar {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 2px 10px;
    background: var(--panel);
    border-bottom: 1px solid var(--line);
    flex-shrink: 0;
    min-height: 34px;
    position: relative;
    z-index: 2600;
    overflow-x: auto;
  }
  .back {
    color: var(--accent);
    text-decoration: none;
    white-space: nowrap;
    padding: 4px 6px;
  }
  .menus {
    display: flex;
  }
  .menu-wrap {
    position: relative;
  }
  .title {
    border: none;
    background: none;
    padding: 3px 9px;
    min-height: 28px;
    border-radius: 5px;
  }
  @media (pointer: coarse) {
    .title {
      min-height: 40px;
    }
  }
  .title.open,
  .title:hover {
    background: var(--accent-soft);
  }
  .drop {
    position: fixed;
    margin-top: 2px;
  }
  .spacer {
    flex: 1;
  }
  .file {
    border: none;
    background: transparent;
    font-weight: 600;
    white-space: nowrap;
    max-width: 260px;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .rename {
    width: 220px;
    padding: 3px 6px;
    border: 1px solid var(--accent);
    border-radius: 6px;
    font-weight: 600;
  }
  .state {
    color: var(--muted);
    font-size: 12px;
    white-space: nowrap;
    min-width: 56px;
  }
  .state.offline,
  .state.signin,
  .state.error {
    color: var(--neg);
  }
  .snap {
    background: #fff4e5;
    color: #7a4a00;
    border-radius: 6px;
    padding: 3px 8px;
    white-space: nowrap;
    font-size: 12px;
  }
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 2500;
  }
</style>
