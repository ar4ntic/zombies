CREATE TABLE IF NOT EXISTS rounds (
  id TEXT PRIMARY KEY,
  session_code TEXT NOT NULL,
  level TEXT NOT NULL,
  difficulty TEXT NOT NULL,
  duration_minutes INTEGER NOT NULL,
  solo INTEGER NOT NULL,
  team_score INTEGER NOT NULL,
  stars INTEGER NOT NULL,
  ended_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS rounds_category ON rounds (level, difficulty, duration_minutes);

CREATE TABLE IF NOT EXISTS round_players (
  round_id TEXT NOT NULL REFERENCES rounds (id) ON DELETE CASCADE,
  player_id TEXT NOT NULL,
  nickname TEXT NOT NULL,
  score INTEGER NOT NULL,
  kills INTEGER NOT NULL,
  headshots INTEGER NOT NULL,
  deaths INTEGER NOT NULL,
  PRIMARY KEY (round_id, player_id)
);

CREATE INDEX IF NOT EXISTS round_players_player ON round_players (player_id);
