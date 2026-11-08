import { describe, expect, it } from 'vitest';
import { fitColumns, textWidth } from '../src/lib/grid';
import { normalizeWorkbook } from '../src/lib/model';

describe('fitColumns (Fill Window)', () => {
  const cols = [
    { natural: 112, min: 96, wrap: false }, // date
    { natural: 120, min: 70, wrap: false }, // number
    { natural: 240, min: 80, wrap: true }, // note
  ];
  const sum = (w: number[]) => w.reduce((a, b) => a + b, 0);

  it('gives extra width to wrapping columns', () => {
    const w = fitColumns(cols, 800);
    expect(w[0]).toBe(112);
    expect(w[1]).toBe(120);
    expect(sum(w)).toBeLessThanOrEqual(800);
    expect(sum(w)).toBeGreaterThan(796);
  });

  it('shrinks wrapping columns first, then the others to their minimum', () => {
    expect(fitColumns(cols, 400)).toEqual([112, 120, 168]);
    const tight = fitColumns(cols, 280);
    expect(tight[2]).toBe(80);
    expect(tight[0]).toBeGreaterThanOrEqual(96);
    expect(sum(tight)).toBeLessThanOrEqual(281);
  });

  it('returns the minimums when even they do not fit (the table scrolls)', () => {
    expect(fitColumns(cols, 100)).toEqual([96, 70, 80]);
  });

  it('estimates text width, wider for Chinese', () => {
    expect(textWidth('Amount')).toBeLessThan(textWidth('金额金额金额'));
  });
});

describe('alignment', () => {
  it('keeps only valid alignments when loading', () => {
    const wb = normalizeWorkbook({
      schema: 1,
      sheets: [{ id: 's', name: 'S', tables: [{ kind: 'table', id: 't', name: 'T', x: 0, y: 0, styles: {}, aligns: { 'a|note': 'center', 'b|note': 'diagonal' }, columns: [], entries: [] }] }],
    })!;
    expect(wb.sheets[0].tables[0].aligns).toEqual({ 'a|note': 'center' });
  });
});
