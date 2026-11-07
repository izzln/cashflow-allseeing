import { currentMonth, isMonthKey, type MonthKey } from './months';

export interface Row {
  id: string;
  label: string;
  /** Amount per month. Inflows are positive, outflows negative. */
  values: Record<MonthKey, number>;
}

export interface Table {
  id: string;
  name: string;
  /** Position on the sheet canvas, in pixels (snapped to the grid). */
  x: number;
  y: number;
  /** Balance at the start of openingMonth, before that month's cash flow. */
  openingBalance: number;
  openingMonth: MonthKey;
  rows: Row[];
  /** Style preset per cell, keyed by `${rowId}|${colKey}` (colKey is 'label' or a month). */
  styles: Record<string, string>;
}

export interface Sheet {
  id: string;
  name: string;
  tables: Table[];
}

export interface Workbook {
  schema: 1;
  sheets: Sheet[];
}

export const GRID = 20;

export function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

export function newRow(label = ''): Row {
  return { id: uid(), label, values: {} };
}

export function newTable(name: string, x = GRID * 2, y = GRID * 2): Table {
  return {
    id: uid(),
    name,
    x,
    y,
    openingBalance: 0,
    openingMonth: currentMonth(),
    rows: ['', '', '', ''].map(() => newRow()),
    styles: {},
  };
}

export function newSheet(name: string): Sheet {
  return { id: uid(), name, tables: [newTable('Table 1')] };
}

export function starterWorkbook(): Workbook {
  const t = newTable('Main account');
  t.rows = ['Sales receipts', 'Payroll', 'Rent', 'Suppliers', 'Taxes'].map((l) => newRow(l));
  return { schema: 1, sheets: [{ id: uid(), name: 'Operating', tables: [t] }] };
}

/** Accept a parsed JSON value only if it looks like a workbook; fill missing fields. */
export function normalizeWorkbook(raw: unknown): Workbook | null {
  if (!raw || typeof raw !== 'object') return null;
  const wb = raw as Partial<Workbook>;
  if (!Array.isArray(wb.sheets) || wb.sheets.length === 0) return null;
  const sheets: Sheet[] = wb.sheets.map((s: any) => ({
    id: String(s?.id ?? uid()),
    name: String(s?.name ?? 'Sheet'),
    tables: (Array.isArray(s?.tables) ? s.tables : []).map((t: any) => ({
      id: String(t?.id ?? uid()),
      name: String(t?.name ?? 'Table'),
      x: Number(t?.x) || 0,
      y: Number(t?.y) || 0,
      openingBalance: Number(t?.openingBalance) || 0,
      openingMonth: isMonthKey(t?.openingMonth) ? t.openingMonth : currentMonth(),
      rows: (Array.isArray(t?.rows) ? t.rows : []).map((r: any) => ({
        id: String(r?.id ?? uid()),
        label: String(r?.label ?? ''),
        values: Object.fromEntries(
          Object.entries(r?.values ?? {}).filter(
            ([k, v]) => isMonthKey(k) && typeof v === 'number' && Number.isFinite(v),
          ),
        ) as Record<string, number>,
      })),
      styles: Object.fromEntries(
        Object.entries(t?.styles ?? {}).filter(([, v]) => typeof v === 'string'),
      ) as Record<string, string>,
    })),
  }));
  return { schema: 1, sheets };
}
