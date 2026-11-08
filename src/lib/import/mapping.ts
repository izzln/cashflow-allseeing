import { detectDateOrder, parseDate } from '../dates';
import { parseNumber } from '../format';
import { parseBool } from '../columns';
import { uid, type CellData, type Entry, type ImportMap, type Column } from '../model';

type Role = 'date' | 'amount' | 'income' | 'expense' | 'category' | 'note';

const SYNONYMS: Record<Role, string[]> = {
  date: ['日期', '交易日期', '记账日期', '发生日期', '入账日期', '付款日期', '收款日期', '计划日期', '到期日', '时间', '交易时间', 'date', 'transaction date', 'posting date', 'value date', 'booking date'],
  amount: ['金额', '发生额', '交易金额', '收支金额', '净额', '金额(元)', 'amount', 'net amount', 'value', 'sum'],
  income: ['收入', '收入金额', '贷方', '贷方金额', '贷方发生额', '收款', '收款金额', '存入', 'credit', 'inflow', 'deposit', 'money in', 'income'],
  expense: ['支出', '支出金额', '借方', '借方金额', '借方发生额', '付款', '付款金额', '支取', 'debit', 'outflow', 'withdrawal', 'money out', 'expense'],
  category: ['类别', '分类', '类型', '科目', '会计科目', '项目', '收支类型', '收支项目', '用途', 'category', 'type', 'account', 'class'],
  note: ['备注', '摘要', '说明', '描述', '附言', '对方户名', '对方名称', '对方账户名称', '交易对方', 'note', 'notes', 'memo', 'description', 'remarks', 'payee', 'counterparty', 'details'],
};

const clean = (s: string) => s.trim().toLowerCase().replace(/[\s:：_]+/g, ' ').replace(/[（(].*?[)）]/g, '').trim();

/** The dataTable's main number column: the one money-in/money-out columns can fill. */
export function amountColumn(columns: Column[]): Column | undefined {
  return columns.find((c) => c.id === 'amount' && c.type === 'number') ?? columns.find((c) => c.type === 'number');
}

/** Guess which file column feeds which dataTable column, from the header row. */
export function guessMap(header: string[], columns: Column[]): Pick<ImportMap, 'cols' | 'split'> {
  const used = new Set<number>();
  const cols = header.map(clean);
  const pick = (names: string[]): string => {
    const want = names.map(clean);
    let i = cols.findIndex((c, j) => !used.has(j) && want.includes(c));
    if (i < 0) i = cols.findIndex((c, j) => !used.has(j) && c !== '' && want.some((n) => n && c.includes(n)));
    if (i < 0) return '';
    used.add(i);
    return header[i];
  };
  const out: Record<string, string> = {};
  let split: ImportMap['split'] = null;
  const amount = amountColumn(columns);
  // Specific names first: "收入金额" is income, not amount.
  if (amount) {
    const income = pick(SYNONYMS.income);
    const expense = pick(SYNONYMS.expense);
    if (income && expense) split = { col: amount.id, income, expense };
    else if (income || expense) out[amount.id] = income || expense;
  }
  // Columns named exactly like a dataTable column win; then the built-in synonyms.
  for (const c of columns) {
    if (c.type === 'files' || out[c.id] || split?.col === c.id) continue;
    const exact = pick([c.name]);
    if (exact) out[c.id] = exact;
  }
  for (const c of columns) {
    if (c.type === 'files' || out[c.id] || split?.col === c.id) continue;
    const role = (['date', 'amount', 'category', 'note'] as Role[]).find((r) => r === c.id);
    const got = role ? pick(SYNONYMS[role]) : c.type === 'date' ? pick(SYNONYMS.date) : '';
    if (got) out[c.id] = got;
  }
  return { cols: out, split };
}

/** Column index for a mapping value (a header name, or an index when there is no header). */
export function columnOf(value: string, header: string[], hasHeader: boolean): number {
  if (!value) return -1;
  if (!hasHeader) return /^\d+$/.test(value) ? Number(value) : -1;
  const exact = header.indexOf(value);
  return exact >= 0 ? exact : header.findIndex((h) => h.trim() === value.trim());
}

export interface BuildResult {
  entries: Entry[];
  skipped: number;
  /** File columns the mapping names but the file does not have. */
  missing: string[];
}

/**
 * Turn spreadsheet rows into dataTable entries. A row is skipped when the dataTable's
 * first date column or main number column is mapped but has no valid value.
 */
export function buildEntries(rows: string[][], map: ImportMap, columns: Column[]): BuildResult {
  const header = map.hasHeader ? (rows[0] ?? []) : [];
  const data = map.hasHeader ? rows.slice(1) : rows;
  const idx = (v: string) => columnOf(v, header, map.hasHeader);
  const missing = [...Object.values(map.cols), map.split?.income ?? '', map.split?.expense ?? '']
    .filter((v) => v && idx(v) < 0);
  const mapped = columns
    .filter((c) => c.type !== 'files' && (map.cols[c.id] || map.split?.col === c.id))
    .map((c) => ({ col: c, i: idx(map.cols[c.id] ?? '') }));
  const firstDate = mapped.find((m) => m.col.type === 'date');
  const mainNumber = map.split ? mapped.find((m) => m.col.id === map.split!.col) : mapped.find((m) => m.col.type === 'number');
  const orders = new Map(mapped.filter((m) => m.col.type === 'date').map((m) => [m.col.id, detectDateOrder(data.map((r) => r[m.i] ?? ''))]));
  const iIn = map.split ? idx(map.split.income) : -1;
  const iOut = map.split ? idx(map.split.expense) : -1;

  const entries: Entry[] = [];
  let skipped = 0;
  for (const r of data) {
    const cells: Record<string, CellData> = {};
    let bad = false;
    for (const { col, i } of mapped) {
      let v: CellData | null | undefined;
      if (map.split?.col === col.id) {
        const inc = iIn >= 0 ? parseNumber(r[iIn] ?? '') : null;
        const exp = iOut >= 0 ? parseNumber(r[iOut] ?? '') : null;
        v = inc === undefined || exp === undefined ? undefined : inc === null && exp === null ? null : (inc ?? 0) - Math.abs(exp ?? 0);
      } else {
        const text = (r[i] ?? '').trim();
        if (col.type === 'date') v = text ? parseDate(text, orders.get(col.id)) ?? undefined : null;
        else if (col.type === 'number') v = parseNumber(text);
        else if (col.type === 'checkbox') v = text ? parseBool(text) || null : null;
        else v = text || null;
      }
      if (typeof v === 'number' && col.type === 'number' && map.flip) v = -v;
      const required = col === firstDate?.col || col === mainNumber?.col;
      if (v === null || v === undefined) {
        if (required) bad = true;
        continue;
      }
      cells[col.id] = v;
    }
    if (bad || Object.keys(cells).length === 0) {
      skipped++;
      continue;
    }
    entries.push({ id: uid(), cells });
  }
  return { entries, skipped, missing };
}
