ALTER TABLE admin_item_submissions
  ADD COLUMN stock_limit INTEGER NOT NULL DEFAULT 0
  CHECK (stock_limit >= 0 AND stock_limit <= 1000000);

UPDATE admin_item_submissions
SET stock_limit = 100
WHERE is_limited = 1 AND stock_limit = 0;
