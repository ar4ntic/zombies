CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  nickname TEXT,
  nickname_key TEXT UNIQUE,
  email_verified_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS account_sessions (
  token_hash TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS account_sessions_account ON account_sessions (account_id);

CREATE TABLE IF NOT EXISTS account_tokens (
  token_hash TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS account_tokens_account ON account_tokens (account_id, kind);

CREATE TABLE IF NOT EXISTS auth_attempts (
  key TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL
);

ALTER TABLE round_players ADD COLUMN account_id TEXT;
ALTER TABLE round_players ADD COLUMN nickname_key TEXT NOT NULL DEFAULT '';
UPDATE round_players SET nickname_key = lower(trim(nickname));

CREATE INDEX IF NOT EXISTS round_players_account ON round_players (account_id);
CREATE INDEX IF NOT EXISTS round_players_nickname ON round_players (nickname_key);
