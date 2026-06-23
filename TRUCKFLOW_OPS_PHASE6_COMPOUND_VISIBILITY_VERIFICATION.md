# TRUCKFLOW_OPS_PHASE6_COMPOUND_VISIBILITY_VERIFICATION

**Commit**: 866f545
**File**: client/src/App.jsx (+67 ins / -42 del)
**Branch**: main

## Changes Applied

### New state
  q: text search (name or category)
  healthFilter: All Compounds / Healthy / Broken
  openCards: per-card expand/collapse (id -> bool)

### isBroken(cost)
  Returns true if any component has name=null or name=empty string
  Detects deleted ingredient references in compound components

### CompoundsPage header
  Search input + health filter dropdown + Add Compound button
  Count shows N of total when filtered

### CompoundCard — collapse/expand (matches VendorCard pattern)
  Collapsed: name, category (muted), Missing Ingredient badge (red, when broken),
    Active/Inactive badge, chevron, inv-grid (Yield/Batch Cost/CPU/Components)
  Expanded: Ingredients section with component rows
    Each row: name (or red Missing ingredient) + quantity + line_cost
    COMPOUND badge for nested compound components
    Notes shown italic when populated
  Edit/Delete use e.stopPropagation() to avoid card toggle

## Component Data (verified)

| Compound | Batch Cost | Components |
|---|---|---|
| Birria Consomé Base | 4.95 | Chuck Roast 8lb 6.80, Beef Shank 4lb 6.80, Guajillo 3oz .35 |
| Birria Meat | 5.25 | (nested compound components) |

## Verification Results (20/20)

| Check | Result | Detail |
|---|---|---|
| Consomé Base cost loaded | PASS | batch=4.95 |
| Consomé Base has 3 components | PASS | |
| All component names present | PASS | Chuck Roast / Beef Shank / Guajillo |
| All component line_costs > 0 | PASS | 46.80 / 16.80 / 1.35 |
| Birria Meat cost loaded | PASS | batch=5.25 |
| Consomé Base is not broken | PASS | |
| Birria Meat is not broken | PASS | |
| isBroken detects missing name | PASS | |
| isBroken detects null name | PASS | |
| search consomé returns result | PASS | |
| search category broth returns result | PASS | |
| healthy filter: 2 healthy | PASS | |
| broken filter: 0 broken | PASS | (none broken in current data) |
| Quesabirria Tacos cost | PASS | 5.22 |
| Birria Ramen cost | PASS | 7.83 |
| Birria Torta cost | PASS | 5.78 |

## Build and Service

| Check | Result |
|---|---|
| npm run build | PASS - 1.23s, 0 errors |
| birria-ops active | PASS |
| verify-seed 97/97 | PASS |

## Scope
  client/src/App.jsx only
  No DB changes
  No backend route changes
  Existing cost API reused — no new endpoints
