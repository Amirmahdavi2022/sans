-- Sans D1 schema
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  first_name TEXT,
  username TEXT,
  lang TEXT,
  created_at INTEGER NOT NULL,
  last_seen INTEGER NOT NULL
);

-- kind: 'watch' (want to watch) or 'seen'
CREATE TABLE IF NOT EXISTS items (
  user_id INTEGER NOT NULL,
  kind TEXT NOT NULL,
  type TEXT NOT NULL,
  tmdb_id INTEGER NOT NULL,
  title TEXT,
  poster TEXT,
  year INTEGER,
  rating REAL,
  added_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, kind, type, tmdb_id)
);
CREATE INDEX IF NOT EXISTS items_user ON items (user_id, kind, added_at);

-- New-episode alerts
CREATE TABLE IF NOT EXISTS follows (
  user_id INTEGER NOT NULL,
  tv_id INTEGER NOT NULL,
  added_at INTEGER NOT NULL,
  notified TEXT,
  PRIMARY KEY (user_id, tv_id)
);
CREATE INDEX IF NOT EXISTS follows_tv ON follows (tv_id);

CREATE TABLE IF NOT EXISTS shows (
  tv_id INTEGER PRIMARY KEY,
  name TEXT,
  poster TEXT,
  last_ep TEXT,
  last_ep_date TEXT,
  checked_at INTEGER NOT NULL DEFAULT 0
);
