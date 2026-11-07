<script lang="ts">
  import { onMount } from 'svelte';
  import { app, tableHeight, tableWidth } from '../lib/store.svelte';
  import TableFrame from './TableFrame.svelte';
  import CashGrid from './CashGrid.svelte';
  import LedgerGrid from './LedgerGrid.svelte';

  let contentEl: HTMLDivElement;
  let editorEl: HTMLInputElement;

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
  });

  function onBackground(e: PointerEvent) {
    if (e.target !== contentEl) return;
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

<div class="canvas">
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="content"
    bind:this={contentEl}
    style="width:{size.w}px;height:{size.h}px"
    onpointerdown={onBackground}
  >
    {#each app.sheet.tables as t (t.id)}
      <TableFrame table={t}>
        {#if t.kind === 'ledger'}<LedgerGrid table={t} />{:else}<CashGrid table={t} />{/if}
      </TableFrame>
    {/each}
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
</div>

<style>
  .canvas {
    flex: 1;
    overflow: auto;
    position: relative;
    -webkit-overflow-scrolling: touch;
  }
  .content {
    position: relative;
    min-width: 100%;
    min-height: 100%;
    background-image: radial-gradient(circle, #d4d8de 1px, transparent 1.2px);
    background-size: 20px 20px;
    background-position: -10px -10px;
  }
  .editor {
    position: absolute;
    left: -9999px;
    top: 0;
    width: 10px;
    height: 10px;
    opacity: 0;
    z-index: 1000;
    border: 2px solid var(--accent);
    padding: 0 7px;
    font-variant-numeric: tabular-nums;
    background: #fff;
    outline: none;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
  }
  .editor.open {
    opacity: 1;
  }
  /* When closed it must not sit over the last edited cell and swallow clicks. */
  .editor:not(.open) {
    pointer-events: none;
  }
</style>
