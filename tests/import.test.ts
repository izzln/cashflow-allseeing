import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { detectDateOrder, excelSerialToDate, parseDate } from '../src/lib/dates';
import { decodeText, detectDelimiter, parseDelimited } from '../src/lib/import/delimited';
import { buildEntries, guessMap } from '../src/lib/import/mapping';
import { readSpreadsheet } from '../src/lib/import/xlsx';
import type { ImportMap } from '../src/lib/model';

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
    const guess = guessMap(sheet.rows[0]);
    expect(guess).toEqual({ date: '交易日期', amount: '', income: '贷方发生额', expense: '借方发生额', category: '类别', note: '摘要' });
    const map: ImportMap = { ...guess, hasHeader: true, flip: false, sheet: '流水' };
    const { entries, skipped } = buildEntries(sheet.rows, map);
    expect(skipped).toBe(1); // the total row has no date
    expect(entries.map((e) => [e.date, e.amount, e.category])).toEqual([
      ['2026-11-03', -1200.5, '供应商'],
      ['2026-11-15', 30000, '销售'],
      ['2026-11-20', -8000, '房租'],
      ['2026-12-01', -45000, '工资'],
    ]);
  });

  it('guesses a single amount column and supports flipping', () => {
    const rows = [['Date', 'Amount', 'Category', 'Memo'], ['2026-11-02', '350', 'Office', 'Ink']];
    const guess = guessMap(rows[0]);
    expect(guess).toMatchObject({ date: 'Date', amount: 'Amount', category: 'Category', note: 'Memo' });
    const { entries } = buildEntries(rows, { ...guess, hasHeader: true, flip: true, sheet: '' });
    expect(entries[0].amount).toBe(-350);
  });

  it('works without a header row, by column number', () => {
    const map: ImportMap = { hasHeader: false, date: '0', amount: '1', income: '', expense: '', category: '', note: '2', flip: false, sheet: '' };
    expect(buildEntries([['2026-11-01', '-5', 'x']], map).entries[0]).toMatchObject({ date: '2026-11-01', amount: -5, note: 'x' });
  });
});
