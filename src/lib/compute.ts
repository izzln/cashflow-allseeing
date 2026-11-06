import type { Table } from './model';
import type { MonthKey } from './months';

export interface Footers {
  cashFlow: number[];
  /** null for months before the opening month. */
  balance: (number | null)[];
}

export function monthFlow(table: Table, month: MonthKey): number {
  let sum = 0;
  for (const row of table.rows) sum += row.values[month] ?? 0;
  return sum;
}

/**
 * Net cash flow per visible month, and the running balance.
 * Balance(m) = opening balance + every month's cash flow from the opening month
 * through m, including months that are no longer visible.
 */
export function computeFooters(table: Table, months: MonthKey[]): Footers {
  const cashFlow = months.map((m) => monthFlow(table, m));
  const first = months[0];
  let running = table.openingBalance;
  if (first !== undefined && table.openingMonth < first) {
    for (const row of table.rows) {
      for (const [k, v] of Object.entries(row.values)) {
        if (k >= table.openingMonth && k < first) running += v;
      }
    }
  }
  const balance = months.map((m, i) => {
    if (m < table.openingMonth) return null;
    running += cashFlow[i];
    return running;
  });
  return { cashFlow, balance };
}
