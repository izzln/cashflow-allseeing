import { detectDateOrder, parseDate } from '../dates';
import { parseNumber } from '../format';
import { uid, type Entry, type ImportMap } from '../model';

export type Field = 'date' | 'amount' | 'income' | 'expense' | 'category' | 'note';

export const FIELD_LABELS: Record<Field, string> = {
  date: 'Date',
  amount: 'Amount',
  income: 'Income (money in)',
  expense: 'Expense (money out)',
  category: 'Category',
  note: 'Note',
};

const SYNONYMS: Record<Field, string[]> = {
  date: ['日期', '交易日期', '记账日期', '发生日期', '入账日期', '付款日期', '收款日期', '计划日期', '到期日', '时间', '交易时间', 'date', 'transaction date', 'posting date', 'value date', 'booking date'],
  amount: ['金额', '发生额', '交易金额', '收支金额', '净额', '金额(元)', 'amount', 'net amount', 'value', 'sum'],
  income: ['收入', '收入金额', '贷方', '贷方金额', '贷方发生额', '收款', '收款金额', '存入', 'credit', 'inflow', 'deposit', 'money in', 'income'],
  expense: ['支出', '支出金额', '借方', '借方金额', '借方发生额', '付款', '付款金额', '支取', 'debit', 'outflow', 'withdrawal', 'money out', 'expense'],
  category: ['类别', '分类', '类型', '科目', '会计科目', '项目', '收支类型', '收支项目', '用途', 'category', 'type', 'account', 'class'],
  note: ['备注', '摘要', '说明', '描述', '附言', '对方户名', '对方名称', '对方账户名称', '交易对方', 'note', 'notes', 'memo', 'description', 'remarks', 'payee', 'counterparty', 'details'],
};

const clean = (s: string) => s.trim().toLowerCase().replace(/[\s:：_]+/g, ' ').replace(/[（(].*?[)）]/g, '').trim();

/** Guess which column holds which field from the header row. */
export function guessMap(header: string[]): Pick<ImportMap, Field> {
  const used = new Set<number>();
  const pick = (field: Field): string => {
    const names = SYNONYMS[field].map(clean);
    const cols = header.map(clean);
    let i = cols.findIndex((c, j) => !used.has(j) && names.includes(c));
    if (i < 0) i = cols.findIndex((c, j) => !used.has(j) && c !== '' && names.some((n) => c.includes(n)));
    if (i < 0) return '';
    used.add(i);
    return header[i];
  };
  // Order matters: specific fields before broad ones ("收入金额" is income, not amount).
  const income = pick('income');
  const expense = pick('expense');
  const date = pick('date');
  const amount = pick('amount');
  const category = pick('category');
  const note = pick('note');
  return income && expense ? { date, amount: '', income, expense, category, note } : { date, amount: amount || income || expense, income: '', expense: '', category, note };
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
  /** Fields the mapping names but the file does not have. */
  missing: string[];
}

/** Turn spreadsheet rows into ledger entries. Rows without a valid date or amount are skipped. */
export function buildEntries(rows: string[][], map: ImportMap): BuildResult {
  const header = map.hasHeader ? (rows[0] ?? []) : [];
  const data = map.hasHeader ? rows.slice(1) : rows;
  const col = (f: Field) => columnOf(map[f], header, map.hasHeader);
  const missing = (['date', 'amount', 'income', 'expense', 'category', 'note'] as Field[])
    .filter((f) => map[f] && col(f) < 0)
    .map((f) => map[f]);
  const cDate = col('date');
  const cAmount = col('amount');
  const cIncome = col('income');
  const cExpense = col('expense');
  const cCat = col('category');
  const cNote = col('note');
  const order = detectDateOrder(data.map((r) => r[cDate] ?? ''));
  const entries: Entry[] = [];
  let skipped = 0;
  for (const r of data) {
    const date = cDate >= 0 ? parseDate(r[cDate] ?? '', order) : null;
    let amount: number | null | undefined = null;
    if (cAmount >= 0) {
      amount = parseNumber(r[cAmount] ?? '');
    } else if (cIncome >= 0 || cExpense >= 0) {
      const inc = cIncome >= 0 ? parseNumber(r[cIncome] ?? '') : null;
      const exp = cExpense >= 0 ? parseNumber(r[cExpense] ?? '') : null;
      if (inc === undefined || exp === undefined) amount = undefined;
      else if (inc === null && exp === null) amount = null;
      else amount = (inc ?? 0) - Math.abs(exp ?? 0);
    }
    if (!date || amount === null || amount === undefined) {
      skipped++;
      continue;
    }
    entries.push({
      id: uid(),
      date,
      amount: map.flip ? -amount : amount,
      category: cCat >= 0 ? (r[cCat] ?? '').trim() : '',
      note: cNote >= 0 ? (r[cNote] ?? '').trim() : '',
    });
  }
  return { entries, skipped, missing };
}
