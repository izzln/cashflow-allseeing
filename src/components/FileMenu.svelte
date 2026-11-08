<script lang="ts">
  import { tick } from 'svelte';
  import { app } from '../lib/store.svelte';
  import { commands, shortcutText } from '../lib/commands';
  import Icon from './Icon.svelte';
  import { fadeOut } from '../lib/motion';

  /**
   * The file name with its save status. Clicking or tapping it opens the File menu:
   * rename, download, snapshots (take, open beside the live file, delete) and all files.
   */
  let open = $state(false);
  let renaming = $state(false);
  let name = $state('');
  let taking = $state(false);
  let label = $state('');
  let nameEl = $state<HTMLInputElement | null>(null);
  let labelEl = $state<HTMLInputElement | null>(null);
  const fmt = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

  const STATE_LABEL = {
    saved: 'Saved',
    pending: 'Saving…',
    offline: 'Offline · will retry',
    signin: 'Sign in to save',
    error: 'Not saved',
  } as const;
  /** Compact width: the status shortens (Stories: chrome gives way first). */
  const SHORT_LABEL = { saved: 'Saved', pending: 'Saving…', offline: 'Offline', signin: 'Sign in', error: 'Not saved' } as const;

  // Commands elsewhere ask the menu to open in rename or take-snapshot mode.
  $effect(() => {
    const req = app.fileMenuRequest;
    if (!req) return;
    app.fileMenuRequest = null;
    open = true;
    void (req === 'rename' ? startRename() : startSnapshot());
  });

  async function startRename() {
    if (app.readonly) return;
    renaming = true;
    name = app.file?.name ?? '';
    await tick();
    nameEl?.focus();
    nameEl?.select();
  }

  /** Enter saves and closes the menu, as renaming a document title does on the Mac; Esc just stops renaming. */
  function finishRename(save: boolean) {
    if (save && name.trim()) app.renameFile(name);
    renaming = false;
    if (save) close();
  }

  async function startSnapshot() {
    taking = true;
    label = `Snapshot ${new Date().toLocaleDateString()}`;
    await tick();
    labelEl?.focus();
    labelEl?.select();
  }

  function takeSnapshot() {
    if (!label.trim()) return;
    app.takeSnapshot(label.trim());
    taking = false;
  }

  function close() {
    open = false;
    renaming = false;
    taking = false;
  }

  async function toNewFile() {
    const id = await app.snapshotToNewFile();
    close();
    if (id) location.hash = `#/f/${id}`;
  }

  const ime = (e: KeyboardEvent) => e.isComposing || e.keyCode === 229;
</script>

<div class="wrap">
  <button class="trigger" class:open aria-haspopup="menu" aria-expanded={open} onclick={() => (open ? close() : (open = true))}>
    <span class="name">{app.file?.name}</span>
    <Icon name="chevron" size={14} />
  </button>
  {#if app.snapshot}
    <span class="snap">Snapshot: {app.snapshot.label} · read-only</span>
  {:else}
    <span class="state {app.saveState}" title={STATE_LABEL[app.saveState]}>{(app.sizeClass === 'compact' ? SHORT_LABEL : STATE_LABEL)[app.saveState]}</span>
  {/if}

  {#if open}
    <!-- svelte-ignore a11y_no_static_element_interactions, a11y_click_events_have_key_events -->
    <div class="backdrop" onclick={close}></div>
    <div class="menu anim-pop from-left sheet-compact" role="menu" tabindex="-1" onkeydown={(e) => e.key === 'Escape' && close()} out:fadeOut>
      {#if renaming}
        <div class="field">
          <input bind:this={nameEl} bind:value={name} aria-label="File name"
            onkeydown={(e) => {
              if (ime(e)) return;
              if (e.key === 'Enter') finishRename(true);
              if (e.key === 'Escape') {
                e.stopPropagation();
                finishRename(false);
              }
            }} />
          <button class="primary" onclick={() => finishRename(true)}>Rename</button>
        </div>
      {:else if !app.readonly}
        <button role="menuitem" onclick={startRename}><Icon name="pencil" size={18} /> Rename…</button>
      {/if}
      {#if app.snapshot}
        <a role="menuitem" class="item" href="#/f/{app.file?.id}" target="_blank" rel="noopener" onclick={close}><Icon name="folder" size={18} /> Open Live File</a>
        <button role="menuitem" onclick={toNewFile}><Icon name="plus" size={18} /> Save as New File</button>
      {/if}
      <button role="menuitem" onclick={() => { close(); app.downloadFile(); }}>
        <Icon name="download" size={18} /> Download a Copy <span class="keys">{shortcutText(commands['file.download'].keys)}</span>
      </button>
      <div class="sep"></div>
      <div class="section">Snapshots</div>
      {#if !app.readonly}
        {#if taking}
          <div class="field">
            <input bind:this={labelEl} bind:value={label} aria-label="Snapshot name"
              onkeydown={(e) => {
                if (ime(e)) return;
                if (e.key === 'Enter') takeSnapshot();
                if (e.key === 'Escape') {
                  e.stopPropagation();
                  taking = false;
                }
              }} />
            <button class="primary" onclick={takeSnapshot}>Take</button>
          </div>
        {:else}
          <button role="menuitem" onclick={startSnapshot}><Icon name="camera" size={18} /> Take Snapshot…</button>
        {/if}
      {/if}
      <ul class="snaps">
        {#if app.pendingSnapDelete}
          <!-- Undo where the snapshot was; the status bubble also offers it once the menu is closed. -->
          <li class="deleted">
            <span>Deleted “{app.pendingSnapDelete.label}”.</span>
            <button class="undo" onclick={() => app.undoSnapshotDelete()}>Undo</button>
          </li>
        {/if}
        {#each app.snapshots as s (s.id)}
          <li class:current={app.snapshot?.id === s.id}>
            <a href="#/f/{app.file?.id}/s/{s.id}" target="_blank" rel="noopener" title="Open beside the live file" onclick={close}>
              <span class="label">{s.label}</span>
              <span class="meta">{s.kind === 'month-end' ? 'Month-end' : 'Manual'} · {fmt.format(s.takenAt)}</span>
            </a>
            {#if !app.readonly}
              <!-- Undoable: the status bubble offers Undo (Stories: prefer undo over confirming). -->
              <button class="x" aria-label={`Delete snapshot ${s.label}`} title="Delete snapshot"
                onclick={() => app.deleteSnapshot(s.id)}>×</button>
            {/if}
          </li>
        {:else}
          <li class="hint">None yet. One is taken automatically at each month-end.</li>
        {/each}
      </ul>
      <div class="sep"></div>
      <a role="menuitem" class="item" href="#/" onclick={close}><Icon name="folder" size={18} /> All Files <span class="keys">{shortcutText(commands['file.list'].keys)}</span></a>
    </div>
  {/if}
</div>

<style>
  .wrap {
    position: relative;
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 90px;
    flex: 0 1 auto;
  }
  .trigger {
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 4px;
    border: none;
    background: transparent;
    font-weight: 600;
    padding: 4px 8px;
    border-radius: var(--radius-6);
    min-width: 0;
  }
  .trigger:hover,
  .trigger.open {
    background: var(--accent-soft);
  }
  .name {
    max-width: 240px;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .state {
    color: var(--muted);
    font-size: 12px;
    white-space: nowrap;
  }
  .state.offline,
  .state.signin,
  .state.error {
    color: var(--neg);
  }
  .snap {
    background: var(--badge-warn-bg);
    color: var(--badge-warn-ink);
    border-radius: var(--radius-6);
    padding: 3px 8px;
    white-space: nowrap;
    font-size: 12px;
  }
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: calc(var(--z-topbar) - 100);
  }
  .menu {
    position: fixed;
    z-index: var(--z-topbar);
    margin-top: 40px;
    width: min(var(--popover-w), calc(100vw - 16px));
    max-height: 75vh;
    overflow-y: auto;
    background: var(--menu-bg);
    border: 1px solid var(--line);
    border-radius: var(--radius-12);
    box-shadow: var(--shadow-menu);
    padding: 6px;
    top: 0;
  }
  .menu > button,
  .menu .item {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    border: none;
    background: none;
    border-radius: var(--radius-6);
    padding: 6px 8px;
    min-height: var(--field-h);
    text-align: left;
    color: inherit;
    text-decoration: none;
  }
  @media (pointer: coarse) {
    .menu > button,
    .menu .item,
    .snaps a {
      min-height: var(--touch-target);
    }
  }
  .menu > button:hover,
  .menu > button:active,
  .menu .item:active,
  .menu .item:hover {
    background: var(--accent);
    color: var(--on-accent);
  }
  .keys {
    margin-left: auto;
    color: var(--muted);
    font-size: 12px;
  }
  .sep {
    height: 1px;
    background: var(--line);
    margin: 4px 6px;
  }
  .section {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--muted);
    padding: 6px 8px 2px;
  }
  .field {
    display: flex;
    gap: 6px;
    padding: 4px;
  }
  .field input {
    flex: 1;
    min-width: 0;
    border: 1px solid var(--accent);
    border-radius: var(--radius-6);
    padding: 6px 8px;
  }
  .primary {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--on-accent);
  }
  .snaps {
    list-style: none;
    margin: 0;
    padding: 0 2px;
  }
  .snaps li {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .snaps li.deleted {
    justify-content: space-between;
    padding: 2px 8px;
    color: var(--muted);
  }
  .undo {
    border: none;
    background: none;
    color: var(--accent);
    font-weight: 600;
    min-height: var(--touch-target);
  }
  .snaps li.current {
    background: var(--accent-soft);
    border-radius: var(--radius-6);
  }
  .snaps a {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    justify-content: center;
    padding: 4px 8px;
    border-radius: var(--radius-6);
    color: inherit;
    text-decoration: none;
  }
  .snaps a:hover {
    background: var(--head);
  }
  .label {
    font-weight: 600;
    overflow-wrap: anywhere;
  }
  .meta,
  .hint {
    color: var(--muted);
    font-size: 12px;
  }
  .hint {
    padding: 4px 8px;
  }
  .x {
    min-width: var(--touch-target);
    min-height: var(--touch-target);
    padding: 0;
    color: var(--neg);
  }
</style>
