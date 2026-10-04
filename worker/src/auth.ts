import type { AccountInfo } from "@zombies/shared";

const SESSION_COOKIE = "zb_session";
const SESSION_SECONDS = 30 * 24 * 60 * 60;
/** The most PBKDF2 rounds the Workers runtime allows. */
const PBKDF2_ITERATIONS = 100_000;
const HASH_SCHEME = "pbkdf2-sha256";
const SALT_BYTES = 16;
const KEY_BITS = 256;

export interface Account {
  id: string;
  email: string;
  nickname: string | null;
  nicknameKey: string | null;
  verified: boolean;
}

interface AccountRow {
  id: string;
  email: string;
  password_hash: string;
  nickname: string | null;
  nickname_key: string | null;
  email_verified_at: string | null;
}

export const ACCOUNT_COLUMNS = "id, email, password_hash, nickname, nickname_key, email_verified_at";

export function toAccount(row: AccountRow): Account {
  return { id: row.id, email: row.email, nickname: row.nickname, nicknameKey: row.nickname_key, verified: row.email_verified_at !== null };
}

export function accountInfo(account: Account): AccountInfo {
  return { email: account.email, nickname: account.nickname, verified: account.verified };
}

function toBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

function fromBase64(text: string): Uint8Array {
  return Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
}

async function derive(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, KEY_BITS));
}

/** Stored as scheme$iterations$salt$hash, so the cost can be raised later without breaking old passwords. */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const hash = await derive(password, salt, PBKDF2_ITERATIONS);
  return [HASH_SCHEME, PBKDF2_ITERATIONS, toBase64(salt), toBase64(hash)].join("$");
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, iterations, salt, hash] = stored.split("$");
  if (scheme !== HASH_SCHEME || !iterations || !salt || !hash) return false;
  const expected = fromBase64(hash);
  const actual = await derive(password, fromBase64(salt), Number(iterations));
  if (actual.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < actual.length; i++) diff |= actual[i]! ^ expected[i]!;
  return diff === 0;
}

/** Random URL-safe secret for sessions and emailed links. */
export function randomToken(): string {
  return toBase64(crypto.getRandomValues(new Uint8Array(32))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Only hashes of tokens are stored, so a leaked database does not hand out sessions or reset links. */
export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const now = () => Math.floor(Date.now() / 1000);

function sessionCookie(request: Request, token: string, maxAge: number): string {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

function readSessionToken(request: Request): string | undefined {
  const cookies = request.headers.get("cookie") ?? "";
  for (const part of cookies.split(";")) {
    const [name, ...value] = part.trim().split("=");
    if (name === SESSION_COOKIE) return value.join("=");
  }
  return undefined;
}

/** Starts a session and returns the Set-Cookie header value for it. */
export async function startSession(request: Request, db: D1Database, accountId: string): Promise<string> {
  const token = randomToken();
  await db
    .prepare("INSERT INTO account_sessions (token_hash, account_id, expires_at) VALUES (?1, ?2, ?3)")
    .bind(await hashToken(token), accountId, now() + SESSION_SECONDS)
    .run();
  return sessionCookie(request, token, SESSION_SECONDS);
}

/** Ends the request's session and returns the Set-Cookie header value that removes the cookie. */
export async function endSession(request: Request, db: D1Database): Promise<string> {
  const token = readSessionToken(request);
  if (token) await db.prepare("DELETE FROM account_sessions WHERE token_hash = ?1").bind(await hashToken(token)).run();
  return sessionCookie(request, "", 0);
}

/** The account the request is logged in as, if any. */
export async function sessionAccount(request: Request, db: D1Database): Promise<Account | null> {
  const token = readSessionToken(request);
  if (!token) return null;
  const row = await db
    .prepare(
      `SELECT a.id, a.email, a.password_hash, a.nickname, a.nickname_key, a.email_verified_at
         FROM account_sessions s JOIN accounts a ON a.id = s.account_id
        WHERE s.token_hash = ?1 AND s.expires_at > ?2`,
    )
    .bind(await hashToken(token), now())
    .first<AccountRow>();
  return row ? toAccount(row) : null;
}

/** Creates a single-use token for an emailed link; older tokens of the same kind stop working. */
export async function createLinkToken(db: D1Database, accountId: string, kind: "verify" | "reset", seconds: number): Promise<string> {
  const token = randomToken();
  await db.batch([
    db.prepare("DELETE FROM account_tokens WHERE account_id = ?1 AND kind = ?2").bind(accountId, kind),
    db
      .prepare("INSERT INTO account_tokens (token_hash, account_id, kind, expires_at) VALUES (?1, ?2, ?3, ?4)")
      .bind(await hashToken(token), accountId, kind, now() + seconds),
  ]);
  return token;
}

/** Redeems an emailed token and returns its account id, or null when it is unknown, used or expired. */
export async function redeemLinkToken(db: D1Database, token: string, kind: "verify" | "reset"): Promise<string | null> {
  const row = await db
    .prepare("DELETE FROM account_tokens WHERE token_hash = ?1 AND kind = ?2 RETURNING account_id, expires_at")
    .bind(await hashToken(token), kind)
    .first<{ account_id: string; expires_at: number }>();
  return row && row.expires_at > now() ? row.account_id : null;
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** Whether the Worker runs on a developer's machine, where mails are logged and attempts are not limited. */
export function isLocalHost(request: Request): boolean {
  return LOCAL_HOSTS.has(new URL(request.url).hostname);
}

/**
 * Counts an attempt and reports whether it is still within `limit` per `seconds`. Local development is never
 * limited: every request there comes from the same address, and test runs register accounts in quick succession.
 */
export async function allowAttempt(request: Request, db: D1Database, key: string, limit: number, seconds: number): Promise<boolean> {
  if (isLocalHost(request)) return true;
  const time = now();
  const row = await db
    .prepare(
      `INSERT INTO auth_attempts (key, window_start, count) VALUES (?1, ?2, 1)
       ON CONFLICT (key) DO UPDATE SET
         count = CASE WHEN window_start <= ?3 THEN 1 ELSE count + 1 END,
         window_start = CASE WHEN window_start <= ?3 THEN ?2 ELSE window_start END
       RETURNING count`,
    )
    .bind(key, time, time - seconds)
    .first<{ count: number }>();
  return (row?.count ?? 1) <= limit;
}

/** State-changing requests must come from the game's own pages. */
export function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return request.headers.get("sec-fetch-site") !== "cross-site";
  try {
    // The dev server proxies from another port of the same host.
    return new URL(origin).hostname === new URL(request.url).hostname;
  } catch {
    return false;
  }
}
