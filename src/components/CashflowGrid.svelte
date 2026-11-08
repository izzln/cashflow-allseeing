<script lang="ts">
  import { app, COL_W, LABEL_W, ROW_H, rowKind } from '../lib/store.svelte';
  import { isErr, type CellValue } from '../lib/evaluate';
  import { formatNumber } from '../lib/format';
  import { cellsInRanges, FIXED_FOOTERS, fitColumns, styleKey, textWidth } from '../lib/grid';
  import type { CashflowTable } from '../lib/model';
  import { groupByYear, monthLabel } from '../lib/months';
  import { STYLE_BY_ID } from '../lib/styles';

  let { table }: { table: CashflowTable } = $props();

  const months = $derived(app.months);
  const ev = $derived(app.ev);
  const years = $derived(groupByYear(months));
  const sel = $derived(app.selection?.tableId === table.id ? app.selection : null);
  const selected = $derived(new Set(sel ? cellsInRanges(sel.ranges).map((p) => `${p.r},${p.c}`) : []));
  const nb = $derived(table.rows.length);

  // Fill Window: the label column wraps; month columns shrink only to their widest number.
  const fitting = $derived(app.maximizedId === table.id && app.fillWidth > 0);
  const widths = $derived.by(() => {
    app.version;
    if (!fitting) return [LABEL_W, ...months.map(() => COL_W)];
    const m = app.model(table);
    const monthMins = months.map((_, i) => {
      let w = 56;
      for (let r = 0; r < m.rows; r++) {
        const v = m.value({ r, c: i + 1 });
        if (typeof v === 'number') w = Math.max(w, textWidth(formatNumber(v)));
      }
      return w;
    });
    return fitColumns(
      [{ natural: LABEL_W, min: 120, wrap: true }, ...monthMins.map((min) => ({ natural: Math.max(COL_W, min), min, wrap: false }))],
      app.fillWidth - 2,
    );
  });

  function style(rowId: string, colKey: string): string {
    const k = styleKey(rowId, colKey);
    const s = STYLE_BY_ID[table.styles[k]];
    const a = colKey === 'label' ? table.aligns[k] : undefined;
    return `${s ? `background:${s.bg};color:${s.fg};` : ''}${a ? `text-align:${a};` : ''}`;
  }

  function styled(rowId: string, colKey: string): boolean {
    return !!table.styles[styleKey(rowId, colKey)];
  }

  const anchor = (r: number, c: number) => !!sel && sel.anchor.r === r && sel.anchor.c === c;
  const show = (v: CellValue) => (isErr(v) ? '#ERR' : formatNumber(v));
  const neg = (v: CellValue) => typeof v === 'number' && v < 0;
  const tip = (v: CellValue) => (isErr(v) ? v.err : undefined);
</script>

<table>
  <colgroup>
    <col style="width:{widths[0]}px" />
    {#each months as m, i (m)}<col style="width:{widths[i + 1]}px" />{/each}
  </colgroup>
  <thead>
    <tr style="height:{ROW_H}px">
      <th class="corner" rowspan="2"></th>
      {#each years as y (y.year)}<th class="year center" colspan={y.count}>{y.year}</th>{/each}
    </tr>
    <tr style="height:{ROW_H}px">
      {#each months as m (m)}<th class="center">{monthLabel(m)}</th>{/each}
    </tr>
  </thead>
  <tbody>
    {#each table.rows as row, r (row.id)}
      {@const kind = rowKind(row)}
      <tr style="height:{ROW_H}px">
        <td
          data-t={table.id}
          data-r={r}
          data-c="0"
          class="label header-col"
          class:wrap={fitting}
          class:sel={selected.has(`${r},0`)}
          class:anchor={anchor(r, 0)}
          style={style(row.id, 'label')}
          title={kind === 'source' ? 'From a table' : kind === 'formula' ? `Formula: ${row.formula}` : undefined}
        >{#if kind === 'source'}<span class="icon src">⇄</span>{:else if kind === 'formula'}<span class="icon fx">ƒ</span>{/if}{row.label}</td>
        {#each months as m, i (m)}
          {@const v = ev.row(table, row, m)}
          {@const linked = kind !== 'formula' && !!table.cellSources[`${row.id}|${m}`]}
          <td
            data-t={table.id}
            data-r={r}
            data-c={i + 1}
            class="right"
            class:neg={neg(v) && !styled(row.id, m)}
            class:src={linked || (kind === 'source' && row.values[m] === undefined)}
            class:linked
            class:ovr={!linked && kind === 'source' && row.values[m] !== undefined}
            class:fx={kind === 'formula'}
            class:err={isErr(v)}
            class:sel={selected.has(`${r},${i + 1}`)}
            class:anchor={anchor(r, i + 1)}
            style={style(row.id, m)}
            title={tip(v) ?? (linked ? 'Total of a table column' : !linked && kind === 'source' && row.values[m] !== undefined ? 'Typed over the table’s number' : undefined)}
          >{show(v)}</td>
        {/each}
      </tr>
    {/each}
  </tbody>
  <tfoot>
    {#each FIXED_FOOTERS as f, fi (f.id)}
      {@const r = nb + fi}
      <tr style="height:{ROW_H}px" class:first={fi === 0} class:balance={fi === 1}>
        <td data-t={table.id} data-r={r} data-c="0" class:sel={selected.has(`${r},0`)} class:anchor={anchor(r, 0)} style={style(f.id, 'label')}>{f.label}</td>
        {#each months as m, i (m)}
          {@const v = fi === 0 ? ev.cashFlow(table, m) : ev.balance(table, m)}
          <td
            data-t={table.id}
            data-r={r}
            data-c={i + 1}
            class="right"
            class:neg={neg(v) && !styled(f.id, m)}
            class:err={isErr(v)}
            class:sel={selected.has(`${r},${i + 1}`)}
            class:anchor={anchor(r, i + 1)}
            style={style(f.id, m)}
            title={tip(v)}
          >{show(v)}</td>
        {/each}
      </tr>
    {/each}
    {#each table.footers as f, fi (f.id)}
      {@const r = nb + FIXED_FOOTERS.length + fi}
      <tr style="height:{ROW_H}px" class="custom">
        <td data-t={table.id} data-r={r} data-c="0" class:sel={selected.has(`${r},0`)} class:anchor={anchor(r, 0)} style={style(f.id, 'label')} title={`Formula: ${f.formula}`}><span class="icon fx">ƒ</span>{f.label}</td>
        {#each months as m, i (m)}
          {@const v = ev.footer(table, f, m)}
          <td
            data-t={table.id}
            data-r={r}
            data-c={i + 1}
            class="right fx"
            class:neg={neg(v) && !styled(f.id, m)}
            class:err={isErr(v)}
            class:sel={selected.has(`${r},${i + 1}`)}
            class:anchor={anchor(r, i + 1)}
            style={style(f.id, m)}
            title={tip(v)}
          >{show(v)}</td>
        {/each}
      </tr>
    {/each}
  </tfoot>
</table>

<style>
  th.year {
    color: var(--text);
  }
  .icon {
    display: inline-block;
    width: 16px;
    margin-right: 2px;
    font-size: 12px;
  }
  .icon.src,
  td.src {
    color: var(--cf-source);
  }
  .icon.fx,
  td.fx {
    color: var(--cf-formula);
  }
  td.src.neg,
  td.fx.neg {
    color: var(--cf-neg-linked);
  }
  /* Data links use ⇄ (like source rows); a number typed over a source row shows ✎.
     Corner triangles are kept free for comments. */
  td.linked::before,
  td.ovr::before {
    position: absolute;
    left: 5px;
    font-size: 11px;
    line-height: 1;
    top: 50%;
    transform: translateY(-50%);
  }
  td.linked::before {
    content: '⇄';
    color: var(--cf-source);
  }
  td.ovr::before {
    content: '✎';
    color: var(--cf-override);
  }
  td.err {
    color: var(--neg);
    font-weight: 600;
  }
  tfoot tr.balance td {
    font-weight: 700;
  }
  tfoot tr.custom td {
    font-weight: 500;
    font-style: italic;
  }
</style>
