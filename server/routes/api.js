const express = require('express');
const { requireAuth } = require('../middleware/auth');
const crud = require('../services/crud');
const { buildOverview } = require('../services/overview');
const { createAiTask, askOllama } = require('../ai/ollama');
const { calculateRecipeCost } = require('../services/costing');
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

router.get('/recipes/:id/cost', async (req, res, next) => {
  try { res.json(await calculateRecipeCost(req.params.id)); } catch (err) { next(err); }
});

router.get('/health', async (req, res, next) => {
  try {
    await query('SELECT 1');
    res.json({ ok:true, database:'postgres', ai_enabled:process.env.AI_ENABLED === 'true' });
  } catch (err) { next(err); }
});

module.exports = router;
