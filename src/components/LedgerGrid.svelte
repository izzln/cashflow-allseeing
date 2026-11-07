<script lang="ts">
  import { app, ROW_H } from '../lib/store.svelte';
  import { formatNumber } from '../lib/format';
  import { cellsInRanges, LEDGER_COLS, styleKey } from '../lib/grid';
  import type { LedgerTable } from '../lib/model';
  import { STYLE_BY_ID } from '../lib/styles';

  let { table }: { table: LedgerTable } = $props();

  const sel = $derived(app.selection?.tableId === table.id ? app.selection : null);
  const selected = $derived(new Set(sel ? cellsInRanges(sel.ranges).map((p) => `${p.r},${p.c}`) : []));
  const total = $derived(table.entries.reduce((s, e) => s + (e.amount ?? 0), 0));
  const count = $derived(table.entries.filter((e) => e.date && e.amount !== null).length);
  const nb = $derived(table.entries.length);

  function style(rowId: string, colKey: string): string {
    const s = STYLE_BY_ID[table.styles[styleKey(rowId, colKey)]];
    return s ? `background:${s.bg};color:${s.fg}` : '';
  }
  const anchor = (r: number, c: number) => !!sel && sel.anchor.r === r && sel.anchor.c === c;
</script>

<table>
  <colgroup>
    {#each LEDGER_COLS as col (col.key)}<col style="width:{col.width}px" />{/each}
  </colgroup>
  <thead>
    <tr style="height:{ROW_H}px">
      {#each LEDGER_COLS as col (col.key)}<th class:right={col.align === 'right'}>{col.label}</th>{/each}
    </tr>
  </thead>
  <tbody>
    {#each table.entries as e, r (e.id)}
      {@const cells = [e.date, e.amount === null ? '' : formatNumber(e.amount), e.category, e.note]}
      <tr style="height:{ROW_H}px">
        {#each LEDGER_COLS as col, c (col.key)}
          <td
            data-t={table.id}
            data-r={r}
            data-c={c}
            class:right={col.align === 'right'}
            class:neg={c === 1 && (e.amount ?? 0) < 0 && !table.styles[styleKey(e.id, col.key)]}
            class:missing={c === 0 && !e.date && e.amount !== null}
            class:sel={selected.has(`${r},${c}`)}
            class:anchor={anchor(r, c)}
            style={style(e.id, col.key)}
          >{cells[c]}</td>
        {/each}
      </tr>
    {/each}
  </tbody>
  <tfoot>
    <tr style="height:{ROW_H}px" class="first">
      {#each ['Total', formatNumber(total), `${count} entries`, ''] as text, c (c)}
        <td
          data-t={table.id}
          data-r={nb}
          data-c={c}
          class:right={c === 1}
          class:neg={c === 1 && total < 0}
          class:sel={selected.has(`${nb},${c}`)}
          class:anchor={anchor(nb, c)}
          style={style('__total', LEDGER_COLS[c].key)}
        >{text}</td>
      {/each}
    </tr>
  </tfoot>
</table>

<style>
  td.missing {
    background-color: #fff4e5;
  }
</style>
