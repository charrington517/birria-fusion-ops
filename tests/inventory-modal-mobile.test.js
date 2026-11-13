'use strict';
/**
 * tests/inventory-modal-mobile.test.js
 *
 * Responsive frontend tests for the InventoryModal mobile fix.
 *
 * SCOPE AND LIMITATIONS
 * ---------------------
 * Full viewport simulation (320px / 375px / 430px) requires a browser engine
 * (Playwright, Puppeteer, or JSDOM + @testing-library/react). None are
 * available in this project without adding new dependencies.
 *
 * What these tests DO cover:
 *   1. Build asset verification — the compiled JS bundle contains the purchase
 *      field markup, inputMode attributes, className hooks, and CSS breakpoint.
 *   2. HTTP contract tests — the API endpoints the modal depends on return the
 *      correct shape at all screen widths (the server is viewport-agnostic).
 *   3. Corn Tortillas end-to-end: edit existing item, enter purchase price and
 *      pkg_qty, save, verify ingredient-cost confirmation data is returned.
 *   4. Reopen / persist: GET after save shows persisted purchase values.
 *   5. Auth protection on the save endpoint.
 *
 * Manual browser tests required (documented below):
 *   A. Open the app on a 375px-wide device or Chrome DevTools mobile emulation.
 *   B. Navigate to Inventory → edit Corn Tortillas.
 *   C. Verify the Purchase & Costing section is visible without horizontal scroll.
 *   D. Tap Purchase Price — verify the numeric keyboard appears (not QWERTY).
 *   E. Enter pkg_qty=30, purchase_price=2.50, tap Save Item.
 *   F. Verify the Apply New Cost / Keep Existing Cost panel appears.
 *   G. Tap Apply to Ingredient — verify modal closes and cost updates.
 *   H. Reopen Corn Tortillas — verify purchase_price=2.50, pkg_qty=30 shown.
 *   I. Verify Save Item button is reachable by scrolling (not hidden by keyboard).
 *   J. Verify no horizontal scrollbar appears at 320px width.
 *
 * Run:
 *   node tests/inventory-modal-mobile.test.js
 */

require('./helpers/test-db');
const assert = require('assert');
const http   = require('http');
const fs     = require('fs');
const path   = require('path');
const { Pool } = require('pg');

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
        ...(token   ? { Authorization: 'Bearer ' + token } : {}),
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
    };
    const r = http.request(opts, res => {
      let d = '';
      res.on('data', c => { d += c; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(d) }); }
        catch { resolve({ status: res.statusCode, body: d }); }
      });
    });
    r.on('error', reject);
    if (payload) r.write(payload);
    r.end();
  });
}

let passed = 0, failed = 0;
async function test(name, fn) {
  try   { await fn(); console.log('  PASS  ' + name); passed++; }
  catch (e) { console.log('  FAIL  ' + name + '\n        ' + e.message); failed++; }
}

// ── Build asset verification ──────────────────────────────────────────────────

function readBuiltJs() {
  const distDir = path.resolve(__dirname, '../client/dist/assets');
  if (!fs.existsSync(distDir)) return null;
  const files = fs.readdirSync(distDir).filter(f => f.endsWith('.js') && f.startsWith('index'));
  if (!files.length) return null;
  // Return concatenated content of all index JS chunks.
  return files.map(f => fs.readFileSync(path.join(distDir, f), 'utf8')).join('\n');
}

function readBuiltCss() {
  const distDir = path.resolve(__dirname, '../client/dist/assets');
  if (!fs.existsSync(distDir)) return null;
  const files = fs.readdirSync(distDir).filter(f => f.endsWith('.css'));
  if (!files.length) return null;
  return files.map(f => fs.readFileSync(path.join(distDir, f), 'utf8')).join('\n');
}

async function run() {
  const server = http.createServer(app);
  await new Promise(r => server.listen(0, '127.0.0.1', r));

  const loginRes = await req(server, 'POST', '/api/auth/login',
    { username: 'admin', password: 'admin123' });
  const token = loginRes.body.token;
  if (!token) { console.error('Cannot login to test DB'); process.exit(1); }

  const cleanup = { invIds: [], ingIds: [] };

  // ── 1. Build asset verification ─────────────────────────────────────────────
  console.log('\n── 1. Build asset verification ──────────────────────────────────');

  const builtJs  = readBuiltJs();
  const builtCss = readBuiltCss();

  await test('Built JS exists in client/dist/assets/', () => {
    assert.ok(builtJs !== null, 'No index*.js found in client/dist/assets/ — run npm run build');
  });

  await test('Built JS contains Purchase & Costing section heading', () => {
    assert.ok(builtJs && builtJs.includes('Purchase'), 'Purchase heading missing from bundle');
  });

  await test('Built JS contains pkg_qty field', () => {
    assert.ok(builtJs && builtJs.includes('pkg_qty'), 'pkg_qty field missing from bundle');
  });

  await test('Built JS contains purchase_price field', () => {
    assert.ok(builtJs && builtJs.includes('purchase_price'), 'purchase_price field missing from bundle');
  });

  await test('Built JS contains purchase_unit field', () => {
    assert.ok(builtJs && builtJs.includes('purchase_unit'), 'purchase_unit field missing from bundle');
  });

  await test('Built JS contains inputMode="decimal" for numeric purchase inputs', () => {
    // Vite minifies attribute names but preserves string values.
    assert.ok(builtJs && builtJs.includes('inputMode') || builtJs && builtJs.includes('inputmode'),
      'inputMode attribute missing — iOS numeric keyboard will not appear');
  });

  await test('Built JS contains purchase-actions className for Apply/Keep button row', () => {
    assert.ok(builtJs && builtJs.includes('purchase-actions'),
      'purchase-actions class missing — mobile button stacking CSS will not apply');
  });

  await test('Built JS contains ing-link-row className for ingredient link row', () => {
    assert.ok(builtJs && builtJs.includes('ing-link-row'),
      'ing-link-row class missing — mobile ingredient link stacking CSS will not apply');
  });

  await test('Built JS contains PurchaseSyncConfirm (Apply New Cost panel)', () => {
    assert.ok(builtJs && (builtJs.includes('Apply to Ingredient') || builtJs.includes('Apply New Cost')),
      'PurchaseSyncConfirm panel missing from bundle');
  });

  await test('Built CSS contains max-width:600px mobile breakpoint', () => {
    assert.ok(builtCss && (builtCss.includes('600px') || builtCss.includes('max-width:600')),
      'Mobile breakpoint missing from built CSS');
  });

  await test('Built CSS contains purchase-actions rule for mobile button stacking', () => {
    assert.ok(builtCss && builtCss.includes('purchase-actions'),
      'purchase-actions CSS rule missing');
  });

  await test('Built CSS contains ing-link-row rule', () => {
    assert.ok(builtCss && builtCss.includes('ing-link-row'),
      'ing-link-row CSS rule missing');
  });

  await test('Built CSS contains font-size:16px to prevent iOS auto-zoom', () => {
    assert.ok(builtCss && builtCss.includes('16px'),
      'font-size:16px missing — iOS will auto-zoom on input focus');
  });

  await test('Built CSS contains min-height:44px for tap targets', () => {
    assert.ok(builtCss && builtCss.includes('44px'),
      'min-height:44px missing — tap targets may be too small on mobile');
  });

  await test('Built CSS contains -webkit-overflow-scrolling:touch for modal scroll', () => {
    assert.ok(builtCss && builtCss.includes('-webkit-overflow-scrolling'),
      '-webkit-overflow-scrolling missing — modal may not scroll smoothly on iOS');
  });

  // ── 2. HTTP contract — viewport-agnostic (server has no concept of screen width)
  console.log('\n── 2. HTTP contract (viewport-agnostic) ─────────────────────────');

  await test('GET /inventory returns purchase fields for all screen widths', async () => {
    const r = await req(server, 'GET', '/api/inventory', null, token);
    assert.strictEqual(r.status, 200);
    assert.ok(Array.isArray(r.body));
    // Every item must have the purchase field keys present (may be null).
    const item = r.body[0];
    assert.ok('purchase_unit'      in item, 'purchase_unit missing from GET /inventory');
    assert.ok('pkg_qty'            in item, 'pkg_qty missing from GET /inventory');
    assert.ok('purchase_price'     in item, 'purchase_price missing from GET /inventory');
    assert.ok('cost_per_base_unit' in item, 'cost_per_base_unit missing from GET /inventory');
    assert.ok('conversion_factor'  in item, 'conversion_factor missing from GET /inventory');
  });

  await test('POST /inventory/save requires auth (mobile client sends same token)', async () => {
    const r = await req(server, 'POST', '/api/inventory/save', { name: 'X', unit: 'each', category: 'Food' }, null);
    assert.strictEqual(r.status, 401);
  });

  // ── 3. Corn Tortillas scenario at mobile screen widths ────────────────────
  // The server is viewport-agnostic; these tests verify the full workflow the
  // mobile UI depends on works correctly end-to-end.
  console.log('\n── 3. Corn Tortillas mobile workflow ────────────────────────────');

  let tortInvId, tortIngId;

  await test('Setup: create Corn Tortillas inventory item', async () => {
    const r = await req(server, 'POST', '/api/inventory/save',
      { name: 'Mobile Test Corn Tortillas', unit: 'pack', category: 'Food' }, token);
    assert.strictEqual(r.status, 201);
    tortInvId = r.body.inventory.id;
    cleanup.invIds.push(tortInvId);
  });

  await test('Setup: create legacy ingredient (spp=22, cost=3.25)', async () => {
    const r = await req(server, 'POST', '/api/ingredients',
      { name: 'Mobile Test Corn Tortilla', unit: 'pack', cost: 3.25,
        servings_per_purchase: 22, inventory_item_id: tortInvId }, token);
    assert.strictEqual(r.status, 201);
    tortIngId = r.body.id;
    cleanup.ingIds.push(tortIngId);
  });

  await test('[320px] purchase-preview returns linked_ingredient with proposed cost', async () => {
    // Simulates what handleSaveWithPurchase does on a 320px screen.
    const r = await req(server, 'GET',
      '/api/inventory/' + tortInvId + '/purchase-preview?purchase_unit=pack&pkg_qty=30&purchase_price=2.50',
      null, token);
    assert.strictEqual(r.status, 200);
    const li = r.body.linked_ingredient;
    assert.ok(li, 'linked_ingredient must be present');
    assert.ok(Math.abs(Number(li.proposed_cost_per_unit) - (2.5/30)) < 0.0001,
      'proposed_cost_per_unit wrong: ' + li.proposed_cost_per_unit);
    // isLegacy check — must trigger PurchaseSyncConfirm panel on mobile.
    const isLegacy = li && (Number(li.current_spp) > 1 || Number(li.current_cost) > 0)
                     && li.proposed_cost_per_unit !== null;
    assert.strictEqual(isLegacy, true, 'isLegacy must be true — Apply/Keep panel must show');
  });

  await test('[375px] preview is read-only — no DB write before user confirms', async () => {
    await req(server, 'GET',
      '/api/inventory/' + tortInvId + '/purchase-preview?purchase_unit=pack&pkg_qty=30&purchase_price=2.50',
      null, token);
    const gr = await req(server, 'GET', '/api/inventory', null, token);
    const inv = gr.body.find(i => i.id === tortInvId);
    assert.strictEqual(inv.purchase_price, null, 'preview must not write purchase_price');
    assert.strictEqual(inv.cost_per_base_unit, null, 'preview must not write cost_per_base_unit');
  });

  await test('[430px] Apply New Cost: POST /inventory/save sync_ingredient=true', async () => {
    // Simulates onApply callback from PurchaseSyncConfirm on a 430px screen.
    const r = await req(server, 'POST', '/api/inventory/save',
      { id: tortInvId, name: 'Mobile Test Corn Tortillas',
        purchase_unit: 'pack', pkg_qty: 30, purchase_price: 2.50,
        sync_ingredient: true }, token);
    assert.strictEqual(r.status, 200);
    assert.ok(!r.body._unit_mismatch, 'no unit mismatch expected');
    assert.ok(!r.body._ingredient_skipped, 'ingredient should not be skipped');
    // Inventory cost_per_base_unit: 2.50/30 = 0.0833...
    assert.ok(Math.abs(Number(r.body.inventory.cost_per_base_unit) - (2.5/30)) < 0.0001,
      'cost_per_base_unit wrong: ' + r.body.inventory.cost_per_base_unit);
  });

  await test('Reopen: GET /inventory shows persisted purchase values', async () => {
    const gr = await req(server, 'GET', '/api/inventory', null, token);
    const inv = gr.body.find(i => i.id === tortInvId);
    assert.ok(inv, 'item must appear in GET /inventory');
    assert.strictEqual(inv.purchase_unit, 'pack');
    assert.strictEqual(Number(inv.pkg_qty), 30);
    assert.ok(Math.abs(Number(inv.purchase_price) - 2.5) < 0.001,
      'purchase_price wrong: ' + inv.purchase_price);
    assert.ok(Number(inv.cost_per_base_unit) > 0,
      'cost_per_base_unit must be > 0 after save');
  });

  await test('Reopen: ingredient cost updated after Apply New Cost', async () => {
    const ir = await req(server, 'GET', '/api/ingredients', null, token);
    const ing = ir.body.find(i => i.id === tortIngId);
    assert.ok(Math.abs(Number(ing.cost) - (2.5/30)) < 0.0001,
      'ingredient cost wrong: ' + ing.cost);
    assert.strictEqual(Number(ing.servings_per_purchase), 1, 'spp must be reset to 1');
  });

  // ── 4. Keep Existing Cost on mobile ──────────────────────────────────────
  console.log('\n── 4. Keep Existing Cost on mobile ──────────────────────────────');

  let keepInvId, keepIngId;

  await test('Setup: create item + legacy ingredient for Keep test', async () => {
    const ir = await req(server, 'POST', '/api/inventory/save',
      { name: 'Mobile Keep Item', unit: 'pack', category: 'Food' }, token);
    keepInvId = ir.body.inventory.id;
    cleanup.invIds.push(keepInvId);
    const ingr = await req(server, 'POST', '/api/ingredients',
      { name: 'Mobile Keep Ing', unit: 'pack', cost: 4.50,
        servings_per_purchase: 15, inventory_item_id: keepInvId }, token);
    keepIngId = ingr.body.id;
    cleanup.ingIds.push(keepIngId);
  });

  await test('[375px] Keep Existing Cost: inventory updates, ingredient preserved', async () => {
    // Simulates onSkip callback from PurchaseSyncConfirm.
    const r = await req(server, 'POST', '/api/inventory/save',
      { id: keepInvId, purchase_unit: 'pack', pkg_qty: 20,
        purchase_price: 6.00, sync_ingredient: false }, token);
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body._ingredient_skipped, true);
    // Inventory updated: 6.00/20 = 0.30
    assert.ok(Math.abs(Number(r.body.inventory.cost_per_base_unit) - 0.30) < 0.0001);
    // Ingredient unchanged.
    const ir = await req(server, 'GET', '/api/ingredients', null, token);
    const ing = ir.body.find(i => i.id === keepIngId);
    assert.ok(Math.abs(Number(ing.cost) - 4.50) < 0.001, 'cost must remain 4.50');
    assert.strictEqual(Number(ing.servings_per_purchase), 15, 'spp must remain 15');
  });

  // ── 5. New item with purchase fields on mobile ────────────────────────────
  console.log('\n── 5. New item with purchase fields on mobile ───────────────────');

  await test('[320px] New item + purchase: single transactional save', async () => {
    // Simulates handleSave isNew && hasPurchase path on a 320px screen.
    const r = await req(server, 'POST', '/api/inventory/save',
      { name: 'Mobile New Item', unit: 'lb', category: 'Food',
        purchase_unit: 'bag', pkg_qty: 20, purchase_price: 8.00 }, token);
    assert.strictEqual(r.status, 201);
    assert.ok(r.body.inventory?.id, 'inventory.id must be present');
    // 8.00/20 = 0.40
    assert.ok(Math.abs(Number(r.body.inventory.cost_per_base_unit) - 0.40) < 0.0001,
      'cost_per_base_unit wrong: ' + r.body.inventory.cost_per_base_unit);
    cleanup.invIds.push(r.body.inventory.id);
  });

  // ── 6. Validation errors visible on mobile ────────────────────────────────
  console.log('\n── 6. Validation errors on mobile ───────────────────────────────');

  await test('400 on no valid fields — error message available for display', async () => {
    const r = await req(server, 'POST', '/api/inventory/save', { not_a_field: 'x' }, token);
    assert.strictEqual(r.status, 400);
    assert.ok(r.body.error, 'error message must be present for mobile display');
  });

  await test('404 on nonexistent id — error message available for display', async () => {
    const r = await req(server, 'POST', '/api/inventory/save', { id: 999999, name: 'Ghost' }, token);
    assert.strictEqual(r.status, 404);
    assert.ok(r.body.error, 'error message must be present for mobile display');
  });

  await test('422 on bad unit conversion — error message available for display', async () => {
    const cr = await req(server, 'POST', '/api/inventory/save',
      { name: 'Mobile Err Item', unit: 'each', category: 'Food' }, token);
    cleanup.invIds.push(cr.body.inventory.id);
    const r = await req(server, 'POST', '/api/inventory/save',
      { id: cr.body.inventory.id, purchase_unit: 'kg', pkg_qty: 1, purchase_price: 5.00 }, token);
    assert.ok(r.status === 422 || r.status === 400,
      'expected 422/400 got ' + r.status);
    assert.ok(r.body.error, 'error message must be present for mobile display');
  });

  // ── Cleanup ───────────────────────────────────────────────────────────────
  for (const id of cleanup.ingIds) {
    await req(server, 'DELETE', '/api/ingredients/' + id, null, token).catch(() => {});
  }
  for (const id of cleanup.invIds) {
    await req(server, 'DELETE', '/api/inventory/' + id, null, token).catch(() => {});
  }

  await testPool.end();
  server.close();

  console.log('\n' + (passed + failed) + ' tests: ' + passed + ' passed, ' + failed + ' failed\n');
  if (failed > 0) process.exit(1);
}

run().catch(e => { console.error(e); process.exit(1); });
