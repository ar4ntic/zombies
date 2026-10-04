ALTER TABLE rounds ADD COLUMN energy TEXT NOT NULL DEFAULT 'limited';

DROP INDEX IF EXISTS rounds_category;
CREATE INDEX IF NOT EXISTS rounds_category ON rounds (level, difficulty, duration_minutes, energy);

ALTER TABLE round_players ADD COLUMN shots INTEGER NOT NULL DEFAULT 0;
ALTER TABLE round_players ADD COLUMN hits INTEGER NOT NULL DEFAULT 0;
