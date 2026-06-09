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

async function calculateMenuItemCost(menuItemId) {
  const itemResult = await query('SELECT * FROM menu_items WHERE id=$1', [menuItemId]);
  const item = itemResult.rows[0];
  if (!item) throw new Error('Menu item not found');

  const menu_price = Number(item.price);
  let recipe_id = null, recipe_name = null, recipe_cost = null;

  if (item.recipe_id) {
    const r = await calculateRecipeCost(item.recipe_id);
    recipe_id = r.recipe_id;
    recipe_name = r.recipe_name;
    recipe_cost = r.cost_per_serving;
  } else {
    recipe_cost = Number(item.cost);
  }

  const gross_profit = Number((menu_price - recipe_cost).toFixed(2));
  const gross_margin_percent = menu_price > 0
    ? Number(((gross_profit / menu_price) * 100).toFixed(1))
    : 0;

  return {
    menu_item_id: item.id,
    menu_item_name: item.name,
    recipe_id,
    recipe_name,
    menu_price,
    recipe_cost: Number(recipe_cost.toFixed(2)),
    gross_profit,
    gross_margin_percent,
    margin_category: marginCategory(gross_margin_percent),
    cost_source: item.recipe_id ? 'recipe' : 'manual'
  };
}

async function calculateAllMenuCosts() {
  const items = await query('SELECT id FROM menu_items ORDER BY id');
  return Promise.all(items.rows.map(row => calculateMenuItemCost(row.id)));
}

module.exports = { calculateRecipeCost, calculateMenuItemCost, calculateAllMenuCosts, marginCategory };
