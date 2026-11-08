<script lang="ts">
  import { tick } from 'svelte';
  import { app, ROW_H } from '../lib/store.svelte';
  import { formatNumber } from '../lib/format';
  import { cellsInRanges, columnWidth, ledgerModel, styleKey } from '../lib/grid';
  import { cellDisplay } from '../lib/ledger';
  import type { Attachment, LedgerTable } from '../lib/model';
  import { STYLE_BY_ID } from '../lib/styles';

  let { table }: { table: LedgerTable } = $props();

  const sel = $derived(app.selection?.tableId === table.id ? app.selection : null);
  const selected = $derived(new Set(sel ? cellsInRanges(sel.ranges).map((p) => `${p.r},${p.c}`) : []));
  const nb = $derived(table.entries.length);
  const totals = $derived.by(() => {
    app.version;
    const m = ledgerModel(table);
    return table.columns.map((_, c) => m.value({ r: nb, c }));
  });

  function style(rowId: string, colKey: string): string {
    const s = STYLE_BY_ID[table.styles[styleKey(rowId, colKey)]];
    return s ? `background:${s.bg};color:${s.fg}` : '';
  }
  const anchor = (r: number, c: number) => !!sel && sel.anchor.r === r && sel.anchor.c === c;

  // ----- renaming a column in place (double-click its header) -----
  let renaming = $state<string | null>(null);
  let draft = $state('');
  let inputEl = $state<HTMLInputElement | null>(null);

  // Renaming is started from the header (double-click), the menus or the panel, via app.renamingColumn.
  $effect(() => {
    const r = app.renamingColumn;
    if (r && r.tableId === table.id && !app.readonly) {
      renaming = r.colId;
      draft = table.columns.find((c) => c.id === r.colId)?.name ?? '';
      tick().then(() => {
        inputEl?.focus();
        inputEl?.select();
      });
    }
  });

  function renameColumn(colId: string) {
    if (!app.readonly) app.renamingColumn = { tableId: table.id, colId };
  }

  function finish(save: boolean) {
    if (save && renaming) app.renameColumn(table.id, renaming, draft);
    renaming = null;
    app.renamingColumn = null;
  }

  /** Select a whole column (header click); a right-click also opens the column menu. */
  function selectColumn(c: number) {
    app.selection = { tableId: table.id, ranges: [{ a: { r: 0, c }, b: { r: nb, c } }], anchor: { r: 0, c } };
    app.focusTableId = table.id;
  }

  const files = (v: unknown) => (Array.isArray(v) ? (v as Attachment[]) : []);
  let dropKey = $state<string | null>(null);
</script>

<table>
  <colgroup>
    {#each table.columns as col (col.id)}<col style="width:{columnWidth(col)}px" />{/each}
  </colgroup>
  <thead>
    <tr style="height:{ROW_H}px">
      {#each table.columns as col, c (col.id)}
        <th
          data-t={table.id}
          data-h={c}
          class:right={col.type === 'number'}
          class:center={col.type === 'checkbox'}
          title={app.readonly ? col.name : `${col.name} — double-click to rename`}
          ondblclick={() => renameColumn(col.id)}
          oncontextmenu={(e) => {
            e.preventDefault();
            selectColumn(c);
            app.menu = { kind: 'context', target: 'column', tableId: table.id, x: e.clientX, y: e.clientY };
          }}
        >
          {#if renaming === col.id}
            <input
              class="rename"
              bind:this={inputEl}
              bind:value={draft}
              onblur={() => finish(true)}
              onpointerdown={(e) => e.stopPropagation()}
              onkeydown={(e) => {
                if (e.isComposing || e.keyCode === 229) return;
                if (e.key === 'Enter') finish(true);
                if (e.key === 'Escape') finish(false);
              }}
            />
          {:else}{col.name}{/if}
        </th>
      {/each}
    </tr>
  </thead>
  <tbody>
    {#each table.entries as e, r (e.id)}
      <tr style="height:{ROW_H}px">
        {#each table.columns as col, c (col.id)}
          {@const v = e.cells[col.id]}
          <td
            data-t={table.id}
            data-r={r}
            data-c={c}
            class:right={col.type === 'number'}
            class:center={col.type === 'checkbox'}
            class:header-col={c === 0}
            class:neg={col.type === 'number' && typeof v === 'number' && v < 0 && !table.styles[styleKey(e.id, col.id)]}
            class:sel={selected.has(`${r},${c}`)}
            class:anchor={anchor(r, c)}
            data-files={col.type === 'files' ? '' : undefined}
            class:drop={dropKey === `${e.id}|${col.id}`}
            style={style(e.id, col.id)}
            ondragover={(ev) => {
              if (col.type !== 'files' || app.readonly || !ev.dataTransfer?.types.includes('Files')) return;
              ev.preventDefault();
              dropKey = `${e.id}|${col.id}`;
            }}
            ondragleave={() => (dropKey = null)}
            ondrop={(ev) => {
              if (col.type !== 'files' || app.readonly) return;
              ev.preventDefault();
              dropKey = null;
              const list = ev.dataTransfer?.files ? [...ev.dataTransfer.files] : [];
              app.select(table.id, { r, c });
              app.attachFiles(table.id, e.id, col.id, list);
            }}
          >
            {#if col.type === 'checkbox'}
              <span class="check" class:on={v === true} data-check role="checkbox" aria-checked={v === true} aria-label={col.name}>{v === true ? '✓' : ''}</span>
            {:else if col.type === 'files'}
              {#each files(v) as f (f.id)}<span class="chip" title={f.name}>📎 {f.name}</span>{/each}
            {:else}{cellDisplay(col.type, v)}{/if}
          </td>
        {/each}
      </tr>
    {/each}
  </tbody>
  <tfoot>
    <tr style="height:{ROW_H}px" class="first">
      {#each table.columns as col, c (col.id)}
        {@const v = totals[c]}
        <td
          data-t={table.id}
          data-r={nb}
          data-c={c}
          class:right={col.type === 'number'}
          class:center={col.type === 'checkbox'}
          class:neg={typeof v === 'number' && v < 0}
          class:sel={selected.has(`${nb},${c}`)}
          class:anchor={anchor(nb, c)}
          style={style('__total', col.id)}
        >{typeof v === 'number' ? formatNumber(v) : (v ?? '')}</td>
      {/each}
    </tr>
  </tfoot>
</table>

<style>
  .rename {
    width: 100%;
    font: inherit;
    font-weight: 600;
    border: 1px solid var(--accent);
    border-radius: 4px;
    padding: 1px 4px;
  }
  .check {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    border: 1.5px solid var(--line-strong);
    border-radius: 4px;
    background: #fff;
    color: #fff;
    font-size: 13px;
    font-weight: 700;
    cursor: pointer;
    vertical-align: middle;
  }
  .check.on {
    background: var(--accent);
    border-color: var(--accent);
  }
  td.drop {
    outline: 2px dashed var(--accent);
    outline-offset: -3px;
  }
  .chip {
    display: inline-block;
    max-width: 150px;
    overflow: hidden;
    text-overflow: ellipsis;
    vertical-align: middle;
    background: var(--head);
    border-radius: 10px;
    padding: 0 7px;
    margin-right: 4px;
    font-size: 12px;
    line-height: 20px;
  }
</style>
