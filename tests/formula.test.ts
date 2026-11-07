import { describe, expect, it } from 'vitest';
import { evaluate, FormulaError, parseFormula } from '../src/lib/formula';

const run = (src: string, refs: Record<string, number> = {}) =>
  evaluate(parseFormula(src), {
    ref: (table, row, off) => {
      const key = `${table ? table + '.' : ''}${row}${off ? '@' + off : ''}`;
      if (!(key in refs)) throw new FormulaError(`missing ${key}`);
      return refs[key];
    },
  });

describe('formula', () => {
  it('does arithmetic with precedence, unary minus and percent', () => {
    expect(run('1 + 2 * 3')).toBe(7);
    expect(run('(1 + 2) * 3')).toBe(9);
    expect(run('-2 * -3')).toBe(6);
    expect(run('200 * 6%')).toBe(12);
    expect(run('=10/4')).toBe(2.5);
  });

  it('resolves row and cross-table references', () => {
    expect(run('[Sales] * 6%', { Sales: 1000 })).toBe(60);
    expect(run('[Main account].[Balance] + 1', { 'Main account.Balance': 5 })).toBe(6);
  });

  it('accepts Chinese full-width input', () => {
    expect(run('【销售收入】×（1－10％）', { 销售收入: 100 })).toBe(90);
  });

  it('supports PREV for lags', () => {
    expect(run('PREV([Sales]) * 50% + PREV([Sales], 2) * 50%', { 'Sales@-1': 100, 'Sales@-2': 300 })).toBe(200);
  });

  it('has SUM, MIN, MAX, ABS, ROUND, IF', () => {
    expect(run('SUM(1, 2, 3)')).toBe(6);
    expect(run('MIN(4, -1) + MAX(2, 9)')).toBe(8);
    expect(run('ABS(-3.5)')).toBe(3.5);
    expect(run('ROUND(2.345, 2)')).toBe(2.35);
    expect(run('IF([x] > 0, 1, 2)', { x: -5 })).toBe(2);
  });

  it('reports errors clearly', () => {
    expect(() => parseFormula('[Sales')).toThrow('Missing ]');
    expect(() => parseFormula('1 +')).toThrow();
    expect(() => parseFormula('FOO(1)')).toThrow('Unknown function FOO');
    expect(() => run('1 / 0')).toThrow('Division by zero');
    expect(() => parseFormula('ABS(1, 2)')).toThrow('ABS takes 1 argument');
  });
});
