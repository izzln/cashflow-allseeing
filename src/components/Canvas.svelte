<script lang="ts">
  import { onMount } from 'svelte';
  import { app, tableHeight, tableWidth } from '../lib/store.svelte';
  import TableFrame from './TableFrame.svelte';
  import CashflowGrid from './CashflowGrid.svelte';
  import TableGrid from './TableGrid.svelte';
  import TableTabs from './TableTabs.svelte';

  let canvasEl: HTMLDivElement;
  let contentEl: HTMLDivElement;
  let editorEl: HTMLInputElement;
  let overlayEl = $state<HTMLDivElement | null>(null);
  const z = $derived(app.zoom);
  /** Margin around the zoomed canvas so row/column tabs never fall off its edge at small zoom. */
  const PAD = 40;
  const focused = $derived(app.focusTableId ? app.sheet.tables.find((t) => t.id === app.focusTableId) : undefined);

  const maxTable = $derived(app.maximizedId ? app.sheet.tables.find((t) => t.id === app.maximizedId) : undefined);
  const size = $derived.by(() => {
    let w = 0;
    let h = 0;
    for (const t of app.sheet.tables) {
      w = Math.max(w, t.x + tableWidth(t, app.months.length));
      h = Math.max(h, t.y + tableHeight(t));
    }
    return { w: w + 400, h: h + 400 };
  });

  onMount(() => {
    app.contentEl = contentEl;
    app.editorEl = editorEl;
    app.canvasEl = canvasEl;
    // Pinch to zoom. Trackpads in Chrome/Firefox send ctrl+wheel; Safari (Mac and iPad)
    // sends gesture events. Both are stopped from zooming the whole page.
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey || app.maximizedId) return;
      e.preventDefault();
      void app.setZoom(app.zoom * Math.exp(-e.deltaY * 0.01), { x: e.clientX, y: e.clientY });
    };
    let base = 1;
    const onGestureStart = (e: Event) => {
      e.preventDefault();
      base = app.zoom;
    };
    const onGestureChange = (e: Event) => {
      e.preventDefault();
      if (app.maximizedId) return;
      const g = e as Event & { scale: number; clientX: number; clientY: number };
      void app.setZoom(base * g.scale, { x: g.clientX, y: g.clientY });
    };
    canvasEl.addEventListener('wheel', onWheel, { passive: false });
    canvasEl.addEventListener('gesturestart', onGestureStart);
    canvasEl.addEventListener('gesturechange', onGestureChange);
    return () => {
      canvasEl.removeEventListener('wheel', onWheel);
      canvasEl.removeEventListener('gesturestart', onGestureStart);
      canvasEl.removeEventListener('gesturechange', onGestureChange);
    };
  });

  function onBackground(e: PointerEvent) {
    // Empty canvas, or the margin around it.
    if (e.target !== contentEl && e.target !== e.currentTarget) return;
    app.commitEdit();
    app.selection = null;
    app.focusTableId = null;
  }

  function onEditorKey(e: KeyboardEvent) {
    // While an input method (e.g. Chinese pinyin) is composing, Enter picks a candidate.
    if (e.isComposing || e.keyCode === 229) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      app.commitEdit();
      app.move(e.shiftKey ? -1 : 1, 0);
    } else if (e.key === 'Tab') {
      e.preventDefault();
      app.commitEdit();
      app.move(0, e.shiftKey ? -1 : 1);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      app.cancelEdit();
    }
  }
</script>

<div class="canvas" bind:this={canvasEl} onscroll={() => app.menu?.kind === 'edit' && (app.menu = null)}>
  <!-- The zoomer has the zoomed size (so scrolling covers it); the content inside is scaled. -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="zoomer" onpointerdown={onBackground} class:filled={!!maxTable} style={maxTable ? '' : `width:${size.w * z + PAD}px;height:${size.h * z + PAD}px`}>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="content"
    bind:this={contentEl}
    class:filled={!!maxTable}
    style={maxTable ? '' : `left:${PAD}px;top:${PAD}px;width:${size.w}px;height:${size.h}px;transform:${z === 1 ? 'none' : `scale(${z})`}`}
  >
    {#if maxTable}
      <TableFrame table={maxTable} maximized>
        {#if maxTable.kind === 'table'}<TableGrid table={maxTable} />{:else}<CashflowGrid table={maxTable} />{/if}
      </TableFrame>
    {:else}
      {#each app.sheet.tables as t (t.id)}
        <TableFrame table={t}>
          {#if t.kind === 'table'}<TableGrid table={t} />{:else}<CashflowGrid table={t} />{/if}
        </TableFrame>
      {/each}
    {/if}
    <input
      class="editor"
      class:open={!!app.editing}
      bind:this={editorEl}
      onkeydown={onEditorKey}
      onblur={() => app.commitEdit()}
      autocomplete="off"
      autocapitalize="off"
      spellcheck="false"
      aria-label="Cell editor"
    />
  </div>
  {#if !maxTable}
    <!-- Row and column tabs live outside the scaled content so they stay full size at any zoom. -->
    <div class="overlay" bind:this={overlayEl}>
      {#if focused && overlayEl}<TableTabs table={focused} layer={overlayEl} />{/if}
    </div>
  {/if}
  </div>
</div>

<style>
  .canvas {
    flex: 1;
    overflow: auto;
    position: relative;
    -webkit-overflow-scrolling: touch;
  }
  .zoomer {
    position: relative;
    min-width: 100%;
    min-height: 100%;
  }
  .zoomer.filled {
    position: absolute;
    inset: 0;
  }
  .overlay {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }
  .overlay :global(*) {
    pointer-events: auto;
  }
  .content {
    position: absolute;
    left: 0;
    top: 0;
    transform-origin: 0 0;
    min-width: 100%;
    min-height: 100%;
    background-image: radial-gradient(circle, #d4d8de 1px, transparent 1.2px);
    background-size: 20px 20px;
    background-position: -10px -10px;
  }
  .content.filled {
    position: absolute;
    inset: 0;
    background-image: none;
  }
  .editor {
    min-height: 0;
    position: absolute;
    left: -9999px;
    top: 0;
    width: 10px;
    height: 10px;
    opacity: 0;
    z-index: var(--z-editor);
    border: 2px solid var(--accent);
    padding: 0 7px;
    font-variant-numeric: tabular-nums;
    background: var(--panel);
    outline: none;
    box-shadow: var(--shadow-raised);
  }
  .editor.open {
    opacity: 1;
  }
  /* When closed it must not sit over the last edited cell and swallow clicks. */
  .editor:not(.open) {
    pointer-events: none;
  }
</style>
