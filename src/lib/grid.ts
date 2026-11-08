import { isErr, type CellValue, type Evaluator } from './evaluate';
import { parseNumber } from './format';
import { cellRaw, cellValue, parseCell } from './ledger';
import { newEntry, newRow, type CashTable, type ColumnType, type LedgerColumn, type LedgerTable, type Table } from './model';
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

const TYPE_WIDTH: Record<ColumnType, number> = { date: 112, number: 120, text: 160, checkbox: 90, files: 190 };

export function columnWidth(c: LedgerColumn): number {
  return c.id === 'note' && c.type === 'text' ? 240 : TYPE_WIDTH[c.type];
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
  /** What kind of cell this is, so editing can toggle checkboxes or open the files popover. */
  cellType(p: Pos): ColumnType | 'label' | 'calc';
  /** True when clearing the cell would change nothing. */
  isEmpty(p: Pos): boolean;
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
      // Typing (or clearing) replaces a ledger total shown in this cell.
      delete t.cellSources[`${row.id}|${m}`];
      // On a source row, clearing a cell goes back to the source's number.
      if (n === null) delete row.values[m];
      else row.values[m] = n;
      return true;
    },
    insertBodyRow: (at) => void t.rows.splice(at, 0, newRow()),
    alignRight: (c) => c > 0,
    cellType: (p) => (p.c === 0 ? 'label' : p.r < nb && t.rows[p.r].formula === undefined ? 'number' : 'calc'),
    isEmpty(p) {
      if (p.r >= nb) return p.c !== 0 || !(t.footers[p.r - nb - nf]?.label ?? '');
      const row = t.rows[p.r];
      if (p.c === 0) return row.label === '';
      const m = months[p.c - 1];
      return row.values[m] === undefined && !t.cellSources[`${row.id}|${m}`];
    },
  };
}

export function ledgerModel(t: LedgerTable, now = new Date()): GridModel {
  const nb = t.entries.length;
  const cols = t.columns;
  const total = (c: LedgerColumn): string | number => {
    if (c.type === 'number') {
      return t.entries.reduce((s, e) => {
        const v = e.cells[c.id];
        return typeof v === 'number' ? Math.round((s + v) * 100) / 100 : s;
      }, 0);
    }
    if (c.type === 'checkbox') return `${t.entries.filter((e) => e.cells[c.id] === true).length} ✓`;
    return '';
  };
  return {
    rows: nb + 1,
    cols: cols.length,
    body: nb,
    rowId: (r) => (r < nb ? t.entries[r].id : '__total'),
    colKey: (c) => cols[c]?.id ?? '',
    value(p) {
      const col = cols[p.c];
      if (!col) return null;
      if (p.r >= nb) {
        const v = total(col);
        return p.c === 0 && v === '' ? `Total · ${nb}` : v;
      }
      return cellValue(col.type, t.entries[p.r].cells[col.id]);
    },
    raw(p) {
      const col = cols[p.c];
      const e = t.entries[p.r];
      return col && e ? cellRaw(col.type, e.cells[col.id]) : '';
    },
    editable: (p) => (p.r < nb ? true : 'The total row is calculated.'),
    set(p, text) {
      const col = cols[p.c];
      const e = t.entries[p.r];
      if (!col || !e || col.type === 'files') return true;
      const v = parseCell(col.type, text, now);
      if (v === undefined) return false;
      if (v === null) delete e.cells[col.id];
      else e.cells[col.id] = v;
      return true;
    },
    insertBodyRow: (at) => void t.entries.splice(at, 0, newEntry()),
    alignRight: (c) => cols[c]?.type === 'number',
    cellType: (p) => (p.r >= nb ? 'calc' : (cols[p.c]?.type ?? 'text')),
    isEmpty: (p) => p.r >= nb || !cols[p.c] || t.entries[p.r].cells[cols[p.c].id] === undefined,
  };
}

export function gridModel(t: Table, months: MonthKey[], ev: Evaluator): GridModel {
  return t.kind === 'ledger' ? ledgerModel(t) : cashModel(t, months, ev);
}
