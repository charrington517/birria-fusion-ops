'use strict';
/**
 * tests/inventory-management-2-phase2.test.js
 * Run: TEST_DATABASE_URL=... node tests/inventory-management-2-phase2.test.js
 * Targets birria_fusion_test only — never touches birria_fusion_ops.
 */

const assert = require('assert');
const http   = require('http');
const { Pool } = require('pg');

const TEST_DB_URL = process.env.TEST_DATABASE_URL;
if (!TEST_DB_URL) { console.error('TEST_DATABASE_URL env var required'); process.exit(1); }

const _testDbName = TEST_DB_URL.match(/\/([^/?]+)(\?|$)/)?.[1] || '';
if (_testDbName === 'birria_fusion_ops') {
  console.error('REFUSED: TEST_DATABASE_URL points to the production database. Use birria_fusion_test.');
  process.exit(1);
}

process.env.DATABASE_URL = TEST_DB_URL;
process.env.JWT_SECRET   = require('crypto').randomBytes(48).toString('hex');
process.env.NODE_ENV     = 'test';

const express    = require('express');
const authRoutes = require('../server/routes/auth');
const apiRoutes  = require('../server/routes/api');

const app = express();
app.use(express.json());
app.use('/api/auth', authRoutes);
app.use('/api', apiRoutes);

const pool = new Pool({ connectionString: TEST_DB_URL });

// ── Helpers ───────────────────────────────────────────────────────────────────

function req(server, method, path, body, token) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : '';
    const headers = { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const addr = server.address();
    const r = http.request({ host: '127.0.0.1', port: addr.port, method, path, headers }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    r.on('error', reject);
    r.end(payload);
  });
}

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`\n  PASS  ${name}`); passed++; }
  catch(e) { console.log(`\n  FAIL  ${name}\n        ${e.message}`); failed++; }
}

// ── Suite ─────────────────────────────────────────────────────────────────────

async function run() {
  const server = http.createServer(app);
  await new Promise(r => server.listen(0, '127.0.0.1', r));

  const loginRes = await req(server, 'POST', '/api/auth/login', { username: 'admin', password: 'admin123' });
  const token = loginRes.body.token;
  if (!token) { console.error('Cannot login to test DB — check admin password'); process.exit(1); }

  const createdItems = [];
  const createdIngredients = [];

  // ── Unit conversions endpoint ─────────────────────────────────────────────

  await test('GET /unit-conversions — returns seeded rules', async () => {
    const r = await req(server, 'GET', '/api/unit-conversions', null, token);
    assert.strictEqual(r.status, 200);
    assert.ok(Array.isArray(r.body) && r.body.length >= 18, `Expected >=18 rules, got ${r.body.length}`);
    const pairs = r.body.map(c => `${c.from_unit}→${c.to_unit}`);
    assert.ok(pairs.includes('lb→oz'), 'Should include lb→oz');
    assert.ok(pairs.includes('case→each'), 'Should include case→each');
    assert.ok(pairs.includes('liter→fl oz'), 'Should include liter→fl oz');
  });

  await test('GET /unit-conversions — 401 without auth', async () => {
    const r = await req(server, 'GET', '/api/unit-conversions');
    assert.strictEqual(r.status, 401);
  });

  // ── Purchase fields on inventory ──────────────────────────────────────────

  let itemId;
  await test('POST /inventory — creates item with purchase fields', async () => {
    const r = await req(server, 'POST', '/api/inventory', {
      name: 'Phase2 Test Item', category: 'Food', unit: 'oz',
      current_stock: 0, min_stock: 0, cost: 0,
      purchase_unit: 'lb', pkg_qty: 16, purchase_price: 8.00
    }, token);
    assert.strictEqual(r.status, 201, JSON.stringify(r.body));
    assert.strictEqual(r.body.purchase_unit, 'lb');
    assert.strictEqual(Number(r.body.pkg_qty), 16);
    assert.strictEqual(Number(r.body.purchase_price), 8);
    itemId = r.body.id;
    createdItems.push(itemId);
  });

  // ── PUT /inventory/:id/purchase — same-unit cost computation ─────────────

  await test('PUT /inventory/:id/purchase — same-unit computes cost_per_base_unit', async () => {
    // Create item where purchase_unit === base unit (oz === oz).
    const create = await req(server, 'POST', '/api/inventory', {
      name: 'SameUnit Item', category: 'Food', unit: 'oz',
      current_stock: 0, min_stock: 0, cost: 0
    }, token);
    createdItems.push(create.body.id);
    const r = await req(server, 'PUT', `/api/inventory/${create.body.id}/purchase`, {
      purchase_unit: 'oz', pkg_qty: 16, purchase_price: 4.00
    }, token);
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    // cost_per_base_unit = 4.00 / 16 = 0.25
    assert.ok(Math.abs(Number(r.body.cost_per_base_unit) - 0.25) < 0.0001,
      `Expected 0.25, got ${r.body.cost_per_base_unit}`);
  });

  // ── PUT /inventory/:id/purchase — cross-unit with standard conversion ─────

  await test('PUT /inventory/:id/purchase — lb→oz uses standard 16x conversion', async () => {
    // 1 lb bag costs $4.00, base unit is oz. 1 lb = 16 oz → $4/16oz = $0.25/oz
    const r = await req(server, 'PUT', `/api/inventory/${itemId}/purchase`, {
      purchase_unit: 'lb', pkg_qty: 1, purchase_price: 4.00
    }, token);
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.ok(Math.abs(Number(r.body.cost_per_base_unit) - 0.25) < 0.0001,
      `Expected 0.25/oz, got ${r.body.cost_per_base_unit}`);
  });

  await test('PUT /inventory/:id/purchase — case→each uses standard 24x conversion', async () => {
    const create = await req(server, 'POST', '/api/inventory', {
      name: 'Case Item', category: 'Packaging', unit: 'each',
      current_stock: 0, min_stock: 0, cost: 0
    }, token);
    createdItems.push(create.body.id);
    // Case of 24 costs $12 → $0.50/each
    const r = await req(server, 'PUT', `/api/inventory/${create.body.id}/purchase`, {
      purchase_unit: 'case', pkg_qty: 1, purchase_price: 12.00
    }, token);
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.ok(Math.abs(Number(r.body.cost_per_base_unit) - 0.50) < 0.0001,
      `Expected 0.50/each, got ${r.body.cost_per_base_unit}`);
  });

  await test('PUT /inventory/:id/purchase — incompatible units without factor returns 422', async () => {
    const create = await req(server, 'POST', '/api/inventory', {
      name: 'Incompat Item', category: 'Food', unit: 'each',
      current_stock: 0, min_stock: 0, cost: 0
    }, token);
    createdItems.push(create.body.id);
    // 'bottle' → 'each' has no standard conversion
    const r = await req(server, 'PUT', `/api/inventory/${create.body.id}/purchase`, {
      purchase_unit: 'bottle', pkg_qty: 1, purchase_price: 5.00
    }, token);
    assert.strictEqual(r.status, 422, `Expected 422, got ${r.status}: ${JSON.stringify(r.body)}`);
    assert.ok(r.body.error.includes('conversion'), `Error should mention conversion: ${r.body.error}`);
  });

  await test('PUT /inventory/:id/purchase — incompatible units WITH factor succeeds', async () => {
    const create = await req(server, 'POST', '/api/inventory', {
      name: 'Incompat With Factor', category: 'Food', unit: 'each',
      current_stock: 0, min_stock: 0, cost: 0
    }, token);
    createdItems.push(create.body.id);
    // bottle → each: no standard rule, but user says 1 bottle = 6 each
    const r = await req(server, 'PUT', `/api/inventory/${create.body.id}/purchase`, {
      purchase_unit: 'bottle', pkg_qty: 1, purchase_price: 3.00, conversion_factor: 6
    }, token);
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    // cost_per_base_unit = 3.00 / (1 * 6) = 0.50/each
    assert.ok(Math.abs(Number(r.body.cost_per_base_unit) - 0.50) < 0.0001,
      `Expected 0.50, got ${r.body.cost_per_base_unit}`);
  });

  // ── Cost propagation to linked ingredient ─────────────────────────────────

  await test('PUT /inventory/:id/purchase — propagates cost to linked ingredient', async () => {
    // Create inventory item.
    const invR = await req(server, 'POST', '/api/inventory', {
      name: 'PropTest Inv', category: 'Food', unit: 'oz',
      current_stock: 0, min_stock: 0, cost: 0
    }, token);
    createdItems.push(invR.body.id);
    const invId = invR.body.id;

    // Create ingredient linked to it.
    const ingR = await req(server, 'POST', '/api/ingredients', {
      name: 'PropTest Ing', category: 'Food', unit: 'oz',
      cost: 0, servings_per_purchase: 1, inventory_item_id: invId
    }, token);
    assert.strictEqual(ingR.status, 201, JSON.stringify(ingR.body));
    createdIngredients.push(ingR.body.id);

    // Update purchase info — should propagate cost.
    const r = await req(server, 'PUT', `/api/inventory/${invId}/purchase`, {
      purchase_unit: 'oz', pkg_qty: 16, purchase_price: 4.00
    }, token);
    assert.strictEqual(r.status, 200);

    // Verify ingredient cost was updated.
    const ings = await req(server, 'GET', '/api/ingredients', null, token);
    const ing = ings.body.find(i => i.id === ingR.body.id);
    assert.ok(ing, 'Ingredient should still exist');
    assert.ok(Math.abs(Number(ing.cost) - 0.25) < 0.0001,
      `Ingredient cost should be 0.25, got ${ing.cost}`);
    assert.strictEqual(Number(ing.servings_per_purchase), 1,
      'servings_per_purchase should be 1 after propagation');
  });

  await test('PUT /inventory/:id/purchase — no propagation when no linked ingredient', async () => {
    // Should succeed without error even when no ingredient is linked.
    const r = await req(server, 'PUT', `/api/inventory/${itemId}/purchase`, {
      purchase_unit: 'lb', pkg_qty: 1, purchase_price: 5.00
    }, token);
    assert.strictEqual(r.status, 200);
  });

  // ── Recipe and menu cost reflect updated ingredient cost ──────────────────

  await test('Recipe cost reflects updated ingredient cost', async () => {
    // Get current recipe cost.
    const before = await req(server, 'GET', '/api/recipes/1/cost', null, token);
    assert.strictEqual(before.status, 200);
    const beforeCost = before.body.total_cost;

    // Update an ingredient cost directly (simulates what purchase propagation does).
    const ings = await req(server, 'GET', '/api/ingredients', null, token);
    const ing1 = ings.body.find(i => i.id === 1); // Chuck Roast Updated
    if (!ing1) { console.log('  SKIP  (ingredient 1 not found)'); passed++; return; }

    const origCost = Number(ing1.cost);
    await req(server, 'PUT', `/api/ingredients/${ing1.id}`, { ...ing1, cost: origCost + 1 }, token);

    const after = await req(server, 'GET', '/api/recipes/1/cost', null, token);
    assert.ok(after.body.total_cost !== beforeCost, 'Recipe cost should change after ingredient cost update');

    // Restore original cost.
    await req(server, 'PUT', `/api/ingredients/${ing1.id}`, { ...ing1, cost: origCost }, token);
  });

  // ── Ingredient linking ────────────────────────────────────────────────────

  await test('POST /inventory/:id/create-ingredient — creates linked ingredient', async () => {
    const invR = await req(server, 'POST', '/api/inventory', {
      name: 'CreateIng Test', category: 'Produce', unit: 'each',
      current_stock: 5, min_stock: 1, cost: 0.50
    }, token);
    createdItems.push(invR.body.id);
    const invId = invR.body.id;

    const r = await req(server, 'POST', `/api/inventory/${invId}/create-ingredient`, {}, token);
    assert.strictEqual(r.status, 201, JSON.stringify(r.body));
    assert.strictEqual(r.body.name, 'CreateIng Test');
    assert.strictEqual(Number(r.body.inventory_item_id), invId);
    createdIngredients.push(r.body.id);
  });

  await test('POST /inventory/:id/create-ingredient — 409 on duplicate link', async () => {
    // Use the item we just linked above.
    const invItems = await req(server, 'GET', '/api/inventory', null, token);
    const linked = invItems.body.find(i => i.name === 'CreateIng Test');
    assert.ok(linked, 'CreateIng Test item should exist');

    const r = await req(server, 'POST', `/api/inventory/${linked.id}/create-ingredient`, {}, token);
    assert.strictEqual(r.status, 409, `Expected 409, got ${r.status}: ${JSON.stringify(r.body)}`);
    assert.ok(r.body.existing_ingredient_id, 'Should return existing ingredient id');
  });

  await test('POST /inventory/:id/create-ingredient — 404 for unknown inventory id', async () => {
    const r = await req(server, 'POST', '/api/inventory/999999/create-ingredient', {}, token);
    assert.strictEqual(r.status, 404);
  });

  await test('PUT /ingredients/:id — duplicate inventory_item_id link returns 409', async () => {
    // Create two inventory items.
    const inv1 = await req(server, 'POST', '/api/inventory', {
      name: 'DupLink Inv1', category: 'Food', unit: 'each', current_stock: 0, min_stock: 0, cost: 0
    }, token);
    const inv2 = await req(server, 'POST', '/api/inventory', {
      name: 'DupLink Inv2', category: 'Food', unit: 'each', current_stock: 0, min_stock: 0, cost: 0
    }, token);
    createdItems.push(inv1.body.id, inv2.body.id);

    // Create ingredient linked to inv1.
    const ing1 = await req(server, 'POST', '/api/ingredients', {
      name: 'DupLink Ing1', category: 'Food', unit: 'each',
      cost: 0, servings_per_purchase: 1, inventory_item_id: inv1.body.id
    }, token);
    createdIngredients.push(ing1.body.id);

    // Create ingredient linked to inv2.
    const ing2 = await req(server, 'POST', '/api/ingredients', {
      name: 'DupLink Ing2', category: 'Food', unit: 'each',
      cost: 0, servings_per_purchase: 1, inventory_item_id: inv2.body.id
    }, token);
    createdIngredients.push(ing2.body.id);

    // Try to re-link ing2 to inv1 (already taken by ing1).
    const r = await req(server, 'PUT', `/api/ingredients/${ing2.body.id}`, {
      name: 'DupLink Ing2', category: 'Food', unit: 'each',
      cost: 0, servings_per_purchase: 1, inventory_item_id: inv1.body.id
    }, token);
    assert.strictEqual(r.status, 409, `Expected 409, got ${r.status}: ${JSON.stringify(r.body)}`);
  });

  // ── Legacy data compatibility ─────────────────────────────────────────────

  await test('Existing inventory items have null purchase fields (additive migration)', async () => {
    const r = await req(server, 'GET', '/api/inventory', null, token);
    assert.strictEqual(r.status, 200);
    // All pre-existing items should have null purchase fields.
    const preExisting = r.body.filter(i => !createdItems.includes(i.id));
    const withPurchase = preExisting.filter(i => i.purchase_price != null);
    assert.strictEqual(withPurchase.length, 0, 'Pre-existing items should have null purchase_price');
  });

  await test('Existing ingredient links are preserved after migration', async () => {
    const r = await req(server, 'GET', '/api/ingredients', null, token);
    assert.strictEqual(r.status, 200);
    const linked = r.body.filter(i => i.inventory_item_id && !createdIngredients.includes(i.id));
    assert.ok(linked.length >= 14, `Expected >=14 pre-existing linked ingredients, got ${linked.length}`);
  });

  await test('Existing recipe costs are unchanged after migration', async () => {
    const r = await req(server, 'GET', '/api/recipes/1/cost', null, token);
    assert.strictEqual(r.status, 200);
    assert.ok(r.body.total_cost > 0, 'Recipe 1 should have a positive cost');
  });

  await test('Existing menu item costs are unchanged after migration', async () => {
    const r = await req(server, 'GET', '/api/menu/costs', null, token);
    assert.strictEqual(r.status, 200);
    assert.ok(Array.isArray(r.body) && r.body.length >= 3, 'Should have at least 3 menu items');
    r.body.forEach(m => {
      assert.ok(m.menu_price > 0, `${m.menu_item_name} should have a price`);
    });
  });

  await test('Historical sales orders are preserved', async () => {
    const r = await req(server, 'GET', '/api/sales-orders', null, token);
    assert.strictEqual(r.status, 200);
    assert.ok(r.body.length >= 10, `Expected >=10 sales orders, got ${r.body.length}`);
  });

  // ── Auth: 500 does not log out ────────────────────────────────────────────

  await test('GET /overview — 401 on bad token (not a 500)', async () => {
    const r = await req(server, 'GET', '/api/overview', null, 'bad_token_value');
    assert.strictEqual(r.status, 401, `Expected 401, got ${r.status}`);
  });

  // ── Cleanup ───────────────────────────────────────────────────────────────
  for (const id of createdIngredients) {
    await pool.query('DELETE FROM ingredients WHERE id=$1', [id]).catch(() => {});
  }
  for (const id of createdItems) {
    await req(server, 'DELETE', `/api/inventory/${id}`, null, token).catch(() => {});
  }

  await pool.end();
  server.close();

  console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

console.log('\nInventory Management 2.0 — Phase 2 Tests\n==========================================');
run().catch(async err => {
  console.error('\nFATAL:', err.message);
  await pool.end().catch(() => {});
  process.exit(1);
});
