ALTER TABLE items
ADD COLUMN is_catalog_visible INTEGER NOT NULL DEFAULT 1
CHECK (is_catalog_visible IN (0,1));

CREATE INDEX IF NOT EXISTS idx_items_catalog_visibility
ON items(is_catalog_visible,is_for_sale,created_at);
