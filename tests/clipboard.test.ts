import { describe, expect, it } from 'vitest';
import { parseTSV, toTSV } from '../src/lib/clipboard';

describe('TSV', () => {
  it('parses Excel output with CRLF and a trailing newline', () => {
    expect(parseTSV('Rent\t-500\t-500\r\nPayroll\t-2000\t\r\n')).toEqual([
      ['Rent', '-500', '-500'],
      ['Payroll', '-2000', ''],
    ]);
  });

  it('handles quoted cells with tabs, newlines and quotes', () => {
    expect(parseTSV('"a\tb"\t"line1\nline2"\t"say ""hi"""')).toEqual([
      ['a\tb', 'line1\nline2', 'say "hi"'],
    ]);
  });

  it('round-trips', () => {
    const grid = [['x', 'a\tb'], ['', '1']];
    expect(parseTSV(toTSV(grid))).toEqual(grid);
  });
});
