/** Dates in ledgers are stored as 'YYYY-MM-DD'. */

export type DateOrder = 'ymd' | 'mdy' | 'dmy';

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function valid(y: number, m: number, d: number): string | null {
  if (y < 1900 || y > 2200 || m < 1 || m > 12 || d < 1) return null;
  const last = new Date(y, m, 0).getDate();
  return d > last ? null : `${y}-${pad(m)}-${pad(d)}`;
}

/** Excel stores dates as days since 1899-12-30 (1900 date system). */
export function excelSerialToDate(serial: number): string | null {
  if (!Number.isFinite(serial) || serial < 1 || serial > 200000) return null;
  const ms = Math.round((Math.floor(serial) - 25569) * 86400 * 1000);
  const d = new Date(ms);
  return valid(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

const fullWidth = (s: string) =>
  s.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).replace(/[／－．]/g, (c) => ({ '／': '/', '－': '-', '．': '.' })[c]!);

/**
 * Parse a date typed by hand or found in a CSV/Excel file.
 * Handles 2026-11-07, 2026/11/7, 2026.11.07, 2026年11月7日, 20261107,
 * 11/7/2026 (order decides M/D vs D/M), Excel serial numbers, and
 * month-day only (11-7, 11月7日) using defaultYear.
 */
export function parseDate(input: string, order: DateOrder = 'mdy', defaultYear?: number): string | null {
  const s = fullWidth(input.trim());
  if (!s) return null;
  let m = /^(\d{4})\s*[-/.年]\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})\s*日?(?:[\sT].*)?$/.exec(s);
  if (m) return valid(+m[1], +m[2], +m[3]);
  m = /^(\d{4})(\d{2})(\d{2})$/.exec(s);
  if (m) return valid(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})(?:[\sT].*)?$/.exec(s);
  if (m) {
    let y = +m[3];
    if (y < 100) y += 2000;
    return order === 'dmy' ? valid(y, +m[2], +m[1]) : valid(y, +m[1], +m[2]);
  }
  m = /^(\d{1,2})\s*[-/.月]\s*(\d{1,2})\s*日?$/.exec(s);
  if (m && defaultYear) {
    return order === 'dmy' ? valid(defaultYear, +m[2], +m[1]) : valid(defaultYear, +m[1], +m[2]);
  }
  if (/^\d+(\.\d+)?$/.test(s)) {
    const n = Number(s);
    if (n >= 20000 && n <= 80000) return excelSerialToDate(n);
  }
  return null;
}

/** Decide whether ambiguous dates like 03/04/2026 are month-first or day-first. */
export function detectDateOrder(values: string[]): DateOrder {
  let dayFirst = false;
  let monthFirst = false;
  for (const v of values) {
    const m = /^(\d{1,2})[-/.](\d{1,2})[-/.]\d{2,4}/.exec(fullWidth(v.trim()));
    if (!m) continue;
    if (+m[1] > 12) dayFirst = true;
    if (+m[2] > 12) monthFirst = true;
  }
  return dayFirst && !monthFirst ? 'dmy' : 'mdy';
}
