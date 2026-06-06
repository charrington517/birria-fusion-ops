const express = require('express');
const { requireAuth } = require('../middleware/auth');
const crud = require('../services/crud');
const { buildOverview } = require('../services/overview');
const { createAiTask, askOllama } = require('../ai/ollama');
const { calculateRecipeCost, calculateMenuItemCost, calculateAllMenuCosts } = require('../services/costing');
const { previewConsumption, consumeInventory } = require('../services/consumption');
const { calculateEventProfit, getEventProfitSummary } = require('../services/profitability');
const { query } = require('../db/pool');

const router = express.Router();
router.use(requireAuth);

router.get('/overview', async (req, res, next) => {
  try { res.json(await buildOverview()); } catch (err) { next(err); }
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
