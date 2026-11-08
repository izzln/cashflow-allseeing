import { normalizeWorkbook, starterWorkbook, uid, type Workbook } from './model';
import { currentMonth, isMonthKey, monthEndDue, monthName, type MonthKey } from './months';

/** One cash-flow file: a workbook with its own sheets, tables and snapshots. */
export interface FileMeta {
  id: string;
  name: string;
  createdAt: number;
  /** Last time the content was saved (renames don't count). */
  updatedAt: number;
  /** Goes up by one on every content save. */
  rev: number;
  /** The last month that already has its month-end snapshot. */
  monthEndDone?: MonthKey;
  /** Server only: goes up when snapshots are added or removed. */
  snapRev?: number;
}

export interface FileDoc {
  meta: FileMeta;
  wb: Workbook;
}

/** A frozen copy of a file's content, kept inside the file. */
export interface SnapshotMeta {
  id: string;
  label: string;
  kind: 'manual' | 'month-end';
  /** The month the snapshot represents; its view starts at this month. */
  asOf: MonthKey;
  takenAt: number;
}

export interface SnapshotDoc {
  meta: SnapshotMeta;
  wb: Workbook;
}

export type SaveResult =
  | { ok: true; meta: FileMeta }
  | { ok: false; reason: 'conflict'; current: FileMeta }
  /** network: offline or server unreachable (retry); signin: the session ended. */
  | { ok: false; reason: 'missing' | 'storage' | 'network' | 'signin'; message?: string };

/** Something changed outside this window. */
export type StoreEvent = { kind: 'list' } | { kind: 'file'; id: string } | { kind: 'snapshots'; id: string };

/**
 * Where files live. Today: browser storage. Phase 3 adds a Cloudflare-backed
 * implementation with the same shape (the month-end rule then runs on the server).
 */
export interface FileStore {
  readonly kind: 'local' | 'remote';
  list(): Promise<FileMeta[]>;
  load(id: string): Promise<FileDoc | null>;
  create(name: string, wb?: Workbook, snapshots?: SnapshotDoc[]): Promise<FileMeta>;
  /** Save only if the stored rev still equals baseRev. On 'conflict', load, merge and retry. */
  save(id: string, wb: Workbook, baseRev: number): Promise<SaveResult>;
  rename(id: string, name: string): Promise<void>;
  duplicate(id: string): Promise<FileMeta | null>;
  remove(id: string): Promise<void>;
  listSnapshots(id: string): Promise<SnapshotMeta[]>;
  loadSnapshot(id: string, snapId: string): Promise<SnapshotDoc | null>;
  /** Freeze the saved content now. */
  takeSnapshot(id: string, label: string): Promise<SnapshotMeta>;
  deleteSnapshot(id: string, snapId: string): Promise<void>;
  /** Take the month-end snapshot if a month has ended since the last one. */
  ensureMonthEnd(id: string, now?: Date): Promise<SnapshotMeta | null>;
  /** Hear about changes made in other windows (and, for the server, other devices). */
  watch(cb: (e: StoreEvent) => void): () => void;
}

/** The subset of the Web Storage API we use, so tests can pass a fake. */
export interface KV {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const PREFIX = 'cashflow-allseeing.';
const INDEX_KEY = `${PREFIX}files`;

export function fileKey(id: string): string {
  return `${PREFIX}file.${id}`;
}
const snapIndexKey = (id: string) => `${fileKey(id)}.snaps`;
const snapKey = (id: string, sid: string) => `${fileKey(id)}.snap.${sid}`;

export function isFileKey(key: string | null): boolean {
  return !!key && (key.startsWith(`${PREFIX}file.`) || key === INDEX_KEY);
}

export function isSnapshotKey(key: string | null, fileId: string): boolean {
  return !!key && key.startsWith(`${fileKey(fileId)}.snap`);
}

export { monthName };

function monthOf(ts: number): MonthKey {
  return currentMonth(new Date(ts));
}

/** Stable storage keys use the file id; written without awaits so writes finish synchronously. */
export class LocalFileStore implements FileStore {
  readonly kind = 'local';

  constructor(private kv: KV) {}

  private readJSON<T>(key: string, fallback: T): T {
    try {
      const raw = this.kv.getItem(key);
      return raw === null ? fallback : (JSON.parse(raw) as T);
    } catch {
      return fallback;
    }
  }

  private readIndex(): FileMeta[] {
    const list = this.readJSON<FileMeta[]>(INDEX_KEY, []);
    return Array.isArray(list) ? list : [];
  }

  private writeIndex(list: FileMeta[]) {
    this.kv.setItem(INDEX_KEY, JSON.stringify(list));
  }

  private meta(id: string): FileMeta | undefined {
    return this.readIndex().find((m) => m.id === id);
  }

  private patchMeta(id: string, patch: Partial<FileMeta>): FileMeta | null {
    const list = this.readIndex();
    const i = list.findIndex((m) => m.id === id);
    if (i < 0) return null;
    list[i] = { ...list[i], ...patch };
    this.writeIndex(list);
    return list[i];
  }

  private readWorkbook(key: string): Workbook | null {
    return normalizeWorkbook(this.readJSON<unknown>(key, null));
  }

  private createSync(name: string, wb: Workbook, snapshots: SnapshotDoc[]): FileMeta {
    const now = Date.now();
    const meta: FileMeta = { id: uid(), name, createdAt: now, updatedAt: now, rev: 1 };
    this.kv.setItem(fileKey(meta.id), JSON.stringify(wb));
    if (snapshots.length) {
      for (const s of snapshots) this.kv.setItem(snapKey(meta.id, s.meta.id), JSON.stringify(s.wb));
      this.kv.setItem(snapIndexKey(meta.id), JSON.stringify(snapshots.map((s) => s.meta)));
      // Don't re-freeze months the imported file already covered.
      const done = snapshots
        .filter((s) => s.meta.kind === 'month-end')
        .map((s) => s.meta.asOf)
        .sort()
        .pop();
      if (done) meta.monthEndDone = done;
    }
    this.writeIndex([...this.readIndex(), meta]);
    return meta;
  }

  async list() {
    return this.readIndex().sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async load(id: string) {
    const meta = this.meta(id);
    const wb = meta ? this.readWorkbook(fileKey(id)) : null;
    return meta && wb ? { meta, wb } : null;
  }

  async create(name: string, wb: Workbook = starterWorkbook(), snapshots: SnapshotDoc[] = []) {
    return this.createSync(name, wb, snapshots);
  }

  async save(id: string, wb: Workbook, baseRev: number): Promise<SaveResult> {
    const current = this.meta(id);
    if (!current) return { ok: false, reason: 'missing' };
    if (current.rev !== baseRev) return { ok: false, reason: 'conflict', current };
    try {
      // Freeze last month's content before the first change of a new month.
      this.monthEndSync(id);
      this.kv.setItem(fileKey(id), JSON.stringify(wb));
    } catch {
      return { ok: false, reason: 'storage' };
    }
    const meta = this.patchMeta(id, { rev: current.rev + 1, updatedAt: Date.now() })!;
    return { ok: true, meta };
  }

  async rename(id: string, name: string) {
    const n = name.trim();
    if (n) this.patchMeta(id, { name: n });
  }

  async duplicate(id: string) {
    const doc = await this.load(id);
    if (!doc) return null;
    const snaps = (await this.listSnapshots(id))
      .map((m) => ({ meta: m, wb: this.readWorkbook(snapKey(id, m.id)) }))
      .filter((s): s is SnapshotDoc => !!s.wb);
    return this.createSync(`${doc.meta.name} copy`, doc.wb, snaps);
  }

  async remove(id: string) {
    for (const s of await this.listSnapshots(id)) this.kv.removeItem(snapKey(id, s.id));
    this.kv.removeItem(snapIndexKey(id));
    this.kv.removeItem(fileKey(id));
    this.writeIndex(this.readIndex().filter((m) => m.id !== id));
  }

  async listSnapshots(id: string) {
    const list = this.readJSON<SnapshotMeta[]>(snapIndexKey(id), []);
    return (Array.isArray(list) ? list : []).sort((a, b) => b.takenAt - a.takenAt);
  }

  async loadSnapshot(id: string, snapId: string) {
    const meta = (await this.listSnapshots(id)).find((s) => s.id === snapId);
    const wb = meta ? this.readWorkbook(snapKey(id, snapId)) : null;
    return meta && wb ? { meta, wb } : null;
  }

  private addSnapshot(id: string, meta: SnapshotMeta, wb: Workbook) {
    this.kv.setItem(snapKey(id, meta.id), JSON.stringify(wb));
    const list = this.readJSON<SnapshotMeta[]>(snapIndexKey(id), []);
    this.kv.setItem(snapIndexKey(id), JSON.stringify([...list, meta]));
  }

  async takeSnapshot(id: string, label: string, now = new Date()) {
    const wb = this.readWorkbook(fileKey(id));
    if (!wb) throw new Error('File not found');
    const meta: SnapshotMeta = {
      id: uid(),
      label: label.trim() || `Snapshot ${now.toLocaleDateString()}`,
      kind: 'manual',
      asOf: currentMonth(now),
      takenAt: now.getTime(),
    };
    this.addSnapshot(id, meta, wb);
    return meta;
  }

  async deleteSnapshot(id: string, snapId: string) {
    this.kv.removeItem(snapKey(id, snapId));
    const list = this.readJSON<SnapshotMeta[]>(snapIndexKey(id), []);
    this.kv.setItem(snapIndexKey(id), JSON.stringify(list.filter((s) => s.id !== snapId)));
  }

  async ensureMonthEnd(id: string, now = new Date()) {
    return this.monthEndSync(id, now);
  }

  /** Other windows of this browser announce writes through storage events. */
  watch(cb: (e: StoreEvent) => void) {
    if (typeof window === 'undefined') return () => {};
    const on = (e: StorageEvent) => {
      if (!isFileKey(e.key)) return;
      cb({ kind: 'list' });
      if (e.key === INDEX_KEY) {
        // A save writes the content first and the new rev into the index second; another
        // window can see the first notice before the second write, so also report every
        // file whose rev changed in the index.
        const revs = (v: string | null) => {
          try {
            return new Map((JSON.parse(v ?? '[]') as FileMeta[]).map((m) => [m.id, m.rev]));
          } catch {
            return new Map<string, number>();
          }
        };
        const before = revs(e.oldValue);
        for (const [id, rev] of revs(e.newValue)) if (before.get(id) !== rev) cb({ kind: 'file', id });
        return;
      }
      const rest = (e.key ?? '').slice(fileKey('').length);
      const [id, sub] = rest.split('.');
      if (id) cb(sub?.startsWith('snap') ? { kind: 'snapshots', id } : { kind: 'file', id });
    };
    window.addEventListener('storage', on);
    return () => window.removeEventListener('storage', on);
  }

  /**
   * The saved content is unchanged since its last save, so if that save was
   * before this month, it is exactly the content at last month's end.
   */
  private monthEndSync(id: string, now = new Date()): SnapshotMeta | null {
    const meta = this.meta(id);
    if (!meta) return null;
    const lastEnded = monthEndDue(monthOf(meta.createdAt), meta.monthEndDone, currentMonth(now));
    if (!lastEnded) return null;
    const wb = this.readWorkbook(fileKey(id));
    if (!wb) return null;
    const snap: SnapshotMeta = {
      id: uid(),
      label: `End of ${monthName(lastEnded)}`,
      kind: 'month-end',
      asOf: lastEnded,
      takenAt: now.getTime(),
    };
    this.addSnapshot(id, snap, wb);
    this.patchMeta(id, { monthEndDone: lastEnded });
    return snap;
  }
}

// ---------- downloaded files ----------

export const EXPORT_FORMAT = 'cashflow-allseeing';

export interface ExportFile {
  format: typeof EXPORT_FORMAT;
  version: 2;
  name: string;
  exportedAt: string;
  workbook: Workbook;
  snapshots: { meta: SnapshotMeta; workbook: Workbook }[];
}

export function toExport(
  name: string,
  wb: Workbook,
  snapshots: SnapshotDoc[] = [],
  now = new Date(),
): ExportFile {
  return {
    format: EXPORT_FORMAT,
    version: 2,
    name,
    exportedAt: now.toISOString(),
    workbook: wb,
    snapshots: snapshots.map((s) => ({ meta: s.meta, workbook: s.wb })),
  };
}

function normalizeSnapshotMeta(raw: any): SnapshotMeta | null {
  if (!raw || typeof raw !== 'object') return null;
  return {
    id: String(raw.id ?? uid()),
    label: String(raw.label ?? 'Snapshot'),
    kind: raw.kind === 'month-end' ? 'month-end' : 'manual',
    asOf: isMonthKey(raw.asOf) ? raw.asOf : currentMonth(),
    takenAt: Number(raw.takenAt) || Date.now(),
  };
}

/** Read a downloaded file. */
export function fromExport(
  raw: unknown,
  fallbackName: string,
): { name: string; wb: Workbook; snapshots: SnapshotDoc[]; exportedAt?: string } | null {
  const f = raw as ExportFile;
  if (!f || typeof f !== 'object' || f.format !== EXPORT_FORMAT) return null;
  const wb = normalizeWorkbook(f.workbook);
  if (!wb) return null;
  const snapshots = (Array.isArray(f.snapshots) ? f.snapshots : [])
    .map((s) => ({ meta: normalizeSnapshotMeta(s?.meta), wb: normalizeWorkbook(s?.workbook) }))
    .filter((s): s is SnapshotDoc => !!s.meta && !!s.wb);
  const exportedAt = typeof f.exportedAt === 'string' ? f.exportedAt.slice(0, 10) : undefined;
  return { name: String(f.name || fallbackName), wb, snapshots, exportedAt };
}

/** Name for an imported file, so it can't be mistaken for the file it came from. */
export function importedName(name: string, existing: string[], exportedAt?: string): string {
  if (!existing.includes(name)) return name;
  const base = `${name} (copy${exportedAt ? ` ${exportedAt}` : ''})`;
  let n = base;
  for (let i = 2; existing.includes(n); i++) n = `${base} ${i}`;
  return n;
}

export function exportFilename(name: string, now = new Date()): string {
  const d = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const safe = name.replace(/[\\/:*?"<>|]+/g, '-').trim() || 'cashflow';
  return `${safe} ${d}.json`;
}

/** Everything needed to download a file, including its snapshots. */
export async function buildExport(store: FileStore, id: string): Promise<ExportFile | null> {
  const doc = await store.load(id);
  if (!doc) return null;
  const snaps: SnapshotDoc[] = [];
  for (const m of await store.listSnapshots(id)) {
    const s = await store.loadSnapshot(id, m.id);
    if (s) snaps.push(s);
  }
  return toExport(doc.meta.name, doc.wb, snaps);
}

// ---------- the store used by the app ----------

function browserKV(): KV {
  try {
    const t = `${PREFIX}probe`;
    localStorage.setItem(t, '1');
    localStorage.removeItem(t);
    return localStorage;
  } catch {
    // Storage blocked (e.g. some private modes): keep files in memory for this tab.
    const m = new Map<string, string>();
    return {
      getItem: (k) => m.get(k) ?? null,
      setItem: (k, v) => void m.set(k, v),
      removeItem: (k) => void m.delete(k),
    };
  }
}

/** Files kept in this browser (used when there is no server, and for uploading them to it). */
export const localFileStore = new LocalFileStore(browserKV());

/** Hands every call to the current store, so the app can switch to the server after startup. */
class SwitchableStore implements FileStore {
  constructor(public impl: FileStore) {}
  get kind() { return this.impl.kind; }
  list() { return this.impl.list(); }
  load(id: string) { return this.impl.load(id); }
  create(name: string, wb?: Workbook, snapshots?: SnapshotDoc[]) { return this.impl.create(name, wb, snapshots); }
  save(id: string, wb: Workbook, baseRev: number) { return this.impl.save(id, wb, baseRev); }
  rename(id: string, name: string) { return this.impl.rename(id, name); }
  duplicate(id: string) { return this.impl.duplicate(id); }
  remove(id: string) { return this.impl.remove(id); }
  listSnapshots(id: string) { return this.impl.listSnapshots(id); }
  loadSnapshot(id: string, snapId: string) { return this.impl.loadSnapshot(id, snapId); }
  takeSnapshot(id: string, label: string) { return this.impl.takeSnapshot(id, label); }
  deleteSnapshot(id: string, snapId: string) { return this.impl.deleteSnapshot(id, snapId); }
  ensureMonthEnd(id: string, now?: Date) { return this.impl.ensureMonthEnd(id, now); }
  watch(cb: (e: StoreEvent) => void) { return this.impl.watch(cb); }
}

export const fileStore = new SwitchableStore(localFileStore);

export function useFileStore(store: FileStore) {
  fileStore.impl = store;
}
