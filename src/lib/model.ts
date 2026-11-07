import { currentMonth, isMonthKey, type MonthKey } from './months';

/** Where a cash-flow row takes its numbers from: the sum of matching ledger entries per month. */
export interface RowSource {
  ledgerId: string;
  /** Only entries in these categories; empty = all. */
  categories: string[];
  /** Only entries whose note contains this text (case-insensitive); empty = no filter. */
  noteContains: string;
  /** Multiply by −1 (e.g. a ledger that records payments as positive numbers). */
  flip: boolean;
}

export interface Row {
  id: string;
  label: string;
  /**
   * Manual amounts per month (inflows positive, outflows negative).
   * On a source row these are overrides of the source's number.
   */
  values: Record<MonthKey, number>;
  /** If set, the row's numbers come from a ledger. */
  source?: RowSource;
  /** If set, the row is computed by this formula, e.g. `[Sales] * 6%`. */
  formula?: string;
}

/** A computed row shown below Balance; it does not count toward net cash flow. */
export interface FooterRow {
  id: string;
  label: string;
  formula: string;
}

interface TableBase {
  id: string;
  name: string;
  /** Position on the sheet canvas, in pixels (snapped to the grid). */
  x: number;
  y: number;
  /** Style preset per cell, keyed by `${rowId}|${colKey}`. */
  styles: Record<string, string>;
}

/** A month-by-month cash-flow table. */
export interface CashTable extends TableBase {
  kind: 'cashflow';
  /** Balance at the start of openingMonth, before that month's cash flow. */
  openingBalance: number;
  openingMonth: MonthKey;
  rows: Row[];
  footers: FooterRow[];
}

/** One dated amount in a ledger. */
export interface Entry {
  id: string;
  /** 'YYYY-MM-DD', or '' while not filled in. */
  date: string;
  amount: number | null;
  category: string;
  note: string;
}

/** How a CSV/Excel file maps onto ledger columns; saved so re-imports are one click. */
export interface ImportMap {
  hasHeader: boolean;
  /** Column per field: a header name when hasHeader, else a 0-based index as a string. */
  date: string;
  amount: string;
  /** Alternative to amount: separate income and expense columns (amount = income − expense). */
  income: string;
  expense: string;
  category: string;
  note: string;
  flip: boolean;
  sheet: string;
}

/** A list of dated amounts (entered by hand or imported) that cash-flow rows can draw on. */
export interface LedgerTable extends TableBase {
  kind: 'ledger';
  entries: Entry[];
  importMap?: ImportMap;
  /** Name of the last imported file, for the "re-import" hint. */
  importedFrom?: string;
}

export type Table = CashTable | LedgerTable;

export interface Sheet {
  id: string;
  name: string;
  tables: Table[];
}

export interface FileSettings {
  /** How often an open file syncs its remote sources. */
  syncMinutes: number;
}

export interface Workbook {
  schema: 1;
  sheets: Sheet[];
  settings: FileSettings;
}

export const GRID = 20;
export const DEFAULT_SETTINGS: FileSettings = { syncMinutes: 15 };

export function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

export function newRow(label = ''): Row {
  return { id: uid(), label, values: {} };
}

export function newEntry(): Entry {
  return { id: uid(), date: '', amount: null, category: '', note: '' };
}

export function newTable(name: string, x = GRID * 2, y = GRID * 2): CashTable {
  return {
    kind: 'cashflow',
    id: uid(),
    name,
    x,
    y,
    openingBalance: 0,
    openingMonth: currentMonth(),
    rows: ['', '', '', ''].map(() => newRow()),
    footers: [],
    styles: {},
  };
}

export function newLedger(name: string, x = GRID * 2, y = GRID * 2): LedgerTable {
  return {
    kind: 'ledger',
    id: uid(),
    name,
    x,
    y,
    entries: [0, 1, 2].map(() => newEntry()),
    styles: {},
  };
}

export function newSheet(name: string): Sheet {
  return { id: uid(), name, tables: [newTable('Table 1')] };
}

export function starterWorkbook(): Workbook {
  const t = newTable('Main account');
  t.rows = ['Sales receipts', 'Payroll', 'Rent', 'Suppliers', 'Taxes'].map((l) => newRow(l));
  return {
    schema: 1,
    sheets: [{ id: uid(), name: 'Operating', tables: [t] }],
    settings: { ...DEFAULT_SETTINGS },
  };
}

/** Items in a table's body, in order: cash-flow rows or ledger entries. */
export function bodyItems(t: Table): { id: string }[] {
  return t.kind === 'ledger' ? t.entries : t.rows;
}

// ---------- loading ----------

const str = (v: unknown, d = '') => (typeof v === 'string' ? v : v == null ? d : String(v));
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || 0);
const arr = (v: unknown): any[] => (Array.isArray(v) ? v : []);

function normStyles(v: unknown): Record<string, string> {
  return Object.fromEntries(
    Object.entries((v as object) ?? {}).filter(([, s]) => typeof s === 'string'),
  ) as Record<string, string>;
}

function normSource(s: any): RowSource | undefined {
  if (!s || typeof s !== 'object' || typeof s.ledgerId !== 'string') return undefined;
  return {
    ledgerId: s.ledgerId,
    categories: arr(s.categories).map((c) => str(c)),
    noteContains: str(s.noteContains),
    flip: !!s.flip,
  };
}

function normRow(r: any): Row {
  const row: Row = {
    id: str(r?.id) || uid(),
    label: str(r?.label),
    values: Object.fromEntries(
      Object.entries(r?.values ?? {}).filter(
        ([k, v]) => isMonthKey(k) && typeof v === 'number' && Number.isFinite(v),
      ),
    ) as Record<string, number>,
  };
  const source = normSource(r?.source);
  if (source) row.source = source;
  if (typeof r?.formula === 'string') row.formula = r.formula;
  return row;
}

function normImportMap(m: any): ImportMap | undefined {
  if (!m || typeof m !== 'object') return undefined;
  return {
    hasHeader: m.hasHeader !== false,
    date: str(m.date),
    amount: str(m.amount),
    income: str(m.income),
    expense: str(m.expense),
    category: str(m.category),
    note: str(m.note),
    flip: !!m.flip,
    sheet: str(m.sheet),
  };
}

function normTable(t: any): Table {
  const base = {
    id: str(t?.id) || uid(),
    name: str(t?.name, 'Table'),
    x: num(t?.x),
    y: num(t?.y),
    styles: normStyles(t?.styles),
  };
  if (t?.kind === 'ledger') {
    const l: LedgerTable = {
      ...base,
      kind: 'ledger',
      entries: arr(t.entries).map((e) => ({
        id: str(e?.id) || uid(),
        date: /^\d{4}-\d{2}-\d{2}$/.test(e?.date) ? e.date : '',
        amount: typeof e?.amount === 'number' && Number.isFinite(e.amount) ? e.amount : null,
        category: str(e?.category),
        note: str(e?.note),
      })),
    };
    const im = normImportMap(t.importMap);
    if (im) l.importMap = im;
    if (typeof t.importedFrom === 'string') l.importedFrom = t.importedFrom;
    return l;
  }
  return {
    ...base,
    kind: 'cashflow',
    openingBalance: num(t?.openingBalance),
    openingMonth: isMonthKey(t?.openingMonth) ? t.openingMonth : currentMonth(),
    rows: arr(t?.rows).map(normRow),
    footers: arr(t?.footers).map((f) => ({
      id: str(f?.id) || uid(),
      label: str(f?.label),
      formula: str(f?.formula),
    })),
  };
}

/** Accept a parsed JSON value only if it looks like a workbook; fill missing fields. */
export function normalizeWorkbook(raw: unknown): Workbook | null {
  if (!raw || typeof raw !== 'object') return null;
  const wb = raw as any;
  if (!Array.isArray(wb.sheets) || wb.sheets.length === 0) return null;
  const minutes = Number(wb.settings?.syncMinutes);
  return {
    schema: 1,
    sheets: wb.sheets.map((s: any) => ({
      id: str(s?.id) || uid(),
      name: str(s?.name, 'Sheet'),
      tables: arr(s?.tables).map(normTable),
    })),
    settings: {
      syncMinutes: Number.isFinite(minutes) && minutes >= 1 ? Math.round(minutes) : DEFAULT_SETTINGS.syncMinutes,
    },
  };
}
