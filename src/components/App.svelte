<script lang="ts">
  import { onMount } from 'svelte';
  import { app } from '../lib/store.svelte';
  import SheetTabs from './SheetTabs.svelte';
  import Toolbar from './Toolbar.svelte';
  import Canvas from './Canvas.svelte';
  import Inspector from './Inspector.svelte';
  import StatusBar from './StatusBar.svelte';
  import Home from './Home.svelte';
  import { isFileKey, isSnapshotKey } from '../lib/files';

  /**
   * Each window shows its file in the address: #/f/<id>, or #/f/<id>/s/<snapshotId>
   * for a read-only snapshot. So windows can hold different files, or the same one.
   */
  let view = $state<'loading' | 'home' | 'file' | 'missing'>('loading');

  async function route() {
    const m = location.hash.match(/^#\/f\/([\w-]+)(?:\/s\/([\w-]+))?/);
    if (!m) {
      await app.close();
      view = 'home';
      return;
    }
    view = (await app.open(m[1], m[2] ?? null)) ? 'file' : 'missing';
  }

  $effect(() => {
    if (view !== 'file' || !app.file) return;
    document.title = app.snapshot
      ? `${app.file.name} · ${app.snapshot.label} — Cashflow`
      : `${app.file.name} — Cashflow`;
  });

  let showInspector = $state(typeof window !== 'undefined' && window.innerWidth >= 1000);

  function inField(e: Event): boolean {
    const el = e.target as HTMLElement | null;
    return !!el && (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA');
  }

  function onKeydown(e: KeyboardEvent) {
    if (view !== 'file' || inField(e)) return;
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) app.redo();
      else app.undo();
      return;
    }
    if (mod && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      app.redo();
      return;
    }
    if (!app.selection) return;
    if (mod && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      app.selectAll();
      return;
    }
    if (mod || e.altKey) return;
    const moves: Record<string, [number, number]> = {
      ArrowUp: [-1, 0],
      ArrowDown: [1, 0],
      ArrowLeft: [0, -1],
      ArrowRight: [0, 1],
    };
    if (e.key in moves) {
      e.preventDefault();
      const [dr, dc] = moves[e.key];
      app.move(dr, dc, e.shiftKey);
    } else if (e.key === 'Tab') {
      e.preventDefault();
      app.move(0, e.shiftKey ? -1 : 1);
    } else if (e.key === 'Enter' || e.key === 'F2') {
      e.preventDefault();
      app.startEdit();
    } else if (e.key === 'Backspace' || e.key === 'Delete') {
      e.preventDefault();
      app.clearSelected();
    } else if (e.key === 'Escape') {
      app.selection = null;
    } else if (e.key.length === 1 && !e.isComposing) {
      // Typing on a selected cell replaces its content, like Excel.
      e.preventDefault();
      app.startEdit(e.key);
    }
  }

  function onCopy(e: ClipboardEvent) {
    if (view !== 'file' || inField(e) || !app.selection) return;
    const data = app.copyData();
    if (!data || !e.clipboardData) return;
    e.preventDefault();
    e.clipboardData.setData('text/plain', data.text);
    e.clipboardData.setData('text/html', data.html);
  }

  function onCut(e: ClipboardEvent) {
    onCopy(e);
    if (e.defaultPrevented) app.clearSelected();
  }

  function onPaste(e: ClipboardEvent) {
    if (view !== 'file' || inField(e) || !app.selection) return;
    const text = e.clipboardData?.getData('text/plain');
    if (!text) return;
    e.preventDefault();
    app.paste(text);
  }

  onMount(() => {
    const flush = () => app.flush();
    const refresh = () => app.refreshMonths();
    const onStorage = (e: StorageEvent) => {
      if (app.file && isSnapshotKey(e.key, app.file.id)) app.refreshSnapshots();
      else if (isFileKey(e.key)) app.onExternalChange();
    };
    route();
    window.addEventListener('hashchange', route);
    window.addEventListener('storage', onStorage);
    window.addEventListener('pagehide', flush);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flush();
      else refresh();
    });
    return () => {
      window.removeEventListener('hashchange', route);
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('pagehide', flush);
      window.removeEventListener('focus', refresh);
    };
  });
</script>

<svelte:window onkeydown={onKeydown} />
<svelte:document oncopy={onCopy} oncut={onCut} onpaste={onPaste} />

{#if view === 'home'}
  <Home />
{:else if view === 'missing'}
  <div class="missing">
    <p>This file doesn't exist in this browser. It may have been deleted, or it was made on another device.</p>
    <a href="#/">‹ All files</a>
  </div>
{:else if view === 'file' && app.file}
  <div class="shell">
    <SheetTabs />
    <Toolbar bind:showInspector />
    <div class="main">
      <Canvas />
      {#if showInspector}
        <Inspector />
      {/if}
    </div>
    <StatusBar />
  </div>
{/if}

<style>
  .shell {
    display: flex;
    flex-direction: column;
    height: 100%;
    padding-top: env(safe-area-inset-top);
  }
  .missing {
    max-width: 520px;
    margin: 80px auto;
    padding: 0 16px;
    line-height: 1.5;
  }
  .main {
    flex: 1;
    display: flex;
    min-height: 0;
  }
</style>
