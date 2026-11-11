CREATE TABLE IF NOT EXISTS gift_reward_options (
  gift_item_id TEXT NOT NULL REFERENCES gift_items(gift_item_id) ON DELETE CASCADE,
  reward_item_id TEXT NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
  chance_percent REAL NOT NULL CHECK(chance_percent > 0 AND chance_percent <= 100),
  sort_order INTEGER NOT NULL DEFAULT 0 CHECK(sort_order BETWEEN 0 AND 9),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY(gift_item_id,reward_item_id)
);

CREATE INDEX IF NOT EXISTS idx_gift_reward_options_gift
ON gift_reward_options(gift_item_id,sort_order);

INSERT OR IGNORE INTO gift_reward_options
  (gift_item_id,reward_item_id,chance_percent,sort_order)
SELECT g.gift_item_id,g.reward_item_id,100,0
FROM gift_items g
JOIN items i ON i.id=g.reward_item_id;
