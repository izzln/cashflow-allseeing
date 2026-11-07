import { untrack } from 'svelte';
import { toHTML, toTSV, parseTSV } from './clipboard';
import { Evaluator } from './evaluate';
import { formatNumber, parseNumber } from './format';
import {
  bodyItems,
  GRID,
  newLedger,
  newSheet,
  newTable,
  starterWorkbook,
  uid,
  type CashTable,
  type Entry,
  type FooterRow,
  type ImportMap,
  type LedgerTable,
  type Row,
  type RowSource,
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
  cellsInRanges,
  FIXED_FOOTERS,
  gridModel,
  LEDGER_COLS,
  styleKey,
  type GridModel,
  type Pos,
  type Range,
} from './grid';
import { SyncLoop } from './sync';

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

export type RowKind = 'manual' | 'source' | 'formula';

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

export function tableWidth(t: Table, months: number): number {
  return t.kind === 'ledger' ? LEDGER_COLS.reduce((s, c) => s + c.width, 0) : LABEL_W + months * COL_W;
}

export function tableHeight(t: Table): number {
  const rows =
    t.kind === 'ledger' ? 1 + t.entries.length + 1 : 2 + t.rows.length + FIXED_FOOTERS.length + t.footers.length;
  return TITLE_H + ROW_H * rows + 2;
}

function snap(v: number): number {
  return Math.max(0, Math.round(v / GRID) * GRID);
}

export function rowKind(row: Row): RowKind {
  return row.formula !== undefined ? 'formula' : row.source ? 'source' : 'manual';
}

class AppState {
  wb = $state<Workbook>(starterWorkbook());
  /** The open file, or null on the file list. */
  file = $state<FileMeta | null>(null);
  /** Set when this window shows a snapshot: everything is read-only. */
  snapshot = $state<SnapshotMeta | null>(null);
  /** Snapshots stored in the open file, newest first. */
  snapshots = $state<SnapshotMeta[]>([]);
  /** offline: will retry; signin: waiting for the user to sign in again. */
  saveState = $state<'saved' | 'pending' | 'offline' | 'signin' | 'error'>('saved');
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
  /** Whether this window runs the file's sync timer, and when it last ran. */
  syncLeader = $state(false);
  lastSyncAt = $state<number | null>(null);

  /** Bumped on every content change; recomputes all calculated cells. */
  version = $state(0);
  ev = $derived.by(() => {
    this.version;
    return untrack(() => new Evaluator($state.snapshot(this.wb) as Workbook));
  });

  editorEl: HTMLInputElement | null = null;
  contentEl: HTMLElement | null = null;

  /** Each entry is one change made in this window: content before and after it. */
  private undoStack: { before: Workbook; after: Workbook | null }[] = [];
  private redoStack: { before: Workbook; after: Workbook }[] = [];
  /** The stored version this window last read or wrote: the common base for merges. */
  private base: Workbook = starterWorkbook();
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private sync = new SyncLoop(
    () => this.runSync(),
    (leader) => (this.syncLeader = leader),
  );

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

  ledgers(): { ledger: LedgerTable; sheet: string }[] {
    return this.wb.sheets.flatMap((s) =>
      s.tables.filter((t): t is LedgerTable => t.kind === 'ledger').map((ledger) => ({ ledger, sheet: s.name })),
    );
  }

  model(t: Table): GridModel {
    return gridModel(t, this.months, this.ev);
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
    const oldItems = old ? bodyItems(old) : [];
    const ref = (r: number): Ref =>
      r < oldItems.length ? { id: oldItems[r].id } : { footer: r - oldItems.length };
    const refs = sel
      ? { anchor: ref(sel.anchor.r), ranges: sel.ranges.map((g) => [ref(g.a.r), ref(g.b.r)]) }
      : null;
    this.wb = next;
    this.version++;
    if (!this.wb.sheets.some((x) => x.id === this.activeSheetId)) {
      this.activeSheetId = this.wb.sheets[0].id;
    }
    const t = this.table(sel?.tableId);
    if (sel && refs && t) {
      const items = bodyItems(t);
      const toRow = (x: Ref, fallback: number) => {
        if ('footer' in x) return items.length + x.footer;
        const i = items.findIndex((row) => row.id === x.id);
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
    if (!this.readonly) this.sync.start(id, () => this.wb.settings.syncMinutes);
    return true;
  }

  private load(meta: FileMeta, wb: Workbook, snapshot: SnapshotMeta | null) {
    this.file = meta;
    this.snapshot = snapshot;
    this.wb = wb;
    this.version++;
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
    this.sync.stop();
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
    let doc: FileDoc | null;
    try {
      doc = await fileStore.load(f.id);
    } catch {
      return; // offline or signed out: try again on the next change notice
    }
    if (this.file !== f) return;
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
    const merged = this.saveState !== 'saved' ? merge3(this.base, this.plain(), doc.wb) : doc.wb;
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
    this.version++;
    this.changeSeq++;
    // Keep showing "offline"/"sign in" until a save actually goes through.
    if (this.saveState === 'saved' || this.saveState === 'error') this.saveState = 'pending';
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.flush(), 250);
  }

  private saving: Promise<void> = Promise.resolve();
  private retryDelay = 0;

  /** True while edits exist that the store hasn't confirmed. */
  get unsaved(): boolean {
    return !!this.file && !this.readonly && this.saveState !== 'saved';
  }

  /** Write pending changes now. Saves run one at a time; a clash with another window merges and retries. */
  flush(): Promise<void> {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = null;
    const f = this.file;
    if (!f || this.readonly) return this.saving;
    writeStorage(SHEET_KEY + f.id, this.activeSheetId);
    if (this.saveState === 'saved') return this.saving;
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
          this.retryDelay = 0;
          // Still 'pending' if more edits arrived while this save was running.
          if (this.changeSeq === seq) this.saveState = 'saved';
          else this.saveState = 'pending';
          if (res.meta.monthEndDone !== monthEndBefore) await this.refreshSnapshots();
          return;
        }
        if (res.reason === 'network') {
          // Keep the edits and try again, waiting longer each time (up to a minute).
          this.saveState = 'offline';
          this.retryDelay = Math.min(60_000, Math.max(2_000, this.retryDelay * 2));
          if (this.saveTimer) clearTimeout(this.saveTimer);
          this.saveTimer = setTimeout(() => this.flush(), this.retryDelay);
          return;
        }
        if (res.reason === 'signin') {
          this.saveState = 'signin';
          return;
        }
        if (res.reason !== 'conflict') {
          this.saveState = 'error';
          this.flashNotice(
            res.reason === 'missing'
              ? 'This file no longer exists.'
              : `Could not save: ${res.message ?? 'storage is full or blocked.'}`,
          );
          return;
        }
        let doc: FileDoc | null = null;
        try {
          doc = await fileStore.load(f.id);
        } catch {
          this.saveState = 'offline';
          this.saveTimer = setTimeout(() => this.flush(), 5_000);
          return;
        }
        if (!doc) return;
        this.absorb(doc);
      }
      this.saveState = 'error';
      this.flashNotice('Could not save: the file keeps changing in another window.');
    };
    this.saving = this.saving.then(run, run);
    return this.saving;
  }

  // ---------- sync ----------

  /**
   * Pull remote sources into their ledgers. Feishu and Huoban connectors come
   * with the server (phases 3–4); ledgers filled from CSV/Excel are updated by
   * re-importing, since a browser can't re-read a file on disk by itself.
   */
  async runSync() {
    this.lastSyncAt = Date.now();
  }

  setSyncMinutes(minutes: number) {
    const m = Math.min(1440, Math.max(1, Math.round(minutes)));
    if (m === this.wb.settings.syncMinutes) return;
    this.change(() => (this.wb.settings.syncMinutes = m));
    this.sync.schedule(() => this.wb.settings.syncMinutes);
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

  addTable(kind: 'cashflow' | 'ledger' = 'cashflow') {
    const tables = this.sheet.tables;
    const y = snap(tables.reduce((m, t) => Math.max(m, t.y + tableHeight(t)), 0) + GRID * 2);
    const count = tables.filter((t) => t.kind === kind).length + 1;
    const t = kind === 'ledger' ? newLedger(`Ledger ${count}`, GRID * 2, y) : newTable(`Table ${count}`, GRID * 2, y);
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

  renameTable(id: string, name: string) {
    const t = this.table(id);
    const n = name.trim();
    if (t && n && n !== t.name) this.change(() => (t.name = n));
  }

  updateCashTable(id: string, patch: Partial<Pick<CashTable, 'openingBalance' | 'openingMonth'>>) {
    const t = this.table(id);
    if (t?.kind === 'cashflow') this.change(() => Object.assign(t, patch));
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
    if (!t || this.readonly) return;
    const m = this.model(t);
    const sel = this.selection?.tableId === tableId ? this.selection : null;
    const at = sel && sel.anchor.r < m.body ? sel.anchor.r + 1 : m.body;
    this.change(() => m.insertBodyRow(at));
    this.select(tableId, { r: at, c: 0 });
  }

  /** Delete every body row touched by the selection. */
  deleteSelectedRows() {
    const sel = this.selection;
    const t = this.table(sel?.tableId);
    if (!sel || !t) return;
    const m = this.model(t);
    const rows = new Set(cellsInRanges(sel.ranges).map((p) => p.r).filter((r) => r < m.body));
    if (rows.size === 0) return;
    const ids = new Set([...rows].map((r) => m.rowId(r)));
    this.change(() => {
      if (t.kind === 'ledger') t.entries = t.entries.filter((e) => !ids.has(e.id));
      else t.rows = t.rows.filter((row) => !ids.has(row.id));
      for (const k of Object.keys(t.styles)) {
        if (ids.has(k.split('|')[0])) delete t.styles[k];
      }
    });
    const left = bodyItems(t).length;
    this.select(t.id, { r: Math.min(Math.min(...rows), Math.max(0, left - 1)), c: sel.anchor.c });
  }

  moveSelectedRow(dir: -1 | 1) {
    const sel = this.selection;
    const t = this.table(sel?.tableId);
    if (!sel || !t) return;
    const items = bodyItems(t);
    const i = sel.anchor.r;
    const j = i + dir;
    if (i < 0 || j < 0 || i >= items.length || j >= items.length) return;
    this.change(() => {
      const list = bodyItems(t) as unknown[];
      const [row] = list.splice(i, 1);
      list.splice(j, 0, row);
    });
    this.select(t.id, { r: j, c: sel.anchor.c });
  }

  /** The cash-flow row the selection's anchor is on, if any. */
  selectedRow(): { table: CashTable; row: Row } | null {
    const sel = this.selection;
    const t = this.table(sel?.tableId);
    if (!sel || t?.kind !== 'cashflow' || sel.anchor.r >= t.rows.length) return null;
    return { table: t, row: t.rows[sel.anchor.r] };
  }

  selectedFooter(): { table: CashTable; footer: FooterRow } | null {
    const sel = this.selection;
    const t = this.table(sel?.tableId);
    if (!sel || t?.kind !== 'cashflow') return null;
    const f = t.footers[sel.anchor.r - t.rows.length - FIXED_FOOTERS.length];
    return f ? { table: t, footer: f } : null;
  }

  private findRow(tableId: string, rowId: string): Row | undefined {
    const t = this.table(tableId);
    return t?.kind === 'cashflow' ? t.rows.find((r) => r.id === rowId) : undefined;
  }

  /** Switch a row between manual numbers, a ledger source and a formula. */
  setRowKind(tableId: string, rowId: string, kind: RowKind) {
    const row = this.findRow(tableId, rowId);
    if (!row || rowKind(row) === kind) return;
    this.change(() => {
      delete row.formula;
      delete row.source;
      if (kind === 'formula') row.formula = '';
      if (kind === 'source') {
        const first = this.ledgers()[0]?.ledger;
        row.source = { ledgerId: first?.id ?? '', categories: [], noteContains: '', flip: false };
      }
    });
  }

  setRowSource(tableId: string, rowId: string, patch: Partial<RowSource>) {
    const row = this.findRow(tableId, rowId);
    if (!row?.source) return;
    this.change(() => Object.assign(row.source!, patch));
  }

  setRowFormula(tableId: string, rowId: string, formula: string) {
    const row = this.findRow(tableId, rowId);
    if (!row || row.formula === formula) return;
    this.change(() => (row.formula = formula));
  }

  /** Remove manual overrides from a source row, so every month shows the source again. */
  clearOverrides(tableId: string, rowId: string) {
    const row = this.findRow(tableId, rowId);
    if (row && Object.keys(row.values).length) this.change(() => (row.values = {}));
  }

  addFooter(tableId: string) {
    const t = this.table(tableId);
    if (t?.kind !== 'cashflow') return;
    const f: FooterRow = { id: uid(), label: 'New formula', formula: '[Balance]' };
    this.change(() => t.footers.push(f));
    this.select(t.id, { r: t.rows.length + FIXED_FOOTERS.length + t.footers.length - 1, c: 0 });
  }

  updateFooter(tableId: string, footerId: string, patch: Partial<Pick<FooterRow, 'label' | 'formula'>>) {
    const t = this.table(tableId);
    const f = t?.kind === 'cashflow' ? t.footers.find((x) => x.id === footerId) : undefined;
    if (f) this.change(() => Object.assign(f, patch));
  }

  deleteFooter(tableId: string, footerId: string) {
    const t = this.table(tableId);
    if (t?.kind !== 'cashflow') return;
    this.change(() => (t.footers = t.footers.filter((f) => f.id !== footerId)));
    this.selection = null;
  }

  // ---------- ledgers ----------

  importEntries(ledgerId: string, entries: Entry[], mode: 'replace' | 'append', map: ImportMap, fileName: string) {
    const t = this.table(ledgerId);
    if (t?.kind !== 'ledger') return;
    this.change(() => {
      const keep = mode === 'append' ? t.entries.filter((e) => e.date || e.amount !== null || e.note || e.category) : [];
      t.entries = [...keep, ...entries];
      t.importMap = map;
      t.importedFrom = fileName;
      if (mode === 'replace') {
        for (const k of Object.keys(t.styles)) if (!k.startsWith('__')) delete t.styles[k];
      }
    });
    this.selection = null;
    this.flashNotice(`Imported ${entries.length} entries into "${t.name}".`);
  }

  sortLedger(ledgerId: string) {
    const t = this.table(ledgerId);
    if (t?.kind !== 'ledger') return;
    this.change(() => {
      // Undated entries go last; ties keep their order.
      t.entries = [...t.entries].sort((a, b) => (a.date || '9999') .localeCompare(b.date || '9999'));
    });
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
    const m = this.model(t);
    this.selection = {
      tableId: t.id,
      ranges: [{ a: { r: 0, c: 0 }, b: { r: m.rows - 1, c: m.cols - 1 } }],
      anchor: { r: 0, c: 0 },
    };
  }

  /** Arrow/Tab/Enter navigation. With extend, grows the range instead of moving. */
  move(dr: number, dc: number, extend = false) {
    const sel = this.selection;
    const t = this.table(sel?.tableId);
    if (!sel || !t) return;
    const m = this.model(t);
    const clamp = (p: Pos): Pos => ({
      r: Math.min(m.rows - 1, Math.max(0, p.r + dr)),
      c: Math.min(m.cols - 1, Math.max(0, p.c + dc)),
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
    const m = this.model(t);
    const fix = (p: Pos): Pos => ({ r: Math.max(0, Math.min(p.r, m.rows - 1)), c: Math.min(p.c, m.cols - 1) });
    sel.ranges = sel.ranges.map((rg) => ({ a: fix(rg.a), b: fix(rg.b) }));
    sel.anchor = fix(sel.anchor);
  }

  selectedValues(): (string | number | null)[] {
    const sel = this.selection;
    const t = this.table(sel?.tableId);
    if (!sel || !t) return [];
    const m = this.model(t);
    return cellsInRanges(sel.ranges)
      .filter((p) => t.kind === 'ledger' ? p.c === 1 : p.c > 0)
      .map((p) => m.value(p));
  }

  // ---------- editing ----------

  /**
   * Open the cell editor on the anchor cell. Called directly from input event
   * handlers so iPad Safari shows the keyboard (it only allows focus() inside a gesture).
   */
  startEdit(seed?: string) {
    const sel = this.selection;
    const t = this.table(sel?.tableId);
    const el = this.editorEl;
    if (!sel || !t || !el || this.readonly) return;
    const p = sel.anchor;
    const m = this.model(t);
    const ok = m.editable(p);
    if (ok !== true) {
      this.flashNotice(ok);
      return;
    }
    const cell = this.contentEl?.querySelector<HTMLElement>(
      `[data-t="${t.id}"][data-r="${p.r}"][data-c="${p.c}"]`,
    );
    if (!cell || !this.contentEl) return;
    const box = this.contentEl.getBoundingClientRect();
    const r = cell.getBoundingClientRect();
    const right = m.alignRight(p.c);
    el.style.left = `${r.left - box.left}px`;
    el.style.top = `${r.top - box.top}px`;
    el.style.width = `${Math.max(r.width, right ? 140 : 0)}px`;
    el.style.height = `${r.height}px`;
    el.style.textAlign = right ? 'right' : 'left';
    el.value = seed ?? m.raw(p);
    this.editing = { tableId: t.id, rowId: m.rowId(p.r), c: p.c };
    el.focus();
    const end = el.value.length;
    el.setSelectionRange(end, end);
  }

  commitEdit() {
    const ed = this.editing;
    const el = this.editorEl;
    if (!ed || !el) return;
    this.editing = null;
    const t = this.table(ed.tableId);
    const m = t ? this.model(t) : null;
    let r = -1;
    if (t && m) for (let i = 0; i < m.rows; i++) if (m.rowId(i) === ed.rowId) r = i;
    if (r < 0) {
      this.flashNotice('That row was deleted in another window.');
    } else if (!this.setCell(ed.tableId, { r, c: ed.c }, el.value)) {
      this.flashNotice(ed.c === 0 && t?.kind === 'ledger' ? `Not a date: "${el.value}"` : `Not a number: "${el.value}"`);
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

  /** Write user text into a cell. Returns false when the text is not valid for it. */
  setCell(tableId: string, p: Pos, text: string): boolean {
    const t = this.table(tableId);
    if (!t || this.readonly) return false;
    const m = this.model(t);
    if (m.editable(p) !== true) return true;
    if (m.raw(p) === text) return true;
    let ok = true;
    // Validate on a throwaway check first so an invalid entry doesn't create an undo step.
    const probe = gridModel(structuredClone($state.snapshot(t)) as Table, this.months, this.ev);
    if (!probe.set(p, text)) return false;
    this.change(() => (ok = m.set(p, text)));
    return ok;
  }

  clearSelected() {
    const sel = this.selection;
    const t = this.table(sel?.tableId);
    if (!sel || !t || this.readonly) return;
    const m = this.model(t);
    const cells = cellsInRanges(sel.ranges).filter((p) => m.editable(p) === true && m.raw(p) !== '');
    if (cells.length === 0) return;
    this.change(() => {
      for (const p of cells) m.set(p, '');
    });
  }

  applyStyle(styleId: string) {
    const sel = this.selection;
    const t = this.table(sel?.tableId);
    if (!sel || !t) return;
    const m = this.model(t);
    this.change(() => {
      for (const p of cellsInRanges(sel.ranges)) {
        const k = styleKey(m.rowId(p.r), m.colKey(p.c));
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
    const m = this.model(t);
    const { r0, r1, c0, c1 } = bounds(sel.ranges[sel.ranges.length - 1]);
    const raw: string[][] = [];
    const shown: string[][] = [];
    for (let r = r0; r <= r1; r++) {
      const a: string[] = [];
      const b: string[] = [];
      for (let c = c0; c <= c1; c++) {
        const v = m.value({ r, c });
        a.push(v === null ? '' : String(v));
        b.push(typeof v === 'number' ? formatNumber(v) : v === null ? '' : v);
      }
      raw.push(a);
      shown.push(b);
    }
    return { text: toTSV(raw), html: toHTML(shown) };
  }

  /** Paste tab-separated text at the anchor cell. Adds rows when the block runs past the end. */
  paste(text: string) {
    const sel = this.selection;
    const t = this.table(sel?.tableId);
    if (!sel || !t || this.readonly) return;
    const grid = parseTSV(text);
    if (grid.length === 0) return;
    const { r: r0, c: c0 } = sel.anchor;
    // On a ledger, pasting onto the Total row appends new entries.
    const body = this.model(t).body;
    if (r0 > body || (r0 === body && t.kind !== 'ledger')) {
      this.flashNotice('Paste into a normal row, not a total or formula row.');
      return;
    }
    let bad = 0;
    this.change(() => {
      grid.forEach((line, i) => {
        let m = this.model(t);
        while (m.body <= r0 + i) {
          m.insertBodyRow(m.body);
          m = this.model(t);
        }
        line.forEach((cell, j) => {
          const p = { r: r0 + i, c: c0 + j };
          if (p.c >= m.cols || m.editable(p) !== true) return;
          if (!m.set(p, cell)) bad++;
        });
      });
    });
    if (bad) this.flashNotice(`${bad} pasted cell(s) were not valid and were skipped.`);
    const lastC = Math.min(this.model(t).cols - 1, c0 + Math.max(...grid.map((l) => l.length)) - 1);
    this.selection = {
      tableId: t.id,
      ranges: [{ a: { r: r0, c: c0 }, b: { r: r0 + grid.length - 1, c: lastC } }],
      anchor: { r: r0, c: c0 },
    };
  }
}

export const app = new AppState();

export { parseNumber };
