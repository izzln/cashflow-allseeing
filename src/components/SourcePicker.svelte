<script lang="ts">
  import { app } from '../lib/store.svelte';
  import { distinctValues } from '../lib/columns';
  import type { Filter, DataTable } from '../lib/model';

  /**
   * Choose a dataTable, its columns and filters. `mode: 'row'` needs a date column
   * (monthly sums); `mode: 'cell'` totals one number column over all dates.
   */
  let {
    mode,
    tableId,
    dateCol = '',
    numberCol,
    filters,
    flip,
    disabled = false,
    onchange,
  }: {
    mode: 'row' | 'cell';
    tableId: string;
    dateCol?: string;
    numberCol: string;
    filters: Filter[];
    flip: boolean;
    disabled?: boolean;
    onchange: (patch: { tableId?: string; dateCol?: string; numberCol?: string; filters?: Filter[]; flip?: boolean }) => void;
  } = $props();

  const dataTables = $derived(app.dataTables());
  const dataTable = $derived(dataTables.find((l) => l.dataTable.id === tableId)?.dataTable as DataTable | undefined);
  const dateCols = $derived(dataTable?.columns.filter((c) => c.type === 'date') ?? []);
  const numberCols = $derived(dataTable?.columns.filter((c) => c.type === 'number') ?? []);
  const filterCols = $derived(dataTable?.columns.filter((c) => c.type === 'text' || c.type === 'checkbox') ?? []);
  const value = (e: Event) => (e.target as HTMLInputElement | HTMLSelectElement).value;

  function setFilter(i: number, patch: Partial<Filter>) {
    onchange({ filters: filters.map((f, j) => (j === i ? { ...f, ...patch } : f)) });
  }

  function addFilter() {
    const col = filterCols.find((c) => !filters.some((f) => f.col === c.id)) ?? filterCols[0];
    if (!col) return;
    onchange({ filters: [...filters, { col: col.id, op: col.type === 'checkbox' ? 'checked' : 'in', values: [], text: '' }] });
  }

  function changeColumn(i: number, colId: string) {
    const col = filterCols.find((c) => c.id === colId);
    setFilter(i, { col: colId, op: col?.type === 'checkbox' ? 'checked' : 'in', values: [], text: '' });
  }

  function toggleValue(i: number, name: string, on: boolean) {
    const f = filters[i];
    const rest = f.values.filter((v) => v.trim().toLowerCase() !== name.toLowerCase());
    setFilter(i, { values: on ? [...rest, name] : rest });
  }
</script>

{#if dataTables.length === 0}
  <p class="warn">There is no table in this file yet. Add one with the Table button in the toolbar.</p>
{:else}
  <label>Table
    <select value={tableId} {disabled} onchange={(e) => onchange({ tableId: value(e) })}>
      {#if !dataTable}<option value="">— choose —</option>{/if}
      {#each dataTables as l (l.dataTable.id)}<option value={l.dataTable.id}>{l.sheet} › {l.dataTable.name}</option>{/each}
    </select>
  </label>
  {#if dataTable}
    {#if mode === 'row'}
      <label>Date column
        <select value={dateCol} {disabled} onchange={(e) => onchange({ dateCol: value(e) })}>
          {#if !dateCols.some((c) => c.id === dateCol)}<option value="">— choose —</option>{/if}
          {#each dateCols as c (c.id)}<option value={c.id}>{c.name}</option>{/each}
        </select>
      </label>
    {/if}
    <label>{mode === 'row' ? 'Amount column' : 'Total of column'}
      <select value={numberCol} {disabled} onchange={(e) => onchange({ numberCol: value(e) })}>
        {#if !numberCols.some((c) => c.id === numberCol)}<option value="">— choose —</option>{/if}
        {#each numberCols as c (c.id)}<option value={c.id}>{c.name}</option>{/each}
      </select>
    </label>

    <div class="field">
      <span>Only entries where</span>
      {#each filters as f, i (i)}
        {@const col = filterCols.find((c) => c.id === f.col)}
        <div class="filter">
          <div class="line">
            <select value={f.col} {disabled} onchange={(e) => changeColumn(i, value(e))} aria-label="Filter column">
              {#if !col}<option value={f.col}>(deleted column)</option>{/if}
              {#each filterCols as c (c.id)}<option value={c.id}>{c.name}</option>{/each}
            </select>
            {#if col?.type === 'checkbox'}
              <select value={f.op} {disabled} onchange={(e) => setFilter(i, { op: value(e) as Filter['op'] })} aria-label="Condition">
                <option value="checked">is ticked</option>
                <option value="unchecked">is not ticked</option>
              </select>
            {:else}
              <select value={f.op} {disabled} onchange={(e) => setFilter(i, { op: value(e) as Filter['op'] })} aria-label="Condition">
                <option value="in">is any of</option>
                <option value="contains">contains</option>
              </select>
            {/if}
            {#if !disabled}<button class="x" title="Remove filter" aria-label="Remove filter" onclick={() => onchange({ filters: filters.filter((_, j) => j !== i) })}>×</button>{/if}
          </div>
          {#if col && col.type !== 'checkbox' && f.op === 'in'}
            {@const vals = distinctValues(dataTable, col.id)}
            {#if vals.length === 0}
              <p class="hint">No values in this column yet.</p>
            {:else}
              <div class="cats">
                {#each vals as v (v.name)}
                  <label class="check">
                    <input type="checkbox" {disabled}
                      checked={f.values.some((x) => x.trim().toLowerCase() === v.name.toLowerCase())}
                      onchange={(e) => toggleValue(i, v.name, (e.target as HTMLInputElement).checked)} />
                    {v.name} <span class="count">{v.count}</span>
                  </label>
                {/each}
              </div>
            {/if}
          {:else if col && f.op === 'contains'}
            <input value={f.text} {disabled} placeholder="text" onchange={(e) => setFilter(i, { text: value(e) })} />
          {/if}
        </div>
      {:else}
        <p class="hint">No filters: every entry counts.</p>
      {/each}
      {#if !disabled && filterCols.length}<button onclick={addFilter}>+ Filter</button>{/if}
    </div>
    <label class="check">
      <input type="checkbox" checked={flip} {disabled} onchange={(e) => onchange({ flip: (e.target as HTMLInputElement).checked })} />
      Flip sign
    </label>
  {/if}
{/if}

<style>
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
    border-radius: var(--radius-6);
    padding: 6px 8px;
    background: var(--panel);
    min-height: var(--field-h);
    min-width: 0;
  }
  .filter {
    border: 1px solid var(--line);
    border-radius: var(--radius-8);
    padding: 6px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .line {
    display: flex;
    gap: 4px;
  }
  .line select {
    flex: 1;
  }
  .x {
    padding: 0 8px;
  }
  .cats {
    max-height: 160px;
    overflow-y: auto;
    padding: 2px 4px;
  }
  .count {
    color: var(--muted);
    font-size: 12px;
  }
  .hint {
    color: var(--muted);
    margin: 2px 0;
    line-height: 1.4;
  }
  .warn {
    color: var(--neg);
  }
</style>
