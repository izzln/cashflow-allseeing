<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { app } from '../lib/store.svelte';
  import { buildExport, exportFilename, fileStore, fromExport, importedName, localFileStore, type FileMeta } from '../lib/files';
  import { downloadText } from '../lib/download';
  import { session } from '../lib/session.svelte';

  let files = $state<FileMeta[]>([]);
  let loaded = $state(false);
  let error = $state('');
  let importEl = $state<HTMLInputElement | null>(null);
  let localOnly = $state<FileMeta[]>([]);
  let uploading = $state(false);
  /** A failed action, shown at the top of the list until dismissed. */
  let problem = $state('');

  async function refresh() {
    try {
      files = await fileStore.list();
      error = '';
      localOnly = await session.localOnlyFiles();
    } catch (e) {
      error = (e as Error).message || 'Could not load your files.';
    }
    loaded = true;
  }

  /** Run a file action, turning failures into a message instead of a silent no-op. */
  async function attempt(fn: () => Promise<unknown>) {
    try {
      await fn();
    } catch (e) {
      problem = (e as Error).message || 'That did not work. Check the connection and try again.';
    }
    refresh();
  }

  /** Copy files kept in this browser (from before the server) to the server, with their snapshots. */
  async function upload() {
    uploading = true;
    let done = 0;
    try {
      for (const f of localOnly) {
        const data = await buildExport(localFileStore, f.id);
        if (!data) continue;
        const names = (await fileStore.list()).map((x) => x.name);
        await fileStore.create(
          importedName(data.name, names),
          data.workbook,
          data.snapshots.map((s) => ({ meta: s.meta, wb: s.workbook })),
        );
        session.markUploaded(f.id);
        done++;
      }
    } catch (e) {
      problem = `Uploaded ${done} file(s), then: ${(e as Error).message}`;
    }
    uploading = false;
    refresh();
  }

  function open(id: string) {
    location.hash = `#/f/${id}`;
  }

  /** A new file opens straight away as "Untitled", with its name ready to type over (no prompt). */
  async function create() {
    const names = files.map((f) => f.name);
    let name = 'Untitled';
    for (let i = 2; names.includes(name); i++) name = `Untitled ${i}`;
    await attempt(async () => {
      const meta = await fileStore.create(name);
      app.fileMenuRequest = 'rename';
      open(meta.id);
    });
  }

  // ----- rename in place -----
  let renamingId = $state<string | null>(null);
  let draft = $state('');
  let renameEl = $state<HTMLInputElement | null>(null);

  async function startRename(f: FileMeta) {
    renamingId = f.id;
    draft = f.name;
    await tick();
    renameEl?.focus();
    renameEl?.select();
  }

  async function finishRename(save: boolean) {
    const id = renamingId;
    renamingId = null;
    const f = files.find((x) => x.id === id);
    if (save && f && draft.trim() && draft.trim() !== f.name) await attempt(() => fileStore.rename(f.id, draft.trim()));
  }

  // Deleting a file can't be undone, so the row asks first (in place, not a browser dialog).
  let confirmId = $state<string | null>(null);

  async function duplicate(f: FileMeta) {
    await attempt(() => fileStore.duplicate(f.id));
  }

  async function download(f: FileMeta) {
    await attempt(async () => {
      const data = await buildExport(fileStore, f.id);
      if (data) downloadText(exportFilename(f.name), JSON.stringify(data, null, 2));
    });
  }

  async function remove(f: FileMeta) {
    confirmId = null;
    await attempt(() => fileStore.remove(f.id));
  }

  async function importFile(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    try {
      const data = fromExport(JSON.parse(await file.text()), file.name.replace(/\.json$/i, ''));
      if (!data) throw new Error('not a cashflow file');
      const names = (await fileStore.list()).map((f) => f.name);
      const meta = await fileStore.create(importedName(data.name, names, data.exportedAt), data.wb, data.snapshots);
      open(meta.id);
    } catch (err) {
      problem = err instanceof SyntaxError || (err as Error).message === 'not a cashflow file' ? 'That is not a Cashflow file.' : (err as Error).message;
    }
  }

  const fmt = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

  onMount(() => {
    refresh();
    const unwatch = fileStore.watch((e) => {
      if (e.kind === 'list' || e.kind === 'file') refresh();
    });
    document.title = 'Cashflow — Files';
    return unwatch;
  });
</script>

<main class="home">
  <header>
    <h1>Cashflow</h1>
    <div class="actions">
      <button class="primary" onclick={create}>+ New file</button>
      <button onclick={() => importEl?.click()}>Import file…</button>
      <input bind:this={importEl} type="file" accept="application/json,.json" hidden onchange={importFile} />
      {#if session.mode === 'remote'}<button onclick={() => session.logout()}>Sign out</button>{/if}
    </div>
  </header>

  {#if localOnly.length}
    <div class="banner">
      <span>
        {localOnly.length} file{localOnly.length === 1 ? ' is' : 's are'} saved only in this browser
        ({localOnly.map((f) => f.name).join(', ')}). Upload {localOnly.length === 1 ? 'it' : 'them'} so
        {localOnly.length === 1 ? 'it shows' : 'they show'} on all your devices. The browser copy is kept.
      </span>
      <button class="primary" disabled={uploading} onclick={upload}>{uploading ? 'Uploading…' : 'Upload'}</button>
    </div>
  {/if}

  {#if error}<p class="error">{error} <button onclick={refresh}>Try again</button></p>{/if}
  {#if problem}<p class="error" role="alert">{problem} <button onclick={() => (problem = '')}>OK</button></p>{/if}

  {#if loaded && !error && files.length === 0}
    <p class="empty">No files yet. Create one, or import a downloaded file.</p>
  {/if}

  <ul class="list">
    {#each files as f (f.id)}
      <li>
        {#if renamingId === f.id}
          <input class="rename" bind:this={renameEl} bind:value={draft} aria-label="File name"
            onblur={() => finishRename(true)}
            onkeydown={(e) => {
              if (e.isComposing || e.keyCode === 229) return;
              if (e.key === 'Enter') finishRename(true);
              if (e.key === 'Escape') finishRename(false);
            }} />
        {:else}
          <a class="name" href="#/f/{f.id}" ondblclick={(e) => { e.preventDefault(); startRename(f); }}>{f.name}</a>
        {/if}
        <span class="when">Edited {fmt.format(f.updatedAt)}</span>
        <span class="buttons">
          <a class="btn" href="#/f/{f.id}" target="_blank" rel="noopener" title="Open in a new window">New Window</a>
          <button onclick={() => startRename(f)}>Rename…</button>
          <button onclick={() => duplicate(f)}>Duplicate</button>
          <button onclick={() => download(f)}>Download</button>
          <button class="danger" onclick={() => (confirmId = confirmId === f.id ? null : f.id)}>Delete…</button>
        </span>
        {#if confirmId === f.id}
          <div class="confirm" role="alertdialog" aria-label="Delete file">
            <span>Delete “{f.name}”? This can’t be undone. Download a copy first if you may need it.</span>
            <button onclick={() => (confirmId = null)}>Cancel</button>
            <button class="danger-fill" onclick={() => remove(f)}>Delete</button>
          </div>
        {/if}
      </li>
    {/each}
  </ul>

  <p class="note">
    {#if session.mode === 'remote'}
      Files are saved on your server and show up on every device you sign in on. Download a file (it
      includes its snapshots) to keep your own copy. Importing always creates a new file and never
      overwrites one.
    {:else}
      Files are stored in this browser, so each device has its own list. Download a file (it includes
      its snapshots) to move it to another device or keep a copy. Importing always creates a new file
      and never overwrites one.
    {/if}
  </p>
</main>

<style>
  .home {
    height: 100%;
    overflow-y: auto;
    max-width: 920px;
    margin: 0 auto;
    padding: calc(24px + env(safe-area-inset-top)) 16px 40px;
  }
  header {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 16px;
  }
  h1 {
    font-size: 22px;
    margin: 0;
  }
  .actions {
    display: flex;
    gap: 8px;
  }
  .primary {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--on-accent);
  }
  .list {
    list-style: none;
    padding: 0;
    margin: 0;
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: var(--radius-10);
  }
  .list:empty {
    display: none;
  }
  li {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 14px;
    padding: 10px 14px;
    border-bottom: 1px solid var(--line);
  }
  li:last-child {
    border-bottom: none;
  }
  .name {
    font-weight: 600;
    font-size: 15px;
    color: var(--text);
    text-decoration: none;
    flex: 1 1 200px;
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .when {
    color: var(--muted);
    font-size: 12px;
  }
  .buttons {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .btn {
    display: inline-flex;
    align-items: center;
    border: 1px solid var(--line);
    background: var(--panel);
    border-radius: var(--radius-6);
    padding: 4px 10px;
    min-height: var(--control-h);
    color: inherit;
    text-decoration: none;
  }
  .banner {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    align-items: center;
    justify-content: space-between;
    background: var(--banner-bg);
    border: 1px solid var(--banner-line);
    border-radius: var(--radius-10);
    padding: 10px 14px;
    margin-bottom: 14px;
    line-height: 1.5;
  }
  .error {
    color: var(--neg);
  }
  .rename {
    flex: 1 1 200px;
    font-weight: 600;
    font-size: 15px;
    border: 1px solid var(--accent);
    border-radius: var(--radius-6);
    padding: 4px 8px;
  }
  .confirm {
    flex: 1 1 100%;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    background: var(--head);
    border-radius: var(--radius-8);
    padding: 8px 10px;
  }
  .confirm span {
    flex: 1 1 260px;
  }
  .danger-fill {
    background: var(--neg);
    border-color: var(--neg);
    color: var(--on-accent);
  }
  .empty,
  .note {
    color: var(--muted);
    line-height: 1.5;
  }
  .note {
    margin-top: 16px;
    font-size: 12px;
  }
</style>
