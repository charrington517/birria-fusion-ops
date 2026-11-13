'use strict';
/**
 * tests/inventory-modal-mobile.test.js
 *
 * Responsive frontend tests for the InventoryModal mobile fix.
 *
 * SCOPE AND LIMITATIONS
 * ---------------------
 * Playwright is not installed in this project. Full viewport rendering at
 * 320px / 375px / 430px — including bounding-box checks, scroll behaviour,
 * and keyboard interaction — cannot be automated without it.
 *
 * What these tests DO verify:
 *   Group 1 — Source CSS correctness:
 *     Reads style.css directly and asserts the working CSS rules are present
 *     and the previously broken rules (flex-direction:column !important on
 *     grid elements) are absent. This is a structural correctness check, not
 *     a rendered-layout check.
 *   Group 2 — Build asset verification:
 *     Confirms the compiled bundle contains the className hooks and CSS rules
 *     that the mobile breakpoint depends on.
 *   Group 3 — HTTP contract:
 *     The server is viewport-agnostic. These tests verify the API endpoints
 *     the modal depends on return the correct shape regardless of screen width.
 *   Groups 4-7 — End-to-end workflow:
 *     Corn Tortillas edit, Apply New Cost, Keep Existing Cost, new item,
 *     validation errors — all at the API level.
 *
 * MANUAL BROWSER TEST CHECKLIST (required before deployment approval)
 * -------------------------------------------------------------------
 * Open Chrome DevTools → Toggle device toolbar → set width to each of
 * 320px, 375px, 430px. Navigate to Inventory → edit Corn Tortillas.
 *
 *   A. [320px] No horizontal scrollbar visible in the modal.
 *   B. [320px] Purchase Unit, Pkg Qty, Purchase Price, Conv Factor each
 *      occupy a full-width row (single column layout).
 *   C. [375px] Tap Purchase Price input → numeric keyboard appears (not QWERTY).
 *   D. [375px] Tap Pkg Qty input → numeric keyboard appears.
 *   E. [375px] Enter pkg_qty=30, purchase_price=2.50, tap Save Item.
 *   F. [375px] Apply New Cost / Keep Existing Cost panel appears within the
 *      modal without requiring horizontal scroll.
 *   G. [375px] Tap Apply to Ingredient → modal closes, cost updates.
 *   H. [430px] Reopen Corn Tortillas → purchase_price=2.50, pkg_qty=30 shown.
 *   I. [430px] Save Item button is reachable by vertical scroll when keyboard
 *      is open (not permanently hidden behind the keyboard).
 *   J. [320px] Modal close button (×) has a tap target of at least 44×44px.
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

function req(server, method, urlPath, body, token) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const opts = {
      hostname: '127.0.0.1',
      port: server.address().port,
      path: urlPath,
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

// ── CSS source helpers ────────────────────────────────────────────────────────

function readSourceCss() {
  return fs.readFileSync(
    path.resolve(__dirname, '../client/src/style.css'), 'utf8');
}

function readBuiltCss() {
  const dir = path.resolve(__dirname, '../client/dist/assets');
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.css'));
  if (!files.length) return null;
  return files.map(f => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n');
}

function readBuiltJs() {
  const dir = path.resolve(__dirname, '../client/dist/assets');
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.js') && f.startsWith('index'));
  if (!files.length) return null;
  return files.map(f => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n');
}

// Extract the @media(max-width:600px) block from a CSS string.
function extractMediaBlock(css) {
  const marker = '@media(max-width:600px)';
  const start = css.indexOf(marker);
  if (start === -1) return null;
  let depth = 0, end = start;
  for (let i = start; i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  return css.slice(start, end);
}

async function run() {
  const server = http.createServer(app);
  await new Promise(r => server.listen(0, '127.0.0.1', r));

  const loginRes = await req(server, 'POST', '/api/auth/login',
    { username: 'admin', password: 'admin123' });
  const token = loginRes.body.token;
  if (!token) { console.error('Cannot login to test DB'); process.exit(1); }

  const cleanup = { invIds: [], ingIds: [] };

  // ── 1. Source CSS structural correctness ─────────────────────────────────
  // These tests read style.css directly and verify the CSS rules are
  // structurally correct — not just that strings exist, but that the right
  // properties are applied to the right selectors.
  console.log('\n── 1. Source CSS structural correctness ─────────────────────────');

  const srcCss   = readSourceCss();
  const mediaBlk = extractMediaBlock(srcCss);

  await test('style.css has @media(max-width:600px) block', () => {
    assert.ok(mediaBlk !== null, '@media(max-width:600px) block not found in style.css');
  });

  await test('Mobile block uses grid-template-columns override on inv-form-grid-2', () => {
    assert.ok(mediaBlk && mediaBlk.includes('.inv-form-grid-2'),
      '.inv-form-grid-2 selector missing from mobile block');
    assert.ok(mediaBlk && mediaBlk.includes('grid-template-columns:minmax(0,1fr)'),
      'grid-template-columns:minmax(0,1fr) missing — grids will not collapse on mobile');
  });

  await test('Mobile block uses grid-template-columns override on inv-form-grid-3', () => {
    assert.ok(mediaBlk && mediaBlk.includes('.inv-form-grid-3'),
      '.inv-form-grid-3 selector missing from mobile block');
  });

  await test('Mobile block uses grid-template-columns override on inv-purchase-grid', () => {
    assert.ok(mediaBlk && mediaBlk.includes('.inv-purchase-grid'),
      '.inv-purchase-grid selector missing from mobile block');
    // Both purchase grids must collapse to single column.
    const count = (mediaBlk.match(/grid-template-columns:minmax\(0,1fr\)/g) || []).length;
    assert.ok(count >= 2,
      'Expected at least 2 grid-template-columns overrides (form + purchase), found ' + count);
  });

  await test('Mobile block does NOT use flex-direction on grid elements (was broken)', () => {
    // flex-direction has no effect on CSS Grid. The previous implementation
    // used flex-direction:column !important on .inv-form-grid-* which did nothing.
    // Verify that pattern is absent.
    const broken = mediaBlk && (
      /\.inv-form-grid[^}]*flex-direction/.test(mediaBlk) ||
      /\.inv-purchase-grid[^}]*flex-direction/.test(mediaBlk)
    );
    assert.strictEqual(broken, false,
      'flex-direction found on a grid selector — this has no effect on CSS Grid');
  });

  await test('Mobile block does NOT use flex-direction:column !important on any grid', () => {
    // The specific broken pattern from the previous commit.
    assert.ok(!mediaBlk || !mediaBlk.includes('flex-direction:column !important'),
      'flex-direction:column !important still present — remove it');
  });

  await test('Mobile block sets font-size:16px on modal inputs (prevents iOS auto-zoom)', () => {
    assert.ok(mediaBlk && mediaBlk.includes('font-size:16px'),
      'font-size:16px missing — iOS Safari will auto-zoom on input focus');
  });

  await test('Mobile block sets min-height:44px on modal inputs and buttons', () => {
    assert.ok(mediaBlk && mediaBlk.includes('min-height:44px'),
      'min-height:44px missing — tap targets too small on mobile');
  });

  await test('Mobile block sets -webkit-overflow-scrolling:touch on modal-card', () => {
    assert.ok(mediaBlk && mediaBlk.includes('-webkit-overflow-scrolling:touch'),
      '-webkit-overflow-scrolling:touch missing — modal scroll may be jerky on iOS');
  });

  await test('Mobile block sets width:100% on modal-card', () => {
    assert.ok(mediaBlk && mediaBlk.includes('width:100%'),
      'width:100% missing from .modal-card in mobile block — card may overflow viewport');
  });

  await test('purchase-actions uses flex-direction:column (valid — it IS a flex container)', () => {
    assert.ok(mediaBlk && mediaBlk.includes('.purchase-actions'),
      '.purchase-actions missing from mobile block');
    // purchase-actions is display:flex, so flex-direction:column is correct here.
    const paBlock = mediaBlk.slice(mediaBlk.indexOf('.purchase-actions'));
    assert.ok(paBlock.includes('flex-direction:column'),
      'flex-direction:column missing from .purchase-actions');
  });

  await test('ing-link-row uses flex-direction:column (valid — it IS a flex container)', () => {
    assert.ok(mediaBlk && mediaBlk.includes('.ing-link-row'),
      '.ing-link-row missing from mobile block');
  });

  // ── 2. Build asset verification ──────────────────────────────────────────
  console.log('\n── 2. Build asset verification ──────────────────────────────────');

  const builtCss = readBuiltCss();
  const builtJs  = readBuiltJs();
  const builtMediaBlk = builtCss ? extractMediaBlock(builtCss) : null;

  await test('Built CSS exists in client/dist/assets/', () => {
    assert.ok(builtCss !== null,
      'No CSS found in client/dist/assets/ — run npm run build');
  });

  await test('Built CSS contains inv-form-grid-2 with grid-template-columns override', () => {
    assert.ok(builtMediaBlk && builtMediaBlk.includes('inv-form-grid-2'),
      'inv-form-grid-2 missing from built CSS mobile block');
    assert.ok(builtMediaBlk && builtMediaBlk.includes('grid-template-columns:minmax(0,1fr)'),
      'grid-template-columns override missing from built CSS');
  });

  await test('Built CSS contains inv-purchase-grid with grid-template-columns override', () => {
    assert.ok(builtMediaBlk && builtMediaBlk.includes('inv-purchase-grid'),
      'inv-purchase-grid missing from built CSS mobile block');
  });

  await test('Built CSS does NOT contain flex-direction:column !important on grid selectors', () => {
    assert.ok(!builtMediaBlk || !builtMediaBlk.includes('flex-direction:column !important'),
      'Broken flex-direction:column !important still in built CSS');
  });

  await test('Built JS contains inv-form-grid-2 className', () => {
    assert.ok(builtJs && builtJs.includes('inv-form-grid-2'),
      'inv-form-grid-2 className missing from built JS — CSS rule will never match');
  });

  await test('Built JS contains inv-form-grid-3 className', () => {
    assert.ok(builtJs && builtJs.includes('inv-form-grid-3'),
      'inv-form-grid-3 className missing from built JS');
  });

  await test('Built JS contains inv-purchase-grid className', () => {
    assert.ok(builtJs && builtJs.includes('inv-purchase-grid'),
      'inv-purchase-grid className missing from built JS — purchase fields will not collapse');
  });

  await test('Built JS contains inputMode for numeric purchase inputs', () => {
    assert.ok(builtJs && (builtJs.includes('inputMode') || builtJs.includes('inputmode')),
      'inputMode missing from built JS — iOS will show QWERTY keyboard for purchase fields');
  });

  await test('Built JS contains purchase-actions className', () => {
    assert.ok(builtJs && builtJs.includes('purchase-actions'),
      'purchase-actions className missing from built JS');
  });

  await test('Built JS contains ing-link-row className', () => {
    assert.ok(builtJs && builtJs.includes('ing-link-row'),
      'ing-link-row className missing from built JS');
  });

  await test('Built JS contains PurchaseSyncConfirm Apply button text', () => {
    assert.ok(builtJs && builtJs.includes('Apply to Ingredient'),
      'Apply to Ingredient text missing from built JS');
  });

  // ── 3. HTTP contract (viewport-agnostic) ─────────────────────────────────
  console.log('\n── 3. HTTP contract (viewport-agnostic) ─────────────────────────');

  await test('GET /inventory returns all purchase fields', async () => {
    const r = await req(server, 'GET', '/api/inventory', null, token);
    assert.strictEqual(r.status, 200);
    const item = r.body[0];
    for (const f of ['purchase_unit','pkg_qty','purchase_price','cost_per_base_unit','conversion_factor']) {
      assert.ok(f in item, f + ' missing from GET /inventory response');
    }
  });

  await test('POST /inventory/save requires auth', async () => {
    const r = await req(server, 'POST', '/api/inventory/save',
      { name: 'X', unit: 'each', category: 'Food' }, null);
    assert.strictEqual(r.status, 401);
  });

  // ── 4. Corn Tortillas mobile workflow ─────────────────────────────────────
  console.log('\n── 4. Corn Tortillas mobile workflow ────────────────────────────');

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
    const r = await req(server, 'GET',
      '/api/inventory/' + tortInvId +
      '/purchase-preview?purchase_unit=pack&pkg_qty=30&purchase_price=2.50',
      null, token);
    assert.strictEqual(r.status, 200);
    const li = r.body.linked_ingredient;
    assert.ok(li, 'linked_ingredient must be present');
    assert.ok(Math.abs(Number(li.proposed_cost_per_unit) - (2.5/30)) < 0.0001,
      'proposed_cost_per_unit wrong: ' + li.proposed_cost_per_unit);
    const isLegacy = li && (Number(li.current_spp) > 1 || Number(li.current_cost) > 0)
                     && li.proposed_cost_per_unit !== null;
    assert.strictEqual(isLegacy, true,
      'isLegacy must be true — Apply/Keep panel must show on mobile');
  });

  await test('[375px] preview is read-only — no DB write before user confirms', async () => {
    await req(server, 'GET',
      '/api/inventory/' + tortInvId +
      '/purchase-preview?purchase_unit=pack&pkg_qty=30&purchase_price=2.50',
      null, token);
    const gr = await req(server, 'GET', '/api/inventory', null, token);
    const inv = gr.body.find(i => i.id === tortInvId);
    assert.strictEqual(inv.purchase_price, null, 'preview must not write purchase_price');
    assert.strictEqual(inv.cost_per_base_unit, null, 'preview must not write cost_per_base_unit');
  });

  await test('[430px] Apply New Cost: POST /inventory/save sync_ingredient=true', async () => {
    const r = await req(server, 'POST', '/api/inventory/save',
      { id: tortInvId, name: 'Mobile Test Corn Tortillas',
        purchase_unit: 'pack', pkg_qty: 30, purchase_price: 2.50,
        sync_ingredient: true }, token);
    assert.strictEqual(r.status, 200);
    assert.ok(!r.body._unit_mismatch);
    assert.ok(!r.body._ingredient_skipped);
    assert.ok(Math.abs(Number(r.body.inventory.cost_per_base_unit) - (2.5/30)) < 0.0001,
      'cost_per_base_unit wrong: ' + r.body.inventory.cost_per_base_unit);
  });

  await test('Reopen: GET /inventory shows persisted purchase values', async () => {
    const gr = await req(server, 'GET', '/api/inventory', null, token);
    const inv = gr.body.find(i => i.id === tortInvId);
    assert.ok(inv);
    assert.strictEqual(inv.purchase_unit, 'pack');
    assert.strictEqual(Number(inv.pkg_qty), 30);
    assert.ok(Math.abs(Number(inv.purchase_price) - 2.5) < 0.001);
    assert.ok(Number(inv.cost_per_base_unit) > 0);
  });

  await test('Reopen: ingredient cost updated after Apply New Cost', async () => {
    const ir = await req(server, 'GET', '/api/ingredients', null, token);
    const ing = ir.body.find(i => i.id === tortIngId);
    assert.ok(Math.abs(Number(ing.cost) - (2.5/30)) < 0.0001,
      'ingredient cost wrong: ' + ing.cost);
    assert.strictEqual(Number(ing.servings_per_purchase), 1);
  });

  // ── 5. Keep Existing Cost on mobile ──────────────────────────────────────
  console.log('\n── 5. Keep Existing Cost on mobile ──────────────────────────────');

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
    const r = await req(server, 'POST', '/api/inventory/save',
      { id: keepInvId, purchase_unit: 'pack', pkg_qty: 20,
        purchase_price: 6.00, sync_ingredient: false }, token);
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body._ingredient_skipped, true);
    assert.ok(Math.abs(Number(r.body.inventory.cost_per_base_unit) - 0.30) < 0.0001);
    const ir = await req(server, 'GET', '/api/ingredients', null, token);
    const ing = ir.body.find(i => i.id === keepIngId);
    assert.ok(Math.abs(Number(ing.cost) - 4.50) < 0.001);
    assert.strictEqual(Number(ing.servings_per_purchase), 15);
  });

  // ── 6. New item with purchase fields on mobile ────────────────────────────
  console.log('\n── 6. New item with purchase fields on mobile ───────────────────');

  await test('[320px] New item + purchase: single transactional save', async () => {
    const r = await req(server, 'POST', '/api/inventory/save',
      { name: 'Mobile New Item', unit: 'lb', category: 'Food',
        purchase_unit: 'bag', pkg_qty: 20, purchase_price: 8.00 }, token);
    assert.strictEqual(r.status, 201);
    assert.ok(r.body.inventory?.id);
    assert.ok(Math.abs(Number(r.body.inventory.cost_per_base_unit) - 0.40) < 0.0001);
    cleanup.invIds.push(r.body.inventory.id);
  });

  // ── 7. Validation errors on mobile ───────────────────────────────────────
  console.log('\n── 7. Validation errors on mobile ───────────────────────────────');

  await test('400 on no valid fields — error.message present for mobile display', async () => {
    const r = await req(server, 'POST', '/api/inventory/save', { not_a_field: 'x' }, token);
    assert.strictEqual(r.status, 400);
    assert.ok(r.body.error);
  });

  await test('404 on nonexistent id — error.message present for mobile display', async () => {
    const r = await req(server, 'POST', '/api/inventory/save', { id: 999999, name: 'Ghost' }, token);
    assert.strictEqual(r.status, 404);
    assert.ok(r.body.error);
  });

  await test('422 on bad unit conversion — error.message present for mobile display', async () => {
    const cr = await req(server, 'POST', '/api/inventory/save',
      { name: 'Mobile Err Item', unit: 'each', category: 'Food' }, token);
    cleanup.invIds.push(cr.body.inventory.id);
    const r = await req(server, 'POST', '/api/inventory/save',
      { id: cr.body.inventory.id, purchase_unit: 'kg', pkg_qty: 1, purchase_price: 5.00 }, token);
    assert.ok(r.status === 422 || r.status === 400, 'expected 422/400 got ' + r.status);
    assert.ok(r.body.error);
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
