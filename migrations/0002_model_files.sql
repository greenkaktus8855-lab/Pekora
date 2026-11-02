CREATE TABLE IF NOT EXISTS model_files (
  id TEXT PRIMARY KEY,
  model_data BLOB NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
