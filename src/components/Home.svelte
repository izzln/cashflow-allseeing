<script lang="ts">
  import { onMount } from 'svelte';
  import { buildExport, exportFilename, fileStore, fromExport, importedName, isFileKey, type FileMeta } from '../lib/files';
  import { downloadText } from '../lib/download';

  let files = $state<FileMeta[]>([]);
  let loaded = $state(false);
  let importEl = $state<HTMLInputElement | null>(null);

  async function refresh() {
    files = await fileStore.list();
    loaded = true;
  }

  function open(id: string) {
    location.hash = `#/f/${id}`;
  }

  async function create() {
    const name = prompt('Name for the new file', 'Untitled');
    if (!name?.trim()) return;
    const meta = await fileStore.create(name.trim());
    open(meta.id);
  }

  async function rename(f: FileMeta) {
    const name = prompt('File name', f.name);
    if (!name?.trim()) return;
    await fileStore.rename(f.id, name);
    refresh();
  }

  async function duplicate(f: FileMeta) {
    await fileStore.duplicate(f.id);
    refresh();
  }

  async function download(f: FileMeta) {
    const data = await buildExport(fileStore, f.id);
    if (data) downloadText(exportFilename(f.name), JSON.stringify(data, null, 2));
  }

  async function remove(f: FileMeta) {
    if (!confirm(`Delete "${f.name}"? Download it first if you may need it again.`)) return;
    await fileStore.remove(f.id);
    refresh();
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
    } catch {
      alert('That is not a Cashflow file.');
    }
  }

  const fmt = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

  onMount(() => {
    refresh();
    const onStorage = (e: StorageEvent) => isFileKey(e.key) && refresh();
    window.addEventListener('storage', onStorage);
    window.addEventListener('focus', refresh);
    document.title = 'Cashflow — Files';
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('focus', refresh);
    };
  });
</script>

<main class="home">
  <header>
    <h1>Cashflow</h1>
    <div class="actions">
      <button class="primary" onclick={create}>+ New file</button>
      <button onclick={() => importEl?.click()}>Import file…</button>
      <input bind:this={importEl} type="file" accept="application/json,.json" hidden onchange={importFile} />
    </div>
  </header>

  {#if loaded && files.length === 0}
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
    Files are stored in this browser for now, so each device has its own list. Download a file (it
    includes its snapshots) to move it to another device or keep a copy. Importing always creates a
    new file and never overwrites one.
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
