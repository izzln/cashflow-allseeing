<script lang="ts">
  import { tick } from 'svelte';
  import { app } from '../lib/store.svelte';
  import { bounds } from '../lib/grid';
  import type { Table } from '../lib/model';

  /**
   * Row and column tabs shown around the focused table, as in Numbers.
   * Click/tap a tab to select the whole row or column (Shift extends); drag tabs
   * to reorder; drop them on the canvas to make a new table (⌥ copies).
   *
   * They are drawn on an unscaled layer above the zoomed canvas, in screen pixels:
   * they follow the table at any zoom but keep a full-size, tappable thickness.
   */
  let { table, layer }: { table: Table; layer: HTMLElement } = $props();

  let rows = $state<{ i: number; top: number; height: number }[]>([]);
  let cols = $state<{ i: number; left: number; width: number }[]>([]);
  let box = $state({ left: 0, top: 0, width: 0, height: 0 });
  const coarse = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
  const ROW_TAB = coarse ? 30 : 20;
  const COL_TAB = coarse ? 23 : 15;

  const frameEl = () => document.querySelector<HTMLElement>(`[data-frame="${table.id}"]`);

  const canDragCols = $derived(table.kind === 'table' && !app.readonly);
  const bodyCount = $derived(table.kind === 'table' ? table.entries.length : table.rows.length);

  async function measure() {
    await tick();
    const frame = frameEl();
    if (!frame) return;
    const f = layer.getBoundingClientRect();
    const outer = frame.querySelector('.table')?.getBoundingClientRect();
    const tbl = frame.querySelector('table')?.getBoundingClientRect();
    if (!tbl || !outer) return;
    box = { left: tbl.left - f.left, top: tbl.top - f.top, width: tbl.width, height: tbl.height };
    frameTop = outer.top - f.top;
    frameLeft = outer.left - f.left;
    rows = [...frame.querySelectorAll<HTMLElement>('tbody td[data-c="0"]')].map((td) => {
      const r = td.getBoundingClientRect();
      return { i: Number(td.dataset.r), top: r.top - f.top, height: r.height };
    });
    const ref = frame.querySelector('tbody tr') ?? frame.querySelector('tfoot tr');
    cols = [...(ref?.querySelectorAll<HTMLElement>('td[data-c]') ?? [])].map((td) => {
      const r = td.getBoundingClientRect();
      return { i: Number(td.dataset.c), left: r.left - f.left, width: r.width };
    });
  }
  let frameTop = $state(0);
  let frameLeft = $state(0);

  $effect(() => {
    app.version;
    app.months;
    app.zoom;
    bodyCount;
    table.x;
    table.y;
    void measure();
  });
  // Text that fits the (possibly tiny, zoomed-out) tab.
  const fontFor = (len: number) => (len < 9 ? 0 : Math.min(10, len - 3));

  const sel = $derived(app.selection?.tableId === table.id ? app.selection : null);
  const selRows = $derived.by(() => {
    if (!sel) return new Set<number>();
    const out = new Set<number>();
    for (const g of sel.ranges) {
      const b = bounds(g);
      for (let r = b.r0; r <= b.r1; r++) out.add(r);
    }
    return out;
  });
  const selCols = $derived.by(() => {
    if (!sel) return new Set<number>();
    const out = new Set<number>();
    for (const g of sel.ranges) {
      const b = bounds(g);
      for (let c = b.c0; c <= b.c1; c++) out.add(c);
    }
    return out;
  });

  /** Lines that are fully selected (every cell across). */
  function wholeLines(axis: 'row' | 'col'): number[] {
    if (!sel) return [];
    const m = app.model(table);
    const out: number[] = [];
    for (const g of sel.ranges) {
      const b = bounds(g);
      if (axis === 'row' && b.c0 === 0 && b.c1 === m.cols - 1) for (let r = b.r0; r <= b.r1; r++) out.push(r);
      if (axis === 'col' && b.r0 === 0 && b.r1 === m.rows - 1) for (let c = b.c0; c <= b.c1; c++) out.push(c);
    }
    return out;
  }

  // ----- dragging -----
  let drag = $state<{
    axis: 'row' | 'col';
    lines: number[];
    x: number;
    y: number;
    moved: boolean;
    outside: boolean;
    to: number;
    marker: number;
    pointer: string;
  } | null>(null);

  /** Right-click on a tab: select that row/column (unless already selected) and show its menu. */
  function context(e: MouseEvent, axis: 'row' | 'col', i: number) {
    e.preventDefault();
    e.stopPropagation();
    drag = null;
    if (!wholeLines(axis).includes(i)) app.selectLines(table.id, axis, i);
    app.menu = { kind: 'context', target: axis === 'row' ? 'rows' : 'columns', tableId: table.id, x: e.clientX, y: e.clientY };
  }

  function down(e: PointerEvent, axis: 'row' | 'col', i: number) {
    if (e.button === 2) return; // right-click: the contextmenu event handles it
    e.preventDefault();
    e.stopPropagation();
    app.commitEdit();
    app.menu = null;
    let lines = wholeLines(axis);
    if (!lines.includes(i) || e.shiftKey) {
      app.selectLines(table.id, axis, i, i, e.shiftKey);
      lines = wholeLines(axis);
    }
    const draggable = !app.readonly && (axis === 'row' ? lines.every((r) => r < bodyCount) : canDragCols);
    if (!draggable) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag = { axis, lines, x: e.clientX, y: e.clientY, moved: false, outside: false, to: -1, marker: -1, pointer: e.pointerType };
  }

  function move(e: PointerEvent) {
    const frame = frameEl();
    if (!drag || !frame) return;
    if (!drag.moved && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 5) return;
    drag.moved = true;
    drag.x = e.clientX;
    drag.y = e.clientY;
    const t = frame.querySelector('table')?.getBoundingClientRect();
    const f = layer.getBoundingClientRect();
    if (!t) return;
    const margin = 28;
    drag.outside =
      e.clientX < t.left - margin - 24 || e.clientX > t.right + margin || e.clientY < t.top - margin - 32 || e.clientY > t.bottom + margin;
    if (drag.outside) return;
    if (drag.axis === 'row') {
      const body = rows.filter((r) => r.i < bodyCount);
      const y = e.clientY - f.top;
      let to = body.length;
      for (const r of body) if (y < r.top + r.height / 2) { to = r.i; break; }
      drag.to = to;
      drag.marker = to < body.length ? body[to].top : (body.at(-1)?.top ?? 0) + (body.at(-1)?.height ?? 0);
    } else {
      const x = e.clientX - f.left;
      let to = cols.length;
      for (const c of cols) if (x < c.left + c.width / 2) { to = c.i; break; }
      drag.to = to;
      drag.marker = to < cols.length ? cols[to].left : (cols.at(-1)?.left ?? 0) + (cols.at(-1)?.width ?? 0);
    }
  }

  function up(e: PointerEvent) {
    const d = drag;
    drag = null;
    if (!d) return;
    if (!d.moved) {
      if (d.pointer === 'touch') {
        const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
        app.menu = { kind: 'edit', target: d.axis === 'row' ? 'rows' : 'columns', tableId: table.id, x: r.left + r.width / 2, y: r.top };
      }
      return;
    }
    if (d.outside) {
      // Drop point in unzoomed canvas pixels.
      const content = app.contentEl?.getBoundingClientRect();
      const x = (e.clientX - (content?.left ?? 0)) / app.zoom - 20;
      const y = (e.clientY - (content?.top ?? 0)) / app.zoom - 20;
      if (d.axis === 'row') app.extractRows(table.id, d.lines, x, y, e.altKey);
      else app.extractColumns(table.id, d.lines, x, y, e.altKey);
    } else if (d.to >= 0) {
      if (d.axis === 'row') app.moveRows(table.id, d.lines, d.to);
      else app.moveColumns(table.id, d.lines, d.to);
    }
  }

  const label = (i: number) => String(i + 1);
  const colLabel = (i: number) => {
    let n = i + 1;
    let s = '';
    while (n > 0) {
      s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
      n = Math.floor((n - 1) / 26);
    }
    return s;
  };
</script>

{#each rows.filter((r) => r.i < bodyCount) as r (r.i)}
  <button
    class="tab row"
    class:on={selRows.has(r.i)}
    style="top:{r.top}px;height:{r.height}px;left:{frameLeft - ROW_TAB - 4}px;width:{ROW_TAB}px;font-size:{fontFor(r.height)}px"
    title={app.readonly ? 'Select row' : 'Select row · drag to move · drag onto the canvas for a new one (⌥ copies)'}
    aria-label={`Row ${label(r.i)}`}
    onpointerdown={(e) => down(e, 'row', r.i)}
    oncontextmenu={(e) => context(e, 'row', r.i)}
    onpointermove={move}
    onpointerup={up}
    onpointercancel={() => (drag = null)}
  >{label(r.i)}</button>
{/each}
{#each cols as c (c.i)}
  <button
    class="tab col"
    class:on={selCols.has(c.i) && wholeLines('col').includes(c.i)}
    style="left:{c.left}px;width:{c.width}px;top:{frameTop - COL_TAB - 3}px;height:{COL_TAB}px;font-size:{fontFor(c.width)}px"
    title={canDragCols ? 'Select column · drag to move · drag onto the canvas for a new table (⌥ copies)' : 'Select column'}
    aria-label={`Column ${colLabel(c.i)}`}
    onpointerdown={(e) => down(e, 'col', c.i)}
    oncontextmenu={(e) => context(e, 'col', c.i)}
    onpointermove={move}
    onpointerup={up}
    onpointercancel={() => (drag = null)}
  >{colLabel(c.i)}</button>
{/each}

{#if drag?.moved && !drag.outside && drag.to >= 0}
  {#if drag.axis === 'row'}
    <div class="marker h" style="top:{drag.marker - 1}px;left:{box.left}px;width:{box.width}px"></div>
  {:else}
    <div class="marker v" style="left:{drag.marker - 1}px;top:{box.top}px;height:{box.height}px"></div>
  {/if}
{/if}
{#if drag?.moved && drag.outside}
  <div class="ghost" style="left:{drag.x + 12}px;top:{drag.y + 12}px">
    New {table.kind === 'table' ? 'table' : 'cashflow'} with {drag.lines.length} {drag.axis === 'row' ? 'row' : 'column'}{drag.lines.length === 1 ? '' : 's'}
  </div>
{/if}

<style>
  .tab {
    position: absolute;
    z-index: 3;
    border: 1px solid var(--line);
    background: var(--head);
    color: var(--muted);
    padding: 0;
    overflow: hidden;
    min-height: 0;
    border-radius: 4px;
    touch-action: none;
    cursor: grab;
  }
  .tab.on {
    background: var(--accent);
    border-color: var(--accent);
    color: #fff;
  }
  .marker {
    position: absolute;
    z-index: 4;
    background: var(--accent);
    pointer-events: none;
  }
  .marker.h {
    height: 3px;
  }
  .marker.v {
    width: 3px;
  }
  .ghost {
    position: fixed;
    z-index: 3000;
    pointer-events: none;
    border: 2px dashed var(--accent);
    background: rgba(255, 255, 255, 0.9);
    border-radius: 8px;
    padding: 10px 14px;
    color: var(--accent);
    font-weight: 600;
    white-space: nowrap;
  }
</style>
