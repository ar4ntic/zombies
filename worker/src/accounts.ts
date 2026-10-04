import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  cleanNickname,
  isClaimableNickname,
  nicknameKey,
  type AccountResponse,
  type NicknameCheck,
} from "@zombies/shared";
import {
  ACCOUNT_COLUMNS,
  accountInfo,
  allowAttempt,
  createLinkToken,
  endSession,
  hashPassword,
  redeemLinkToken,
  sameOrigin,
  sessionAccount,
  startSession,
  toAccount,
  verifyPassword,
  type Account,
} from "./auth.ts";
import type { Env } from "./env.ts";
import { sendMail } from "./mail.ts";
import { isPlayerId, json } from "./scores.ts";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const EMAIL_MAX_LENGTH = 254;
const VERIFY_SECONDS = 24 * 60 * 60;
const RESET_SECONDS = 60 * 60;
/** Accounts whose email was never confirmed stop blocking their email and nickname after this long. */
const UNVERIFIED_DAYS = 7;
const HOUR = 60 * 60;

type Body = Record<string, unknown>;

function reply(account: Account | null, extra: Partial<AccountResponse> = {}, status = 200, cookie?: string): Response {
  const body: AccountResponse = { account: account ? accountInfo(account) : null, ...extra };
  return json(body, status, cookie ? { "set-cookie": cookie } : {});
}

const fail = (error: string, status = 400) => reply(null, { error }, status);

function clientAddress(request: Request): string {
  return request.headers.get("cf-connecting-ip") ?? "local";
}

function parseEmail(value: unknown): string | null {
  const email = typeof value === "string" ? value.trim().toLowerCase() : "";
  return email.length <= EMAIL_MAX_LENGTH && EMAIL.test(email) ? email : null;
}

function parsePassword(value: unknown): string | null {
  return typeof value === "string" && value.length >= PASSWORD_MIN_LENGTH && value.length <= PASSWORD_MAX_LENGTH ? value : null;
}

async function findAccount(db: D1Database, column: "id" | "email", value: string) {
  return db.prepare(`SELECT ${ACCOUNT_COLUMNS} FROM accounts WHERE ${column} = ?1`).bind(value).first<Parameters<typeof toAccount>[0]>();
}

/** Removes accounts that never confirmed their email and would otherwise keep this email or nickname taken. */
async function purgeStale(db: D1Database, email: string | null, key: string | null) {
  const before = new Date(Date.now() - UNVERIFIED_DAYS * 24 * HOUR * 1000).toISOString();
  await db
    .prepare("DELETE FROM accounts WHERE email_verified_at IS NULL AND created_at < ?1 AND (email = ?2 OR nickname_key = ?3)")
    .bind(before, email, key)
    .run();
}

async function sendVerification(request: Request, env: Env, account: Account): Promise<boolean> {
  const token = await createLinkToken(env.DB, account.id, "verify", VERIFY_SECONDS);
  return sendMail(request, env, {
    to: account.email,
    subject: "Confirm your Zombie Breakout account",
    intro: "Welcome to Zombie Breakout! Confirm your email address to protect your nickname:",
    linkLabel: "Confirm my email address",
    link: `${new URL(request.url).origin}/verify#${token}`,
    outro: "The link works for 24 hours. If you did not create an account, you can ignore this mail.",
  });
}

/**
 * Hands the rounds this browser played under the account's nickname before it was protected over to the account,
 * so its leaderboard entries stay.
 */
async function adoptRounds(db: D1Database, account: Account, playerId: unknown) {
  if (!account.verified || !account.nicknameKey || !isPlayerId(playerId)) return;
  await db
    .prepare("UPDATE round_players SET account_id = ?1 WHERE account_id IS NULL AND player_id = ?2 AND nickname_key = ?3")
    .bind(account.id, playerId, account.nicknameKey)
    .run();
}

/** The verified account that owns a nickname, if any. */
export async function nicknameOwner(db: D1Database, name: string): Promise<string | null> {
  const row = await db
    .prepare("SELECT id FROM accounts WHERE nickname_key = ?1 AND email_verified_at IS NOT NULL")
    .bind(nicknameKey(name))
    .first<{ id: string }>();
  return row?.id ?? null;
}

export async function checkNickname(request: Request, env: Env, name: string): Promise<Response> {
  const [owner, account] = await Promise.all([nicknameOwner(env.DB, name), sessionAccount(request, env.DB)]);
  const body: NicknameCheck = { protected: owner !== null, mine: owner !== null && owner === account?.id };
  return json(body);
}

/** Handles /api/auth/*; returns undefined for paths it does not know. */
export async function handleAuth(request: Request, env: Env, path: string): Promise<Response | undefined> {
  const { method } = request;
  const db = env.DB;
  if (path === "me" && method === "GET") return reply(await sessionAccount(request, db));
  if (method !== "POST" && method !== "PUT" && method !== "DELETE") return undefined;
  if (!sameOrigin(request)) return fail("Request not allowed", 403);
  const body = ((await request.json().catch(() => null)) ?? {}) as Body;
  const ip = clientAddress(request);

  switch (`${method} ${path}`) {
    case "POST register": {
      const email = parseEmail(body.email);
      const password = parsePassword(body.password);
      if (!email) return fail("Please enter a valid email address.");
      if (!password) return fail(`The password needs at least ${PASSWORD_MIN_LENGTH} characters.`);
      if (!(await allowAttempt(request, db, `register:${ip}`, 5, HOUR))) return fail("Too many attempts. Please try again later.", 429);
      await purgeStale(db, email, null);
      const id = crypto.randomUUID();
      const created = await db
        .prepare("INSERT INTO accounts (id, email, password_hash, created_at) VALUES (?1, ?2, ?3, ?4) ON CONFLICT (email) DO NOTHING")
        .bind(id, email, await hashPassword(password), new Date().toISOString())
        .run();
      if (created.meta.changes === 0) return fail("An account with this email address already exists. Log in instead.", 409);
      const account: Account = { id, email, nickname: null, nicknameKey: null, verified: false };
      const mailSent = await sendVerification(request, env, account);
      return reply(account, { mailSent }, 201, await startSession(request, db, id));
    }

    case "POST login": {
      const email = parseEmail(body.email);
      const password = typeof body.password === "string" ? body.password : "";
      if (!email || !password) return fail("Email address or password is wrong.", 401);
      if (!(await allowAttempt(request, db, `login:${ip}:${email}`, 8, HOUR / 4))) return fail("Too many attempts. Please try again later.", 429);
      const row = await findAccount(db, "email", email);
      if (!row || !(await verifyPassword(password, row.password_hash))) return fail("Email address or password is wrong.", 401);
      const account = toAccount(row);
      await adoptRounds(db, account, body.playerId);
      return reply(account, {}, 200, await startSession(request, db, account.id));
    }

    case "POST logout":
      return reply(null, {}, 200, await endSession(request, db));

    case "POST verify": {
      const accountId = typeof body.token === "string" ? await redeemLinkToken(db, body.token, "verify") : null;
      if (!accountId) return fail("This confirmation link is no longer valid. Log in and request a new one.");
      await db
        .prepare("UPDATE accounts SET email_verified_at = COALESCE(email_verified_at, ?2) WHERE id = ?1")
        .bind(accountId, new Date().toISOString())
        .run();
      const row = await findAccount(db, "id", accountId);
      if (!row) return fail("Account not found.", 404);
      const account = toAccount(row);
      await adoptRounds(db, account, body.playerId);
      // The link may be opened in another browser than the one that registered, which stays logged out.
      const current = await sessionAccount(request, db);
      return reply(current?.id === account.id ? account : current, {});
    }

    case "POST forgot": {
      const email = parseEmail(body.email);
      if (!email) return fail("Please enter a valid email address.");
      if (!(await allowAttempt(request, db, `forgot:${ip}`, 5, HOUR))) return fail("Too many attempts. Please try again later.", 429);
      const row = await findAccount(db, "email", email);
      if (row) {
        const token = await createLinkToken(db, row.id, "reset", RESET_SECONDS);
        await sendMail(request, env, {
          to: email,
          subject: "Reset your Zombie Breakout password",
          intro: "Someone asked to reset the password of your Zombie Breakout account. Choose a new one here:",
          linkLabel: "Choose a new password",
          link: `${new URL(request.url).origin}/reset#${token}`,
          outro: "The link works for one hour. If that was not you, you can ignore this mail; your password stays as it is.",
        });
      }
      // The same answer whether or not the address has an account.
      return reply(null, { mailSent: true });
    }

    case "POST reset": {
      const password = parsePassword(body.password);
      if (!password) return fail(`The password needs at least ${PASSWORD_MIN_LENGTH} characters.`);
      const accountId = typeof body.token === "string" ? await redeemLinkToken(db, body.token, "reset") : null;
      if (!accountId) return fail("This reset link is no longer valid. Request a new one.");
      // Opening the mailed link also proves the address, and every other device is logged out.
      await db.batch([
        db
          .prepare("UPDATE accounts SET password_hash = ?2, email_verified_at = COALESCE(email_verified_at, ?3) WHERE id = ?1")
          .bind(accountId, await hashPassword(password), new Date().toISOString()),
        db.prepare("DELETE FROM account_sessions WHERE account_id = ?1").bind(accountId),
      ]);
      const row = await findAccount(db, "id", accountId);
      if (!row) return fail("Account not found.", 404);
      return reply(toAccount(row), {}, 200, await startSession(request, db, accountId));
    }
  }

  const account = await sessionAccount(request, db);
  if (!account) return fail("Please log in first.", 401);

  switch (`${method} ${path}`) {
    case "POST resend": {
      if (account.verified) return reply(account);
      if (!(await allowAttempt(request, db, `resend:${account.id}`, 3, HOUR))) return reply(account, { error: "Too many attempts. Please try again later." }, 429);
      return reply(account, { mailSent: await sendVerification(request, env, account) });
    }

    case "PUT nickname": {
      const nickname = typeof body.nickname === "string" ? cleanNickname(body.nickname) : "";
      if (!isClaimableNickname(nickname)) {
        return reply(account, { error: "Use 3 to 16 letters or digits; single spaces, dots, dashes and underscores are fine inside." }, 400);
      }
      if (!(await allowAttempt(request, db, `nickname:${account.id}`, 10, HOUR))) return reply(account, { error: "Too many attempts. Please try again later." }, 429);
      const key = nicknameKey(nickname);
      await purgeStale(db, null, key);
      const taken = await db.prepare("SELECT id FROM accounts WHERE nickname_key = ?1 AND id <> ?2").bind(key, account.id).first();
      if (taken) return reply(account, { error: "This nickname already belongs to another account." }, 409);
      try {
        await db.prepare("UPDATE accounts SET nickname = ?2, nickname_key = ?3 WHERE id = ?1").bind(account.id, nickname, key).run();
      } catch {
        // Somebody else took the nickname between the check and the update.
        return reply(account, { error: "This nickname already belongs to another account." }, 409);
      }
      const updated: Account = { ...account, nickname, nicknameKey: key };
      await adoptRounds(db, updated, body.playerId);
      return reply(updated);
    }

    case "DELETE me": {
      const row = await findAccount(db, "id", account.id);
      const password = typeof body.password === "string" ? body.password : "";
      if (!row || !(await verifyPassword(password, row.password_hash))) return reply(account, { error: "The password is wrong." }, 401);
      // Played rounds stay on the leaderboards as anonymous entries.
      await db.batch([
        db.prepare("UPDATE round_players SET account_id = NULL WHERE account_id = ?1").bind(account.id),
        db.prepare("DELETE FROM accounts WHERE id = ?1").bind(account.id),
      ]);
      return reply(null, {}, 200, await endSession(request, db));
    }
  }
  return undefined;
}
