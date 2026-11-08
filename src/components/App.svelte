<script lang="ts">
  import { onMount } from 'svelte';
  import { app } from '../lib/store.svelte';
  import SheetTabs from './SheetTabs.svelte';
  import Canvas from './Canvas.svelte';
  import Inspector from './Inspector.svelte';
  import StatusBar from './StatusBar.svelte';
  import Home from './Home.svelte';
  import Login from './Login.svelte';
  import FilesPopover from './FilesPopover.svelte';
  import TopBar from './TopBar.svelte';
  import PopupMenus from './PopupMenus.svelte';
  import ImportDialog from './ImportDialog.svelte';
  import { commandForKey, commands, isEnabled } from '../lib/commands';
  import { fileStore } from '../lib/files';
  import { session } from '../lib/session.svelte';
  import { formatsFromHTML } from '../lib/clipboard';

  /**
   * Each window shows its file in the address: #/f/<id>, or #/f/<id>/s/<snapshotId>
   * for a read-only snapshot. So windows can hold different files, or the same one.
   */
  let view = $state<'loading' | 'home' | 'file' | 'missing' | 'offline'>('loading');

  async function route() {
    if (session.mode === 'checking' || !session.signedIn) return;
    const m = location.hash.match(/^#\/f\/([\w-]+)(?:\/s\/([\w-]+))?/);
    try {
      if (!m) {
        await app.close();
        view = 'home';
        return;
      }
      view = (await app.open(m[1], m[2] ?? null)) ? 'file' : 'missing';
    } catch {
      view = session.signedIn ? 'offline' : view;
    }
  }

  /** After signing in (again): show the page, and save anything that was waiting. */
  function afterSignIn() {
    if (view === 'file' && app.file) app.flush();
    else route();
  }

  $effect(() => {
    if (view !== 'file' || !app.file) return;
    document.title = app.snapshot
      ? `${app.file.name} · ${app.snapshot.label} — Cashflow`
      : `${app.file.name} — Cashflow`;
  });


  function inField(e: Event): boolean {
    const el = e.target as HTMLElement | null;
    return !!el && (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA');
  }

  function onKeydown(e: KeyboardEvent) {
    if (view !== 'file' || inField(e)) return;
    // Menus handle their own keys.
    if ((e.target as HTMLElement | null)?.closest?.('[role="menu"]')) return;
    if (e.key === 'Escape') {
      if (app.menu) app.menu = null;
      else if (app.filesCell) app.filesCell = null;
      else if (app.selection) app.selection = null;
      else app.focusTableId = null;
      return;
    }
    app.menu = null;
    // ⌘C / ⌘X / ⌘V on a grid selection. iPad Safari never fires clipboard events without a text
    // selection, so copy and cut run here (inside the key press); paste waits for the browser's
    // paste event and asks for the clipboard only if none arrives.
    const mod0 = (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey;
    const k = e.key.toLowerCase();
    if (mod0 && (k === 'c' || k === 'x' || k === 'v') && (app.selection || app.focusTableId) && !document.getSelection()?.toString()) {
      const id = k === 'c' ? 'edit.copy' : k === 'x' ? 'edit.cut' : 'edit.paste';
      if (k === 'v') {
        pasteSeen = false;
        setTimeout(() => {
          if (!pasteSeen && isEnabled(commands[id])) void commands[id].run();
        }, 120);
        return;
      }
      e.preventDefault();
      if (isEnabled(commands[id])) void commands[id].run();
      return;
    }
    const cmd = commandForKey(e) ?? (e.key === 'Delete' && !e.metaKey && !e.ctrlKey && !e.altKey ? commands['edit.delete'] : undefined);
    if (cmd) {
      e.preventDefault();
      if (isEnabled(cmd)) void cmd.run();
      return;
    }
    // Windows-style redo.
    if (e.ctrlKey && !e.metaKey && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      app.redo();
      return;
    }
    if (!app.selection) return;
    const mod = e.metaKey || e.ctrlKey;
    if (mod || e.altKey) return;
    if (e.key === ' ' && app.table(app.selection.tableId)?.kind === 'table') {
      const t = app.table(app.selection.tableId);
      if (t?.kind === 'table' && t.columns[app.selection.anchor.c]?.type === 'checkbox') {
        e.preventDefault();
        app.toggleCheckboxes();
        return;
      }
    }
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

  /** A paste event arrived for the last ⌘V (so the fallback in onKeydown stays idle). */
  let pasteSeen = true;

  function onPaste(e: ClipboardEvent) {
    pasteSeen = true;
    if (view !== 'file' || inField(e) || !app.selection) return;
    const text = e.clipboardData?.getData('text/plain');
    if (!text) return;
    e.preventDefault();
    app.paste(text, formatsFromHTML(e.clipboardData?.getData('text/html') ?? ''));
  }

  /**
   * Safari (Mac and iPad) only offers Copy, Cut and Paste, and only fires their events, when it
   * sees something to copy: a text selection or a focused field. A grid selection is neither, so
   * cancelling these "before" events tells it the page handles the clipboard itself.
   */
  function onBeforeClipboard(e: Event) {
    if (view === 'file' && !inField(e) && app.selection && !document.getSelection()?.toString()) e.preventDefault();
  }

  /**
   * Focus follows the pointer, not Tab (Stories: Input model). Tab moves only between the text
   * fields of the panel, menu or dialog it is pressed in (the cell editor and the grid handle it
   * themselves); it never lands on buttons.
   */
  const FIELD = 'input:not([type="checkbox"]):not([type="radio"]):not([type="file"]):not([type="range"]), select, textarea';
  function onTab(e: KeyboardEvent) {
    if (e.key !== 'Tab' || e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
    e.preventDefault();
    const el = document.activeElement as HTMLElement | null;
    if (!el?.matches(FIELD)) return;
    const scope = el.closest('[role="dialog"], [role="menu"], .inspector, .login, .home') ?? document.body;
    const fields = [...scope.querySelectorAll<HTMLElement>(FIELD)].filter(
      (f) => !(f as HTMLInputElement).disabled && !f.classList.contains('editor') && f.getClientRects().length > 0,
    );
    const i = fields.indexOf(el);
    if (fields.length < 2 || i < 0) return;
    fields[(i + (e.shiftKey ? -1 : 1) + fields.length) % fields.length].focus();
  }

  // A size change that crosses a size class closes menus (cheap to reopen; Stories: Adapting).
  let lastClass = app.sizeClass;
  $effect(() => {
    const c = app.sizeClass;
    if (c !== lastClass) {
      lastClass = c;
      app.menu = null;
    }
  });

  onMount(() => {
    const flush = () => app.flush();
    // Measure the app's container, not the device.
    const ro = new ResizeObserver(() => (app.width = document.documentElement.clientWidth));
    ro.observe(document.documentElement);
    // The software keyboard: inset by what it covers, so sheets and the status bubble stay above it.
    const vv = window.visualViewport;
    const onViewport = () => {
      const covered = vv ? Math.max(0, window.innerHeight - vv.height - vv.offsetTop) : 0;
      document.documentElement.style.setProperty('--kb-inset', `${Math.round(covered)}px`);
    };
    vv?.addEventListener('resize', onViewport);
    vv?.addEventListener('scroll', onViewport);
    window.addEventListener('keydown', onTab);
    const refresh = () => app.refreshMonths();
    let unwatch = () => {};
    // Unsaved edits that the server hasn't confirmed: ask before closing the window.
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (fileStore.kind === 'remote' && app.unsaved) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    session.init().then(() => {
      unwatch = fileStore.watch((e) => {
        if (!app.file || e.kind === 'list') return;
        if (e.id !== app.file.id) return;
        if (e.kind === 'snapshots') app.refreshSnapshots();
        else app.onExternalChange();
      });
      route();
    });
    window.addEventListener('hashchange', route);
    window.addEventListener('beforeunload', onBeforeUnload);
    // Non-standard WebKit events (no Svelte attribute for them).
    for (const t of ['beforecopy', 'beforecut', 'beforepaste']) document.addEventListener(t, onBeforeClipboard);
    window.addEventListener('pagehide', flush);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flush();
      else refresh();
    });
    return () => {
      ro.disconnect();
      vv?.removeEventListener('resize', onViewport);
      vv?.removeEventListener('scroll', onViewport);
      window.removeEventListener('keydown', onTab);
      unwatch();
      window.removeEventListener('hashchange', route);
      window.removeEventListener('beforeunload', onBeforeUnload);
      for (const t of ['beforecopy', 'beforecut', 'beforepaste']) document.removeEventListener(t, onBeforeClipboard);
      window.removeEventListener('pagehide', flush);
      window.removeEventListener('focus', refresh);
    };
  });
</script>

<svelte:window onkeydown={onKeydown} />
<svelte:document oncopy={onCopy} oncut={onCut} onpaste={onPaste} />

{#if session.mode === 'remote' && !session.signedIn && (view === 'loading' || view === 'home' || view === 'offline')}
  <Login onsignedin={afterSignIn} />
{:else if view === 'home'}
  <Home />
{:else if view === 'missing'}
  <div class="missing">
    <p>
      {session.mode === 'remote'
        ? "This file doesn't exist. It may have been deleted."
        : "This file doesn't exist in this browser. It may have been deleted, or it was made on another device."}
    </p>
    <a href="#/">‹ All files</a>
  </div>
{:else if view === 'offline'}
  <div class="missing">
    <p>Can't reach the server. Check the connection and try again.</p>
    <button onclick={route}>Try again</button>
  </div>
{:else if view === 'file' && app.file}
  {@const importTable = app.importing ? app.table(app.importing.tableId) : undefined}
  <div class="shell">
    <TopBar />
    <SheetTabs />
    <div class="main">
      <Canvas />
      {#if app.showInspector}
        <Inspector />
      {/if}
    </div>
    <StatusBar />
    <FilesPopover />
    <PopupMenus />
    {#if app.importing && importTable?.kind === 'table'}
      <ImportDialog dataTable={importTable} fileName={app.importing.fileName} sheets={app.importing.sheets} onclose={() => (app.importing = null)} />
    {/if}
  </div>
  {#if session.mode === 'remote' && !session.signedIn}
    <Login overlay onsignedin={afterSignIn} />
  {/if}
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
    position: relative;
  }
</style>
