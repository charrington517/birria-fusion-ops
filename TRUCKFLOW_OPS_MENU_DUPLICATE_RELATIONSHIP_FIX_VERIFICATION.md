# TRUCKFLOW_OPS_MENU_DUPLICATE_RELATIONSHIP_FIX_VERIFICATION

**Commit**: d44c93c
**File**: client/src/App.jsx — MenuPage.duplicate()
**Branch**: main

## Problem Confirmed

Pre-fix test (from audit verification):
  Source id=14: mii=2, mici=2, recipe_id=2
  Duplicate id=15: mii=0, mici=0, recipe_id=2
  VERDICT: FAIL

## Fix Applied

Old (1 line):
  async function duplicate(item) {
    const {id,created_at,...rest} = item;
    await api("/api/menu", {POST, name+" (copy)"});
    await refresh();
  }

New (20 lines):
  1. POST new menu_items row (name + " (copy)", all other fields)
  2. Fetch original mii rows via /api/menu-item-ingredients?menu_item_id=
  3. Fetch original mici rows via /api/menu-item-compound-ingredients?menu_item_id=
  4. POST each mii row with new menu_item_id
  5. POST each mici row with new menu_item_id
  6. On any failure: DELETE the orphaned menu_items row + alert()
  7. refresh() only called on full success

## Verification Test

Source item id=16:
  recipe_id: 2
  mii rows: 2
    ingredient_id=5  qty=1    unit=each
    ingredient_id=10 qty=0.25 unit=each
  mici rows: 2
    compound_id=4 qty=0.25 unit=lb
    compound_id=1 qty=0.75 unit=qt
  cost: 6.53 / source: mii+compound

Duplicate item id=17:
  recipe_id: 2  (copied)
  mii rows: 2  (copied)
    ingredient_id=5  qty=1    unit=each
    ingredient_id=10 qty=0.25 unit=each
  mici rows: 2  (copied)
    compound_id=4 qty=0.25 unit=lb
    compound_id=1 qty=0.75 unit=qt
  cost: 6.53 / source: mii+compound

Original unchanged check:
  Source mii still: 2 (expected 2)  PASS
  Source mici still: 2 (expected 2) PASS

## Results

| Check | Result |
|---|---|
| recipe_id copied | PASS |
| mii rows copied (2/2) | PASS |
| mici rows copied (2/2) | PASS |
| cost matches source (6.53) | PASS |
| cost_source = mii+compound | PASS |
| original item unchanged | PASS |
| npm run build | PASS - 1.14s, 0 errors |
| birria-ops active | PASS |
| verify-seed 62/62 | PASS |
| test data cleaned up | PASS |

## Scope

- Frontend only: client/src/App.jsx (20 ins / 1 del)
- No DB schema changes
- No backend changes
- No costing changes
