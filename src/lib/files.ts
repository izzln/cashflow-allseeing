import { normalizeWorkbook, starterWorkbook, uid, type Workbook } from './model';

/** One cash-flow file: a workbook with its own sheets and tables. */
export interface FileMeta {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  /** Goes up by one on every save. Used to catch edits from another window. */
  rev: number;
}

export interface FileDoc {
  meta: FileMeta;
  wb: Workbook;
}

export type SaveResult =
  | { ok: true; meta: FileMeta }
  | { ok: false; reason: 'conflict'; current: FileMeta }
  | { ok: false; reason: 'missing' | 'storage' };

/**
 * Where files live. Phase 1 keeps them in browser storage; phase 3 adds a
 * Cloudflare-backed implementation with the same shape.
 */
export interface FileStore {
  list(): Promise<FileMeta[]>;
  load(id: string): Promise<FileDoc | null>;
  create(name: string, wb?: Workbook): Promise<FileMeta>;
  /** Save only if the stored rev still equals baseRev, unless force is set. */
  save(id: string, wb: Workbook, baseRev: number, force?: boolean): Promise<SaveResult>;
  rename(id: string, name: string): Promise<void>;
  duplicate(id: string): Promise<FileMeta | null>;
  remove(id: string): Promise<void>;
}

/** The subset of the Web Storage API we use, so tests can pass a fake. */
export interface KV {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const PREFIX = 'cashflow-allseeing.';
const INDEX_KEY = `${PREFIX}files`;
const LEGACY_KEY = `${PREFIX}workbook.v1`;

export function fileKey(id: string): string {
  return `${PREFIX}file.${id}`;
}

export function isFileKey(key: string | null): boolean {
  return !!key && (key.startsWith(`${PREFIX}file.`) || key === INDEX_KEY);
}

export class LocalFileStore implements FileStore {
  constructor(private kv: KV) {
    this.migrateLegacy();
  }

  private readIndex(): FileMeta[] {
    try {
      const raw = JSON.parse(this.kv.getItem(INDEX_KEY) ?? '[]');
      return Array.isArray(raw) ? raw : [];
    } catch {
      return [];
    }
  }

  private writeIndex(list: FileMeta[]) {
    this.kv.setItem(INDEX_KEY, JSON.stringify(list));
  }

  private patchMeta(id: string, patch: Partial<FileMeta>): FileMeta | null {
    const list = this.readIndex();
    const i = list.findIndex((m) => m.id === id);
    if (i < 0) return null;
    list[i] = { ...list[i], ...patch };
    this.writeIndex(list);
    return list[i];
  }

  /** Phase 1 kept a single workbook; turn it into the first file. */
  private migrateLegacy() {
    const raw = this.kv.getItem(LEGACY_KEY);
    if (raw === null) return;
    try {
      const wb = normalizeWorkbook(JSON.parse(raw));
      if (wb) this.createSync('My cash flow', wb);
      this.kv.removeItem(LEGACY_KEY);
    } catch {
      // Leave the old data in place if it cannot be read.
    }
  }

  private createSync(name: string, wb: Workbook): FileMeta {
    const now = Date.now();
    const meta: FileMeta = { id: uid(), name, createdAt: now, updatedAt: now, rev: 1 };
    this.kv.setItem(fileKey(meta.id), JSON.stringify(wb));
    this.writeIndex([...this.readIndex(), meta]);
    return meta;
  }

  async list() {
    return this.readIndex().sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async load(id: string) {
    const meta = this.readIndex().find((m) => m.id === id);
    const raw = this.kv.getItem(fileKey(id));
    if (!meta || raw === null) return null;
    try {
      const wb = normalizeWorkbook(JSON.parse(raw));
      return wb ? { meta, wb } : null;
    } catch {
      return null;
    }
  }

  async create(name: string, wb: Workbook = starterWorkbook()) {
    return this.createSync(name, wb);
  }

  // Written without awaits so the write finishes synchronously, which keeps
  // saves on page close reliable.
  async save(id: string, wb: Workbook, baseRev: number, force = false): Promise<SaveResult> {
    const current = this.readIndex().find((m) => m.id === id);
    if (!current) return { ok: false, reason: 'missing' };
    if (!force && current.rev !== baseRev) return { ok: false, reason: 'conflict', current };
    try {
      this.kv.setItem(fileKey(id), JSON.stringify(wb));
    } catch {
      return { ok: false, reason: 'storage' };
    }
    const meta = this.patchMeta(id, { rev: current.rev + 1, updatedAt: Date.now() })!;
    return { ok: true, meta };
  }

  async rename(id: string, name: string) {
    const n = name.trim();
    if (n) this.patchMeta(id, { name: n, updatedAt: Date.now() });
  }

  async duplicate(id: string) {
    const doc = await this.load(id);
    return doc ? this.createSync(`${doc.meta.name} copy`, doc.wb) : null;
  }

  async remove(id: string) {
    this.kv.removeItem(fileKey(id));
    this.writeIndex(this.readIndex().filter((m) => m.id !== id));
  }
}

// ---------- snapshots (downloaded files) ----------

export const SNAPSHOT_FORMAT = 'cashflow-allseeing';

export interface Snapshot {
  format: typeof SNAPSHOT_FORMAT;
  version: 1;
  name: string;
  exportedAt: string;
  workbook: Workbook;
}

export function toSnapshot(name: string, wb: Workbook, now = new Date()): Snapshot {
  return { format: SNAPSHOT_FORMAT, version: 1, name, exportedAt: now.toISOString(), workbook: wb };
}

/** Read a downloaded snapshot. Also accepts a bare workbook (phase 1 backups). */
export function fromSnapshot(
  raw: unknown,
  fallbackName: string,
): { name: string; wb: Workbook; exportedAt?: string } | null {
  if (raw && typeof raw === 'object' && (raw as Snapshot).format === SNAPSHOT_FORMAT) {
    const s = raw as Snapshot;
    const wb = normalizeWorkbook(s.workbook);
    const exportedAt = typeof s.exportedAt === 'string' ? s.exportedAt.slice(0, 10) : undefined;
    return wb ? { name: String(s.name || fallbackName), wb, exportedAt } : null;
  }
  const wb = normalizeWorkbook(raw);
  return wb ? { name: fallbackName, wb } : null;
}

/** Name for a reopened snapshot, so it can't be mistaken for the file it came from. */
export function importedName(name: string, existing: string[], exportedAt?: string): string {
  if (!existing.includes(name)) return name;
  const base = `${name} (snapshot${exportedAt ? ` ${exportedAt}` : ''})`;
  let n = base;
  for (let i = 2; existing.includes(n); i++) n = `${base} ${i}`;
  return n;
}

export function snapshotFilename(name: string, now = new Date()): string {
  const d = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const safe = name.replace(/[\\/:*?"<>|]+/g, '-').trim() || 'cashflow';
  return `${safe} ${d}.json`;
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

export const fileStore: FileStore = new LocalFileStore(browserKV());
