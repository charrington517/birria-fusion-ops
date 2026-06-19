# TRUCKFLOW_OPS_REORDER_CENTER_DESIGN

**Status**: Design only — no code, no DB, no UI changes
**Date**: 2026-06-18
**App state**: v0.5.1 — Food Module stable, verify-seed 62/62
**Prerequisite design**: TRUCKFLOW_OPS_SUPPLIER_VENDOR_WORKFLOW_DESIGN.md

---

## Live Data Audit (basis for design)

Inventory as of design date: 14 items

Reorder simulation results:

| Item | Stock | Min | Status | Supplier |
|---|---|---|---|---|
| Birria Beef | 7.75 lb | 20 lb | LOW | Local Butcher |
| Corn Tortillas | 0.41 packs | 8 packs | LOW | Restaurant Depot |
| To-Go Bowls | 0.59 cases | 2 cases | LOW | Webstaurant |
| Cilantro | -0.05 bunch | 5 | OUT | Produce Vendor |
| Consomé | -0.25 qt | 8 qt | OUT | In-house |
| Dried Guajillo Chiles | -0.30 oz | 0 | OUT | (none) |
| White Onion | -0.30 each | 0 | OUT | (none) |
| Oaxaca Cheese | -0.375 lb | 0 | OUT | (none) |
| Beef Shank | 0 lb | 0 | OUT | (none) |
| Bolillo Roll | 0 each | 0 | OUT | (none) |
| Eggs | 0 each | 0 | OUT | (none) |
| Jalapeño | 0 each | 0 | OUT | (none) |
| Ramen Noodles | 0 servings | 0 | OUT | (none) |
| Refried Beans | 0 oz | 0 | OUT | (none) |

Key observations:
- 11 of 14 items are Out or Low right now
- 9 items have min_stock = 0 (not configured for alerting)
- 9 items have no supplier assigned
- 9 items have forecast_per_event = 0 (no demand data)
- 2 active suppliers in DB; 3 more referenced by text only (Webstaurant, Produce Vendor, In-house)

Upcoming demand:
- Toledo Market Day: 2026-05-10 (Confirmed, expected ,800)
- Lincoln City Chamber catering: 2026-05-11 (Booked, 85 guests, ,650)
- Toledo Summer Festival: 2026-05-18 (Quote Sent, 200 guests, ,800)

---

## 1. What Is the Reorder Center?

The Reorder Center is the operational dashboard that tells the owner:
  - What to buy
  - How much to buy
  - Who to buy it from
  - When to buy it

It bridges three existing systems:
  Inventory (current stock, min/max, cost)
  Events/Catering (upcoming demand)
  Suppliers (who to call, delivery days)

It is NOT a purchase order system (that is Phase 5 in the supplier design).
It is a smart shopping list generator with urgency ranking.

Core output: a grouped, printable/shareable list that the owner reviews
before calling Restaurant Depot, texting the butcher, or placing an online order.

---

## 2. Reorder Decision Logic

An item needs reorder when any of the following are true:

Rule 1 — Stock at or below minimum:
  current_stock <= min_stock
  Simple threshold. Works today for 3 items (Birria Beef, Corn Tortillas, To-Go Bowls).

Rule 2 — Stock is zero or negative:
  current_stock <= 0
  Hard flag — inventory is depleted or overdrawn.
  Applies to 11 items today (mostly items with min_stock = 0 not yet configured).

Rule 3 — Forecast-driven shortfall (single event):
  stock_needed = forecast_per_event * events_in_window
  shortfall = stock_needed - current_stock
  If shortfall > 0 -> Order Soon or Order Now depending on lead time.

Rule 4 — Catering-driven demand:
  catering.guests * per_guest_usage (not yet tracked) -> future enhancement.
  Phase 1: use forecast_per_event as a proxy regardless of event type.

Rule 5 — Lead time urgency (future, requires supplier lead_time_days):
  event_date - today <= lead_time_days -> escalate to Order Now.
  Requires supplier.lead_time_days field (Phase 1 supplier enrichment).

### Calculation for suggested order quantity

Primary (when max_stock is set):
  suggested_qty = max_stock - current_stock

Fallback (when max_stock = 0 but forecast exists):
  suggested_qty = (forecast_per_event * 3) - current_stock
  (3 events is the default planning horizon — configurable later)

Final fallback (no max_stock, no forecast):
  suggested_qty = NULL (owner must enter manually)
  Show placeholder: "Enter qty"

---

## 3. Reorder Status Values

| Status | Color | Trigger | Action |
|---|---|---|---|
| OK | Green #86efac | stock > min AND forecast covered | No action needed |
| Order Soon | Yellow #fde68a | stock <= min_stock * 1.5 OR shortfall within 2 events | Add to next order |
| Low | Orange #fb923c | stock <= min_stock AND stock > 0 | Order this week |
| Out | Red #fca5a5 | stock <= 0 | Order immediately |
| Order Now | Red + pulse | Out AND upcoming event within lead_time_days | Critical — event at risk |

Status priority for sort order: Order Now > Out > Low > Order Soon > OK

### Status badge colors map to existing badge system
  OK -> green badge
  Order Soon -> yellow badge
  Low -> orange (use brand orange #fb923c)
  Out -> red badge
  Order Now -> red badge with note

---

## 4. Reorder Grouping

The owner needs to see items grouped by how they will actually be ordered.

### Primary grouping: By Supplier

Most useful operationally — one section per vendor call/trip:

  LOCAL BUTCHER
    Birria Beef         Low    72.25 lb   (max 80 - stock 7.75)
    Beef Shank          Out    TBD

  RESTAURANT DEPOT
    Corn Tortillas      Low    29.6 packs (max 30 - stock 0.41)
    Dried Guajillo Ch.  Out    TBD
    Ramen Noodles       Out    TBD

  PRODUCE VENDOR
    Cilantro            Out    20.05 bunch
    White Onion         Out    TBD
    Jalapeño           Out    TBD

  WEBSTAURANT
    To-Go Bowls         Low    7.41 cases
    Bolillo Roll        Out    TBD

  UNASSIGNED
    Oaxaca Cheese       Out    TBD
    Eggs                Out    TBD
    Refried Beans       Out    TBD

  IN-HOUSE (prep items — not ordered externally)
    Consomé            Out    (make 30.25 qt)

### Secondary grouping: By Category
  Meat, Produce, Dairy, Dry Goods, Packaging, Prep
  Useful for shopping at a single store like Restaurant Depot

### Tertiary grouping: By Urgency
  Flat list sorted Order Now -> Out -> Low -> Order Soon
  Quick scan for critical items across all suppliers

### UI toggle
  Three buttons: [By Supplier] [By Category] [By Urgency]
  Default: By Supplier
  Selected grouping persists for session

---

## 5. Owner Workflow

### Entry point: Today dashboard card

  +----------------------------------+
  | Reorder Alert                    |
  | 11 items need attention          |
  | 3 Low  8 Out                     |
  | [Open Reorder Center]            |
  +----------------------------------+

### Reorder Center page (full view)

Step 1 — Review
  Owner sees all items needing reorder, grouped by supplier.
  Each row shows: item name, status badge, current stock, suggested qty, unit, supplier.
  Upcoming events panel shows demand context:
    "Toledo Market Day in 3 days — expected 12 lb Birria Beef needed"

Step 2 — Select
  Checkboxes on each row (all checked by default for Out/Low items).
  Owner unchecks items they will skip this order.
  Can uncheck an entire supplier section.

Step 3 — Adjust quantities
  Suggested qty is pre-filled but editable.
  Owner can type "50" instead of "72.25" for beef.
  Items with no suggested qty show an input placeholder.

Step 4 — Generate list
  Button: [Generate Shopping List]
  Creates a formatted output (screen + print/copy) per supplier.

Step 5 — Act
  Owner uses the list to:
  - Make phone calls (butcher)
  - Place online order (Webstaurant, Restaurant Depot)
  - Create a prep task (In-house compounds)

### After ordering
  Owner manually updates inventory.current_stock when stock arrives.
  Phase 5: PO receipt flow handles this automatically.

---

## 6. Shopping List Output

### Screen display (per supplier section)

  ┌─────────────────────────────────────────┐
  │ LOCAL BUTCHER                           │
  │ Contact: —    Phone: —                  │
  │ Order Days: —                           │
  ├─────────────────────────────────────────┤
  │ Birria Beef     72 lb    [Out of stock] │
  │ Beef Shank      TBD      [Out]          │
  └─────────────────────────────────────────┘

### Print/copy format (plain text per supplier)

  LOCAL BUTCHER
  Date: 2026-06-18
  ---
  Birria Beef         72 lb
  Beef Shank          TBD
  ---
  Notes: (owner free-text)

### Required fields from suppliers table for output
  name            (exists)
  contact_name    (missing — Phase 1 supplier enrichment)
  phone           (exists, currently empty)
  delivery_days   (missing — Phase 1)
  notes           (exists)

### Required fields from inventory for output
  name            (exists)
  unit            (exists)
  current_stock   (exists)
  min_stock       (exists)
  max_stock       (exists)
  forecast_per_event (exists)
  supplier text   (exists — will become supplier_id in Phase 2)

---

## 7. Future Purchase Order Connection

The Reorder Center is Phase 3 in the supplier roadmap.
It grows into the PO workflow in Phase 5 as follows:

Phase 3 (Reorder Center — this design):
  Reorder list is generated but NOT saved to DB.
  Owner uses it as a reference to make calls/orders manually.
  No new tables required.
  All data comes from existing inventory + events + catering.

Phase 5 (Purchase Orders):
  "Save as Draft PO" button appears in Reorder Center.
  Draft PO saved to purchase_orders table.
  Each checked item becomes a purchase_order_lines row.
  Owner marks PO as Sent after placing the order.
  When goods arrive: Mark PO as Received.
  -> Auto-increments inventory.current_stock for each line.
  -> Records price paid in supplier_price_history.
  -> Creates inventory_transactions with reason "PO#X Receipt".

Data flow diagram:

  [Inventory min/max]         [Events + Catering]
  [forecast_per_event]   +    [upcoming demand]
         |                         |
         v                         v
    [Reorder Engine]  ←────────────
         |
         v
  [Reorder Center UI]  (Phase 3)
         |
         v
  [Shopping List / Print]  (Phase 3)
         |
         v
  [Draft Purchase Order]  (Phase 5)
         |
         v
  [PO Receipt -> stock increment]  (Phase 5)

---

## 8. Data Needed Now vs Later

### Available now (no changes required)
| Field | Table | Used for |
|---|---|---|
| current_stock | inventory | Status calculation |
| min_stock | inventory | Low/Out threshold |
| max_stock | inventory | Suggested order qty |
| forecast_per_event | inventory | Demand estimate |
| supplier (text) | inventory | Group by supplier (imperfect) |
| name, date, status | events | Upcoming demand context |
| guests, date, status | catering | Upcoming demand context |
| name, notes | suppliers | Shopping list header |

### Needed — Phase 1 supplier enrichment (no schema change to inventory)
| Field | Table | Used for |
|---|---|---|
| contact_name | suppliers | Shopping list header |
| delivery_days | suppliers | Lead time / urgency |
| lead_time_days | suppliers | Order Now trigger |
| active | suppliers | Filter inactive suppliers |

### Needed — Phase 2 supplier_id FK on inventory
| Field | Table | Used for |
|---|---|---|
| supplier_id | inventory | Clean grouping, no string matching |

### Needed — Phase 4 (cost history)
| Field | Table | Used for |
|---|---|---|
| price, effective_date | supplier_price_history | Cost trend per item |

### Needed — Phase 5 (purchase orders)
| Tables | Used for |
|---|---|
| purchase_orders | PO header per supplier |
| purchase_order_lines | Line items per PO |

---

## 9. Current Inventory Fields Review

| Field | Status | Notes |
|---|---|---|
| current_stock | Good | Core reorder input. Some negative values (overdrawn) |
| min_stock | Partially configured | 5 of 14 items have min_stock > 0. Others need setup |
| max_stock | Partially configured | 5 of 14 items have max_stock > 0. Drives suggested qty |
| forecast_per_event | Partially configured | 5 of 14 items have value > 0. Others need setup |
| supplier (text) | Weak | 5/14 populated. 3 values not in suppliers table. No FK integrity |

### Gaps that affect Reorder Center quality

Gap 1 — 9 items have min_stock = 0:
  These items will always show as "Out" once stock depletes.
  Fix: owner sets min_stock for each active menu ingredient.
  Items affected: Beef Shank, Dried Guajillo Chiles, White Onion, Oaxaca Cheese,
                  Ramen Noodles, Eggs, Bolillo Roll, Refried Beans, Jalapeño.

Gap 2 — 9 items have no supplier assigned:
  These land in "Unassigned" supplier group.
  Fix: Phase 2 supplier_id migration populates all items.

Gap 3 — 9 items have forecast_per_event = 0:
  Suggested order quantity will fall back to "Enter qty" for these.
  Fix: owner sets forecast_per_event (how many units needed per service day).

Gap 4 — supplier text values do not match suppliers table:
  "Webstaurant", "Produce Vendor", "In-house" have no suppliers row.
  Phase 1 fix: add these 3 suppliers to seed.js.
  Phase 2 fix: replace text field with supplier_id FK.

---

## 10. Recommendation: Option D

**Today card (summary) + Dedicated Reorder Center page**

### Today card
  Always visible on dashboard.
  Shows count only: "11 items need reorder — 3 Low, 8 Out".
  Single call-to-action: [Open Reorder Center].
  Updates on every overview refresh.
  Zero new data fetching — reorder count derived from existing overview.data.inventory.

### Dedicated Reorder Center page
  Accessible via sidebar (under Kitchen or Office — recommend Kitchen).
  Full workflow: review, select, adjust, generate list.
  Grouping toggle: By Supplier / By Category / By Urgency.
  Upcoming events panel for demand context.
  Print / copy list output per supplier.

### Why not A (Inventory page section)?
  Inventory page is already dense — grouped by category with stock badges.
  A reorder workflow embedded there competes with the stock management view.
  Reorder is an action, not a view — deserves its own page.

### Why not B (Today card only)?
  The card is essential but insufficient.
  Owner needs to interact with items, adjust quantities, and generate output.
  That requires a full page.

### Why not C (Office page only)?
  Reorder Center is a Kitchen/Food operation, not an Office operation.
  Proximity to Inventory and Ingredients in the Kitchen group improves findability.

---

## Implementation Phases

**Phase 0 — Data setup (no code, owner action)**
  Set min_stock, max_stock, forecast_per_event for 9 unconfigured items.
  Assign suppliers to 9 unassigned inventory items.
  This immediately improves reorder quality with zero code changes.

**Phase 1 — Today card reorder count**
  Add reorder count to Today dashboard card.
  Source: overview.data.inventory filtered client-side.
  Logic: count items where current_stock <= min_stock OR current_stock <= 0.
  No new backend route. No new tables.
  Effort: 1-2 hours.

**Phase 2 — Reorder Center page (read-only)**
  New page key: reorder (add to Kitchen group in sidebar).
  New backend route: GET /api/inventory/reorder
    Returns: inventory rows with reorder_status, suggested_qty, supplier name.
    Pure SELECT query — no writes.
  New frontend page: ReorderPage
    Grouping toggle (By Supplier default)
    Urgency badges
    Upcoming events panel
  Effort: 1 sprint.

**Phase 3 — Interactive reorder (select + adjust + generate)**
  Add checkboxes and quantity inputs to ReorderPage.
  Generate Shopping List button -> formatted per-supplier output.
  Print/copy to clipboard.
  Still no DB writes — session state only.
  Effort: 1 sprint.

**Phase 4 — Supplier enrichment (enables better output)**
  Add contact_name, delivery_days, lead_time_days to suppliers.
  Reorder list output now shows contact + delivery day.
  Order Now status activates (lead time aware).
  Effort: half sprint (builds on supplier Phase 1 design).

**Phase 5 — Purchase order integration**
  Save as Draft PO button.
  Connects to purchase_orders + purchase_order_lines tables.
  PO receipt flow increments stock.
  Effort: 2 sprints (builds on supplier Phase 5 design).

---

## Rollback Considerations

| Phase | Schema change | Risk | Rollback |
|---|---|---|---|
| 0 (data setup) | None | Zero | Revert stock/min values manually |
| 1 (Today card) | None | Zero | Remove 3 lines of JSX |
| 2 (page + route) | None | Zero | Remove route + page component |
| 3 (interactive) | None | Zero | Remove checkbox/output code |
| 4 (supplier fields) | Additive only | Low | Stop rendering new fields |
| 5 (PO integration) | New tables | Medium | Drop PO tables, revert stock |

Phases 1-3 are entirely read-only and carry zero rollback risk.
No existing table is modified until Phase 5.

---

## Summary

The Reorder Center is the highest-value, lowest-risk next feature for TruckFlow Ops.

Why highest value:
  11 of 14 inventory items are currently Out or Low.
  3 upcoming events (2 confirmed) create immediate demand.
  The owner has no structured way to generate a shopping list today.

Why lowest risk:
  Phases 1-3 require zero schema changes.
  All data already exists in inventory, events, catering.
  The Today card (Phase 1) is a 1-2 hour implementation.
  The full ReorderPage (Phase 2-3) builds on stable existing patterns.

Architecture decision: Option D
  Today card: live count, single click to Reorder Center.
  Dedicated ReorderPage under Kitchen group.
  Grouping: By Supplier (default) / By Category / By Urgency.
  Shopping list output: printable/copyable per supplier.
  Future: Draft PO button connects seamlessly when PO system is ready.
