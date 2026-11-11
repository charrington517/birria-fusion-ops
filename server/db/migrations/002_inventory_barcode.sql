-- Migration 002: barcode support for inventory items
-- Additive only — no existing columns altered or dropped.
-- barcode stores the normalized form (UPC-A 12-digit or EAN-13 13-digit).
-- The partial unique index prevents duplicate barcodes while allowing NULL.

ALTER TABLE inventory ADD COLUMN IF NOT EXISTS barcode TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS inventory_barcode_uidx
  ON inventory (barcode)
  WHERE barcode IS NOT NULL;
