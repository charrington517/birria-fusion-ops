const express = require('express');
const { requireAuth } = require('../middleware/auth');
const crud = require('../services/crud');
const { buildOverview } = require('../services/overview');
const { createAiTask, askOllama } = require('../ai/ollama');
const { calculateRecipeCost, calculateMenuItemCost, calculateAllMenuCosts, calculateCompoundCost } = require('../services/costing');
const { previewConsumption, consumeInventory, consumeInventoryWithClient } = require('../services/consumption');
const { withTransaction } = require('../db/pool');
const { calculateEventProfit, getEventProfitSummary } = require('../services/profitability');
const { query } = require('../db/pool');
const { computeCostPerBaseUnit, listConversions } = require('../services/units');

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

// Helper: validate GS1 check digit.
// UPC-A (12) and EAN-8 (8) use weights [3,1,3,1,...] starting at index 0.
// EAN-13 (13) uses weights [1,3,1,3,...] starting at index 0.
function eanCheckValid(digits) {
  const d = digits.split('').map(Number);
  const payload = d.slice(0, -1);
  const claimed = d[d.length - 1];
  // EAN-13 has an even number of payload digits (12); weight at index 0 is 1.
  // UPC-A and EAN-8 have an odd number of payload digits (11 or 7); weight at index 0 is 3.
  const w0 = payload.length % 2 === 0 ? 1 : 3;
  const sum = payload.reduce((acc, v, i) => acc + v * (i % 2 === 0 ? w0 : 4 - w0), 0);
  return (10 - (sum % 10)) % 10 === claimed;
}

// Helper: normalize barcode to canonical UPC-A (12-digit) form.
// Accepts UPC-A (12), EAN-13 (13), EAN-8 (8), UPC-E 6-digit payload (6),
// and UPC-E 8-digit full form (8-digit starting with 0/1).
// Returns null for invalid format or failed check digit.
function normalizeBarcode(raw) {
  const digits = (raw || '').replace(/\D/g, '');
  if (digits.length === 12) {
    return eanCheckValid(digits) ? digits : null;          // UPC-A
  }
  if (digits.length === 13) {
    if (!eanCheckValid(digits)) return null;               // EAN-13
    // EAN-13 with leading 0 is the same product as UPC-A — normalize to 12-digit.
    if (digits[0] === '0') return digits.slice(1);
    return digits;
  }
  if (digits.length === 8) {
    // Could be EAN-8 or 8-digit UPC-E (NS + 6-payload + check).
    // Distinguish: UPC-E 8-digit starts with 0 or 1 (number system digit).
    // EAN-8 check digit uses the same formula — try EAN-8 first.
    if (eanCheckValid(digits)) return digits;              // Valid EAN-8
    // Try as 8-digit UPC-E: NS must be 0, check must match expanded UPC-A.
    if (digits[0] === '0') {
      const expanded = expandUPCE(digits.slice(1, 7));
      if (expanded && expanded[11] === digits[7]) return expanded;
    }
    return null;
  }
  if (digits.length === 6) {
    // 6-digit UPC-E payload — no check digit to validate here; expand directly.
    return expandUPCE(digits);
  }
  return null;
}

function expandUPCE(s) {
  // s is the 6-digit UPC-E payload (no number system, no check digit).
  // Expands to 12-digit UPC-A including computed check digit.
  const d = s.split('');
  let upcA11;
  switch (d[5]) {
    case '0': case '1': case '2':
      upcA11 = '0'+d[0]+d[1]+d[2]+d[5]+'0000'+d[3]+d[4]; break;
    case '3':
      upcA11 = '0'+d[0]+d[1]+d[2]+d[3]+'00000'+d[4]; break;
    case '4':
      upcA11 = '0'+d[0]+d[1]+d[2]+d[3]+d[4]+'00000'; break;
    default:
      upcA11 = '0'+d[0]+d[1]+d[2]+d[3]+d[4]+'0000'+d[5]; break;
  }
  const digits = upcA11.split('').map(Number);
  const odd  = digits.filter((_,i)=>i%2===0).reduce((a,b)=>a+b,0);
  const even = digits.filter((_,i)=>i%2===1).reduce((a,b)=>a+b,0);
  const check = (10 - ((odd*3+even)%10)) % 10;
  return upcA11 + check;
}

// These routes use /inventory/* sub-paths and MUST be registered BEFORE the
// CRUD forEach, which registers GET /inventory/:id and would otherwise intercept them.
router.get('/inventory/consumption-preview', async (req, res, next) => {
  try {
    const { menu_item_id, quantity } = req.query;
    if (!menu_item_id || !quantity) return res.status(400).json({ error: 'menu_item_id and quantity required' });
    res.json(await previewConsumption(menu_item_id, Number(quantity)));
  } catch (err) { next(err); }
});

router.get('/inventory/barcode/:barcode', async (req, res, next) => {
  try {
    const { barcode } = req.params;
    const normalized = normalizeBarcode(barcode);
    if (!normalized) return res.status(400).json({ error: 'Invalid barcode format' });
    const result = await query(
      'SELECT * FROM inventory WHERE barcode = $1 LIMIT 1',
      [normalized]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Barcode not found', barcode: normalized });
    res.json(result.rows[0]);
  } catch (err) { next(err); }
});

// Purchase unit update — updates purchase fields and propagates cost_per_base_unit
// to the linked ingredient's cost and servings_per_purchase.
router.put('/inventory/:id/purchase', async (req, res, next) => {
  try {
    const { purchase_unit, pkg_qty, purchase_price, conversion_factor } = req.body;
    const id = req.params.id;

    // Fetch current inventory item.
    const invRes = await query('SELECT * FROM inventory WHERE id=$1', [id]);
    if (!invRes.rows.length) return res.status(404).json({ error: 'Inventory item not found' });
    const inv = invRes.rows[0];

    // Compute cost_per_base_unit.
    let cpbu = null;
    const pu  = purchase_unit  ?? inv.purchase_unit;
    const pq  = pkg_qty        ?? inv.pkg_qty;
    const pp  = purchase_price ?? inv.purchase_price;
    const cf  = conversion_factor !== undefined ? conversion_factor : inv.conversion_factor;

    if (pp && pq) {
      try {
        cpbu = await computeCostPerBaseUnit(pp, pq, pu, inv.unit, cf);
      } catch (convErr) {
        return res.status(422).json({ error: convErr.message });
      }
    }

    const updated = await withTransaction(async (client) => {
      // Update inventory purchase fields.
      const invUpd = await client.query(
        `UPDATE inventory
         SET purchase_unit=$1, pkg_qty=$2, purchase_price=$3,
             cost_per_base_unit=$4, conversion_factor=$5
         WHERE id=$6 RETURNING *`,
        [pu, pq, pp, cpbu, cf, id]
      );

      // Propagate to linked ingredient if one exists.
      if (cpbu !== null) {
        const ingRes = await client.query(
          'SELECT id FROM ingredients WHERE inventory_item_id=$1 LIMIT 1', [id]
        );
        if (ingRes.rows.length) {
          // cost = cost_per_base_unit (ingredient cost is per base unit)
          // servings_per_purchase = 1 (cost already reflects per-unit price)
          await client.query(
            'UPDATE ingredients SET cost=$1, servings_per_purchase=1 WHERE inventory_item_id=$2',
            [Number(cpbu.toFixed(6)), id]
          );
        }
      }

      return invUpd.rows[0];
    });

    res.json(updated);
  } catch (err) { next(err); }
});

// Ingredient link — create a new ingredient from an inventory item.
// Prevents duplicate links (one inventory item → one ingredient).
router.post('/inventory/:id/create-ingredient', async (req, res, next) => {
  try {
    const invId = req.params.id;
    const invRes = await query('SELECT * FROM inventory WHERE id=$1', [invId]);
    if (!invRes.rows.length) return res.status(404).json({ error: 'Inventory item not found' });
    const inv = invRes.rows[0];

    // Check for existing link.
    const existing = await query(
      'SELECT id, name FROM ingredients WHERE inventory_item_id=$1 LIMIT 1', [invId]
    );
    if (existing.rows.length) {
      return res.status(409).json({
        error: 'This inventory item is already linked to an ingredient',
        existing_ingredient_id: existing.rows[0].id,
        existing_ingredient_name: existing.rows[0].name
      });
    }

    const { name, category, unit, notes } = req.body;
    const ingName = (name || inv.name).trim();
    const ingUnit = unit || inv.unit || 'each';
    const cost    = inv.cost_per_base_unit ?? inv.cost ?? 0;

    const result = await query(
      `INSERT INTO ingredients (name, category, unit, cost, servings_per_purchase, supplier, notes, inventory_item_id)
       VALUES ($1, $2, $3, $4, 1, $5, $6, $7) RETURNING *`,
      [ingName, category || inv.category || '', ingUnit, cost, inv.supplier || '', notes || '', invId]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) { next(err); }
});

// Unit conversions list.
router.get('/unit-conversions', async (req, res, next) => {
  try { res.json(await listConversions()); } catch (err) { next(err); }
});

router.get('/inventory/barcode/:barcode', async (req, res, next) => {
  try {
    const { barcode } = req.params;
    const normalized = normalizeBarcode(barcode);
    if (!normalized) return res.status(400).json({ error: 'Invalid barcode format' });
    const result = await query(
      'SELECT * FROM inventory WHERE barcode = $1 LIMIT 1',
      [normalized]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Barcode not found', barcode: normalized });
    res.json(result.rows[0]);
  } catch (err) { next(err); }
});

Object.keys(crud.tableMap).forEach(collection => {
  router.get(`/${collection}`, async (req, res, next) => {
    try { res.json(await crud.list(collection)); } catch (err) { next(err); }
  });
  router.post(`/${collection}`, async (req, res, next) => {
    try { res.status(201).json(await crud.create(collection, req.body)); } catch (err) {
      if (err.code === '23505' && collection === 'inventory') {
        const existing = await query(
          'SELECT name FROM inventory WHERE barcode = $1 LIMIT 1',
          [req.body.barcode]
        ).catch(() => ({ rows: [] }));
        const name = existing.rows[0]?.name;
        return res.status(409).json({
          error: 'Barcode already assigned to another item',
          conflict_item: name || null
        });
      }
      // Duplicate inventory_item_id link on ingredients.
      if (err.code === '23505' && collection === 'ingredients') {
        return res.status(409).json({ error: 'That inventory item is already linked to another ingredient' });
      }
      next(err);
    }
  });
  router.put(`/${collection}/:id`, async (req, res, next) => {
    try {
      const item = await crud.update(collection, req.params.id, req.body);
      if (!item) return res.status(404).json({ error: 'Not found' });
      res.json(item);
    } catch (err) {
      if (err.code === '23505' && collection === 'inventory') {
        const existing = await query(
          'SELECT name FROM inventory WHERE barcode = $1 AND id != $2 LIMIT 1',
          [req.body.barcode, req.params.id]
        ).catch(() => ({ rows: [] }));
        const name = existing.rows[0]?.name;
        return res.status(409).json({
          error: 'Barcode already assigned to another item',
          conflict_item: name || null
        });
      }
      if (err.code === '23505' && collection === 'ingredients') {
        return res.status(409).json({ error: 'That inventory item is already linked to another ingredient' });
      }
      next(err);
    }
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

// Inventory categories CRUD.
router.get('/inventory-categories', async (req, res, next) => {
  try {
    const result = await query('SELECT * FROM inventory_categories ORDER BY sort_order, name');
    res.json(result.rows);
  } catch (err) { next(err); }
});

router.post('/inventory-categories', async (req, res, next) => {
  try {
    const { name, sort_order } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'name is required' });
    const maxOrder = await query('SELECT COALESCE(MAX(sort_order),0)+10 AS next FROM inventory_categories');
    const result = await query(
      'INSERT INTO inventory_categories (name, sort_order, active) VALUES ($1, $2, TRUE) RETURNING *',
      [name.trim(), sort_order ?? maxOrder.rows[0].next]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Category name already exists' });
    next(err);
  }
});

router.put('/inventory-categories/:id', async (req, res, next) => {
  try {
    const { name, sort_order, active } = req.body;
    const sets = []; const vals = [];
    if (name !== undefined)       { sets.push(`name=$${vals.push(name.trim())}`); }
    if (sort_order !== undefined) { sets.push(`sort_order=$${vals.push(sort_order)}`); }
    if (active !== undefined)     { sets.push(`active=$${vals.push(active)}`); }
    if (!sets.length) return res.status(400).json({ error: 'No fields to update' });

    // If renaming, also update inventory.category in the same transaction.
    if (name !== undefined) {
      const newName = name.trim();
      const catRow = await query('SELECT name FROM inventory_categories WHERE id=$1', [req.params.id]);
      if (!catRow.rows.length) return res.status(404).json({ error: 'Not found' });
      const oldName = catRow.rows[0].name;
      const result = await withTransaction(async (client) => {
        vals.push(req.params.id);
        const updated = await client.query(
          `UPDATE inventory_categories SET ${sets.join(',')} WHERE id=$${vals.length} RETURNING *`, vals
        );
        if (oldName !== newName) {
          await client.query(
            'UPDATE inventory SET category=$1 WHERE category=$2',
            [newName, oldName]
          );
        }
        return updated.rows[0];
      });
      return res.json(result);
    }

    vals.push(req.params.id);
    const result = await query(
      `UPDATE inventory_categories SET ${sets.join(',')} WHERE id=$${vals.length} RETURNING *`, vals
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Category name already exists' });
    next(err);
  }
});

router.post('/sales-orders', async (req, res, next) => {
  try {
    const { menu_item_id, quantity, event_id, note, idempotency_key } = req.body;
    if (!menu_item_id || !quantity) return res.status(400).json({ error: 'menu_item_id and quantity required' });

    // If a key was supplied, check whether this request was already processed.
    if (idempotency_key) {
      const existing = await query(
        `SELECT so.*, row_to_json(so) AS order_json
         FROM sales_orders so
         WHERE so.idempotency_key = $1`,
        [idempotency_key]
      );
      if (existing.rows.length) {
        const prev = existing.rows[0];
        // Reject reuse with a different payload.
        if (
          Number(prev.menu_item_id) !== Number(menu_item_id) ||
          Number(prev.quantity)     !== Number(quantity)     ||
          (prev.event_id || null)   !== (event_id || null)
        ) {
          return res.status(409).json({
            error: 'Idempotency key already used with different order contents.',
            original_order_id: prev.id
          });
        }
        // Same payload — return the original result (idempotent replay).
        const prevConsumption = await query(
          `SELECT * FROM inventory_transactions WHERE sales_order_id = $1`,
          [prev.id]
        );
        return res.status(200).json({
          order: prev,
          consumption: { replayed: true, transactions: prevConsumption.rows }
        });
      }
    }

    // Run the entire sale + inventory deduction in one transaction.
    const { order, consumption } = await withTransaction(async (client) => {
      const insertResult = await client.query(
        `INSERT INTO sales_orders (menu_item_id, quantity, event_id, note, idempotency_key)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [menu_item_id, quantity, event_id || null, note || null, idempotency_key || null]
      );
      const order = insertResult.rows[0];
      const consumption = await consumeInventoryWithClient(client, order.id);
      return { order, consumption };
    });

    return res.status(201).json({ order, consumption });
  } catch (err) {
    // PostgreSQL unique violation on idempotency_key = concurrent duplicate request.
    if (err.code === '23505' && err.constraint === 'sales_orders_idempotency_key_idx') {
      const existing = await query(
        'SELECT * FROM sales_orders WHERE idempotency_key = $1',
        [req.body.idempotency_key]
      );
      if (existing.rows.length) {
        return res.status(200).json({
          order: existing.rows[0],
          consumption: { replayed: true, concurrent_duplicate: true }
        });
      }
    }
    next(err);
  }
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
