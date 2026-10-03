import { json, parseCategory, type Env } from "../../cloudflare/scores";

interface Row {
  playerId: string;
  nickname: string;
  score: number;
  kills: number;
  headshots: number;
  deaths: number;
  endedAt: string;
}

/** Best score per player for one level / difficulty / round length. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const params = new URL(request.url).searchParams;
  const category = parseCategory(params);
  if (!category) return json({ error: "level, difficulty and minutes are required" }, 400);
  const limit = Math.min(Math.max(Number(params.get("limit")) || 10, 1), 25);

  const { results } = await env.DB.prepare(
    `SELECT playerId, nickname, score, kills, headshots, deaths, endedAt FROM (
       SELECT rp.player_id AS playerId, rp.nickname, rp.score, rp.kills, rp.headshots, rp.deaths, r.ended_at AS endedAt,
              ROW_NUMBER() OVER (PARTITION BY rp.player_id ORDER BY rp.score DESC, r.ended_at ASC) AS n
         FROM round_players rp JOIN rounds r ON r.id = rp.round_id
        WHERE r.level = ?1 AND r.difficulty = ?2 AND r.duration_minutes = ?3
     )
     WHERE n = 1
     ORDER BY score DESC, endedAt ASC
     LIMIT ?4`,
  )
    .bind(category.level, category.difficulty, category.durationMinutes, limit)
    .all<Row>();

  const entries = results.map(({ playerId: _playerId, ...row }, i) => ({ rank: i + 1, ...row }));
  return json({ ...category, entries }, 200, { "cache-control": "public, max-age=30" });
};
