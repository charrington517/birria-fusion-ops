-- Migration 005: unit conversion rules
-- Stores PHYSICAL unit conversion factors only.
-- Packaging types (case, bag, box, bottle, pack) are NOT included here because
-- they have no universal fixed quantity — each product defines its own package
-- contents via inventory.pkg_qty and inventory.conversion_factor.
-- Additive only. The application role (birria) must own the table and sequence.

CREATE TABLE IF NOT EXISTS unit_conversions (
  id           SERIAL PRIMARY KEY,
  from_unit    TEXT    NOT NULL,
  to_unit      TEXT    NOT NULL,
  factor       NUMERIC NOT NULL,   -- multiply from_unit qty by factor to get to_unit qty
  notes        TEXT,
  CONSTRAINT unit_conversions_pair_key UNIQUE (from_unit, to_unit)
);

-- Transfer ownership to the application role immediately after creation.
-- This is required when the migration is run as the postgres superuser.
ALTER TABLE unit_conversions OWNER TO birria;
ALTER SEQUENCE unit_conversions_id_seq OWNER TO birria;

-- Seed physical unit conversions only.
-- ON CONFLICT DO NOTHING makes re-running safe.
INSERT INTO unit_conversions (from_unit, to_unit, factor, notes) VALUES
  -- Weight
  ('lb',    'oz',    16,          'pounds to ounces'),
  ('kg',    'g',     1000,        'kilograms to grams'),
  ('kg',    'oz',    35.274,      'kilograms to ounces'),
  ('kg',    'lb',    2.20462,     'kilograms to pounds'),
  ('g',     'oz',    0.035274,    'grams to ounces'),
  ('g',     'lb',    0.00220462,  'grams to pounds'),
  ('oz',    'g',     28.3495,     'ounces to grams'),
  ('oz',    'lb',    0.0625,      'ounces to pounds'),
  -- Volume
  ('liter', 'ml',    1000,        'liters to milliliters'),
  ('liter', 'fl oz', 33.814,      'liters to fluid ounces'),
  ('qt',    'fl oz', 32,          'quarts to fluid ounces'),
  ('qt',    'cup',   4,           'quarts to cups'),
  ('cup',   'fl oz', 8,           'cups to fluid ounces'),
  ('cup',   'tbsp',  16,          'cups to tablespoons'),
  ('tbsp',  'tsp',   3,           'tablespoons to teaspoons'),
  ('tbsp',  'fl oz', 0.5,         'tablespoons to fluid ounces'),
  ('fl oz', 'tbsp',  2,           'fluid ounces to tablespoons'),
  ('fl oz', 'ml',    29.5735,     'fluid ounces to milliliters'),
  ('ml',    'fl oz', 0.033814,    'milliliters to fluid ounces')
ON CONFLICT (from_unit, to_unit) DO NOTHING;
