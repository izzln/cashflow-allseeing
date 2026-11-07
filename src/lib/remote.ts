import type { FileDoc, FileMeta, FileStore, SaveResult, SnapshotDoc, SnapshotMeta, StoreEvent } from './files';
import { normalizeWorkbook, starterWorkbook, type Workbook } from './model';
import { currentMonth } from './months';

/** The server could not be reached; the caller should retry later. */
export class NetworkError extends Error {}
/** The session ended; the user must sign in again. */
export class SignInError extends Error {}

const POLL_MS = 15_000;

interface Reply {
  status: number;
  data: any;
}

/**
 * Files on the Cloudflare Worker (D1). Other windows on this device hear about
 * changes at once through a BroadcastChannel; other devices notice within
 * about 15 seconds by polling the file list while the window is visible.
 */
export class RemoteFileStore implements FileStore {
  readonly kind = 'remote';
  private channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('cashflow-allseeing') : null;
  /** Last rev / snapRev seen per file, so our own saves don't look like outside changes. */
  private known = new Map<string, { rev: number; snapRev: number; name: string }>();

  constructor(
    private base = '/api',
    private onSignedOut: () => void = () => {},
    /** Polling waits until this is true, so a signed-out page doesn't keep asking. */
    private signedIn: () => boolean = () => true,
  ) {}

  private async req(method: string, path: string, body?: unknown): Promise<Reply> {
    let res: Response;
    try {
      res = await fetch(this.base + path, {
        method,
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { 'X-Cashflow': '1', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw new NetworkError('Cannot reach the server.');
    }
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) {
      this.onSignedOut();
      throw new SignInError(data.error ?? 'Please sign in.');
    }
    if (res.status >= 500 && res.status !== 503) throw new NetworkError(data.error ?? 'Server error.');
    return { status: res.status, data };
  }

  private ok(r: Reply, ...statuses: number[]): any {
    if (r.status >= 200 && r.status < 300) return r.data;
    if (statuses.includes(r.status)) return null;
    throw new Error(r.data?.error ?? `Request failed (${r.status})`);
  }

  private remember(m: FileMeta) {
    this.known.set(m.id, { rev: m.rev, snapRev: m.snapRev ?? 0, name: m.name });
  }

  private announce(e: StoreEvent) {
    this.channel?.postMessage(e);
  }

  private parse(text: string): Workbook {
    try {
      return normalizeWorkbook(JSON.parse(text)) ?? starterWorkbook();
    } catch {
      return starterWorkbook();
    }
  }

  async list(): Promise<FileMeta[]> {
    return this.ok(await this.req('GET', '/files'));
  }

  async load(id: string): Promise<FileDoc | null> {
    const d = this.ok(await this.req('GET', `/files/${encodeURIComponent(id)}`), 404);
    if (!d) return null;
    this.remember(d.meta);
    return { meta: d.meta, wb: this.parse(d.content) };
  }

  async create(name: string, wb: Workbook = starterWorkbook(), snapshots: SnapshotDoc[] = []): Promise<FileMeta> {
    const meta: FileMeta = this.ok(
      await this.req('POST', '/files', {
        name,
        content: JSON.stringify(wb),
        month: currentMonth(),
        snapshots: snapshots.map((s) => ({ meta: s.meta, content: JSON.stringify(s.wb) })),
      }),
    );
    this.remember(meta);
    this.announce({ kind: 'list' });
    return meta;
  }

  async save(id: string, wb: Workbook, baseRev: number): Promise<SaveResult> {
    let r: Reply;
    try {
      r = await this.req('PUT', `/files/${encodeURIComponent(id)}`, {
        content: JSON.stringify(wb),
        baseRev,
        month: currentMonth(),
      });
    } catch (e) {
      if (e instanceof SignInError) return { ok: false, reason: 'signin' };
      return { ok: false, reason: 'network', message: (e as Error).message };
    }
    if (r.status === 409) return { ok: false, reason: 'conflict', current: r.data.current };
    if (r.status === 404) return { ok: false, reason: 'missing' };
    if (r.status >= 400) return { ok: false, reason: 'storage', message: r.data?.error };
    const meta: FileMeta = r.data;
    const before = this.known.get(id);
    this.remember(meta);
    this.announce({ kind: 'file', id });
    if (before && before.snapRev !== (meta.snapRev ?? 0)) this.announce({ kind: 'snapshots', id });
    return { ok: true, meta };
  }

  async rename(id: string, name: string) {
    const meta = this.ok(await this.req('PATCH', `/files/${encodeURIComponent(id)}`, { name }));
    this.remember(meta);
    this.announce({ kind: 'list' });
  }

  async duplicate(id: string) {
    const meta = this.ok(await this.req('POST', `/files/${encodeURIComponent(id)}/duplicate`), 404);
    if (meta) this.announce({ kind: 'list' });
    return meta;
  }

  async remove(id: string) {
    this.ok(await this.req('DELETE', `/files/${encodeURIComponent(id)}`));
    this.known.delete(id);
    this.announce({ kind: 'list' });
    this.announce({ kind: 'file', id });
  }

  async listSnapshots(id: string): Promise<SnapshotMeta[]> {
    return (this.ok(await this.req('GET', `/files/${encodeURIComponent(id)}/snapshots`), 404) as SnapshotMeta[]) ?? [];
  }

  async loadSnapshot(id: string, snapId: string): Promise<SnapshotDoc | null> {
    const d = this.ok(await this.req('GET', `/files/${encodeURIComponent(id)}/snapshots/${encodeURIComponent(snapId)}`), 404);
    return d ? { meta: d.meta, wb: this.parse(d.content) } : null;
  }

  async takeSnapshot(id: string, label: string): Promise<SnapshotMeta> {
    const meta = this.ok(await this.req('POST', `/files/${encodeURIComponent(id)}/snapshots`, { label, month: currentMonth() }));
    this.bumpSnap(id);
    return meta;
  }

  async deleteSnapshot(id: string, snapId: string) {
    this.ok(await this.req('DELETE', `/files/${encodeURIComponent(id)}/snapshots/${encodeURIComponent(snapId)}`));
    this.bumpSnap(id);
  }

  async ensureMonthEnd(id: string): Promise<SnapshotMeta | null> {
    const d = this.ok(await this.req('POST', `/files/${encodeURIComponent(id)}/month-end`, { month: currentMonth() }), 404);
    if (d?.snapshot) this.bumpSnap(id);
    return d?.snapshot ?? null;
  }

  private bumpSnap(id: string) {
    const k = this.known.get(id);
    if (k) k.snapRev++;
    this.announce({ kind: 'snapshots', id });
  }

  watch(cb: (e: StoreEvent) => void) {
    let stopped = false;
    let first = true;
    const poll = async () => {
      if (stopped || !this.signedIn() || (typeof document !== 'undefined' && document.visibilityState !== 'visible')) return;
      let list: FileMeta[];
      try {
        list = await this.list();
      } catch {
        return;
      }
      let listChanged = list.length !== this.known.size && !first;
      for (const m of list) {
        const k = this.known.get(m.id);
        if (!first && k) {
          if (k.rev !== m.rev) cb({ kind: 'file', id: m.id });
          if (k.snapRev !== (m.snapRev ?? 0)) cb({ kind: 'snapshots', id: m.id });
          if (k.name !== m.name || k.rev !== m.rev) listChanged = true;
        } else if (!first) {
          listChanged = true;
        }
        this.remember(m);
      }
      for (const id of [...this.known.keys()]) if (!list.some((m) => m.id === id)) this.known.delete(id);
      if (listChanged) cb({ kind: 'list' });
      first = false;
    };
    const onMessage = (e: MessageEvent<StoreEvent>) => cb(e.data);
    const onVisible = () => void poll();
    this.channel?.addEventListener('message', onMessage);
    const timer = setInterval(poll, POLL_MS);
    window.addEventListener('focus', onVisible);
    document.addEventListener('visibilitychange', onVisible);
    void poll();
    return () => {
      stopped = true;
      clearInterval(timer);
      this.channel?.removeEventListener('message', onMessage);
      window.removeEventListener('focus', onVisible);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }
}
