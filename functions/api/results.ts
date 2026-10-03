import { json, parseRoundResult, secretMatches, type Env } from "../../cloudflare/scores";

/** Stores a finished round. Only the game server may call this (Bearer RESULTS_SECRET). */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!env.RESULTS_SECRET) return json({ error: "Results are not configured" }, 503);
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!secretMatches(token, env.RESULTS_SECRET)) return json({ error: "Unauthorized" }, 401);

  const round = parseRoundResult(await request.json().catch(() => null));
  if (!round) return json({ error: "Invalid round result" }, 400);

  const ids = round.players.map((p) => p.playerId);
  const previous = await env.DB.prepare(
    `SELECT rp.player_id AS playerId, MAX(rp.score) AS best
       FROM round_players rp JOIN rounds r ON r.id = rp.round_id
      WHERE r.level = ?1 AND r.difficulty = ?2 AND r.duration_minutes = ?3
        AND rp.player_id IN (SELECT value FROM json_each(?4))
      GROUP BY rp.player_id`,
  )
    .bind(round.level, round.difficulty, round.durationMinutes, JSON.stringify(ids))
    .all<{ playerId: string; best: number }>();
  const bestBefore = new Map(previous.results.map((row) => [row.playerId, row.best]));

  const roundId = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO rounds (id, session_code, level, difficulty, duration_minutes, solo, team_score, stars, ended_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`,
    ).bind(
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
      env.DB.prepare(
        `INSERT INTO round_players (round_id, player_id, nickname, score, kills, headshots, deaths)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
      ).bind(roundId, p.playerId, p.nickname, p.score, p.kills, p.headshots, p.deaths),
    ),
  ]);

  const personalBests = round.players
    .filter((p) => p.score > 0 && p.score > (bestBefore.get(p.playerId) ?? -1))
    .map((p) => p.playerId);
  return json({ roundId, personalBests }, 201);
};
