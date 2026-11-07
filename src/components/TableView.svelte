<script lang="ts">
  import { app, COL_W, LABEL_W, ROW_H, TITLE_H } from '../lib/store.svelte';
  import { computeFooters } from '../lib/compute';
  import { formatNumber } from '../lib/format';
  import { cellsInRanges, FOOTERS, styleKey, type Pos } from '../lib/grid';
  import type { Table } from '../lib/model';
  import { groupByYear, monthLabel } from '../lib/months';
  import { STYLE_BY_ID } from '../lib/styles';

  let { table }: { table: Table } = $props();

  const months = $derived(app.months);
  const footers = $derived(computeFooters(table, months));
  const years = $derived(groupByYear(months));
  const sel = $derived(app.selection?.tableId === table.id ? app.selection : null);
  const selected = $derived(
    new Set(sel ? cellsInRanges(sel.ranges).map((p) => `${p.r},${p.c}`) : []),
  );
  const nBody = $derived(table.rows.length);

  function cellStyle(rowId: string, colKey: string): string {
    const s = STYLE_BY_ID[table.styles[styleKey(rowId, colKey)]];
    return s ? `background:${s.bg};color:${s.fg}` : '';
  }

  function hasStyle(rowId: string, colKey: string): boolean {
    return !!table.styles[styleKey(rowId, colKey)];
  }

  function isAnchor(r: number, c: number): boolean {
    return !!sel && sel.anchor.r === r && sel.anchor.c === c;
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
      const key = `${p.r},${p.c}`;
      if (!selected.has(key)) {
        pendingTap = p;
        return;
      }
      tapToEdit = isAnchor(p.r, p.c) && selected.size === 1;
      dragging = true;
    } else {
      e.preventDefault();
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

<div
  class="table"
  class:focused={app.focusTableId === table.id}
  style="left:{table.x}px;top:{table.y}px"
>
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
  </div>
  <table
    onpointerdown={onCellDown}
    onpointerup={onTouchUp}
    onpointercancel={() => (pendingTap = null)}
    ondblclick={onDblClick}
  >
    <colgroup>
      <col style="width:{LABEL_W}px" />
      {#each months as m (m)}<col style="width:{COL_W}px" />{/each}
    </colgroup>
    <thead>
      <tr style="height:{ROW_H}px">
        <th class="corner" rowspan="2"></th>
        {#each years as y (y.year)}<th class="year" colspan={y.count}>{y.year}</th>{/each}
      </tr>
      <tr style="height:{ROW_H}px">
        {#each months as m (m)}<th class="month">{monthLabel(m)}</th>{/each}
      </tr>
    </thead>
    <tbody>
      {#each table.rows as row, r (row.id)}
        <tr style="height:{ROW_H}px">
          <td
            data-t={table.id}
            data-r={r}
            data-c="0"
            class="label"
            class:sel={selected.has(`${r},0`)}
            class:anchor={isAnchor(r, 0)}
            style={cellStyle(row.id, 'label')}
          >{row.label}</td>
          {#each months as m, i (m)}
            {@const v = row.values[m]}
            <td
              data-t={table.id}
              data-r={r}
              data-c={i + 1}
              class="num"
              class:neg={v < 0 && !hasStyle(row.id, m)}
              class:sel={selected.has(`${r},${i + 1}`)}
              class:anchor={isAnchor(r, i + 1)}
              style={cellStyle(row.id, m)}
            >{formatNumber(v)}</td>
          {/each}
        </tr>
      {/each}
    </tbody>
    <tfoot>
      {#each FOOTERS as f, fi (f.id)}
        {@const r = nBody + fi}
        {@const series = fi === 0 ? footers.cashFlow : footers.balance}
        <tr style="height:{ROW_H}px" class:first={fi === 0} class:balance={fi === 1}>
          <td
            data-t={table.id}
            data-r={r}
            data-c="0"
            class="label"
            class:sel={selected.has(`${r},0`)}
            class:anchor={isAnchor(r, 0)}
            style={cellStyle(f.id, 'label')}
          >{f.label}</td>
          {#each months as m, i (m)}
            {@const v = series[i]}
            <td
              data-t={table.id}
              data-r={r}
              data-c={i + 1}
              class="num"
              class:neg={v !== null && v < 0 && !hasStyle(f.id, m)}
              class:sel={selected.has(`${r},${i + 1}`)}
              class:anchor={isAnchor(r, i + 1)}
              style={cellStyle(f.id, m)}
            >{formatNumber(v)}</td>
          {/each}
        </tr>
      {/each}
    </tfoot>
  </table>
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
  table {
    border-collapse: collapse;
    table-layout: fixed;
    user-select: none;
    -webkit-user-select: none;
    -webkit-touch-callout: none;
    font-variant-numeric: tabular-nums;
  }
  th,
  td {
    border-right: 1px solid var(--line);
    border-bottom: 1px solid var(--line);
    padding: 0 8px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  th {
    background: var(--head);
    font-weight: 600;
    color: var(--muted);
  }
  th.year {
    text-align: left;
    color: var(--text);
  }
  th.month {
    text-align: right;
  }
  td {
    position: relative;
    cursor: cell;
    touch-action: pan-x pan-y;
  }
  td.sel {
    touch-action: none;
    background-image: linear-gradient(var(--accent-soft), var(--accent-soft));
  }
  td.anchor {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }
  td.num {
    text-align: right;
  }
  td.label {
    font-weight: 500;
  }
  td.neg {
    color: var(--neg);
  }
  tfoot td {
    background-color: var(--foot);
    font-weight: 600;
    cursor: default;
  }
  tfoot tr.first td {
    border-top: 2px solid var(--line-strong);
  }
  tfoot tr.balance td {
    font-weight: 700;
  }
</style>
