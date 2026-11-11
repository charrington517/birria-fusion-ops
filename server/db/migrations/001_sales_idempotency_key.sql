-- Migration 001: Add idempotency_key to sales_orders
-- Additive only. Does not touch existing rows or other tables.
-- Existing rows get NULL idempotency_key, which is allowed (NULL != NULL in unique indexes).

ALTER TABLE sales_orders
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS sales_orders_idempotency_key_idx
  ON sales_orders (idempotency_key)
  WHERE idempotency_key IS NOT NULL;
