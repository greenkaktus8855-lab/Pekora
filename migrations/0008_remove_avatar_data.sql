-- Avatar customization and renderer have been retired.
-- Remove only avatar appearance/equipped-state data; inventory items are preserved.
DROP TABLE IF EXISTS avatar_render_cache;
DROP TABLE IF EXISTS avatar_settings;
DROP TABLE IF EXISTS equipped_items;
