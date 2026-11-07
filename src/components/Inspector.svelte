<script lang="ts">
  import { app } from '../lib/store.svelte';
  import { formatNumber, parseNumber } from '../lib/format';
  import { addMonths, currentMonth, monthLabel, monthRange, parseMonth } from '../lib/months';

  const t = $derived(app.table(app.focusTableId));
  const monthOptions = $derived(
    monthRange(addMonths(currentMonth(), -24), app.months[app.months.length - 1]),
  );

  function setName(e: Event) {
    const v = (e.target as HTMLInputElement).value.trim();
    if (t && v) app.updateTable(t.id, { name: v });
  }

  function setOpening(e: Event) {
    const el = e.target as HTMLInputElement;
    const n = parseNumber(el.value);
    if (!t) return;
    if (n === undefined) {
      app.flashNotice(`Not a number: "${el.value}"`);
      el.value = formatNumber(t.openingBalance);
      return;
    }
    app.updateTable(t.id, { openingBalance: n ?? 0 });
    el.value = formatNumber(n ?? 0);
  }

  function setOpeningMonth(e: Event) {
    if (t) app.updateTable(t.id, { openingMonth: (e.target as HTMLSelectElement).value });
  }

  function remove() {
    if (t && confirm(`Delete table "${t.name}"?`)) app.deleteTable(t.id);
  }

  function label(k: string) {
    return `${monthLabel(k)} ${parseMonth(k).year}`;
  }
</script>

<aside class="inspector">
  {#if t}
    <h3>Table</h3>
    <label>
      Name
      {#key t.id}<input value={t.name} onchange={setName} disabled={app.readonly} />{/key}
    </label>
    <label>
      Opening balance
      {#key `${t.id}:${t.openingBalance}`}
        <input value={formatNumber(t.openingBalance)} onchange={setOpening} inputmode="decimal" disabled={app.readonly} />
      {/key}
    </label>
    <label>
      As of the start of
      <select value={t.openingMonth} onchange={setOpeningMonth} disabled={app.readonly}>
        {#each monthOptions as m (m)}<option value={m}>{label(m)}</option>{/each}
      </select>
    </label>
    {#if t.openingMonth < app.months[0]}
      <p class="hint">
        Months before {label(app.months[0])} are hidden, but their amounts still count toward the
        balance.
      </p>
    {/if}
    {#if !app.readonly}
    <div class="row">
      <button onclick={() => app.addRow(t.id)}>+ Row</button>
      <button class="danger" onclick={remove}>Delete table</button>
    </div>
    {/if}
  {:else}
    <p class="hint">Select a table to edit its name and opening balance.</p>
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
    <li>Files are saved in this browser for now. Download keeps a copy with all snapshots.</li>
  </ul>
</aside>

<style>
  .inspector {
    width: 270px;
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
    margin: 8px 0 10px;
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-bottom: 10px;
    color: var(--muted);
  }
  input,
  select {
    color: var(--text);
    border: 1px solid var(--line);
    border-radius: 6px;
    padding: 6px 8px;
    background: #fff;
    min-height: 32px;
  }
  .row {
    display: flex;
    gap: 6px;
    margin: 12px 0 18px;
  }
  .hint {
    color: var(--muted);
    line-height: 1.5;
    padding-left: 0;
  }
  ul.hint {
    padding-left: 16px;
    margin: 0;
  }
</style>
