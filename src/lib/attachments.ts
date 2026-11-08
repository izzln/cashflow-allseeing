import type { Attachment } from './model';
import { uid } from './model';

/** Where attached files' bytes live. Cells only hold { id, name, size, type }. */
export interface AttachmentStore {
  upload(fileId: string, file: File): Promise<Attachment>;
  /** A URL to open the file (inline when the browser can show it). */
  url(fileId: string, a: Attachment, download?: boolean): Promise<string>;
}

const MAX = 25 * 1024 * 1024;

/** Server: bytes go to the Worker, which stores them in D1 next to the file. */
export class RemoteAttachments implements AttachmentStore {
  async upload(fileId: string, file: File): Promise<Attachment> {
    if (file.size > MAX) throw new Error(`"${file.name}" is larger than 25 MB.`);
    let res: Response;
    try {
      res = await fetch(`/api/files/${encodeURIComponent(fileId)}/attachments`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'X-Cashflow': '1',
          'X-File-Name': encodeURIComponent(file.name),
          'Content-Type': file.type || 'application/octet-stream',
        },
        body: file,
      });
    } catch {
      throw new Error('Cannot reach the server.');
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error ?? `Upload failed (${res.status}).`);
    return data as Attachment;
  }

  async url(fileId: string, a: Attachment, download = false) {
    return `/api/files/${encodeURIComponent(fileId)}/attachments/${encodeURIComponent(a.id)}${download ? '?download' : ''}`;
  }
}

/** No server (development): bytes are kept in this browser's IndexedDB. */
export class LocalAttachments implements AttachmentStore {
  private db: Promise<IDBDatabase> | null = null;

  private open(): Promise<IDBDatabase> {
    this.db ??= new Promise((resolve, reject) => {
      const req = indexedDB.open('cashflow-allseeing-attachments', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('blobs');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return this.db;
  }

  private async tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const req = fn(db.transaction('blobs', mode).objectStore('blobs'));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async upload(_fileId: string, file: File): Promise<Attachment> {
    if (file.size > MAX) throw new Error(`"${file.name}" is larger than 25 MB.`);
    const a: Attachment = { id: uid(), name: file.name, size: file.size, type: file.type || 'application/octet-stream' };
    await this.tx('readwrite', (s) => s.put(new Blob([file], { type: a.type }), a.id));
    return a;
  }

  async url(_fileId: string, a: Attachment) {
    const blob = await this.tx<Blob | undefined>('readonly', (s) => s.get(a.id));
    if (!blob) throw new Error(`"${a.name}" is not stored in this browser.`);
    return URL.createObjectURL(blob);
  }
}

class Switchable implements AttachmentStore {
  constructor(public impl: AttachmentStore) {}
  upload(fileId: string, file: File) {
    return this.impl.upload(fileId, file);
  }
  url(fileId: string, a: Attachment, download?: boolean) {
    return this.impl.url(fileId, a, download);
  }
}

export const attachmentStore = new Switchable(new LocalAttachments());

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
