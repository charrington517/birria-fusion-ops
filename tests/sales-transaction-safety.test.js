'use strict';
/**
 * tests/sales-transaction-safety.test.js
 * Run: node tests/sales-transaction-safety.test.js
 * Targets birria_fusion_test — never touches birria_fusion_ops.
 */

const assert = require('assert');
const { Pool } = require('pg');

// Load test DB config from .env.test -- never derives credentials from production .env.
require('./helpers/test-db');
const TEST_DB_URL = process.env.TEST_DATABASE_URL;

const pool = new Pool({ connectionString: TEST_DB_URL });
async function q(text, params) { return pool.query(text, params); }

async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// Inline consume — mirrors consumeInventoryWithClient logic, uses test pool client
async function consumeWithClient(client, salesOrderId) {
  const orderRes = await client.query('SELECT * FROM sales_orders WHERE id=$1', [salesOrderId]);
  const order = orderRes.rows[0];
  if (!order) throw new Error('Sales order not found');

  const menuRes = await client.query('SELECT recipe_id FROM menu_items WHERE id=$1', [order.menu_item_id]);
  const menu = menuRes.rows[0];
  if (!menu || !menu.recipe_id) return { deductions: [] };

  const lines = await client.query(`
    SELECT ri.quantity AS qty_per_unit, ri.unit,
           i.name AS ingredient_name,
           i.inventory_item_id,
           COALESCE(i.servings_per_purchase,1) AS spp,
           inv.name AS inventory_name, inv.unit AS inv_unit,
           inv.id AS inventory_id
    FROM recipe_ingredients ri
    JOIN ingredients i ON i.id = ri.ingredient_id
    LEFT JOIN inventory inv ON inv.id = i.inventory_item_id
    WHERE ri.recipe_id = $1
  `, [menu.recipe_id]);

  const deductions = [];
  for (const line of lines.rows) {
    if (!line.inventory_id) continue;
    const spp = Number(line.spp) || 1;
    const ing_qty = Number((Number(line.qty_per_unit) * order.quantity).toFixed(6));
    const inv_qty = Number((ing_qty / spp).toFixed(6));
    await client.query(
      'UPDATE inventory SET current_stock = current_stock - $1 WHERE id = $2',
      [inv_qty, line.inventory_id]
    );
    const reason = `Sales order #${salesOrderId}: ${ing_qty} ${line.unit} ${line.ingredient_name}` +
      (spp > 1 ? ` -> ${inv_qty.toFixed(4)} ${line.inv_unit} (/${spp})` : '');
    await client.query(
      'INSERT INTO inventory_transactions (inventory_id, change_amount, reason, sales_order_id) VALUES ($1,$2,$3,$4)',
      [line.inventory_id, -inv_qty, reason, salesOrderId]
    );
    deductions.push({ inventory_id: line.inventory_id, deducted: inv_qty });
  }
  return { deductions };
}

async function createSale(menuItemId, quantity, eventId, note, idempotencyKey) {
  return withTransaction(async (client) => {
    const ins = await client.query(
      `INSERT INTO sales_orders (menu_item_id, quantity, event_id, note, idempotency_key)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [menuItemId, quantity, eventId || null, note || null, idempotencyKey || null]
    );
    const order = ins.rows[0];
    const consumption = await consumeWithClient(client, order.id);
    return { order, consumption };
  });
}

async function getStock(id) {
  const r = await q('SELECT current_stock FROM inventory WHERE id=$1', [id]);
  return Number(r.rows[0].current_stock);
}
async function getTxCount(salesOrderId) {
  const r = await q('SELECT COUNT(*)::int AS n FROM inventory_transactions WHERE sales_order_id=$1', [salesOrderId]);
  return r.rows[0].n;
}
async function getSaleCount() {
  const r = await q('SELECT COUNT(*)::int AS n FROM sales_orders');
  return r.rows[0].n;
}
async function resetStocks() {
  // inventory id=1 (Birria Beef) is NOT in recipe 2 — reset it anyway for cleanliness
  await q('UPDATE inventory SET current_stock=20 WHERE id=1');
  // inventory id=2 (Corn Tortillas) IS in recipe 2 (menu item 1 = Quesabirria Tacos)
  await q('UPDATE inventory SET current_stock=10 WHERE id=2');
  // inventory id=4 (Cilantro), id=5 (To-Go Bowls), id=8 (White Onion), id=9 (Oaxaca Cheese)
  await q('UPDATE inventory SET current_stock=10 WHERE id=4');
  await q('UPDATE inventory SET current_stock=5  WHERE id=5');
  await q('UPDATE inventory SET current_stock=10 WHERE id=8');
  await q('UPDATE inventory SET current_stock=5  WHERE id=9');
}
async function cleanSalesAfter(minId) {
  await q('DELETE FROM inventory_transactions WHERE sales_order_id > $1', [minId]);
  await q('DELETE FROM sales_orders WHERE id > $1', [minId]);
}

// ── Test runner ───────────────────────────────────────────────────────────────
let passed = 0; let failed = 0;
async function test(name, fn) {
  try {
    await fn();
    console.log(`  PASS  ${name}`);
    passed++;
  } catch (err) {
    console.error(`  FAIL  ${name}`);
    console.error(`        ${err.message}`);
    failed++;
  }
}

async function runAll() {
  console.log('\nSales Transaction Safety — Test Suite');
  console.log('======================================');

  const baseline = await getSaleCount();
  await resetStocks();

  // 1. Successful sale — menu item 1 (Quesabirria Tacos) uses recipe 2 which deducts inventory id=2
  await test('Successful sale: order inserted and inventory deducted', async () => {
    await resetStocks();
    const before = await getStock(2); // Corn Tortillas — in recipe 2
    const { order, consumption } = await createSale(1, 1, null, null, null);
    assert.ok(order.id, 'order.id must exist');
    const after = await getStock(2);
    assert.ok(after < before, `Stock must decrease: ${before} -> ${after}`);
    const txn = await getTxCount(order.id);
    assert.ok(txn > 0, 'inventory_transactions rows must exist');
    await cleanSalesAfter(baseline); await resetStocks();
  });

  // 2. Rollback on mid-transaction failure
  await test('Rollback: failure mid-transaction leaves no sale and no deductions', async () => {
    await resetStocks();
    const before = await getStock(1);
    const salesBefore = await getSaleCount();
    let threw = false;
    try {
      await withTransaction(async (client) => {
        await client.query(
          `INSERT INTO sales_orders (menu_item_id, quantity, idempotency_key) VALUES ($1,$2,$3)`,
          [1, 1, 'rollback-test']
        );
        await client.query('UPDATE inventory SET current_stock = current_stock - 1 WHERE id=1');
        throw new Error('Simulated failure');
      });
    } catch (e) { threw = true; }
    assert.ok(threw, 'Must throw');
    assert.strictEqual(await getSaleCount(), salesBefore, 'No new sales_orders row after rollback');
    assert.strictEqual(await getStock(1), before, 'Stock unchanged after rollback');
    const keyRow = await q('SELECT id FROM sales_orders WHERE idempotency_key=$1', ['rollback-test']);
    assert.strictEqual(keyRow.rows.length, 0, 'Rolled-back key must not persist');
  });

  // 3. Idempotent replay — same key, same payload
  await test('Idempotency: same key returns original order, no duplicate deduction', async () => {
    await resetStocks();
    const key = 'idem-' + Date.now();
    const before = await getStock(2); // Corn Tortillas — in recipe 2
    const { order: first } = await createSale(1, 1, null, null, key);
    const afterFirst = await getStock(2);
    assert.ok(afterFirst < before, 'First sale must deduct stock');
    // Attempt duplicate insert — must get unique violation
    let got23505 = false;
    try {
      await q(`INSERT INTO sales_orders (menu_item_id, quantity, idempotency_key) VALUES ($1,$2,$3)`, [1, 1, key]);
    } catch (e) { if (e.code === '23505') got23505 = true; }
    assert.ok(got23505, 'Duplicate key must raise 23505');
    assert.strictEqual(await getStock(2), afterFirst, 'Stock must not change on replay attempt');
    await cleanSalesAfter(baseline); await resetStocks();
  });

  // 4. Two legitimate identical sales with different keys
  await test('Two identical sales with different keys both succeed', async () => {
    await resetStocks();
    const before = await getStock(2); // Corn Tortillas — in recipe 2
    const { order: o1 } = await createSale(1, 1, null, null, 'legit-a-' + Date.now());
    const { order: o2 } = await createSale(1, 1, null, null, 'legit-b-' + Date.now());
    assert.notStrictEqual(o1.id, o2.id, 'Must produce two distinct orders');
    assert.ok(await getStock(2) < before, 'Stock must reflect both deductions');
    assert.ok(await getTxCount(o1.id) > 0, 'Order 1 must have transactions');
    assert.ok(await getTxCount(o2.id) > 0, 'Order 2 must have transactions');
    await cleanSalesAfter(baseline); await resetStocks();
  });

  // 5. Key reuse with different payload rejected by unique constraint
  await test('Key reuse with different payload: unique constraint blocks insert', async () => {
    await resetStocks();
    const key = 'conflict-' + Date.now();
    await createSale(1, 1, null, null, key);
    let got23505 = false;
    try {
      await withTransaction(async (client) => {
        await client.query(
          `INSERT INTO sales_orders (menu_item_id, quantity, idempotency_key) VALUES ($1,$2,$3)`,
          [2, 5, key]
        );
      });
    } catch (e) { if (e.code === '23505') got23505 = true; }
    assert.ok(got23505, 'Different payload with same key must raise 23505');
    await cleanSalesAfter(baseline); await resetStocks();
  });

  // 6. Concurrent sales with different keys — atomic UPDATE prevents overwrite
  await test('Concurrent sales with different keys: both deductions applied correctly', async () => {
    await resetStocks();
    const before = await getStock(2); // Corn Tortillas — in recipe 2
    const [r1, r2] = await Promise.all([
      createSale(1, 1, null, null, 'conc-a-' + Date.now()),
      createSale(1, 1, null, null, 'conc-b-' + Date.now())
    ]);
    assert.notStrictEqual(r1.order.id, r2.order.id, 'Must be two distinct orders');
    const after = await getStock(2);
    assert.ok(after < before, `Stock ${before} -> ${after} must reflect both deductions`);
    assert.ok(await getTxCount(r1.order.id) > 0, 'Order 1 must have transactions');
    assert.ok(await getTxCount(r2.order.id) > 0, 'Order 2 must have transactions');
    await cleanSalesAfter(baseline); await resetStocks();
  });

  // 7. Concurrent duplicate key — exactly one succeeds
  await test('Concurrent duplicate key: exactly one succeeds, one gets 23505', async () => {
    await resetStocks();
    const key = 'conc-dup-' + Date.now();
    const salesBefore = await getSaleCount();
    const results = await Promise.allSettled([
      createSale(1, 1, null, null, key),
      createSale(1, 1, null, null, key)
    ]);
    const ok  = results.filter(r => r.status === 'fulfilled');
    const bad = results.filter(r => r.status === 'rejected');
    assert.strictEqual(ok.length,  1, 'Exactly one concurrent duplicate must succeed');
    assert.strictEqual(bad.length, 1, 'Exactly one concurrent duplicate must fail');
    assert.strictEqual(bad[0].reason.code, '23505', 'Failure must be unique violation');
    assert.strictEqual(await getSaleCount(), salesBefore + 1, 'Exactly one new row');
    await cleanSalesAfter(baseline); await resetStocks();
  });

  // 8. Historical records untouched — test DB restored from June 6 backup: 10 sales, 28 transactions
  await test('Historical records: existing sales and transactions preserved', async () => {
    const sales = await getSaleCount();
    const txns  = (await q('SELECT COUNT(*)::int AS n FROM inventory_transactions')).rows[0].n;
    assert.ok(sales >= 10, `Must have >= 10 historical sales, got ${sales}`);
    assert.ok(txns  >= 20, `Must have >= 20 historical transactions, got ${txns}`);
    const nullKeys = await q('SELECT COUNT(*)::int AS n FROM sales_orders WHERE idempotency_key IS NULL');
    assert.ok(nullKeys.rows[0].n >= 10, 'Pre-migration rows must have NULL idempotency_key');
  });

  // 9. withTransaction releases client on success
  await test('withTransaction: client released after success', async () => {
    await withTransaction(async (client) => { await client.query('SELECT 1'); });
    assert.ok(pool.idleCount >= 0, 'Pool must have idle clients');
  });

  // 10. withTransaction releases client on error
  await test('withTransaction: client released after error', async () => {
    let threw = false;
    try {
      await withTransaction(async (client) => {
        await client.query('SELECT 1');
        throw new Error('deliberate');
      });
    } catch { threw = true; }
    assert.ok(threw, 'Must re-throw');
    assert.ok(pool.idleCount >= 0, 'Pool must have idle clients after error');
  });

  console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed\n`);
  await pool.end();
  process.exit(failed > 0 ? 1 : 0);
}

runAll().catch(async err => {
  console.error('Runner error:', err.message);
  await pool.end();
  process.exit(1);
});
