import {
  DEFAULT_ENERGY_MODE,
  PARKING_LOT,
  isDifficulty,
  isEnergyMode,
  isRoundMinutes,
  nicknameKey,
  type LeaderboardEntry,
  type PersonalBestEvent,
} from "@zombies/shared";

export interface Category {
  level: string;
  difficulty: string;
  /** 0 marks rounds with a non-standard test length, which never show up on leaderboards. */
  durationMinutes: number;
  energy: string;
}

export interface PlayerResult {
  playerId: string;
  /** The account that owns the nickname, when the player was logged in to it. */
  accountId: string | null;
  nickname: string;
  score: number;
  kills: number;
  headshots: number;
  deaths: number;
  shots: number;
  hits: number;
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
  const energy = params.get("energy") || DEFAULT_ENERGY_MODE;
  if (!KEY.test(level) || !isDifficulty(difficulty) || !isRoundMinutes(durationMinutes) || !isEnergyMode(energy)) return null;
  return { level, difficulty, durationMinutes, energy };
}

export function parseLimit(params: URLSearchParams): number {
  return Math.min(Math.max(Math.floor(Number(params.get("limit"))) || DEFAULT_LIMIT, 1), MAX_LIMIT);
}

/** Who is asking for a leaderboard, to mark their own entry. */
export interface Viewer {
  playerId?: string;
  nickname?: string;
  accountId?: string;
}

/**
 * Best score per player for one level / difficulty / round length / energy mode. A player is an account, or
 * for anonymous players a browser id plus a nickname, so people sharing one browser under different nicknames
 * each keep their own entry. Anonymous entries under a nickname that an account protects are left out.
 */
export async function leaderboard(db: D1Database, category: Category, limit: number, me: Viewer = {}): Promise<LeaderboardEntry[]> {
  const { results } = await db
    .prepare(
      `SELECT nickname, score, kills, headshots, deaths, endedAt, verified,
              CASE WHEN accountId IS NOT NULL THEN accountId = ?8
                   ELSE playerId = ?5 AND (?6 IS NULL OR nameKey = ?6) END AS me
         FROM (
           SELECT rp.player_id AS playerId, rp.account_id AS accountId, rp.nickname_key AS nameKey,
                  COALESCE(a.nickname, rp.nickname) AS nickname, a.email_verified_at IS NOT NULL AS verified,
                  rp.score, rp.kills, rp.headshots, rp.deaths, r.ended_at AS endedAt,
                  ROW_NUMBER() OVER (
                    PARTITION BY COALESCE(rp.account_id, rp.player_id || ':' || rp.nickname_key)
                    ORDER BY rp.score DESC, r.ended_at ASC
                  ) AS n
             FROM round_players rp
             JOIN rounds r ON r.id = rp.round_id
             LEFT JOIN accounts a ON a.id = rp.account_id
            WHERE r.level = ?1 AND r.difficulty = ?2 AND r.duration_minutes = ?3 AND r.energy = ?7
              AND (rp.account_id IS NOT NULL OR rp.nickname_key NOT IN (
                    SELECT nickname_key FROM accounts WHERE nickname_key IS NOT NULL AND email_verified_at IS NOT NULL))
         )
        WHERE n = 1
        ORDER BY score DESC, endedAt ASC
        LIMIT ?4`,
    )
    .bind(
      category.level,
      category.difficulty,
      category.durationMinutes,
      limit,
      me.playerId ?? null,
      me.nickname ? nicknameKey(me.nickname) : null,
      category.energy,
      me.accountId ?? null,
    )
    .all<Omit<LeaderboardEntry, "rank" | "me" | "verified"> & { me: number | null; verified: number | null }>();
  return results.map(({ me: mine, verified, ...row }, i) => ({ rank: i + 1, ...row, ...(mine ? { me: true } : {}), ...(verified ? { verified: true } : {}) }));
}

/**
 * Stores a finished round and reports, per player id, whether it beat the previous best of the same account,
 * or for anonymous players of the same browser and nickname.
 */
export async function recordRound(db: D1Database, round: RoundResult): Promise<Map<string, PersonalBestEvent>> {
  const identities = round.players.map((p) => ({ id: p.playerId, account: p.accountId, key: nicknameKey(p.nickname) }));
  const previous = await db
    .prepare(
      `SELECT json_extract(p.value, '$.id') AS playerId, MAX(rp.score) AS best
         FROM json_each(?4) p
         JOIN round_players rp ON CASE
                WHEN json_extract(p.value, '$.account') IS NOT NULL THEN rp.account_id = json_extract(p.value, '$.account')
                ELSE rp.account_id IS NULL AND rp.player_id = json_extract(p.value, '$.id') AND rp.nickname_key = json_extract(p.value, '$.key')
              END
         JOIN rounds r ON r.id = rp.round_id
        WHERE r.level = ?1 AND r.difficulty = ?2 AND r.duration_minutes = ?3 AND r.energy = ?5
        GROUP BY playerId`,
    )
    .bind(round.level, round.difficulty, round.durationMinutes, JSON.stringify(identities), round.energy)
    .all<{ playerId: string; best: number }>();
  const bestBefore = new Map(previous.results.map((row) => [row.playerId, row.best]));

  const roundId = crypto.randomUUID();
  await db.batch([
    db
      .prepare(
        `INSERT INTO rounds (id, session_code, level, difficulty, duration_minutes, solo, team_score, stars, ended_at, energy)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`,
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
        round.energy,
      ),
    ...round.players.map((p) =>
      db
        .prepare(
          `INSERT INTO round_players (round_id, player_id, nickname, score, kills, headshots, deaths, shots, hits, account_id, nickname_key)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)`,
        )
        .bind(roundId, p.playerId, p.nickname, p.score, p.kills, p.headshots, p.deaths, p.shots, p.hits, p.accountId, nicknameKey(p.nickname)),
    ),
  ]);

  return new Map(
    round.players.map((p) => {
      const previousBest = bestBefore.get(p.playerId) ?? null;
      return [p.playerId, { isBest: p.score > 0 && p.score > (previousBest ?? -1), previousBest }];
    }),
  );
}
