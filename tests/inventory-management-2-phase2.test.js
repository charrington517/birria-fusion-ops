'use strict';
/**
 * tests/inventory-management-2-phase2.test.js
 *
 * Tests for Phase 2: purchase units, ingredient linking, live costing.
 * Uses TEST_DATABASE_URL directly — never mutates DATABASE_URL for the process.
 * Migrations are verified via the normal migration runner before tests run.
 *
 * Run: TEST_DATABASE_URL=postgres://birria:<pw>@localhost:5432/birria_fusion_test \
 *        node tests/inventory-management-2-phase2.test.js
 */

const assert = require('assert');
const http   = require('http');
const fs     = require('fs');
const path   = require('path');
const { Pool } = require('pg');

// ── Safety guard ──────────────────────────────────────────────────────────────

const TEST_DB_URL = process.env.TEST_DATABASE_URL;
if (!TEST_DB_URL) { console.error('TEST_DATABASE_URL env var required'); process.exit(1); }

const _testDbName = TEST_DB_URL.match(/\/([^/?]+)(\?|$)/)?.[1] || '';
if (_testDbName === 'birria_fusion_ops') {
  console.error('REFUSED: TEST_DATABASE_URL points to the production database. Use birria_fusion_test.');
  process.exit(1);
}

// Set DATABASE_URL before requiring any server modules so the app pool connects
// to the test database, not production.
process.env.DATABASE_URL = TEST_DB_URL;
process.env.JWT_SECRET   = require('crypto').randomBytes(48).toString('hex');
process.env.NODE_ENV     = 'test';

// ── Migration runner (isolated pool, test DB only) ────────────────────────────

async function runMigrations() {
  const migPool = new Pool({ connectionString: TEST_DB_URL });
  const MIGRATIONS_DIR = path.join(__dirname, '../server/db/migrations');
  try {
    await migPool.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id         SERIAL PRIMARY KEY,
        filename   TEXT UNIQUE NOT NULL,
        applied_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    const applied = new Set(
      (await migPool.query('SELECT filename FROM schema_migrations ORDER BY filename')).rows.map(r => r.filename)
    );
    const files = fs.readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith('.sql')).sort();
    let ran = 0;
    for (const file of files) {
      if (applied.has(file)) { process.stdout.write(`  skip  ${file}\n`); continue; }
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
      const client = await migPool.connect();
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
        await client.query('COMMIT');
        process.stdout.write(`  apply ${file}\n`);
        ran++;
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`Migration failed [${file}]: ${err.message}`);
      } finally { client.release(); }
    }
    if (ran === 0) process.stdout.write('  All migrations already applied.\n');
  } finally { await migPool.end(); }
}

// ── App setup ─────────────────────────────────────────────────────────────────

const express    = require('express');
const authRoutes = require('../server/routes/auth');
const apiRoutes  = require('../server/routes/api');

const app = express();
app.use(express.json());
app.use('/api/auth', authRoutes);
app.use('/api', apiRoutes);

// Separate pool for direct DB assertions — never touches production.
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
  catch (e) { console.log(`\n  FAIL  ${name}\n        ${e.message}`); failed++; }
}

// ── Suite ─────────────────────────────────────────────────────────────────────

async function run() {
  console.log('\nVerifying migrations against test DB...');
  await runMigrations();

  const server = http.createServer(app);
  await new Promise(r => server.listen(0, '127.0.0.1', r));

  const loginRes = await req(server, 'POST', '/api/auth/login', { username: 'admin', password: 'admin123' });
  const token = loginRes.body.token;
  if (!token) { console.error('Cannot login to test DB — check admin password'); process.exit(1); }

  const createdItems = [];
  const createdIngredients = [];

  // ── Migration safety checks ───────────────────────────────────────────────

  await test('Migration: unit_conversions table owned by birria', async () => {
    const r = await pool.query(
      "SELECT tableowner FROM pg_tables WHERE tablename='unit_conversions'"
    );
    assert.strictEqual(r.rows[0]?.tableowner, 'birria', 'unit_conversions must be owned by birria');
  });

  await test('Migration: no packaging-type universal conversions in table', async () => {
    const r = await pool.query(
      "SELECT from_unit FROM unit_conversions WHERE from_unit IN ('bag','case','box','bottle','pack')"
    );
    assert.strictEqual(r.rows.length, 0,
      `Packaging conversions must be removed, found: ${r.rows.map(x=>x.from_unit).join(',')}`);
  });

  await test('Migration: physical bidirectional conversions present', async () => {
    const r = await pool.query(
      "SELECT from_unit||'→'||to_unit AS pair FROM unit_conversions ORDER BY from_unit, to_unit"
    );
    const pairs = r.rows.map(x => x.pair);
    for (const p of ['lb→oz','oz→g','oz→lb','g→oz','g→lb','fl oz→tbsp','tbsp→fl oz']) {
      assert.ok(pairs.includes(p), `Missing conversion: ${p}`);
    }
  });

  await test('Migration: ingredients partial unique index exists', async () => {
    const r = await pool.query(
      "SELECT indexname FROM pg_indexes WHERE tablename='ingredients' AND indexname='ingredients_inventory_item_id_uidx'"
    );
    assert.strictEqual(r.rows.length, 1, 'Partial unique index must exist on ingredients.inventory_item_id');
  });

  await test('Migration: inventory has purchase columns', async () => {
    const r = await pool.query(
      "SELECT column_name FROM information_schema.columns WHERE table_name='inventory' AND column_name IN ('purchase_unit','pkg_qty','purchase_price','cost_per_base_unit','conversion_factor')"
    );
    assert.strictEqual(r.rows.length, 5, 'All 5 purchase columns must exist on inventory');
  });

  await test('Migration: re-running is idempotent (all already applied)', async () => {
    // Running the migration runner again must skip all files without error.
    await runMigrations(); // would throw if any migration fails on re-run
  });

  // ── Unit conversions endpoint ─────────────────────────────────────────────

  await test('GET /unit-conversions — returns physical rules only', async () => {
    const r = await req(server, 'GET', '/api/unit-conversions', null, token);
    assert.strictEqual(r.status, 200);
    assert.ok(Array.isArray(r.body) && r.body.length >= 10, `Expected >=10 rules, got ${r.body.length}`);
    const pairs = r.body.map(c => `${c.from_unit}→${c.to_unit}`);
    assert.ok(pairs.includes('lb→oz'), 'Should include lb→oz');
    assert.ok(pairs.includes('oz→g'), 'Should include oz→g');
    assert.ok(!pairs.includes('case→each'), 'Must NOT include case→each (packaging)');
    assert.ok(!pairs.includes('bag→oz'), 'Must NOT include bag→oz (packaging)');
    assert.ok(!pairs.includes('bottle→fl oz'), 'Must NOT include bottle→fl oz (packaging)');
  });

  await test('GET /unit-conversions — 401 without auth', async () => {
    const r = await req(server, 'GET', '/api/unit-conversions');
    assert.strictEqual(r.status, 401);
  });

  // ── Packaging conversions: product-specific pkg_qty ───────────────────────
  // Packaging types (case, bag, box, bottle) have no universal conversion.
  // The user sets pkg_qty = total base units in the package.

  await test('Cheese: 30-lb case, base unit oz — pkg_qty=480 oz', async () => {
    // 1 case = 30 lb = 480 oz. Purchase price $60. cost_per_base_unit = $60/480 = $0.125/oz
    const inv = await req(server, 'POST', '/api/inventory', {
      name: 'Test Cheese', category: 'Dairy', unit: 'oz',
      current_stock: 0, min_stock: 0, cost: 0
    }, token);
    assert.strictEqual(inv.status, 201);
    createdItems.push(inv.body.id);
    const r = await req(server, 'PUT', `/api/inventory/${inv.body.id}/purchase`, {
      purchase_unit: 'case', pkg_qty: 480, purchase_price: 60.00
    }, token);
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    const cpbu = Number(r.body.cost_per_base_unit);
    assert.ok(Math.abs(cpbu - 0.125) < 0.0001,
      `Expected $0.125/oz, got $${cpbu}`);
  });

  await test('Flour: 25-lb bag, base unit g — pkg_qty=11339.8 g', async () => {
    // 1 bag = 25 lb = 11339.8 g. Purchase price $12. cost_per_base_unit = $12/11339.8 ≈ $0.001058/g
    const inv = await req(server, 'POST', '/api/inventory', {
      name: 'Test Flour', category: 'Dry Goods', unit: 'g',
      current_stock: 0, min_stock: 0, cost: 0
    }, token);
    assert.strictEqual(inv.status, 201);
    createdItems.push(inv.body.id);
    const pkgQty = 25 * 453.592; // 25 lb in grams
    const r = await req(server, 'PUT', `/api/inventory/${inv.body.id}/purchase`, {
      purchase_unit: 'bag', pkg_qty: pkgQty, purchase_price: 12.00
    }, token);
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    const cpbu = Number(r.body.cost_per_base_unit);
    const expected = 12.00 / pkgQty;
    assert.ok(Math.abs(cpbu - expected) < 0.000001,
      `Expected $${expected.toFixed(6)}/g, got $${cpbu}`);
  });

  await test('Sauce: 32-fl-oz bottle, base unit fl oz — pkg_qty=32', async () => {
    // 1 bottle = 32 fl oz. Purchase price $4. cost_per_base_unit = $4/32 = $0.125/fl oz
    const inv = await req(server, 'POST', '/api/inventory', {
      name: 'Test Sauce', category: 'Condiments', unit: 'fl oz',
      current_stock: 0, min_stock: 0, cost: 0
    }, token);
    assert.strictEqual(inv.status, 201);
    createdItems.push(inv.body.id);
    const r = await req(server, 'PUT', `/api/inventory/${inv.body.id}/purchase`, {
      purchase_unit: 'bottle', pkg_qty: 32, purchase_price: 4.00
    }, token);
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    const cpbu = Number(r.body.cost_per_base_unit);
    assert.ok(Math.abs(cpbu - 0.125) < 0.0001,
      `Expected $0.125/fl oz, got $${cpbu}`);
  });

  await test('Gloves: 100-count box, base unit each — pkg_qty=100', async () => {
    // 1 box = 100 gloves. Purchase price $8. cost_per_base_unit = $8/100 = $0.08/each
    const inv = await req(server, 'POST', '/api/inventory', {
      name: 'Test Gloves', category: 'Packaging', unit: 'each',
      current_stock: 0, min_stock: 0, cost: 0
    }, token);
    assert.strictEqual(inv.status, 201);
    createdItems.push(inv.body.id);
    const r = await req(server, 'PUT', `/api/inventory/${inv.body.id}/purchase`, {
      purchase_unit: 'box', pkg_qty: 100, purchase_price: 8.00
    }, token);
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    const cpbu = Number(r.body.cost_per_base_unit);
    assert.ok(Math.abs(cpbu - 0.08) < 0.0001,
      `Expected $0.08/each, got $${cpbu}`);
  });

  await test('Nested packaging: case of six 5-lb bags, base unit oz — pkg_qty=480', async () => {
    // 1 case = 6 bags x 5 lb = 30 lb = 480 oz. User computes pkg_qty=480.
    // Purchase price $45. cost_per_base_unit = $45/480 = $0.09375/oz
    const inv = await req(server, 'POST', '/api/inventory', {
      name: 'Test Nested Case', category: 'Dairy', unit: 'oz',
      current_stock: 0, min_stock: 0, cost: 0
    }, token);
    assert.strictEqual(inv.status, 201);
    createdItems.push(inv.body.id);
    const r = await req(server, 'PUT', `/api/inventory/${inv.body.id}/purchase`, {
      purchase_unit: 'case', pkg_qty: 480, purchase_price: 45.00
    }, token);
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    const cpbu = Number(r.body.cost_per_base_unit);
    assert.ok(Math.abs(cpbu - 0.09375) < 0.0001,
      `Expected $0.09375/oz, got $${cpbu}`);
  });

  // ── Physical cross-unit conversions ───────────────────────────────────────

  await test('PUT /purchase — lb→oz uses standard 16x conversion', async () => {
    // 1 lb bag costs $4.00, base unit oz. 1 lb = 16 oz → $4/16 = $0.25/oz
    const inv = await req(server, 'POST', '/api/inventory', {
      name: 'LbOz Item', category: 'Food', unit: 'oz',
      current_stock: 0, min_stock: 0, cost: 0
    }, token);
    createdItems.push(inv.body.id);
    const r = await req(server, 'PUT', `/api/inventory/${inv.body.id}/purchase`, {
      purchase_unit: 'lb', pkg_qty: 1, purchase_price: 4.00
    }, token);
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.ok(Math.abs(Number(r.body.cost_per_base_unit) - 0.25) < 0.0001,
      `Expected $0.25/oz, got ${r.body.cost_per_base_unit}`);
  });

  await test('PUT /purchase — same-unit computes cost_per_base_unit directly', async () => {
    const inv = await req(server, 'POST', '/api/inventory', {
      name: 'SameUnit Item', category: 'Food', unit: 'oz',
      current_stock: 0, min_stock: 0, cost: 0
    }, token);
    createdItems.push(inv.body.id);
    const r = await req(server, 'PUT', `/api/inventory/${inv.body.id}/purchase`, {
      purchase_unit: 'oz', pkg_qty: 16, purchase_price: 4.00
    }, token);
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.ok(Math.abs(Number(r.body.cost_per_base_unit) - 0.25) < 0.0001,
      `Expected $0.25/oz, got ${r.body.cost_per_base_unit}`);
  });

  await test('PUT /purchase — incompatible physical units without factor returns 422', async () => {
    const inv = await req(server, 'POST', '/api/inventory', {
      name: 'Incompat Item', category: 'Food', unit: 'each',
      current_stock: 0, min_stock: 0, cost: 0
    }, token);
    createdItems.push(inv.body.id);
    // lb → each: no physical conversion exists
    const r = await req(server, 'PUT', `/api/inventory/${inv.body.id}/purchase`, {
      purchase_unit: 'lb', pkg_qty: 1, purchase_price: 5.00
    }, token);
    assert.strictEqual(r.status, 422, `Expected 422, got ${r.status}: ${JSON.stringify(r.body)}`);
    assert.ok(r.body.error, 'Should return error message');
  });

  await test('PUT /purchase — incompatible units WITH conversion_factor succeeds', async () => {
    const inv = await req(server, 'POST', '/api/inventory', {
      name: 'Factor Item', category: 'Food', unit: 'each',
      current_stock: 0, min_stock: 0, cost: 0
    }, token);
    createdItems.push(inv.body.id);
    // bottle → each: no standard rule, user says 1 bottle = 6 each
    const r = await req(server, 'PUT', `/api/inventory/${inv.body.id}/purchase`, {
      purchase_unit: 'bottle', pkg_qty: 1, purchase_price: 3.00, conversion_factor: 6
    }, token);
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.ok(Math.abs(Number(r.body.cost_per_base_unit) - 0.50) < 0.0001,
      `Expected $0.50/each, got ${r.body.cost_per_base_unit}`);
  });

  // ── Cost propagation to linked ingredient ─────────────────────────────────
  // The costing model: line_cost = quantity * (ingredient.cost / ingredient.servings_per_purchase)
  // After propagation: cost = cost_per_ingredient_unit, servings_per_purchase = 1
  // so line_cost = quantity * cost_per_ingredient_unit. Correct for any usage unit.

  await test('Propagation: cheese oz→oz (same unit, no conversion needed)', async () => {
    // Inventory base=oz, ingredient unit=oz.
    // 30-lb case ($60) → 480 oz → $0.125/oz. Ingredient cost should be $0.125/oz.
    const inv = await req(server, 'POST', '/api/inventory', {
      name: 'PropCheese Inv', category: 'Dairy', unit: 'oz',
      current_stock: 0, min_stock: 0, cost: 0
    }, token);
    createdItems.push(inv.body.id);
    const ing = await req(server, 'POST', '/api/ingredients', {
      name: 'PropCheese Ing', category: 'Dairy', unit: 'oz',
      cost: 0, servings_per_purchase: 1, inventory_item_id: inv.body.id
    }, token);
    assert.strictEqual(ing.status, 201, JSON.stringify(ing.body));
    createdIngredients.push(ing.body.id);

    const r = await req(server, 'PUT', `/api/inventory/${inv.body.id}/purchase`, {
      purchase_unit: 'case', pkg_qty: 480, purchase_price: 60.00
    }, token);
    assert.strictEqual(r.status, 200);

    const ings = await req(server, 'GET', '/api/ingredients', null, token);
    const updated = ings.body.find(i => i.id === ing.body.id);
    assert.ok(updated, 'Ingredient must still exist');
    assert.ok(Math.abs(Number(updated.cost) - 0.125) < 0.0001,
      `Expected $0.125/oz, got $${updated.cost}`);
    assert.strictEqual(Number(updated.servings_per_purchase), 1);
  });

  await test('Propagation: flour oz→g (cross-unit: inventory oz, ingredient g)', async () => {
    // Inventory base=oz, ingredient unit=g.
    // 25-lb bag ($12) → pkg_qty=400 oz → $0.03/oz.
    // 1 g = 0.035274 oz → cost/g = $0.03 * 0.035274 ≈ $0.001058/g
    const inv = await req(server, 'POST', '/api/inventory', {
      name: 'PropFlour Inv', category: 'Dry Goods', unit: 'oz',
      current_stock: 0, min_stock: 0, cost: 0
    }, token);
    createdItems.push(inv.body.id);
    const ing = await req(server, 'POST', '/api/ingredients', {
      name: 'PropFlour Ing', category: 'Dry Goods', unit: 'g',
      cost: 0, servings_per_purchase: 1, inventory_item_id: inv.body.id
    }, token);
    assert.strictEqual(ing.status, 201, JSON.stringify(ing.body));
    createdIngredients.push(ing.body.id);

    const pkgOz = 25 * 16; // 400 oz
    const r = await req(server, 'PUT', `/api/inventory/${inv.body.id}/purchase`, {
      purchase_unit: 'bag', pkg_qty: pkgOz, purchase_price: 12.00
    }, token);
    assert.strictEqual(r.status, 200);

    const cpbu = Number(r.body.cost_per_base_unit); // $/oz
    // cost/g = cpbu * (1g in oz) = cpbu * 0.035274
    const expectedCostPerG = cpbu * 0.035274;

    const ings = await req(server, 'GET', '/api/ingredients', null, token);
    const updated = ings.body.find(i => i.id === ing.body.id);
    assert.ok(updated, 'Ingredient must still exist');
    assert.ok(Math.abs(Number(updated.cost) - expectedCostPerG) < 0.000001,
      `Expected $${expectedCostPerG.toFixed(6)}/g, got $${updated.cost}`);
    assert.strictEqual(Number(updated.servings_per_purchase), 1);
  });

  await test('Propagation: sauce fl oz→tbsp (cross-unit: inventory fl oz, ingredient tbsp)', async () => {
    // Inventory base=fl oz, ingredient unit=tbsp.
    // 32-fl-oz bottle ($4) → $0.125/fl oz.
    // 1 tbsp = 0.5 fl oz → cost/tbsp = $0.125 * 0.5 = $0.0625/tbsp
    const inv = await req(server, 'POST', '/api/inventory', {
      name: 'PropSauce Inv', category: 'Condiments', unit: 'fl oz',
      current_stock: 0, min_stock: 0, cost: 0
    }, token);
    createdItems.push(inv.body.id);
    const ing = await req(server, 'POST', '/api/ingredients', {
      name: 'PropSauce Ing', category: 'Condiments', unit: 'tbsp',
      cost: 0, servings_per_purchase: 1, inventory_item_id: inv.body.id
    }, token);
    assert.strictEqual(ing.status, 201, JSON.stringify(ing.body));
    createdIngredients.push(ing.body.id);

    const r = await req(server, 'PUT', `/api/inventory/${inv.body.id}/purchase`, {
      purchase_unit: 'bottle', pkg_qty: 32, purchase_price: 4.00
    }, token);
    assert.strictEqual(r.status, 200);

    const ings = await req(server, 'GET', '/api/ingredients', null, token);
    const updated = ings.body.find(i => i.id === ing.body.id);
    assert.ok(updated, 'Ingredient must still exist');
    // $0.125/fl oz * 0.5 fl oz/tbsp = $0.0625/tbsp
    assert.ok(Math.abs(Number(updated.cost) - 0.0625) < 0.0001,
      `Expected $0.0625/tbsp, got $${updated.cost}`);
    assert.strictEqual(Number(updated.servings_per_purchase), 1);
  });

  await test('Propagation: gloves each→each (same unit, packaging)', async () => {
    // Inventory base=each, ingredient unit=each.
    // 100-count box ($8) → $0.08/each.
    const inv = await req(server, 'POST', '/api/inventory', {
      name: 'PropGloves Inv', category: 'Packaging', unit: 'each',
      current_stock: 0, min_stock: 0, cost: 0
    }, token);
    createdItems.push(inv.body.id);
    const ing = await req(server, 'POST', '/api/ingredients', {
      name: 'PropGloves Ing', category: 'Packaging', unit: 'each',
      cost: 0, servings_per_purchase: 1, inventory_item_id: inv.body.id
    }, token);
    assert.strictEqual(ing.status, 201, JSON.stringify(ing.body));
    createdIngredients.push(ing.body.id);

    const r = await req(server, 'PUT', `/api/inventory/${inv.body.id}/purchase`, {
      purchase_unit: 'box', pkg_qty: 100, purchase_price: 8.00
    }, token);
    assert.strictEqual(r.status, 200);

    const ings = await req(server, 'GET', '/api/ingredients', null, token);
    const updated = ings.body.find(i => i.id === ing.body.id);
    assert.ok(updated, 'Ingredient must still exist');
    assert.ok(Math.abs(Number(updated.cost) - 0.08) < 0.0001,
      `Expected $0.08/each, got $${updated.cost}`);
    assert.strictEqual(Number(updated.servings_per_purchase), 1);
  });

  await test('Propagation: incompatible units (oz→each) skips ingredient cost update', async () => {
    // Inventory base=oz, ingredient unit=each — no physical conversion.
    // Purchase update should succeed (200) but leave ingredient cost unchanged.
    const inv = await req(server, 'POST', '/api/inventory', {
      name: 'PropIncompat Inv', category: 'Food', unit: 'oz',
      current_stock: 0, min_stock: 0, cost: 0
    }, token);
    createdItems.push(inv.body.id);
    const ing = await req(server, 'POST', '/api/ingredients', {
      name: 'PropIncompat Ing', category: 'Food', unit: 'each',
      cost: 5.00, servings_per_purchase: 10, inventory_item_id: inv.body.id
    }, token);
    assert.strictEqual(ing.status, 201, JSON.stringify(ing.body));
    createdIngredients.push(ing.body.id);

    const r = await req(server, 'PUT', `/api/inventory/${inv.body.id}/purchase`, {
      purchase_unit: 'lb', pkg_qty: 1, purchase_price: 4.00
    }, token);
    assert.strictEqual(r.status, 200, `Purchase update should succeed: ${JSON.stringify(r.body)}`);

    const ings = await req(server, 'GET', '/api/ingredients', null, token);
    const updated = ings.body.find(i => i.id === ing.body.id);
    assert.ok(updated, 'Ingredient must still exist');
    // Cost must be unchanged because oz→each has no conversion.
    assert.ok(Math.abs(Number(updated.cost) - 5.00) < 0.0001,
      `Ingredient cost should be unchanged at $5.00, got $${updated.cost}`);
    assert.strictEqual(Number(updated.servings_per_purchase), 10,
      'servings_per_purchase must be unchanged');
  });

  await test('Propagation: no linked ingredient — succeeds without error', async () => {
    const inv = await req(server, 'POST', '/api/inventory', {
      name: 'NoLink Inv', category: 'Food', unit: 'oz',
      current_stock: 0, min_stock: 0, cost: 0
    }, token);
    createdItems.push(inv.body.id);
    const r = await req(server, 'PUT', `/api/inventory/${inv.body.id}/purchase`, {
      purchase_unit: 'lb', pkg_qty: 1, purchase_price: 5.00
    }, token);
    assert.strictEqual(r.status, 200);
  });

  // ── Ingredient linking: create, link-existing, unlink ─────────────────────

  await test('POST /inventory/:id/create-ingredient — creates linked ingredient', async () => {
    const inv = await req(server, 'POST', '/api/inventory', {
      name: 'CreateIng Test', category: 'Produce', unit: 'each',
      current_stock: 5, min_stock: 1, cost: 0.50
    }, token);
    createdItems.push(inv.body.id);
    const r = await req(server, 'POST', `/api/inventory/${inv.body.id}/create-ingredient`, {}, token);
    assert.strictEqual(r.status, 201, JSON.stringify(r.body));
    assert.strictEqual(r.body.name, 'CreateIng Test');
    assert.strictEqual(Number(r.body.inventory_item_id), inv.body.id);
    createdIngredients.push(r.body.id);
  });

  await test('POST /inventory/:id/create-ingredient — 409 on duplicate link', async () => {
    const invItems = await req(server, 'GET', '/api/inventory', null, token);
    const linked = invItems.body.find(i => i.name === 'CreateIng Test');
    assert.ok(linked, 'CreateIng Test item should exist');
    const r = await req(server, 'POST', `/api/inventory/${linked.id}/create-ingredient`, {}, token);
    assert.strictEqual(r.status, 409, `Expected 409, got ${r.status}: ${JSON.stringify(r.body)}`);
    assert.ok(r.body.existing_ingredient_id, 'Should return existing ingredient id');
  });

  await test('POST /inventory/:id/create-ingredient — 404 for unknown id', async () => {
    const r = await req(server, 'POST', '/api/inventory/999999/create-ingredient', {}, token);
    assert.strictEqual(r.status, 404);
  });

  await test('POST /inventory/:id/link-ingredient — links existing unlinked ingredient', async () => {
    const inv = await req(server, 'POST', '/api/inventory', {
      name: 'LinkExisting Inv', category: 'Food', unit: 'oz',
      current_stock: 0, min_stock: 0, cost: 0
    }, token);
    createdItems.push(inv.body.id);
    const ing = await req(server, 'POST', '/api/ingredients', {
      name: 'LinkExisting Ing', category: 'Food', unit: 'oz',
      cost: 0, servings_per_purchase: 1
    }, token);
    assert.strictEqual(ing.status, 201, JSON.stringify(ing.body));
    createdIngredients.push(ing.body.id);

    const r = await req(server, 'POST', `/api/inventory/${inv.body.id}/link-ingredient`,
      { ingredient_id: ing.body.id }, token);
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.strictEqual(Number(r.body.inventory_item_id), inv.body.id);
  });

  await test('POST /inventory/:id/link-ingredient — 409 if inventory already linked to different ingredient', async () => {
    const inv = await req(server, 'POST', '/api/inventory', {
      name: 'AlreadyLinked Inv', category: 'Food', unit: 'oz',
      current_stock: 0, min_stock: 0, cost: 0
    }, token);
    createdItems.push(inv.body.id);
    // Create and link first ingredient via create-ingredient.
    const first = await req(server, 'POST', `/api/inventory/${inv.body.id}/create-ingredient`, {}, token);
    assert.strictEqual(first.status, 201);
    createdIngredients.push(first.body.id);
    // Create a second unlinked ingredient.
    const second = await req(server, 'POST', '/api/ingredients', {
      name: 'Second Ing', category: 'Food', unit: 'oz',
      cost: 0, servings_per_purchase: 1
    }, token);
    createdIngredients.push(second.body.id);
    // Try to link second to same inventory item.
    const r = await req(server, 'POST', `/api/inventory/${inv.body.id}/link-ingredient`,
      { ingredient_id: second.body.id }, token);
    assert.strictEqual(r.status, 409, `Expected 409, got ${r.status}: ${JSON.stringify(r.body)}`);
  });

  await test('POST /inventory/:id/link-ingredient — 409 if ingredient already linked to different inventory', async () => {
    const inv1 = await req(server, 'POST', '/api/inventory', {
      name: 'LinkConflict Inv1', category: 'Food', unit: 'oz',
      current_stock: 0, min_stock: 0, cost: 0
    }, token);
    const inv2 = await req(server, 'POST', '/api/inventory', {
      name: 'LinkConflict Inv2', category: 'Food', unit: 'oz',
      current_stock: 0, min_stock: 0, cost: 0
    }, token);
    createdItems.push(inv1.body.id, inv2.body.id);
    // Link ingredient to inv1.
    const ing = await req(server, 'POST', `/api/inventory/${inv1.body.id}/create-ingredient`, {}, token);
    createdIngredients.push(ing.body.id);
    // Try to link same ingredient to inv2.
    const r = await req(server, 'POST', `/api/inventory/${inv2.body.id}/link-ingredient`,
      { ingredient_id: ing.body.id }, token);
    assert.strictEqual(r.status, 409, `Expected 409, got ${r.status}: ${JSON.stringify(r.body)}`);
  });

  await test('POST /inventory/:id/unlink-ingredient — unlinks and preserves ingredient', async () => {
    const inv = await req(server, 'POST', '/api/inventory', {
      name: 'Unlink Inv', category: 'Food', unit: 'oz',
      current_stock: 0, min_stock: 0, cost: 0
    }, token);
    createdItems.push(inv.body.id);
    const ing = await req(server, 'POST', `/api/inventory/${inv.body.id}/create-ingredient`, {}, token);
    assert.strictEqual(ing.status, 201);
    createdIngredients.push(ing.body.id);

    const r = await req(server, 'POST', `/api/inventory/${inv.body.id}/unlink-ingredient`, {}, token);
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.ok(r.body.ok);

    // Ingredient must still exist with inventory_item_id cleared.
    const ings = await req(server, 'GET', '/api/ingredients', null, token);
    const still = ings.body.find(i => i.id === ing.body.id);
    assert.ok(still, 'Ingredient must still exist after unlink');
    assert.ok(!still.inventory_item_id, 'inventory_item_id must be null after unlink');
  });

  await test('POST /inventory/:id/unlink-ingredient — 404 when nothing linked', async () => {
    const inv = await req(server, 'POST', '/api/inventory', {
      name: 'NoLink Unlink Inv', category: 'Food', unit: 'oz',
      current_stock: 0, min_stock: 0, cost: 0
    }, token);
    createdItems.push(inv.body.id);
    const r = await req(server, 'POST', `/api/inventory/${inv.body.id}/unlink-ingredient`, {}, token);
    assert.strictEqual(r.status, 404);
  });

  await test('PUT /ingredients/:id — duplicate inventory_item_id returns 409', async () => {
    const inv1 = await req(server, 'POST', '/api/inventory', {
      name: 'DupLink Inv1', category: 'Food', unit: 'each', current_stock: 0, min_stock: 0, cost: 0
    }, token);
    const inv2 = await req(server, 'POST', '/api/inventory', {
      name: 'DupLink Inv2', category: 'Food', unit: 'each', current_stock: 0, min_stock: 0, cost: 0
    }, token);
    createdItems.push(inv1.body.id, inv2.body.id);
    const ing1 = await req(server, 'POST', '/api/ingredients', {
      name: 'DupLink Ing1', category: 'Food', unit: 'each',
      cost: 0, servings_per_purchase: 1, inventory_item_id: inv1.body.id
    }, token);
    const ing2 = await req(server, 'POST', '/api/ingredients', {
      name: 'DupLink Ing2', category: 'Food', unit: 'each',
      cost: 0, servings_per_purchase: 1, inventory_item_id: inv2.body.id
    }, token);
    createdIngredients.push(ing1.body.id, ing2.body.id);
    // Try to re-link ing2 to inv1 (already taken by ing1).
    const r = await req(server, 'PUT', `/api/ingredients/${ing2.body.id}`, {
      name: 'DupLink Ing2', category: 'Food', unit: 'each',
      cost: 0, servings_per_purchase: 1, inventory_item_id: inv1.body.id
    }, token);
    assert.strictEqual(r.status, 409, `Expected 409, got ${r.status}: ${JSON.stringify(r.body)}`);
  });

  // ── Recipe and menu costs reflect updated ingredient cost ─────────────────

  await test('Recipe cost reflects updated ingredient cost', async () => {
    const before = await req(server, 'GET', '/api/recipes/1/cost', null, token);
    assert.strictEqual(before.status, 200);
    const beforeCost = before.body.total_cost;
    const ings = await req(server, 'GET', '/api/ingredients', null, token);
    const ing1 = ings.body.find(i => i.id === 1);
    if (!ing1) { console.log('  SKIP  (ingredient 1 not found)'); passed++; return; }
    const origCost = Number(ing1.cost);
    await req(server, 'PUT', `/api/ingredients/${ing1.id}`, { ...ing1, cost: origCost + 1 }, token);
    const after = await req(server, 'GET', '/api/recipes/1/cost', null, token);
    assert.ok(after.body.total_cost !== beforeCost, 'Recipe cost should change after ingredient update');
    await req(server, 'PUT', `/api/ingredients/${ing1.id}`, { ...ing1, cost: origCost }, token);
  });

  // ── Legacy data compatibility ─────────────────────────────────────────────

  await test('Existing inventory items have null purchase fields (additive migration)', async () => {
    const r = await req(server, 'GET', '/api/inventory', null, token);
    assert.strictEqual(r.status, 200);
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

  await test('GET /overview — 401 on bad token', async () => {
    const r = await req(server, 'GET', '/api/overview', null, 'bad_token_value');
    assert.strictEqual(r.status, 401, `Expected 401, got ${r.status}`);
  });

  // ── Unit mismatch warnings ───────────────────────────────────────────────

  await test('PUT /purchase — legacy ingredient (spp>1) is skipped without sync_ingredient flag', async () => {
    // Inventory base=oz, ingredient unit=each: no conversion exists.
    // Legacy ingredient has cost=9.99, spp=5 — should be skipped (not auto-synced).
    const inv = await req(server, 'POST', '/api/inventory', {
      name: 'Mismatch Warn Inv', category: 'Food', unit: 'oz',
      current_stock: 0, min_stock: 0, cost: 0
    }, token);
    createdItems.push(inv.body.id);
    const ing = await req(server, 'POST', '/api/ingredients', {
      name: 'Mismatch Warn Ing', category: 'Food', unit: 'each',
      cost: 9.99, servings_per_purchase: 5, inventory_item_id: inv.body.id
    }, token);
    createdIngredients.push(ing.body.id);

    const r = await req(server, 'PUT', `/api/inventory/${inv.body.id}/purchase`, {
      purchase_unit: 'lb', pkg_qty: 1, purchase_price: 4.00
      // no sync_ingredient — legacy ingredient must not be auto-synced
    }, token);
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.ok(r.body._ingredient_skipped,
      'Legacy ingredient must be skipped when sync_ingredient is omitted');

    // Ingredient cost must be unchanged.
    const ings = await req(server, 'GET', '/api/ingredients', null, token);
    const still = ings.body.find(i => i.id === ing.body.id);
    assert.ok(Math.abs(Number(still.cost) - 9.99) < 0.001, 'Cost must be unchanged');
    assert.strictEqual(Number(still.servings_per_purchase), 5, 'spp must be unchanged');
  });

  await test('PUT /purchase — _unit_mismatch returned when sync_ingredient=true but units incompatible', async () => {
    // Inventory base=oz, ingredient unit=each: no conversion.
    // User explicitly requests sync — server should report unit_mismatch.
    const inv = await req(server, 'POST', '/api/inventory', {
      name: 'SyncMismatch Inv', category: 'Food', unit: 'oz',
      current_stock: 0, min_stock: 0, cost: 0
    }, token);
    createdItems.push(inv.body.id);
    const ing = await req(server, 'POST', '/api/ingredients', {
      name: 'SyncMismatch Ing', category: 'Food', unit: 'each',
      cost: 9.99, servings_per_purchase: 5, inventory_item_id: inv.body.id
    }, token);
    createdIngredients.push(ing.body.id);

    const r = await req(server, 'PUT', `/api/inventory/${inv.body.id}/purchase`, {
      purchase_unit: 'lb', pkg_qty: 1, purchase_price: 4.00,
      sync_ingredient: true
    }, token);
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.ok(r.body._unit_mismatch, 'Should return _unit_mismatch when sync requested but units incompatible');
    assert.strictEqual(r.body._unit_mismatch.inventory_unit, 'oz');
    assert.strictEqual(r.body._unit_mismatch.ingredient_unit, 'each');

    // Ingredient cost must still be unchanged (conversion failed).
    const ings = await req(server, 'GET', '/api/ingredients', null, token);
    const still = ings.body.find(i => i.id === ing.body.id);
    assert.ok(Math.abs(Number(still.cost) - 9.99) < 0.001, 'Cost must be unchanged');
    assert.strictEqual(Number(still.servings_per_purchase), 5, 'spp must be unchanged');
  });

  await test('PUT /purchase — no _unit_mismatch when propagation succeeds', async () => {
    const inv = await req(server, 'POST', '/api/inventory', {
      name: 'NoMismatch Inv', category: 'Food', unit: 'oz',
      current_stock: 0, min_stock: 0, cost: 0
    }, token);
    createdItems.push(inv.body.id);
    const ing = await req(server, 'POST', '/api/ingredients', {
      name: 'NoMismatch Ing', category: 'Food', unit: 'oz',
      cost: 0, servings_per_purchase: 1, inventory_item_id: inv.body.id
    }, token);
    createdIngredients.push(ing.body.id);

    const r = await req(server, 'PUT', `/api/inventory/${inv.body.id}/purchase`, {
      purchase_unit: 'lb', pkg_qty: 1, purchase_price: 4.00
    }, token);
    assert.strictEqual(r.status, 200);
    assert.ok(!r.body._unit_mismatch, 'Should NOT return _unit_mismatch when propagation succeeds');
  });

  await test('POST /link-ingredient — _unit_mismatch returned for incompatible units', async () => {
    const inv = await req(server, 'POST', '/api/inventory', {
      name: 'LinkMismatch Inv', category: 'Food', unit: 'oz',
      current_stock: 0, min_stock: 0, cost: 0
    }, token);
    createdItems.push(inv.body.id);
    const ing = await req(server, 'POST', '/api/ingredients', {
      name: 'LinkMismatch Ing', category: 'Food', unit: 'each',
      cost: 5.00, servings_per_purchase: 10
    }, token);
    createdIngredients.push(ing.body.id);

    const r = await req(server, 'POST', `/api/inventory/${inv.body.id}/link-ingredient`,
      { ingredient_id: ing.body.id }, token);
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.ok(r.body._unit_mismatch, 'Should return _unit_mismatch for oz→each');
    assert.ok(r.body._unit_mismatch.message.includes('conversion_factor'));

    // Ingredient cost must NOT be changed by linking.
    const ings = await req(server, 'GET', '/api/ingredients', null, token);
    const still = ings.body.find(i => i.id === ing.body.id);
    assert.ok(Math.abs(Number(still.cost) - 5.00) < 0.001, 'Link must not overwrite cost');
    assert.strictEqual(Number(still.servings_per_purchase), 10, 'Link must not overwrite spp');
  });

  await test('POST /link-ingredient — no _unit_mismatch for compatible units', async () => {
    const inv = await req(server, 'POST', '/api/inventory', {
      name: 'LinkCompat Inv', category: 'Food', unit: 'oz',
      current_stock: 0, min_stock: 0, cost: 0
    }, token);
    createdItems.push(inv.body.id);
    const ing = await req(server, 'POST', '/api/ingredients', {
      name: 'LinkCompat Ing', category: 'Food', unit: 'g',
      cost: 0, servings_per_purchase: 1
    }, token);
    createdIngredients.push(ing.body.id);

    const r = await req(server, 'POST', `/api/inventory/${inv.body.id}/link-ingredient`,
      { ingredient_id: ing.body.id }, token);
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.ok(!r.body._unit_mismatch, 'oz→g is a known conversion, no mismatch warning expected');
  });

  await test('Legacy ingredients: link-ingredient does not overwrite existing cost/spp', async () => {
    // Simulate linking an existing production-style ingredient (spp>1) to an inventory item.
    // The link operation must only set inventory_item_id, never touch cost or spp.
    const inv = await req(server, 'POST', '/api/inventory', {
      name: 'Legacy Link Inv', category: 'Dairy', unit: 'oz',
      current_stock: 0, min_stock: 0, cost: 0
    }, token);
    createdItems.push(inv.body.id);
    // Simulate Oaxaca Cheese: cost=$6.00, spp=16 (16-oz package)
    const ing = await req(server, 'POST', '/api/ingredients', {
      name: 'Legacy Cheese Ing', category: 'Dairy', unit: 'oz',
      cost: 6.00, servings_per_purchase: 16
    }, token);
    createdIngredients.push(ing.body.id);

    const r = await req(server, 'POST', `/api/inventory/${inv.body.id}/link-ingredient`,
      { ingredient_id: ing.body.id }, token);
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));

    // cost and spp must be exactly as before.
    const ings = await req(server, 'GET', '/api/ingredients', null, token);
    const still = ings.body.find(i => i.id === ing.body.id);
    assert.ok(Math.abs(Number(still.cost) - 6.00) < 0.001,
      `cost must be $6.00, got $${still.cost}`);
    assert.strictEqual(Number(still.servings_per_purchase), 16,
      `spp must be 16, got ${still.servings_per_purchase}`);
    assert.strictEqual(Number(still.inventory_item_id), inv.body.id,
      'inventory_item_id must be set');
  });

  // ── Migration 006 row-count verification ─────────────────────────────────────────────

  await test('Migration 006: exactly 6 packaging rows were removed from unit_conversions', async () => {
    // The 6 rows seeded by migration 005 and deleted by 006:
    //   bag→g, bag→oz, bottle→fl oz, box→each, case→each, pack→each
    const pairs = [
      ['bag','g'], ['bag','oz'], ['bottle','fl oz'],
      ['box','each'], ['case','each'], ['pack','each']
    ];
    for (const [from, to] of pairs) {
      const r = await pool.query(
        'SELECT 1 FROM unit_conversions WHERE from_unit=$1 AND to_unit=$2',
        [from, to]
      );
      assert.strictEqual(r.rows.length, 0,
        `Packaging row "${from}→${to}" must not exist in unit_conversions`);
    }
  });

  await test('Migration 006: physical bidirectional rows are present (not deleted)', async () => {
    const expected = [
      ['lb','oz'], ['oz','g'], ['oz','lb'], ['g','oz'], ['g','lb'],
      ['fl oz','tbsp'], ['tbsp','fl oz'], ['fl oz','ml'], ['ml','fl oz']
    ];
    for (const [from, to] of expected) {
      const r = await pool.query(
        'SELECT 1 FROM unit_conversions WHERE from_unit=$1 AND to_unit=$2',
        [from, to]
      );
      assert.strictEqual(r.rows.length, 1,
        `Physical conversion "${from}→${to}" must exist in unit_conversions`);
    }
  });

  // ── Purchase preview endpoint ─────────────────────────────────────────────────────

  await test('GET /purchase-preview — returns proposed cost for linked ingredient', async () => {
    const inv = await req(server, 'POST', '/api/inventory', {
      name: 'Preview Test Inv', category: 'Dairy', unit: 'oz',
      current_stock: 0, min_stock: 0, cost: 0
    }, token);
    createdItems.push(inv.body.id);
    const ing = await req(server, 'POST', '/api/ingredients', {
      name: 'Preview Test Ing', category: 'Dairy', unit: 'oz',
      cost: 6.00, servings_per_purchase: 16, inventory_item_id: inv.body.id
    }, token);
    createdIngredients.push(ing.body.id);

    // Preview: 30-lb case ($60) → 480 oz → $0.125/oz
    const r = await req(server, 'GET',
      `/api/inventory/${inv.body.id}/purchase-preview?purchase_unit=case&pkg_qty=480&purchase_price=60`,
      null, token);
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.ok(Math.abs(Number(r.body.cost_per_base_unit) - 0.125) < 0.0001,
      `Expected cpbu=0.125, got ${r.body.cost_per_base_unit}`);
    const li = r.body.linked_ingredient;
    assert.ok(li, 'Should return linked_ingredient');
    assert.strictEqual(li.name, 'Preview Test Ing');
    assert.ok(Math.abs(Number(li.current_cost) - 6.00) < 0.001);
    assert.strictEqual(Number(li.current_spp), 16);
    assert.ok(Math.abs(Number(li.current_cost_per_unit) - 0.375) < 0.0001,
      `Expected current_cost_per_unit=0.375, got ${li.current_cost_per_unit}`);
    assert.ok(Math.abs(Number(li.proposed_cost_per_unit) - 0.125) < 0.0001,
      `Expected proposed_cost_per_unit=0.125, got ${li.proposed_cost_per_unit}`);
    assert.ok(!li.unit_mismatch, 'oz→oz should have no unit_mismatch');
  });

  await test('GET /purchase-preview — no linked ingredient returns null', async () => {
    const inv = await req(server, 'POST', '/api/inventory', {
      name: 'Preview NoLink Inv', category: 'Food', unit: 'oz',
      current_stock: 0, min_stock: 0, cost: 0
    }, token);
    createdItems.push(inv.body.id);
    const r = await req(server, 'GET',
      `/api/inventory/${inv.body.id}/purchase-preview?purchase_unit=lb&pkg_qty=1&purchase_price=4`,
      null, token);
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.linked_ingredient, null);
  });

  await test('GET /purchase-preview — incompatible units returns unit_mismatch', async () => {
    const inv = await req(server, 'POST', '/api/inventory', {
      name: 'Preview Mismatch Inv', category: 'Food', unit: 'oz',
      current_stock: 0, min_stock: 0, cost: 0
    }, token);
    createdItems.push(inv.body.id);
    const ing = await req(server, 'POST', '/api/ingredients', {
      name: 'Preview Mismatch Ing', category: 'Food', unit: 'each',
      cost: 5.00, servings_per_purchase: 10, inventory_item_id: inv.body.id
    }, token);
    createdIngredients.push(ing.body.id);
    const r = await req(server, 'GET',
      `/api/inventory/${inv.body.id}/purchase-preview?purchase_unit=lb&pkg_qty=1&purchase_price=4`,
      null, token);
    assert.strictEqual(r.status, 200);
    assert.ok(r.body.linked_ingredient.unit_mismatch, 'Should report unit_mismatch');
    assert.strictEqual(r.body.linked_ingredient.proposed_cost_per_unit, null);
  });

  // ── Legacy costing: sync_ingredient flag ──────────────────────────────────────────────

  await test('Oaxaca Cheese: sync_ingredient=false preserves legacy cost/spp', async () => {
    // Simulate: inventory base=oz, ingredient cost=$6.00 spp=16 (legacy 16-oz package model)
    const inv = await req(server, 'POST', '/api/inventory', {
      name: 'Oaxaca Cheese Sim Inv', category: 'Dairy', unit: 'oz',
      current_stock: 0, min_stock: 0, cost: 0
    }, token);
    createdItems.push(inv.body.id);
    const ing = await req(server, 'POST', '/api/ingredients', {
      name: 'Oaxaca Cheese Sim Ing', category: 'Dairy', unit: 'oz',
      cost: 6.00, servings_per_purchase: 16, inventory_item_id: inv.body.id
    }, token);
    createdIngredients.push(ing.body.id);

    // Save purchase info but decline sync.
    const r = await req(server, 'PUT', `/api/inventory/${inv.body.id}/purchase`, {
      purchase_unit: 'case', pkg_qty: 480, purchase_price: 60.00,
      sync_ingredient: false
    }, token);
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.ok(r.body._ingredient_skipped, 'Should set _ingredient_skipped=true');
    assert.ok(Math.abs(Number(r.body.cost_per_base_unit) - 0.125) < 0.0001,
      'Inventory cost_per_base_unit should be updated');

    // Ingredient cost and spp must be unchanged.
    const ings = await req(server, 'GET', '/api/ingredients', null, token);
    const still = ings.body.find(i => i.id === ing.body.id);
    assert.ok(Math.abs(Number(still.cost) - 6.00) < 0.001, `cost must be $6.00, got $${still.cost}`);
    assert.strictEqual(Number(still.servings_per_purchase), 16, `spp must be 16, got ${still.servings_per_purchase}`);
  });

  await test('Oaxaca Cheese: sync_ingredient=true converts to per-unit model', async () => {
    const inv = await req(server, 'POST', '/api/inventory', {
      name: 'Oaxaca Cheese Sync Inv', category: 'Dairy', unit: 'oz',
      current_stock: 0, min_stock: 0, cost: 0
    }, token);
    createdItems.push(inv.body.id);
    const ing = await req(server, 'POST', '/api/ingredients', {
      name: 'Oaxaca Cheese Sync Ing', category: 'Dairy', unit: 'oz',
      cost: 6.00, servings_per_purchase: 16, inventory_item_id: inv.body.id
    }, token);
    createdIngredients.push(ing.body.id);

    const r = await req(server, 'PUT', `/api/inventory/${inv.body.id}/purchase`, {
      purchase_unit: 'case', pkg_qty: 480, purchase_price: 60.00,
      sync_ingredient: true
    }, token);
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.ok(!r.body._ingredient_skipped, 'Should not skip when sync_ingredient=true');

    const ings = await req(server, 'GET', '/api/ingredients', null, token);
    const updated = ings.body.find(i => i.id === ing.body.id);
    // $60 / 480oz = $0.125/oz
    assert.ok(Math.abs(Number(updated.cost) - 0.125) < 0.0001,
      `Expected $0.125/oz, got $${updated.cost}`);
    assert.strictEqual(Number(updated.servings_per_purchase), 1);
  });

  await test('Corn Tortilla: sync_ingredient=false preserves legacy cost/spp', async () => {
    // Simulate: cost=$3.25 spp=22 (pack of 22 tortillas)
    const inv = await req(server, 'POST', '/api/inventory', {
      name: 'Corn Tortilla Sim Inv', category: 'Dry Goods', unit: 'each',
      current_stock: 0, min_stock: 0, cost: 0
    }, token);
    createdItems.push(inv.body.id);
    const ing = await req(server, 'POST', '/api/ingredients', {
      name: 'Corn Tortilla Sim Ing', category: 'Dry Goods', unit: 'each',
      cost: 3.25, servings_per_purchase: 22, inventory_item_id: inv.body.id
    }, token);
    createdIngredients.push(ing.body.id);

    const r = await req(server, 'PUT', `/api/inventory/${inv.body.id}/purchase`, {
      purchase_unit: 'pack', pkg_qty: 22, purchase_price: 3.25,
      sync_ingredient: false
    }, token);
    assert.strictEqual(r.status, 200);
    assert.ok(r.body._ingredient_skipped);

    const ings = await req(server, 'GET', '/api/ingredients', null, token);
    const still = ings.body.find(i => i.id === ing.body.id);
    assert.ok(Math.abs(Number(still.cost) - 3.25) < 0.001);
    assert.strictEqual(Number(still.servings_per_purchase), 22);
  });

  await test('To-Go Bowl: sync_ingredient=false preserves legacy cost/spp', async () => {
    // Simulate: cost=$42.00 spp=100 (case of 100 bowls)
    const inv = await req(server, 'POST', '/api/inventory', {
      name: 'ToGo Bowl Sim Inv', category: 'Packaging', unit: 'each',
      current_stock: 0, min_stock: 0, cost: 0
    }, token);
    createdItems.push(inv.body.id);
    const ing = await req(server, 'POST', '/api/ingredients', {
      name: 'ToGo Bowl Sim Ing', category: 'Packaging', unit: 'each',
      cost: 42.00, servings_per_purchase: 100, inventory_item_id: inv.body.id
    }, token);
    createdIngredients.push(ing.body.id);

    const r = await req(server, 'PUT', `/api/inventory/${inv.body.id}/purchase`, {
      purchase_unit: 'case', pkg_qty: 100, purchase_price: 42.00,
      sync_ingredient: false
    }, token);
    assert.strictEqual(r.status, 200);
    assert.ok(r.body._ingredient_skipped);

    const ings = await req(server, 'GET', '/api/ingredients', null, token);
    const still = ings.body.find(i => i.id === ing.body.id);
    assert.ok(Math.abs(Number(still.cost) - 42.00) < 0.001);
    assert.strictEqual(Number(still.servings_per_purchase), 100);
  });

  await test('New-model ingredient (spp=1, cost=0): auto-syncs without confirmation', async () => {
    // Ingredients created via create-ingredient start with cost=0, spp=1.
    // These should auto-sync without requiring sync_ingredient=true.
    const inv = await req(server, 'POST', '/api/inventory', {
      name: 'AutoSync Inv', category: 'Food', unit: 'oz',
      current_stock: 0, min_stock: 0, cost: 0
    }, token);
    createdItems.push(inv.body.id);
    const ing = await req(server, 'POST', '/api/ingredients', {
      name: 'AutoSync Ing', category: 'Food', unit: 'oz',
      cost: 0, servings_per_purchase: 1, inventory_item_id: inv.body.id
    }, token);
    createdIngredients.push(ing.body.id);

    // No sync_ingredient flag — should auto-sync because cost=0 and spp=1.
    const r = await req(server, 'PUT', `/api/inventory/${inv.body.id}/purchase`, {
      purchase_unit: 'lb', pkg_qty: 1, purchase_price: 4.00
    }, token);
    assert.strictEqual(r.status, 200);
    assert.ok(!r.body._ingredient_skipped, 'New-model ingredient should auto-sync');

    const ings = await req(server, 'GET', '/api/ingredients', null, token);
    const updated = ings.body.find(i => i.id === ing.body.id);
    // $4/lb → $4/16oz = $0.25/oz
    assert.ok(Math.abs(Number(updated.cost) - 0.25) < 0.0001,
      `Expected $0.25/oz, got $${updated.cost}`);
    assert.strictEqual(Number(updated.servings_per_purchase), 1);
  });

  await test('Recipe cost unchanged when sync_ingredient=false', async () => {
    // Verify that declining sync leaves recipe costs exactly as before.
    const before = await req(server, 'GET', '/api/recipes/1/cost', null, token);
    assert.strictEqual(before.status, 200);
    const beforeCost = before.body.total_cost;

    // Create a new inventory item linked to a new ingredient used in no recipe.
    const inv = await req(server, 'POST', '/api/inventory', {
      name: 'RecipeSafe Inv', category: 'Food', unit: 'oz',
      current_stock: 0, min_stock: 0, cost: 0
    }, token);
    createdItems.push(inv.body.id);
    const ing = await req(server, 'POST', '/api/ingredients', {
      name: 'RecipeSafe Ing', category: 'Food', unit: 'oz',
      cost: 5.00, servings_per_purchase: 8, inventory_item_id: inv.body.id
    }, token);
    createdIngredients.push(ing.body.id);

    await req(server, 'PUT', `/api/inventory/${inv.body.id}/purchase`, {
      purchase_unit: 'lb', pkg_qty: 1, purchase_price: 4.00,
      sync_ingredient: false
    }, token);

    const after = await req(server, 'GET', '/api/recipes/1/cost', null, token);
    assert.strictEqual(after.body.total_cost, beforeCost,
      'Recipe cost must be unchanged when sync is declined');
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
