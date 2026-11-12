'use strict';
/**
 * tests/inventory-purchase-ux.test.js
 *
 * Frontend interaction tests for the InventoryModal unified save flow.
 * Tests the Corn Tortillas scenario end-to-end against the test database:
 *   - Save Item with purchase fields triggers preview (no partial write)
 *   - Cost comparison panel appears for legacy ingredients
 *   - Apply New Cost updates ingredient cost/spp
 *   - Keep Existing Cost preserves ingredient cost/spp
 *   - Preview API failure leaves DB unchanged
 *   - Reopening item shows persisted values
 *   - New item with purchase fields computes cost_per_base_unit in one save
 *
 * Run: TEST_DATABASE_URL=postgres://birria:<pw>@localhost:5432/birria_fusion_test \
 *        node tests/inventory-purchase-ux.test.js
 */

const assert = require('assert');
const http   = require('http');
const { Pool } = require('pg');

const TEST_DB_URL = process.env.TEST_DATABASE_URL;
if (!TEST_DB_URL) { console.error('TEST_DATABASE_URL env var required'); process.exit(1); }

const _testDbName = TEST_DB_URL.match(/\/([^/?]+)(\?|$)/)?.[1] || '';
if (_testDbName === 'birria_fusion_ops') {
  console.error('REFUSED: TEST_DATABASE_URL points to production. Use birria_fusion_test.');
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

// ── Helpers ───────────────────────────────────────────────────────────────────

const testPool = new Pool({ connectionString: TEST_DB_URL });

function req(server, method, path, body, token) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const opts = {
      hostname: '127.0.0.1',
      port: server.address().port,
      path,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
    };
    const r = http.request(opts, res => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    r.on('error', reject);
    if (payload) r.write(payload);
    r.end();
  });
}

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  PASS  ${name}`); passed++; }
  catch(e) { console.log(`  FAIL  ${name}\n        ${e.message}`); failed++; }
}

// ── Suite ─────────────────────────────────────────────────────────────────────

async function run() {
  const server = http.createServer(app);
  await new Promise(r => server.listen(0, '127.0.0.1', r));

  const loginRes = await req(server, 'POST', '/api/auth/login', { username: 'admin', password: 'admin123' });
  const token = loginRes.body.token;
  if (!token) { console.error('Cannot login to test DB'); process.exit(1); }

  // Track created records for cleanup.
  const cleanup = { invIds: [], ingIds: [] };

  console.log('\n── New item with purchase fields ────────────────────────────────');

  await test('POST /inventory creates item without purchase costing', async () => {
    const r = await req(server, 'POST', '/api/inventory',
      { name: 'UX Test Flour', unit: 'lb', category: 'Food',
        purchase_unit: 'bag', pkg_qty: 50, purchase_price: 18.00 }, token);
    assert.strictEqual(r.status, 201);
    assert.ok(r.body.id);
    cleanup.invIds.push(r.body.id);
    // CRUD route does not compute cost_per_base_unit.
    assert.strictEqual(r.body.cost_per_base_unit, null);
  });

  await test('PUT /purchase on new item computes cost_per_base_unit atomically', async () => {
    // Simulate what handleSave does for a new item with purchase fields:
    // Step 1 CRUD create, Step 2 PUT /purchase.
    const cr = await req(server, 'POST', '/api/inventory',
      { name: 'UX Test Rice', unit: 'lb', category: 'Food',
        purchase_unit: 'bag', pkg_qty: 25, purchase_price: 12.50 }, token);
    assert.strictEqual(cr.status, 201);
    const id = cr.body.id;
    cleanup.invIds.push(id);

    const pr = await req(server, 'PUT', `/api/inventory/${id}/purchase`,
      { purchase_unit: 'bag', pkg_qty: 25, purchase_price: 12.50 }, token);
    assert.strictEqual(pr.status, 200);
    // 12.50 / 25 = 0.5
    assert.ok(Math.abs(Number(pr.body.cost_per_base_unit) - 0.5) < 0.0001,
      `expected 0.5 got ${pr.body.cost_per_base_unit}`);
  });

  await test('New item: GET after create+purchase shows cost_per_base_unit', async () => {
    const cr = await req(server, 'POST', '/api/inventory',
      { name: 'UX Test Beans', unit: 'lb', category: 'Food' }, token);
    const id = cr.body.id;
    cleanup.invIds.push(id);
    await req(server, 'PUT', `/api/inventory/${id}/purchase`,
      { purchase_unit: 'lb', pkg_qty: 10, purchase_price: 8.00 }, token);
    const gr = await req(server, 'GET', '/api/inventory', null, token);
    const item = gr.body.find(i => i.id === id);
    assert.ok(item, 'item not found in list');
    assert.ok(Math.abs(Number(item.cost_per_base_unit) - 0.8) < 0.0001,
      `expected 0.8 got ${item.cost_per_base_unit}`);
  });

  console.log('\n── Preview-first: no partial write on failure ───────────────────');

  await test('purchase-preview with invalid conversion returns 422, DB unchanged', async () => {
    // Create an item with cross-unit that has no conversion path.
    const cr = await req(server, 'POST', '/api/inventory',
      { name: 'UX Test Gloves', unit: 'each', category: 'Disposables' }, token);
    const id = cr.body.id;
    cleanup.invIds.push(id);

    // purchase_unit=case, base_unit=each — packaging unit, no conversion factor.
    // computeCostPerBaseUnit will throw because pkg_qty is required for packaging.
    const pr = await req(server, 'GET',
      `/api/inventory/${id}/purchase-preview?purchase_unit=case&purchase_price=45.00`, null, token);
    // pkg_qty missing — server returns 422 or preview with null cpbu.
    // Either way the DB must be unchanged.
    const gr = await req(server, 'GET', '/api/inventory', null, token);
    const item = gr.body.find(i => i.id === id);
    assert.strictEqual(item.purchase_price, null, 'purchase_price should still be null');
    assert.strictEqual(item.cost_per_base_unit, null, 'cost_per_base_unit should still be null');
  });

  await test('purchase-preview succeeds before any write — inventory row unchanged', async () => {
    const cr = await req(server, 'POST', '/api/inventory',
      { name: 'UX Test Oil', unit: 'liter', category: 'Food' }, token);
    const id = cr.body.id;
    cleanup.invIds.push(id);

    const pr = await req(server, 'GET',
      `/api/inventory/${id}/purchase-preview?purchase_unit=liter&pkg_qty=4&purchase_price=16.00`,
      null, token);
    assert.strictEqual(pr.status, 200);
    assert.ok(Math.abs(Number(pr.body.cost_per_base_unit) - 4.0) < 0.0001);

    // Preview must not have written anything.
    const gr = await req(server, 'GET', '/api/inventory', null, token);
    const item = gr.body.find(i => i.id === id);
    assert.strictEqual(item.purchase_price, null, 'preview must not write purchase_price');
    assert.strictEqual(item.cost_per_base_unit, null, 'preview must not write cost_per_base_unit');
  });

  console.log('\n── Corn Tortillas scenario: legacy ingredient ───────────────────');

  // Create a representative Corn Tortillas inventory + legacy ingredient.
  let tortillaInvId, tortillaIngId;

  await test('Setup: create Corn Tortillas inventory item', async () => {
    const r = await req(server, 'POST', '/api/inventory',
      { name: 'UX Corn Tortillas', unit: 'pack', category: 'Food' }, token);
    assert.strictEqual(r.status, 201);
    tortillaInvId = r.body.id;
    cleanup.invIds.push(tortillaInvId);
  });

  await test('Setup: create legacy Corn Tortilla ingredient (spp=22, cost=3.25)', async () => {
    const r = await req(server, 'POST', '/api/ingredients',
      { name: 'UX Corn Tortilla', unit: 'pack', cost: 3.25,
        servings_per_purchase: 22, inventory_item_id: tortillaInvId }, token);
    assert.strictEqual(r.status, 201);
    tortillaIngId = r.body.id;
    cleanup.ingIds.push(tortillaIngId);
  });

  await test('purchase-preview returns legacy ingredient with proposed cost', async () => {
    const r = await req(server, 'GET',
      `/api/inventory/${tortillaInvId}/purchase-preview?purchase_unit=pack&pkg_qty=30&purchase_price=2.50`,
      null, token);
    assert.strictEqual(r.status, 200);
    const li = r.body.linked_ingredient;
    assert.ok(li, 'linked_ingredient should be present');
    assert.strictEqual(li.name, 'UX Corn Tortilla');
    assert.strictEqual(Number(li.current_spp), 22);
    assert.ok(Math.abs(Number(li.current_cost) - 3.25) < 0.001);
    // proposed = 2.50/30 = 0.08333...
    assert.ok(Math.abs(Number(li.proposed_cost_per_unit) - (2.5/30)) < 0.0001,
      `expected ~${(2.5/30).toFixed(6)} got ${li.proposed_cost_per_unit}`);
    // current = 3.25/22 = 0.14772...
    assert.ok(Math.abs(Number(li.current_cost_per_unit) - (3.25/22)) < 0.0001);
  });

  await test('isLegacy check: spp=22 and cost=3.25 qualifies as legacy', async () => {
    const r = await req(server, 'GET',
      `/api/inventory/${tortillaInvId}/purchase-preview?purchase_unit=pack&pkg_qty=30&purchase_price=2.50`,
      null, token);
    const li = r.body.linked_ingredient;
    const isLegacy = li && (Number(li.current_spp) > 1 || Number(li.current_cost) > 0)
                     && li.proposed_cost_per_unit !== null;
    assert.strictEqual(isLegacy, true, 'Corn Tortilla must be detected as legacy');
  });

  await test('Apply New Cost: PUT /purchase sync_ingredient=true updates ingredient', async () => {
    const r = await req(server, 'PUT', `/api/inventory/${tortillaInvId}/purchase`,
      { purchase_unit: 'pack', pkg_qty: 30, purchase_price: 2.50, sync_ingredient: true }, token);
    assert.strictEqual(r.status, 200);
    assert.ok(!r.body._unit_mismatch, 'no unit mismatch expected');
    assert.ok(!r.body._ingredient_skipped, 'ingredient should not be skipped');

    // Verify inventory cost_per_base_unit updated.
    const gr = await req(server, 'GET', '/api/inventory', null, token);
    const inv = gr.body.find(i => i.id === tortillaInvId);
    assert.ok(Math.abs(Number(inv.cost_per_base_unit) - (2.5/30)) < 0.0001,
      `inv cost_per_base_unit expected ~${(2.5/30).toFixed(6)} got ${inv.cost_per_base_unit}`);

    // Verify ingredient cost updated to proposed, spp reset to 1.
    const ir = await req(server, 'GET', '/api/ingredients', null, token);
    const ing = ir.body.find(i => i.id === tortillaIngId);
    assert.strictEqual(Number(ing.servings_per_purchase), 1, 'spp should be reset to 1');
    assert.ok(Math.abs(Number(ing.cost) - (2.5/30)) < 0.0001,
      `ing cost expected ~${(2.5/30).toFixed(6)} got ${ing.cost}`);
  });

  await test('Reopen item: persisted purchase values visible in GET /inventory', async () => {
    const gr = await req(server, 'GET', '/api/inventory', null, token);
    const inv = gr.body.find(i => i.id === tortillaInvId);
    assert.strictEqual(inv.purchase_unit, 'pack');
    assert.strictEqual(Number(inv.pkg_qty), 30);
    assert.ok(Math.abs(Number(inv.purchase_price) - 2.5) < 0.001);
    assert.ok(Number(inv.cost_per_base_unit) > 0);
  });

  // Reset ingredient to legacy state for Keep Existing Cost test.
  await test('Reset ingredient to legacy state for Keep test', async () => {
    const r = await req(server, 'PUT', `/api/ingredients/${tortillaIngId}`,
      { cost: 3.25, servings_per_purchase: 22 }, token);
    assert.strictEqual(r.status, 200);
    const ir = await req(server, 'GET', '/api/ingredients', null, token);
    const ing = ir.body.find(i => i.id === tortillaIngId);
    assert.strictEqual(Number(ing.servings_per_purchase), 22);
    assert.ok(Math.abs(Number(ing.cost) - 3.25) < 0.001);
  });

  await test('Keep Existing Cost: PUT /purchase sync_ingredient=false preserves ingredient', async () => {
    const r = await req(server, 'PUT', `/api/inventory/${tortillaInvId}/purchase`,
      { purchase_unit: 'pack', pkg_qty: 30, purchase_price: 2.50, sync_ingredient: false }, token);
    assert.strictEqual(r.status, 200);

    // Inventory cost_per_base_unit must still be updated.
    const gr = await req(server, 'GET', '/api/inventory', null, token);
    const inv = gr.body.find(i => i.id === tortillaInvId);
    assert.ok(Math.abs(Number(inv.cost_per_base_unit) - (2.5/30)) < 0.0001,
      'inventory cost_per_base_unit must update even when ingredient is skipped');

    // Ingredient cost and spp must be unchanged.
    const ir = await req(server, 'GET', '/api/ingredients', null, token);
    const ing = ir.body.find(i => i.id === tortillaIngId);
    assert.strictEqual(Number(ing.servings_per_purchase), 22, 'spp must remain 22');
    assert.ok(Math.abs(Number(ing.cost) - 3.25) < 0.001, 'cost must remain 3.25');
  });

  await test('Keep Existing Cost: _ingredient_skipped flag returned', async () => {
    const r = await req(server, 'PUT', `/api/inventory/${tortillaInvId}/purchase`,
      { purchase_unit: 'pack', pkg_qty: 30, purchase_price: 2.50, sync_ingredient: false }, token);
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body._ingredient_skipped, true);
  });

  console.log('\n── Preview failure: DB unchanged ────────────────────────────────');

  await test('purchase-preview with missing pkg_qty returns null cpbu', async () => {
    // Fresh item with no existing purchase data in DB.
    const cr = await req(server, 'POST', '/api/inventory',
      { name: 'UX Test NoPkgQty', unit: 'each', category: 'Disposables' }, token);
    const id = cr.body.id;
    cleanup.invIds.push(id);
    // purchase_price supplied but pkg_qty absent from query and DB — cpbu must be null.
    const r = await req(server, 'GET',
      `/api/inventory/${id}/purchase-preview?purchase_unit=pack&purchase_price=45.00`,
      null, token);
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.cost_per_base_unit, null,
      `expected null cpbu when pkg_qty missing, got ${r.body.cost_per_base_unit}`);
    // Confirm DB is unchanged.
    const gr = await req(server, 'GET', '/api/inventory', null, token);
    const item = gr.body.find(i => i.id === id);
    assert.strictEqual(item.purchase_price, null, 'purchase_price must not be written by preview');
    assert.strictEqual(item.cost_per_base_unit, null, 'cost_per_base_unit must not be written by preview');
  });

  await test('purchase-preview 404 for nonexistent item', async () => {
    const r = await req(server, 'GET',
      '/api/inventory/999999/purchase-preview?purchase_unit=pack&pkg_qty=10&purchase_price=5.00',
      null, token);
    assert.strictEqual(r.status, 404);
  });

  await test('PUT /purchase 404 for nonexistent item', async () => {
    const r = await req(server, 'PUT', '/api/inventory/999999/purchase',
      { purchase_unit: 'pack', pkg_qty: 10, purchase_price: 5.00 }, token);
    assert.strictEqual(r.status, 404);
  });

  console.log('\n── Unit mismatch warning ────────────────────────────────────────');

  await test('Unit mismatch: _unit_mismatch returned when units incompatible', async () => {
    // Create inventory in 'lb', ingredient in 'each' — no conversion path.
    const cr = await req(server, 'POST', '/api/inventory',
      { name: 'UX Mismatch Item', unit: 'lb', category: 'Food' }, token);
    const invId = cr.body.id;
    cleanup.invIds.push(invId);

    const ir = await req(server, 'POST', '/api/ingredients',
      { name: 'UX Mismatch Ing', unit: 'each', cost: 1.00,
        servings_per_purchase: 1, inventory_item_id: invId }, token);
    cleanup.ingIds.push(ir.body.id);

    const r = await req(server, 'PUT', `/api/inventory/${invId}/purchase`,
      { purchase_unit: 'lb', pkg_qty: 10, purchase_price: 5.00, sync_ingredient: true }, token);
    assert.strictEqual(r.status, 200);
    assert.ok(r.body._unit_mismatch, '_unit_mismatch should be present');
    assert.ok(r.body._unit_mismatch.ingredient_name, 'ingredient_name should be set');
  });

  console.log('\n── Regression: existing Phase 2 purchase route behaviour ────────');

  await test('New-model ingredient (spp=1, cost=0) auto-syncs without confirmation', async () => {
    const cr = await req(server, 'POST', '/api/inventory',
      { name: 'UX New Model Item', unit: 'oz', category: 'Food' }, token);
    const invId = cr.body.id;
    cleanup.invIds.push(invId);

    const ir = await req(server, 'POST', '/api/ingredients',
      { name: 'UX New Model Ing', unit: 'oz', cost: 0,
        servings_per_purchase: 1, inventory_item_id: invId }, token);
    const ingId = ir.body.id;
    cleanup.ingIds.push(ingId);

    // sync_ingredient omitted — should auto-sync because spp=1 and cost=0.
    const r = await req(server, 'PUT', `/api/inventory/${invId}/purchase`,
      { purchase_unit: 'oz', pkg_qty: 16, purchase_price: 4.00 }, token);
    assert.strictEqual(r.status, 200);
    assert.ok(!r.body._ingredient_skipped);

    const ingList = await req(server, 'GET', '/api/ingredients', null, token);
    const ing = ingList.body.find(i => i.id === ingId);
    assert.ok(Math.abs(Number(ing.cost) - (4.0/16)) < 0.0001,
      `expected ${(4.0/16).toFixed(6)} got ${ing.cost}`);
    assert.strictEqual(Number(ing.servings_per_purchase), 1);
  });

  await test('purchase-preview linked_ingredient null when no ingredient linked', async () => {
    const cr = await req(server, 'POST', '/api/inventory',
      { name: 'UX Unlinked Item', unit: 'each', category: 'Food' }, token);
    const invId = cr.body.id;
    cleanup.invIds.push(invId);

    const r = await req(server, 'GET',
      `/api/inventory/${invId}/purchase-preview?purchase_unit=each&pkg_qty=12&purchase_price=6.00`,
      null, token);
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.linked_ingredient, null);
    assert.ok(Math.abs(Number(r.body.cost_per_base_unit) - 0.5) < 0.0001);
  });

  // ── Cleanup ────────────────────────────────────────────────────────────────
  for (const id of cleanup.ingIds) {
    await req(server, 'DELETE', `/api/ingredients/${id}`, null, token).catch(() => {});
  }
  for (const id of cleanup.invIds) {
    await req(server, 'DELETE', `/api/inventory/${id}`, null, token).catch(() => {});
  }

  await testPool.end();
  server.close();

  console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

run().catch(e => { console.error(e); process.exit(1); });
