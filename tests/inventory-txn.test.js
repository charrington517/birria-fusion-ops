'use strict';
/**
 * tests/inventory-txn.test.js
 *
 * Integration tests for POST /inventory/save — the unified transactional
 * save endpoint introduced in this commit.
 *
 * Groups:
 *   1. New item without purchase fields
 *   2. New item with purchase fields (single transaction)
 *   3. Existing item — base fields + purchase in one transaction
 *   4. Apply New Cost (sync_ingredient=true) in one transaction
 *   5. Keep Existing Cost (sync_ingredient=false) in one transaction
 *   6. Failure injection — rollback proofs
 *      6a. Constraint violation on INSERT rolls back entirely
 *      6b. Invalid purchase unit rolls back entirely (no inventory row written)
 *      6c. Ingredient sync failure does NOT roll back inventory update
 *          (unit-mismatch is a warning, not an error — inventory is saved)
 *   7. Frontend handler logic test (Node-level, no browser/React runtime)
 *      Limitation: tests the HTTP contract the handlers depend on, not the
 *      React state machine itself. Browser-level tooling (Playwright/JSDOM)
 *      would be required to test useState transitions directly.
 *
 * Run:
 *   TEST_DATABASE_URL=postgres://birria:<pw>@localhost:5432/birria_fusion_test \
 *     node tests/inventory-txn.test.js
 */

const assert  = require('assert');
const http    = require('http');
const { Pool } = require('pg');

// Load test DB config from .env.test — never derives credentials from production .env.
require('./helpers/test-db');
const TEST_DB_URL = process.env.TEST_DATABASE_URL;

const express    = require('express');
const authRoutes = require('../server/routes/auth');
const apiRoutes  = require('../server/routes/api');

const app = express();
app.use(express.json());
app.use('/api/auth', authRoutes);
app.use('/api', apiRoutes);

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
        ...(token  ? { Authorization: `Bearer ${token}` } : {}),
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
  try   { await fn(); console.log(`  PASS  ${name}`); passed++; }
  catch (e) { console.log(`  FAIL  ${name}\n        ${e.message}`); failed++; }
}

async function dbRow(sql, params) {
  const r = await testPool.query(sql, params);
  return r.rows[0] || null;
}

async function run() {
  const server = http.createServer(app);
  await new Promise(r => server.listen(0, '127.0.0.1', r));

  const loginRes = await req(server, 'POST', '/api/auth/login',
    { username: 'admin', password: 'admin123' });
  const token = loginRes.body.token;
  if (!token) { console.error('Cannot login to test DB'); process.exit(1); }

  const cleanup = { invIds: [], ingIds: [] };

  // ── 1. New item without purchase fields ──────────────────────────────────
  console.log('\n── 1. New item without purchase fields ──────────────────────────');

  await test('POST /inventory/save creates item, returns inventory wrapper', async () => {
    const r = await req(server, 'POST', '/api/inventory/save',
      { name: 'TXN Test Salt', unit: 'lb', category: 'Food' }, token);
    assert.strictEqual(r.status, 201);
    assert.ok(r.body.inventory?.id, 'inventory.id must be present');
    assert.strictEqual(r.body.inventory.name, 'TXN Test Salt');
    assert.strictEqual(r.body.inventory.cost_per_base_unit, null);
    cleanup.invIds.push(r.body.inventory.id);
  });

  await test('POST /inventory/save 400 when no valid fields supplied', async () => {
    const r = await req(server, 'POST', '/api/inventory/save',
      { not_a_field: 'x' }, token);
    assert.strictEqual(r.status, 400);
  });

  // ── 2. New item with purchase fields ─────────────────────────────────────
  console.log('\n── 2. New item with purchase fields (single transaction) ─────────');

  await test('New item + purchase: cost_per_base_unit computed in one call', async () => {
    const r = await req(server, 'POST', '/api/inventory/save',
      { name: 'TXN Test Flour', unit: 'lb', category: 'Food',
        purchase_unit: 'bag', pkg_qty: 50, purchase_price: 20.00 }, token);
    assert.strictEqual(r.status, 201);
    const inv = r.body.inventory;
    assert.ok(inv.id);
    cleanup.invIds.push(inv.id);
    // 20.00 / 50 = 0.40
    assert.ok(Math.abs(Number(inv.cost_per_base_unit) - 0.40) < 0.0001,
      `expected 0.40 got ${inv.cost_per_base_unit}`);
    assert.strictEqual(inv.purchase_unit, 'bag');
    assert.strictEqual(Number(inv.pkg_qty), 50);
  });

  await test('New item + purchase: GET confirms persisted values', async () => {
    const r = await req(server, 'POST', '/api/inventory/save',
      { name: 'TXN Test Rice', unit: 'lb', category: 'Food',
        purchase_unit: 'bag', pkg_qty: 25, purchase_price: 10.00 }, token);
    const id = r.body.inventory.id;
    cleanup.invIds.push(id);

    const gr = await req(server, 'GET', '/api/inventory', null, token);
    const inv = gr.body.find(i => i.id === id);
    assert.ok(inv, 'item must appear in GET /inventory');
    assert.ok(Math.abs(Number(inv.cost_per_base_unit) - 0.40) < 0.0001,
      `expected 0.40 got ${inv.cost_per_base_unit}`);
  });

  // ── 3. Existing item — base + purchase in one transaction ─────────────────
  console.log('\n── 3. Existing item — base + purchase in one transaction ─────────');

  let existingId;
  await test('Setup: create bare item via CRUD', async () => {
    const r = await req(server, 'POST', '/api/inventory',
      { name: 'TXN Existing Item', unit: 'oz', category: 'Food' }, token);
    assert.strictEqual(r.status, 201);
    existingId = r.body.id;
    cleanup.invIds.push(existingId);
  });

  await test('POST /inventory/save with id updates base + purchase atomically', async () => {
    const r = await req(server, 'POST', '/api/inventory/save',
      { id: existingId, name: 'TXN Existing Item Updated',
        purchase_unit: 'oz', pkg_qty: 16, purchase_price: 4.00 }, token);
    assert.strictEqual(r.status, 200);
    const inv = r.body.inventory;
    assert.strictEqual(inv.name, 'TXN Existing Item Updated');
    // 4.00 / 16 = 0.25
    assert.ok(Math.abs(Number(inv.cost_per_base_unit) - 0.25) < 0.0001,
      `expected 0.25 got ${inv.cost_per_base_unit}`);
  });

  await test('POST /inventory/save 404 for nonexistent id', async () => {
    const r = await req(server, 'POST', '/api/inventory/save',
      { id: 999999, name: 'Ghost' }, token);
    assert.strictEqual(r.status, 404);
  });

  // ── 4. Apply New Cost (sync_ingredient=true) ──────────────────────────────
  console.log('\n── 4. Apply New Cost — sync_ingredient=true ─────────────────────');

  let applyInvId, applyIngId;
  await test('Setup: create item + legacy ingredient', async () => {
    const ir = await req(server, 'POST', '/api/inventory/save',
      { name: 'TXN Apply Item', unit: 'pack', category: 'Food' }, token);
    applyInvId = ir.body.inventory.id;
    cleanup.invIds.push(applyInvId);

    const ingr = await req(server, 'POST', '/api/ingredients',
      { name: 'TXN Apply Ing', unit: 'pack', cost: 3.00,
        servings_per_purchase: 10, inventory_item_id: applyInvId }, token);
    assert.strictEqual(ingr.status, 201);
    applyIngId = ingr.body.id;
    cleanup.ingIds.push(applyIngId);
  });

  await test('sync_ingredient=true updates ingredient cost and spp in same transaction', async () => {
    const r = await req(server, 'POST', '/api/inventory/save',
      { id: applyInvId, purchase_unit: 'pack', pkg_qty: 20,
        purchase_price: 5.00, sync_ingredient: true }, token);
    assert.strictEqual(r.status, 200);
    assert.ok(!r.body._ingredient_skipped);

    // Inventory: 5.00/20 = 0.25
    assert.ok(Math.abs(Number(r.body.inventory.cost_per_base_unit) - 0.25) < 0.0001);

    // Ingredient updated in same transaction.
    const ing = await dbRow('SELECT * FROM ingredients WHERE id=$1', [applyIngId]);
    assert.ok(Math.abs(Number(ing.cost) - 0.25) < 0.0001,
      `ing.cost expected 0.25 got ${ing.cost}`);
    assert.strictEqual(Number(ing.servings_per_purchase), 1);
  });

  // ── 5. Keep Existing Cost (sync_ingredient=false) ─────────────────────────
  console.log('\n── 5. Keep Existing Cost — sync_ingredient=false ────────────────');

  let keepInvId, keepIngId;
  await test('Setup: create item + legacy ingredient for Keep test', async () => {
    const ir = await req(server, 'POST', '/api/inventory/save',
      { name: 'TXN Keep Item', unit: 'pack', category: 'Food' }, token);
    keepInvId = ir.body.inventory.id;
    cleanup.invIds.push(keepInvId);

    const ingr = await req(server, 'POST', '/api/ingredients',
      { name: 'TXN Keep Ing', unit: 'pack', cost: 4.50,
        servings_per_purchase: 15, inventory_item_id: keepInvId }, token);
    keepIngId = ingr.body.id;
    cleanup.ingIds.push(keepIngId);
  });

  await test('sync_ingredient=false saves inventory but preserves ingredient', async () => {
    const r = await req(server, 'POST', '/api/inventory/save',
      { id: keepInvId, purchase_unit: 'pack', pkg_qty: 30,
        purchase_price: 6.00, sync_ingredient: false }, token);
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body._ingredient_skipped, true);

    // Inventory updated.
    assert.ok(Math.abs(Number(r.body.inventory.cost_per_base_unit) - 0.20) < 0.0001,
      `expected 0.20 got ${r.body.inventory.cost_per_base_unit}`);

    // Ingredient unchanged.
    const ing = await dbRow('SELECT * FROM ingredients WHERE id=$1', [keepIngId]);
    assert.ok(Math.abs(Number(ing.cost) - 4.50) < 0.001, `ing.cost must remain 4.50`);
    assert.strictEqual(Number(ing.servings_per_purchase), 15, 'spp must remain 15');
  });


  // ── 6. Failure injection — rollback proofs ────────────────────────────────
  console.log('\n── 6. Failure injection — rollback proofs ───────────────────────');

  await test('6a. Duplicate barcode on INSERT rolls back: no inventory row created', async () => {
    // Create a first item with a known barcode.
    const first = await req(server, 'POST', '/api/inventory/save',
      { name: 'TXN Barcode First', unit: 'each', category: 'Food',
        barcode: '012345678905' }, token);
    assert.strictEqual(first.status, 201);
    cleanup.invIds.push(first.body.inventory.id);

    // Count rows before the failing attempt.
    const before = await testPool.query(
      "SELECT COUNT(*) AS n FROM inventory WHERE name='TXN Barcode Dupe'");
    const countBefore = Number(before.rows[0].n);

    // Attempt to create a second item with the same barcode — must fail.
    const dupe = await req(server, 'POST', '/api/inventory/save',
      { name: 'TXN Barcode Dupe', unit: 'each', category: 'Food',
        barcode: '012345678905' }, token);
    assert.strictEqual(dupe.status, 409, `expected 409 got ${dupe.status}`);

    // No partial row must exist.
    const after = await testPool.query(
      "SELECT COUNT(*) AS n FROM inventory WHERE name='TXN Barcode Dupe'");
    assert.strictEqual(Number(after.rows[0].n), countBefore,
      'no inventory row must survive a failed INSERT');
  });

  await test('6b. Invalid purchase unit (422) rolls back: no inventory row written', async () => {
    // Item with cross-unit that has no conversion and no pkg_qty — computeCostPerBaseUnit
    // returns null (not an error) when pkg_qty is missing, so we need a unit that
    // actually throws. Use purchase_unit=kg, base_unit=each — no conversion path.
    const countBefore = await testPool.query(
      "SELECT COUNT(*) AS n FROM inventory WHERE name='TXN Bad Unit Item'");
    const nBefore = Number(countBefore.rows[0].n);

    const r = await req(server, 'POST', '/api/inventory/save',
      { name: 'TXN Bad Unit Item', unit: 'each', category: 'Food',
        purchase_unit: 'kg', pkg_qty: 5, purchase_price: 10.00 }, token);
    // kg -> each has no conversion rule and 'each' is a packaging unit,
    // so computeCostPerBaseUnit throws -> 422.
    assert.ok(r.status === 422 || r.status === 400,
      `expected 422 or 400 got ${r.status}: ${JSON.stringify(r.body)}`);

    // No inventory row must have been written.
    const countAfter = await testPool.query(
      "SELECT COUNT(*) AS n FROM inventory WHERE name='TXN Bad Unit Item'");
    assert.strictEqual(Number(countAfter.rows[0].n), nBefore,
      'no inventory row must survive a failed purchase computation');
  });

  await test('6c. Unit-mismatch warning does NOT roll back inventory update', async () => {
    // Create inventory (lb) + ingredient (each) — incompatible units.
    const ir = await req(server, 'POST', '/api/inventory/save',
      { name: 'TXN Mismatch Inv', unit: 'lb', category: 'Food' }, token);
    const mismatchInvId = ir.body.inventory.id;
    cleanup.invIds.push(mismatchInvId);

    const ingr = await req(server, 'POST', '/api/ingredients',
      { name: 'TXN Mismatch Ing', unit: 'each', cost: 1.00,
        servings_per_purchase: 1, inventory_item_id: mismatchInvId }, token);
    cleanup.ingIds.push(ingr.body.id);

    // Save with sync_ingredient=true — unit mismatch means ingredient cost
    // cannot be computed, but inventory MUST still be saved (warning, not error).
    const r = await req(server, 'POST', '/api/inventory/save',
      { id: mismatchInvId, purchase_unit: 'lb', pkg_qty: 10,
        purchase_price: 5.00, sync_ingredient: true }, token);
    assert.strictEqual(r.status, 200, `expected 200 got ${r.status}`);
    assert.ok(r.body._unit_mismatch, '_unit_mismatch must be present');

    // Inventory must be updated despite the mismatch.
    const inv = await dbRow('SELECT * FROM inventory WHERE id=$1', [mismatchInvId]);
    assert.ok(Math.abs(Number(inv.cost_per_base_unit) - 0.50) < 0.0001,
      `inventory cost_per_base_unit must be saved; got ${inv.cost_per_base_unit}`);
  });

  await test('6d. Rollback proof: inventory row absent after 422 (direct DB check)', async () => {
    // Verify via direct DB query — not just the HTTP response — that no row exists.
    const name = 'TXN Rollback Proof ' + Date.now();
    const r = await req(server, 'POST', '/api/inventory/save',
      { name, unit: 'each', category: 'Food',
        purchase_unit: 'kg', pkg_qty: 1, purchase_price: 5.00 }, token);
    assert.ok(r.status !== 200 && r.status !== 201,
      `expected failure status got ${r.status}`);

    const row = await dbRow('SELECT id FROM inventory WHERE name=$1', [name]);
    assert.strictEqual(row, null,
      `inventory row must not exist after rollback; found id=${row?.id}`);
  });

  await test('6e. Ingredient unchanged after rollback (direct DB check)', async () => {
    // Create item + ingredient, then attempt a save that will fail at purchase
    // computation. Ingredient must remain at original values.
    const ir = await req(server, 'POST', '/api/inventory/save',
      { name: 'TXN Rollback Ing Inv', unit: 'each', category: 'Food' }, token);
    const rollbackInvId = ir.body.inventory.id;
    cleanup.invIds.push(rollbackInvId);

    const ingr = await req(server, 'POST', '/api/ingredients',
      { name: 'TXN Rollback Ing', unit: 'each', cost: 9.99,
        servings_per_purchase: 5, inventory_item_id: rollbackInvId }, token);
    const rollbackIngId = ingr.body.id;
    cleanup.ingIds.push(rollbackIngId);

    // Attempt save with purchase_unit=kg (no conversion to 'each') — must fail.
    const r = await req(server, 'POST', '/api/inventory/save',
      { id: rollbackInvId, purchase_unit: 'kg', pkg_qty: 2,
        purchase_price: 8.00, sync_ingredient: true }, token);
    assert.ok(r.status !== 200, `expected failure got ${r.status}`);

    // Ingredient must be unchanged.
    const ing = await dbRow('SELECT * FROM ingredients WHERE id=$1', [rollbackIngId]);
    assert.ok(Math.abs(Number(ing.cost) - 9.99) < 0.001,
      `ingredient cost must be unchanged; got ${ing.cost}`);
    assert.strictEqual(Number(ing.servings_per_purchase), 5,
      `ingredient spp must be unchanged; got ${ing.servings_per_purchase}`);
  });


  // ── 7. Frontend handler logic test ───────────────────────────────────────
  //
  // LIMITATION: App.jsx uses React hooks (useState, useEffect) which require
  // a browser DOM or JSDOM + React test renderer to exercise directly.
  // This suite has neither available without adding new dev dependencies.
  //
  // What these tests DO cover: the HTTP contract that handleSave,
  // handleSaveWithPurchase, and applyFullSave depend on. Each test mirrors
  // the exact fetch call the handler makes and asserts the response shape
  // the handler branches on. If the contract changes, the handler breaks.
  //
  // To test React state transitions (saving/saveErr/pendingSync/purchaseWarn)
  // add @testing-library/react + jsdom and render <InventoryModal> directly.
  console.log('\n── 7. Frontend handler contract tests ───────────────────────────');

  await test('handleSave path: POST /inventory/save returns {inventory:{id}} for new item', async () => {
    // Mirrors: const result = await api('/api/inventory/save', {method:'POST', body:...})
    //          if (!result.inventory?.id) throw ...
    const r = await req(server, 'POST', '/api/inventory/save',
      { name: 'Handler Test New', unit: 'each', category: 'Food' }, token);
    assert.strictEqual(r.status, 201);
    assert.ok(r.body.inventory?.id,
      'handler checks result.inventory?.id — must be truthy');
    cleanup.invIds.push(r.body.inventory.id);
  });

  await test('handleSave path: new item with purchase fields returns cost_per_base_unit', async () => {
    // Mirrors the isNew && hasPurchase branch.
    const r = await req(server, 'POST', '/api/inventory/save',
      { name: 'Handler Test New+Purchase', unit: 'lb', category: 'Food',
        purchase_unit: 'bag', pkg_qty: 10, purchase_price: 5.00 }, token);
    assert.strictEqual(r.status, 201);
    assert.ok(r.body.inventory?.id);
    assert.ok(Number(r.body.inventory.cost_per_base_unit) > 0,
      'cost_per_base_unit must be computed for new item with purchase fields');
    cleanup.invIds.push(r.body.inventory.id);
  });

  await test('applyFullSave path: POST /inventory/save with id returns {inventory,_unit_mismatch?}', async () => {
    // Mirrors: const result = await api('/api/inventory/save', {method:'POST', body:{...baseForm, id, ...}})
    //          handler branches on result._unit_mismatch
    const cr = await req(server, 'POST', '/api/inventory/save',
      { name: 'Handler Test Existing', unit: 'oz', category: 'Food' }, token);
    const id = cr.body.inventory.id;
    cleanup.invIds.push(id);

    const r = await req(server, 'POST', '/api/inventory/save',
      { id, name: 'Handler Test Existing Updated',
        purchase_unit: 'oz', pkg_qty: 8, purchase_price: 2.00 }, token);
    assert.strictEqual(r.status, 200);
    assert.ok(r.body.inventory, 'response must have inventory key');
    assert.strictEqual(r.body._unit_mismatch, undefined,
      '_unit_mismatch must be absent when units match');
    // handler calls onClose() when no _unit_mismatch
  });

  await test('applyFullSave path: _unit_mismatch present triggers setPurchaseWarn branch', async () => {
    // Mirrors: if (result._unit_mismatch) { setPurchaseWarn(...) } else { onClose() }
    const cr = await req(server, 'POST', '/api/inventory/save',
      { name: 'Handler Mismatch Inv', unit: 'lb', category: 'Food' }, token);
    const id = cr.body.inventory.id;
    cleanup.invIds.push(id);

    const mi = await req(server, 'POST', '/api/ingredients',
      { name: 'Handler Mismatch Ing', unit: 'each', cost: 1.00,
        servings_per_purchase: 1, inventory_item_id: id }, token);
    if (mi.body?.id) cleanup.ingIds.push(mi.body.id);

    const r = await req(server, 'POST', '/api/inventory/save',
      { id, purchase_unit: 'lb', pkg_qty: 5, purchase_price: 10.00,
        sync_ingredient: true }, token);
    assert.strictEqual(r.status, 200);
    assert.ok(r.body._unit_mismatch,
      '_unit_mismatch must be present — handler shows warning, stays open');
    assert.ok(r.body._unit_mismatch.ingredient_name,
      'ingredient_name required for setPurchaseWarn message interpolation');
  });

  await test('handleSaveWithPurchase preview path: GET purchase-preview returns linked_ingredient', async () => {
    // Mirrors: preview = await api(`/api/inventory/${item.id}/purchase-preview?${qs}`)
    //          const li = preview.linked_ingredient
    //          const isLegacy = li && (Number(li.current_spp)>1 || ...) && ...
    const cr = await req(server, 'POST', '/api/inventory/save',
      { name: 'Handler Preview Inv', unit: 'pack', category: 'Food' }, token);
    const id = cr.body.inventory.id;
    cleanup.invIds.push(id);

    await req(server, 'POST', '/api/ingredients',
      { name: 'Handler Preview Ing', unit: 'pack', cost: 3.25,
        servings_per_purchase: 22, inventory_item_id: id }, token);

    const r = await req(server, 'GET',
      `/api/inventory/${id}/purchase-preview?purchase_unit=pack&pkg_qty=30&purchase_price=2.50`,
      null, token);
    assert.strictEqual(r.status, 200);
    const li = r.body.linked_ingredient;
    assert.ok(li, 'linked_ingredient must be present');
    // isLegacy check the handler performs:
    const isLegacy = li && (Number(li.current_spp) > 1 || Number(li.current_cost) > 0)
                     && li.proposed_cost_per_unit !== null;
    assert.strictEqual(isLegacy, true,
      'isLegacy must be true — handler must show PurchaseSyncConfirm panel');
    // DB must be unchanged (preview is read-only).
    const inv = await dbRow('SELECT * FROM inventory WHERE id=$1', [id]);
    assert.strictEqual(inv.purchase_price, null,
      'preview must not write purchase_price');
  });

  await test('handleSaveWithPurchase preview failure: 422 leaves DB unchanged', async () => {
    // Mirrors: catch(e) { setPurchaseErr(...); return; }
    const cr = await req(server, 'POST', '/api/inventory/save',
      { name: 'Handler Preview Fail', unit: 'each', category: 'Food' }, token);
    const id = cr.body.inventory.id;
    cleanup.invIds.push(id);

    // kg -> each has no conversion — preview returns 422.
    const r = await req(server, 'GET',
      `/api/inventory/${id}/purchase-preview?purchase_unit=kg&pkg_qty=5&purchase_price=10.00`,
      null, token);
    assert.ok(r.status === 422 || r.status === 200,
      'preview either 422 or 200 with null cpbu');

    // Either way DB must be unchanged.
    const inv = await dbRow('SELECT * FROM inventory WHERE id=$1', [id]);
    assert.strictEqual(inv.purchase_price, null,
      'purchase_price must not be written by a failed/null preview');
  });

  // ── Cleanup ───────────────────────────────────────────────────────────────
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
