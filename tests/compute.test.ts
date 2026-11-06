import { describe, expect, it } from 'vitest';
import { computeFooters } from '../src/lib/compute';
import { newRow, newTable } from '../src/lib/model';

function table() {
  const t = newTable('T');
  const a = newRow('In');
  const b = newRow('Out');
  a.values = { '2026-10': 100, '2026-11': 1000, '2026-12': 500 };
  b.values = { '2026-10': -40, '2026-11': -300, '2026-12': -800 };
  t.rows = [a, b];
  t.openingBalance = 10_000;
  return t;
}

describe('computeFooters', () => {
  it('sums rows into cash flow and carries the balance', () => {
    const t = table();
    t.openingMonth = '2026-11';
    const f = computeFooters(t, ['2026-11', '2026-12', '2027-01']);
    expect(f.cashFlow).toEqual([700, -300, 0]);
    expect(f.balance).toEqual([10_700, 10_400, 10_400]);
  });

  it('counts hidden months between the opening month and the window', () => {
    const t = table();
    t.openingMonth = '2026-10';
    const f = computeFooters(t, ['2026-11', '2026-12']);
    expect(f.balance).toEqual([10_760, 10_460]);
  });

  it('leaves balance blank before the opening month', () => {
    const t = table();
    t.openingMonth = '2026-12';
    const f = computeFooters(t, ['2026-11', '2026-12']);
    expect(f.balance).toEqual([null, 9_700]);
  });
});
