/**
 * Single-owner login. The password is the EDITOR_PASSWORD secret (set in the
 * Cloudflare dashboard). A session is a signed cookie: changing the password or
 * SESSION_SECRET signs everyone out.
 */

export interface AuthEnv {
  EDITOR_PASSWORD?: string;
  SESSION_SECRET?: string;
}

const COOKIE = 'cashflow_session';
const SESSION_DAYS = 90;
const enc = new TextEncoder();

function b64url(bytes: ArrayBuffer): string {
  let s = '';
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function hmacKey(env: AuthEnv): Promise<CryptoKey> {
  const material = await crypto.subtle.digest('SHA-256', enc.encode(`${env.EDITOR_PASSWORD}|${env.SESSION_SECRET ?? ''}`));
  return crypto.subtle.importKey('raw', material, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

async function sign(env: AuthEnv, payload: string): Promise<string> {
  return b64url(await crypto.subtle.sign('HMAC', await hmacKey(env), enc.encode(payload)));
}

/** Compare two strings in constant time (by comparing their hashes). */
async function sameSecret(a: string, b: string): Promise<boolean> {
  const [x, y] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(a)),
    crypto.subtle.digest('SHA-256', enc.encode(b)),
  ]);
  const u = new Uint8Array(x);
  const v = new Uint8Array(y);
  let diff = 0;
  for (let i = 0; i < u.length; i++) diff |= u[i] ^ v[i];
  return diff === 0;
}

export function passwordConfigured(env: AuthEnv): boolean {
  return !!env.EDITOR_PASSWORD && env.EDITOR_PASSWORD.length >= 8;
}

export async function checkPassword(env: AuthEnv, attempt: string): Promise<boolean> {
  return passwordConfigured(env) && (await sameSecret(attempt, env.EDITOR_PASSWORD!));
}

export async function sessionCookie(env: AuthEnv, now = Date.now()): Promise<string> {
  const expires = now + SESSION_DAYS * 86400_000;
  const payload = `v1.${expires}`;
  const value = `${payload}.${await sign(env, payload)}`;
  return `${COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_DAYS * 86400}`;
}

export function clearCookie(): string {
  return `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}

export async function isSignedIn(env: AuthEnv, req: Request, now = Date.now()): Promise<boolean> {
  if (!passwordConfigured(env)) return false;
  const cookie = req.headers.get('Cookie') ?? '';
  const m = new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`).exec(cookie);
  if (!m) return false;
  const parts = m[1].split('.');
  if (parts.length !== 3 || parts[0] !== 'v1') return false;
  const expires = Number(parts[1]);
  if (!Number.isFinite(expires) || expires < now) return false;
  return sameSecret(parts[2], await sign(env, `v1.${parts[1]}`));
}
