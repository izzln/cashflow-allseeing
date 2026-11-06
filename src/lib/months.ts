/** A calendar month as 'YYYY-MM'. Sorts correctly as a plain string. */
export type MonthKey = string;

const NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function monthKey(year: number, month: number): MonthKey {
  return `${year}-${String(month).padStart(2, '0')}`;
}

export function parseMonth(k: MonthKey): { year: number; month: number } {
  const [y, m] = k.split('-').map(Number);
  return { year: y, month: m };
}

export function isMonthKey(k: unknown): k is MonthKey {
  return typeof k === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(k);
}

export function currentMonth(now = new Date()): MonthKey {
  return monthKey(now.getFullYear(), now.getMonth() + 1);
}

export function addMonths(k: MonthKey, n: number): MonthKey {
  const { year, month } = parseMonth(k);
  const idx = year * 12 + (month - 1) + n;
  return monthKey(Math.floor(idx / 12), (idx % 12) + 1);
}

/** Inclusive range from start to end. Empty if end < start. */
export function monthRange(start: MonthKey, end: MonthKey): MonthKey[] {
  const out: MonthKey[] = [];
  for (let k = start; k <= end; k = addMonths(k, 1)) out.push(k);
  return out;
}

/** The visible forecast window: this month through December of next year. */
export function visibleWindow(now = new Date()): MonthKey[] {
  return monthRange(currentMonth(now), monthKey(now.getFullYear() + 1, 12));
}

export function monthLabel(k: MonthKey): string {
  return NAMES[parseMonth(k).month - 1];
}

/** Consecutive runs of months per year, for the year header row. */
export function groupByYear(months: MonthKey[]): { year: number; count: number }[] {
  const out: { year: number; count: number }[] = [];
  for (const k of months) {
    const { year } = parseMonth(k);
    const last = out[out.length - 1];
    if (last && last.year === year) last.count++;
    else out.push({ year, count: 1 });
  }
  return out;
}
