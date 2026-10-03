export interface Env {
  DB: D1Database;
  RESULTS_SECRET?: string;
}

export interface Category {
  level: string;
  difficulty: string;
  durationMinutes: number;
}

export interface PlayerResult {
  playerId: string;
  nickname: string;
  score: number;
  kills: number;
  headshots: number;
  deaths: number;
}

export interface RoundResult extends Category {
  sessionCode: string;
  solo: boolean;
  teamScore: number;
  stars: number;
  players: PlayerResult[];
}

const KEY = /^[a-z0-9-]{1,32}$/;
const PLAYER_ID = /^[A-Za-z0-9_-]{8,64}$/;
const MAX_PLAYERS = 8;

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

export function parseCategory(params: URLSearchParams): Category | null {
  const level = params.get("level") ?? "";
  const difficulty = params.get("difficulty") ?? "";
  const durationMinutes = Number(params.get("minutes"));
  if (!KEY.test(level) || !KEY.test(difficulty) || !isCount(durationMinutes, 60) || durationMinutes < 1) return null;
  return { level, difficulty, durationMinutes };
}

export function parseRoundResult(input: unknown): RoundResult | null {
  if (typeof input !== "object" || input === null) return null;
  const r = input as Record<string, unknown>;
  const { level, difficulty, durationMinutes, sessionCode, teamScore, stars, players } = r;
  if (typeof level !== "string" || !KEY.test(level)) return null;
  if (typeof difficulty !== "string" || !KEY.test(difficulty)) return null;
  if (!isCount(durationMinutes, 60) || durationMinutes < 1) return null;
  if (typeof sessionCode !== "string" || !/^[A-Z0-9]{4,12}$/.test(sessionCode)) return null;
  if (!isCount(teamScore) || !isCount(stars, 3)) return null;
  if (!Array.isArray(players) || players.length === 0 || players.length > MAX_PLAYERS) return null;

  const parsed: PlayerResult[] = [];
  for (const p of players) {
    if (typeof p !== "object" || p === null) return null;
    const { playerId, nickname, score, kills, headshots, deaths } = p as Record<string, unknown>;
    if (typeof playerId !== "string" || !PLAYER_ID.test(playerId)) return null;
    if (typeof nickname !== "string" || nickname.trim().length === 0) return null;
    if (!isCount(score) || !isCount(kills) || !isCount(headshots) || !isCount(deaths)) return null;
    parsed.push({ playerId, nickname: nickname.trim().slice(0, 16), score, kills, headshots, deaths });
  }
  return {
    level,
    difficulty,
    durationMinutes,
    sessionCode,
    solo: r.solo === true,
    teamScore,
    stars,
    players: parsed,
  };
}

function isCount(value: unknown, max = 10_000_000): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= max;
}

/** Constant-time string comparison for the shared results secret. */
export function secretMatches(provided: string, expected: string): boolean {
  const a = new TextEncoder().encode(provided);
  const b = new TextEncoder().encode(expected);
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}
