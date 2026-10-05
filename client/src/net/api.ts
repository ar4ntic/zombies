import {
  PARKING_LOT,
  type CreateSessionResponse,
  type JoinOptions,
  type LeaderboardKind,
  type LeaderboardResponse,
  type SessionInfo,
} from "@zombies/shared";

const PLAYER_ID_KEY = "zombies.playerId";

function randomId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Anonymous id that ties this browser's rounds together for personal bests. */
export function playerId(): string {
  let id = localStorage.getItem(PLAYER_ID_KEY);
  if (!id) {
    id = randomId();
    localStorage.setItem(PLAYER_ID_KEY, id);
  }
  return id;
}

/** A failure whose message is meant for the player. */
export class UserError extends Error {}

export async function createSession(options: JoinOptions): Promise<CreateSessionResponse> {
  const res = await fetch("/api/sessions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...options, playerId: playerId() }),
  });
  if (!res.ok) {
    const message = ((await res.json().catch(() => null)) as { error?: string } | null)?.error;
    throw message ? new UserError(message) : new Error(`Could not create a session (HTTP ${res.status})`);
  }
  return res.json();
}

export async function getSession(code: string): Promise<SessionInfo | undefined> {
  const res = await fetch(`/api/sessions/${encodeURIComponent(code)}`);
  return res.ok ? res.json() : undefined;
}

/** `nickname` narrows the highlighted entry to that name; without it every entry from this browser is highlighted. */
export async function getLeaderboard(
  difficulty: string,
  minutes: number,
  energy: string,
  board: LeaderboardKind,
  nickname = "",
  limit = 10,
): Promise<LeaderboardResponse | undefined> {
  const params = new URLSearchParams({
    level: PARKING_LOT.id,
    difficulty,
    minutes: String(minutes),
    energy,
    board,
    limit: String(limit),
    player: playerId(),
  });
  if (nickname) params.set("name", nickname);
  try {
    const res = await fetch(`/api/leaderboard?${params}`);
    return res.ok ? await res.json() : undefined;
  } catch {
    return undefined;
  }
}
