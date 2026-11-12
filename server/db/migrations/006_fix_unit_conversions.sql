-- Migration 006: correct unit_conversions table
-- Removes 6 packaging-type rows that had false universal assumptions:
--   bag→g (1lb bag = 453.592g), bag→oz (1lb bag = 16oz),
--   bottle→fl oz (1L bottle = 33.814 fl oz),
--   box→each (12-count box), case→each (24-count case),
--   pack→each (12-count pack).
-- Packaging types have no universal fixed quantity; each inventory item
-- defines its own package contents via pkg_qty and conversion_factor.
-- Adds missing bidirectional physical conversions needed for costing.
-- Idempotent: ON CONFLICT DO NOTHING; DELETE is safe to re-run (no-op if rows absent).

-- Remove packaging-type universal conversions.
DELETE FROM unit_conversions
WHERE (from_unit = 'bag'    AND to_unit IN ('g', 'oz'))
   OR (from_unit = 'bottle' AND to_unit = 'fl oz')
   OR (from_unit = 'box'    AND to_unit = 'each')
   OR (from_unit = 'case'   AND to_unit = 'each')
   OR (from_unit = 'pack'   AND to_unit = 'each');

-- Add missing bidirectional physical conversions.
INSERT INTO unit_conversions (from_unit, to_unit, factor, notes) VALUES
  ('g',     'oz',    0.035274,   'grams to ounces'),
  ('g',     'lb',    0.00220462, 'grams to pounds'),
  ('oz',    'g',     28.3495,    'ounces to grams'),
  ('oz',    'lb',    0.0625,     'ounces to pounds'),
  ('tbsp',  'fl oz', 0.5,        'tablespoons to fluid ounces'),
  ('fl oz', 'tbsp',  2,          'fluid ounces to tablespoons'),
  ('fl oz', 'ml',    29.5735,    'fluid ounces to milliliters'),
  ('ml',    'fl oz', 0.033814,   'milliliters to fluid ounces')
ON CONFLICT (from_unit, to_unit) DO NOTHING;
