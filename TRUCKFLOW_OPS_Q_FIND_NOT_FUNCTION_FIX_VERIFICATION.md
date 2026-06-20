# TRUCKFLOW_OPS_Q_FIND_NOT_FUNCTION_FIX_VERIFICATION

**Commit**: 7cb024f
**File**: client/src/App.jsx (5 ins / 5 del)
**Branch**: main

## Root Cause

The mobile nav fix (commit 84e6d49) introduced:

  function nav(id){ setPage(id); setNavOpen(false); }

This function was declared INSIDE App() at line 130.
The module-level array const nav = [todayItem, ...navGroups.flatMap(...)]
is declared at line 32.

In JavaScript, the inner function declaration shadows the outer const.
Inside App(), every reference to nav resolved to the function, not the array.

Line 116:
  const title = nav.find(x=>x[0]===page)?.[2] || "TruckFlow Ops";

nav was the function, not the array. Calling .find() on a function
threw: TypeError: Q.find is not a function
(Q = minified name for nav in the production bundle)

This caused a full black screen on every page load.

## Fix

Renamed the inner function from nav to navTo:
  function navTo(id){ setPage(id); setNavOpen(false); }

Updated all 3 call sites inside JSX onClick handlers:
  ()=>nav("today")  ->  ()=>navTo("today")
  ()=>nav(id)       ->  ()=>navTo(id)
  ()=>nav("ai")     ->  ()=>navTo("ai")

module-level const nav array is now accessible inside App() again.
nav.find() on line 116 resolves to the array correctly.

Also added suppliers prop to InventoryPage with Array.isArray guard:
  suppliers={Array.isArray(overview?.data?.suppliers)?overview.data.suppliers:[]}

## Why .find() calls on ingredients/allCompounds/recipes were not the cause

All those calls receive props with ||[] fallbacks from overview.data.*
and overview.data is always a properly shaped object when the app renders.
The only unguarded .find() was nav.find() which hit the shadowed function.

## Verification Results

| Check | Result |
|---|---|
| npm run build | PASS - 1.18s, 0 errors, 0 warnings |
| birria-ops active | PASS |
| verify-seed 85/85 | PASS |
| Desktop: no black screen | PASS |
| Today page loads | PASS |
| Inventory page loads | PASS |
| Menu page loads | PASS |
| Ingredients page loads | PASS |
| Mobile hamburger opens nav | PASS |
| Mobile nav tap closes sidebar | PASS |
| Console: no TypeError | PASS |
| Menu costs unchanged | PASS - Tacos 5.22 / Ramen 7.83 / Torta 5.78 |

## Scope

- client/src/App.jsx only: rename nav->navTo (5 lines), suppliers prop (1 line)
- No CSS changes
- No backend changes
- No DB changes
