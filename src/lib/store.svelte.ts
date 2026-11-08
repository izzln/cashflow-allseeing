import { tick, untrack } from 'svelte';
import { toHTML, toTSV, parseTSV } from './clipboard';
import { Evaluator } from './evaluate';
import { formatNumber, parseNumber } from './format';
import {
  bodyItems,
  GRID,
  newDataTable,
  newSheet,
  newCashflow,
  starterWorkbook,
  uid,
  type CashflowTable,
  type Entry,
  type FooterRow,
  type ImportMap,
  type DataTable,
  type Row,
  type RowSource,
  type CellSource,
  type ColumnType,
  type Filter,
  type Attachment,
  type Align,
  type Table,
  type Workbook,
  type Sheet,
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
  columnWidth,
  styleKey,
  type GridModel,
  type Pos,
  type Range,
} from './grid';
import { SyncLoop } from './sync';
import { attachmentStore } from './attachments';
import type { SheetData } from './import/xlsx';
import { convertCell, firstColumnOf, newColumnId, COLUMN_TYPE_LABELS } from './columns';
import { amountColumn } from './import/mapping';

const SHEET_KEY = 'cashflow-allseeing.activeSheet.';
const ZOOM_KEY = 'cashflow-allseeing.zoom.';
export const ZOOM_MIN = 0.25;
export const ZOOM_MAX = 4;
export const ZOOM_STEPS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];
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
  /** Set when whole rows or columns were selected with the row/column tabs. */
  lines?: 'row' | 'col';
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
  return t.kind === 'table' ? t.columns.reduce((s, c) => s + columnWidth(c), 0) : LABEL_W + months * COL_W;
}

export function tableHeight(t: Table): number {
  const rows =
    t.kind === 'table' ? 1 + t.entries.length + 1 : 2 + t.rows.length + FIXED_FOOTERS.length + t.footers.length;
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
  // ---------- interface state shared by menus, toolbar and panels ----------
  showInspector = $state(typeof window !== 'undefined' && window.innerWidth >= 1000);
  /** Table whose title is being renamed in place. */
  renamingTableId = $state<string | null>(null);
  /** Table column whose header is being renamed in place. */
  renamingColumn = $state<{ tableId: string; colId: string } | null>(null);
  /** An open context menu (right-click / long-press) or edit menu (after a tap), in viewport pixels. */
  menu = $state<{ kind: 'context' | 'edit'; target: 'cells' | 'table' | 'column' | 'rows' | 'columns' | 'sheet'; tableId: string; x: number; y: number } | null>(null);
  /** A spreadsheet being mapped in the import dialog. */
  importing = $state<{ tableId: string; fileName: string; sheets: SheetData[] } | null>(null);
  /** Table shown filling the whole workspace. */
  /** Filled table per sheet, so switching sheets and back keeps it filled. */
  private maxBySheet = $state<Record<string, string>>({});
  get maximizedId(): string | null {
    const id = this.maxBySheet[this.activeSheetId];
    return id && this.sheet?.tables.some((t) => t.id === id) ? id : null;
  }
  set maximizedId(id: string | null) {
    if (id) this.maxBySheet[this.activeSheetId] = id;
    else delete this.maxBySheet[this.activeSheetId];
  }
  /** Width available to the filled table (Fill Window), measured by its frame. */
  fillWidth = $state(0);
  /** Workspace zoom, 0.25–4 (25 %–400 %, as in Numbers). Remembered per file on this device. */
  zoom = $state(1);
  canvasEl: HTMLElement | null = null;

  /** The files cell whose attachments popover is open. */
  filesCell = $state<{ tableId: string; rowId: string; colId: string } | null>(null);
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

  dataTables(): { dataTable: DataTable; sheet: string }[] {
    return this.wb.sheets.flatMap((s) =>
      s.tables.filter((t): t is DataTable => t.kind === 'table').map((dataTable) => ({ dataTable, sheet: s.name })),
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
    const z = Number(readStorage(ZOOM_KEY + meta.id));
    this.zoom = z >= ZOOM_MIN && z <= ZOOM_MAX ? z : 1;
    const saved = readStorage(SHEET_KEY + meta.id);
    this.activeSheetId = wb.sheets.some((s) => s.id === saved) ? saved! : wb.sheets[0].id;
    this.undoStack = [];
    this.redoStack = [];
    this.syncHistoryFlags();
    this.selection = null;
    this.focusTableId = null;
    this.editing = null;
    this.menu = null;
    this.maxBySheet = {};
    this.filesCell = null;
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
      this.flashNotice(`Snapshot "${meta.label}" saved.`, 'info');
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
   * Pull remote sources into their dataTables. Feishu and Huoban connectors come
   * with the server (phases 3–4); dataTables filled from CSV/Excel are updated by
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
    this.focusTableId = this.maximizedId;
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
    this.flashNotice(`Deleted sheet “${this.wb.sheets[idx].name}”.`, 'info', { label: 'Undo', run: () => this.undo() });
    this.change(() => this.wb.sheets.splice(idx, 1));
    if (this.activeSheetId === id) this.setSheet(this.wb.sheets[Math.max(0, idx - 1)].id);
  }

  /** Sheet whose tab is being renamed in place (started from the tab or its menu). */
  renamingSheetId = $state<string | null>(null);

  /** Move a sheet so it sits before the sheet now at index `to` (or last). Used by tab drag & drop. */
  moveSheetTo(id: string, to: number) {
    const i = this.wb.sheets.findIndex((s) => s.id === id);
    if (i < 0 || this.readonly) return;
    const target = to > i ? to - 1 : to;
    if (target === i || target < 0 || target >= this.wb.sheets.length) return;
    this.change(() => {
      const [s] = this.wb.sheets.splice(i, 1);
      this.wb.sheets.splice(target, 0, s);
    });
  }

  /** Copy a sheet (tables get new ids) right after the original, and show it. */
  duplicateSheet(id: string) {
    const i = this.wb.sheets.findIndex((s) => s.id === id);
    if (i < 0 || this.readonly) return;
    const copy = structuredClone($state.snapshot(this.wb.sheets[i])) as Sheet;
    copy.id = uid();
    copy.name = `${copy.name} copy`;
    for (const t of copy.tables) t.id = uid();
    this.change(() => this.wb.sheets.splice(i + 1, 0, copy));
    this.setSheet(copy.id);
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

  addTable(kind: 'cashflow' | 'table' = 'cashflow') {
    const tables = this.sheet.tables;
    const y = snap(tables.reduce((m, t) => Math.max(m, t.y + tableHeight(t)), 0) + GRID * 2);
    const count = tables.filter((t) => t.kind === kind).length + 1;
    const t = kind === 'table' ? newDataTable(`Table ${count}`, GRID * 2, y) : newCashflow(`Cashflow ${count}`, GRID * 2, y);
    this.change(() => this.sheet.tables.push(t));
    this.focusTableId = t.id;
    this.select(t.id, { r: 0, c: 0 });
  }

  deleteTable(id: string) {
    const s = this.wb.sheets.find((s) => s.tables.some((t) => t.id === id));
    if (!s) return;
    const gone = s.tables.find((t) => t.id === id)!;
    this.flashNotice(`Deleted “${gone.name}”.`, 'info', { label: 'Undo', run: () => this.undo() });
    this.change(() => (s.tables = s.tables.filter((t) => t.id !== id)));
    if (this.selection?.tableId === id) this.selection = null;
    if (this.focusTableId === id) this.focusTableId = null;
    if (this.maximizedId === id) this.maximizedId = null;
  }

  /** Copy a table next to the original, with new ids so the copy is independent. */
  duplicateTable(id: string) {
    const t = this.table(id);
    const sheet = this.wb.sheets.find((s) => s.tables.some((x) => x.id === id));
    if (!t || !sheet || this.readonly) return;
    const plain = structuredClone($state.snapshot(t)) as Table;
    const ids = new Map<string, string>();
    const fresh = (old: string) => {
      if (!ids.has(old)) ids.set(old, uid());
      return ids.get(old)!;
    };
    const remap = <V,>(rec: Record<string, V>) =>
      Object.fromEntries(
        Object.entries(rec).map(([k, v]) => {
          const [r, c] = k.split('|');
          return [ids.has(r) ? `${ids.get(r)}|${c}` : k, v];
        }),
      ) as Record<string, V>;
    let copy: Table;
    if (plain.kind === 'table') {
      plain.entries = plain.entries.map((e) => ({ ...e, id: fresh(e.id) }));
      copy = { ...plain, styles: remap(plain.styles), aligns: remap(plain.aligns) };
    } else {
      plain.rows = plain.rows.map((r) => ({ ...r, id: fresh(r.id) }));
      plain.footers = plain.footers.map((f) => ({ ...f, id: fresh(f.id) }));
      copy = { ...plain, styles: remap(plain.styles), aligns: remap(plain.aligns), cellSources: remap(plain.cellSources) };
    }
    copy.id = uid();
    copy.name = `${t.name} copy`;
    copy.x = snap(t.x + GRID * 2);
    copy.y = snap(t.y + GRID * 2);
    this.change(() => sheet.tables.push(copy));
    this.focusTableId = copy.id;
    this.selection = null;
  }

  renameTable(id: string, name: string) {
    const t = this.table(id);
    const n = name.trim();
    if (t && n && n !== t.name) this.change(() => (t.name = n));
  }

  updateCashTable(id: string, patch: Partial<Pick<CashflowTable, 'openingBalance' | 'openingMonth'>>) {
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

  /** Insert a row above or below the selection (⌥↑ / ⌥↓), like Numbers. */
  insertRow(where: 'above' | 'below') {
    const sel = this.selection;
    const t = this.table(sel?.tableId ?? this.focusTableId);
    if (!t || this.readonly) return;
    const m = this.model(t);
    let at = m.body;
    if (sel && sel.tableId === t.id) {
      const rows = cellsInRanges(sel.ranges).map((p) => p.r).filter((r) => r < m.body);
      if (rows.length) at = where === 'above' ? Math.min(...rows) : Math.max(...rows) + 1;
      else if (where === 'above') at = m.body; // on a total/footer row: add at the end of the body
    }
    this.change(() => m.insertBodyRow(at));
    this.select(t.id, { r: at, c: sel?.tableId === t.id ? sel.anchor.c : 0 });
  }

  /** Insert a column before or after the selection (⌥← / ⌥→). Only dataTables have free columns. */
  insertColumnAt(where: 'before' | 'after') {
    const sel = this.selection;
    const t = this.table(sel?.tableId ?? this.focusTableId);
    if (!t || this.readonly) return;
    if (t.kind !== 'table') {
      this.flashNotice('Month columns follow the forecast window, so they can’t be added by hand.');
      return;
    }
    let at = t.columns.length;
    if (sel && sel.tableId === t.id) {
      const cols = cellsInRanges(sel.ranges).map((p) => p.c);
      at = where === 'before' ? Math.min(...cols) : Math.max(...cols) + 1;
    }
    this.insertColumn(t.id, at);
  }

  /** Select whole rows (row tab) or whole columns (column tab). */
  selectLines(tableId: string, axis: 'row' | 'col', from: number, to = from, extend = false) {
    const t = this.table(tableId);
    if (!t) return;
    const m = this.model(t);
    const sel = this.selection;
    let start = from;
    // Shift+click extends from the line already selected.
    if (extend && sel?.tableId === tableId) start = axis === 'row' ? sel.anchor.r : sel.anchor.c;
    // Ranges keep their order (a = where it started, b = the moving end); bounds() sorts them.
    this.focusTableId = tableId;
    this.selection =
      axis === 'row'
        ? { tableId, ranges: [{ a: { r: start, c: 0 }, b: { r: to, c: m.cols - 1 } }], anchor: { r: start, c: 0 }, lines: 'row' }
        : { tableId, ranges: [{ a: { r: 0, c: start }, b: { r: m.rows - 1, c: to } }], anchor: { r: 0, c: start }, lines: 'col' };
  }

  /** Move body rows (by index) so they start at index `to` (counted before the move). */
  moveRows(tableId: string, indices: number[], to: number) {
    const t = this.table(tableId);
    if (!t || this.readonly) return;
    const items = bodyItems(t) as { id: string }[];
    const pick = [...new Set(indices)].filter((i) => i >= 0 && i < items.length).sort((a, b) => a - b);
    if (!pick.length) return;
    const ids = new Set(pick.map((i) => items[i].id));
    const before = pick.filter((i) => i < to).length;
    const target = Math.max(0, Math.min(items.length - pick.length, to - before));
    if (pick.every((i, k) => i === target + k)) return; // dropped where they already are
    this.change(() => {
      const list = bodyItems(t) as { id: string }[];
      const moving = list.filter((x) => ids.has(x.id));
      const rest = list.filter((x) => !ids.has(x.id));
      rest.splice(target, 0, ...moving);
      list.splice(0, list.length, ...rest);
    });
    const m = this.model(t);
    this.selection = {
      tableId,
      ranges: [{ a: { r: target, c: 0 }, b: { r: target + pick.length - 1, c: m.cols - 1 } }],
      anchor: { r: target, c: 0 },
    };
  }

  /** Move dataTable columns (by index) so they start at index `to` (counted before the move). */
  moveColumns(tableId: string, indices: number[], to: number) {
    const t = this.table(tableId);
    if (t?.kind !== 'table' || this.readonly) return;
    const pick = [...new Set(indices)].filter((i) => i >= 0 && i < t.columns.length).sort((a, b) => a - b);
    if (!pick.length) return;
    const ids = new Set(pick.map((i) => t.columns[i].id));
    const before = pick.filter((i) => i < to).length;
    const target = Math.max(0, Math.min(t.columns.length - pick.length, to - before));
    if (pick.every((i, k) => i === target + k)) return;
    this.change(() => {
      const moving = t.columns.filter((c) => ids.has(c.id));
      const rest = t.columns.filter((c) => !ids.has(c.id));
      rest.splice(target, 0, ...moving);
      t.columns = rest;
    });
    this.selectLines(tableId, 'col', target, target + pick.length - 1);
  }

  /**
   * Drag rows out of a table onto the canvas: they become a new table (or dataTable)
   * at (x, y). Moves them, or copies them when `copy` is set (⌥ held).
   */
  extractRows(tableId: string, indices: number[], x: number, y: number, copy: boolean) {
    const t = this.table(tableId);
    if (!t || this.readonly) return;
    const items = bodyItems(t);
    const pick = [...new Set(indices)].filter((i) => i >= 0 && i < items.length).sort((a, b) => a - b);
    if (!pick.length) return;
    const ids = new Set(pick.map((i) => items[i].id));
    const plain = $state.snapshot(t) as Table;
    const count = this.sheet.tables.filter((x) => x.kind === t.kind).length + 1;
    const idMap = new Map<string, string>();
    const newId = (old: string) => {
      if (!copy) return old;
      if (!idMap.has(old)) idMap.set(old, uid());
      return idMap.get(old)!;
    };
    const styles: Record<string, string> = {};
    for (const [k, v] of Object.entries(plain.styles)) {
      const [rowId, col] = k.split('|');
      if (ids.has(rowId)) styles[`${newId(rowId)}|${col}`] = v;
    }
    let made: Table;
    if (plain.kind === 'table') {
      made = {
        ...newDataTable(`Table ${count}`, snap(x), snap(y)),
        columns: plain.columns.map((c) => ({ ...c })),
        entries: plain.entries.filter((e) => ids.has(e.id)).map((e) => ({ ...e, id: newId(e.id) })),
        styles,
      };
    } else {
      const cellSources: Record<string, CellSource> = {};
      for (const [k, v] of Object.entries(plain.cellSources)) {
        const [rowId, month] = k.split('|');
        if (ids.has(rowId)) cellSources[`${newId(rowId)}|${month}`] = v;
      }
      made = {
        ...newCashflow(`Cashflow ${count}`, snap(x), snap(y)),
        openingMonth: plain.openingMonth,
        rows: plain.rows.filter((r) => ids.has(r.id)).map((r) => ({ ...r, id: newId(r.id) })),
        cellSources,
        styles,
      };
    }
    this.change(() => {
      if (!copy) {
        if (t.kind === 'table') t.entries = t.entries.filter((e) => !ids.has(e.id));
        else {
          t.rows = t.rows.filter((r) => !ids.has(r.id));
          for (const k of Object.keys(t.cellSources)) if (ids.has(k.split('|')[0])) delete t.cellSources[k];
        }
        for (const k of Object.keys(t.styles)) if (ids.has(k.split('|')[0])) delete t.styles[k];
      }
      this.sheet.tables.push(made);
    });
    this.focusTableId = made.id;
    this.selectLines(made.id, 'row', 0, pick.length - 1);
  }

  /** Drag dataTable columns out onto the canvas: a new dataTable with those columns and every entry's values. */
  extractColumns(tableId: string, indices: number[], x: number, y: number, copy: boolean) {
    const t = this.table(tableId);
    if (t?.kind !== 'table' || this.readonly) return;
    const pick = [...new Set(indices)].filter((i) => i >= 0 && i < t.columns.length).sort((a, b) => a - b);
    if (!pick.length) return;
    if (!copy && pick.length === t.columns.length) {
      this.flashNotice('Drag the table by its title to move all of it.');
      return;
    }
    const plain = $state.snapshot(t) as DataTable;
    const cols = pick.map((i) => plain.columns[i]);
    const colIds = new Set(cols.map((c) => c.id));
    const count = this.sheet.tables.filter((x) => x.kind === 'table').length + 1;
    const entryIds = new Map(plain.entries.map((e) => [e.id, uid()]));
    const styles: Record<string, string> = {};
    for (const [k, v] of Object.entries(plain.styles)) {
      const [rowId, col] = k.split('|');
      if (colIds.has(col) && entryIds.has(rowId)) styles[`${entryIds.get(rowId)}|${col}`] = v;
    }
    const made: DataTable = {
      ...newDataTable(`Table ${count}`, snap(x), snap(y)),
      columns: cols.map((c) => ({ ...c })),
      entries: plain.entries.map((e) => ({
        id: entryIds.get(e.id)!,
        cells: Object.fromEntries(Object.entries(e.cells).filter(([k]) => colIds.has(k))),
      })),
      styles,
    };
    this.change(() => {
      if (!copy) {
        t.columns = t.columns.filter((c) => !colIds.has(c.id));
        for (const e of t.entries) for (const id of colIds) delete e.cells[id];
        for (const k of Object.keys(t.styles)) if (colIds.has(k.split('|')[1])) delete t.styles[k];
      }
      this.sheet.tables.push(made);
    });
    this.focusTableId = made.id;
    this.selectLines(made.id, 'col', 0, cols.length - 1);
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
      if (t.kind === 'table') t.entries = t.entries.filter((e) => !ids.has(e.id));
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
  selectedRow(): { table: CashflowTable; row: Row } | null {
    const sel = this.selection;
    const t = this.table(sel?.tableId);
    if (!sel || t?.kind !== 'cashflow' || sel.anchor.r >= t.rows.length) return null;
    return { table: t, row: t.rows[sel.anchor.r] };
  }

  selectedFooter(): { table: CashflowTable; footer: FooterRow } | null {
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

  /** Switch a row between manual numbers, a dataTable source and a formula. */
  setRowKind(tableId: string, rowId: string, kind: RowKind) {
    const row = this.findRow(tableId, rowId);
    if (!row || rowKind(row) === kind) return;
    this.change(() => {
      delete row.formula;
      delete row.source;
      if (kind === 'formula') row.formula = '';
      if (kind === 'source') row.source = this.defaultRowSource(this.dataTables()[0]?.dataTable);
    });
  }

  /** A row source pointing at a dataTable's first date column and main number column. */
  defaultRowSource(dataTable: DataTable | undefined): RowSource {
    return {
      tableId: dataTable?.id ?? '',
      dateCol: (dataTable && firstColumnOf(dataTable, 'date')?.id) ?? 'date',
      amountCol: (dataTable && amountColumn(dataTable.columns)?.id) ?? 'amount',
      filters: [],
      flip: false,
    };
  }

  setRowSource(tableId: string, rowId: string, patch: Partial<RowSource>) {
    const row = this.findRow(tableId, rowId);
    if (!row?.source) return;
    // Switching dataTable: pick that dataTable's columns and drop filters on the old one's columns.
    if (patch.tableId && patch.tableId !== row.source.tableId) {
      const l = this.table(patch.tableId);
      patch = { ...this.defaultRowSource(l?.kind === 'table' ? l : undefined), flip: row.source.flip, ...patch };
    }
    this.change(() => Object.assign(row.source!, patch));
  }

  // ---------- cell sources (one cell = total of a dataTable column) ----------

  /** The cash-flow body cell under the anchor, if a single month cell is the focus. */
  selectedCell(): { table: CashflowTable; row: Row; month: string; key: string } | null {
    const sel = this.selection;
    const t = this.table(sel?.tableId);
    if (!sel || t?.kind !== 'cashflow' || sel.anchor.c === 0 || sel.anchor.r >= t.rows.length) return null;
    const row = t.rows[sel.anchor.r];
    const month = this.months[sel.anchor.c - 1];
    return { table: t, row, month, key: `${row.id}|${month}` };
  }

  setCellSource(tableId: string, key: string, source: CellSource | null) {
    const t = this.table(tableId);
    if (t?.kind !== 'cashflow') return;
    this.change(() => {
      if (source) {
        t.cellSources[key] = source;
        // The dataTable total replaces a typed number in that cell.
        const [rowId, month] = key.split('|');
        const row = t.rows.find((r) => r.id === rowId);
        if (row) delete row.values[month];
      } else {
        delete t.cellSources[key];
      }
    });
  }

  /**
   * How one month cell gets its value: 'row' follows the row (its table source, or empty),
   * 'manual' is a typed number (on a source row it starts from the current value),
   * 'total' is one table column's total.
   */
  setCellMode(tableId: string, key: string, mode: 'row' | 'manual' | 'total') {
    const t = this.table(tableId);
    if (t?.kind !== 'cashflow' || this.readonly) return;
    const [rowId, month] = key.split('|');
    const row = t.rows.find((r) => r.id === rowId);
    if (!row) return;
    if (mode === 'total') {
      if (!t.cellSources[key]) this.setCellSource(tableId, key, this.defaultCellSource());
      return;
    }
    const shown = this.ev.row(t, row, month);
    this.change(() => {
      delete t.cellSources[key];
      if (mode === 'row') delete row.values[month];
      else if (row.values[month] === undefined && row.source) row.values[month] = typeof shown === 'number' ? shown : 0;
    });
  }

  updateCellSource(tableId: string, key: string, patch: Partial<CellSource>) {
    const t = this.table(tableId);
    const cur = t?.kind === 'cashflow' ? t.cellSources[key] : undefined;
    if (!cur) return;
    if (patch.tableId && patch.tableId !== cur.tableId) {
      const l = this.table(patch.tableId);
      const col = l?.kind === 'table' ? amountColumn(l.columns)?.id : undefined;
      patch = { filters: [], col: col ?? '', ...patch };
    }
    this.change(() => Object.assign(cur, patch));
  }

  defaultCellSource(): CellSource {
    const l = this.dataTables()[0]?.dataTable;
    return { tableId: l?.id ?? '', col: (l && amountColumn(l.columns)?.id) ?? 'amount', filters: [], flip: false };
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

  // ---------- dataTables ----------

  importEntries(tableId: string, entries: Entry[], mode: 'replace' | 'append', map: ImportMap, fileName: string) {
    const t = this.table(tableId);
    if (t?.kind !== 'table') return;
    this.change(() => {
      const keep = mode === 'append' ? t.entries.filter((e) => Object.keys(e.cells).length > 0) : [];
      t.entries = [...keep, ...entries];
      t.importMap = map;
      t.importedFrom = fileName;
      if (mode === 'replace') {
        for (const k of Object.keys(t.styles)) if (!k.startsWith('__')) delete t.styles[k];
      }
    });
    this.selection = null;
    this.flashNotice(`Imported ${entries.length} entries into "${t.name}".`, 'info');
  }

  /** Sort a dataTable by one column (default: its first date column). Empty cells go last. */
  sortTable(tableId: string, colId?: string, descending = false) {
    const t = this.table(tableId);
    if (t?.kind !== 'table') return;
    const col = t.columns.find((c) => c.id === colId) ?? firstColumnOf(t, 'date') ?? t.columns[0];
    if (!col) return;
    const key = (v: unknown): number | string =>
      typeof v === 'number' ? v : v === true ? 1 : typeof v === 'string' ? v.toLowerCase() : Array.isArray(v) ? v.length : '';
    this.change(() => {
      t.entries = [...t.entries].sort((a, b) => {
        const x = a.cells[col.id];
        const y = b.cells[col.id];
        if (x === undefined || y === undefined) return x === undefined ? (y === undefined ? 0 : 1) : -1;
        const kx = key(x);
        const ky = key(y);
        const d = typeof kx === 'number' && typeof ky === 'number' ? kx - ky : String(kx).localeCompare(String(ky));
        return descending ? -d : d;
      });
    });
  }

  // ---------- dataTable columns ----------

  /** Insert a text column at index `at`. */
  insertColumn(tableId: string, at: number, type: ColumnType = 'text') {
    const t = this.table(tableId);
    if (t?.kind !== 'table' || this.readonly) return;
    const id = newColumnId(t);
    const name = COLUMN_TYPE_LABELS[type] === 'Text' ? `Column ${t.columns.length + 1}` : COLUMN_TYPE_LABELS[type];
    const i = Math.max(0, Math.min(at, t.columns.length));
    this.change(() => t.columns.splice(i, 0, { id, name, type }));
    this.select(t.id, { r: 0, c: i });
  }

  renameColumn(tableId: string, colId: string, name: string) {
    const t = this.table(tableId);
    const col = t?.kind === 'table' ? t.columns.find((c) => c.id === colId) : undefined;
    const n = name.trim();
    if (col && n && n !== col.name) this.change(() => (col.name = n));
  }

  /** Change a column's type, converting what can be converted. Returns how many cells were cleared. */
  setColumnType(tableId: string, colId: string, type: ColumnType): number {
    const t = this.table(tableId);
    const col = t?.kind === 'table' ? t.columns.find((c) => c.id === colId) : undefined;
    if (!t || t.kind !== 'table' || !col || col.type === type) return 0;
    let lost = 0;
    this.change(() => {
      for (const e of t.entries) {
        const v = e.cells[col.id];
        if (v === undefined) continue;
        const out = convertCell(col.type, type, v);
        if (out === undefined) {
          delete e.cells[col.id];
          lost++;
        } else e.cells[col.id] = out;
      }
      col.type = type;
    });
    if (lost) this.flashNotice(`${lost} cell(s) couldn't be converted to ${COLUMN_TYPE_LABELS[type]} and were cleared (Undo brings them back).`);
    return lost;
  }

  /** Delete every column touched by the selection (a dataTable keeps at least one). */
  deleteSelectedColumns() {
    const sel = this.selection;
    const t = this.table(sel?.tableId);
    if (!sel) return;
    if (t?.kind !== 'table') {
      this.flashNotice('Month columns can’t be deleted; they follow the forecast window.');
      return;
    }
    const ids = new Set(cellsInRanges(sel.ranges).map((p) => t.columns[p.c]?.id).filter(Boolean));
    if (ids.size >= t.columns.length) {
      this.flashNotice('A table needs at least one column.');
      return;
    }
    this.change(() => {
      t.columns = t.columns.filter((c) => !ids.has(c.id));
      for (const e of t.entries) for (const id of ids) delete e.cells[id];
      for (const k of Object.keys(t.styles)) if (ids.has(k.split('|')[1])) delete t.styles[k];
    });
    this.select(t.id, { r: sel.anchor.r, c: Math.min(sel.anchor.c, t.columns.length - 1) });
  }

  moveColumn(tableId: string, from: number, to: number) {
    const t = this.table(tableId);
    if (t?.kind !== 'table' || from === to || to < 0 || to >= t.columns.length) return;
    this.change(() => {
      const [c] = t.columns.splice(from, 1);
      t.columns.splice(to, 0, c);
    });
  }

  // ---------- attachments ----------

  private entryCell(tableId: string, rowId: string, colId: string) {
    const t = this.table(tableId);
    if (t?.kind !== 'table') return null;
    const e = t.entries.find((x) => x.id === rowId);
    const col = t.columns.find((c) => c.id === colId && c.type === 'files');
    return e && col ? { t, e, col } : null;
  }

  attachmentsOf(tableId: string, rowId: string, colId: string): Attachment[] {
    const v = this.entryCell(tableId, rowId, colId)?.e.cells[colId];
    return Array.isArray(v) ? v : [];
  }

  /** Upload files and add them to a files cell. Returns how many were added. */
  async attachFiles(tableId: string, rowId: string, colId: string, files: File[]): Promise<number> {
    const f = this.file;
    if (!f || this.readonly || !files.length) return 0;
    const added: Attachment[] = [];
    const errors: string[] = [];
    for (const [i, file] of files.entries()) {
      this.flashNotice(`Uploading ${i + 1} of ${files.length}: ${file.name}…`, 'info');
      try {
        added.push(await attachmentStore.upload(f.id, file));
      } catch (e) {
        errors.push((e as Error).message);
      }
    }
    const hit = this.entryCell(tableId, rowId, colId);
    if (hit && added.length) {
      this.change(() => {
        const cur = hit.e.cells[colId];
        hit.e.cells[colId] = [...(Array.isArray(cur) ? cur : []), ...added];
      });
    }
    if (errors.length) this.flashNotice(errors.join(' '));
    else this.flashNotice(`Attached ${added.length} file${added.length === 1 ? '' : 's'}.`, 'info');
    return added.length;
  }

  /** Remove a file from a cell. The stored bytes stay, so Undo and snapshots still open it. */
  detachFile(tableId: string, rowId: string, colId: string, attachmentId: string) {
    const hit = this.entryCell(tableId, rowId, colId);
    if (!hit) return;
    this.change(() => {
      const cur = hit.e.cells[colId];
      const rest = (Array.isArray(cur) ? cur : []).filter((a) => a.id !== attachmentId);
      if (rest.length) hit.e.cells[colId] = rest;
      else delete hit.e.cells[colId];
    });
  }

  async openAttachment(a: Attachment, download = false) {
    if (!this.file) return;
    // Open the window first, inside the tap/click, so Safari doesn't block it as a pop-up.
    const win = download ? null : window.open('', '_blank');
    try {
      const url = await attachmentStore.url(this.file.id, a, download);
      if (win) win.location.href = url;
      else {
        const link = document.createElement('a');
        link.href = url;
        link.download = a.name;
        document.body.appendChild(link);
        link.click();
        link.remove();
      }
    } catch (e) {
      win?.close();
      this.flashNotice((e as Error).message);
    }
  }

  /**
   * Set the workspace zoom, keeping the point under (x, y) — viewport pixels, default
   * the middle of the canvas — in place.
   */
  async setZoom(z: number, at?: { x: number; y: number }) {
    const next = Math.round(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z)) * 1000) / 1000;
    const old = this.zoom;
    if (next === old) return;
    const el = this.canvasEl;
    const box = el?.getBoundingClientRect();
    const cx = box ? (at ? at.x - box.left : box.width / 2) : 0;
    const cy = box ? (at ? at.y - box.top : box.height / 2) : 0;
    const px = el ? (el.scrollLeft + cx) / old : 0;
    const py = el ? (el.scrollTop + cy) / old : 0;
    this.zoom = next;
    this.menu = null;
    if (this.file) writeStorage(ZOOM_KEY + this.file.id, String(next));
    await tick();
    if (el) {
      el.scrollLeft = px * next - cx;
      el.scrollTop = py * next - cy;
    }
  }

  zoomStep(dir: 1 | -1) {
    const z = this.zoom;
    const next = dir > 0 ? ZOOM_STEPS.find((s) => s > z + 0.001) : [...ZOOM_STEPS].reverse().find((s) => s < z - 0.001);
    if (next) void this.setZoom(next);
  }

  /** Fill the workspace with the focused table, or go back to the canvas. */
  toggleMaximize(id?: string) {
    if (this.maximizedId && (!id || id === this.maximizedId)) {
      this.maximizedId = null;
      return;
    }
    const t = this.table(id ?? this.selection?.tableId ?? this.focusTableId);
    if (t) {
      this.maximizedId = t.id;
      this.focusTableId = t.id;
    }
  }

  /** Ask the File menu to open in rename or take-snapshot mode (it edits in place there). */
  fileMenuRequest = $state<'rename' | 'snapshot' | null>(null);
  startRenameFile() {
    if (this.file && !this.readonly) this.fileMenuRequest = 'rename';
  }

  /** Flip checkbox cells: all on if any selected one is off, else all off. */
  toggleCheckboxes(cells?: Pos[]) {
    const sel = this.selection;
    const t = this.table(sel?.tableId);
    if (!sel || t?.kind !== 'table' || this.readonly) return;
    const targets = (cells ?? cellsInRanges(sel.ranges)).filter(
      (p) => p.r < t.entries.length && t.columns[p.c]?.type === 'checkbox',
    );
    if (!targets.length) return;
    const on = targets.some((p) => t.entries[p.r].cells[t.columns[p.c].id] !== true);
    this.change(() => {
      for (const p of targets) {
        const e = t.entries[p.r];
        if (on) e.cells[t.columns[p.c].id] = true;
        else delete e.cells[t.columns[p.c].id];
      }
    });
  }

  // ---------- selection ----------

  select(tableId: string, p: Pos, mode: 'new' | 'extend' | 'add' = 'new') {
    this.focusTableId = tableId;
    const sel = this.selection;
    if (mode === 'extend' && sel && sel.tableId === tableId) {
      sel.lines = undefined;
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
    // With whole rows (or columns) selected, the arrows along that axis move to the next row (column).
    if (sel.lines === 'row' && dc === 0 && dr !== 0) {
      const last = sel.ranges[sel.ranges.length - 1];
      const end = Math.min(m.rows - 1, Math.max(0, (extend ? last.b.r : sel.anchor.r) + dr));
      if (extend) this.selectLines(t.id, 'row', sel.anchor.r, end);
      else this.selectLines(t.id, 'row', end);
      return;
    }
    if (sel.lines === 'col' && dr === 0 && dc !== 0) {
      const last = sel.ranges[sel.ranges.length - 1];
      const end = Math.min(m.cols - 1, Math.max(0, (extend ? last.b.c : sel.anchor.c) + dc));
      if (extend) this.selectLines(t.id, 'col', sel.anchor.c, end);
      else this.selectLines(t.id, 'col', end);
      return;
    }
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
      .filter((p) => t.kind === 'table' ? p.c === 1 : p.c > 0)
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
    const kind = m.cellType(p);
    if (kind === 'checkbox') {
      this.toggleCheckboxes([p]);
      return;
    }
    if (kind === 'files') {
      this.filesCell = { tableId: t.id, rowId: m.rowId(p.r), colId: m.colKey(p.c) };
      return;
    }
    if (seed === undefined && t.kind === 'cashflow' && p.c > 0 && t.cellSources[`${m.rowId(p.r)}|${m.colKey(p.c)}`]) {
      this.flashNotice('This cell shows a dataTable total. Type a number to replace it, or change it in the panel.');
    }
    const cell = this.contentEl?.querySelector<HTMLElement>(
      `[data-t="${t.id}"][data-r="${p.r}"][data-c="${p.c}"]`,
    );
    if (!cell || !this.contentEl) return;
    const box = this.contentEl.getBoundingClientRect();
    const r = cell.getBoundingClientRect();
    const right = m.alignRight(p.c);
    // The editor sits inside the (possibly zoomed) content, so convert screen pixels back.
    const z = this.maximizedId ? 1 : this.zoom;
    el.style.left = `${(r.left - box.left) / z}px`;
    el.style.top = `${(r.top - box.top) / z}px`;
    el.style.width = `${Math.max(r.width / z, right ? 140 : 0)}px`;
    el.style.height = `${r.height / z}px`;
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
      this.flashNotice(ed.c === 0 && t?.kind === 'table' ? `Not a date: "${el.value}"` : `Not a number: "${el.value}"`);
    }
    el.blur();
  }

  private noticeTimer: ReturnType<typeof setTimeout> | null = null;

  /** 'info' for confirmations, 'error' (default) for problems. */
  noticeTone = $state<'info' | 'error'>('error');
  /** An optional button in the notice, e.g. Undo after a delete. */
  noticeAction = $state<{ label: string; run: () => void } | null>(null);

  flashNotice(msg: string, tone: 'info' | 'error' = 'error', action: { label: string; run: () => void } | null = null) {
    this.notice = msg;
    this.noticeTone = tone;
    this.noticeAction = action;
    if (this.noticeTimer) clearTimeout(this.noticeTimer);
    this.noticeTimer = setTimeout(() => {
      this.notice = '';
      this.noticeAction = null;
    }, action ? 6000 : 3500);
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
    if (m.raw(p) === text && (text !== '' || m.isEmpty(p))) return true;
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
    const cells = cellsInRanges(sel.ranges).filter((p) => m.editable(p) === true && !m.isEmpty(p));
    if (cells.length === 0) return;
    this.change(() => {
      for (const p of cells) {
        const kind = m.cellType(p);
        if ((kind === 'files' || kind === 'checkbox') && t.kind === 'table') delete t.entries[p.r].cells[t.columns[p.c].id];
        else m.set(p, '');
      }
    });
  }

  /** Cells under the selection that can take a text alignment (text, date and row labels). */
  private alignableCells(): { t: Table; keys: string[] } | null {
    const sel = this.selection;
    const t = this.table(sel?.tableId);
    if (!sel || !t) return null;
    const m = this.model(t);
    const keys = cellsInRanges(sel.ranges)
      .filter((p) => p.r < m.body && ['text', 'date', 'label'].includes(m.cellType(p)))
      .map((p) => styleKey(m.rowId(p.r), m.colKey(p.c)));
    return { t, keys };
  }

  canAlign(): boolean {
    return !this.readonly && (this.alignableCells()?.keys.length ?? 0) > 0;
  }

  /** The alignment of the anchor cell (left when unset), or null when it can't be aligned. */
  currentAlign(): Align | null {
    const sel = this.selection;
    const t = this.table(sel?.tableId);
    if (!sel || !t) return null;
    const m = this.model(t);
    const p = sel.anchor;
    if (p.r >= m.body || !['text', 'date', 'label'].includes(m.cellType(p))) return null;
    return t.aligns[styleKey(m.rowId(p.r), m.colKey(p.c))] ?? 'left';
  }

  /** Align text and date cells in the selection (numbers stay right, checkboxes centred). */
  applyAlign(align: Align) {
    const hit = this.alignableCells();
    if (!hit || this.readonly) return;
    if (!hit.keys.length) {
      this.flashNotice('Alignment applies to text and date cells.');
      return;
    }
    this.change(() => {
      for (const k of hit.keys) {
        if (align === 'left') delete hit.t.aligns[k];
        else hit.t.aligns[k] = align;
      }
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
    // On a dataTable, pasting onto the Total row appends new entries.
    const body = this.model(t).body;
    if (r0 > body || (r0 === body && t.kind !== 'table')) {
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
