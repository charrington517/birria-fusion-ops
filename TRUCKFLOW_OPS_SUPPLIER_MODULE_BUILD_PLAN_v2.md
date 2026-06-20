# TRUCKFLOW_OPS_SUPPLIER_MODULE_BUILD_PLAN_v2

**Status**: Build plan v2 — no code changes in this document
**Date**: 2026-06-18
**Supersedes**: TRUCKFLOW_OPS_SUPPLIER_MODULE_BUILD_PLAN.md
**App state**: v0.5.1 — verify-seed 62/62
**Prereq design**: TRUCKFLOW_OPS_SUPPLIER_VENDOR_WORKFLOW_DESIGN.md

## Revisions from v1

  1. rating field removed
  2. "In-house" supplier renamed to "Internal Production"
  3. vendor_type field added (Distributor / Local Vendor / Wholesale Club /
     Restaurant Supply / Manufacturer / Internal Production / Other)
  4. Supplier card dashboard stats added: linked inventory count,
     low stock count, out of stock count

---

## Current State Audit

### suppliers table (live)
  Columns: id, name, category, phone, email, notes, created_at
  Rows: 2 (Restaurant Depot, Local Butcher)
  Missing fields: contact_name, vendor_type, website, address,
    delivery_days, default_order_day, lead_time_days, minimum_order,
    payment_terms, active
  Removed from v1: rating

### inventory.supplier (text)
  14 rows — 5 have text values:
    Birria Beef       -> Local Butcher       (has suppliers row)
    Corn Tortillas    -> Restaurant Depot    (has suppliers row)
    Consomé          -> In-house            (no suppliers row — rename to Internal Production)
    Cilantro          -> Produce Vendor      (no suppliers row)
    To-Go Bowls       -> Webstaurant         (no suppliers row)
  9 rows blank

### ingredients.supplier (text)
  3 rows populated (Chuck Roast, Beef Shank -> Local Butcher,
  Dried Guajillo -> Restaurant Depot)
  Status: deprecated after Phase 2 completes

### crud.js suppliers writableFields
  Current: [name, category, phone, email, notes]
  Missing all new fields

### Frontend suppliers
  Rendered by generic Collection — no custom page
  Navigation: Office group -> Suppliers

---

## Phase 1 — Schema Upgrade (DB + seed + verify-seed)

### 1A. ALTER TABLE suppliers — add 10 new columns

  contact_name      TEXT
  vendor_type       TEXT       -- controlled vocab (see values below)
  website           TEXT
  address           TEXT
  delivery_days     TEXT       -- e.g. "Mon, Wed, Fri"
  default_order_day TEXT       -- e.g. "Monday"
  lead_time_days    INTEGER    DEFAULT 1
  minimum_order     NUMERIC    DEFAULT 0
  payment_terms     TEXT       -- e.g. "COD", "Net 30", "Credit card"
  active            BOOLEAN    DEFAULT true

  Removed from v1: rating
  Added vs v1: vendor_type
  Total new columns: 10 (same count, different set)

  All columns nullable — zero migration risk on existing rows.
  active defaults to true — existing 2 rows stay active automatically.

  SQL:
    ALTER TABLE suppliers
      ADD COLUMN contact_name TEXT,
      ADD COLUMN vendor_type TEXT,
      ADD COLUMN website TEXT,
      ADD COLUMN address TEXT,
      ADD COLUMN delivery_days TEXT,
      ADD COLUMN default_order_day TEXT,
      ADD COLUMN lead_time_days INTEGER DEFAULT 1,
      ADD COLUMN minimum_order NUMERIC DEFAULT 0,
      ADD COLUMN payment_terms TEXT,
      ADD COLUMN active BOOLEAN DEFAULT true;

  vendor_type values (enforced at UI layer, not DB constraint):
    Distributor
    Local Vendor
    Wholesale Club
    Restaurant Supply
    Manufacturer
    Internal Production
    Other

### 1B. ADD supplier_id to inventory

  ALTER TABLE inventory
    ADD COLUMN supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL;

  Nullable. ON DELETE SET NULL — inventory items survive supplier deletion.
  inventory.supplier text column KEPT — do not drop yet.

### 1C. Update init.js

  Add all new columns to CREATE TABLE suppliers block.
  Add supplier_id FK to CREATE TABLE inventory block.
  Both additive — no existing column touched.

### 1D. Update seed.js

  Step 1: Expand suppliers insertIfEmpty to 7 rows.
  Note: "In-house" renamed to "Internal Production" throughout.
  Also update any inventory seed rows that reference supplier: "In-house"
  to use supplier_id pointing to Internal Production.

  Supplier seed rows:
    Restaurant Depot   — vendor_type: Restaurant Supply,  delivery_days: Tue/Thu/Sat, lead_time_days: 1
    Local Butcher      — vendor_type: Local Vendor,        delivery_days: Mon/Wed/Fri, lead_time_days: 1
    Internal Production — vendor_type: Internal Production, notes: Made on premises, active: true
    Produce Vendor     — vendor_type: Local Vendor,        delivery_days: Mon/Wed/Fri
    Webstaurant        — vendor_type: Distributor,          lead_time_days: 3, payment_terms: Credit card
    Costco             — vendor_type: Wholesale Club,       notes: Pickup only
    US Foods           — vendor_type: Distributor,          lead_time_days: 2

  Step 2: Add supplier_id to inventory seed rows
    Birria Beef           -> supplier_id = Local Butcher id
    Corn Tortillas        -> supplier_id = Restaurant Depot id
    Consomé              -> supplier_id = Internal Production id
    Cilantro              -> supplier_id = Produce Vendor id
    To-Go Bowls           -> supplier_id = Webstaurant id
    Beef Shank            -> supplier_id = Local Butcher id
    Dried Guajillo Chiles -> supplier_id = Restaurant Depot id
    White Onion           -> supplier_id = Produce Vendor id
    Ramen Noodles         -> supplier_id = Restaurant Depot id
    Refried Beans         -> supplier_id = Restaurant Depot id
    Jalapeño             -> supplier_id = Produce Vendor id
    Oaxaca Cheese         -> supplier_id = null (unknown)
    Eggs                  -> supplier_id = null
    Bolillo Roll          -> supplier_id = null

  IDs resolved by name lookup after insert — not hardcoded.

### 1E. Update verify-seed.js

  Update suppliers count: 2 -> 7
  Add assertions:
    Restaurant Depot has vendor_type = Restaurant Supply
    Local Butcher has vendor_type = Local Vendor
    Internal Production has vendor_type = Internal Production
    Webstaurant has lead_time_days = 3
    No supplier named "In-house" exists (rename enforced)
  Add inventory->supplier_id link assertions:
    Birria Beef supplier_id -> Local Butcher
    Corn Tortillas supplier_id -> Restaurant Depot
    Consomé supplier_id -> Internal Production
    Cilantro supplier_id -> Produce Vendor
    To-Go Bowls supplier_id -> Webstaurant
  Existing 62 assertions unchanged.
  Estimated new assertions: ~12
  New total: ~74

---

## Phase 2 — Backend: crud.js + overview.js + routes

### 2A. Update crud.js writableFields for suppliers

  New: [name, category, vendor_type, phone, email, notes, contact_name,
        website, address, delivery_days, default_order_day, lead_time_days,
        minimum_order, payment_terms, active]
  Removed vs v1: rating
  Added vs v1: vendor_type

  Update inventory writableFields to include supplier_id:
  New: [...existing..., supplier_id]

### 2B. Update overview.js — supplier dashboard stats

  After fetching inventory and suppliers, enrich each supplier with stats
  computed in JS before returning overview.data:

  For each supplier in suppliers.rows:
    linked_count = inventory.rows.filter(i => i.supplier_id === s.id).length
    low_count    = inventory.rows.filter(i =>
                     i.supplier_id === s.id &&
                     Number(i.min_stock) > 0 &&
                     Number(i.current_stock) > 0 &&
                     Number(i.current_stock) <= Number(i.min_stock)
                   ).length
    out_count    = inventory.rows.filter(i =>
                     i.supplier_id === s.id &&
                     Number(i.min_stock) > 0 &&
                     Number(i.current_stock) <= 0
                   ).length

  These three computed fields travel with each supplier object in
  overview.data.suppliers — no extra API call needed from the frontend.

  Note: out_count and low_count only count items where min_stock > 0
  (Alerts Not Configured items are excluded from alert counts).

### 2C. New route: GET /api/suppliers/:id/inventory

  Returns full inventory rows linked to a supplier_id.
  Used by SupplierCard expanded view.
  Query: SELECT * FROM inventory WHERE supplier_id =  ORDER BY name

---

## Phase 3 — Frontend: Custom Suppliers Page

### 3A. Replace generic Collection with SuppliersPage

  Add to App.jsx routing:
    {page==='suppliers' && <SuppliersPage suppliers={data} inventory={overview.data.inventory||[]} api={auth.api} refresh={refresh}/>}

  Pass inventory as prop so stats are available without extra fetch.
  Remove suppliers from Collection fallthrough.

### 3B. SupplierCard layout

  Collapsed (default):
    Row 1: supplier name + active/inactive badge + vendor_type badge
    Row 2: phone · delivery_days · lead_time_days + "d lead"
    Row 3: dashboard stats bar
      [N linked]  [N low]  [N out]
      Linked: muted gray
      Low: yellow #fde68a (only shown if low_count > 0)
      Out: red #fca5a5 (only shown if out_count > 0)
    Chevron to expand

  Expanded:
    Contact section: contact_name, phone, email, website, address
    Logistics section: delivery_days, default_order_day, lead_time_days, minimum_order
    Terms section: payment_terms
    Notes
    Linked Inventory section:
      List of inventory items where supplier_id = this supplier
      Each row: name + stock badge (OK/Low/Out/Alerts Not Configured) + current_stock + unit
      Fetched from overview.data.inventory filtered by supplier_id (no extra API call)
    Actions: Edit | Delete

### 3C. SupplierModal

  Section: Basic
    Name (required)
    vendor_type (dropdown): Distributor / Local Vendor / Wholesale Club /
      Restaurant Supply / Manufacturer / Internal Production / Other
    Category (existing text field — kept for backward compat)
    Active (checkbox, default true)

  Section: Contact
    contact_name, phone, email, website, address

  Section: Order Logistics
    delivery_days (text: "Mon, Wed, Fri")
    default_order_day (dropdown: Mon-Sun)
    lead_time_days (number, default 1)
    minimum_order (number, $)

  Section: Terms
    payment_terms (text: COD / Net 30 / Credit card / etc.)

  Section: Notes (textarea)

  Buttons: Save | Cancel
  Validation: name required

### 3D. SuppliersPage header

  Header card: supplier count + Add Supplier button
  Search input: filter by name, category, vendor_type
  Active filter toggle: All / Active only / Inactive
  Dashboard summary row above cards:
    Total suppliers: N
    Active: N
    Inventory alerts: N items low or out across all suppliers

### 3E. vendor_type badge colors

  Distributor       — blue   rgba(59,130,246,.2)   #93c5fd
  Local Vendor      — green  rgba(34,197,94,.18)   #86efac
  Wholesale Club    — purple rgba(168,85,247,.18)  #d8b4fe
  Restaurant Supply — orange rgba(249,115,22,.18)  #fed7aa
  Manufacturer      — gray   rgba(255,255,255,.08) #a1a1aa
  Internal Production — teal rgba(20,184,166,.18)  #99f6e4
  Other             — gray   rgba(255,255,255,.08) #a1a1aa

---

## Phase 4 — Frontend: Inventory UI Updates

### 4A. InventoryModal — supplier dropdown

  Replace free-text supplier input with <select>
  Options: — none — plus all active suppliers from overview.data.suppliers
  Value: supplier_id (integer)
  Stop writing inventory.supplier text field from modal going forward.
  Pass suppliers prop into InventoryPage from App.jsx.

### 4B. InventoryCard — resolve supplier name

  Resolve supplier name from supplier_id:
    const sup = suppliers.find(s => s.id === item.supplier_id)
  Display: {sup && <p className="muted">Supplier: {sup.name}</p>}
  Fallback: if supplier_id null but old text exists, show item.supplier

### 4C. App.jsx — pass suppliers to InventoryPage

  <InventoryPage items={data} suppliers={overview.data.suppliers||[]}
    api={auth.api} refresh={refresh}/>

---

## Phase 5 — Production Migration SQL

Run once on production DB. seed.js only runs on empty DB.

  Step 1: Insert 5 missing suppliers (idempotent)
    INSERT INTO suppliers (name, vendor_type, category, notes)
    SELECT name, vendor_type, category, notes FROM (VALUES
      ('Internal Production', 'Internal Production', 'Prep', 'Made on premises'),
      ('Produce Vendor', 'Local Vendor', 'Produce', 'Local produce'),
      ('Webstaurant', 'Distributor', 'Packaging', 'To-go containers'),
      ('Costco', 'Wholesale Club', 'Bulk', 'Pickup only'),
      ('US Foods', 'Distributor', 'Food/Supplies', 'Broadline distributor')
    ) AS v(name, vendor_type, category, notes)
    WHERE NOT EXISTS (SELECT 1 FROM suppliers WHERE suppliers.name = v.name);

  Step 1b: Rename any existing "In-house" to "Internal Production"
    UPDATE suppliers SET name = 'Internal Production',
      vendor_type = 'Internal Production'
    WHERE name = 'In-house';

  Step 1c: Update inventory text references from "In-house" to match
    UPDATE inventory SET supplier = 'Internal Production'
    WHERE supplier = 'In-house';

  Step 2: Set supplier_id on inventory via text match
    UPDATE inventory SET supplier_id = s.id
    FROM suppliers s
    WHERE inventory.supplier = s.name
    AND inventory.supplier IS NOT NULL
    AND inventory.supplier != '';

  Step 3: Verify
    SELECT i.name, i.supplier, s.name AS resolved, s.vendor_type
    FROM inventory i LEFT JOIN suppliers s ON s.id = i.supplier_id
    ORDER BY i.name;

### Safety
  All steps are additive or UPDATE on nullable column
  inventory.supplier text not dropped
  WHERE NOT EXISTS makes Step 1 safe to re-run

---

## Phase 6 — Verification

  Automated:
    node server/db/verify-seed.js  (target: ~74 assertions, 0 failures)

  API spot checks:
    GET /api/suppliers -> 7 rows, vendor_type populated, no rating field
    GET /api/suppliers/:id/inventory -> linked items for Restaurant Depot
    GET /api/overview -> suppliers include linked_count, low_count, out_count
    GET /api/inventory -> supplier_id populated on 11 items
    GET /api/menu/1/cost -> Quesabirria Tacos .22 unchanged
    GET /api/menu/2/cost -> Birria Ramen .83 unchanged
    GET /api/menu/3/cost -> Birria Torta .78 unchanged
    Confirm no supplier named "In-house" exists

  UI checks:
    Suppliers page: 7 cards, each with vendor_type badge
    Supplier card collapsed: stats bar shows linked/low/out counts
    Supplier card expanded: linked inventory list with stock badges
    Internal Production card shows no low/out alerts (prep item)
    Inventory modal: supplier dropdown (not text input)
    Inventory card: supplier name resolved from supplier_id
    Ingredients page: unaffected
    Menu costing: unchanged

---

## Rollback Plan

| Phase | What changed | Rollback action | Data loss risk |
|---|---|---|---|
| 1A (ALTER suppliers) | 10 new nullable cols | DROP COLUMN each | None |
| 1B (supplier_id on inventory) | 1 nullable FK | DROP COLUMN supplier_id | None — text field untouched |
| 1C (init.js) | Schema definition | Revert commit | None |
| 1D (seed.js) | Seed data + rename | Revert commit | None — insertIfEmpty idempotent |
| 1E (verify-seed.js) | Assertions | Revert commit | None |
| 2A (crud.js) | writableFields | Revert commit | None |
| 2B (overview.js) | Stats enrichment | Revert commit | None |
| 2C (new route) | GET endpoint | Remove route | None |
| 3 (SuppliersPage) | New UI component | Remove, revert to Collection | None |
| 4 (InventoryModal) | Supplier dropdown | Revert to text input | None |
| 5 (prod migration) | supplier_id set, rename | Set supplier_id=NULL, rename back | No data deleted |

All phases additive. No existing columns dropped. No costing tables touched.

---

## Execution Order

  Phase 1: Schema — single commit (init.js + seed.js + verify-seed.js)
  Phase 2: Backend — single commit (crud.js + overview.js + api.js)
  Phase 3: Frontend Suppliers page — single commit
  Phase 4: Frontend Inventory updates — single commit
  Phase 5: Production migration — run manually, verify immediately
  Phase 6: Full verification + doc

Phases 1-4 against fresh DB (seed rebuild).
Phase 5 against production — only step with live data.

---

## Dependencies on Existing Code

| File | Change | Breaking? |
|---|---|---|
| server/db/init.js | ADD columns to suppliers + inventory | No |
| server/db/seed.js | Expand suppliers (rename In-house), supplier_id on inventory | No |
| server/db/verify-seed.js | Count 2->7, vendor_type + link assertions | No |
| server/services/crud.js | Add new fields to writableFields (drop rating) | No |
| server/services/overview.js | Enrich suppliers with stats (linked/low/out) | No |
| server/routes/api.js | Add /suppliers/:id/inventory route | No |
| client/src/App.jsx | SuppliersPage, SupplierModal, InventoryPage updates | No |

No changes to: costing.js, consumption.js, profitability.js,
mii/mici tables, recipe/compound logic, existing 62 verify-seed assertions.

---

## Estimated Effort

| Phase | Effort |
|---|---|
| 1 Schema | 30 min |
| 2 Backend | 45 min |
| 3 Suppliers UI | 2 hours |
| 4 Inventory UI | 30 min |
| 5 Production migration | 15 min |
| 6 Verification + doc | 30 min |
| **Total** | **~4.5 hours** |

Phase 3 estimate increased from v1 (1.5h -> 2h) due to:
  - vendor_type badge color system
  - dashboard stats bar on collapsed card
  - stats computed in overview.js (Phase 2 adds 15 min)
