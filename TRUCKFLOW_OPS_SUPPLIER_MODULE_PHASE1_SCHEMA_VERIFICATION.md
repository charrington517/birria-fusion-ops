# TRUCKFLOW_OPS_SUPPLIER_MODULE_PHASE1_SCHEMA_VERIFICATION

**Commit**: c8ff946
**Files**: server/db/init.js, server/db/seed.js, server/db/verify-seed.js
**Branch**: main

## Schema Changes Applied

### suppliers table — 10 new columns
  contact_name      TEXT
  vendor_type       TEXT  (controlled: Distributor/Local Vendor/Wholesale Club/
                           Restaurant Supply/Manufacturer/Internal Production/Other)
  website           TEXT
  address           TEXT
  delivery_days     TEXT
  default_order_day TEXT
  lead_time_days    INTEGER DEFAULT 1
  minimum_order     NUMERIC DEFAULT 0
  payment_terms     TEXT
  active            BOOLEAN DEFAULT true

  All nullable — zero impact on existing rows.
  No rating column (removed per v2 spec).

### inventory table — 1 new column
  supplier_id  INTEGER REFERENCES suppliers(id) ON DELETE SET NULL
  Nullable FK — inventory items survive supplier deletion.
  inventory.supplier text column retained (not dropped).

## Vendor Data (7 rows)

| id | name | vendor_type | active | lead_time_days |
|---|---|---|---|---|
| 1 | Restaurant Depot | Restaurant Supply | true | 1 |
| 2 | Local Butcher | Local Vendor | true | 1 |
| 3 | Internal Production | Internal Production | true | 1 |
| 4 | Produce Vendor | Local Vendor | true | 1 |
| 5 | Webstaurant | Distributor | true | 3 |
| 6 | Costco | Wholesale Club | true | 1 |
| 7 | US Foods | Distributor | true | 2 |

No "In-house" supplier exists.

## Inventory supplier_id Mapping (14 items)

| Item | supplier_id -> name |
|---|---|
| Birria Beef | Local Butcher |
| Corn Tortillas | Restaurant Depot |
| Consomé | Internal Production |
| Cilantro | Produce Vendor |
| To-Go Bowls | Webstaurant |
| Beef Shank | Local Butcher |
| Dried Guajillo Chiles | Restaurant Depot |
| White Onion | Produce Vendor |
| Ramen Noodles | Restaurant Depot |
| Refried Beans | Restaurant Depot |
| Jalapeño | Produce Vendor |
| Oaxaca Cheese | null (unknown) |
| Eggs | null |
| Bolillo Roll | null |

## verify-seed Results

85 passed, 0 failed  (was 62 — added 23 new vendor assertions)

New assertions:
  vendor count: 7
  no In-house supplier
  Internal Production exists
  Internal Production vendor_type
  Restaurant Depot vendor_type
  Local Butcher vendor_type
  Webstaurant vendor_type
  Webstaurant lead_time_days=3
  Local Butcher lead_time_days=1
  Birria Beef -> Local Butcher
  Corn Tortillas -> Restaurant Depot
  Consomé -> Internal Production
  Cilantro -> Produce Vendor
  To-Go Bowls -> Webstaurant
  Beef Shank -> Local Butcher
  Dried Guajillo -> Restaurant Depot
  White Onion -> Produce Vendor
  Ramen Noodles -> Restaurant Depot
  Refried Beans -> Restaurant Depot
  Jalapeño -> Produce Vendor
  Oaxaca Cheese supplier_id=null
  Eggs supplier_id=null
  Bolillo Roll supplier_id=null

## Build and Service

| Check | Result |
|---|---|
| npm run build | PASS - 1.18s, 0 errors |
| birria-ops active | PASS |
| verify-seed 85/85 | PASS |
| Quesabirria Tacos cost | PASS - 5.22 mii+compound |
| Birria Ramen cost | PASS - 7.83 mii+compound |
| Birria Torta cost | PASS - 5.78 mii+compound |

## Notes on seed.js approach

insertIfEmpty() skips if table has any rows.
Replaced with upsert-by-name pattern:
  - UPDATE existing rows (sets vendor_type, delivery_days, lead_time, etc.)
  - INSERT genuinely new rows (Internal Production, Produce Vendor,
    Webstaurant, Costco, US Foods)
supplier_id mapping uses UPDATE ... WHERE supplier_id IS NULL
(idempotent — safe to re-run on already-mapped rows)

## Scope

- server/db/init.js: CREATE TABLE + ALTER TABLE blocks for new columns
- server/db/seed.js: upsert vendors, supplier_id mapping
- server/db/verify-seed.js: 23 new assertions
- No frontend changes
- No costing changes
- No recipe/menu changes
