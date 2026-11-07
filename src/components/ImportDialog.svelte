<script lang="ts">
  import { untrack } from 'svelte';
  import { app } from '../lib/store.svelte';
  import { formatNumber } from '../lib/format';
  import { buildEntries, columnOf, FIELD_LABELS, guessMap, type Field } from '../lib/import/mapping';
  import type { SheetData } from '../lib/import/xlsx';
  import type { ImportMap, LedgerTable } from '../lib/model';

  let { ledger, fileName, sheets, onclose }: {
    ledger: LedgerTable;
    fileName: string;
    sheets: SheetData[];
    onclose: () => void;
  } = $props();

  // Start from the ledger's saved mapping when it still fits the file, else guess from the header.
  function initial(): ImportMap {
    const saved = ledger.importMap;
    const sheet = sheets.find((s) => s.name === saved?.sheet) ?? sheets[0];
    const header = sheet.rows[0] ?? [];
    if (saved) {
      const fits = (['date', 'amount', 'income', 'expense'] as Field[]).every(
        (f) => !saved[f] || columnOf(saved[f], header, saved.hasHeader) >= 0,
      );
      if (fits && saved.date) return { ...saved, sheet: sheet.name };
    }
    return { ...guessMap(header), hasHeader: true, flip: false, sheet: sheet.name };
  }

  let map = $state<ImportMap>(untrack(initial));
  let mode = $state<'replace' | 'append'>('replace');
  let split = $state(untrack(() => !!(map.income || map.expense) && !map.amount));

  const sheet = $derived(sheets.find((s) => s.name === map.sheet) ?? sheets[0]);
  const header = $derived(sheet.rows[0] ?? []);
  const width = $derived(Math.max(0, ...sheet.rows.slice(0, 50).map((r) => r.length)));
  const options = $derived(
    Array.from({ length: width }, (_, i) =>
      map.hasHeader
        ? { value: header[i] ?? '', label: header[i] || `Column ${i + 1}` }
        : { value: String(i), label: `Column ${i + 1}: ${sheet.rows[0]?.[i] ?? ''}` },
    ).filter((o) => o.value !== ''),
  );
  const effective = $derived<ImportMap>(split ? { ...map, amount: '' } : { ...map, income: '', expense: '' });
  const result = $derived(buildEntries(sheet.rows, effective));
  const total = $derived(result.entries.reduce((s, e) => s + (e.amount ?? 0), 0));
  const fields = $derived<Field[]>(split ? ['date', 'income', 'expense', 'category', 'note'] : ['date', 'amount', 'category', 'note']);
  const canImport = $derived(!!map.date && (split ? !!(map.income || map.expense) : !!map.amount) && result.entries.length > 0);

  function setHeader(on: boolean) {
    if (on) map = { ...map, ...guessMap(header), hasHeader: true };
    else map = { ...map, hasHeader: false, date: '', amount: '', income: '', expense: '', category: '', note: '' };
  }

  function setSheet(name: string) {
    const s = sheets.find((x) => x.name === name) ?? sheets[0];
    map = { ...map, ...(map.hasHeader ? guessMap(s.rows[0] ?? []) : {}), sheet: s.name };
  }

  function confirmImport() {
    app.importEntries(ledger.id, result.entries, mode, $state.snapshot(effective), fileName);
    onclose();
  }
</script>

<div class="overlay" role="dialog" aria-modal="true" aria-label="Import into ledger">
  <div class="dialog">
    <h2>Import into “{ledger.name}”</h2>
    <p class="file">{fileName}</p>

    <div class="grid">
      {#if sheets.length > 1}
        <label>Sheet
          <select value={map.sheet} onchange={(e) => setSheet((e.target as HTMLSelectElement).value)}>
            {#each sheets as s (s.name)}<option value={s.name}>{s.name}</option>{/each}
          </select>
        </label>
      {/if}
      <label class="check">
        <input type="checkbox" checked={map.hasHeader} onchange={(e) => setHeader((e.target as HTMLInputElement).checked)} />
        First row has column names
      </label>
      <label class="check">
        <input type="checkbox" bind:checked={split} />
        Money in and money out are separate columns
      </label>
      {#each fields as f (f)}
        <label>{FIELD_LABELS[f]}
          <select bind:value={map[f]}>
            <option value="">— none —</option>
            {#each options as o (o.value)}<option value={o.value}>{o.label}</option>{/each}
          </select>
        </label>
      {/each}
      <label class="check">
        <input type="checkbox" bind:checked={map.flip} />
        Flip signs (if this file shows payments as positive numbers)
      </label>
    </div>

    <div class="summary">
      <b>{result.entries.length}</b> entries, total <b class:neg={total < 0}>{formatNumber(total)}</b>
      {#if result.skipped}· {result.skipped} row(s) skipped (no valid date or amount){/if}
      {#if result.missing.length}<div class="warn">Not found in this file: {result.missing.join(', ')}</div>{/if}
    </div>

    <div class="preview">
      <table>
        <thead><tr><th>Date</th><th class="right">Amount</th><th>Category</th><th>Note</th></tr></thead>
        <tbody>
          {#each result.entries.slice(0, 8) as e (e.id)}
            <tr><td>{e.date}</td><td class="right" class:neg={(e.amount ?? 0) < 0}>{formatNumber(e.amount)}</td><td>{e.category}</td><td>{e.note}</td></tr>
          {/each}
        </tbody>
      </table>
    </div>

    <div class="actions">
      <select bind:value={mode} aria-label="Import mode">
        <option value="replace">Replace all entries in the ledger</option>
        <option value="append">Add to the existing entries</option>
      </select>
      <span class="spacer"></span>
      <button onclick={onclose}>Cancel</button>
      <button class="primary" disabled={!canImport} onclick={confirmImport}>Import</button>
    </div>
  </div>
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    z-index: 3000;
    background: rgba(15, 23, 42, 0.35);
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding: calc(24px + env(safe-area-inset-top)) 16px 24px;
    overflow-y: auto;
  }
  .dialog {
    background: var(--panel);
    border-radius: 12px;
    width: min(720px, 100%);
    padding: 18px 20px;
    box-shadow: 0 20px 50px rgba(0, 0, 0, 0.25);
  }
  h2 {
    font-size: 17px;
    margin: 0;
  }
  .file {
    color: var(--muted);
    margin: 4px 0 14px;
    overflow-wrap: anywhere;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
    gap: 10px 14px;
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 4px;
    color: var(--muted);
  }
  label.check {
    flex-direction: row;
    align-items: center;
    gap: 6px;
    grid-column: 1 / -1;
    color: var(--text);
  }
  select {
    border: 1px solid var(--line);
    border-radius: 6px;
    padding: 6px 8px;
    min-height: 32px;
    background: #fff;
    color: var(--text);
  }
  .summary {
    margin: 14px 0 8px;
  }
  .warn {
    color: var(--neg);
    margin-top: 4px;
  }
  .neg {
    color: var(--neg);
  }
  .preview {
    max-height: 260px;
    overflow: auto;
    border: 1px solid var(--line);
    border-radius: 8px;
  }
  .preview table {
    border-collapse: collapse;
    width: 100%;
    font-variant-numeric: tabular-nums;
  }
  .preview th,
  .preview td {
    border-bottom: 1px solid var(--line);
    padding: 5px 8px;
    text-align: left;
    white-space: nowrap;
  }
  .preview th {
    background: var(--head);
    color: var(--muted);
    position: sticky;
    top: 0;
  }
  .right {
    text-align: right !important;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
    margin-top: 14px;
  }
  .spacer {
    flex: 1;
  }
  .primary {
    background: var(--accent);
    border-color: var(--accent);
    color: #fff;
  }
</style>
