# TRUCKFLOW_OPS_INVENTORY_QUICK_ADJUST_DESIGN

**Status**: Design only — no code, no DB, no UI changes
**Date**: 2026-06-18
**App state**: v0.5.1 — Food Module stable, verify-seed 62/62

---

## Context

Current workflow to update stock:
  1. Find item card
  2. Click Edit
  3. Scroll to Current Stock field
  4. Clear value, type new value
  5. Click Save
  6. Wait for page refresh

That is 5+ steps for a routine daily action.
The owner restocks after every supply run and after every event.
At 14 inventory items this is already 70+ clicks per full restock cycle.

Quick Adjust compresses this to 2 taps per item.

---

## 1. Should Quick Adjust Be on Inventory Cards?

Yes — directly on the card is the correct location.

Rationale:
  The owner scans the card to see current stock.
  The action belongs next to the data it affects.
  A separate page or modal adds navigation friction.
  Other POS and inventory apps (Square, Toast, MarketMan) all use
  inline +/- controls on item cards for this reason.

Placement on card:
  Below the inv-grid stats, above the Edit/Delete actions.
  Collapsed by default — shown via a small "Adjust" toggle button.
  Expanding in-place keeps the card compact until needed.

Why collapsed by default:
  The card is already information-dense.
  Most views are read-only (checking stock levels).
  Accidental taps on +/- are a real risk on mobile.
  Collapse-to-reveal is the same pattern used by MenuCard and RecipeCard.

---

## 2. Which Buttons?

Recommended button set — unit-aware:

The correct increment depends entirely on the item unit.
A single fixed set (+1/+5/+10) works for some items but is wrong for others.

Live inventory units:
  lb      — Birria Beef, Beef Shank, Oaxaca Cheese
  pack    — Corn Tortillas
  bunch   — Cilantro
  qt      — Consomé
  oz      — Dried Guajillo Chiles, Refried Beans
  each    — Bolillo Roll, Eggs, Jalapeño, White Onion
  serving — Ramen Noodles
  case    — To-Go Bowls

Analysis:
  lb items: +1, +5, +10 make sense (buy 10 lb at a time)
  each items: +1, +12, +24 (eggs come in dozens)
  oz items: +1, +4, +8 (spices in small quantities)
  case items: +1, +2, +5 (To-Go Bowls, full cases)
  bunch: +1, +5, +10
  qt: +1, +4, +8 (gallons)

Recommendation: two-tier approach

Tier 1 (Phase 1 — implement now):
  Fixed set: -1  +1  +5  +10  [custom]
  Custom input: owner types any decimal value
  Works for all units without per-item configuration
  The custom input handles edge cases (buy 72.5 lb of beef)

Tier 2 (Phase 2 — future):
  Per-item increment config stored in inventory table
  New field: quick_adjust_increment (default 1)
  Buttons auto-scale: 1x  5x  10x  of configured increment
  Example: Eggs configured to 12 -> buttons show +12, +24, +60

For Phase 1, the -1 / +1 / +5 / +10 set is correct.
Do not add -5 or -10 as primary buttons.

Why de-emphasize negative adjustments:
  Automated sales depletion already handles most negative changes.
  Positive adjustments (restocking) are the primary owner action.
  Manual negative adjustments are corrections or waste logging.
  Waste should go through the reason selector, not a quick tap.
  Accidental large negative adjustments on mobile are high risk.

Final button layout (Phase 1):
  [−1]  [+1]  [+5]  [+10]  [__custom__]  [Apply]
  Clicking a preset fills the custom input, then Apply commits.
  Or: clicking a preset directly applies with default reason = Correction.
  Recommendation: direct apply (no Apply button) for presets,
  custom input requires Apply to avoid unintentional submissions.

---

## 3. Should Adjustment History Be Logged?

Yes — always. Non-negotiable.

The inventory_transactions table already exists:
  id, inventory_id, change_amount, reason, sales_order_id, created_at

Every quick adjust must write a row to inventory_transactions.
Reasons:
  1. Audit trail — owner can see when stock was changed and why
  2. Discrepancy detection — if stock does not match expectations, trace it
  3. Reorder Center uses transaction history for demand forecasting (Phase 4)
  4. Purchase Order receipt will write positive transactions (Phase 5)
  5. Current sales depletion already logs every negative change
     — quick adjust must use the same pattern for consistency

The quick adjust transaction reason string should be:
  "Quick adjust: +N unit (Reason)"
  Example: "Quick adjust: +10 lb (Purchase)"
  Example: "Quick adjust: -2 lb (Waste)"

sales_order_id will be NULL for all quick adjust transactions.

---

## 4. Should Reasons Be Required?

Recommended: required for custom/negative, optional for positive presets.

### Reason values
  Purchase   — restocking from supplier (most common positive)
  Correction — fixing a count error (most common for small +/-)
  Waste      — spoilage, dropped, expired
  Prep       — used in kitchen prep not tracked by a sale
  Event Use  — used at an event, not through the sales system

### When to require a reason

Positive preset buttons (+1, +5, +10):
  Default reason: Purchase
  No reason selection shown — too much friction for routine restocking.
  Owner can override if needed.

Custom positive input:
  Reason selector shown, defaults to Purchase.
  Not required — owner can submit without changing it.

Negative custom input:
  Reason selector required — cannot submit with blank reason.
  This forces intentionality on manual depletion.
  Waste and Correction are the primary negative-adjustment reasons.

Preset -1 button (if included):
  Default reason: Correction
  Same pattern as positive presets — no selector shown.

### Reason selector UI
  Small segmented control or dropdown below the quantity input.
  Only visible when custom input is active.
  Values: Purchase / Correction / Waste / Prep / Event Use

---

## 5. Mobile Layout

The inventory card already uses a 2x2 inv-grid.
Quick Adjust must fit within the card width without horizontal overflow.

### Mobile constraints
  Card width: ~285px minimum (from .cards grid minmax)
  On mobile at 375px screen: full width minus card padding (~20px each side)
  Available width: ~335px

### Recommended mobile layout

Collapsed state (default):
  [Adjust ▼] button — small, muted, right-aligned below stats
  Same visual weight as a secondary action, not as prominent as Edit

Expanded state:
  Row 1: preset buttons + custom input
    [+1]  [+5]  [+10]  [_____]
    Buttons: ~44px wide each (touch target >= 44px per Apple HIG)
    Custom input: flex-grow to fill remaining space
  Row 2 (if custom): reason selector — full width dropdown
  Row 3: Apply (only for custom input)
  Row 4: [Close ▲] to collapse

### Button sizing
  Min height: 44px (mobile touch target standard)
  Font size: 14px
  Gap: 6px between buttons
  4 buttons + input at 335px: 4×44px + 4×6px gaps + flexible input
  = 176px buttons + 24px gaps = 200px buttons, leaving ~135px for input
  This fits comfortably.

### Negative button placement on mobile
  Do not include -1/-5/-10 as primary buttons on mobile.
  Include a single [−] toggle that reveals a negative input.
  This reduces accidental negative adjustments on touchscreens.

---

## 6. Future Connection to Event Sales, Depletion, Reorder Center

### Event sales (current)
  Sales depletion already writes to inventory_transactions automatically.
  Quick Adjust is for manual corrections outside the sales flow.
  The two systems are complementary, not overlapping.
  No changes needed to sales depletion when Quick Adjust is built.

### Inventory depletion consistency
  Current consumption.js deduction pattern:
    UPDATE inventory SET current_stock = current_stock - N WHERE id = X
    INSERT INTO inventory_transactions (inventory_id, change_amount, reason, sales_order_id)
  Quick Adjust must follow the same two-step pattern.
  A dedicated backend route (/api/inventory/:id/adjust) should encapsulate
  both the UPDATE and the INSERT in a single transaction.
  This prevents the edge case where stock updates but the log row fails.

### Reorder Center (Phase 3)
  Reorder Center reads current_stock to determine reorder status.
  Quick Adjust restocking updates current_stock directly.
  After a quick adjust restocking, the item immediately drops off the
  reorder list (if new stock > min_stock).
  No additional integration needed — the data connection is automatic.

### Reorder Center — purchase receipt flow (Phase 5)
  When the PO receipt system is built, receiving a purchase order
  will use the same /api/inventory/:id/adjust route with reason=Purchase
  and a po_id reference.
  Quick Adjust is the prototype for that flow.
  Building Quick Adjust now de-risks the PO receipt implementation later.

### Cost history (Phase 4)
  If the owner also updates the unit cost when restocking
  (price increased since last order), Quick Adjust could optionally
  capture a new cost value and write a supplier_price_history row.
  Phase 1: ignore cost updates in Quick Adjust.
  Phase 4: add optional cost field to the adjustment form.

### Activity log
  The activity table already logs all CRUD operations via crud.js.
  The quick adjust route should also write an activity row:
  "Adjusted Birria Beef stock: +10 lb (Purchase)"

---

## Implementation Plan

**Phase 1 — Quick Adjust (this sprint)**

Backend:
  New route: POST /api/inventory/:id/adjust
  Body: { change_amount: numeric, reason: text }
  Action:
    BEGIN;
    UPDATE inventory SET current_stock = current_stock + change_amount WHERE id = ;
    INSERT INTO inventory_transactions (inventory_id, change_amount, reason) VALUES (, , );
    COMMIT;
  Returns: updated inventory row

Frontend:
  Add adjustOpen state to InventoryPage (per-card toggle)
  Collapsed: small [Adjust] button below inv-grid
  Expanded: preset buttons (+1/+5/+10) + custom input + reason selector
  Preset buttons: direct apply, reason defaults to Purchase
  Custom input + Apply: reason selector shown, defaults to Purchase
  Negative input: reason required before Apply
  On success: refresh() to update card stock display

**Phase 2 — Per-item increment config**
  Add quick_adjust_increment to inventory table
  Buttons auto-scale to 1x/5x/10x of configured increment

**Phase 4 — Cost capture on adjustment**
  Optional cost field in adjustment form
  Writes supplier_price_history row on cost change

**Phase 5 — PO receipt**
  PO receipt uses /api/inventory/:id/adjust with reason=Purchase, po_id

---

## Rollback Considerations

| Phase | Schema change | Risk | Rollback |
|---|---|---|---|
| 1 (quick adjust) | None (uses existing tables) | Low | Remove route + UI component |
| 2 (increment config) | ADD COLUMN quick_adjust_increment | Low | Column is nullable, UI falls back to 1 |
| 4 (cost capture) | No schema change | Low | Remove cost field from form |
| 5 (PO receipt) | New tables | Medium | Drop PO tables, revert stock |

Phase 1 is the lowest-risk high-value feature in the current backlog.
The backend route is a single protected endpoint.
The frontend is a collapsible inline component.
No existing functionality is modified.

---

## Summary

| Question | Answer |
|---|---|
| On inventory cards? | Yes — inline, collapsed by default |
| Buttons | +1 +5 +10 + custom input. Presets direct-apply. No primary negative presets |
| Log adjustments? | Yes — always. Write to inventory_transactions every time |
| Reasons required? | Negative custom: required. Positive presets: default to Purchase |
| Reason values | Purchase / Correction / Waste / Prep / Event Use |
| Mobile layout | 44px touch targets, 4 buttons + flex input, fits 335px card |
| Event sales connection | Automatic — both write to inventory_transactions / current_stock |
| Reorder Center connection | Automatic — reads current_stock, no integration needed |
| PO receipt connection | Quick Adjust route becomes the PO receipt route in Phase 5 |
| Backend change needed? | Yes — new POST /api/inventory/:id/adjust route |
| DB schema change needed? | No — inventory_transactions already exists |
