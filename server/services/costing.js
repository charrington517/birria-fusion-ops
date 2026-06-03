const { query } = require('../db/pool');

async function calculateRecipeCost(recipeId) {
  const recipeResult = await query('SELECT * FROM recipes WHERE id=$1', [recipeId]);
  const recipe = recipeResult.rows[0];
  if (!recipe) throw new Error('Recipe not found');

  const linesResult = await query(`
    SELECT ri.quantity, ri.unit, i.name AS ingredient_name, i.cost AS cost_per_unit
    FROM recipe_ingredients ri
    JOIN ingredients i ON i.id = ri.ingredient_id
    WHERE ri.recipe_id = $1
  `, [recipeId]);

  const lines = linesResult.rows;
  const total_cost = lines.reduce((sum, line) => {
    return sum + (Number(line.quantity) * Number(line.cost_per_unit));
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
    lines: lines.map(l => ({
      ingredient: l.ingredient_name,
      quantity: Number(l.quantity),
      unit: l.unit,
      cost_per_unit: Number(l.cost_per_unit),
      line_cost: Number((Number(l.quantity) * Number(l.cost_per_unit)).toFixed(2))
    }))
  };
}

module.exports = { calculateRecipeCost };
