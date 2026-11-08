<script lang="ts">
  import { tick, type Snippet } from 'svelte';
  import { app } from '../lib/store.svelte';
  import { cellsInRanges, type Pos } from '../lib/grid';
  import type { Table } from '../lib/model';
  import TableTabs from './TableTabs.svelte';

  let { table, children, maximized = false }: { table: Table; children: Snippet; maximized?: boolean } = $props();
  let frameEl = $state<HTMLElement | null>(null);
  let bodyWidth = $state(0);
  let bodyEl = $state<HTMLElement | null>(null);
  let pinsEl = $state<HTMLElement | null>(null);
  $effect(() => {
    if (maximized) app.fillWidth = bodyWidth;
  });

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
  let pressTimer: ReturnType<typeof setTimeout> | null = null;
  let pressed = false;

  /** Viewport point at the top centre of a cell: where the touch edit menu appears. */
  function cellPoint(p: Pos): { x: number; y: number } {
    const el = document.querySelector<HTMLElement>(`[data-t="${table.id}"][data-r="${p.r}"][data-c="${p.c}"]`);
    const r = el?.getBoundingClientRect();
    return r ? { x: r.left + r.width / 2, y: r.top } : { x: 100, y: 100 };
  }

  function openMenu(kind: 'context' | 'edit', target: 'cells' | 'table' | 'column' | 'rows' | 'columns', x: number, y: number) {
    app.menu = { kind, target, tableId: table.id, x, y };
  }

  /** Long-press on touch = right-click: select (if needed) and open the context menu. */
  function startPress(e: PointerEvent, p: Pos) {
    cancelPress();
    pressed = false;
    const { clientX, clientY } = e;
    pressTimer = setTimeout(() => {
      pressed = true;
      pendingTap = null;
      tapToEdit = false;
      if (!selected.has(`${p.r},${p.c}`)) app.select(table.id, p);
      openMenu('context', 'cells', clientX, clientY);
    }, 550);
  }

  function cancelPress() {
    if (pressTimer) clearTimeout(pressTimer);
    pressTimer = null;
  }

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
      startPress(e, p);
      if (!selected.has(`${p.r},${p.c}`)) {
        pendingTap = p;
        return;
      }
      tapToEdit = isAnchor(p) && selected.size === 1;
      dragging = true;
    } else {
      if (e.button === 2) return; // right-click: handled by the contextmenu event
      // preventDefault stops text selection but also keeps focus where it was;
      // release a panel field so typing reaches the grid.
      e.preventDefault();
      const active = document.activeElement as HTMLElement | null;
      if (active && active !== app.editorEl && /^(INPUT|SELECT|TEXTAREA|BUTTON)$/.test(active.tagName)) active.blur();
      const mode = e.shiftKey ? 'extend' : e.metaKey || e.ctrlKey ? 'add' : 'new';
      app.select(table.id, p, mode);
      // Clicking the box in a checkbox cell ticks it straight away, like Numbers.
      if (mode === 'new' && (e.target as Element).closest('[data-check]')) {
        app.toggleCheckboxes([p]);
        return;
      }
      dragging = true;
    }
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp, { once: true });
  }

  function onMove(e: PointerEvent) {
    if (!dragging) return;
    cancelPress();
    const p = posOf(document.elementFromPoint(e.clientX, e.clientY));
    if (!p) return;
    const last = sel?.ranges[sel.ranges.length - 1];
    if (last && (last.b.r !== p.r || last.b.c !== p.c)) {
      moved = true;
      app.select(table.id, p, 'extend');
    }
  }

  function onUp(e: PointerEvent) {
    window.removeEventListener('pointermove', onMove);
    cancelPress();
    dragging = false;
    if (pressed) {
      pressed = false;
      return;
    }
    if (tapToEdit && !moved) {
      app.menu = null;
      app.startEdit();
    } else if (e.pointerType === 'touch' && sel) {
      // A drag from a selected cell extended the selection: show the edit menu for it.
      const pt = cellPoint(sel.anchor);
      openMenu('edit', 'cells', pt.x, pt.y);
    }
    tapToEdit = false;
  }

  function onTouchUp(e: PointerEvent) {
    if (e.pointerType !== 'touch' || !pendingTap) return;
    cancelPress();
    if (pressed) {
      pressed = false;
      pendingTap = null;
      return;
    }
    const p = posOf(e.target as Element);
    if (p && p.r === pendingTap.r && p.c === pendingTap.c) {
      app.select(table.id, p);
      if ((e.target as Element).closest('[data-check]')) app.toggleCheckboxes([p]);
      // A tap selects and shows the edit menu (Numbers on iPad).
      const pt = cellPoint(p);
      openMenu('edit', 'cells', pt.x, pt.y);
    }
    pendingTap = null;
  }

  function onContextMenu(e: MouseEvent) {
    e.preventDefault();
    const p = posOf(e.target as Element);
    if (!p) return;
    if (app.editing) app.commitEdit();
    if (!selected.has(`${p.r},${p.c}`)) app.select(table.id, p);
    const lines = app.selection?.lines;
    openMenu('context', lines === 'row' ? 'rows' : lines === 'col' ? 'columns' : 'cells', e.clientX, e.clientY);
  }

  function onDblClick(e: MouseEvent) {
    const p = posOf(e.target as Element);
    if (!p || (e.target as Element).closest('[data-check]')) return;
    app.select(table.id, p);
    app.startEdit();
  }

  // ----- moving the table by its title bar -----
  let moveStart: { x: number; y: number; tx: number; ty: number; checkpointed: boolean } | null = null;

  let titlePointer = 'mouse';

  function onTitleDown(e: PointerEvent) {
    if ((e.target as HTMLElement).closest('button, input')) return;
    e.preventDefault();
    app.commitEdit();
    app.menu = null;
    titlePointer = e.pointerType;
    if (e.button === 2) return;
    moveStart = { x: e.clientX, y: e.clientY, tx: table.x, ty: table.y, checkpointed: false };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  /** Selecting the table itself (not cells): Delete, Copy and Cut then act on the whole table. */
  function selectTable() {
    app.selection = null;
    app.focusTableId = table.id;
  }

  function onTitleMove(e: PointerEvent) {
    if (!moveStart || app.readonly || app.maximizedId) return;
    const dx = e.clientX - moveStart.x;
    const dy = e.clientY - moveStart.y;
    if (!moveStart.checkpointed) {
      if (Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
      app.checkpoint();
      app.bringToFront(table.id);
      moveStart.checkpointed = true;
    }
    // Pointer moves are in screen pixels; table positions are in unzoomed canvas pixels.
    app.moveTable(table.id, moveStart.tx + dx / app.zoom, moveStart.ty + dy / app.zoom);
  }

  function onTitleUp(e: PointerEvent) {
    const wasMove = !!moveStart?.checkpointed;
    if (wasMove) app.save();
    if (moveStart && !wasMove && e.type === 'pointerup') {
      selectTable();
      if (titlePointer === 'touch') {
        const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
        openMenu('edit', 'table', r.left + Math.min(r.width, 300) / 2, r.top);
      }
    }
    moveStart = null;
  }

  // ----- renaming the table in place -----
  let draft = $state('');
  let renameEl = $state<HTMLInputElement | null>(null);
  $effect(() => {
    if (app.renamingTableId === table.id) {
      draft = table.name;
      tick().then(() => {
        renameEl?.focus();
        renameEl?.select();
      });
    }
  });
  function finishRename(save: boolean) {
    if (save) app.renameTable(table.id, draft);
    app.renamingTableId = null;
  }
</script>

<div class="frame" data-frame={table.id} class:max={maximized} bind:this={frameEl} style={maximized ? '' : `left:${table.x}px;top:${table.y}px`}>
<div class="table" class:focused={app.focusTableId === table.id && !maximized}>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="title"
    style="height:var(--title-h)"
    onpointerdown={onTitleDown}
    onpointermove={onTitleMove}
    onpointerup={onTitleUp}
    onpointercancel={onTitleUp}
    ondblclick={() => !app.readonly && (app.renamingTableId = table.id)}
    oncontextmenu={(e) => {
      e.preventDefault();
      selectTable();
      openMenu('context', 'table', e.clientX, e.clientY);
    }}
  >
    <span class="grip">⠿</span>
    {#if app.renamingTableId === table.id}
      <input
        class="rename"
        bind:this={renameEl}
        bind:value={draft}
        aria-label="Table name"
        onblur={() => finishRename(true)}
        onkeydown={(e) => {
          if (e.isComposing || e.keyCode === 229) return;
          if (e.key === 'Enter') finishRename(true);
          if (e.key === 'Escape') finishRename(false);
        }}
      />
    {:else}
      <span class="name" title={app.readonly ? table.name : 'Double-click to rename'}>{table.name}</span>
    {/if}
    {#if table.kind === 'cashflow'}<span class="kind">Cashflow</span>{/if}
    <span class="grow"></span>
    <button
      class="max-btn"
      onclick={() => app.toggleMaximize(table.id)}
      title={maximized ? 'Restore (esc)' : 'Fill the window with this table'}
      aria-label={maximized ? 'Restore table size' : 'Fill window with table'}
    >{maximized ? '⤡ Restore' : '⤢'}</button>
  </div>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="body"
    bind:this={bodyEl}
    bind:clientWidth={bodyWidth}
    style="--row-h:28px"
    class:has-sel={!!sel}
    onpointerdown={onCellDown}
    onpointerup={onTouchUp}
    onpointercancel={() => {
      pendingTap = null;
      cancelPress();
    }}
    ondblclick={onDblClick}
    oncontextmenu={onContextMenu}
  >
    {@render children()}
  </div>
  {#if maximized}
    <!-- Fill Window: row and column tabs in a fixed gutter, following the body's scroll. -->
    <div class="pins" bind:this={pinsEl}>
      {#if pinsEl && bodyEl}<TableTabs {table} layer={pinsEl} pinned scroller={bodyEl} />{/if}
    </div>
  {/if}
</div>
</div>

<style>
  .frame {
    position: absolute;
  }
  .frame.max {
    position: absolute;
    inset: 0;
  }
  .frame.max .table {
    height: 100%;
    display: flex;
    flex-direction: column;
    border-radius: 0;
    border: none;
  }
  .frame.max .body {
    flex: 1;
    min-height: 0;
    /* Room for the pinned row and column tabs. */
    margin: calc(var(--col-tab) + 6px) 0 0 calc(var(--row-tab) + 6px);
    border-top: 1px solid var(--line);
    border-left: 1px solid var(--line);
    overflow: auto;
    -webkit-overflow-scrolling: touch;
  }
  /* Filled view: header rows and the header column stay put while scrolling. */
  .frame.max .body :global(thead th) {
    position: sticky;
    top: 0;
    z-index: 2;
  }
  .frame.max .body :global(thead tr:nth-child(2) th) {
    top: var(--row-h);
  }
  /* Fill Window: columns are fitted to the width; text, files and labels wrap. */
  .frame.max .body :global(td.wrap),
  .frame.max .body :global(th.wrap) {
    white-space: normal;
    overflow-wrap: anywhere;
    text-overflow: clip;
    padding-top: 4px;
    padding-bottom: 4px;
  }
  .frame.max .body :global(td.header-col),
  .frame.max .body :global(tfoot td:first-child) {
    position: sticky;
    left: 0;
    z-index: 1;
  }
  .frame.max .body :global(th.corner),
  .frame.max .body :global(thead th:first-child) {
    left: 0;
    z-index: 3;
  }
  .frame {
    --row-tab: 20px;
    --col-tab: 15px;
  }
  @media (pointer: coarse) {
    .frame {
      --row-tab: 30px;
      --col-tab: 23px;
    }
  }
  .pins {
    position: absolute;
    inset: 0;
    pointer-events: none;
    overflow: hidden;
  }
  .pins :global(*) {
    pointer-events: auto;
  }
  .grow {
    flex: 1;
  }
  .max-btn {
    border: none;
    background: none;
    color: var(--muted);
    min-height: 26px;
    padding: 0 6px;
  }
  @media (pointer: coarse) {
    .max-btn {
      min-height: var(--touch-target);
      min-width: var(--touch-target);
    }
  }
  .table {
    position: relative;
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: var(--radius-8);
    box-shadow: var(--shadow-rest);
    overflow: hidden;
  }
  .table.focused {
    border-color: var(--accent);
    box-shadow: var(--focus-halo);
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
  .rename {
    min-height: 0;
    font: inherit;
    font-weight: 600;
    border: 1px solid var(--accent);
    border-radius: var(--radius-4);
    padding: 1px 6px;
    min-width: 200px;
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
    border-radius: var(--radius-4);
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
  .body :global(.center) {
    text-align: center;
  }
  /* The first column is a header column, as in Numbers. */
  .body :global(td.header-col) {
    background-color: var(--head-col);
    font-weight: 600;
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