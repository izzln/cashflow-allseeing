<script lang="ts">
  import type { Snippet } from 'svelte';
  import { app, TITLE_H } from '../lib/store.svelte';
  import { cellsInRanges, type Pos } from '../lib/grid';
  import type { Table } from '../lib/model';

  let { table, children }: { table: Table; children: Snippet } = $props();

  const sel = $derived(app.selection?.tableId === table.id ? app.selection : null);
  const selected = $derived(new Set(sel ? cellsInRanges(sel.ranges).map((p) => `${p.r},${p.c}`) : []));

  function isAnchor(p: Pos): boolean {
    return !!sel && sel.anchor.r === p.r && sel.anchor.c === p.c;
  }

  // ----- pointer handling -----
  // Mouse: press and drag selects a range; Shift extends; ⌘/Ctrl adds a range.
  // Touch: tap selects (a drag on an unselected cell scrolls the canvas);
  //        drag from a selected cell extends; tap the selected cell again to edit.

  let dragging = false;
  let pendingTap: Pos | null = null;
  let tapToEdit = false;
  let moved = false;

  function posOf(el: Element | null): Pos | null {
    const cell = el?.closest<HTMLElement>('[data-r]');
    if (!cell || cell.dataset.t !== table.id) return null;
    return { r: Number(cell.dataset.r), c: Number(cell.dataset.c) };
  }

  function onCellDown(e: PointerEvent) {
    const p = posOf(e.target as Element);
    if (!p) return;
    if (app.editing) app.commitEdit();
    moved = false;
    if (e.pointerType === 'touch') {
      if (!selected.has(`${p.r},${p.c}`)) {
        pendingTap = p;
        return;
      }
      tapToEdit = isAnchor(p) && selected.size === 1;
      dragging = true;
    } else {
      // preventDefault stops text selection but also keeps focus where it was;
      // release a panel field so typing reaches the grid.
      e.preventDefault();
      const active = document.activeElement as HTMLElement | null;
      if (active && active !== app.editorEl && /^(INPUT|SELECT|TEXTAREA|BUTTON)$/.test(active.tagName)) active.blur();
      const mode = e.shiftKey ? 'extend' : e.metaKey || e.ctrlKey ? 'add' : 'new';
      app.select(table.id, p, mode);
      dragging = true;
    }
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp, { once: true });
  }

  function onMove(e: PointerEvent) {
    if (!dragging) return;
    const p = posOf(document.elementFromPoint(e.clientX, e.clientY));
    if (!p) return;
    const last = sel?.ranges[sel.ranges.length - 1];
    if (last && (last.b.r !== p.r || last.b.c !== p.c)) {
      moved = true;
      app.select(table.id, p, 'extend');
    }
  }

  function onUp() {
    window.removeEventListener('pointermove', onMove);
    dragging = false;
    if (tapToEdit && !moved) app.startEdit();
    tapToEdit = false;
  }

  function onTouchUp(e: PointerEvent) {
    if (e.pointerType !== 'touch' || !pendingTap) return;
    const p = posOf(e.target as Element);
    if (p && p.r === pendingTap.r && p.c === pendingTap.c) app.select(table.id, p);
    pendingTap = null;
  }

  function onDblClick(e: MouseEvent) {
    const p = posOf(e.target as Element);
    if (!p) return;
    app.select(table.id, p);
    app.startEdit();
  }

  // ----- moving the table by its title bar -----
  let moveStart: { x: number; y: number; tx: number; ty: number; checkpointed: boolean } | null = null;

  function onTitleDown(e: PointerEvent) {
    if ((e.target as HTMLElement).closest('button')) return;
    e.preventDefault();
    app.commitEdit();
    app.focusTableId = table.id;
    if (app.readonly) return;
    moveStart = { x: e.clientX, y: e.clientY, tx: table.x, ty: table.y, checkpointed: false };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onTitleMove(e: PointerEvent) {
    if (!moveStart) return;
    const dx = e.clientX - moveStart.x;
    const dy = e.clientY - moveStart.y;
    if (!moveStart.checkpointed) {
      if (Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
      app.checkpoint();
      app.bringToFront(table.id);
      moveStart.checkpointed = true;
    }
    app.moveTable(table.id, moveStart.tx + dx, moveStart.ty + dy);
  }

  function onTitleUp() {
    if (moveStart?.checkpointed) app.save();
    moveStart = null;
  }
</script>

<div class="table" class:focused={app.focusTableId === table.id} style="left:{table.x}px;top:{table.y}px">
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="title"
    style="height:{TITLE_H}px"
    onpointerdown={onTitleDown}
    onpointermove={onTitleMove}
    onpointerup={onTitleUp}
    onpointercancel={onTitleUp}
  >
    <span class="grip">⠿</span>
    <span class="name">{table.name}</span>
    {#if table.kind === 'ledger'}<span class="kind">Ledger</span>{/if}
  </div>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="body"
    class:has-sel={!!sel}
    onpointerdown={onCellDown}
    onpointerup={onTouchUp}
    onpointercancel={() => (pendingTap = null)}
    ondblclick={onDblClick}
  >
    {@render children()}
  </div>
</div>

<style>
  .table {
    position: absolute;
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 8px;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.06);
    overflow: hidden;
  }
  .table.focused {
    border-color: var(--accent);
    box-shadow: 0 0 0 2px var(--accent-soft);
  }
  .title {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 10px;
    font-weight: 600;
    cursor: grab;
    touch-action: none;
    user-select: none;
    -webkit-user-select: none;
    border-bottom: 1px solid var(--line);
  }
  .grip {
    color: var(--muted);
    font-size: 12px;
  }
  .kind {
    font-size: 11px;
    font-weight: 500;
    color: var(--muted);
    border: 1px solid var(--line);
    border-radius: 4px;
    padding: 0 5px;
  }
  /* Shared cell styles for both kinds of grid. */
  .body :global(table) {
    border-collapse: collapse;
    table-layout: fixed;
    user-select: none;
    -webkit-user-select: none;
    -webkit-touch-callout: none;
    font-variant-numeric: tabular-nums;
  }
  .body :global(th),
  .body :global(td) {
    border-right: 1px solid var(--line);
    border-bottom: 1px solid var(--line);
    padding: 0 8px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .body :global(th) {
    background: var(--head);
    font-weight: 600;
    color: var(--muted);
  }
  .body :global(td) {
    position: relative;
    cursor: cell;
    touch-action: pan-x pan-y;
  }
  .body :global(td.sel) {
    touch-action: none;
    background-image: linear-gradient(var(--accent-soft), var(--accent-soft));
  }
  .body :global(td.anchor) {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }
  .body :global(.right) {
    text-align: right;
  }
  .body :global(td.neg) {
    color: var(--neg);
  }
  .body :global(tfoot td) {
    background-color: var(--foot);
    font-weight: 600;
    cursor: default;
  }
  .body :global(tfoot tr.first td) {
    border-top: 2px solid var(--line-strong);
  }
</style>
