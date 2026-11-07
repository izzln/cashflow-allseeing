import { describe, expect, it } from 'vitest';
import { merge3 } from '../src/lib/merge';

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));

type Row = { id: string; label: string; values: Record<string, number> };
type WB = { sheets: { id: string; name: string; tables: { id: string; name: string; rows: Row[] }[] }[] };

const base: WB = {
  sheets: [
    {
      id: 's1',
      name: 'Ops',
      tables: [
        {
          id: 't1',
          name: 'Main',
          rows: [
            { id: 'a', label: 'Sales', values: { '2026-11': 100 } },
            { id: 'b', label: 'Rent', values: { '2026-11': -50 } },
            { id: 'c', label: 'Tax', values: {} },
          ],
        },
      ],
    },
  ],
};

const rows = (w: typeof base) => w.sheets[0].tables[0].rows;

describe('merge3', () => {
  it('keeps edits to different cells from both windows', () => {
    const mine = clone(base);
    const theirs = clone(base);
    rows(mine)[0].values['2026-12'] = 200;
    rows(theirs)[1].values['2026-11'] = -60;
    const out = merge3(base, mine, theirs);
    expect(rows(out)[0].values).toEqual({ '2026-11': 100, '2026-12': 200 });
    expect(rows(out)[1].values).toEqual({ '2026-11': -60 });
  });

  it('keeps rows added on both sides, in place', () => {
    const mine = clone(base);
    const theirs = clone(base);
    rows(mine).splice(1, 0, { id: 'm', label: 'Mine', values: {} });
    rows(theirs).push({ id: 't', label: 'Theirs', values: {} });
    expect(rows(merge3(base, mine, theirs)).map((r) => r.id)).toEqual(['a', 'm', 'b', 'c', 't']);
  });

  it('applies a deletion from one side and an edit from the other', () => {
    const mine = clone(base);
    const theirs = clone(base);
    mine.sheets[0].tables[0].rows = rows(mine).filter((r) => r.id !== 'c');
    rows(theirs)[0].label = 'Sales receipts';
    const out = rows(merge3(base, mine, theirs));
    expect(out.map((r) => r.id)).toEqual(['a', 'b']);
    expect(out[0].label).toBe('Sales receipts');
  });

  it('follows the side that reordered', () => {
    const mine = clone(base);
    const theirs = clone(base);
    rows(theirs).reverse();
    rows(mine)[0].values['2026-11'] = 1;
    const out = rows(merge3(base, mine, theirs));
    expect(out.map((r) => r.id)).toEqual(['c', 'b', 'a']);
    expect(out[2].values['2026-11']).toBe(1);
  });

  it('lets mine win when both changed the same cell', () => {
    const mine = clone(base);
    const theirs = clone(base);
    rows(mine)[0].values['2026-11'] = 1;
    rows(theirs)[0].values['2026-11'] = 2;
    expect(rows(merge3(base, mine, theirs))[0].values['2026-11']).toBe(1);
  });

  it('handles a cleared cell (deleted key)', () => {
    const mine = clone(base);
    const theirs = clone(base);
    delete rows(mine)[0].values['2026-11'];
    rows(theirs)[1].label = 'Office rent';
    const out = rows(merge3(base, mine, theirs));
    expect(out[0].values).toEqual({});
    expect(out[1].label).toBe('Office rent');
  });

  it('reverts only my change when used for undo', () => {
    // undo = merge(base: after my change, mine: before my change, theirs: current)
    const before = clone(base);
    const after = clone(base);
    rows(after)[0].values['2026-11'] = 999;
    const current = clone(after);
    rows(current)[2].values['2026-12'] = -7; // the other window's edit
    const out = rows(merge3(after, before, current));
    expect(out[0].values['2026-11']).toBe(100);
    expect(out[2].values['2026-12']).toBe(-7);
  });
});
