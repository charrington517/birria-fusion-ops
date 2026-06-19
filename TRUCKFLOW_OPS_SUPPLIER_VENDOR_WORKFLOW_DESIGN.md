# TRUCKFLOW_OPS_SUPPLIER_VENDOR_WORKFLOW_DESIGN

**Status**: Design only — no code, no DB, no UI changes
**Date**: 2026-06-18
**App state at design time**: v0.5.1 — Food Module stable, verify-seed 62/62

---

## 1. What Is a Supplier/Vendor in TruckFlow Ops?

A Supplier is a business or individual that sells goods to the truck.
Vendors are the same concept — the terms are used interchangeably.
TruckFlow unifies them under "Suppliers" (existing table name kept).

In practice, a supplier is any source the owner buys from:
- Restaurant Depot — bulk dry goods, packaging, paper products
- Local Butcher — fresh meat (chuck roast, beef shank)
- Produce Vendor — cilantro, onion, jalapeño
- Webstaurant — to-go bowls, disposables
- Costco / Sams Club — miscellaneous bulk
- In-house — made on-premises (consomé, compounds)

The key operational use cases:
1. Know where each inventory item comes from
2. Know who to call when stock runs low
3. Draft a reorder list per supplier
4. Track price changes over time
5. Future: generate purchase orders

---

## 2. Recommended Supplier Fields

### Current fields (existing suppliers table)
  id, name, category, phone, email, notes, created_at

### Missing fields that have operational value

| Field | Type | Purpose |
|---|---|---|
| contact_name | text | Who to call/email |
| website | text | Order portal URL |
| address | text | Pickup/delivery address |
| delivery_days | text | e.g. "Mon, Wed, Fri" |
| min_order | numeric | Minimum order dollar amount |
| payment_terms | text | e.g. "Net 30", "COD", "Credit card" |
| lead_time_days | integer | Days from order to delivery |
| active | boolean | Soft-delete / archive |
| account_number | text | Supplier account/customer number |

### Priority ranking for implementation
  Must-have:  contact_name, active, delivery_days
  Should-have: payment_terms, min_order, lead_time_days
  Nice-to-have: website, address, account_number

---

## 3. Should Inventory Link to Suppliers?

### Current state
  inventory.supplier is a free-text field.
  14 inventory items — only 4 have supplier text populated.
  3 distinct values: "Local Butcher", "Restaurant Depot", "Webstaurant", "Produce Vendor", "In-house".
  None of these match a suppliers table row (different casing/naming).

### Options

**Option A: One supplier per inventory item (supplier_id FK)**
  inventory.supplier_id -> suppliers.id
  Pro: Simple join, easy reorder list grouping
  Pro: Clicking a supplier shows all its items immediately
  Con: Cannot model preferred + backup supplier per item
  Con: Some items (beef) could come from 2-3 butchers

**Option B: Multiple suppliers per inventory item (link table)**
  Table: inventory_suppliers (inventory_id, supplier_id, preferred, notes)
  Pro: Full flexibility — preferred + backup supplier per item
  Pro: Supports competitive pricing / alternates
  Con: More complex UI, more joins, more seed work
  Con: Overkill for a single food truck at this scale

**Option C: Keep current text field (no change)**
  Pro: Zero migration risk
  Con: No relational integrity — typos create phantom suppliers
  Con: Cannot click a supplier to see their items
  Con: Reorder list generation requires string matching

### Recommendation
  Option A: single supplier_id FK on inventory.

  Rationale:
  - A food truck at this scale buys each item from one primary source.
  - Option B complexity is not justified until purchase orders exist.
  - Option A enables reorder list grouping with a simple JOIN.
  - Option A is one migration step, low risk, reversible.
  - If multi-supplier is needed later, Option A -> B migration is straightforward.

---

## 4. Should Ingredients Link Directly to Suppliers?

### Current state
  ingredients.supplier is a free-text field.
  Only 3 ingredients have supplier text: Beef Shank, Chuck Roast (Local Butcher),
  Dried Guajillo Chiles (Restaurant Depot).

### Recommendation: No — ingredients should NOT have a direct supplier FK

Reason:
  An ingredient is a costing abstraction on top of inventory.
  The physical stock — and therefore the supplier — lives at the inventory level.
  Ingredients already link to inventory via inventory_item_id.
  The supplier chain is: ingredient -> inventory -> supplier.
  Adding supplier_id directly to ingredients would create redundant, potentially
  contradictory supplier references.

  The existing ingredients.supplier text field should be deprecated
  (left NULL, not displayed in UI) once inventory.supplier_id is populated.

---

## 5. Supplier Categories

Recommended category list for TruckFlow Ops food truck context:

  Meat            — butcher, meat distributor
  Produce         — vegetables, herbs, fresh items
  Dairy           — cheese, eggs, cream
  Dry Goods       — spices, dried chiles, noodles, rice, beans
  Bakery          — bread, tortillas, rolls
  Packaging       — to-go bowls, cups, lids, napkins, foil
  Restaurant Supply — bulk tools, smallwares, cleaning supplies
  Beverage        — drinks, soda, water
  Equipment       — repairs, parts, propane
  Local Vendor    — farmers market, local producer
  In-House        — made on premises (consomé, compounds, prep)
  Other           — catch-all

Current suppliers table has category as free text — these values can be enforced
at the UI layer with a dropdown without a schema change.

---

## 6. Future Purchase Orders — Supplier Foundation

No building yet. Design only.

### How suppliers support the PO workflow

**Reorder list (Phase 1 — simple)**
  Query: SELECT i.name, i.current_stock, i.min_stock, i.unit, s.name AS supplier
         FROM inventory i JOIN suppliers s ON s.id = i.supplier_id
         WHERE i.current_stock <= i.min_stock
         ORDER BY s.name, i.name;
  Result: grouped list of what to buy and from whom.
  No new tables needed — just supplier_id on inventory.

**Purchase order draft (Phase 2)**
  Table: purchase_orders (id, supplier_id, status, created_at, notes)
  Table: purchase_order_lines (id, po_id, inventory_id, qty_ordered, unit_cost)
  The reorder list seeds PO lines automatically.
  Owner reviews, adjusts quantities, marks as Sent.

**Order history (Phase 3)**
  purchase_orders with status Sent / Received / Partial
  Timestamps per status transition
  Links back to inventory_transactions when stock is received

**Received inventory (Phase 4)**
  Mark a PO as Received -> auto-increment inventory.current_stock
  Record price paid vs expected -> feeds cost history
  Creates inventory_transactions with reason "PO Receipt #X"

---

## 7. Cost History Design

### Problem
  Currently inventory.cost is a single numeric value.
  There is no record of when the price changed or who changed it.
  Beef prices fluctuate weekly. Tortilla suppliers raise prices seasonally.

### Recommended approach

**Table: supplier_price_history**
  id              serial PK
  inventory_id    FK -> inventory.id
  supplier_id     FK -> suppliers.id
  price           numeric
  effective_date  date
  source          text   ("manual", "po_receipt", "seed")
  notes           text
  created_at      timestamptz

  The current inventory.cost field remains the live/active cost.
  When cost changes (manually or via PO receipt), the old value is
  appended to supplier_price_history before being overwritten.

### UI implications
  Inventory card shows: current cost + small "history" link
  History panel shows 5 most recent price points per item
  Trends: is cost going up, down, or flat?

### Phase dependency
  Cost history is independent of PO workflow.
  Can be implemented after supplier_id FK, before POs.

---

## 8. Current App Audit

### suppliers table
  Columns: id, name, category, phone, email, notes, created_at
  Rows: 2 (Restaurant Depot, Local Butcher)
  Missing: contact_name, delivery_days, min_order, payment_terms,
           lead_time_days, active, website, address
  UI: rendered by generic Collection component (no custom page)
  CRUD: all 4 operations via generic EditModal
  Fields in fields object: [name, category, phone, email, notes]

### inventory.supplier (text)
  14 rows — 5 have text values, 9 are empty
  Values: Local Butcher, Restaurant Depot, Webstaurant, Produce Vendor, In-house
  None match suppliers table rows (no FK integrity)
  "Webstaurant", "Produce Vendor", "In-house" have no corresponding suppliers row

### ingredients.supplier (text)
  14 rows — 3 have text values: Local Butcher (x2), Restaurant Depot (x1)
  Redundant with inventory.supplier since ingredients link to inventory
  Should be deprecated after supplier_id FK is on inventory

### Routes
  suppliers uses generic CRUD forEach in api.js
  No custom supplier routes exist
  vendors alias in tableMap also points to suppliers table (legacy)

### UI
  Suppliers page: generic Collection card list
  No custom SupplierPage or SupplierModal exists
  Inventory modal has a free-text Supplier input field
  Ingredient modal has a free-text Supplier input field

---

## 9. Migration Plan

### From: inventory.supplier (text) -> supplier_id (FK)

**Pre-migration (no code, just data cleanup)**
  Step 1: Add missing suppliers to suppliers table
    INSERT Webstaurant, Produce Vendor, In-house
    Total after: ~5 suppliers

  Step 2: Map inventory.supplier text -> suppliers.id
    Manual mapping (14 rows, 5 populated, trivial)

**DB migration**
  Step 3: ALTER TABLE inventory ADD COLUMN supplier_id integer
           REFERENCES suppliers(id) ON DELETE SET NULL;
  Step 4: UPDATE inventory SET supplier_id = X WHERE supplier = Y;
           (5 UPDATE statements, one per supplier text value)
  Step 5: Keep inventory.supplier text column initially (backward compat)
           Mark it deprecated in writableFields — stop writing to it
  Step 6 (later): ALTER TABLE inventory DROP COLUMN supplier;

**Seed migration**
  seed.js: add 3 new supplier rows (Webstaurant, Produce Vendor, In-house)
  seed.js: inventory rows use supplier_id instead of supplier text
  verify-seed.js: add assertions for supplier_id links

**UI migration**
  InventoryModal: replace free-text supplier input with supplier dropdown
  Inventory card: show supplier name via JOIN instead of raw text

**Rollback**
  supplier_id is nullable (ON DELETE SET NULL)
  inventory.supplier text column kept until Step 6
  Rolling back means: stop populating supplier_id, resume populating text field
  No data loss at any step until Step 6 (column drop)

---

## 10. Recommendation

### Choice: Option B — Add supplier_id to inventory

(Note: this is "Option A" in the analysis above, labeled B here to match the
question numbering in the brief)

**Do not** keep the text field as primary (current Option A from brief)
**Do not** build the link table yet (too complex for current scale)
**Do** add supplier_id FK to inventory as the clean, minimal step forward

---

## Implementation Phases

**Phase 1 — Supplier data enrichment (UI only, no schema change)**
  Add missing fields to suppliers table modal:
  contact_name, delivery_days, payment_terms, active
  Update fields object in App.jsx + writableFields in crud.js
  Build custom SuppliersPage with better card layout
  Estimated effort: 1 sprint

**Phase 2 — supplier_id FK on inventory (schema + seed + UI)**
  Add 3 missing supplier rows (Webstaurant, Produce Vendor, In-house)
  ALTER TABLE inventory ADD COLUMN supplier_id
  Migrate 5 text values to FK
  InventoryModal: supplier dropdown replaces text input
  Inventory card: shows supplier name
  Update seed.js + verify-seed.js
  Estimated effort: 1 sprint

**Phase 3 — Reorder list (read-only, no new tables)**
  New route: GET /api/inventory/reorder
  Returns items where current_stock <= min_stock, grouped by supplier
  New UI panel on Today page or Inventory page
  Estimated effort: half sprint

**Phase 4 — Cost history (new table)**
  Create supplier_price_history table
  Hook into InventoryModal save: if cost changed, write history row
  Inventory card: show last 3 prices with dates
  Estimated effort: 1 sprint

**Phase 5 — Purchase orders (new tables, future)**
  purchase_orders + purchase_order_lines
  Reorder list -> PO draft flow
  PO receipt -> inventory increment
  Estimated effort: 2 sprints

---

## Rollback Considerations

| Phase | Rollback risk | How to rollback |
|---|---|---|
| 1 (supplier fields) | Zero — additive only | Remove fields from modal/crud |
| 2 (supplier_id FK) | Low — column is nullable | Stop writing supplier_id, keep text field |
| 3 (reorder list) | Zero — read-only route | Delete route + UI component |
| 4 (cost history) | Low — new table, no FK on live tables | Drop table, remove hook |
| 5 (POs) | Medium — new tables + transactions | Soft-delete PO tables, revert stock changes |

No phase modifies existing FK relationships until Phase 2 Step 6
(dropping the deprecated text column), which is optional and can wait indefinitely.

---

## Summary

Current state:
  suppliers table exists but is thin (5 fields, 2 rows)
  inventory.supplier is a free text field with no FK integrity
  ingredients.supplier is redundant and sparsely populated
  No custom supplier UI exists — rendered by generic Collection

Recommended path:
  Phase 1: Enrich supplier fields + custom UI (no schema change)
  Phase 2: supplier_id FK on inventory + seed migration
  Phase 3: Reorder list endpoint + UI
  Phase 4: Cost history table
  Phase 5: Purchase orders (post-rename gate)

Architecture decision: Option B (supplier_id FK on inventory)
  One supplier per inventory item
  Nullable, safe to migrate incrementally
  Enables reorder grouping, supplier page drill-down, PO workflow
  No link table complexity until scale demands it
