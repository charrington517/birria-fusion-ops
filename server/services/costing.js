const { query } = require('../db/pool');

async function calculateRecipeCost(recipeId) {
  const recipeResult = await query('SELECT * FROM recipes WHERE id=$1', [recipeId]);
  const recipe = recipeResult.rows[0];
  if (!recipe) throw new Error('Recipe not found');

  const linesResult = await query(`
    SELECT ri.quantity, ri.unit,
           i.name AS ingredient_name,
           i.cost AS cost_per_purchase,
           COALESCE(i.servings_per_purchase, 1) AS servings_per_purchase
    FROM recipe_ingredients ri
    JOIN ingredients i ON i.id = ri.ingredient_id
    WHERE ri.recipe_id = $1
  `, [recipeId]);

  const lines = linesResult.rows;
  const total_cost = lines.reduce((sum, line) => {
    const cost_per_serving = Number(line.cost_per_purchase) / (Number(line.servings_per_purchase) || 1);
    return sum + (Number(line.quantity) * cost_per_serving);
  }, 0);

  const yield_amount = Number(recipe.yield_amount) || 1;
  const cost_per_serving = total_cost / yield_amount;

  return {
    recipe_id: recipe.id,
    recipe_name: recipe.name,
    total_cost: Number(total_cost.toFixed(2)),
    yield_amount,
    yield_unit: recipe.yield_unit,
    cost_per_serving: Number(cost_per_serving.toFixed(2)),
    lines: lines.map(l => {
      const cpp = Number(l.cost_per_purchase) / (Number(l.servings_per_purchase) || 1);
      return {
        ingredient: l.ingredient_name,
        quantity: Number(l.quantity),
        unit: l.unit,
        cost_per_serving: Number(cpp.toFixed(4)),
        line_cost: Number((Number(l.quantity) * cpp).toFixed(2))
      };
    })
  };
}

function marginCategory(pct) {
  if (pct >= 70) return 'Excellent';
  if (pct >= 60) return 'Good';
  if (pct >= 50) return 'Watch';
  return 'Low';
}


// ── Menu Item Direct Ingredient Costing ─────────────────────────────────────

async function calculateMenuIngredientCost(menuItemId) {
  const rows = await query(
    `SELECT mii.quantity, mii.unit,
            i.name AS ingredient_name,
            i.cost AS purchase_cost,
            COALESCE(i.servings_per_purchase, 1) AS spp
     FROM menu_item_ingredients mii
     JOIN ingredients i ON i.id = mii.ingredient_id
     WHERE mii.menu_item_id = $1`,
    [menuItemId]
  );
  const total = rows.rows.reduce((sum, r) => {
    const cps = Number(r.purchase_cost) / (Number(r.spp) || 1);
    return sum + cps * Number(r.quantity);
  }, 0);
  return {
    total: Number(total.toFixed(4)),
    lines: rows.rows.map(r => {
      const cps = Number(r.purchase_cost) / (Number(r.spp) || 1);
      return {
        ingredient: r.ingredient_name,
        quantity:   Number(r.quantity),
        unit:       r.unit,
        cost_per_serving: Number(cps.toFixed(4)),
        line_cost:  Number((cps * Number(r.quantity)).toFixed(4))
      };
    })
  };
}

async function calculateMenuItemCost(menuItemId) {
  const itemResult = await query('SELECT * FROM menu_items WHERE id=$1', [menuItemId]);
  const item = itemResult.rows[0];
  if (!item) throw new Error('Menu item not found');

  const menu_price = Number(item.price);

  // ── Regular ingredient cost ──────────────────────────────────────────────
  // If menu_item_ingredients rows exist, use them (Architecture B).
  // Otherwise fall back to calculateRecipeCost() for backward compat.
  let recipe_id = null, recipe_name = null, ingredient_cost = 0;
  let ingredient_lines = [];

  const miiCheck = await query(
    'SELECT COUNT(*)::int AS count FROM menu_item_ingredients WHERE menu_item_id=$1',
    [menuItemId]
  );
  const hasMII = miiCheck.rows[0].count > 0;

  if (hasMII) {
    // Architecture B path: read from menu_item_ingredients
    const mii = await calculateMenuIngredientCost(menuItemId);
    ingredient_cost = mii.total;
    ingredient_lines = mii.lines;
    if (item.recipe_id) {
      const rr = await query('SELECT id, name FROM recipes WHERE id=$1', [item.recipe_id]);
      if (rr.rows.length) { recipe_id = rr.rows[0].id; recipe_name = rr.rows[0].name; }
    }
  } else if (item.recipe_id) {
    // Legacy path: read from recipe_ingredients via recipe
    const r = await calculateRecipeCost(item.recipe_id);
    recipe_id = r.recipe_id;
    recipe_name = r.recipe_name;
    ingredient_cost = r.cost_per_serving;
    ingredient_lines = r.lines || [];
  } else {
    ingredient_cost = Number(item.cost);
  }

  // ── Compound ingredient cost ──
  const ciRows = await query(
    `SELECT mici.id, mici.compound_ingredient_id, mici.quantity, mici.unit,
            ci.name AS compound_name
     FROM menu_item_compound_ingredients mici
     JOIN compound_ingredients ci ON ci.id = mici.compound_ingredient_id
     WHERE mici.menu_item_id = $1
     ORDER BY mici.id`,
    [menuItemId]
  );

  let compound_cost = 0;
  const compound_lines = [];
  for (const row of ciRows.rows) {
    const cc = await calculateCompoundCost(row.compound_ingredient_id);
    const line_cost = cc.cost_per_yield_unit * Number(row.quantity);
    compound_cost += line_cost;
    compound_lines.push({
      compound_id: row.compound_ingredient_id,
      compound_name: cc.name,
      quantity: Number(row.quantity),
      unit: row.unit,
      cost_per_yield_unit: Number(cc.cost_per_yield_unit.toFixed(4)),
      line_cost: Number(line_cost.toFixed(4))
    });
  }

  const total_cost = ingredient_cost + compound_cost;
  const cost_source = (() => {
    const hasComp = ciRows.rows.length > 0;
    if (hasMII && hasComp) return 'mii+compound';
    if (hasMII)            return 'mii';
    if (hasComp)           return 'compound';
    if (item.recipe_id)    return 'recipe';
    return 'manual';
  })();

  const gross_profit = Number((menu_price - total_cost).toFixed(2));
  const gross_margin_percent = menu_price > 0
    ? Number(((gross_profit / menu_price) * 100).toFixed(1))
    : 0;

  return {
    menu_item_id: item.id,
    menu_item_name: item.name,
    recipe_id,
    recipe_name,
    menu_price,
    ingredient_cost: Number(ingredient_cost.toFixed(2)),
    compound_cost: Number(compound_cost.toFixed(2)),
    recipe_cost: Number(total_cost.toFixed(2)),
    gross_profit,
    gross_margin_percent,
    margin_category: marginCategory(gross_margin_percent),
    cost_source,
    ingredient_lines,
    compound_lines
  };
}

async function calculateAllMenuCosts() {
  const items = await query('SELECT id FROM menu_items ORDER BY id');
  return Promise.all(items.rows.map(row => calculateMenuItemCost(row.id)));
}


// ── Compound Ingredient Costing ────────────────────────────────────────────────

async function calculateCompoundCost(compoundId, visited = new Set()) {
  // Cycle detection — if we have already visited this compound in this call chain,
  // a circular reference exists (A→B→A). Throw immediately.
  if (visited.has(Number(compoundId))) {
    throw new Error(
      'Circular reference detected in compound ingredient id=' + compoundId +
      '. Chain: ' + Array.from(visited).join(' → ') + ' → ' + compoundId
    );
  }
  const id = Number(compoundId);
  visited.add(id);

  // Load the compound header
  const ciRes = await query(
    'SELECT * FROM compound_ingredients WHERE id=$1',
    [id]
  );
  if (!ciRes.rows.length) throw new Error('Compound ingredient not found: id=' + id);
  const ci = ciRes.rows[0];

  // Load all component rows
  const compRes = await query(
    `SELECT c.id, c.ingredient_id, c.nested_compound_id, c.quantity, c.unit,
            i.name AS ing_name, i.cost AS ing_cost,
            COALESCE(i.servings_per_purchase, 1) AS spp,
            nc.name AS nested_name, nc.yield_amount AS nested_yield
     FROM compound_ingredient_components c
     LEFT JOIN ingredients i ON i.id = c.ingredient_id
     LEFT JOIN compound_ingredients nc ON nc.id = c.nested_compound_id
     WHERE c.parent_id = $1
     ORDER BY c.id`,
    [id]
  );

  let total_batch_cost = 0;
  const components = [];

  for (const row of compRes.rows) {
    if (row.ingredient_id !== null) {
      // Simple ingredient line
      const cps = Number(row.ing_cost) / (Number(row.spp) || 1);
      const line_cost = cps * Number(row.quantity);
      total_batch_cost += line_cost;
      components.push({
        type: 'ingredient',
        name: row.ing_name,
        quantity: Number(row.quantity),
        unit: row.unit,
        cost_per_serving: Number(cps.toFixed(6)),
        line_cost: Number(line_cost.toFixed(4))
      });
    } else {
      // Nested compound — recurse (visited Set is passed by reference, guarding cycle)
      const nested = await calculateCompoundCost(row.nested_compound_id, new Set(visited));
      const nested_cps = nested.cost_per_yield_unit;
      const line_cost = nested_cps * Number(row.quantity);
      total_batch_cost += line_cost;
      components.push({
        type: 'compound',
        name: nested.name,
        quantity: Number(row.quantity),
        unit: row.unit,
        cost_per_yield_unit: Number(nested_cps.toFixed(6)),
        line_cost: Number(line_cost.toFixed(4)),
        nested: nested
      });
    }
  }

  const yield_amount = Number(ci.yield_amount) || 1;
  const cost_per_yield_unit = total_batch_cost / yield_amount;

  return {
    id: ci.id,
    name: ci.name,
    category: ci.category,
    yield_amount,
    yield_unit: ci.yield_unit,
    total_batch_cost: Number(total_batch_cost.toFixed(4)),
    cost_per_yield_unit: Number(cost_per_yield_unit.toFixed(6)),
    components
  };
}

module.exports = { calculateRecipeCost, calculateMenuItemCost, calculateMenuIngredientCost, calculateAllMenuCosts, marginCategory, calculateCompoundCost };
