-- Migration 005: unit conversion rules
-- Stores named conversion factors between purchase units and base inventory units.
-- Additive only. The application role (birria) must own the table and sequence.

CREATE TABLE IF NOT EXISTS unit_conversions (
  id           SERIAL PRIMARY KEY,
  from_unit    TEXT    NOT NULL,   -- purchase unit  (e.g. 'case', 'lb', 'bottle')
  to_unit      TEXT    NOT NULL,   -- base/inventory unit (e.g. 'each', 'oz', 'fl oz')
  factor       NUMERIC NOT NULL,   -- multiply from_unit qty by factor to get to_unit qty
  notes        TEXT,
  CONSTRAINT unit_conversions_pair_key UNIQUE (from_unit, to_unit)
);

-- Transfer ownership to the application role immediately after creation.
-- This is required when the migration is run as the postgres superuser.
ALTER TABLE unit_conversions OWNER TO birria;
ALTER SEQUENCE unit_conversions_id_seq OWNER TO birria;

-- Seed standard conversions.
-- ON CONFLICT DO NOTHING makes re-running safe.
INSERT INTO unit_conversions (from_unit, to_unit, factor, notes) VALUES
  -- Weight
  ('lb',     'oz',    16,       'pounds to ounces'),
  ('kg',     'g',     1000,     'kilograms to grams'),
  ('kg',     'oz',    35.274,   'kilograms to ounces'),
  ('kg',     'lb',    2.20462,  'kilograms to pounds'),
  ('g',      'oz',    0.035274, 'grams to ounces'),
  -- Volume
  ('liter',  'ml',    1000,     'liters to milliliters'),
  ('liter',  'fl oz', 33.814,   'liters to fluid ounces'),
  ('qt',     'fl oz', 32,       'quarts to fluid ounces'),
  ('qt',     'cup',   4,        'quarts to cups'),
  ('cup',    'fl oz', 8,        'cups to fluid ounces'),
  ('cup',    'tbsp',  16,       'cups to tablespoons'),
  ('tbsp',   'tsp',   3,        'tablespoons to teaspoons'),
  ('bottle', 'fl oz', 33.814,   'standard 1L bottle to fluid ounces'),
  -- Count / packaging
  ('case',   'each',  24,       'standard case (24-count)'),
  ('pack',   'each',  12,       'standard pack (12-count)'),
  ('bag',    'g',     453.592,  'standard 1lb bag to grams'),
  ('bag',    'oz',    16,       'standard 1lb bag to ounces'),
  ('box',    'each',  12,       'standard box (12-count)')
ON CONFLICT (from_unit, to_unit) DO NOTHING;
