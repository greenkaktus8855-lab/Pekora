ALTER TABLE admin_item_submissions ADD COLUMN is_limited INTEGER NOT NULL DEFAULT 0 CHECK (is_limited IN (0,1));
