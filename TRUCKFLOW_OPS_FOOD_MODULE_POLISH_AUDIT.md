# TRUCKFLOW_OPS_FOOD_MODULE_POLISH_AUDIT

**Status**: Audit only — no code changes
**Date**: 2026-06-18
**App**: v0.5.1 — Food Module stable, verify-seed 62/62
**Screenshots**: Not captured (server-side audit from source code + live DB)

---

## 1. Executive Summary

The Food Module is functionally complete and costing-correct.
All three menu items use the mii+compound path. verify-seed passes 62/62.
The core data model is sound.

However, daily owner use reveals friction across all five screens.
The most critical issues are not visual — they are operational:
9 of 14 inventory items have min_stock=0, making the stock alert system
useless for most items. Browser confirm() dialogs block mobile use.
There is no search or filter on any page. The compound modal cost preview
silently excludes nested compound costs without clear explanation.
Recipe editing fetches ALL recipe_ingredients then filters client-side —
a pattern that will break at scale.

Total issues found: 31
  P1 (owner pain):       12
  P2 (future customer):   9
  P3 (cosmetic):         10

---

## 2. P1 — Owner Pain Points

P1-01 | ALL SCREENS | No search or filter on any Food Module page
  With 14 inventory items and 14 ingredients today, it is manageable.
  At 40+ items it becomes unusable. No search input exists anywhere.
  Impact: High. Affects daily use as inventory grows.

P1-02 | INVENTORY | 9 of 14 items have min_stock=0, max_stock=0, forecast=0
  The stock badge shows "Out" for these items perpetually.
  The reorder system cannot generate useful alerts.
  There is no visual indicator in the UI that these fields are unconfigured.
  Impact: High. Makes the entire alert/reorder system misleading.

P1-03 | ALL SCREENS | browser confirm() and alert() dialogs on every delete
  Native browser dialogs are blocked on many mobile browsers.
  They are unstyled, jarring, and inconsistent with the dark theme.
  5 separate confirm() calls across Inventory, Ingredients, Compounds,
  Recipes, and Menu. 2 alert() calls for errors.
  Impact: High. Delete is broken on some mobile configurations.

P1-04 | INVENTORY | Negative stock values displayed with no warning context
  Items like Cilantro (-0.05), Consomé (-0.25), White Onion (-0.30)
  show negative numbers in the stock field with no explanation.
  New owner would not understand why stock is negative.
  No tooltip, no explanation, no "overdraft" label.
  Impact: High. Causes confusion and distrust of the data.

P1-05 | MENU | Menu modal save does not close and refresh costs on save
  After saving a menu item, MenuPage.save() calls refresh() which
  triggers overview reload, but costs are re-fetched in a separate
  useEffect on menuItems change. There is a visible flash where costs
  show stale or missing values immediately after save.
  Impact: Medium-High. Feels broken even though data is correct.

P1-06 | INGREDIENTS | Supplier field is a free-text input with no dropdown
  Owner types supplier names manually with no validation.
  "Local Butcher" vs "local butcher" vs "LocalButcher" are all different.
  No link to the suppliers table.
  Impact: Medium-High. Creates data integrity problems over time.

P1-07 | INVENTORY | Supplier field is also free-text with same problem
  inventory.supplier is a text field. 9 of 14 items are blank.
  3 values (Webstaurant, Produce Vendor, In-house) have no matching
  row in the suppliers table.
  Impact: Medium-High. Blocks any supplier-grouped reporting.

P1-08 | COMPOUND MODAL | Cost preview silently excludes nested compounds
  The live cost preview in CompoundModal only calculates simple
  ingredient components. Nested compound costs are excluded.
  A small footnote says "Nested compound costs not included in preview"
  but it only appears conditionally when a compound row exists.
  Owner may see /bin/bash.00 batch cost while nested compound adds significant cost.
  Impact: Medium. Creates false confidence in cost estimates during editing.

P1-09 | RECIPES | Recipe modal fetches ALL recipe_ingredients then filters client-side
  api("/api/recipe-ingredients").then(all => all.filter(r => r.recipe_id===id))
  This fetches every recipe ingredient in the DB on every recipe edit.
  Currently 24 rows — harmless. At 200+ rows it becomes a performance issue.
  Impact: Low now, Medium later.

P1-10 | INVENTORY MODAL | No validation before save
  InventoryModal has no required field validation.
  Owner can save an item with empty name, zero cost, no unit.
  No error shown — item saves silently with blank/default values.
  Impact: Medium. Creates phantom inventory items.

P1-11 | INGREDIENTS | No sort order — ingredients display in DB insertion order
  14 ingredients render in reverse ID order (id DESC from overview query).
  No alphabetical sort, no category grouping.
  Inventory page groups by category with orange section headers.
  Ingredients page does not — inconsistent pattern.
  Impact: Medium. Finding a specific ingredient is harder than necessary.

P1-12 | MENU | Duplicate button has no visual separation from Edit/Delete
  Edit, Duplicate, Delete appear in one row with identical gray styling.
  Duplicate is a destructive-adjacent action (creates a new record).
  Delete is dangerous. They look the same.
  Impact: Low-Medium. Risk of accidental duplicate or delete.

---

## 3. P2 — Future Customer-Facing Issues

P2-01 | MENU | No public menu view or print layout
  The menu page is an internal cost-management view.
  There is no clean customer-facing display, PDF export, or print mode.
  Prices and margins are visible alongside item names.
  Impact: Blocks any future QR-code menu or customer display use.

P2-02 | MENU CARD | Cost source label (mii+compound) is technical jargon
  The cost_source field shows raw values like "mii+compound", "recipe", "manual".
  This is internal architecture language surfaced in the UI.
  A customer-accessible view would need this hidden or relabeled.
  Impact: Low now, must be addressed before any public-facing feature.

P2-03 | RECIPES | Recipe instructions are plain text, no step numbering
  Instructions are stored and rendered as pre-line text.
  No numbered steps, no checkboxes, no section headers.
  For kitchen display or training use, formatted steps are needed.
  Impact: Medium for kitchen staff use.

P2-04 | RECIPES | No recipe scaling UI
  Recipes are fixed-yield. There is no "scale to X servings" control.
  Catering orders for 200 guests require manual math.
  Impact: Medium for catering workflow.

P2-05 | MENU | No allergen or dietary flag fields
  No gluten-free, dairy-free, spicy, vegetarian flags on menu items.
  Required for any customer-facing menu or compliance use.
  Impact: Medium for future customer display.

P2-06 | INGREDIENTS | No unit conversion support
  Ingredients use fixed units. No oz-to-lb conversion.
  If a recipe calls for 4 oz of cheese but inventory tracks by lb,
  the owner must manually convert.
  Impact: Medium for recipe accuracy at scale.

P2-07 | INVENTORY | No restock history or audit trail in UI
  inventory_transactions table exists and is populated by sales.
  But there is no UI to view transaction history per item.
  Owner cannot see when stock was last updated or by how much.
  Impact: Medium for inventory accountability.

P2-08 | COMPOUNDS | No batch size scaling in UI
  CompoundModal has yield_amount but no "I made X batches" workflow.
  Making 2 batches of Consomé requires manually doubling all quantities.
  Impact: Medium for production use.

P2-09 | ALL SCREENS | No last-updated timestamp shown on cards
  created_at exists on most tables but is never displayed.
  Owner cannot tell if data is stale without checking the DB.
  Impact: Low now, grows over time.

---

## 4. P3 — Cosmetic Improvements

P3-01 | INVENTORY CARD | "Category" stat in inv-grid is redundant
  Inventory items are already grouped by category with an orange section header.
  The card then shows category again in the bottom-right inv-stat cell.
  That cell could show supplier name instead — more useful.

P3-02 | INGREDIENTS CARD | No expand/collapse — all detail always visible
  Ingredient cards show all 4 profit-rows at all times.
  Inventory, Recipes, and Menu cards all have expand/collapse.
  Ingredients is the only flat card in the Kitchen group.
  Inconsistent interaction pattern.

P3-03 | COMPOUNDS PAGE | "..." loading dots for batch cost during page load
  When CompoundsPage first loads, all cost cells show "..." while
  API calls complete. There is no skeleton or loading indicator.
  Looks broken momentarily on every page load.

P3-04 | MENU CARD | Compact header shows cost and profit but not category
  The collapsed MenuCard shows Cost, Profit, Margin, Price.
  Category (Entree, etc.) is not shown on the compact view.
  With many items in one category group, this is fine.
  With mixed categories it would be useful context.

P3-05 | MODAL HEADERS | Close button is bare "×" with no label or tooltip
  All modals use a plain "×" button for close.
  Accessible label (aria-label="Close") is missing.
  Impact: Minor accessibility issue.

P3-06 | RECIPE CARD | Edit/Delete buttons only visible when expanded
  To edit a recipe you must first expand it, then click Edit.
  Inventory and Ingredient cards show Edit/Delete directly without expand.
  Inconsistent — two clicks required for Recipe vs one for others.

P3-07 | MENU MODAL | Recipe Reference dropdown label could be clearer
  Currently: "Recipe Reference (optional)"
  Could be: "Link Kitchen Recipe (optional — for reference only)"
  The distinction between recipe-as-costing vs recipe-as-cookbook
  is not obvious to a new user.

P3-08 | INGREDIENTS MODAL | Category is a free-text input, not a dropdown
  Inventory modal uses a Sel dropdown for category.
  Ingredient modal uses a free-text input for category.
  Inconsistent pattern on adjacent pages.

P3-09 | COMPOUND MODAL | Active checkbox alignment
  The Active checkbox is placed in a grid column next to Category,
  with paddingTop:20 to vertically align with the label.
  This is a layout hack. On narrow screens it breaks alignment.

P3-10 | ALL MODALS | No keyboard shortcut to save (Enter / Cmd+Enter)
  All save actions require a mouse click on the primary button.
  No form submission on Enter key.
  Standard expectation for modal forms.

---

## 5. Screen-by-Screen Audit

### 5.1 Inventory Page

Layout:
  Header card with item count and Add Item button.
  Items grouped by category with orange section headers.
  Each card: name, status badge, 2x2 inv-grid (Stock, Min/Max, Cost, Category),
  optional supplier text, Edit/Delete actions.

What works well:
  Category grouping is clear and scannable.
  Stock badge (OK/Low/Out) gives instant visual status.
  Color coding (green/yellow/red) is consistent.
  Add Item and Edit flow is clean.

Issues found:
  - 9 items permanently show Out badge (min_stock=0) — misleading [P1-02]
  - Negative stock values show with no explanation [P1-04]
  - Category in inv-grid is redundant (already shown in section header) [P3-01]
  - Supplier is free text, 9 items blank, no dropdown [P1-07]
  - No validation on save (blank name allowed) [P1-10]
  - confirm("Delete?") — minimal message, mobile-blocked [P1-03]
  - No search or filter [P1-01]
  - forecast_per_event field label is "Forecast / Event" — not self-explanatory

Modal:
  Clean layout. Two-column grids for related fields.
  Stock/Min/Max in 3-column grid — logical grouping.
  Missing: validation, supplier dropdown, help text for forecast_per_event.

### 5.2 Ingredients Page

Layout:
  Header card with count and Add Ingredient button.
  Flat grid of cards — no grouping.
  Each card: name, category (muted top-right), profit-panel rows
  (Inventory Source, Purchase Cost, Servings/Purchase, Cost Per Serving),
  optional notes, Edit/Delete actions.

What works well:
  Cost per serving calculation is clearly displayed.
  Inventory link status (linked / not linked) is visible.
  Profit-row layout communicates cost breakdown clearly.

Issues found:
  - No category grouping — unlike Inventory which groups [P1-11]
  - No sort order — reverse ID insertion order [P1-11]
  - No expand/collapse — all detail always visible [P3-02]
  - Supplier is free-text input, not linked to suppliers table [P1-06]
  - Category field is a text input, not a dropdown [P3-08]
  - confirm("Delete ingredient?") — mobile-blocked [P1-03]
  - No search or filter [P1-01]
  - "not linked" inventory warning uses red color but is not actionable

Modal:
  Clean layout. Cost per serving preview is excellent UX.
  Issues: supplier free-text, category free-text, no validation.

### 5.3 Compound Ingredients Page

Layout:
  Header card with count and Add Compound button.
  Flat grid of cards.
  Each card: name, category, Active/Inactive badge, cost/yield_unit (top-right),
  2x2 inv-grid (Yield, Batch Cost, Cost/unit, Components count),
  components list with line costs, optional notes, Edit/Delete.

What works well:
  Best-designed card in the Food Module.
  Component breakdown with COMPOUND badge for nested items is clear.
  Batch cost and cost-per-yield-unit both shown.
  Active/Inactive badge enables soft-disable.

Issues found:
  - "..." loading placeholders for costs on every page load [P3-03]
  - No loading skeleton — page looks broken briefly [P3-03]
  - confirm() delete dialog — inconsistent message vs other pages [P1-03]
  - Modal cost preview excludes nested compounds silently [P1-08]
  - No search or filter [P1-01]
  - Only 2 compounds — grid wastes space (cards are wide on large screens)

Modal:
  Most complete modal in the app.
  Column headers on component rows is excellent.
  Type toggle (ingredient / compound) is clear.
  Issues: nested compound cost exclusion from preview, Active checkbox layout hack [P3-09].

### 5.4 Menu Page

Layout:
  Header card with count and Add Item button.
  Items grouped by category with orange section headers.
  Each card (collapsed): name, INACTIVE badge if applicable,
  Cost / Profit / Margin label row, price (large), expand chevron.
  Expanded: description, cost breakdown panel, suggested prices,
  ingredient lines, compound lines, prep notes, Edit/Duplicate/Delete.

What works well:
  Collapse-by-default is correct — dense data hidden until needed.
  Suggested price panel (65/70/75%) is genuinely useful.
  Compound lines with purple C badge are visually distinct.
  Cost source label shows architecture path.

Issues found:
  - Stale cost flash after save (costs re-fetch on refresh cycle) [P1-05]
  - Cost source shows raw "mii+compound" label — jargon [P2-02]
  - Edit/Duplicate/Delete have no visual hierarchy [P1-12]
  - No category shown in compact/collapsed view [P3-04]
  - confirm("Delete menu item?") — mobile-blocked [P1-03]
  - No allergen/dietary flags [P2-05]
  - No search or filter [P1-01]
  - Duplicate creates a copy but does NOT copy mii or mici rows
    (only copies menu_items row — ingredients/compounds are lost)

Modal:
  Most complex modal in the app. Works correctly.
  Issues: no keyboard save, recipe label could be clearer [P3-07],
  compound cost preview requires async fetch (good), but shows nothing
  until compound is selected (no preload on edit open for existing rows).
  Actually — compound costs ARE fetched on edit load via fetchCompCost.
  Minor: cost preview panel only appears after rows exist.

### 5.5 Recipes Page

Layout:
  Header card with count and Add Recipe button.
  Flat grid of expand/collapse cards.
  Collapsed: name, category, yield, prep/cook times, chevron.
  Expanded: timing grid, ingredient list (no costs), instructions block,
  notes, Edit/Delete.

What works well:
  Cookbook-only design is correct — no cost data in recipe view.
  Instructions rendered with pre-line formatting is readable.
  Timing grid (Yield, Prep, Cook, Category) is informative.
  IngredientRef fetches lazily per card — only loads when expanded.

Issues found:
  - Edit/Delete only reachable after expanding card — 2 clicks [P3-06]
  - Recipe modal fetches all recipe_ingredients then filters client-side [P1-09]
  - No recipe scaling UI [P2-04]
  - Instructions are plain text — no step numbering [P2-03]
  - confirm("Delete recipe? ...") — mobile-blocked [P1-03]
  - No search or filter [P1-01]
  - IngredientRef makes a fetch() call (not api()) — bypasses api wrapper,
    manually reads localStorage for token. Works but inconsistent pattern.
  - RecipeModal uses Yield Unit as free-text input, not a dropdown.
    Inventory and Compounds use Sel dropdown for units — inconsistent.

---

## 6. Mobile / Tablet Issues

Single breakpoint: @media(max-width:1000px)
  .app -> display:block (sidebar stacks above content)
  .sidebar -> width:100%, height:auto, position:relative
  .metrics, .two -> grid-template-columns:1fr
  .topbar -> flex-direction:column
  .content -> padding:18px

No breakpoints for tablet (768px), small mobile (375px), or landscape mobile.

Mobile-specific issues found:

M-01 | confirm() and alert() are blocked or styled differently on iOS Safari
  iOS Safari blocks synchronous confirm() in some contexts.
  All delete flows are broken on iOS if this restriction applies.

M-02 | Sidebar scroll on mobile — full sidebar renders as block
  At <=1000px sidebar becomes full-width block above content.
  With Today pinned + 4 groups + 15 nav items, the sidebar is tall.
  On a phone the user must scroll past the entire sidebar to reach content.
  No mobile nav collapse/hamburger exists.

M-03 | Modal cards at full width on mobile may overflow
  modal-card uses width:min(760px,100%) and width:min(720px,100%).
  At 100% width with 20px modal padding, content is tight on 375px screens.
  3-column grids (Stock/Min/Max in InventoryModal) will be very narrow.

M-04 | Component row grids in modals are 5-column fixed
  CompoundModal component rows: gridTemplateColumns: "90px 1fr 70px 80px 28px"
  MenuItemModal ingredient rows: "1fr 70px 70px 50px 28px"
  These do not wrap on small screens. On mobile they overflow horizontally.

M-05 | The .cards grid uses minmax(285px, 1fr)
  On screens < 285px a card will overflow.
  On screens 285-570px, cards are full width (correct).
  On screens 570-855px (tablet), 2 cards per row (correct).
  On screens 1000px+ the media query turns off and sidebar reappears.
  Gap between 855px and 1000px: 2 cards + partial sidebar — awkward.

M-06 | Inventory 2x2 inv-grid (.inv-grid) uses fixed 1fr 1fr
  Does not stack on mobile. On narrow phones the 2-column grid is cramped.

---

## 7. Workflow Friction Points

WF-01 | Creating a new menu item requires 4 separate data-entry steps
  1. Create menu item (name, price, category)
  2. Add ingredient rows (select each ingredient, qty, unit)
  3. Add compound rows (select compound, qty, unit)
  4. Save — then verify cost appeared on card
  The modal handles all steps in one form which is good.
  Friction: no quick-add from ingredient page to "use in menu item".

WF-02 | Inventory setup requires editing each item individually
  9 items need min_stock, max_stock, and forecast_per_event set.
  There is no bulk-edit mode. Each requires: find item, click Edit,
  update 3 fields, Save. x9 = 27 clicks minimum.
  A bulk-edit table view would reduce this to one screen.

WF-03 | No undo on delete
  All deletes are permanent with only a browser confirm() as protection.
  Deleting a compound removes it from any menu item that uses it.
  No soft-delete, no recycle bin, no undo.

WF-04 | Page refresh required to see cost changes after ingredient price edit
  If owner edits an ingredient cost, MenuPage must be refreshed to see
  updated costs on menu cards. There is no "recalculate" button.
  overview refresh happens on every save so it mostly works, but the
  cost API fetch is a separate cycle that may lag.

WF-05 | No quick stock adjustment from Inventory card
  To update current_stock, owner must: click Edit, scroll to Current Stock
  field, change value, click Save. 4 steps.
  A +/- quick-adjust control directly on the card would save time daily.

WF-06 | Compound Ingredients page has no clear relationship to Menu page
  Owner cannot tell from a compound card which menu items use it.
  No "used in" cross-reference exists.

WF-07 | Recipe and Menu are separate but coupled — relationship not shown
  Each menu item has an optional recipe_id but the connection is not
  visible on either page. Menu card shows recipe name in expanded view.
  Recipe card does not show which menu items reference it.

---

## 8. Recommended Next Sprint

Based on P1 priority ranking, the highest-ROI fixes in one sprint:

Sprint target: TRUCKFLOW_OPS_FOOD_MODULE_P1_FIX

1. Replace all confirm()/alert() with inline confirmation UI
   Affects all 5 pages. Fixes mobile delete. One pattern, one sprint.

2. Add validation to InventoryModal and RecipeModal
   Prevents blank-name saves. 30-minute fix per modal.

3. Add sort + basic filter/search to Ingredients page
   Alphabetical sort by default. Text filter input in header.
   Matches Inventory grouping pattern.

4. Fix Duplicate in MenuPage to copy mii + mici rows
   Currently duplicate only copies the menu_items row.
   Ingredients and compounds are silently dropped.
   High owner surprise factor.

5. Add "unconfigured" visual hint on Inventory cards where min_stock=0
   Small muted badge: "Alerts not set" on items with min_stock=0.
   Drives owner to configure missing fields.
   No schema change needed.

---

## 9. Issue Count Summary

| Priority | Count | Examples |
|---|---|---|
| P1 Owner Pain | 12 | No search, broken mobile delete, negative stock confusion, blank saves |
| P2 Future Customer | 9 | No public menu, no allergens, no recipe scaling, no unit conversion |
| P3 Cosmetic | 10 | Redundant category stat, inconsistent expand pattern, modal a11y |
| Mobile | 6 | confirm() blocked, no hamburger, fixed-column grids overflow |
| Workflow Friction | 7 | Bulk edit missing, no undo, no quick stock adjust, no cross-reference |
| **Total** | **44** | |
