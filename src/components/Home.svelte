<script lang="ts">
  import { onMount } from 'svelte';
  import { buildExport, exportFilename, fileStore, fromExport, importedName, localFileStore, type FileMeta } from '../lib/files';
  import { downloadText } from '../lib/download';
  import { session } from '../lib/session.svelte';

  let files = $state<FileMeta[]>([]);
  let loaded = $state(false);
  let error = $state('');
  let importEl = $state<HTMLInputElement | null>(null);
  let localOnly = $state<FileMeta[]>([]);
  let uploading = $state(false);

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
      alert((e as Error).message || 'That did not work. Check the connection and try again.');
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
      alert(`Uploaded ${done} file(s), then: ${(e as Error).message}`);
    }
    uploading = false;
    refresh();
  }

  function open(id: string) {
    location.hash = `#/f/${id}`;
  }

  async function create() {
    const name = prompt('Name for the new file', 'Untitled');
    if (!name?.trim()) return;
    await attempt(async () => open((await fileStore.create(name.trim())).id));
  }

  async function rename(f: FileMeta) {
    const name = prompt('File name', f.name);
    if (!name?.trim()) return;
    await attempt(() => fileStore.rename(f.id, name));
  }

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
    if (!confirm(`Delete "${f.name}"? Download it first if you may need it again.`)) return;
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
      alert(err instanceof SyntaxError || (err as Error).message === 'not a cashflow file' ? 'That is not a Cashflow file.' : (err as Error).message);
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

  {#if loaded && !error && files.length === 0}
    <p class="empty">No files yet. Create one, or import a downloaded file.</p>
  {/if}

  <ul class="list">
    {#each files as f (f.id)}
      <li>
        <a class="name" href="#/f/{f.id}">{f.name}</a>
        <span class="when">Edited {fmt.format(f.updatedAt)}</span>
        <span class="buttons">
          <a class="btn" href="#/f/{f.id}" target="_blank" rel="noopener" title="Open in a new window">New window</a>
          <button onclick={() => rename(f)}>Rename</button>
          <button onclick={() => duplicate(f)}>Duplicate</button>
          <button onclick={() => download(f)}>Download</button>
          <button class="danger" onclick={() => remove(f)}>Delete</button>
        </span>
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
    color: #fff;
  }
  .list {
    list-style: none;
    padding: 0;
    margin: 0;
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 10px;
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
    border-radius: 6px;
    padding: 4px 10px;
    min-height: 30px;
    color: inherit;
    text-decoration: none;
  }
  .banner {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    align-items: center;
    justify-content: space-between;
    background: #eef4ff;
    border: 1px solid #c9dafc;
    border-radius: 10px;
    padding: 10px 14px;
    margin-bottom: 14px;
    line-height: 1.5;
  }
  .error {
    color: var(--neg);
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
