import { currentMonth, isMonthKey, type MonthKey } from './months';

/** Only ledger entries that pass every filter count. */
export interface Filter {
  /** Ledger column id. */
  col: string;
  /** in: the cell equals one of `values` (text columns); contains: includes `text`; checked/unchecked: checkbox columns. */
  op: 'in' | 'contains' | 'checked' | 'unchecked';
  values: string[];
  text: string;
}

/** A whole cash-flow row from a ledger: each month = sum of the amount column for entries dated in that month. */
export interface RowSource {
  ledgerId: string;
  dateCol: string;
  amountCol: string;
  filters: Filter[];
  /** Multiply by −1 (e.g. a ledger that records payments as positive numbers). */
  flip: boolean;
}

/** One cash-flow cell from a ledger: the total of one number column over the matching entries (any date). */
export interface CellSource {
  ledgerId: string;
  col: string;
  filters: Filter[];
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
  /** Cells that show a ledger column total, keyed by `${rowId}|${month}`. */
  cellSources: Record<string, CellSource>;
  /** Balance at the start of openingMonth, before that month's cash flow. */
  openingBalance: number;
  openingMonth: MonthKey;
  rows: Row[];
  footers: FooterRow[];
}

export type ColumnType = 'date' | 'number' | 'text' | 'checkbox' | 'files';

export interface LedgerColumn {
  id: string;
  name: string;
  type: ColumnType;
}

/** A file attached to a ledger cell; the bytes are stored separately (see attachments). */
export interface Attachment {
  id: string;
  name: string;
  size: number;
  type: string;
}

/** date: 'YYYY-MM-DD'; number; text; checkbox: boolean; files: list. A missing key is an empty cell. */
export type CellData = string | number | boolean | Attachment[];

/** One row of a ledger. */
export interface Entry {
  id: string;
  cells: Record<string, CellData>;
}

/** How a CSV/Excel file maps onto ledger columns; saved so re-imports are one step. */
export interface ImportMap {
  hasHeader: boolean;
  sheet: string;
  /** Ledger column id → file column (a header name when hasHeader, else a 0-based index as text). */
  cols: Record<string, string>;
  /** Fill one number column from separate money-in and money-out file columns (in − out). */
  split: { col: string; income: string; expense: string } | null;
  /** Multiply imported numbers by −1. */
  flip: boolean;
}

/** A list of dated amounts (entered by hand or imported) that cash-flow rows can draw on. */
export interface LedgerTable extends TableBase {
  kind: 'ledger';
  columns: LedgerColumn[];
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
  return { id: uid(), cells: {} };
}

/** The columns a new ledger starts with. Fixed ids keep imports and sources simple. */
export function defaultColumns(): LedgerColumn[] {
  return [
    { id: 'date', name: 'Date', type: 'date' },
    { id: 'amount', name: 'Amount', type: 'number' },
    { id: 'category', name: 'Category', type: 'text' },
    { id: 'note', name: 'Note', type: 'text' },
  ];
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
    cellSources: {},
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
    columns: defaultColumns(),
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

function normFilters(v: unknown): Filter[] {
  return arr(v)
    .filter((f) => f && typeof f.col === 'string')
    .map((f) => ({
      col: f.col,
      op: ['in', 'contains', 'checked', 'unchecked'].includes(f.op) ? f.op : 'in',
      values: arr(f.values).map((x) => str(x)),
      text: str(f.text),
    }));
}

function normSource(s: any): RowSource | undefined {
  if (!s || typeof s !== 'object' || typeof s.ledgerId !== 'string') return undefined;
  const filters = normFilters(s.filters);
  // Earlier versions had fixed category / note filters.
  const cats = arr(s.categories).map((c) => str(c)).filter(Boolean);
  if (cats.length) filters.push({ col: 'category', op: 'in', values: cats, text: '' });
  if (str(s.noteContains)) filters.push({ col: 'note', op: 'contains', values: [], text: str(s.noteContains) });
  return {
    ledgerId: s.ledgerId,
    dateCol: str(s.dateCol, 'date') || 'date',
    amountCol: str(s.amountCol, 'amount') || 'amount',
    filters,
    flip: !!s.flip,
  };
}

function normCellSource(s: any): CellSource | undefined {
  if (!s || typeof s !== 'object' || typeof s.ledgerId !== 'string') return undefined;
  return { ledgerId: s.ledgerId, col: str(s.col, 'amount') || 'amount', filters: normFilters(s.filters), flip: !!s.flip };
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
  const cols: Record<string, string> = {};
  let split: ImportMap['split'] = null;
  if (m.cols && typeof m.cols === 'object') {
    for (const [k, v] of Object.entries(m.cols)) if (typeof v === 'string' && v) cols[k] = v;
    if (m.split && typeof m.split.col === 'string') {
      split = { col: m.split.col, income: str(m.split.income), expense: str(m.split.expense) };
    }
  } else {
    // Earlier versions mapped fixed fields.
    for (const k of ['date', 'amount', 'category', 'note']) if (str(m[k])) cols[k] = str(m[k]);
    if (str(m.income) || str(m.expense)) split = { col: 'amount', income: str(m.income), expense: str(m.expense) };
  }
  return { hasHeader: m.hasHeader !== false, sheet: str(m.sheet), cols, split, flip: !!m.flip };
}

const COLUMN_TYPES = ['date', 'number', 'text', 'checkbox', 'files'];

function normColumns(v: unknown): LedgerColumn[] {
  const seen = new Set<string>();
  const cols = arr(v)
    .filter((c) => c && typeof c.id === 'string' && !seen.has(c.id) && seen.add(c.id))
    .map((c) => ({ id: c.id, name: str(c.name), type: (COLUMN_TYPES.includes(c.type) ? c.type : 'text') as ColumnType }));
  return cols.length ? cols : defaultColumns();
}

function normCell(type: ColumnType, v: unknown): CellData | undefined {
  switch (type) {
    case 'date':
      return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined;
    case 'number':
      return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
    case 'checkbox':
      return v === true ? true : undefined;
    case 'files':
      return Array.isArray(v) && v.length
        ? v
            .filter((a) => a && typeof a.id === 'string')
            .map((a) => ({ id: a.id, name: str(a.name, 'file'), size: num(a.size), type: str(a.type) }))
        : undefined;
    default:
      return typeof v === 'string' && v !== '' ? v : undefined;
  }
}

function normEntry(e: any, columns: LedgerColumn[]): Entry {
  // Earlier versions stored date / amount / category / note directly on the entry.
  const raw = e?.cells && typeof e.cells === 'object' ? e.cells : { date: e?.date, amount: e?.amount, category: e?.category, note: e?.note };
  const cells: Record<string, CellData> = {};
  for (const c of columns) {
    const v = normCell(c.type, raw[c.id]);
    if (v !== undefined) cells[c.id] = v;
  }
  return { id: str(e?.id) || uid(), cells };
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
    const columns = normColumns(t.columns);
    const l: LedgerTable = {
      ...base,
      kind: 'ledger',
      columns,
      entries: arr(t.entries).map((e) => normEntry(e, columns)),
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
    cellSources: Object.fromEntries(
      Object.entries((t?.cellSources as object) ?? {})
        .map(([k, v]) => [k, normCellSource(v)] as const)
        .filter(([k, v]) => /^[^|]+\|\d{4}-\d{2}$/.test(k) && v),
    ) as Record<string, CellSource>,
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
