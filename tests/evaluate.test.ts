import { describe, expect, it } from 'vitest';
import { Evaluator } from '../src/lib/evaluate';
import { newDataTable, newRow, newCashflow, type Workbook } from '../src/lib/model';

function setup() {
  const t = newCashflow('Main');
  t.openingBalance = 10_000;
  t.openingMonth = '2026-10';
  const sales = newRow('Sales');
  sales.values = { '2026-10': 100, '2026-11': 1000, '2026-12': 500 };
  const rent = newRow('Rent');
  rent.values = { '2026-10': -40, '2026-11': -300, '2026-12': -800 };
  t.rows = [sales, rent];
  const dataTable = newDataTable('Bank');
  dataTable.columns.push({ id: 'paid', name: 'Paid', type: 'checkbox' });
  const e = (id: string, cells: Record<string, string | number | boolean>) => ({ id, cells });
  dataTable.entries = [
    e('e1', { date: '2026-11-03', amount: -120.1, category: 'Suppliers', note: 'Paper', paid: true }),
    e('e2', { date: '2026-11-20', amount: -80.2, category: 'suppliers ', note: 'Ink' }),
    e('e3', { date: '2026-11-21', amount: 999, category: 'Sales' }),
    e('e4', { date: '2026-12-05', amount: -50, category: 'Suppliers', note: 'Paper', paid: true }),
    e('e5', { amount: -1, category: 'Suppliers' }),
  ];
  const wb: Workbook = { schema: 1, sheets: [{ id: 's', name: 'S', tables: [t, dataTable] }], settings: { syncMinutes: 15 } };
  return { wb, t, sales, rent, dataTable };
}

describe('Evaluator', () => {
  it('sums rows into cash flow and carries the balance, counting hidden months', () => {
    const { wb, t } = setup();
    const ev = new Evaluator(wb);
    expect(ev.cashFlow(t, '2026-11')).toBe(700);
    expect(ev.balance(t, '2026-11')).toBe(10_760);
    expect(ev.balance(t, '2026-12')).toBe(10_460);
    expect(ev.balance(t, '2026-09')).toBeNull();
  });

  it('fills a source row from the dataTable with category filter, and lets manual values override', () => {
    const { wb, t, dataTable } = setup();
    const sup = newRow('Suppliers');
    sup.source = {
      tableId: dataTable.id,
      dateCol: 'date',
      amountCol: 'amount',
      filters: [{ col: 'category', op: 'in', values: ['Suppliers'], text: '' }],
      flip: false,
    };
    sup.values = { '2026-12': -75 };
    t.rows.push(sup);
    const ev = new Evaluator(wb);
    expect(ev.row(t, sup, '2026-11')).toBe(-200.3);
    expect(ev.row(t, sup, '2026-12')).toBe(-75); // override
    expect(ev.row(t, sup, '2027-01')).toBeNull();
    expect(ev.cashFlow(t, '2026-11')).toBeCloseTo(499.7);
  });

  it('filters by note text and checkbox, and flips signs', () => {
    const { wb, dataTable } = setup();
    const ev = new Evaluator(wb);
    const src = (filters: any[]) => ({ tableId: dataTable.id, dateCol: 'date', amountCol: 'amount', filters, flip: true });
    expect(ev.sourceValue(src([{ col: 'note', op: 'contains', values: [], text: 'paper' }]), '2026-11')).toBe(120.1);
    expect(ev.sourceValue(src([{ col: 'paid', op: 'unchecked', values: [], text: '' }]), '2026-11')).toBe(-918.8);
  });

  it('shows one dataTable column total in a single cell, over all dates', () => {
    const { wb, t, sales, dataTable } = setup();
    t.cellSources[`${sales.id}|2026-11`] = {
      tableId: dataTable.id,
      col: 'amount',
      filters: [{ col: 'paid', op: 'checked', values: [], text: '' }],
      flip: false,
    };
    const ev = new Evaluator(wb);
    expect(ev.row(t, sales, '2026-11')).toBe(-170.1); // −120.1 (Nov) + −50 (Dec), both ticked
    expect(ev.row(t, sales, '2026-12')).toBe(500); // other months keep their numbers
    expect(ev.cashFlow(t, '2026-11')).toBe(-470.1);
  });

  it('explains a source with a missing column', () => {
    const { wb, t, dataTable } = setup();
    const r = newRow('Broken');
    r.source = { tableId: dataTable.id, dateCol: 'nope', amountCol: 'amount', filters: [], flip: false };
    t.rows.push(r);
    expect(new Evaluator(wb).row(t, r, '2026-11')).toEqual({ err: 'Choose a date column for this row' });
  });

  it('computes formula rows and footer rows', () => {
    const { wb, t } = setup();
    const vat = newRow('VAT');
    vat.formula = '[Sales] * -6%';
    t.rows.push(vat);
    t.footers.push({ id: 'f1', label: 'Margin', formula: '[Sales] + [Rent]' });
    t.footers.push({ id: 'f2', label: 'Months of runway', formula: 'ROUND([Balance] / ABS([Rent]), 1)' });
    const ev = new Evaluator(wb);
    expect(ev.row(t, vat, '2026-11')).toBe(-60);
    expect(ev.cashFlow(t, '2026-11')).toBe(640);
    expect(ev.footer(t, t.footers[0], '2026-11')).toBe(700);
    // Balance includes VAT: Oct 100 − 40 − 6, Nov 1000 − 300 − 60.
    expect(ev.balance(t, '2026-11')).toBe(10_694);
    expect(ev.footer(t, t.footers[1], '2026-11')).toBe(35.6);
  });

  it('reads other tables and previous months', () => {
    const { wb, t } = setup();
    const other = newCashflow('Summary');
    const r = newRow('Main balance');
    r.formula = '[Main].[Balance]';
    const lag = newRow('Collections');
    lag.formula = 'PREV([Main].[Sales]) * 50%';
    other.rows = [r, lag];
    wb.sheets.push({ id: 's2', name: 'S2', tables: [other] });
    const ev = new Evaluator(wb);
    expect(ev.row(other, r, '2026-11')).toBe(10_760);
    expect(ev.row(other, lag, '2026-12')).toBe(500);
  });

  it('reports circular references and bad formulas instead of crashing', () => {
    const { wb, t } = setup();
    const loop = newRow('Loop');
    loop.formula = '[Net cash flow] * 10%';
    const bad = newRow('Bad');
    bad.formula = '[Nope] + 1';
    t.rows.push(loop);
    const ev = new Evaluator(wb);
    expect(ev.row(t, loop, '2026-11')).toEqual({ err: 'Row "Loop": Circular reference' });
    t.rows.pop();
    t.rows.push(bad);
    const ev2 = new Evaluator(wb);
    expect(ev2.row(t, bad, '2026-11')).toEqual({ err: 'No row named "Nope"' });
    expect(ev2.cashFlow(t, '2026-11')).toEqual({ err: 'Row "Bad": No row named "Nope"' });
  });

  it('accepts Chinese names for the footers', () => {
    const { wb, t } = setup();
    t.footers.push({ id: 'f', label: '检查', formula: '【余额】 - 【净现金流】' });
    expect(new Evaluator(wb).footer(t, t.footers[0], '2026-11')).toBe(10_060);
  });
});
