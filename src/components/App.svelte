<script lang="ts">
  import { onMount } from 'svelte';
  import { app } from '../lib/store.svelte';
  import SheetTabs from './SheetTabs.svelte';
  import Toolbar from './Toolbar.svelte';
  import Canvas from './Canvas.svelte';
  import Inspector from './Inspector.svelte';
  import StatusBar from './StatusBar.svelte';

  let showInspector = $state(typeof window !== 'undefined' && window.innerWidth >= 1000);

  function inField(e: Event): boolean {
    const el = e.target as HTMLElement | null;
    return !!el && (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA');
  }

  function onKeydown(e: KeyboardEvent) {
    if (inField(e)) return;
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
    if (inField(e) || !app.selection) return;
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
    if (inField(e) || !app.selection) return;
    const text = e.clipboardData?.getData('text/plain');
    if (!text) return;
    e.preventDefault();
    app.paste(text);
  }

  onMount(() => {
    const flush = () => app.flush();
    const refresh = () => app.refreshMonths();
    window.addEventListener('pagehide', flush);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flush();
      else refresh();
    });
    return () => {
      window.removeEventListener('pagehide', flush);
      window.removeEventListener('focus', refresh);
    };
  });
</script>

<svelte:window onkeydown={onKeydown} />
<svelte:document oncopy={onCopy} oncut={onCut} onpaste={onPaste} />

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

<style>
  .shell {
    display: flex;
    flex-direction: column;
    height: 100%;
    padding-top: env(safe-area-inset-top);
  }
  .main {
    flex: 1;
    display: flex;
    min-height: 0;
  }
</style>
