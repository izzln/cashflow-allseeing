import { localFileStore, useFileStore, type FileMeta } from './files';
import { RemoteFileStore } from './remote';
import { attachmentStore, RemoteAttachments } from './attachments';

const UPLOADED_KEY = 'cashflow-allseeing.uploaded';

/**
 * Decides at startup where files live. If the app is served by the Cloudflare
 * Worker, files are on the server and editing needs a sign-in; otherwise (e.g.
 * `npm run dev`) files stay in this browser.
 */
class Session {
  mode = $state<'checking' | 'local' | 'remote'>('checking');
  /** Whether the server has an EDITOR_PASSWORD set. */
  configured = $state(true);
  signedIn = $state(false);

  async init() {
    try {
      const res = await fetch('/api/session', { cache: 'no-store', credentials: 'same-origin' });
      const data = res.ok ? await res.json() : null;
      if (!data?.server) throw new Error('no server');
      this.configured = !!data.configured;
      this.signedIn = !!data.signedIn;
      useFileStore(new RemoteFileStore('/api', () => (this.signedIn = false), () => this.signedIn));
      attachmentStore.impl = new RemoteAttachments();
      this.mode = 'remote';
    } catch {
      this.mode = 'local';
      this.signedIn = true;
    }
  }

  async login(password: string): Promise<string | null> {
    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'X-Cashflow': '1' },
        body: JSON.stringify({ password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return data.error ?? 'Could not sign in.';
      this.signedIn = true;
      return null;
    } catch {
      return 'Cannot reach the server.';
    }
  }

  async logout() {
    await fetch('/api/logout', { method: 'POST', credentials: 'same-origin', headers: { 'X-Cashflow': '1' } }).catch(() => {});
    this.signedIn = false;
  }

  /** Files still kept only in this browser (from before the server existed). */
  async localOnlyFiles(): Promise<FileMeta[]> {
    if (this.mode !== 'remote') return [];
    const done = new Set(readUploaded());
    return (await localFileStore.list()).filter((f) => !done.has(f.id));
  }

  markUploaded(id: string) {
    const list = readUploaded();
    list.push(id);
    try {
      localStorage.setItem(UPLOADED_KEY, JSON.stringify(list));
    } catch {
      // Not fatal: the banner may offer the file again.
    }
  }
}

function readUploaded(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(UPLOADED_KEY) ?? '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

export const session = new Session();
