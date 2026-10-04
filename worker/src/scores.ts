import { PARKING_LOT, isDifficulty, isRoundMinutes, type LeaderboardEntry, type PersonalBestEvent } from "@zombies/shared";

export interface Category {
  level: string;
  difficulty: string;
  /** 0 marks rounds with a non-standard test length, which never show up on leaderboards. */
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
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", ...headers },
  });
}

export function isPlayerId(value: unknown): value is string {
  return typeof value === "string" && PLAYER_ID.test(value);
}

export function parseCategory(params: URLSearchParams): Category | null {
  const level = params.get("level") || PARKING_LOT.id;
  const difficulty = params.get("difficulty");
  const durationMinutes = Number(params.get("minutes"));
  if (!KEY.test(level) || !isDifficulty(difficulty) || !isRoundMinutes(durationMinutes)) return null;
  return { level, difficulty, durationMinutes };
}

export function parseLimit(params: URLSearchParams): number {
  return Math.min(Math.max(Math.floor(Number(params.get("limit"))) || DEFAULT_LIMIT, 1), MAX_LIMIT);
}

/**
 * Best score per player for one level / difficulty / round length. A player is a browser id plus a nickname,
 * so people sharing one browser under different nicknames each keep their own entry.
 */
export async function leaderboard(db: D1Database, category: Category, limit: number, me?: { playerId: string; nickname?: string }): Promise<LeaderboardEntry[]> {
  const { results } = await db
    .prepare(
      `SELECT nickname, score, kills, headshots, deaths, endedAt,
              (playerId = ?5 AND (?6 IS NULL OR nameKey = lower(?6))) AS me
         FROM (
           SELECT rp.player_id AS playerId, lower(rp.nickname) AS nameKey, rp.nickname, rp.score, rp.kills, rp.headshots, rp.deaths,
                  r.ended_at AS endedAt,
                  ROW_NUMBER() OVER (PARTITION BY rp.player_id, lower(rp.nickname) ORDER BY rp.score DESC, r.ended_at ASC) AS n
             FROM round_players rp JOIN rounds r ON r.id = rp.round_id
            WHERE r.level = ?1 AND r.difficulty = ?2 AND r.duration_minutes = ?3
         )
        WHERE n = 1
        ORDER BY score DESC, endedAt ASC
        LIMIT ?4`,
    )
    .bind(category.level, category.difficulty, category.durationMinutes, limit, me?.playerId ?? null, me?.nickname ?? null)
    .all<Omit<LeaderboardEntry, "rank" | "me"> & { me: number | null }>();
  return results.map(({ me: mine, ...row }, i) => ({ rank: i + 1, ...row, ...(mine ? { me: true } : {}) }));
}

/** Stores a finished round and reports, per player id, whether it beat the previous best under the same nickname. */
export async function recordRound(db: D1Database, round: RoundResult): Promise<Map<string, PersonalBestEvent>> {
  const identities = round.players.map((p) => ({ id: p.playerId, name: p.nickname }));
  const previous = await db
    .prepare(
      `SELECT rp.player_id AS playerId, MAX(rp.score) AS best
         FROM round_players rp
         JOIN rounds r ON r.id = rp.round_id
         JOIN json_each(?4) p ON rp.player_id = json_extract(p.value, '$.id') AND lower(rp.nickname) = lower(json_extract(p.value, '$.name'))
        WHERE r.level = ?1 AND r.difficulty = ?2 AND r.duration_minutes = ?3
        GROUP BY rp.player_id`,
    )
    .bind(round.level, round.difficulty, round.durationMinutes, JSON.stringify(identities))
    .all<{ playerId: string; best: number }>();
  const bestBefore = new Map(previous.results.map((row) => [row.playerId, row.best]));

  const roundId = crypto.randomUUID();
  await db.batch([
    db
      .prepare(
        `INSERT INTO rounds (id, session_code, level, difficulty, duration_minutes, solo, team_score, stars, ended_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`,
      )
      .bind(
        roundId,
        round.sessionCode,
        round.level,
        round.difficulty,
        round.durationMinutes,
        round.solo ? 1 : 0,
        round.teamScore,
        round.stars,
        new Date().toISOString(),
      ),
    ...round.players.map((p) =>
      db
        .prepare(
          `INSERT INTO round_players (round_id, player_id, nickname, score, kills, headshots, deaths)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
        )
        .bind(roundId, p.playerId, p.nickname, p.score, p.kills, p.headshots, p.deaths),
    ),
  ]);

  return new Map(
    round.players.map((p) => {
      const previousBest = bestBefore.get(p.playerId) ?? null;
      return [p.playerId, { isBest: p.score > 0 && p.score > (previousBest ?? -1), previousBest }];
    }),
  );
}
