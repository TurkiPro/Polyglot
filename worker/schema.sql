-- polyglot — D1 schema (§11). Idempotent: applying it twice is a no-op.
--
-- The server stores facts, never derived state: there is no card table and no XP column,
-- because both are functions of the event log (§2). There is no password column either,
-- and there never will be (§1.4).

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  display_name TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE (provider, provider_id)
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS review_events (
  id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  card_id TEXT NOT NULL,
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 4),
  ts INTEGER NOT NULL,
  dur_ms INTEGER,
  received_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, id)
);

CREATE INDEX IF NOT EXISTS idx_events_cursor ON review_events (user_id, received_at);

CREATE TABLE IF NOT EXISTS custom_words (
  id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  payload TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, id)
);

-- The Course (Phase 9 §2). Exercise results — a SEPARATE append-only stream that feeds XP,
-- mastery and adaptivity but NEVER FSRS: cued recognition (MCQ, matching) is easier than the
-- free recall FSRS schedules on, so grading the scheduler on it inflates stability and rots
-- retention. The firewall is structural — nothing joins this table to card state.
CREATE TABLE IF NOT EXISTS practice_events (
  id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  unit_id TEXT NOT NULL,
  type TEXT NOT NULL,
  word_id TEXT NOT NULL,
  correct INTEGER NOT NULL CHECK (correct IN (0, 1)),
  ts INTEGER NOT NULL,
  received_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, id)
);

CREATE INDEX IF NOT EXISTS idx_practice_cursor ON practice_events (user_id, received_at);

CREATE TABLE IF NOT EXISTS rate_limits (
  k TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  window_start INTEGER NOT NULL
);
