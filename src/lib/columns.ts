import { parseDate } from './dates';
import { formatNumber, parseNumber } from './format';
import type { Attachment, CellData, ColumnType, Entry, Filter, Column, DataTable } from './model';

export const COLUMN_TYPE_LABELS: Record<ColumnType, string> = {
  date: 'Date',
  number: 'Number',
  text: 'Text',
  checkbox: 'Checkbox',
  files: 'Files',
};

const TRUE_WORDS = new Set(['true', 'yes', 'y', '1', 'x', '✓', '✔', '☑', '是', '对', '已', 'checked']);
const FALSE_WORDS = new Set(['false', 'no', 'n', '0', '', '☐', '否', '不', 'unchecked']);

/** Checkbox text: true / false, or undefined when it's neither. */
export function parseBool(text: string): boolean | undefined {
  const t = text.trim().toLowerCase();
  if (TRUE_WORDS.has(t)) return true;
  if (FALSE_WORDS.has(t)) return false;
  return undefined;
}

/**
 * Parse typed or pasted text for a column. Returns null to clear the cell,
 * undefined when the text isn't valid for the column type.
 */
export function parseCell(type: ColumnType, text: string, now = new Date()): CellData | null | undefined {
  const t = text.trim();
  switch (type) {
    case 'date':
      if (!t) return null;
      return parseDate(t, 'mdy', now.getFullYear()) ?? undefined;
    case 'number': {
      const n = parseNumber(t);
      return n === undefined ? undefined : n;
    }
    case 'checkbox': {
      const b = parseBool(t);
      return b === undefined ? undefined : b ? true : null;
    }
    case 'files':
      return undefined; // files are added through the attachments popover, not typed
    default:
      return t === '' ? null : t;
  }
}

/** Raw value for copy and stats: numbers stay numbers. */
export function cellValue(type: ColumnType, v: CellData | undefined): string | number | null {
  if (v === undefined) return type === 'checkbox' ? 'FALSE' : null;
  if (type === 'checkbox') return v === true ? 'TRUE' : 'FALSE';
  if (type === 'files') return (v as Attachment[]).map((a) => a.name).join(', ');
  return v as string | number;
}

/** Text shown in the grid. */
export function cellDisplay(type: ColumnType, v: CellData | undefined): string {
  if (v === undefined) return '';
  if (type === 'number') return formatNumber(v as number);
  if (type === 'files') return (v as Attachment[]).map((a) => a.name).join(', ');
  if (type === 'checkbox') return '';
  return String(v);
}

/** Text to start the cell editor with. */
export function cellRaw(type: ColumnType, v: CellData | undefined): string {
  if (v === undefined || type === 'files' || type === 'checkbox') return '';
  return String(v);
}

/** Convert a value when a column changes type; undefined = can't keep it. */
export function convertCell(from: ColumnType, to: ColumnType, v: CellData): CellData | undefined {
  if (from === to) return v;
  if (to === 'files' || from === 'files') return undefined;
  const text = from === 'checkbox' ? (v ? 'true' : '') : String(v);
  const out = parseCell(to, text);
  return out === null ? undefined : out;
}

export function firstColumnOf(l: DataTable, type: ColumnType): Column | undefined {
  return l.columns.find((c) => c.type === type);
}

const norm = (s: string) => s.trim().toLowerCase();

export function matchesFilters(e: Entry, filters: Filter[]): boolean {
  for (const f of filters) {
    const v = e.cells[f.col];
    if (f.op === 'checked' && v !== true) return false;
    if (f.op === 'unchecked' && v === true) return false;
    if (f.op === 'in' && f.values.length) {
      const set = new Set(f.values.map(norm));
      if (!set.has(norm(typeof v === 'string' || typeof v === 'number' ? String(v) : ''))) return false;
    }
    if (f.op === 'contains' && f.text.trim()) {
      const text = Array.isArray(v) ? v.map((a) => a.name).join(' ') : v === undefined ? '' : String(v);
      if (!text.toLowerCase().includes(norm(f.text))) return false;
    }
  }
  return true;
}

/** Distinct values of a text column, most used first. */
export function distinctValues(l: DataTable, colId: string): { name: string; count: number }[] {
  const counts = new Map<string, { name: string; count: number }>();
  for (const e of l.entries) {
    const v = e.cells[colId];
    if (typeof v !== 'string' || !v.trim()) continue;
    const k = norm(v);
    const hit = counts.get(k);
    if (hit) hit.count++;
    else counts.set(k, { name: v.trim(), count: 1 });
  }
  return [...counts.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

/** A dataTable column id that isn't taken yet. */
export function newColumnId(l: DataTable): string {
  let i = l.columns.length + 1;
  while (l.columns.some((c) => c.id === `c${i}`)) i++;
  return `c${i}`;
}
