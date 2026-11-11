CREATE TABLE IF NOT EXISTS gift_items (
  gift_item_id TEXT PRIMARY KEY REFERENCES items(id) ON DELETE CASCADE,
  reward_item_id TEXT NOT NULL,
  opens_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (gift_item_id <> reward_item_id)
);

CREATE INDEX IF NOT EXISTS idx_gift_items_reward ON gift_items(reward_item_id);

CREATE TABLE IF NOT EXISTS gift_openings (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  gift_item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  reward_item_id TEXT NOT NULL,
  opened_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id,gift_item_id)
);

CREATE INDEX IF NOT EXISTS idx_gift_openings_gift ON gift_openings(gift_item_id,opened_at);
