import { cleanNickname, isLeaderboardKind, type CreateSessionResponse, type LeaderboardResponse } from "@zombies/shared";
import { checkNickname, handleAuth, nicknameOwner } from "./accounts.ts";
import { sessionAccount, type Account } from "./auth.ts";
import type { Env } from "./env.ts";
import { json, leaderboard, parseCategory, parseLimit } from "./scores.ts";
import { generateSessionCode, isSessionCode } from "./sessionCode.ts";

export { GameSession } from "./GameSession.ts";

const CREATE_ATTEMPTS = 8;

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    const { pathname } = url;
    const method = request.method;

    if (pathname === "/api/sessions" && method === "POST") return createSession(request, env);
    const session = pathname.match(/^\/api\/sessions\/([^/]+)$/);
    if (session && method === "GET") return sessionInfo(env, session[1]!.toUpperCase());
    const socket = pathname.match(/^\/ws\/([^/]+)$/);
    if (socket && method === "GET") return connect(request, env, socket[1]!.toUpperCase());
    if (pathname === "/api/leaderboard" && method === "GET") return getLeaderboard(request, env, url.searchParams);
    if (pathname.startsWith("/api/auth/")) {
      const response = await handleAuth(request, env, pathname.slice("/api/auth/".length)).catch((err) => {
        console.error("Account request failed", err);
        return json({ account: null, error: "Accounts are unavailable right now." }, 503);
      });
      if (response) return response;
    }
    if (pathname === "/api/nicknames/check" && method === "GET") return checkNickname(request, env, url.searchParams.get("name") ?? "");
    if (pathname === "/api/health") return json({ ok: true });
    if (pathname.startsWith("/api/") || pathname.startsWith("/ws/")) return json({ error: "Not found" }, 404);
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;

/** A member is an account with a confirmed email address and a nickname; everybody else plays as a public player. */
function isMember(account: Account | null): account is Account & { nickname: string } {
  return account !== null && account.verified && account.nickname !== null;
}

function stub(env: Env, code: string) {
  return env.GAME.get(env.GAME.idFromName(code));
}

async function createSession(request: Request, env: Env): Promise<Response> {
  const options = await request.json().catch(() => null);
  if ((options as { private?: unknown } | null)?.private === true) {
    const account = await sessionAccount(request, env.DB).catch(() => null);
    if (!isMember(account)) return json({ error: "Private sessions need an account with a confirmed email address and a nickname." }, 403);
  }
  for (let attempt = 0; attempt < CREATE_ATTEMPTS; attempt++) {
    const code = generateSessionCode();
    const info = await stub(env, code).init(code, options);
    if (!info) continue;
    const body: CreateSessionResponse = { code, solo: info.solo, difficulty: info.difficulty, energy: info.energy, duration: info.duration, private: info.private };
    return json(body, 201);
  }
  return json({ error: "Could not allocate a session code" }, 503);
}

async function sessionInfo(env: Env, code: string): Promise<Response> {
  const info = isSessionCode(code) ? await stub(env, code).info() : undefined;
  return info ? json(info) : json({ exists: false }, 404);
}

async function connect(request: Request, env: Env, code: string): Promise<Response> {
  if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
    return new Response("Expected a WebSocket upgrade", { status: 426 });
  }
  if (!isSessionCode(code)) return new Response("Session not found", { status: 404 });
  const url = new URL(request.url);
  // Only this Worker may say which account a player belongs to.
  url.searchParams.delete("account");
  if (!url.searchParams.has("token")) {
    const account = await sessionAccount(request, env.DB).catch(() => null);
    if (isMember(account)) {
      // Members always play under their account's nickname.
      url.searchParams.set("name", account.nickname);
      url.searchParams.set("account", account.id);
    } else {
      const owner = await nicknameOwner(env.DB, cleanNickname(url.searchParams.get("name") ?? "")).catch(() => null);
      if (owner) return new Response("This nickname is protected", { status: 403 });
    }
  }
  return stub(env, code).fetch(new Request(url, request));
}

async function getLeaderboard(request: Request, env: Env, params: URLSearchParams): Promise<Response> {
  const category = parseCategory(params);
  if (!category) return json({ error: "difficulty, a standard round length (minutes) and a known energy mode are required" }, 400);
  try {
    const account = await sessionAccount(request, env.DB).catch(() => null);
    const me = { playerId: params.get("player") ?? undefined, nickname: params.get("name")?.trim() || undefined, accountId: account?.id };
    const requested = params.get("board");
    const board = isLeaderboardKind(requested) ? requested : "public";
    const entries = await leaderboard(env.DB, category, board, parseLimit(params), me);
    const body: LeaderboardResponse = { ...category, board, entries };
    return json(body);
  } catch (err) {
    console.error("Could not load leaderboard", err);
    return json({ error: "Leaderboard unavailable" }, 503);
  }
}
