import { evaluate, FormulaError, parseFormula, type Node } from './formula';
import type { CashTable, FooterRow, LedgerTable, Row, RowSource, Workbook } from './model';
import { addMonths, type MonthKey } from './months';

/** What a cell shows: a number, empty, or an error message. */
export type CellValue = number | null | { err: string };

export function isErr(v: CellValue): v is { err: string } {
  return typeof v === 'object' && v !== null;
}

const ALIASES: Record<string, 'cashflow' | 'balance'> = {
  'net cash flow': 'cashflow',
  'cash flow': 'cashflow',
  净现金流: 'cashflow',
  现金流: 'cashflow',
  balance: 'balance',
  余额: 'balance',
};

const norm = (s: string) => s.trim().toLowerCase();

/**
 * Computes every cash-flow cell of a workbook. Create a new one after each change;
 * results are cached inside, so asking for the same cell twice is cheap.
 */
export class Evaluator {
  private cashTables: CashTable[] = [];
  private ledgers = new Map<string, LedgerTable>();
  private memo = new Map<string, number | null | FormulaError>();
  private busy = new Set<string>();
  private parsed = new Map<string, Node | FormulaError>();
  private ledgerSums = new Map<string, Map<MonthKey, number>>();

  constructor(wb: Workbook) {
    for (const s of wb.sheets) {
      for (const t of s.tables) {
        if (t.kind === 'ledger') this.ledgers.set(t.id, t);
        else this.cashTables.push(t);
      }
    }
  }

  // ---------- public, error-safe ----------

  row(t: CashTable, row: Row, m: MonthKey): CellValue {
    return this.safe(() => this.rowNum(t, row, m));
  }

  cashFlow(t: CashTable, m: MonthKey): CellValue {
    return this.safe(() => this.cashFlowNum(t, m));
  }

  balance(t: CashTable, m: MonthKey): CellValue {
    if (m < t.openingMonth) return null;
    return this.safe(() => this.balanceNum(t, m));
  }

  footer(t: CashTable, f: FooterRow, m: MonthKey): CellValue {
    return this.safe(() => this.formulaNum(t, `f:${f.id}`, f.formula, m));
  }

  /** The number a source row would show without manual overrides. */
  sourceValue(source: RowSource, m: MonthKey): CellValue {
    return this.safe(() => this.sourceNum(source, m));
  }

  /** Check a formula without evaluating it; returns an error message or null. */
  check(formula: string): string | null {
    const p = this.parse(formula);
    return p instanceof FormulaError ? p.message : null;
  }

  private safe(fn: () => number | null): CellValue {
    try {
      return fn();
    } catch (e) {
      return { err: e instanceof FormulaError ? e.message : String(e) };
    }
  }

  // ---------- internals (throw FormulaError) ----------

  private cached(key: string, fn: () => number | null): number | null {
    const hit = this.memo.get(key);
    if (hit instanceof FormulaError) throw hit;
    if (hit !== undefined) return hit;
    if (this.busy.has(key)) throw new FormulaError('Circular reference');
    this.busy.add(key);
    try {
      const v = fn();
      this.memo.set(key, v);
      return v;
    } catch (e) {
      const err = e instanceof FormulaError ? e : new FormulaError(String(e));
      this.memo.set(key, err);
      throw err;
    } finally {
      this.busy.delete(key);
    }
  }

  private rowNum(t: CashTable, row: Row, m: MonthKey): number | null {
    return this.cached(`${t.id}|${row.id}|${m}`, () => {
      if (row.formula !== undefined) return this.formulaNum(t, row.id, row.formula, m);
      const manual = row.values[m];
      if (row.source) return manual !== undefined ? manual : this.sourceNum(row.source, m);
      return manual ?? null;
    });
  }

  private cashFlowNum(t: CashTable, m: MonthKey): number {
    return this.cached(`${t.id}|cf|${m}`, () => {
      let sum = 0;
      for (const row of t.rows) {
        try {
          sum += this.rowNum(t, row, m) ?? 0;
        } catch (e) {
          const msg = e instanceof FormulaError ? e.message : String(e);
          throw new FormulaError(`Row "${row.label || 'untitled'}": ${msg}`);
        }
      }
      return sum;
    }) as number;
  }

  private balanceNum(t: CashTable, m: MonthKey): number | null {
    if (m < t.openingMonth) return null;
    // Walk forward from the opening month so long histories don't recurse deeply.
    let k = t.openingMonth;
    let bal = t.openingBalance;
    while (true) {
      const key = `${t.id}|bal|${k}`;
      const hit = this.memo.get(key);
      if (typeof hit === 'number') {
        bal = hit;
      } else {
        bal = this.cached(key, () => bal + this.cashFlowNum(t, k)) as number;
      }
      if (k >= m) return bal;
      k = addMonths(k, 1);
    }
  }

  private parse(src: string): Node | FormulaError {
    let p = this.parsed.get(src);
    if (!p) {
      try {
        p = parseFormula(src);
      } catch (e) {
        p = e instanceof FormulaError ? e : new FormulaError(String(e));
      }
      this.parsed.set(src, p);
    }
    return p;
  }

  private formulaNum(t: CashTable, id: string, src: string, m: MonthKey): number {
    return this.cached(`${t.id}|${id}|${m}|fx`, () => {
      const node = this.parse(src);
      if (node instanceof FormulaError) throw node;
      const v = evaluate(node, {
        ref: (table, row, offset) => this.refNum(t, table, row, addMonths(m, offset)),
      });
      if (!Number.isFinite(v)) throw new FormulaError('Result is not a number');
      return v;
    }) as number;
  }

  private findTable(name: string): CashTable {
    const hits = this.cashTables.filter((x) => norm(x.name) === norm(name));
    if (hits.length === 0) throw new FormulaError(`No table named "${name}"`);
    if (hits.length > 1) throw new FormulaError(`Several tables are named "${name}"`);
    return hits[0];
  }

  /** A reference inside a formula: rows by label, then footer rows, Net cash flow and Balance. */
  private refNum(from: CashTable, tableName: string | null, label: string, m: MonthKey): number {
    const t = tableName === null ? from : this.findTable(tableName);
    const want = norm(label);
    const rows = t.rows.filter((r) => norm(r.label) === want);
    const footers = t.footers.filter((f) => norm(f.label) === want);
    if (rows.length + footers.length > 1) throw new FormulaError(`Several rows are named "${label}"`);
    if (rows.length) return this.rowNum(t, rows[0], m) ?? 0;
    if (footers.length) return this.formulaNum(t, `f:${footers[0].id}`, footers[0].formula, m);
    const alias = ALIASES[want];
    if (alias === 'cashflow') return this.cashFlowNum(t, m);
    if (alias === 'balance') return this.balanceNum(t, m) ?? 0;
    throw new FormulaError(`No row named "${label}"${tableName ? ` in "${t.name}"` : ''}`);
  }

  private sums(source: RowSource): Map<MonthKey, number> {
    const key = JSON.stringify(source);
    let map = this.ledgerSums.get(key);
    if (map) return map;
    const ledger = this.ledgers.get(source.ledgerId);
    if (!ledger) throw new FormulaError('The source ledger was deleted');
    const cats = new Set(source.categories.map(norm));
    const note = norm(source.noteContains);
    map = new Map();
    for (const e of ledger.entries) {
      if (!e.date || e.amount === null) continue;
      if (cats.size && !cats.has(norm(e.category))) continue;
      if (note && !e.note.toLowerCase().includes(note)) continue;
      const k = e.date.slice(0, 7);
      map.set(k, (map.get(k) ?? 0) + (source.flip ? -e.amount : e.amount));
    }
    this.ledgerSums.set(key, map);
    return map;
  }

  private sourceNum(source: RowSource, m: MonthKey): number | null {
    const v = this.sums(source).get(m);
    // Round away floating-point noise from summing many decimals.
    return v === undefined ? null : Math.round(v * 100) / 100;
  }
}
