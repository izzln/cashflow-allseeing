import { describe, expect, it } from 'vitest';
import { convertCell, matchesFilters, parseBool, parseCell } from '../src/lib/columns';
import { normalizeWorkbook } from '../src/lib/model';

describe('dataTable cells', () => {
  it('parses values per column type', () => {
    expect(parseCell('date', '2026/11/7')).toBe('2026-11-07');
    expect(parseCell('date', 'soon')).toBeUndefined();
    expect(parseCell('number', '(1,200)')).toBe(-1200);
    expect(parseCell('checkbox', '是')).toBe(true);
    expect(parseCell('checkbox', 'no')).toBeNull();
    expect(parseCell('text', '  hi ')).toBe('hi');
    expect(parseCell('text', '   ')).toBeNull();
    expect(parseBool('maybe')).toBeUndefined();
  });

  it('converts between types where it can', () => {
    expect(convertCell('text', 'number', '12.5')).toBe(12.5);
    expect(convertCell('text', 'number', 'abc')).toBeUndefined();
    expect(convertCell('number', 'text', 3)).toBe('3');
    expect(convertCell('text', 'checkbox', 'yes')).toBe(true);
  });

  it('applies filters', () => {
    const e = { id: 'x', cells: { category: 'Rent ', note: 'Office rent Nov', paid: true } };
    expect(matchesFilters(e, [{ col: 'category', op: 'in', values: ['rent'], text: '' }])).toBe(true);
    expect(matchesFilters(e, [{ col: 'note', op: 'contains', values: [], text: 'NOV' }])).toBe(true);
    expect(matchesFilters(e, [{ col: 'paid', op: 'unchecked', values: [], text: '' }])).toBe(false);
  });
});

describe('loading files', () => {
  it('keeps valid cells per column type and drops the rest', () => {
    const wb = normalizeWorkbook({
      schema: 1,
      sheets: [{ id: 's', name: 'S', tables: [{
        kind: 'table', id: 'L', name: 'Bank', x: 0, y: 0, styles: {},
        columns: [{ id: 'date', name: 'Date', type: 'date' }, { id: 'amount', name: 'Amount', type: 'number' }, { id: 'paid', name: 'Paid', type: 'checkbox' }],
        entries: [{ id: 'e', cells: { date: '2026-11-01', amount: '12', paid: true, stray: 'x' } }],
      }] }],
    })!;
    const t = wb.sheets[0].tables[0] as any;
    expect(t.kind).toBe('table');
    expect(t.entries[0].cells).toEqual({ date: '2026-11-01', paid: true });
  });
});
