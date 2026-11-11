'use strict';
/**
 * tests/sales-http.test.js
 *
 * HTTP-level integration tests for POST /api/sales-orders.
 * Starts a real Express server on a random port against birria_fusion_test.
 * Never touches birria_fusion_ops.
 *
 * Run: node tests/sales-http.test.js
 */

const assert = require('assert');
const http   = require('http');
const { randomUUID } = require('crypto');

const TEST_DB = 'postgres://birria:birria_password@localhost:5432/birria_fusion_test';
process.env.DATABASE_URL = TEST_DB;
process.env.JWT_SECRET   = 'test_secret_not_production';
process.env.NODE_ENV     = 'test';

// Load app after env is set
const express  = require('express');
const { Pool } = require('pg');
const apiRoutes = require('../server/routes/api');

// ── Minimal test app (no static serving, no helmet noise) ────────────────────
const app = express();
app.use(express.json());
app.use('/api/auth', require('../server/routes/auth'));
app.use('/api', apiRoutes);
app.use((err, req, res, next) => res.status(500).json({ error: err.message }));

const pool = new Pool({ connectionString: TEST_DB });
async function q(text, params) { return pool.query(text, params); }

// ── Test runner ───────────────────────────────────────────────────────────────
let passed = 0; let failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  PASS  ${name}`); passed++; }
  catch (err) { console.error(`  FAIL  ${name}\n        ${err.message}`); failed++; }
}

// ── HTTP helpers ──────────────────────────────────────────────────────────────
let baseUrl;
let token;

function post(path, body, tok) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const url  = new URL(path, baseUrl);
    const opts = {
      hostname: url.hostname,
      port:     url.port,
      path:     url.pathname,
      method:   'POST',
      headers:  {
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(data),
        ...(tok ? { Authorization: `Bearer ${tok}` } : {})
      }
    };
    const req = http.request(opts, res => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); }
        catch { resolve({ status: res.statusCode, body: raw }); }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

// ── DB helpers ────────────────────────────────────────────────────────────────
async function getStock(id) {
  return Number((await q('SELECT current_stock FROM inventory WHERE id=$1', [id])).rows[0].current_stock);
}
async function getTxCount(salesOrderId) {
  return (await q('SELECT COUNT(*)::int AS n FROM inventory_transactions WHERE sales_order_id=$1', [salesOrderId])).rows[0].n;
}
async function getSaleCount() {
  return (await q('SELECT COUNT(*)::int AS n FROM sales_orders')).rows[0].n;
}
async function resetStocks() {
  await q('UPDATE inventory SET current_stock=10 WHERE id=2');
  await q('UPDATE inventory SET current_stock=10 WHERE id=4');
  await q('UPDATE inventory SET current_stock=5  WHERE id=5');
  await q('UPDATE inventory SET current_stock=10 WHERE id=8');
  await q('UPDATE inventory SET current_stock=5  WHERE id=9');
}
async function cleanSalesAfter(minId) {
  await q('DELETE FROM inventory_transactions WHERE sales_order_id > $1', [minId]);
  await q('DELETE FROM sales_orders WHERE id > $1', [minId]);
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function runAll() {
  console.log('\nSales HTTP Integration Tests');
  console.log('=============================');

  // Start server on random port
  const server = http.createServer(app);
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  baseUrl = `http://127.0.0.1:${port}`;

  // Authenticate
  const loginRes = await post('/api/auth/login', { username: 'admin', password: 'admin123' });
  assert.strictEqual(loginRes.status, 200, `Login failed: ${JSON.stringify(loginRes.body)}`);
  token = loginRes.body.token;
  assert.ok(token, 'Must receive JWT token');

  const baseline = await getSaleCount();
  await resetStocks();

  // ── 1. Successful sale ────────────────────────────────────────────────────
  await test('POST /sales-orders: successful sale returns 201 with order and consumption', async () => {
    await resetStocks();
    const key    = randomUUID();
    const before = await getStock(2);
    const res    = await post('/api/sales-orders', { menu_item_id: 1, quantity: 1, idempotency_key: key }, token);
    assert.strictEqual(res.status, 201, `Expected 201, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.ok(res.body.order?.id,          'Response must include order.id');
    assert.ok(res.body.consumption,        'Response must include consumption');
    assert.ok(!res.body.consumption.error, `Consumption must not have error: ${res.body.consumption?.error}`);
    const after = await getStock(2);
    assert.ok(after < before, `Stock must decrease: ${before} -> ${after}`);
    const txn = await getTxCount(res.body.order.id);
    assert.ok(txn > 0, 'inventory_transactions rows must exist');
    await cleanSalesAfter(baseline); await resetStocks();
  });

  // ── 2. Duplicate replay — same key, same payload ──────────────────────────
  await test('POST /sales-orders: duplicate key returns original order without re-deducting', async () => {
    await resetStocks();
    const key = randomUUID();
    const r1  = await post('/api/sales-orders', { menu_item_id: 1, quantity: 1, idempotency_key: key }, token);
    assert.strictEqual(r1.status, 201, `First request must be 201`);
    const stockAfterFirst = await getStock(2);

    const r2 = await post('/api/sales-orders', { menu_item_id: 1, quantity: 1, idempotency_key: key }, token);
    // Replay returns 200
    assert.strictEqual(r2.status, 200, `Replay must return 200, got ${r2.status}`);
    assert.strictEqual(r2.body.order.id, r1.body.order.id, 'Replay must return the original order id');
    assert.strictEqual(r2.body.consumption?.replayed, true, 'Replay must set consumption.replayed=true');

    // Stock must not change on replay
    const stockAfterReplay = await getStock(2);
    assert.strictEqual(stockAfterReplay, stockAfterFirst, 'Stock must not change on replay');

    // Only one sales_orders row for this key
    const rows = await q('SELECT id FROM sales_orders WHERE idempotency_key=$1', [key]);
    assert.strictEqual(rows.rows.length, 1, 'Must be exactly one sales_orders row for this key');

    await cleanSalesAfter(baseline); await resetStocks();
  });

  // ── 3. Conflicting key reuse — same key, different payload ────────────────
  await test('POST /sales-orders: key reuse with different payload returns 409', async () => {
    await resetStocks();
    const key = randomUUID();
    const r1  = await post('/api/sales-orders', { menu_item_id: 1, quantity: 1, idempotency_key: key }, token);
    assert.strictEqual(r1.status, 201, 'First request must be 201');

    // Same key, different menu_item_id
    const r2 = await post('/api/sales-orders', { menu_item_id: 2, quantity: 1, idempotency_key: key }, token);
    assert.strictEqual(r2.status, 409, `Conflicting reuse must return 409, got ${r2.status}`);
    assert.ok(r2.body.error, 'Must include error message');
    assert.ok(r2.body.original_order_id, 'Must include original_order_id');

    await cleanSalesAfter(baseline); await resetStocks();
  });

  // ── 4. Missing required fields ────────────────────────────────────────────
  await test('POST /sales-orders: missing menu_item_id returns 400', async () => {
    const res = await post('/api/sales-orders', { quantity: 1 }, token);
    assert.strictEqual(res.status, 400, `Expected 400, got ${res.status}`);
    assert.ok(res.body.error, 'Must include error message');
  });

  await test('POST /sales-orders: missing quantity returns 400', async () => {
    const res = await post('/api/sales-orders', { menu_item_id: 1 }, token);
    assert.strictEqual(res.status, 400, `Expected 400, got ${res.status}`);
  });

  // ── 5. Unauthenticated request ────────────────────────────────────────────
  await test('POST /sales-orders: unauthenticated request returns 401', async () => {
    const res = await post('/api/sales-orders', { menu_item_id: 1, quantity: 1 }, null);
    assert.strictEqual(res.status, 401, `Expected 401, got ${res.status}`);
  });

  // ── 6. No idempotency key — two identical requests both succeed ───────────
  await test('POST /sales-orders: no key — two identical requests both create new orders', async () => {
    await resetStocks();
    const salesBefore = await getSaleCount();
    const r1 = await post('/api/sales-orders', { menu_item_id: 1, quantity: 1 }, token);
    const r2 = await post('/api/sales-orders', { menu_item_id: 1, quantity: 1 }, token);
    assert.strictEqual(r1.status, 201);
    assert.strictEqual(r2.status, 201);
    assert.notStrictEqual(r1.body.order.id, r2.body.order.id, 'Must produce two distinct orders');
    assert.strictEqual(await getSaleCount(), salesBefore + 2, 'Must have two new rows');
    await cleanSalesAfter(baseline); await resetStocks();
  });

  // ── 7. Transaction failure — invalid menu_item_id rolls back ─────────────
  await test('POST /sales-orders: invalid menu_item_id returns 500 and no partial data', async () => {
    const salesBefore = await getSaleCount();
    const res = await post('/api/sales-orders', { menu_item_id: 99999, quantity: 1, idempotency_key: randomUUID() }, token);
    assert.ok([400, 500].includes(res.status), `Expected 400 or 500, got ${res.status}`);
    assert.strictEqual(await getSaleCount(), salesBefore, 'No new sales_orders row after failure');
  });

  // ── 8. Concurrent duplicate key — exactly one wins ────────────────────────
  await test('POST /sales-orders: concurrent duplicate key — exactly one 201, one 200', async () => {
    await resetStocks();
    const key = randomUUID();
    const salesBefore = await getSaleCount();
    const [r1, r2] = await Promise.all([
      post('/api/sales-orders', { menu_item_id: 1, quantity: 1, idempotency_key: key }, token),
      post('/api/sales-orders', { menu_item_id: 1, quantity: 1, idempotency_key: key }, token)
    ]);
    const statuses = [r1.status, r2.status].sort();
    assert.deepStrictEqual(statuses, [200, 201], `Expected [200,201], got ${statuses}`);
    assert.strictEqual(await getSaleCount(), salesBefore + 1, 'Exactly one new row');
    await cleanSalesAfter(baseline); await resetStocks();
  });

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed\n`);

  server.close();
  await pool.end();
  process.exit(failed > 0 ? 1 : 0);
}

runAll().catch(async err => {
  console.error('Runner error:', err.message);
  await pool.end();
  process.exit(1);
});
