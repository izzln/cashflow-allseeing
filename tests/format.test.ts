import { describe, expect, it } from 'vitest';
import { formatNumber, parseNumber } from '../src/lib/format';

describe('parseNumber', () => {
  it.each([
    ['1234', 1234],
    ['-1,234.50', -1234.5],
    ['(500)', -500],
    ['¥ 1,000', 1000],
    ['500-', -500],
    ['－１２３', -123],
    ['.5', 0.5],
  ])('%s → %s', (input, out) => expect(parseNumber(input)).toBe(out));

  it('treats blank and a lone dash as clear', () => {
    expect(parseNumber('  ')).toBeNull();
    expect(parseNumber('-')).toBeNull();
  });

  it('rejects text', () => {
    expect(parseNumber('abc')).toBeUndefined();
    expect(parseNumber('1k')).toBeUndefined();
  });
});

describe('formatNumber', () => {
  it('formats with separators and at most 2 decimals', () => {
    expect(formatNumber(1234567.891)).toBe('1,234,567.89');
    expect(formatNumber(-0)).toBe('0');
    expect(formatNumber(undefined)).toBe('');
  });
});
