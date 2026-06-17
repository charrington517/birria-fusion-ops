const express = require('express');
const { requireAuth } = require('../middleware/auth');
const crud = require('../services/crud');
const { buildOverview } = require('../services/overview');
const { createAiTask, askOllama } = require('../ai/ollama');
const { calculateRecipeCost, calculateMenuItemCost, calculateAllMenuCosts, calculateCompoundCost } = require('../services/costing');
const { previewConsumption, consumeInventory } = require('../services/consumption');
const { calculateEventProfit, getEventProfitSummary } = require('../services/profitability');
const { query } = require('../db/pool');

const router = express.Router();
router.use(requireAuth);

router.get('/overview', async (req, res, next) => {
  try { res.json(await buildOverview()); } catch (err) { next(err); }
});

// recipe-ingredients with optional recipe_id filter (must be before CRUD forEach)
router.get('/recipe-ingredients', async (req, res, next) => {
  try {
    const { recipe_id } = req.query;
    const result = recipe_id
      ? await query('SELECT * FROM recipe_ingredients WHERE recipe_id=$1 ORDER BY id', [recipe_id])
      : await query('SELECT * FROM recipe_ingredients ORDER BY id');
    res.json(result.rows);
  } catch (err) { next(err); }
});

// compound ingredient cost (recursive)
router.get('/compound-ingredients/:id/cost', async (req, res, next) => {
  try {
    res.json(await calculateCompoundCost(req.params.id));
  } catch (err) {
    if (err.message && err.message.startsWith('Circular reference')) {
      return res.status(400).json({ error: err.message });
    }
    next(err);
  }
});

// compound-ingredient-components with optional parent_id filter
router.get('/compound-ingredient-components', async (req, res, next) => {
  try {
    const { parent_id } = req.query;
    const result = parent_id
      ? await query(
          `SELECT c.*, i.name AS ingredient_name, nc.name AS nested_compound_name
           FROM compound_ingredient_components c
           LEFT JOIN ingredients i ON i.id = c.ingredient_id
           LEFT JOIN compound_ingredients nc ON nc.id = c.nested_compound_id
           WHERE c.parent_id = $1 ORDER BY c.id`,
          [parent_id]
        )
      : await query(
          `SELECT c.*, i.name AS ingredient_name, nc.name AS nested_compound_name
           FROM compound_ingredient_components c
           LEFT JOIN ingredients i ON i.id = c.ingredient_id
           LEFT JOIN compound_ingredients nc ON nc.id = c.nested_compound_id
           ORDER BY c.id`
        );
    res.json(result.rows);
  } catch (err) { next(err); }
});

// menu-item-compound-ingredients with optional menu_item_id filter
router.get('/menu-item-compound-ingredients', async (req, res, next) => {
  try {
    const { menu_item_id } = req.query;
    const result = menu_item_id
      ? await query(
          `SELECT mici.*, ci.name AS compound_name, ci.yield_unit
           FROM menu_item_compound_ingredients mici
           JOIN compound_ingredients ci ON ci.id = mici.compound_ingredient_id
           WHERE mici.menu_item_id = $1 ORDER BY mici.id`,
          [menu_item_id]
        )
      : await query(
          `SELECT mici.*, ci.name AS compound_name, ci.yield_unit
           FROM menu_item_compound_ingredients mici
           JOIN compound_ingredients ci ON ci.id = mici.compound_ingredient_id
           ORDER BY mici.id`
        );
    res.json(result.rows);
  } catch (err) { next(err); }
});

// menu-item-ingredients with optional menu_item_id filter
router.get('/menu-item-ingredients', async (req, res, next) => {
  try {
    const { menu_item_id } = req.query;
    const result = menu_item_id
      ? await query(
          `SELECT mii.*, i.name AS ingredient_name,
                  i.cost AS purchase_cost,
                  COALESCE(i.servings_per_purchase,1) AS spp,
                  ROUND(i.cost / NULLIF(i.servings_per_purchase,1) * mii.quantity, 4) AS line_cost
           FROM menu_item_ingredients mii
           JOIN ingredients i ON i.id = mii.ingredient_id
           WHERE mii.menu_item_id = $1 ORDER BY mii.id`,
          [menu_item_id]
        )
      : await query(
          `SELECT mii.*, i.name AS ingredient_name
           FROM menu_item_ingredients mii
           JOIN ingredients i ON i.id = mii.ingredient_id
           ORDER BY mii.id`
        );
    res.json(result.rows);
  } catch (err) { next(err); }
});

Object.keys(crud.tableMap).forEach(collection => {
  router.get(`/${collection}`, async (req, res, next) => {
    try { res.json(await crud.list(collection)); } catch (err) { next(err); }
  });
  router.post(`/${collection}`, async (req, res, next) => {
    try { res.status(201).json(await crud.create(collection, req.body)); } catch (err) { next(err); }
  });
  router.put(`/${collection}/:id`, async (req, res, next) => {
    try {
      const item = await crud.update(collection, req.params.id, req.body);
      if (!item) return res.status(404).json({ error: 'Not found' });
      res.json(item);
    } catch (err) { next(err); }
  });
  router.delete(`/${collection}/:id`, async (req, res, next) => {
    try {
      const item = await crud.remove(collection, req.params.id);
      if (!item) return res.status(404).json({ error: 'Not found' });
      res.json({ ok: true });
    } catch (err) { next(err); }
  });
});

router.post('/ai/ask', async (req, res, next) => {
  try {
    const overview = await buildOverview();
    res.json(await askOllama(req.body.prompt || 'What needs attention?', overview));
  } catch (err) { next(err); }
});

router.post('/ai/tasks', async (req, res, next) => {
  try { res.status(201).json(await createAiTask(req.body.prompt || 'Analyze operations', req.body.context_type || 'general')); }
  catch (err) { next(err); }
});

router.get('/menu/costs', async (req, res, next) => {
  try { res.json(await calculateAllMenuCosts()); } catch (err) { next(err); }
});

router.get('/menu/:id/cost', async (req, res, next) => {
  try { res.json(await calculateMenuItemCost(req.params.id)); } catch (err) { next(err); }
});

router.get('/recipes/:id/cost', async (req, res, next) => {
  try { res.json(await calculateRecipeCost(req.params.id)); } catch (err) { next(err); }
});

router.get('/inventory/consumption-preview', async (req, res, next) => {
  try {
    const { menu_item_id, quantity } = req.query;
    if (!menu_item_id || !quantity) return res.status(400).json({ error: 'menu_item_id and quantity required' });
    res.json(await previewConsumption(menu_item_id, Number(quantity)));
  } catch (err) { next(err); }
});

router.post('/sales-orders', async (req, res, next) => {
  try {
    const { menu_item_id, quantity, event_id, note } = req.body;
    if (!menu_item_id || !quantity) return res.status(400).json({ error: 'menu_item_id and quantity required' });
    const result = await query(
      'INSERT INTO sales_orders (menu_item_id, quantity, event_id, note) VALUES ($1,$2,$3,$4) RETURNING *',
      [menu_item_id, quantity, event_id || null, note || null]
    );
    const order = result.rows[0];
    let consumption = null;
    try {
      consumption = await consumeInventory(order.id);
      console.log('CONSUMPTION RESULT:', JSON.stringify(consumption));
    } catch (e) {
      console.error('CONSUMPTION ERROR:', e.message);
      consumption = { error: e.message };
    }
    console.log('SENDING RESPONSE consumption is:', typeof consumption);
    return res.status(201).json({ order, consumption });
  } catch (err) { next(err); }
});

router.get('/sales-orders', async (req, res, next) => {
  try {
    const result = await require('../db/pool').query(
      'SELECT so.*, m.name AS menu_item_name FROM sales_orders so JOIN menu_items m ON m.id=so.menu_item_id ORDER BY so.sold_at DESC'
    );
    res.json(result.rows);
  } catch (err) { next(err); }
});

router.get('/events/profit-summary', async (req, res, next) => {
  try { res.json(await getEventProfitSummary()); } catch (err) { next(err); }
});

router.get('/events/:id/profit', async (req, res, next) => {
  try { res.json(await calculateEventProfit(req.params.id)); } catch (err) { next(err); }
});

router.get('/health', async (req, res, next) => {
  try {
    await query('SELECT 1');
    res.json({ ok:true, database:'postgres', ai_enabled:process.env.AI_ENABLED === 'true' });
  } catch (err) { next(err); }
});

module.exports = router;
