import type { CreateSessionResponse } from "@zombies/shared";
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
    if (pathname === "/api/leaderboard" && method === "GET") return getLeaderboard(env, url.searchParams);
    if (pathname === "/api/health") return json({ ok: true });
    if (pathname.startsWith("/api/") || pathname.startsWith("/ws/")) return json({ error: "Not found" }, 404);
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;

function stub(env: Env, code: string) {
  return env.GAME.get(env.GAME.idFromName(code));
}

async function createSession(request: Request, env: Env): Promise<Response> {
  const options = await request.json().catch(() => null);
  for (let attempt = 0; attempt < CREATE_ATTEMPTS; attempt++) {
    const code = generateSessionCode();
    const info = await stub(env, code).init(code, options);
    if (!info) continue;
    const body: CreateSessionResponse = { code, solo: info.solo, difficulty: info.difficulty, energy: info.energy, duration: info.duration };
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
  return stub(env, code).fetch(request);
}

async function getLeaderboard(env: Env, params: URLSearchParams): Promise<Response> {
  const category = parseCategory(params);
  if (!category) return json({ error: "difficulty, a standard round length (minutes) and a known energy mode are required" }, 400);
  try {
    const playerId = params.get("player");
    const me = playerId ? { playerId, nickname: params.get("name")?.trim() || undefined } : undefined;
    const entries = await leaderboard(env.DB, category, parseLimit(params), me);
    return json({ ...category, entries });
  } catch (err) {
    console.error("Could not load leaderboard", err);
    return json({ error: "Leaderboard unavailable" }, 503);
  }
}
