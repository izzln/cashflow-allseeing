import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { detectDateOrder, excelSerialToDate, parseDate } from '../src/lib/dates';
import { decodeText, detectDelimiter, parseDelimited } from '../src/lib/import/delimited';
import { buildEntries, guessMap } from '../src/lib/import/mapping';
import { readSpreadsheet } from '../src/lib/import/xlsx';
import { defaultColumns, type ImportMap } from '../src/lib/model';

const cols = defaultColumns();

const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)));

describe('dates', () => {
  it.each([
    ['2026-11-07', '2026-11-07'],
    ['2026/1/5', '2026-01-05'],
    ['2026.11.07', '2026-11-07'],
    ['2026年11月7日', '2026-11-07'],
    ['20261107', '2026-11-07'],
    ['2026-11-07 09:30:00', '2026-11-07'],
    ['46333', '2026-11-07'],
    ['2026-02-30', null],
    ['hello', null],
  ])('%s → %s', (input, out) => expect(parseDate(input)).toBe(out));

  it('handles month/day order and month-day only input', () => {
    expect(parseDate('03/04/2026', 'mdy')).toBe('2026-03-04');
    expect(parseDate('03/04/2026', 'dmy')).toBe('2026-04-03');
    expect(detectDateOrder(['03/04/2026', '25/04/2026'])).toBe('dmy');
    expect(parseDate('11月7日', 'mdy', 2026)).toBe('2026-11-07');
    expect(excelSerialToDate(46333)).toBe('2026-11-07');
  });
});

describe('CSV', () => {
  it('decodes GBK files and detects the separator', () => {
    const text = decodeText(fixture('bank-gbk.csv'));
    expect(text.startsWith('日期,金额')).toBe(true);
    expect(detectDelimiter(text)).toBe(',');
    expect(parseDelimited(text, ',')[1]).toEqual(['2026-11-02', '-350.00', '办公', '打印机, 墨水']);
  });

  it('detects semicolons and tabs', () => {
    expect(detectDelimiter('a;b;c\n1;2;3')).toBe(';');
    expect(detectDelimiter('a\tb\n1\t2')).toBe('\t');
  });
});

describe('xlsx', () => {
  it('reads sheets, shared strings, numbers and date cells', async () => {
    const sheets = await readSpreadsheet('bank.xlsx', fixture('bank.xlsx'));
    expect(sheets.map((s) => s.name)).toEqual(['流水', 'Other']);
    const rows = sheets[0].rows;
    expect(rows[0]).toEqual(['交易日期', '摘要', '借方发生额', '贷方发生额', '类别']);
    expect(rows[1]).toEqual(['2026-11-03', '采购纸张 & 墨盒', '1200.5', '', '供应商']);
    expect(rows[2][0]).toBe('2026-11-15'); // custom Chinese date format
    expect(rows[4][0]).toBe('2026-12-01'); // date-time
  });

  it('rejects old binary formats with a clear message', async () => {
    await expect(readSpreadsheet('old.xls', new Uint8Array([0xd0, 0xcf, 0x11]))).rejects.toThrow('.xlsx or .csv');
  });
});

describe('mapping', () => {
  it('guesses Chinese bank columns and builds entries', async () => {
    const [sheet] = await readSpreadsheet('bank.xlsx', fixture('bank.xlsx'));
    const guess = guessMap(sheet.rows[0], cols);
    expect(guess).toEqual({
      cols: { date: '交易日期', category: '类别', note: '摘要' },
      split: { col: 'amount', income: '贷方发生额', expense: '借方发生额' },
    });
    const map: ImportMap = { ...guess, hasHeader: true, flip: false, sheet: '流水' };
    const { entries, skipped } = buildEntries(sheet.rows, map, cols);
    expect(skipped).toBe(1); // the total row has no date
    expect(entries.map((e) => [e.cells.date, e.cells.amount, e.cells.category])).toEqual([
      ['2026-11-03', -1200.5, '供应商'],
      ['2026-11-15', 30000, '销售'],
      ['2026-11-20', -8000, '房租'],
      ['2026-12-01', -45000, '工资'],
    ]);
  });

  it('guesses a single amount column and supports flipping', () => {
    const rows = [['Date', 'Amount', 'Category', 'Memo'], ['2026-11-02', '350', 'Office', 'Ink']];
    const guess = guessMap(rows[0], cols);
    expect(guess).toEqual({ cols: { date: 'Date', amount: 'Amount', category: 'Category', note: 'Memo' }, split: null });
    const { entries } = buildEntries(rows, { ...guess, hasHeader: true, flip: true, sheet: '' }, cols);
    expect(entries[0].cells.amount).toBe(-350);
  });

  it('fills custom columns by name, including checkboxes', () => {
    const custom = [...cols, { id: 'c5', name: 'Paid', type: 'checkbox' as const }, { id: 'c6', name: 'Invoice no.', type: 'text' as const }];
    const rows = [['日期', '金额', 'paid', 'Invoice No.'], ['2026-11-02', '-10', '是', 'A-1'], ['2026-11-03', '-20', '', 'A-2']];
    const guess = guessMap(rows[0], custom);
    expect(guess.cols).toMatchObject({ date: '日期', amount: '金额', c5: 'paid', c6: 'Invoice No.' });
    const { entries } = buildEntries(rows, { ...guess, hasHeader: true, flip: false, sheet: '' }, custom);
    expect(entries.map((e) => [e.cells.c5, e.cells.c6])).toEqual([[true, 'A-1'], [undefined, 'A-2']]);
  });

  it('works without a header row, by column number', () => {
    const map: ImportMap = { hasHeader: false, cols: { date: '0', amount: '1', note: '2' }, split: null, flip: false, sheet: '' };
    expect(buildEntries([['2026-11-01', '-5', 'x']], map, cols).entries[0].cells).toEqual({ date: '2026-11-01', amount: -5, note: 'x' });
  });
});
