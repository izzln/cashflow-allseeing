<script lang="ts">
  import { app, COL_W, LABEL_W, ROW_H, rowKind } from '../lib/store.svelte';
  import { isErr, type CellValue } from '../lib/evaluate';
  import { formatNumber } from '../lib/format';
  import { cellsInRanges, FIXED_FOOTERS, styleKey } from '../lib/grid';
  import type { CashTable } from '../lib/model';
  import { groupByYear, monthLabel } from '../lib/months';
  import { STYLE_BY_ID } from '../lib/styles';

  let { table }: { table: CashTable } = $props();

  const months = $derived(app.months);
  const ev = $derived(app.ev);
  const years = $derived(groupByYear(months));
  const sel = $derived(app.selection?.tableId === table.id ? app.selection : null);
  const selected = $derived(new Set(sel ? cellsInRanges(sel.ranges).map((p) => `${p.r},${p.c}`) : []));
  const nb = $derived(table.rows.length);

  function style(rowId: string, colKey: string): string {
    const s = STYLE_BY_ID[table.styles[styleKey(rowId, colKey)]];
    return s ? `background:${s.bg};color:${s.fg}` : '';
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
    <col style="width:{LABEL_W}px" />
    {#each months as m (m)}<col style="width:{COL_W}px" />{/each}
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
          class:sel={selected.has(`${r},0`)}
          class:anchor={anchor(r, 0)}
          style={style(row.id, 'label')}
          title={kind === 'source' ? 'From a ledger' : kind === 'formula' ? `Formula: ${row.formula}` : undefined}
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
            title={tip(v) ?? (linked ? 'Total of a ledger column' : undefined)}
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
    color: #1d63c7;
  }
  .icon.fx,
  td.fx {
    color: #6941c6;
  }
  td.src.neg,
  td.fx.neg {
    color: #b8336a;
  }
  /* A manual number typed over a source: marked with a corner tick. */
  td.ovr::after {
    content: '';
    position: absolute;
    top: 0;
    right: 0;
    border-style: solid;
    border-width: 0 7px 7px 0;
    border-color: transparent #f59e0b transparent transparent;
  }
  /* A cell that shows one ledger column's total: marked with a blue corner tick. */
  td.linked::after {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    border-style: solid;
    border-width: 7px 7px 0 0;
    border-color: #1d63c7 transparent transparent transparent;
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
