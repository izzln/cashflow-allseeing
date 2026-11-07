import { toHTML, toTSV, parseTSV } from './clipboard';
import { computeFooters } from './compute';
import { formatNumber, parseNumber } from './format';
import {
  GRID,
  newRow,
  newSheet,
  newTable,
  starterWorkbook,
  type Table,
  type Workbook,
} from './model';
import { parseMonth, visibleWindow } from './months';
import { downloadText } from './download';
import {
  buildExport,
  exportFilename,
  fileStore,
  type FileDoc,
  type FileMeta,
  type SnapshotMeta,
} from './files';
import { merge3 } from './merge';
import {
  bounds,
  cellValue,
  cellsInRanges,
  colKeyAt,
  isBodyRow,
  rowCount,
  rowIdAt,
  styleKey,
  type Pos,
  type Range,
} from './grid';

const SHEET_KEY = 'cashflow-allseeing.activeSheet.';
const MAX_HISTORY = 200;

export const LABEL_W = 200;
export const COL_W = 100;
export const ROW_H = 28;
export const TITLE_H = 32;

export interface Selection {
  tableId: string;
  ranges: Range[];
  /** Where typing goes; stays put while a range is extended. */
  anchor: Pos;
}

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage full or blocked: the in-memory workbook still works.
  }
}

export function tableWidth(months: number): number {
  return LABEL_W + months * COL_W;
}

export function tableHeight(t: Table): number {
  return TITLE_H + ROW_H * (2 + rowCount(t)) + 2;
}

function snap(v: number): number {
  return Math.max(0, Math.round(v / GRID) * GRID);
}

class AppState {
  wb = $state<Workbook>(starterWorkbook());
  /** The open file, or null on the file list. */
  file = $state<FileMeta | null>(null);
  /** Set when this window shows a snapshot: everything is read-only. */
  snapshot = $state<SnapshotMeta | null>(null);
  /** Snapshots stored in the open file, newest first. */
  snapshots = $state<SnapshotMeta[]>([]);
  saveState = $state<'saved' | 'pending' | 'error'>('saved');
  activeSheetId = $state('');
  selection = $state<Selection | null>(null);
  /** Table shown in the inspector (set by clicking a title or a cell). */
  focusTableId = $state<string | null>(null);
  /** Keyed by row id, so edits arriving from another window can't shift it. */
  editing = $state<{ tableId: string; rowId: string; c: number } | null>(null);
  months = $state(visibleWindow());
  canUndo = $state(false);
  canRedo = $state(false);
  /** Short message shown in the status bar (e.g. invalid input). */
  notice = $state('');

  editorEl: HTMLInputElement | null = null;
  contentEl: HTMLElement | null = null;

  /** Each entry is one change made in this window: content before and after it. */
  private undoStack: { before: Workbook; after: Workbook | null }[] = [];
  private redoStack: { before: Workbook; after: Workbook }[] = [];
  /** The stored version this window last read or wrote: the common base for merges. */
  private base: Workbook = starterWorkbook();
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  get sheet() {
    return this.wb.sheets.find((s) => s.id === this.activeSheetId) ?? this.wb.sheets[0];
  }

  table(id: string | null | undefined): Table | undefined {
    if (!id) return undefined;
    for (const s of this.wb.sheets) {
      const t = s.tables.find((t) => t.id === id);
      if (t) return t;
    }
    return undefined;
  }

  /** Recompute the month window (call when the app regains focus; months roll off). */
  refreshMonths() {
    if (this.readonly) return;
    const w = visibleWindow();
    if (w[0] !== this.months[0] || w.length !== this.months.length) this.months = w;
  }

  get readonly(): boolean {
    return !!this.snapshot;
  }

  private plain(): Workbook {
    return $state.snapshot(this.wb) as Workbook;
  }

  // ---------- history ----------

  /** Record the content before a change. save() fills in the content after it. */
  checkpoint() {
    if (this.readonly) return;
    this.undoStack.push({ before: this.plain(), after: null });
    if (this.undoStack.length > MAX_HISTORY) this.undoStack.shift();
    this.redoStack = [];
    this.syncHistoryFlags();
  }

  change(fn: () => void) {
    if (this.readonly) return;
    this.checkpoint();
    fn();
    this.save();
  }

  // Undo and redo reverse or replay only this window's own change, on top of
  // whatever other windows have changed since.
  undo() {
    const e = this.undoStack.pop();
    if (!e || this.readonly) return;
    const cur = this.plain();
    const after = e.after ?? cur;
    this.replace(merge3(after, e.before, cur));
    this.redoStack.push({ before: e.before, after });
    this.afterRestore();
  }

  redo() {
    const e = this.redoStack.pop();
    if (!e || this.readonly) return;
    this.replace(merge3(e.before, e.after, this.plain()));
    this.undoStack.push(e);
    this.afterRestore();
  }

  private afterRestore() {
    this.syncHistoryFlags();
    this.save();
  }

  private syncHistoryFlags() {
    this.canUndo = this.undoStack.length > 0;
    this.canRedo = this.redoStack.length > 0;
  }

  /** Swap in new content, keeping the selection on the same rows. */
  private replace(next: Workbook) {
    const sel = this.selection;
    const old = this.table(sel?.tableId);
    type Ref = { id: string } | { footer: number };
    const ref = (r: number): Ref =>
      old && isBodyRow(old, r) ? { id: old.rows[r].id } : { footer: r - (old?.rows.length ?? 0) };
    const refs = sel
      ? { anchor: ref(sel.anchor.r), ranges: sel.ranges.map((g) => [ref(g.a.r), ref(g.b.r)]) }
      : null;
    this.wb = next;
    if (!this.wb.sheets.some((x) => x.id === this.activeSheetId)) {
      this.activeSheetId = this.wb.sheets[0].id;
    }
    const t = this.table(sel?.tableId);
    if (sel && refs && t) {
      const toRow = (x: Ref, fallback: number) => {
        if ('footer' in x) return t.rows.length + x.footer;
        const i = t.rows.findIndex((row) => row.id === x.id);
        return i >= 0 ? i : fallback;
      };
      sel.anchor = { r: toRow(refs.anchor, sel.anchor.r), c: sel.anchor.c };
      sel.ranges = sel.ranges.map((g, i) => ({
        a: { r: toRow(refs.ranges[i][0], g.a.r), c: g.a.c },
        b: { r: toRow(refs.ranges[i][1], g.b.r), c: g.b.c },
      }));
    }
    this.clampSelection();
  }

  // ---------- files ----------

  /** Open a file in this window, or one of its snapshots (read-only). */
  async open(id: string, snapId: string | null = null): Promise<boolean> {
    if (this.file?.id === id && (this.snapshot?.id ?? null) === snapId) return true;
    await this.close();
    if (snapId) {
      const doc = await fileStore.load(id);
      const snap = await fileStore.loadSnapshot(id, snapId);
      if (!doc || !snap) return false;
      this.load(doc.meta, snap.wb, snap.meta);
    } else {
      await fileStore.ensureMonthEnd(id);
      const doc = await fileStore.load(id);
      if (!doc) return false;
      this.load(doc.meta, doc.wb, null);
    }
    await this.refreshSnapshots();
    return true;
  }

  private load(meta: FileMeta, wb: Workbook, snapshot: SnapshotMeta | null) {
    this.file = meta;
    this.snapshot = snapshot;
    this.wb = wb;
    this.base = structuredClone(wb);
    const saved = readStorage(SHEET_KEY + meta.id);
    this.activeSheetId = wb.sheets.some((s) => s.id === saved) ? saved! : wb.sheets[0].id;
    this.undoStack = [];
    this.redoStack = [];
    this.syncHistoryFlags();
    this.selection = null;
    this.focusTableId = null;
    this.editing = null;
    this.saveState = 'saved';
    if (snapshot) {
      // Show the months as they were at the snapshot: its month to December of the next year.
      const { year, month } = parseMonth(snapshot.asOf);
      this.months = visibleWindow(new Date(year, month - 1, 15));
    } else {
      this.months = visibleWindow();
    }
  }

  async close() {
    if (!this.file) return;
    this.commitEdit();
    await this.flush();
    this.file = null;
    this.snapshot = null;
    this.snapshots = [];
    this.selection = null;
    this.focusTableId = null;
  }

  async renameFile(name: string) {
    const n = name.trim();
    if (!this.file || !n) return;
    await fileStore.rename(this.file.id, n);
    this.file.name = n;
  }

  async refreshSnapshots() {
    this.snapshots = this.file ? await fileStore.listSnapshots(this.file.id) : [];
  }

  async takeSnapshot(label: string) {
    const f = this.file;
    if (!f || this.readonly) return;
    this.commitEdit();
    await this.flush();
    try {
      const meta = await fileStore.takeSnapshot(f.id, label);
      await this.refreshSnapshots();
      this.flashNotice(`Snapshot "${meta.label}" saved.`);
    } catch {
      this.flashNotice('Could not save the snapshot: storage is full.');
    }
  }

  async deleteSnapshot(snapId: string) {
    if (!this.file) return;
    await fileStore.deleteSnapshot(this.file.id, snapId);
    await this.refreshSnapshots();
  }

  /** Copy the snapshot shown in this window into a new, editable file. */
  async snapshotToNewFile(): Promise<string | null> {
    if (!this.file || !this.snapshot) return null;
    const meta = await fileStore.create(`${this.file.name} – ${this.snapshot.label}`, this.plain());
    return meta.id;
  }

  async downloadFile() {
    const f = this.file;
    if (!f) return;
    await this.flush();
    const data = await buildExport(fileStore, f.id);
    if (data) downloadText(exportFilename(f.name), JSON.stringify(data, null, 2));
  }

  /** Another window saved: bring its changes in, keeping this window's unsaved edits. */
  async onExternalChange() {
    const f = this.file;
    if (!f || this.readonly) return;
    const doc = await fileStore.load(f.id);
    if (!doc) {
      this.saveState = 'error';
      this.flashNotice('This file was deleted in another window.');
      return;
    }
    f.name = doc.meta.name;
    if (doc.meta.rev !== f.rev) this.absorb(doc);
  }

  private absorb(doc: FileDoc) {
    const f = this.file!;
    const merged = this.saveState === 'pending' ? merge3(this.base, this.plain(), doc.wb) : doc.wb;
    this.replace(merged);
    this.base = doc.wb;
    f.rev = doc.meta.rev;
    f.updatedAt = doc.meta.updatedAt;
    f.monthEndDone = doc.meta.monthEndDone;
    // If this window had unsaved edits, they are still pending and the
    // scheduled save writes the merged result.
  }

  private changeSeq = 0;

  save() {
    if (!this.file || this.readonly) return;
    const top = this.undoStack[this.undoStack.length - 1];
    if (top && !top.after) top.after = this.plain();
    this.changeSeq++;
    this.saveState = 'pending';
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.flush(), 250);
  }

  private saving: Promise<void> = Promise.resolve();

  /** Write pending changes now. Saves run one at a time; a clash with another window merges and retries. */
  flush(): Promise<void> {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = null;
    const f = this.file;
    if (!f || this.readonly) return this.saving;
    writeStorage(SHEET_KEY + f.id, this.activeSheetId);
    if (this.saveState !== 'pending') return this.saving;
    const run = async () => {
      for (let attempt = 0; attempt < 5; attempt++) {
        if (this.file !== f) return;
        const seq = this.changeSeq;
        const wb = this.plain();
        const monthEndBefore = f.monthEndDone;
        const res = await fileStore.save(f.id, wb, f.rev);
        if (res.ok) {
          f.rev = res.meta.rev;
          f.updatedAt = res.meta.updatedAt;
          f.monthEndDone = res.meta.monthEndDone;
          this.base = wb;
          // Still 'pending' if more edits arrived while this save was running.
          if (this.changeSeq === seq) this.saveState = 'saved';
          if (res.meta.monthEndDone !== monthEndBefore) await this.refreshSnapshots();
          return;
        }
        if (res.reason !== 'conflict') {
          this.saveState = 'error';
          this.flashNotice(
            res.reason === 'missing' ? 'This file no longer exists.' : 'Could not save: storage is full or blocked.',
          );
          return;
        }
        const doc = await fileStore.load(f.id);
        if (!doc) return;
        this.absorb(doc);
      }
      this.saveState = 'error';
      this.flashNotice('Could not save: the file keeps changing in another window.');
    };
    this.saving = this.saving.then(run, run);
    return this.saving;
  }

  // ---------- sheets ----------

  setSheet(id: string) {
    this.commitEdit();
    this.activeSheetId = id;
    this.selection = null;
    this.focusTableId = null;
    if (this.file) writeStorage(SHEET_KEY + this.file.id, id);
  }

  addSheet() {
    const s = newSheet(`Sheet ${this.wb.sheets.length + 1}`);
    this.change(() => this.wb.sheets.push(s));
    this.setSheet(s.id);
  }

  renameSheet(id: string, name: string) {
    const s = this.wb.sheets.find((s) => s.id === id);
    const n = name.trim();
    if (!s || !n || s.name === n) return;
    this.change(() => (s.name = n));
  }

  deleteSheet(id: string) {
    if (this.wb.sheets.length <= 1) return;
    const idx = this.wb.sheets.findIndex((s) => s.id === id);
    this.change(() => this.wb.sheets.splice(idx, 1));
    if (this.activeSheetId === id) this.setSheet(this.wb.sheets[Math.max(0, idx - 1)].id);
  }

  moveSheet(id: string, dir: -1 | 1) {
    const i = this.wb.sheets.findIndex((s) => s.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= this.wb.sheets.length) return;
    this.change(() => {
      const [s] = this.wb.sheets.splice(i, 1);
      this.wb.sheets.splice(j, 0, s);
    });
  }

  // ---------- tables ----------

  addTable() {
    const tables = this.sheet.tables;
    const y = tables.reduce((m, t) => Math.max(m, t.y + tableHeight(t)), 0);
    const t = newTable(`Table ${tables.length + 1}`, GRID * 2, snap(y + GRID * 2));
    this.change(() => this.sheet.tables.push(t));
    this.focusTableId = t.id;
    this.select(t.id, { r: 0, c: 0 });
  }

  deleteTable(id: string) {
    const s = this.wb.sheets.find((s) => s.tables.some((t) => t.id === id));
    if (!s) return;
    this.change(() => (s.tables = s.tables.filter((t) => t.id !== id)));
    if (this.selection?.tableId === id) this.selection = null;
    if (this.focusTableId === id) this.focusTableId = null;
  }

  updateTable(id: string, patch: Partial<Pick<Table, 'name' | 'openingBalance' | 'openingMonth'>>) {
    const t = this.table(id);
    if (!t) return;
    this.change(() => Object.assign(t, patch));
  }

  /** Live drag: the caller calls checkpoint() once when the drag starts. */
  moveTable(id: string, x: number, y: number) {
    const t = this.table(id);
    if (!t || this.readonly) return;
    t.x = snap(x);
    t.y = snap(y);
  }

  bringToFront(id: string) {
    if (this.readonly) return;
    const tables = this.sheet.tables;
    const i = tables.findIndex((t) => t.id === id);
    if (i < 0 || i === tables.length - 1) return;
    const [t] = tables.splice(i, 1);
    tables.push(t);
  }

  // ---------- rows ----------

  addRow(tableId: string) {
    const t = this.table(tableId);
    if (!t) return;
    const sel = this.selection?.tableId === tableId ? this.selection : null;
    const at = sel && isBodyRow(t, sel.anchor.r) ? sel.anchor.r + 1 : t.rows.length;
    this.change(() => t.rows.splice(at, 0, newRow()));
    this.select(tableId, { r: at, c: 0 });
  }

  /** Delete every body row touched by the selection. */
  deleteSelectedRows() {
    const sel = this.selection;
    const t = this.table(sel?.tableId);
    if (!sel || !t) return;
    const rows = new Set(cellsInRanges(sel.ranges).map((p) => p.r).filter((r) => isBodyRow(t, r)));
    if (rows.size === 0) return;
    this.change(() => {
      const ids = new Set([...rows].map((r) => t.rows[r].id));
      t.rows = t.rows.filter((row) => !ids.has(row.id));
      for (const k of Object.keys(t.styles)) {
        if (ids.has(k.split('|')[0])) delete t.styles[k];
      }
    });
    const r = Math.min(Math.min(...rows), Math.max(0, t.rows.length - 1));
    this.select(t.id, { r, c: sel.anchor.c });
  }

  moveSelectedRow(dir: -1 | 1) {
    const sel = this.selection;
    const t = this.table(sel?.tableId);
    if (!sel || !t) return;
    const i = sel.anchor.r;
    const j = i + dir;
    if (!isBodyRow(t, i) || !isBodyRow(t, j)) return;
    this.change(() => {
      const [row] = t.rows.splice(i, 1);
      t.rows.splice(j, 0, row);
    });
    this.select(t.id, { r: j, c: sel.anchor.c });
  }

  // ---------- selection ----------

  select(tableId: string, p: Pos, mode: 'new' | 'extend' | 'add' = 'new') {
    this.focusTableId = tableId;
    const sel = this.selection;
    if (mode === 'extend' && sel && sel.tableId === tableId) {
      const last = sel.ranges[sel.ranges.length - 1];
      sel.ranges[sel.ranges.length - 1] = { a: last.a, b: p };
      return;
    }
    if (mode === 'add' && sel && sel.tableId === tableId) {
      sel.ranges.push({ a: p, b: p });
      sel.anchor = p;
      return;
    }
    this.selection = { tableId, ranges: [{ a: p, b: p }], anchor: p };
  }

  selectAll() {
    const t = this.table(this.selection?.tableId ?? this.focusTableId);
    if (!t) return;
    this.selection = {
      tableId: t.id,
      ranges: [{ a: { r: 0, c: 0 }, b: { r: rowCount(t) - 1, c: this.months.length } }],
      anchor: { r: 0, c: 0 },
    };
  }

  /** Arrow/Tab/Enter navigation. With extend, grows the range instead of moving. */
  move(dr: number, dc: number, extend = false) {
    const sel = this.selection;
    const t = this.table(sel?.tableId);
    if (!sel || !t) return;
    const maxR = rowCount(t) - 1;
    const maxC = this.months.length;
    const clamp = (p: Pos): Pos => ({
      r: Math.min(maxR, Math.max(0, p.r + dr)),
      c: Math.min(maxC, Math.max(0, p.c + dc)),
    });
    if (extend) {
      const last = sel.ranges[sel.ranges.length - 1];
      this.select(t.id, clamp(last.b), 'extend');
    } else {
      this.select(t.id, clamp(sel.anchor));
    }
  }

  private clampSelection() {
    const sel = this.selection;
    const t = this.table(sel?.tableId);
    if (!sel || !t || !this.sheet.tables.includes(t)) {
      this.selection = null;
      return;
    }
    const maxR = rowCount(t) - 1;
    const fix = (p: Pos): Pos => ({ r: Math.min(p.r, maxR), c: Math.min(p.c, this.months.length) });
    sel.ranges = sel.ranges.map((rg) => ({ a: fix(rg.a), b: fix(rg.b) }));
    sel.anchor = fix(sel.anchor);
  }

  selectedValues(): (string | number | null)[] {
    const sel = this.selection;
    const t = this.table(sel?.tableId);
    if (!sel || !t) return [];
    const footers = computeFooters(t, this.months);
    return cellsInRanges(sel.ranges)
      .filter((p) => p.c > 0)
      .map((p) => cellValue(t, this.months, footers, p));
  }

  // ---------- editing ----------

  isEditable(t: Table, p: Pos): boolean {
    return !this.readonly && isBodyRow(t, p.r);
  }

  rawValue(t: Table, p: Pos): string {
    const row = t.rows[p.r];
    if (p.c === 0) return row.label;
    const v = row.values[this.months[p.c - 1]];
    return v === undefined ? '' : String(v);
  }

  /**
   * Open the cell editor on the anchor cell. Called directly from input event
   * handlers so iPad Safari shows the keyboard (it only allows focus() inside a gesture).
   */
  startEdit(seed?: string) {
    const sel = this.selection;
    const t = this.table(sel?.tableId);
    const el = this.editorEl;
    if (!sel || !t || !el || !this.isEditable(t, sel.anchor)) return;
    const p = sel.anchor;
    const cell = this.contentEl?.querySelector<HTMLElement>(
      `[data-t="${t.id}"][data-r="${p.r}"][data-c="${p.c}"]`,
    );
    if (!cell || !this.contentEl) return;
    const box = this.contentEl.getBoundingClientRect();
    const r = cell.getBoundingClientRect();
    el.style.left = `${r.left - box.left}px`;
    el.style.top = `${r.top - box.top}px`;
    el.style.width = `${Math.max(r.width, p.c === 0 ? 0 : 140)}px`;
    el.style.height = `${r.height}px`;
    el.style.textAlign = p.c === 0 ? 'left' : 'right';
    el.value = seed ?? this.rawValue(t, p);
    this.editing = { tableId: t.id, rowId: t.rows[p.r].id, c: p.c };
    el.focus();
    const end = el.value.length;
    el.setSelectionRange(end, end);
  }

  commitEdit() {
    const ed = this.editing;
    const el = this.editorEl;
    if (!ed || !el) return;
    this.editing = null;
    const r = this.table(ed.tableId)?.rows.findIndex((row) => row.id === ed.rowId) ?? -1;
    if (r < 0) {
      this.flashNotice('That row was deleted in another window.');
    } else if (!this.setCell(ed.tableId, { r, c: ed.c }, el.value)) {
      this.flashNotice(`Not a number: "${el.value}"`);
    }
    el.blur();
  }

  private noticeTimer: ReturnType<typeof setTimeout> | null = null;

  flashNotice(msg: string) {
    this.notice = msg;
    if (this.noticeTimer) clearTimeout(this.noticeTimer);
    this.noticeTimer = setTimeout(() => (this.notice = ''), 3500);
  }

  cancelEdit() {
    this.editing = null;
    this.editorEl?.blur();
  }

  /** Write user text into a body cell. Returns false when the text is not a valid number. */
  setCell(tableId: string, p: Pos, text: string): boolean {
    const t = this.table(tableId);
    if (!t || !isBodyRow(t, p.r)) return false;
    const row = t.rows[p.r];
    if (p.c === 0) {
      const label = text.trim();
      if (label !== row.label) this.change(() => (row.label = label));
      return true;
    }
    const m = this.months[p.c - 1];
    const n = parseNumber(text);
    if (n === undefined) return false;
    if (n === (row.values[m] ?? null)) return true;
    this.change(() => {
      if (n === null) delete row.values[m];
      else row.values[m] = n;
    });
    return true;
  }

  clearSelected() {
    const sel = this.selection;
    const t = this.table(sel?.tableId);
    if (!sel || !t) return;
    const cells = cellsInRanges(sel.ranges).filter((p) => isBodyRow(t, p.r));
    if (cells.length === 0) return;
    this.change(() => {
      for (const p of cells) {
        const row = t.rows[p.r];
        if (p.c === 0) row.label = '';
        else delete row.values[this.months[p.c - 1]];
      }
    });
  }

  applyStyle(styleId: string) {
    const sel = this.selection;
    const t = this.table(sel?.tableId);
    if (!sel || !t) return;
    this.change(() => {
      for (const p of cellsInRanges(sel.ranges)) {
        const k = styleKey(rowIdAt(t, p.r), colKeyAt(this.months, p.c));
        if (styleId === 'none') delete t.styles[k];
        else t.styles[k] = styleId;
      }
    });
  }

  // ---------- clipboard ----------

  /** The last selected range as text grids for the clipboard. */
  copyData(): { text: string; html: string } | null {
    const sel = this.selection;
    const t = this.table(sel?.tableId);
    if (!sel || !t) return null;
    const footers = computeFooters(t, this.months);
    const { r0, r1, c0, c1 } = bounds(sel.ranges[sel.ranges.length - 1]);
    const grid: string[][] = [];
    for (let r = r0; r <= r1; r++) {
      const line: string[] = [];
      for (let c = c0; c <= c1; c++) {
        const v = cellValue(t, this.months, footers, { r, c });
        line.push(v === null ? '' : String(v));
      }
      grid.push(line);
    }
    const shown = grid.map((line) =>
      line.map((v, j) => (c0 + j === 0 || v === '' ? v : formatNumber(Number(v)))),
    );
    return { text: toTSV(grid), html: toHTML(shown) };
  }

  /** Paste tab-separated text at the anchor cell. Adds rows when the block runs past the end. */
  paste(text: string) {
    const sel = this.selection;
    const t = this.table(sel?.tableId);
    if (!sel || !t || !isBodyRow(t, sel.anchor.r)) return;
    const grid = parseTSV(text);
    if (grid.length === 0) return;
    const { r: r0, c: c0 } = sel.anchor;
    this.change(() => {
      grid.forEach((line, i) => {
        const r = r0 + i;
        while (t.rows.length <= r) t.rows.push(newRow());
        const row = t.rows[r];
        line.forEach((cell, j) => {
          const c = c0 + j;
          if (c > this.months.length) return;
          if (c === 0) {
            row.label = cell.trim();
            return;
          }
          const n = parseNumber(cell);
          const m = this.months[c - 1];
          if (n === null) delete row.values[m];
          else if (n !== undefined) row.values[m] = n;
        });
      });
    });
    const lastR = r0 + grid.length - 1;
    const lastC = Math.min(this.months.length, c0 + Math.max(...grid.map((l) => l.length)) - 1);
    this.selection = { tableId: t.id, ranges: [{ a: { r: r0, c: c0 }, b: { r: lastR, c: lastC } }], anchor: { r: r0, c: c0 } };
  }
}

export const app = new AppState();

