<script lang="ts">
  import { untrack } from 'svelte';
  import { fadeOut } from '../lib/motion';
  import { app } from '../lib/store.svelte';
  import { formatNumber } from '../lib/format';
  import { amountColumn, buildEntries, columnOf, guessMap } from '../lib/import/mapping';
  import { cellDisplay } from '../lib/columns';
  import type { SheetData } from '../lib/import/xlsx';
  import type { ImportMap, DataTable } from '../lib/model';

  let { dataTable, fileName, sheets, onclose }: {
    dataTable: DataTable;
    fileName: string;
    sheets: SheetData[];
    onclose: () => void;
  } = $props();

  const columns = untrack(() => dataTable.columns.filter((c) => c.type !== 'files'));
  const mainCol = untrack(() => amountColumn(dataTable.columns));

  // Start from the dataTable's saved mapping when it still fits the file, else guess from the header.
  function initial(): ImportMap {
    const saved = dataTable.importMap;
    const sheet = sheets.find((s) => s.name === saved?.sheet) ?? sheets[0];
    const header = sheet.rows[0] ?? [];
    if (saved && Object.keys(saved.cols).length + (saved.split ? 1 : 0) > 0) {
      const names = [...Object.values(saved.cols), saved.split?.income ?? '', saved.split?.expense ?? ''].filter(Boolean);
      if (names.every((n) => columnOf(n, header, saved.hasHeader) >= 0)) return { ...saved, sheet: sheet.name };
    }
    return { ...guessMap(header, dataTable.columns), hasHeader: true, flip: false, sheet: sheet.name };
  }

  let map = $state<ImportMap>(untrack(initial));
  let mode = $state<'replace' | 'append'>('replace');

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
  const result = $derived(buildEntries(sheet.rows, map, dataTable.columns));
  const total = $derived(
    mainCol ? result.entries.reduce((s, e) => s + (typeof e.cells[mainCol.id] === 'number' ? (e.cells[mainCol.id] as number) : 0), 0) : 0,
  );
  const canImport = $derived(result.entries.length > 0);

  function setHeader(on: boolean) {
    map = on
      ? { ...map, ...guessMap(header, dataTable.columns), hasHeader: true }
      : { ...map, hasHeader: false, cols: {}, split: null };
  }

  function setSheet(name: string) {
    const s = sheets.find((x) => x.name === name) ?? sheets[0];
    map = { ...map, ...(map.hasHeader ? guessMap(s.rows[0] ?? [], dataTable.columns) : { cols: {}, split: null }), sheet: s.name };
  }

  function setCol(colId: string, value: string) {
    const cols = { ...map.cols };
    if (value) cols[colId] = value;
    else delete cols[colId];
    map = { ...map, cols };
  }

  function setSplit(on: boolean) {
    if (!mainCol) return;
    if (on) {
      const cols = { ...map.cols };
      delete cols[mainCol.id];
      map = { ...map, cols, split: { col: mainCol.id, income: '', expense: '' } };
    } else {
      map = { ...map, split: null };
    }
  }

  function confirmImport() {
    app.importEntries(dataTable.id, result.entries, mode, $state.snapshot(map) as ImportMap, fileName);
    onclose();
  }
</script>

<div class="overlay anim-scrim" role="dialog" aria-modal="true" aria-label="Import into table" out:fadeOut>
  <div class="dialog anim-dialog">
    <h2>Import into “{dataTable.name}”</h2>
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
      {#if mainCol}
        <label class="check">
          <input type="checkbox" checked={!!map.split} onchange={(e) => setSplit((e.target as HTMLInputElement).checked)} />
          “{mainCol.name}” comes from separate money-in and money-out columns
        </label>
      {/if}
      {#each columns as col (col.id)}
        {#if map.split && map.split.col === col.id}
          <label>{col.name}: money in
            <select value={map.split.income} onchange={(e) => (map = { ...map, split: { ...map.split!, income: (e.target as HTMLSelectElement).value } })}>
              <option value="">— none —</option>
              {#each options as o (o.value)}<option value={o.value}>{o.label}</option>{/each}
            </select>
          </label>
          <label>{col.name}: money out
            <select value={map.split.expense} onchange={(e) => (map = { ...map, split: { ...map.split!, expense: (e.target as HTMLSelectElement).value } })}>
              <option value="">— none —</option>
              {#each options as o (o.value)}<option value={o.value}>{o.label}</option>{/each}
            </select>
          </label>
        {:else}
          <label>{col.name}
            <select value={map.cols[col.id] ?? ''} onchange={(e) => setCol(col.id, (e.target as HTMLSelectElement).value)}>
              <option value="">— none —</option>
              {#each options as o (o.value)}<option value={o.value}>{o.label}</option>{/each}
            </select>
          </label>
        {/if}
      {/each}
      <label class="check">
        <input type="checkbox" bind:checked={map.flip} />
        Flip signs of numbers (if this file shows payments as positive numbers)
      </label>
    </div>

    <div class="summary">
      <b>{result.entries.length}</b> rows{#if mainCol}, {mainCol.name} total <b class:neg={total < 0}>{formatNumber(total)}</b>{/if}
      {#if result.skipped}· {result.skipped} row(s) skipped (no valid date or amount){/if}
      {#if result.missing.length}<div class="warn">Not found in this file: {result.missing.join(', ')}</div>{/if}
    </div>

    <div class="preview">
      <table>
        <thead><tr>{#each columns as col (col.id)}<th class:right={col.type === 'number'}>{col.name}</th>{/each}</tr></thead>
        <tbody>
          {#each result.entries.slice(0, 8) as e (e.id)}
            <tr>
              {#each columns as col (col.id)}
                {@const v = e.cells[col.id]}
                <td class:right={col.type === 'number'} class:neg={typeof v === 'number' && v < 0}>{col.type === 'checkbox' ? (v ? '✓' : '') : cellDisplay(col.type, v)}</td>
              {/each}
            </tr>
          {/each}
        </tbody>
      </table>
    </div>

    <div class="actions">
      <select bind:value={mode} aria-label="Import mode">
        <option value="replace">Replace all rows in the table</option>
        <option value="append">Add to the existing rows</option>
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
    z-index: var(--z-dialog);
    background: var(--scrim);
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding: calc(24px + env(safe-area-inset-top)) 16px 24px;
    overflow-y: auto;
  }
  .dialog {
    background: var(--panel);
    border-radius: var(--radius-12);
    width: min(var(--dialog-w), 100%);
    padding: 18px 20px;
    box-shadow: var(--shadow-dialog);
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
  /* Compact: full width with 16px gutters, one field column. */
  @media (max-width: 599px) {
    .overlay {
      padding: calc(16px + env(safe-area-inset-top)) 16px 16px;
    }
    .grid {
      grid-template-columns: 1fr;
    }
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
    border-radius: var(--radius-6);
    padding: 6px 8px;
    min-height: var(--field-h);
    background: var(--panel);
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
    border-radius: var(--radius-8);
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
    color: var(--on-accent);
  }
</style>
