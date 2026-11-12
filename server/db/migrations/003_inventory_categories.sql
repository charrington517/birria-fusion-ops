-- Migration 003: custom inventory categories
-- Additive only. Existing inventory.category text values are preserved as-is.
-- sort_order controls display sequence. active=false hides from new-item dropdowns
-- but does NOT change existing inventory records that use the category name.

CREATE TABLE IF NOT EXISTS inventory_categories (
  id         SERIAL PRIMARY KEY,
  name       TEXT    NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT inventory_categories_name_key UNIQUE (name)
);

-- Transfer ownership to the application role so it has full access.
-- This is required when the migration is run as the postgres superuser.
ALTER TABLE inventory_categories OWNER TO birria;
ALTER SEQUENCE inventory_categories_id_seq OWNER TO birria;

-- Seed the categories currently in use in production plus the legacy hardcoded
-- defaults. ON CONFLICT DO NOTHING means re-running is safe and user-defined
-- categories are never overwritten.
INSERT INTO inventory_categories (name, sort_order, active) VALUES
  ('Food',        10, TRUE),
  ('Meat',        20, TRUE),
  ('Produce',     30, TRUE),
  ('Dairy',       40, TRUE),
  ('Dry Goods',   50, TRUE),
  ('Bakery',      60, TRUE),
  ('Pantry',      70, TRUE),
  ('Spice',       80, TRUE),
  ('Prep',        90, TRUE),
  ('Packaging',  100, TRUE),
  ('Disposables',110, TRUE),
  ('Supplies',   120, TRUE),
  ('Equipment',  130, TRUE),
  ('Other',      140, TRUE)
ON CONFLICT (name) DO NOTHING;
