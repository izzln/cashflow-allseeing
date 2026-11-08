<script lang="ts">
  import { app, rowKind, type RowKind } from '../lib/store.svelte';
  import { isErr } from '../lib/evaluate';
  import { formatNumber, parseNumber } from '../lib/format';
  import type { DataTable } from '../lib/model';
  import { addMonths, currentMonth, monthLabel, monthRange, parseMonth } from '../lib/months';
  import { pickImportFile } from '../lib/commands';
  import SourcePicker from './SourcePicker.svelte';
  import { COLUMN_TYPE_LABELS } from '../lib/columns';
  import type { ColumnType } from '../lib/model';

  const t = $derived(app.table(app.focusTableId));
  const cellSel = $derived(app.selectedCell());
  const rowSel = $derived(app.selection && app.selection.anchor.c === 0 ? app.selectedRow() : null);
  const colSel = $derived.by(() => {
    const sel = app.selection;
    if (!sel || t?.kind !== 'table') return null;
    const c = sel.anchor.c;
    return t.columns[c] ? { index: c, col: t.columns[c] } : null;
  });
  const footSel = $derived(app.selectedFooter());
  const ro = $derived(app.readonly);
  const monthOptions = $derived(monthRange(addMonths(currentMonth(), -24), app.months[app.months.length - 1]));
  const fmtTime = new Intl.DateTimeFormat(undefined, { timeStyle: 'short' });

  const label = (k: string) => `${monthLabel(k)} ${parseMonth(k).year}`;
  const value = (e: Event) => (e.target as HTMLInputElement).value;

  function setOpening(e: Event) {
    const el = e.target as HTMLInputElement;
    if (t?.kind !== 'cashflow') return;
    const n = parseNumber(el.value);
    if (n === undefined) {
      app.flashNotice(`Not a number: "${el.value}"`);
      el.value = formatNumber(t.openingBalance);
      return;
    }
    app.updateCashTable(t.id, { openingBalance: n ?? 0 });
    el.value = formatNumber(n ?? 0);
  }

  function remove() {
    if (t) app.deleteTable(t.id); // undoable; the notice offers Undo
  }

  /** First error a formula gives in the visible months, if any. */
  function formulaError(get: (m: string) => unknown, formula: string): string | null {
    const syntax = app.ev.check(formula);
    if (syntax) return syntax;
    for (const m of app.months) {
      const v = get(m);
      if (isErr(v as never)) return (v as { err: string }).err;
    }
    return null;
  }

  const KINDS: { kind: RowKind; label: string }[] = [
    { kind: 'manual', label: 'Manual' },
    { kind: 'source', label: 'From table' },
    { kind: 'formula', label: 'Formula' },
  ];
</script>

<!-- Docked when wide; an overlay from the trailing edge when regular; a bottom sheet when compact. -->
<aside class="inspector" class:overlay={app.sizeClass === 'regular'} class:sheet={app.sizeClass === 'compact'}>
  {#if !t}
    <h3>File</h3>
    <label>
      Sync every (minutes)
      <input type="number" min="1" max="1440" value={app.wb.settings.syncMinutes} disabled={ro}
        onchange={(e) => app.setSyncMinutes(Number(value(e)) || 15)} />
    </label>
    <p class="hint">
      {#if ro}Snapshots don't sync.{:else if app.syncLeader}This window runs the sync{app.lastSyncAt ? ` (last check ${fmtTime.format(app.lastSyncAt)})` : ''}.{:else}Another window with this file open runs the sync.{/if}
      Feishu and Huoban sources will sync on this timer once the server is set up. Tables filled from CSV/Excel update when you import the file again.
    </p>
    <p class="hint">Select a table to edit it.</p>
  {:else if t.kind === 'cashflow'}
    <h3>Cashflow</h3>
    <label>Name {#key t.id}<input value={t.name} disabled={ro} onchange={(e) => app.renameTable(t.id, value(e))} />{/key}</label>
    <label>Opening balance
      {#key `${t.id}:${t.openingBalance}`}<input value={formatNumber(t.openingBalance)} onchange={setOpening} inputmode="decimal" disabled={ro} />{/key}
    </label>
    <label>As of the start of
      <select value={t.openingMonth} disabled={ro} onchange={(e) => app.updateCashTable(t.id, { openingMonth: value(e) })}>
        {#each monthOptions as m (m)}<option value={m}>{label(m)}</option>{/each}
      </select>
    </label>
    {#if t.openingMonth < app.months[0]}
      <p class="hint">Months before {label(app.months[0])} are hidden, but they still count toward the balance.</p>
    {/if}
    {#if !ro}
      <div class="buttons">
        <button onclick={() => app.addRow(t.id)}>+ Row</button>
        <button onclick={() => app.addFooter(t.id)}>+ Footer formula</button>
        <button class="danger" onclick={remove}>Delete cashflow</button>
      </div>
    {/if}

    {#if rowSel}
      {@const row = rowSel.row}
      {@const kind = rowKind(row)}
      <h3>Row: {row.label || 'untitled'}</h3>
      <div class="segmented" role="radiogroup" aria-label="Row type">
        {#each KINDS as k (k.kind)}
          <button role="radio" aria-checked={kind === k.kind} class:on={kind === k.kind} disabled={ro}
            onclick={() => app.setRowKind(t.id, row.id, k.kind)}>{k.label}</button>
        {/each}
      </div>
      {#if kind === 'manual'}
        <p class="hint">Type amounts into the row. Inflows positive, outflows negative.</p>
      {:else if kind === 'source' && row.source}
        {@const src = row.source}
        <SourcePicker mode="row" tableId={src.tableId} dateCol={src.dateCol} numberCol={src.amountCol} filters={src.filters} flip={src.flip} disabled={ro}
          onchange={(p) => app.setRowSource(t.id, row.id, { ...(p.tableId !== undefined && { tableId: p.tableId }), ...(p.dateCol !== undefined && { dateCol: p.dateCol }), ...(p.numberCol !== undefined && { amountCol: p.numberCol }), ...(p.filters && { filters: p.filters }), ...(p.flip !== undefined && { flip: p.flip }) })} />
        <p class="hint">Each month shows the total of the amount column for rows dated in that month (blue). Type in a cell to override it (orange corner); clear the cell to go back to the dataTable.</p>
        {#if Object.keys(row.values).length && !ro}
          <button onclick={() => app.clearOverrides(t.id, row.id)}>Remove {Object.keys(row.values).length} override(s)</button>
        {/if}
      {:else if kind === 'formula'}
        {@const err = formulaError((m) => app.ev.row(t, row, m), row.formula ?? '')}
        <label>Formula
          {#key row.id}<input class="mono" value={row.formula} disabled={ro} placeholder="[Sales] * -6%" autocapitalize="off" spellcheck="false"
            onchange={(e) => app.setRowFormula(t.id, row.id, value(e))} />{/key}
        </label>
        {#if row.formula && err}<p class="warn">{err}</p>{/if}
        <p class="hint">This row counts toward net cash flow, so it can't use Net cash flow or Balance. For those, use a footer formula.</p>
        {@render formulaHelp()}
      {/if}
    {/if}

    {#if cellSel && rowKind(cellSel.row) !== 'formula'}
      {@const cs = cellSel.table.cellSources[cellSel.key]}
      {@const fromRow = rowKind(cellSel.row) === 'source'}
      {@const mode = cs ? 'total' : fromRow && cellSel.row.values[cellSel.month] === undefined ? 'row' : 'manual'}
      <h3>Cell: {cellSel.row.label || 'untitled'} · {label(cellSel.month)}</h3>
      <div class="segmented" role="radiogroup" aria-label="Cell value">
        {#if fromRow}
          <button role="radio" aria-checked={mode === 'row'} class:on={mode === 'row'} disabled={ro} onclick={() => app.setCellMode(t.id, cellSel.key, 'row')}>From row</button>
        {/if}
        <button role="radio" aria-checked={mode === 'manual'} class:on={mode === 'manual'} disabled={ro} onclick={() => app.setCellMode(t.id, cellSel.key, 'manual')}>Manual</button>
        <button role="radio" aria-checked={mode === 'total'} class:on={mode === 'total'} disabled={ro} onclick={() => app.setCellMode(t.id, cellSel.key, 'total')}>Table total</button>
      </div>
      {#if cs}
        <SourcePicker mode="cell" tableId={cs.tableId} numberCol={cs.col} filters={cs.filters} flip={cs.flip} disabled={ro}
          onchange={(p) => app.updateCellSource(t.id, cellSel.key, { ...(p.tableId !== undefined && { tableId: p.tableId }), ...(p.numberCol !== undefined && { col: p.numberCol }), ...(p.filters && { filters: p.filters }), ...(p.flip !== undefined && { flip: p.flip }) })} />
        <p class="hint">The total of one table column over all matching rows, whatever their dates (marked ⇄). Typing a number in the cell switches it to Manual.</p>
      {:else if mode === 'row'}
        <p class="hint">This month follows the row's table source. Choose Manual (or just type) to put your own number here.</p>
      {:else}
        <p class="hint">{fromRow ? 'A number typed over the row’s table source (marked ✎). Choose From row to go back.' : 'Type a number in the cell.'} To fill a whole row month by month from a table, select the row's first cell.</p>
      {/if}
    {/if}

    {#if footSel}
      {@const f = footSel.footer}
      {@const err = formulaError((m) => app.ev.footer(t, f, m), f.formula)}
      <h3>Footer row</h3>
      <label>Label {#key f.id}<input value={f.label} disabled={ro} onchange={(e) => app.updateFooter(t.id, f.id, { label: value(e).trim() })} />{/key}</label>
      <label>Formula
        {#key f.id}<input class="mono" value={f.formula} disabled={ro} autocapitalize="off" spellcheck="false"
          onchange={(e) => app.updateFooter(t.id, f.id, { formula: value(e) })} />{/key}
      </label>
      {#if err}<p class="warn">{err}</p>{/if}
      <p class="hint">Footer rows don't count toward net cash flow. They can use [Net cash flow] and [Balance].</p>
      {@render formulaHelp()}
      {#if !ro}<button class="danger" onclick={() => app.deleteFooter(t.id, f.id)}>Delete footer row</button>{/if}
    {/if}
  {:else}
    <h3>Table</h3>
    <label>Name {#key t.id}<input value={t.name} disabled={ro} onchange={(e) => app.renameTable(t.id, value(e))} />{/key}</label>
    <p class="hint">{t.entries.length} rows. Cashflow rows can take their numbers from this table: select a cashflow row's first cell and choose “From table”.</p>
    {#if !ro}
      <div class="buttons">
        <button class="primary" onclick={() => pickImportFile(t.id)}>Import CSV / Excel…</button>
        <button onclick={() => app.addRow(t.id)}>+ Row</button>
      </div>
      {#if t.importedFrom}
        <p class="hint">Last imported from <b>{t.importedFrom}</b>. To refresh, import the new export; the column mapping is remembered.</p>
      {/if}
    {/if}
    {#if colSel}
      {@const col = colSel.col}
      <h3>Column: {col.name}</h3>
      <label>Name {#key col.id}<input value={col.name} disabled={ro} onchange={(e) => app.renameColumn(t.id, col.id, value(e))} />{/key}</label>
      <label>Cell format
        <select value={col.type} disabled={ro} onchange={(e) => app.setColumnType(t.id, col.id, value(e) as ColumnType)}>
          {#each Object.entries(COLUMN_TYPE_LABELS) as [k, v] (k)}<option value={k}>{v}</option>{/each}
        </select>
      </label>
      {#if !ro}
        <div class="buttons">
          <button onclick={() => app.insertColumn(t.id, colSel.index)} title="⌥←">+ Column before</button>
          <button onclick={() => app.insertColumn(t.id, colSel.index + 1)} title="⌥→">+ Column after</button>
          <button onclick={() => app.sortTable(t.id, col.id)}>Sort A→Z</button>
          <button onclick={() => app.sortTable(t.id, col.id, true)}>Sort Z→A</button>
          <button class="danger" onclick={() => app.deleteSelectedColumns()}>Delete column</button>
        </div>
      {/if}
    {/if}
    {#if !ro}<button class="danger" onclick={remove}>Delete table</button>{/if}
  {/if}

  {#if t && app.canAlign()}
    {@const cur = app.currentAlign()}
    <h3>Text</h3>
    <div class="segmented" role="radiogroup" aria-label="Text alignment">
      {#each [['left', 'Left'], ['center', 'Center'], ['right', 'Right']] as [a, name] (a)}
        <button role="radio" aria-checked={cur === a} class:on={cur === a} onclick={() => app.applyAlign(a as 'left' | 'center' | 'right')}>{name}</button>
      {/each}
    </div>
  {/if}

  <h3>Tips</h3>
  <ul class="hint">
    <li>Drag a table by its title bar. It snaps to the grid.</li>
    <li>Outflows are negative numbers. Net cash flow = sum of rows; Balance carries forward.</li>
    <li>Type or press Enter to edit. Tab / Enter move on. Delete clears.</li>
    <li>Drag to select; Shift extends; ⌘ adds more cells. Sum and average show bottom right.</li>
    <li>iPad: tap a cell to select, tap it again for the edit menu, double-tap to edit, drag from a selected cell to extend.</li>
    <li>Copy/paste works with Excel and Numbers. Pasting past the last row adds rows.</li>
    <li>The same file can be open in several windows; edits in one show up in the others.</li>
    <li>Snapshots freeze the file (automatically at month-end). Open one next to the live file to compare.</li>
  </ul>
</aside>



{#snippet formulaHelp()}
  <details class="help">
    <summary>Formula help</summary>
    <ul>
      <li><code>[Sales] * 6%</code> a row in this table, by label</li>
      <li><code>[Main account].[Balance]</code> a row in another table</li>
      <li><code>PREV([Sales]) * 50%</code> last month's value (<code>PREV(x, 2)</code>: two months back)</li>
      <li><code>SUM([Rent], [Utilities])</code>, <code>MIN</code>, <code>MAX</code>, <code>ABS</code>, <code>ROUND(x, 0)</code>, <code>IF([x] &gt; 0, a, b)</code></li>
      <li>Chinese input is fine: <code>【销售】×（1－10％）</code></li>
    </ul>
  </details>
{/snippet}

<style>
  .inspector {
    width: var(--inspector-w);
    flex-shrink: 0;
    overflow-y: auto;
    background: var(--panel);
    border-left: 1px solid var(--line);
    padding: 12px 14px 80px;
    padding-right: max(14px, env(safe-area-inset-right));
  }
  .inspector.overlay {
    position: absolute;
    top: 0;
    right: 0;
    bottom: 0;
    max-width: 100%;
    /* Above content and the status bubble, below the top bar and its popovers. */
    z-index: calc(var(--z-topbar) - 200);
    box-shadow: var(--shadow-menu);
    padding-bottom: calc(24px + env(safe-area-inset-bottom));
    animation: cf-slide-in-end var(--motion-panel) var(--ease-enter);
  }
  .inspector.sheet {
    position: fixed;
    left: 8px;
    right: 8px;
    bottom: calc(8px + env(safe-area-inset-bottom) + var(--kb-inset));
    width: auto;
    max-height: 60vh;
    max-height: 60dvh;
    /* Above content and the status bubble, below the top bar and its popovers. */
    z-index: calc(var(--z-topbar) - 200);
    border: 1px solid var(--line);
    border-radius: var(--radius-12);
    box-shadow: var(--shadow-menu);
    padding-bottom: 24px;
    animation: cf-slide-up var(--motion-panel) var(--ease-enter);
  }
  /* Very short screens: the sheet takes the full height. */
  @media (max-height: 499px) {
    .inspector.sheet {
      top: calc(8px + env(safe-area-inset-top));
      max-height: none;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .inspector.overlay,
    .inspector.sheet {
      animation-name: cf-fade-in;
    }
  }
  h3 {
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--muted);
    margin: 18px 0 10px;
    overflow-wrap: anywhere;
  }
  h3:first-child {
    margin-top: 8px;
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-bottom: 10px;
    color: var(--muted);
  }
  input:not([type='checkbox']),
  select {
    color: var(--text);
    border: 1px solid var(--line);
    border-radius: var(--radius-6);
    padding: 6px 8px;
    background: var(--panel);
    min-height: var(--field-h);
  }
  .mono {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 12px;
  }
  .buttons {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin: 6px 0 4px;
  }
  .segmented {
    display: flex;
    margin-bottom: 10px;
  }
  .segmented button {
    flex: 1;
    border-radius: 0;
    margin-left: -1px;
  }
  .segmented button:first-child {
    border-radius: 6px 0 0 6px;
    margin-left: 0;
  }
  .segmented button:last-child {
    border-radius: 0 6px 6px 0;
  }
  .segmented button.on {
    background: var(--accent-soft);
    border-color: var(--accent);
    color: var(--accent);
    position: relative;
  }
  .primary {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--on-accent);
  }
  .hint {
    color: var(--muted);
    line-height: 1.5;
  }
  .warn {
    color: var(--neg);
    line-height: 1.4;
  }
  ul.hint {
    padding-left: 16px;
    margin: 0;
  }
  .help {
    color: var(--muted);
    margin: 6px 0 12px;
  }
  .help ul {
    padding-left: 16px;
    line-height: 1.6;
  }
  code {
    font-size: 11px;
    background: var(--head);
    padding: 1px 4px;
    border-radius: var(--radius-4);
  }
</style>
