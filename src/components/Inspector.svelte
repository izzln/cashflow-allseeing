<script lang="ts">
  import { app, rowKind, type RowKind } from '../lib/store.svelte';
  import { isErr } from '../lib/evaluate';
  import { formatNumber, parseNumber } from '../lib/format';
  import { readSpreadsheet, type SheetData } from '../lib/import/xlsx';
  import type { LedgerTable } from '../lib/model';
  import { addMonths, currentMonth, monthLabel, monthRange, parseMonth } from '../lib/months';
  import ImportDialog from './ImportDialog.svelte';

  const t = $derived(app.table(app.focusTableId));
  const rowSel = $derived(app.selectedRow());
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
    if (t && confirm(`Delete table "${t.name}"?`)) app.deleteTable(t.id);
  }

  /** Categories in a ledger, most used first. */
  function categories(ledger: LedgerTable | undefined): { name: string; count: number }[] {
    const counts = new Map<string, number>();
    for (const e of ledger?.entries ?? []) {
      const c = e.category.trim();
      if (c) counts.set(c, (counts.get(c) ?? 0) + 1);
    }
    return [...counts].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  }

  function toggleCategory(name: string, on: boolean) {
    const r = rowSel;
    if (!r?.row.source) return;
    const now = r.row.source.categories.filter((c) => c.trim().toLowerCase() !== name.toLowerCase());
    app.setRowSource(r.table.id, r.row.id, { categories: on ? [...now, name] : now });
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

  // ----- import -----
  let fileEl = $state<HTMLInputElement | null>(null);
  let importing = $state<{ ledger: LedgerTable; fileName: string; sheets: SheetData[] } | null>(null);

  async function pickFile(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file || t?.kind !== 'ledger') return;
    try {
      const sheets = (await readSpreadsheet(file.name, new Uint8Array(await file.arrayBuffer()))).filter((s) => s.rows.length);
      if (!sheets.length) throw new Error('The file has no data.');
      importing = { ledger: t, fileName: file.name, sheets };
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    }
  }

  const KINDS: { kind: RowKind; label: string }[] = [
    { kind: 'manual', label: 'Manual' },
    { kind: 'source', label: 'From ledger' },
    { kind: 'formula', label: 'Formula' },
  ];
</script>

<aside class="inspector">
  {#if !t}
    <h3>File</h3>
    <label>
      Sync every (minutes)
      <input type="number" min="1" max="1440" value={app.wb.settings.syncMinutes} disabled={ro}
        onchange={(e) => app.setSyncMinutes(Number(value(e)) || 15)} />
    </label>
    <p class="hint">
      {#if ro}Snapshots don't sync.{:else if app.syncLeader}This window runs the sync{app.lastSyncAt ? ` (last check ${fmtTime.format(app.lastSyncAt)})` : ''}.{:else}Another window with this file open runs the sync.{/if}
      Feishu and Huoban sources will sync on this timer once the server is set up. Ledgers from CSV/Excel update when you import the file again.
    </p>
    <p class="hint">Select a table to edit it.</p>
  {:else if t.kind === 'cashflow'}
    <h3>Table</h3>
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
        <button class="danger" onclick={remove}>Delete table</button>
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
        {@const ledgers = app.ledgers()}
        {@const ledger = ledgers.find((l) => l.ledger.id === src.ledgerId)?.ledger}
        {#if ledgers.length === 0}
          <p class="warn">There is no ledger in this file yet. Add one with “+ Ledger”.</p>
        {:else}
          <label>Ledger
            <select value={src.ledgerId} disabled={ro} onchange={(e) => app.setRowSource(t.id, row.id, { ledgerId: value(e), categories: [] })}>
              {#if !ledger}<option value="">— choose —</option>{/if}
              {#each ledgers as l (l.ledger.id)}<option value={l.ledger.id}>{l.sheet} › {l.ledger.name}</option>{/each}
            </select>
          </label>
          {#if ledger}
            {@const cats = categories(ledger)}
            <div class="field">
              <span>Categories {src.categories.length ? `(${src.categories.length} chosen)` : '(all)'}</span>
              {#if cats.length === 0}
                <p class="hint">This ledger has no categories yet, so every entry counts.</p>
              {:else}
                <div class="cats">
                  {#each cats as c (c.name)}
                    <label class="check">
                      <input type="checkbox" disabled={ro}
                        checked={src.categories.some((x) => x.trim().toLowerCase() === c.name.toLowerCase())}
                        onchange={(e) => toggleCategory(c.name, (e.target as HTMLInputElement).checked)} />
                      {c.name} <span class="count">{c.count}</span>
                    </label>
                  {/each}
                </div>
              {/if}
            </div>
            <label>Note contains
              {#key row.id}<input value={src.noteContains} disabled={ro} placeholder="optional" onchange={(e) => app.setRowSource(t.id, row.id, { noteContains: value(e).trim() })} />{/key}
            </label>
            <label class="check">
              <input type="checkbox" checked={src.flip} disabled={ro} onchange={(e) => app.setRowSource(t.id, row.id, { flip: (e.target as HTMLInputElement).checked })} />
              Flip sign
            </label>
          {/if}
        {/if}
        <p class="hint">Each month shows the ledger's total for that month (blue). Type in a cell to override it (orange corner); clear the cell to go back to the ledger.</p>
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
    {@const cats = categories(t)}
    <h3>Ledger</h3>
    <label>Name {#key t.id}<input value={t.name} disabled={ro} onchange={(e) => app.renameTable(t.id, value(e))} />{/key}</label>
    <p class="hint">{t.entries.length} entries. Cash-flow rows can take their numbers from this ledger: choose “From ledger” on a row.</p>
    {#if !ro}
      <div class="buttons">
        <button class="primary" onclick={() => fileEl?.click()}>Import CSV / Excel…</button>
        <input bind:this={fileEl} type="file" hidden accept=".csv,.tsv,.txt,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onchange={pickFile} />
        <button onclick={() => app.sortLedger(t.id)}>Sort by date</button>
        <button onclick={() => app.addRow(t.id)}>+ Entry</button>
      </div>
      {#if t.importedFrom}
        <p class="hint">Last imported from <b>{t.importedFrom}</b>. To refresh, import the new export; the column mapping is remembered.</p>
      {/if}
    {/if}
    {#if cats.length}
      <div class="field">
        <span>Categories</span>
        <ul class="catlist">{#each cats as c (c.name)}<li>{c.name} <span class="count">{c.count}</span></li>{/each}</ul>
      </div>
    {/if}
    {#if !ro}<button class="danger" onclick={remove}>Delete ledger</button>{/if}
  {/if}

  <h3>Tips</h3>
  <ul class="hint">
    <li>Drag a table by its title bar. It snaps to the grid.</li>
    <li>Outflows are negative numbers. Net cash flow = sum of rows; Balance carries forward.</li>
    <li>Type or press Enter to edit. Tab / Enter move on. Delete clears.</li>
    <li>Drag to select; Shift extends; ⌘ adds more cells. Sum and average show bottom right.</li>
    <li>iPad: tap a cell to select, tap again to edit, drag from a selected cell to extend.</li>
    <li>Copy/paste works with Excel and Numbers. Pasting past the last row adds rows.</li>
    <li>The same file can be open in several windows; edits in one show up in the others.</li>
    <li>Snapshots freeze the file (automatically at month-end). Open one next to the live file to compare.</li>
  </ul>
</aside>

{#if importing}
  <ImportDialog ledger={importing.ledger} fileName={importing.fileName} sheets={importing.sheets} onclose={() => (importing = null)} />
{/if}

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
    width: 290px;
    flex-shrink: 0;
    overflow-y: auto;
    background: var(--panel);
    border-left: 1px solid var(--line);
    padding: 12px 14px 80px;
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
  label,
  .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-bottom: 10px;
    color: var(--muted);
  }
  label.check {
    flex-direction: row;
    align-items: center;
    gap: 6px;
    color: var(--text);
    margin-bottom: 4px;
  }
  input:not([type='checkbox']),
  select {
    color: var(--text);
    border: 1px solid var(--line);
    border-radius: 6px;
    padding: 6px 8px;
    background: #fff;
    min-height: 32px;
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
    color: #fff;
  }
  .cats {
    max-height: 180px;
    overflow-y: auto;
    border: 1px solid var(--line);
    border-radius: 6px;
    padding: 6px 8px;
  }
  .count {
    color: var(--muted);
    font-size: 11px;
  }
  .catlist {
    margin: 0;
    padding-left: 16px;
    color: var(--text);
    line-height: 1.6;
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
    border-radius: 4px;
  }
</style>
