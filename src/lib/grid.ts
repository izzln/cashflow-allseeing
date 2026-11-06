import type { Footers } from './compute';
import type { Table } from './model';
import type { MonthKey } from './months';

/** Cell position inside a table. r: body rows, then footer rows. c: 0 = label, then months. */
export interface Pos {
  r: number;
  c: number;
}

export interface Range {
  a: Pos;
  b: Pos;
}

export const FOOTERS = [
  { id: '__cashflow', label: 'Net cash flow' },
  { id: '__balance', label: 'Balance' },
] as const;

export function rowCount(t: Table): number {
  return t.rows.length + FOOTERS.length;
}

export function isBodyRow(t: Table, r: number): boolean {
  return r >= 0 && r < t.rows.length;
}

export function rowIdAt(t: Table, r: number): string {
  return isBodyRow(t, r) ? t.rows[r].id : FOOTERS[r - t.rows.length].id;
}

export function colKeyAt(months: MonthKey[], c: number): string {
  return c === 0 ? 'label' : months[c - 1];
}

export function styleKey(rowId: string, colKey: string): string {
  return `${rowId}|${colKey}`;
}

export function bounds(rg: Range) {
  return {
    r0: Math.min(rg.a.r, rg.b.r),
    r1: Math.max(rg.a.r, rg.b.r),
    c0: Math.min(rg.a.c, rg.b.c),
    c1: Math.max(rg.a.c, rg.b.c),
  };
}

export function cellsInRanges(ranges: Range[]): Pos[] {
  const seen = new Set<string>();
  const out: Pos[] = [];
  for (const rg of ranges) {
    const { r0, r1, c0, c1 } = bounds(rg);
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const k = `${r},${c}`;
        if (!seen.has(k)) {
          seen.add(k);
          out.push({ r, c });
        }
      }
    }
  }
  return out;
}

/** The value shown in a cell: label text, a number, or null when empty. */
export function cellValue(
  t: Table,
  months: MonthKey[],
  footers: Footers,
  p: Pos,
): string | number | null {
  if (isBodyRow(t, p.r)) {
    const row = t.rows[p.r];
    if (p.c === 0) return row.label;
    return row.values[months[p.c - 1]] ?? null;
  }
  const f = p.r - t.rows.length;
  if (p.c === 0) return FOOTERS[f].label;
  return f === 0 ? footers.cashFlow[p.c - 1] : footers.balance[p.c - 1];
}

export function selectionStats(values: (string | number | null)[]) {
  const nums = values.filter((v): v is number => typeof v === 'number');
  const sum = nums.reduce((a, b) => a + b, 0);
  return { count: nums.length, sum, avg: nums.length ? sum / nums.length : 0 };
}
