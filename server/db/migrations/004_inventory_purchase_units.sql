-- Migration 004: purchase units and live costing for inventory items
-- Additive only — no existing columns altered or dropped.
-- All new columns are nullable with sensible defaults so existing rows are unaffected.

ALTER TABLE inventory
  ADD COLUMN IF NOT EXISTS purchase_unit     TEXT,        -- unit of the purchased package (e.g. 'case', 'bag', 'bottle')
  ADD COLUMN IF NOT EXISTS pkg_qty           NUMERIC,     -- how many base units are in one purchase package
  ADD COLUMN IF NOT EXISTS purchase_price    NUMERIC,     -- price paid per purchase package ($)
  ADD COLUMN IF NOT EXISTS cost_per_base_unit NUMERIC,   -- computed: purchase_price / pkg_qty (stored for fast reads)
  ADD COLUMN IF NOT EXISTS conversion_factor NUMERIC;    -- product-specific override when standard conversion is unavailable

-- Prevent two ingredients from linking to the same inventory item.
-- Partial index: only enforces uniqueness when inventory_item_id is not null.
CREATE UNIQUE INDEX IF NOT EXISTS ingredients_inventory_item_id_uidx
  ON ingredients (inventory_item_id)
  WHERE inventory_item_id IS NOT NULL;

-- No ownership change needed — inventory and ingredients are already owned by birria.
