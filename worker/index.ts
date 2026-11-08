import { monthEndDue, monthName, isMonthKey } from '../src/lib/months';
import { checkPassword, clearCookie, isSignedIn, passwordConfigured, sessionCookie, type AuthEnv } from './auth';
import { STATIC } from './static.generated';

const SECURITY_HEADERS = {
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
};

/** Serve the built app. File names under /assets/ contain a content hash, so they cache forever. */
function serveStatic(req: Request, pathname: string): Response {
  const file = STATIC[pathname === '/' ? '/index.html' : pathname];
  if (!file || (req.method !== 'GET' && req.method !== 'HEAD')) {
    return new Response('Not found', { status: 404, headers: SECURITY_HEADERS });
  }
  const headers: Record<string, string> = {
    ...SECURITY_HEADERS,
    'Content-Type': file.type,
    ETag: file.etag,
    'Cache-Control': pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
  };
  if (req.headers.get('If-None-Match') === file.etag) return new Response(null, { status: 304, headers });
  return new Response(req.method === 'HEAD' ? null : file.body, { headers });
}

interface Env extends AuthEnv {
  DB: D1Database;
}

interface FileRow {
  id: string;
  name: string;
  created_at: number;
  created_month: string;
  updated_at: number;
  rev: number;
  month_end_done: string | null;
  snap_rev: number;
}

interface SnapRow {
  id: string;
  label: string;
  kind: string;
  as_of: string;
  taken_at: number;
}

/** D1 rejects values over 2 MB; leave headroom. */
const MAX_CONTENT = 1_900_000;
const META = 'id, name, created_at, created_month, updated_at, rev, month_end_done, snap_rev';
const MAX_FAILURES = 10;
const MAX_ATTACHMENT = 25 * 1024 * 1024;
const CHUNK = 1_900_000;
/** Types a browser may show inline; anything else downloads, so an uploaded page can't run in our origin. */
const INLINE_TYPES = /^(image\/(png|jpeg|gif|webp|heic|heif)|application\/pdf|text\/plain)$/;
const FAILURE_WINDOW = 15 * 60_000;

class HttpError extends Error {
  constructor(public status: number, message: string, public body?: unknown) {
    super(message);
  }
}

function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
  });
}

function meta(r: FileRow) {
  return {
    id: r.id,
    name: r.name,
    createdAt: r.created_at,
    createdMonth: r.created_month,
    updatedAt: r.updated_at,
    rev: r.rev,
    monthEndDone: r.month_end_done ?? undefined,
    snapRev: r.snap_rev,
  };
}

function snapMeta(r: SnapRow) {
  return { id: r.id, label: r.label, kind: r.kind, asOf: r.as_of, takenAt: r.taken_at };
}

function newId(): string {
  const b = crypto.getRandomValues(new Uint8Array(9));
  return Array.from(b, (x) => x.toString(36).padStart(2, '0')).join('').slice(0, 14);
}

async function body<T>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new HttpError(400, 'Invalid JSON');
  }
}

function month(v: unknown): string {
  if (!isMonthKey(v)) throw new HttpError(400, 'month must be YYYY-MM');
  return v;
}

function content(v: unknown): string {
  if (typeof v !== 'string' || !v.startsWith('{')) throw new HttpError(400, 'content must be workbook JSON');
  if (v.length > MAX_CONTENT) throw new HttpError(413, 'This file is too large to save (over 1.9 MB).');
  return v;
}

function name(v: unknown): string {
  const n = typeof v === 'string' ? v.trim().slice(0, 200) : '';
  if (!n) throw new HttpError(400, 'name is required');
  return n;
}

async function getFile(db: D1Database, id: string): Promise<FileRow> {
  const row = await db.prepare(`SELECT ${META} FROM files WHERE id = ?`).bind(id).first<FileRow>();
  if (!row) throw new HttpError(404, 'File not found');
  return row;
}

/** Statements that freeze the file's current content as a snapshot, if its rev still matches. */
function snapshotStatements(db: D1Database, id: string, rev: number, label: string, kind: string, asOf: string, now: number, monthEnd: boolean) {
  const stmts = [
    db
      .prepare(
        `INSERT INTO snapshots (id, file_id, label, kind, as_of, taken_at, content)
         SELECT ?, id, ?, ?, ?, ?, content FROM files WHERE id = ? AND rev = ?`,
      )
      .bind(newId(), label, kind, asOf, now, id, rev),
    db
      .prepare(
        `UPDATE files SET snap_rev = snap_rev + 1${monthEnd ? ', month_end_done = ?' : ''} WHERE id = ? AND rev = ?`,
      )
      .bind(...(monthEnd ? [asOf, id, rev] : [id, rev])),
  ];
  return stmts;
}

// ---------- routes ----------

async function api(req: Request, env: Env, path: string[], url: URL): Promise<Response> {
  const db = env.DB;
  const method = req.method;
  const now = Date.now();

  if (path[0] === 'session' && method === 'GET') {
    return json({ server: true, configured: passwordConfigured(env), signedIn: await isSignedIn(env, req) });
  }

  if (path[0] === 'login' && method === 'POST') {
    if (!passwordConfigured(env)) throw new HttpError(503, 'No password is set yet. Add the EDITOR_PASSWORD secret in Cloudflare.');
    const ip = req.headers.get('CF-Connecting-IP') ?? 'local';
    const recent = await db
      .prepare('SELECT COUNT(*) AS n FROM login_failures WHERE ip = ? AND at > ?')
      .bind(ip, now - FAILURE_WINDOW)
      .first<{ n: number }>();
    if ((recent?.n ?? 0) >= MAX_FAILURES) throw new HttpError(429, 'Too many wrong passwords. Try again in 15 minutes.');
    const { password } = await body<{ password?: string }>(req);
    if (!(await checkPassword(env, String(password ?? '')))) {
      await db.batch([
        db.prepare('INSERT INTO login_failures (ip, at) VALUES (?, ?)').bind(ip, now),
        db.prepare('DELETE FROM login_failures WHERE at < ?').bind(now - 86400_000),
      ]);
      throw new HttpError(401, 'Wrong password.');
    }
    return json({ ok: true }, 200, { 'Set-Cookie': await sessionCookie(env, now) });
  }

  if (path[0] === 'logout' && method === 'POST') {
    return json({ ok: true }, 200, { 'Set-Cookie': clearCookie() });
  }

  if (!(await isSignedIn(env, req))) throw new HttpError(401, 'Please sign in.');
  // Changes need this header: other sites can't send it without a CORS preflight, which we never answer.
  if (method !== 'GET' && req.headers.get('X-Cashflow') !== '1') throw new HttpError(403, 'Missing request header.');

  if (path[0] !== 'files') throw new HttpError(404, 'Not found');
  const [, id, sub, sid] = path;

  // /api/files
  if (!id) {
    if (method === 'GET') {
      const { results } = await db.prepare(`SELECT ${META} FROM files ORDER BY updated_at DESC`).all<FileRow>();
      return json(results.map(meta));
    }
    if (method === 'POST') {
      const b = await body<{ name?: string; content?: string; month?: string; snapshots?: { meta: SnapRow & Record<string, unknown>; content: string }[] }>(req);
      const fileId = newId();
      const createdMonth = month(b.month);
      const snaps = Array.isArray(b.snapshots) ? b.snapshots : [];
      const done = snaps
        .filter((s) => s?.meta?.kind === 'month-end' && isMonthKey(s.meta.asOf))
        .map((s) => String(s.meta.asOf))
        .sort()
        .pop() ?? null;
      await db
        .prepare(
          `INSERT INTO files (id, name, created_at, created_month, updated_at, rev, month_end_done, snap_rev, content)
           VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)`,
        )
        .bind(fileId, name(b.name), now, createdMonth, now, done, snaps.length ? 1 : 0, content(b.content))
        .run();
      // Imported snapshots, a few per batch to stay within request limits.
      for (let i = 0; i < snaps.length; i += 5) {
        await db.batch(
          snaps.slice(i, i + 5).map((s) =>
            db
              .prepare('INSERT INTO snapshots (id, file_id, label, kind, as_of, taken_at, content) VALUES (?, ?, ?, ?, ?, ?, ?)')
              .bind(
                newId(),
                fileId,
                String(s.meta?.label ?? 'Snapshot').slice(0, 200),
                s.meta?.kind === 'month-end' ? 'month-end' : 'manual',
                isMonthKey(s.meta?.asOf) ? String(s.meta.asOf) : createdMonth,
                Number(s.meta?.takenAt) || now,
                content(s.content),
              ),
          ),
        );
      }
      return json(meta(await getFile(db, fileId)), 201);
    }
    throw new HttpError(405, 'Method not allowed');
  }

  // /api/files/:id
  if (!sub) {
    if (method === 'GET') {
      const row = await db.prepare(`SELECT ${META}, content FROM files WHERE id = ?`).bind(id).first<FileRow & { content: string }>();
      if (!row) throw new HttpError(404, 'File not found');
      return json({ meta: meta(row), content: row.content });
    }
    if (method === 'PUT') {
      const b = await body<{ content?: string; baseRev?: number; month?: string }>(req);
      const text = content(b.content);
      const cur = await getFile(db, id);
      if (cur.rev !== b.baseRev) throw new HttpError(409, 'Changed elsewhere', { current: meta(cur) });
      const stmts = [];
      const due = monthEndDue(cur.created_month, cur.month_end_done, month(b.month));
      if (due) stmts.push(...snapshotStatements(db, id, cur.rev, `End of ${monthName(due)}`, 'month-end', due, now, true));
      stmts.push(
        db.prepare('UPDATE files SET content = ?, rev = rev + 1, updated_at = ? WHERE id = ? AND rev = ?').bind(text, now, id, cur.rev),
      );
      const res = await db.batch(stmts);
      if (res[res.length - 1].meta.changes !== 1) {
        throw new HttpError(409, 'Changed elsewhere', { current: meta(await getFile(db, id)) });
      }
      return json(meta(await getFile(db, id)));
    }
    if (method === 'PATCH') {
      const b = await body<{ name?: string }>(req);
      await getFile(db, id);
      await db.prepare('UPDATE files SET name = ? WHERE id = ?').bind(name(b.name), id).run();
      return json(meta(await getFile(db, id)));
    }
    if (method === 'DELETE') {
      await db.batch([
        db.prepare('DELETE FROM snapshots WHERE file_id = ?').bind(id),
        db.prepare('DELETE FROM attachment_chunks WHERE file_id = ?').bind(id),
        db.prepare('DELETE FROM attachments WHERE file_id = ?').bind(id),
        db.prepare('DELETE FROM files WHERE id = ?').bind(id),
      ]);
      return json({ ok: true });
    }
    throw new HttpError(405, 'Method not allowed');
  }

  // /api/files/:id/duplicate
  if (sub === 'duplicate' && method === 'POST') {
    const src = await getFile(db, id);
    const copy = newId();
    await db.batch([
      db
        .prepare(
          `INSERT INTO files (id, name, created_at, created_month, updated_at, rev, month_end_done, snap_rev, content)
           SELECT ?, name || ' copy', ?, created_month, ?, 1, month_end_done, snap_rev, content FROM files WHERE id = ?`,
        )
        .bind(copy, now, now, src.id),
      db
        .prepare(
          `INSERT INTO snapshots (id, file_id, label, kind, as_of, taken_at, content)
           SELECT lower(hex(randomblob(7))), ?, label, kind, as_of, taken_at, content FROM snapshots WHERE file_id = ?`,
        )
        .bind(copy, src.id),
      // The copy's cells point at the same attachment ids, so copy the files too.
      db
        .prepare(
          `INSERT INTO attachments (file_id, id, name, type, size, chunks, created_at)
           SELECT ?, id, name, type, size, chunks, created_at FROM attachments WHERE file_id = ?`,
        )
        .bind(copy, src.id),
      db
        .prepare(
          `INSERT INTO attachment_chunks (file_id, attachment_id, seq, data)
           SELECT ?, attachment_id, seq, data FROM attachment_chunks WHERE file_id = ?`,
        )
        .bind(copy, src.id),
    ]);
    return json(meta(await getFile(db, copy)), 201);
  }

  // /api/files/:id/month-end
  if (sub === 'month-end' && method === 'POST') {
    const b = await body<{ month?: string }>(req);
    const cur = await getFile(db, id);
    const due = monthEndDue(cur.created_month, cur.month_end_done, month(b.month));
    if (!due) return json({ snapshot: null });
    await db.batch(snapshotStatements(db, id, cur.rev, `End of ${monthName(due)}`, 'month-end', due, now, true));
    const snap = await db
      .prepare('SELECT id, label, kind, as_of, taken_at FROM snapshots WHERE file_id = ? AND kind = ? AND as_of = ? ORDER BY taken_at DESC')
      .bind(id, 'month-end', due)
      .first<SnapRow>();
    return json({ snapshot: snap ? snapMeta(snap) : null });
  }

  // /api/files/:id/attachments[/:aid]
  if (sub === 'attachments') {
    if (!sid && method === 'POST') {
      await getFile(db, id);
      const rawName = req.headers.get('X-File-Name') ?? 'file';
      let fileName = 'file';
      try {
        fileName = decodeURIComponent(rawName).replace(/[\u0000-\u001f/\\]/g, '_').slice(0, 200) || 'file';
      } catch {
        // keep the default
      }
      const type = (req.headers.get('Content-Type') ?? 'application/octet-stream').split(';')[0].trim().slice(0, 100);
      const bytes = new Uint8Array(await req.arrayBuffer());
      if (bytes.length === 0) throw new HttpError(400, 'The file is empty.');
      if (bytes.length > MAX_ATTACHMENT) throw new HttpError(413, 'Files can be at most 25 MB.');
      const aid = newId();
      const chunks = Math.ceil(bytes.length / CHUNK);
      const stmts = [
        db
          .prepare('INSERT INTO attachments (file_id, id, name, type, size, chunks, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
          .bind(id, aid, fileName, type, bytes.length, chunks, now),
      ];
      for (let i = 0; i < chunks; i++) {
        stmts.push(
          db
            .prepare('INSERT INTO attachment_chunks (file_id, attachment_id, seq, data) VALUES (?, ?, ?, ?)')
            .bind(id, aid, i, bytes.slice(i * CHUNK, (i + 1) * CHUNK).buffer),
        );
      }
      await db.batch(stmts);
      return json({ id: aid, name: fileName, size: bytes.length, type }, 201);
    }
    if (sid && method === 'GET') {
      const a = await db
        .prepare('SELECT name, type, size, chunks FROM attachments WHERE file_id = ? AND id = ?')
        .bind(id, sid)
        .first<{ name: string; type: string; size: number; chunks: number }>();
      if (!a) throw new HttpError(404, 'Attachment not found');
      const out = new Uint8Array(a.size);
      let at = 0;
      // One chunk per query keeps each result small.
      for (let i = 0; i < a.chunks; i++) {
        const row = await db
          .prepare('SELECT data FROM attachment_chunks WHERE file_id = ? AND attachment_id = ? AND seq = ?')
          .bind(id, sid, i)
          .first<{ data: ArrayBuffer | number[] }>();
        if (!row) throw new HttpError(500, 'Attachment is incomplete');
        const part = row.data instanceof ArrayBuffer ? new Uint8Array(row.data) : Uint8Array.from(row.data);
        out.set(part, at);
        at += part.length;
      }
      const inline = INLINE_TYPES.test(a.type) && url.searchParams.get('download') === null;
      const encoded = encodeURIComponent(a.name);
      return new Response(out, {
        headers: {
          'Content-Type': inline ? a.type : 'application/octet-stream',
          'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${encoded}"; filename*=UTF-8''${encoded}`,
          'Content-Security-Policy': "sandbox; default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'",
          'X-Content-Type-Options': 'nosniff',
          'Cache-Control': 'private, max-age=31536000, immutable',
        },
      });
    }
    throw new HttpError(405, 'Method not allowed');
  }

  // /api/files/:id/snapshots[/:sid]
  if (sub === 'snapshots') {
    if (!sid && method === 'GET') {
      const { results } = await db
        .prepare('SELECT id, label, kind, as_of, taken_at FROM snapshots WHERE file_id = ? ORDER BY taken_at DESC')
        .bind(id)
        .all<SnapRow>();
      return json(results.map(snapMeta));
    }
    if (!sid && method === 'POST') {
      const b = await body<{ label?: string; month?: string }>(req);
      const cur = await getFile(db, id);
      const label = (typeof b.label === 'string' && b.label.trim().slice(0, 200)) || 'Snapshot';
      const stmts = snapshotStatements(db, id, cur.rev, label, 'manual', month(b.month), now, false);
      const res = await db.batch(stmts);
      if (res[0].meta.changes !== 1) throw new HttpError(409, 'The file changed while taking the snapshot. Try again.');
      const snap = await db
        .prepare('SELECT id, label, kind, as_of, taken_at FROM snapshots WHERE file_id = ? ORDER BY taken_at DESC, rowid DESC')
        .bind(id)
        .first<SnapRow>();
      return json(snapMeta(snap!), 201);
    }
    if (sid && method === 'GET') {
      const row = await db
        .prepare('SELECT id, label, kind, as_of, taken_at, content FROM snapshots WHERE id = ? AND file_id = ?')
        .bind(sid, id)
        .first<SnapRow & { content: string }>();
      if (!row) throw new HttpError(404, 'Snapshot not found');
      return json({ meta: snapMeta(row), content: row.content });
    }
    if (sid && method === 'DELETE') {
      await db.batch([
        db.prepare('DELETE FROM snapshots WHERE id = ? AND file_id = ?').bind(sid, id),
        db.prepare('UPDATE files SET snap_rev = snap_rev + 1 WHERE id = ?').bind(id),
      ]);
      return json({ ok: true });
    }
  }
  throw new HttpError(404, 'Not found');
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (!url.pathname.startsWith('/api/')) return serveStatic(req, url.pathname);
    const path = url.pathname.slice(5).split('/').filter(Boolean).map(decodeURIComponent);
    try {
      return await api(req, env, path, url);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message, ...(e.body as object) }, e.status);
      console.error(e);
      return json({ error: 'Server error' }, 500);
    }
  },
} satisfies ExportedHandler<Env>;
