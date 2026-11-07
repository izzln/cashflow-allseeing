import { parseDate } from './dates';
import { isErr, type CellValue, type Evaluator } from './evaluate';
import { parseNumber } from './format';
import { newEntry, newRow, type CashTable, type LedgerTable, type Table } from './model';
import type { MonthKey } from './months';

/** Cell position inside a table. r: body rows, then footer rows. c: column. */
export interface Pos {
  r: number;
  c: number;
}

export interface Range {
  a: Pos;
  b: Pos;
}

export const FIXED_FOOTERS = [
  { id: '__cashflow', label: 'Net cash flow' },
  { id: '__balance', label: 'Balance' },
] as const;

export const LEDGER_COLS = [
  { key: 'date', label: 'Date', width: 112, align: 'left' },
  { key: 'amount', label: 'Amount', width: 120, align: 'right' },
  { key: 'category', label: 'Category', width: 150, align: 'left' },
  { key: 'note', label: 'Note', width: 240, align: 'left' },
] as const;

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

export function selectionStats(values: (string | number | null)[]) {
  const nums = values.filter((v): v is number => typeof v === 'number');
  const sum = nums.reduce((a, b) => a + b, 0);
  return { count: nums.length, sum, avg: nums.length ? sum / nums.length : 0 };
}

/**
 * What the editor needs to know about one table, whatever its kind.
 * `set`/`clear`/`insertBodyRow` mutate the table: call them inside app.change().
 */
export interface GridModel {
  rows: number;
  cols: number;
  /** Rows 0..body-1 are the table's own items (rows or entries); the rest are footers. */
  body: number;
  rowId(r: number): string;
  colKey(c: number): string;
  /** For copy, stats and display. Errors read as null. */
  value(p: Pos): string | number | null;
  /** Text to start the editor with. */
  raw(p: Pos): string;
  /** true, or a message explaining why the cell can't be edited. */
  editable(p: Pos): true | string;
  /** Returns false when the text isn't valid for the cell. */
  set(p: Pos, text: string): boolean;
  insertBodyRow(at: number): void;
  alignRight(c: number): boolean;
}

const num = (v: CellValue): number | null => (isErr(v) ? null : v);

export function cashModel(t: CashTable, months: MonthKey[], ev: Evaluator): GridModel {
  const nb = t.rows.length;
  const nf = FIXED_FOOTERS.length;
  const footerId = (r: number) => (r - nb < nf ? FIXED_FOOTERS[r - nb].id : t.footers[r - nb - nf].id);
  return {
    rows: nb + nf + t.footers.length,
    cols: months.length + 1,
    body: nb,
    rowId: (r) => (r < nb ? t.rows[r].id : footerId(r)),
    colKey: (c) => (c === 0 ? 'label' : months[c - 1]),
    value(p) {
      if (p.r < nb) {
        const row = t.rows[p.r];
        return p.c === 0 ? row.label : num(ev.row(t, row, months[p.c - 1]));
      }
      const f = p.r - nb;
      if (f < nf) {
        if (p.c === 0) return FIXED_FOOTERS[f].label;
        const m = months[p.c - 1];
        return num(f === 0 ? ev.cashFlow(t, m) : ev.balance(t, m));
      }
      const fr = t.footers[f - nf];
      return p.c === 0 ? fr.label : num(ev.footer(t, fr, months[p.c - 1]));
    },
    raw(p) {
      if (p.r >= nb) return p.c === 0 ? (t.footers[p.r - nb - nf]?.label ?? '') : '';
      const row = t.rows[p.r];
      if (p.c === 0) return row.label;
      const v = row.values[months[p.c - 1]];
      return v === undefined ? '' : String(v);
    },
    editable(p) {
      if (p.r < nb) {
        if (p.c > 0 && t.rows[p.r].formula !== undefined) {
          return 'This row is a formula. Edit the formula in the panel.';
        }
        return true;
      }
      if (p.r - nb < nf) return 'Net cash flow and Balance are calculated.';
      return p.c === 0 ? true : 'Footer rows are formulas. Edit the formula in the panel.';
    },
    set(p, text) {
      if (p.r >= nb) {
        const fr = t.footers[p.r - nb - nf];
        if (fr && p.c === 0) fr.label = text.trim();
        return true;
      }
      const row = t.rows[p.r];
      if (p.c === 0) {
        row.label = text.trim();
        return true;
      }
      if (row.formula !== undefined) return true;
      const n = parseNumber(text);
      if (n === undefined) return false;
      const m = months[p.c - 1];
      // On a source row, clearing a cell goes back to the source's number.
      if (n === null) delete row.values[m];
      else row.values[m] = n;
      return true;
    },
    insertBodyRow: (at) => void t.rows.splice(at, 0, newRow()),
    alignRight: (c) => c > 0,
  };
}

export function ledgerModel(t: LedgerTable, now = new Date()): GridModel {
  const nb = t.entries.length;
  return {
    rows: nb + 1,
    cols: LEDGER_COLS.length,
    body: nb,
    rowId: (r) => (r < nb ? t.entries[r].id : '__total'),
    colKey: (c) => LEDGER_COLS[c].key,
    value(p) {
      if (p.r >= nb) {
        if (p.c === 0) return 'Total';
        if (p.c === 1) return t.entries.reduce((s, e) => Math.round((s + (e.amount ?? 0)) * 100) / 100, 0);
        if (p.c === 2) return `${t.entries.filter((e) => e.date && e.amount !== null).length} entries`;
        return '';
      }
      const e = t.entries[p.r];
      return [e.date, e.amount, e.category, e.note][p.c];
    },
    raw(p) {
      const e = t.entries[p.r];
      if (!e) return '';
      return p.c === 1 ? (e.amount === null ? '' : String(e.amount)) : [e.date, '', e.category, e.note][p.c];
    },
    editable: (p) => (p.r < nb ? true : 'The total is calculated.'),
    set(p, text) {
      const e = t.entries[p.r];
      if (!e) return true;
      if (p.c === 0) {
        if (!text.trim()) {
          e.date = '';
          return true;
        }
        const d = parseDate(text, 'mdy', now.getFullYear());
        if (!d) return false;
        e.date = d;
      } else if (p.c === 1) {
        const n = parseNumber(text);
        if (n === undefined) return false;
        e.amount = n;
      } else if (p.c === 2) {
        e.category = text.trim();
      } else {
        e.note = text.trim();
      }
      return true;
    },
    insertBodyRow: (at) => void t.entries.splice(at, 0, newEntry()),
    alignRight: (c) => c === 1,
  };
}

export function gridModel(t: Table, months: MonthKey[], ev: Evaluator): GridModel {
  return t.kind === 'ledger' ? ledgerModel(t) : cashModel(t, months, ev);
}
