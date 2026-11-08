import { describe, expect, it } from 'vitest';
import { convertCell, matchesFilters, parseBool, parseCell } from '../src/lib/ledger';
import { normalizeWorkbook } from '../src/lib/model';

describe('ledger cells', () => {
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

describe('loading older files', () => {
  it('converts the fixed ledger fields, row sources and import mappings', () => {
    const wb = normalizeWorkbook({
      schema: 1,
      sheets: [{
        id: 's', name: 'S', tables: [
          { kind: 'ledger', id: 'L', name: 'Bank', x: 0, y: 0, styles: {},
            entries: [{ id: 'e', date: '2026-11-01', amount: -5, category: 'Rent', note: '' }],
            importMap: { hasHeader: true, date: '日期', amount: '', income: '收入', expense: '支出', category: '', note: '摘要', flip: false, sheet: '' } },
          { kind: 'cashflow', id: 'T', name: 'Main', x: 0, y: 0, styles: {}, openingBalance: 0, openingMonth: '2026-11',
            rows: [{ id: 'r', label: 'Rent', values: {}, source: { ledgerId: 'L', categories: ['Rent'], noteContains: 'office', flip: false } }] },
        ],
      }],
    })!;
    const [ledger, table] = wb.sheets[0].tables as any[];
    expect(ledger.columns.map((c: any) => c.id)).toEqual(['date', 'amount', 'category', 'note']);
    expect(ledger.entries[0].cells).toEqual({ date: '2026-11-01', amount: -5, category: 'Rent' });
    expect(ledger.importMap).toEqual({ hasHeader: true, sheet: '', cols: { date: '日期', note: '摘要' }, split: { col: 'amount', income: '收入', expense: '支出' }, flip: false });
    expect(table.rows[0].source).toEqual({
      ledgerId: 'L', dateCol: 'date', amountCol: 'amount', flip: false,
      filters: [
        { col: 'category', op: 'in', values: ['Rent'], text: '' },
        { col: 'note', op: 'contains', values: [], text: 'office' },
      ],
    });
    expect(table.cellSources).toEqual({});
  });
});
