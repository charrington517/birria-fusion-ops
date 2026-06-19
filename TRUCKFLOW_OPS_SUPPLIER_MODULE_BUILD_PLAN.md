# TRUCKFLOW_OPS_SUPPLIER_MODULE_BUILD_PLAN

**Status**: Build plan — no code changes in this document
**Date**: 2026-06-18
**App state**: v0.5.1 — verify-seed 62/62
**Prereq design**: TRUCKFLOW_OPS_SUPPLIER_VENDOR_WORKFLOW_DESIGN.md

---

## Current State Audit

### suppliers table (live)
  Columns: id, name, category, phone, email, notes, created_at
  Rows: 2 (Restaurant Depot, Local Butcher)
  Missing fields: contact_name, website, address, delivery_days,
    default_order_day, lead_time_days, minimum_order, payment_terms,
    rating, active

### inventory.supplier (text)
  14 rows — 5 have text values:
    Birria Beef       -> Local Butcher      (has suppliers row)
    Corn Tortillas    -> Restaurant Depot   (has suppliers row)
    Consomé          -> In-house           (no suppliers row)
    Cilantro          -> Produce Vendor     (no suppliers row)
    To-Go Bowls       -> Webstaurant        (no suppliers row)
  9 rows blank

### ingredients.supplier (text)
  3 rows populated:
    Chuck Roast Updated   -> Local Butcher
    Dried Guajillo Chiles -> Restaurant Depot
    Beef Shank            -> Local Butcher
  11 rows blank
  Status: deprecated after Phase 2 completes

### crud.js suppliers writableFields
  Current: [name, category, phone, email, notes]
  Missing all new fields

### Frontend suppliers
  Rendered by generic Collection component — no custom page
  fields object: [name, category, phone, email, notes]
  Navigation: Office group -> Suppliers

---

## Build Phases

---

## Phase 1 — Schema Upgrade (DB + seed + verify-seed)

### 1A. ALTER TABLE suppliers — add 10 new columns

  contact_name    TEXT
  website         TEXT
  address         TEXT
  delivery_days   TEXT      -- e.g. "Mon, Wed, Fri"
  default_order_day TEXT    -- e.g. "Monday"
  lead_time_days  INTEGER   DEFAULT 1
  minimum_order   NUMERIC   DEFAULT 0
  payment_terms   TEXT      -- e.g. "COD", "Net 30", "Credit card"
  rating          INTEGER   CHECK (rating BETWEEN 1 AND 5)
  active          BOOLEAN   DEFAULT true

  All columns nullable (no NOT NULL) — zero migration risk on existing rows.
  active defaults to true — existing 2 rows stay active automatically.

  SQL:
    ALTER TABLE suppliers
      ADD COLUMN contact_name TEXT,
      ADD COLUMN website TEXT,
      ADD COLUMN address TEXT,
      ADD COLUMN delivery_days TEXT,
      ADD COLUMN default_order_day TEXT,
      ADD COLUMN lead_time_days INTEGER DEFAULT 1,
      ADD COLUMN minimum_order NUMERIC DEFAULT 0,
      ADD COLUMN payment_terms TEXT,
      ADD COLUMN rating INTEGER CHECK (rating BETWEEN 1 AND 5),
      ADD COLUMN active BOOLEAN DEFAULT true;

### 1B. ADD supplier_id to inventory

  ALTER TABLE inventory
    ADD COLUMN supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL;

  Nullable. ON DELETE SET NULL — if a supplier is deleted, inventory
  items lose the link but are not deleted or broken.
  inventory.supplier text column KEPT — do not drop yet.

### 1C. Update init.js

  Add all new columns to the CREATE TABLE suppliers block.
  Add supplier_id FK column to CREATE TABLE inventory block.
  Both changes are additive — no existing column touched.

### 1D. Update seed.js

  Step 1: Expand suppliers insertIfEmpty to 7 rows:
    Restaurant Depot  — Food/Supplies, delivery_days: Tue/Thu/Sat
    Local Butcher     — Meat, delivery_days: Mon/Wed/Fri, lead_time_days: 1
    In-house          — Prep, notes: Made on premises
    Produce Vendor    — Produce, delivery_days: Mon/Wed/Fri
    Webstaurant       — Packaging, lead_time_days: 3, payment_terms: Credit card
    Costco            — Bulk, delivery_days: (pickup)
    US Foods          — Food/Supplies, lead_time_days: 2

  Step 2: Add supplier_id to inventory seed rows
    Birria Beef           -> supplier_id = Local Butcher id
    Corn Tortillas        -> supplier_id = Restaurant Depot id
    Consomé              -> supplier_id = In-house id
    Cilantro              -> supplier_id = Produce Vendor id
    To-Go Bowls           -> supplier_id = Webstaurant id
    Beef Shank            -> supplier_id = Local Butcher id
    Dried Guajillo Chiles -> supplier_id = Restaurant Depot id
    White Onion           -> supplier_id = Produce Vendor id
    Oaxaca Cheese         -> supplier_id = (null — unknown)
    Ramen Noodles         -> supplier_id = Restaurant Depot id
    Eggs                  -> supplier_id = (null)
    Bolillo Roll          -> supplier_id = (null)
    Refried Beans         -> supplier_id = Restaurant Depot id
    Jalapeño             -> supplier_id = Produce Vendor id

  Note: seed.js uses insertIfEmpty guards so supplier IDs are resolved
  by querying for supplier name after insert, not by hardcoding IDs.
  Pattern already used for recipe_id and ingredient_id lookups in seed.

### 1E. Update verify-seed.js

  Update suppliers count assertion: 2 -> 7
  Add supplier field assertions:
    Restaurant Depot has delivery_days populated
    Local Butcher has lead_time_days = 1
    In-house has category = Prep
    Webstaurant has lead_time_days = 3
  Add inventory->supplier_id link assertions:
    Birria Beef supplier_id links to Local Butcher
    Corn Tortillas supplier_id links to Restaurant Depot
    Cilantro supplier_id links to Produce Vendor
    To-Go Bowls supplier_id links to Webstaurant
  Existing 62 assertions unchanged.
  Estimated new assertions: ~10
  New total: ~72

---

## Phase 2 — Backend: crud.js + overview.js + new route

### 2A. Update crud.js writableFields for suppliers

  Current: [name, category, phone, email, notes]
  New:     [name, category, phone, email, notes, contact_name, website,
             address, delivery_days, default_order_day, lead_time_days,
             minimum_order, payment_terms, rating, active]

  Also update inventory writableFields to include supplier_id:
  Current: [..., supplier, forecast_per_event]
  New:     [..., supplier, supplier_id, forecast_per_event]

### 2B. Update overview.js

  Suppliers query already included: query(SELECT * FROM suppliers ORDER BY id DESC)
  Add JOIN to include inventory count per supplier in overview:
    Either: enrich in JS after fetch (count inventory rows with matching supplier_id)
    Or: add a separate suppliers_with_counts query
  Recommendation: enrich in JS — no new query needed.

  Add inventory.supplier_id to the SELECT in inventory query (already SELECT *)
  so supplier_id is available in overview.data.inventory.

### 2C. New route: GET /api/suppliers/:id/inventory

  Returns all inventory items linked to a given supplier_id.
  Used by SupplierCard to show linked items.
  Query:
    SELECT * FROM inventory WHERE supplier_id =  ORDER BY name

---

## Phase 3 — Frontend: Custom Suppliers Page

### 3A. Replace generic Collection render with SuppliersPage

  Current: suppliers page rendered by Collection component
  New: custom SuppliersPage component

  Add to App.jsx page routing:
    {page==='suppliers' && <SuppliersPage suppliers={data} api={auth.api} refresh={refresh}/>}

  Remove suppliers from Collection fallthrough.

### 3B. SupplierCard layout

  Collapsed (default):
    Header row: supplier name + active/inactive badge + category badge
    Subline: phone · delivery_days · lead_time_days days
    Chevron to expand

  Expanded:
    Contact: contact_name, phone, email, website
    Logistics: delivery_days, default_order_day, lead_time_days, minimum_order
    Terms: payment_terms, rating (1-5 stars or number)
    Notes
    Linked Inventory: list of inventory items with supplier_id = this supplier
      Shows name, current_stock, unit, status badge
      Fetched from GET /api/suppliers/:id/inventory
    Actions: Edit | Delete

### 3C. SupplierModal

  Fields grouped into sections:

  Basic:
    Name (required), Category (dropdown: Meat/Produce/Dairy/Dry Goods/
    Packaging/Restaurant Supply/Beverage/Equipment/Local Vendor/In-House/Other),
    Active (checkbox)

  Contact:
    contact_name, phone, email, website, address

  Order logistics:
    delivery_days (text e.g. "Mon, Wed, Fri"),
    default_order_day (dropdown: Mon-Sun),
    lead_time_days (number, default 1),
    minimum_order (number $)

  Terms:
    payment_terms (text), rating (1-5)

  Notes (textarea)

  Save / Cancel buttons

### 3D. SuppliersPage header

  Same pattern as other pages:
    Card with name, count, Add Supplier button
    Search input filtering by name, category
    Active/inactive filter toggle

---

## Phase 4 — Frontend: Inventory UI Updates

### 4A. InventoryModal — replace supplier text with dropdown

  Current: free-text input for supplier
  New: dropdown populated from overview.data.suppliers
    <select> showing supplier names, value = supplier_id
    Option: — none — (null)
    All active suppliers listed

  Keep inventory.supplier text field in writableFields for now
  (backward compat during transition)
  Stop writing to inventory.supplier text from the modal.
  Only write supplier_id going forward.

### 4B. InventoryCard — show supplier name

  Current: {item.supplier && <p>Supplier: {item.supplier}</p>}
  New: resolve supplier name from supplier_id via suppliers list
    const supplier = suppliers.find(s => s.id === item.supplier_id)
    Display: {supplier && <p>Supplier: {supplier.name}</p>}
  Pass suppliers prop into InventoryPage from App.jsx

### 4C. App.jsx — pass suppliers to InventoryPage

  Current: <InventoryPage items={data} api={auth.api} refresh={refresh}/>
  New:     <InventoryPage items={data} suppliers={overview.data.suppliers||[]} api={auth.api} refresh={refresh}/>

---

## Phase 5 — Seed Migration (production)

Production DB does not auto-run seed.js — seed only runs on empty DB.
Production migration requires manual SQL execution.

### Migration script (run once on production)

  Step 1: Insert missing suppliers
    INSERT INTO suppliers (name, category, notes)
    SELECT name, category, notes FROM (VALUES
      ('In-house', 'Prep', 'Made on premises'),
      ('Produce Vendor', 'Produce', 'Local produce supplier'),
      ('Webstaurant', 'Packaging', 'To-go containers, disposables'),
      ('Costco', 'Bulk', 'Bulk items'),
      ('US Foods', 'Food/Supplies', 'Broadline distributor')
    ) AS v(name, category, notes)
    WHERE NOT EXISTS (SELECT 1 FROM suppliers WHERE suppliers.name = v.name);

  Step 2: Set supplier_id on inventory via text match
    UPDATE inventory SET supplier_id = s.id
    FROM suppliers s
    WHERE inventory.supplier = s.name
    AND inventory.supplier IS NOT NULL
    AND inventory.supplier != '';

  Step 3: Verify
    SELECT i.name, i.supplier, s.name AS supplier_resolved
    FROM inventory i LEFT JOIN suppliers s ON s.id = i.supplier_id
    ORDER BY i.name;

### Safety
  Step 1 uses WHERE NOT EXISTS — idempotent, safe to re-run
  Step 2 is a SET on nullable column — no data destruction
  inventory.supplier text column not modified or dropped

---

## Phase 6 — Verification

After all phases complete:

  Automated:
    node server/db/verify-seed.js  (target: ~72 assertions, 0 failures)

  API spot checks:
    GET /api/suppliers -> 7 rows with new fields
    GET /api/suppliers/:id/inventory -> linked items for Restaurant Depot
    GET /api/inventory -> supplier_id populated on 12+ items
    GET /api/menu/1/cost -> Quesabirria Tacos still .22
    GET /api/menu/2/cost -> Birria Ramen still .83
    GET /api/menu/3/cost -> Birria Torta still .78

  UI checks:
    Suppliers page loads with 7 cards
    Supplier card expands showing contact + logistics
    Linked inventory items show on expanded card
    Inventory modal shows supplier dropdown (not text input)
    Inventory card shows supplier name from supplier_id
    Ingredients page unaffected
    Menu costing unchanged

---

## Rollback Plan

| Phase | What changed | Rollback action | Data loss risk |
|---|---|---|---|
| 1A (ALTER suppliers) | 10 new nullable columns | DROP COLUMN each | None — columns are empty on rollback |
| 1B (supplier_id on inventory) | 1 nullable FK column | ALTER TABLE inventory DROP COLUMN supplier_id | None — old text field untouched |
| 1C (init.js) | Schema definition | Revert git commit | None |
| 1D (seed.js) | Seed data | Revert git commit | None — insertIfEmpty is idempotent |
| 1E (verify-seed.js) | Assertions | Revert git commit | None |
| 2A (crud.js) | writableFields | Revert git commit | None |
| 2B (overview.js) | Query enrichment | Revert git commit | None |
| 2C (new route) | New GET endpoint | Remove route | None |
| 3 (SuppliersPage) | New UI component | Remove component, revert to Collection | None |
| 4 (InventoryModal) | Supplier dropdown | Revert to text input | None — supplier_id column stays |
| 5 (production migration) | supplier_id populated | Set supplier_id = NULL | No data deleted |

All phases are additive. No existing columns dropped. No FKs on mii/mici.
Full rollback at any phase leaves production in valid state.

---

## Execution Order

  Phase 1: Schema (init.js + seed.js + verify-seed.js) — single commit
  Phase 2: Backend (crud.js + overview.js + new route) — single commit
  Phase 3: Frontend Suppliers page — single commit
  Phase 4: Frontend Inventory updates — single commit
  Phase 5: Production migration SQL — run manually, verify immediately
  Phase 6: Full verification — document results

Phases 1-4 can be done against a fresh DB (seed rebuild).
Phase 5 runs against production DB with existing data.
Phase 5 is the only step with production data involvement.

---

## Dependencies on Existing Code

| File | Change needed | Breaking? |
|---|---|---|
| server/db/init.js | ADD columns to suppliers + inventory | No |
| server/db/seed.js | Expand suppliers, add supplier_id to inventory rows | No |
| server/db/verify-seed.js | Update count 2->7, add link assertions | No |
| server/services/crud.js | Add new fields to writableFields | No |
| server/services/overview.js | overview already returns suppliers | No |
| server/routes/api.js | Add /suppliers/:id/inventory route | No |
| client/src/App.jsx | SuppliersPage, SupplierModal, InventoryPage supplier prop | No |

No changes to:
  costing.js, consumption.js, profitability.js
  menu_item_ingredients, menu_item_compound_ingredients
  Any recipe or compound logic
  verify-seed existing 62 assertions

---

## Estimated Effort

| Phase | Effort |
|---|---|
| 1 Schema | 30 min |
| 2 Backend | 30 min |
| 3 Suppliers UI | 1.5 hours |
| 4 Inventory UI | 30 min |
| 5 Production migration | 15 min |
| 6 Verification + doc | 30 min |
| **Total** | **~3.5 hours** |
