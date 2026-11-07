import { describe, expect, it } from 'vitest';
import { Evaluator } from '../src/lib/evaluate';
import { newLedger, newRow, newTable, type Workbook } from '../src/lib/model';

function setup() {
  const t = newTable('Main');
  t.openingBalance = 10_000;
  t.openingMonth = '2026-10';
  const sales = newRow('Sales');
  sales.values = { '2026-10': 100, '2026-11': 1000, '2026-12': 500 };
  const rent = newRow('Rent');
  rent.values = { '2026-10': -40, '2026-11': -300, '2026-12': -800 };
  t.rows = [sales, rent];
  const ledger = newLedger('Bank');
  ledger.entries = [
    { id: 'e1', date: '2026-11-03', amount: -120.1, category: 'Suppliers', note: 'Paper' },
    { id: 'e2', date: '2026-11-20', amount: -80.2, category: 'suppliers ', note: 'Ink' },
    { id: 'e3', date: '2026-11-21', amount: 999, category: 'Sales', note: '' },
    { id: 'e4', date: '2026-12-05', amount: -50, category: 'Suppliers', note: 'Paper' },
    { id: 'e5', date: '', amount: -1, category: 'Suppliers', note: '' },
  ];
  const wb: Workbook = { schema: 1, sheets: [{ id: 's', name: 'S', tables: [t, ledger] }], settings: { syncMinutes: 15 } };
  return { wb, t, sales, rent, ledger };
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

  it('fills a source row from the ledger with category filter, and lets manual values override', () => {
    const { wb, t, ledger } = setup();
    const sup = newRow('Suppliers');
    sup.source = { ledgerId: ledger.id, categories: ['Suppliers'], noteContains: '', flip: false };
    sup.values = { '2026-12': -75 };
    t.rows.push(sup);
    const ev = new Evaluator(wb);
    expect(ev.row(t, sup, '2026-11')).toBe(-200.3);
    expect(ev.row(t, sup, '2026-12')).toBe(-75); // override
    expect(ev.row(t, sup, '2027-01')).toBeNull();
    expect(ev.cashFlow(t, '2026-11')).toBeCloseTo(499.7);
  });

  it('filters by note text and flips signs', () => {
    const { wb, ledger } = setup();
    const ev = new Evaluator(wb);
    expect(ev.sourceValue({ ledgerId: ledger.id, categories: [], noteContains: 'paper', flip: true }, '2026-11')).toBe(120.1);
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
    const other = newTable('Summary');
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
