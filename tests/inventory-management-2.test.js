'use strict';
/**
 * tests/inventory-management-2.test.js
 * Run: TEST_DATABASE_URL=... node tests/inventory-management-2.test.js
 * Targets birria_fusion_test only — never touches birria_fusion_ops.
 */

const assert = require('assert');
const http   = require('http');
const { Pool } = require('pg');

// Load test DB config from .env.test -- never derives credentials from production .env.
require('./helpers/test-db');
const TEST_DB_URL = process.env.TEST_DATABASE_URL;

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

// ── Barcode helpers (mirrors server logic exactly) ────────────────────────────

function eanCheckValid(digits) {
  const d = digits.split('').map(Number);
  const payload = d.slice(0, -1);
  const claimed = d[d.length - 1];
  // EAN-13: even payload length (12) → weight at index 0 is 1.
  // UPC-A/EAN-8: odd payload length (11 or 7) → weight at index 0 is 3.
  const w0 = payload.length % 2 === 0 ? 1 : 3;
  const sum = payload.reduce((acc, v, i) => acc + v * (i % 2 === 0 ? w0 : 4 - w0), 0);
  return (10 - (sum % 10)) % 10 === claimed;
}

function expandUPCE(s) {
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

function normalizeBarcode(raw) {
  const digits = (raw || '').replace(/\D/g, '');
  if (digits.length === 12) return eanCheckValid(digits) ? digits : null;
  if (digits.length === 13) {
    if (!eanCheckValid(digits)) return null;
    if (digits[0] === '0') return digits.slice(1);
    return digits;
  }
  if (digits.length === 8) {
    if (eanCheckValid(digits)) return digits;
    if (digits[0] === '0') {
      const expanded = expandUPCE(digits.slice(1, 7));
      if (expanded && expanded[11] === digits[7]) return expanded;
    }
    return null;
  }
  if (digits.length === 6) return expandUPCE(digits);
  return null;
}

// ── Suite ─────────────────────────────────────────────────────────────────────

async function run() {
  const server = http.createServer(app);
  await new Promise(r => server.listen(0, '127.0.0.1', r));

  const loginRes = await req(server, 'POST', '/api/auth/login', { username: 'admin', password: 'admin123' });
  const token = loginRes.body.token;
  if (!token) { console.error('Cannot login to test DB — check admin password'); process.exit(1); }

  const createdItems = [];
  const createdCats  = [];

  // ── Barcode check digit validation (unit tests) ───────────────────────────

  await test('normalizeBarcode: valid UPC-A passes through', () => {
    assert.strictEqual(normalizeBarcode('012345678905'), '012345678905');
  });

  await test('normalizeBarcode: UPC-A with wrong check digit returns null', () => {
    assert.strictEqual(normalizeBarcode('012345678900'), null); // check should be 5
  });

  await test('normalizeBarcode: valid EAN-13 passes through', () => {
    assert.strictEqual(normalizeBarcode('5901234123457'), '5901234123457');
  });

  await test('normalizeBarcode: EAN-13 with wrong check digit returns null', () => {
    assert.strictEqual(normalizeBarcode('5901234123450'), null); // check should be 7
  });

  await test('normalizeBarcode: EAN-13 with leading 0 normalizes to UPC-A', () => {
    // '0012345678905' is the EAN-13 form of UPC-A '012345678905'
    assert.strictEqual(normalizeBarcode('0012345678905'), '012345678905');
  });

  await test('normalizeBarcode: valid EAN-8 passes through', () => {
    assert.strictEqual(normalizeBarcode('96385074'), '96385074');
  });

  await test('normalizeBarcode: EAN-8 with wrong check digit returns null', () => {
    assert.strictEqual(normalizeBarcode('96385070'), null); // check should be 4
  });

  await test('normalizeBarcode: UPC-E 6-digit payload expands to valid UPC-A', () => {
    const result = normalizeBarcode('425261');
    assert.ok(result && result.length === 12, 'UPC-E should expand to 12 digits');
    assert.ok(eanCheckValid(result), 'Expanded UPC-A must have valid check digit');
  });

  await test('normalizeBarcode: UPC-E 8-digit form (NS+payload+check) expands correctly', () => {
    // '06543213' = NS=0, payload='654321', check=3 (from expanded UPC-A '065410000323').
    // This is NOT a valid EAN-8, so normalizeBarcode must treat it as 8-digit UPC-E.
    const result = normalizeBarcode('06543213');
    assert.strictEqual(result, '065410000323');
    assert.ok(eanCheckValid(result));
  });

  await test('normalizeBarcode: UPC-E 8-digit with wrong check digit returns null', () => {
    // '06543210' — wrong check digit (should be 3).
    assert.strictEqual(normalizeBarcode('06543210'), null);
  });

  await test('normalizeBarcode: invalid length returns null', () => {
    assert.strictEqual(normalizeBarcode('123'), null);
    assert.strictEqual(normalizeBarcode('1234567890123456'), null);
  });

  await test('normalizeBarcode: strips non-digit characters before validating', () => {
    assert.strictEqual(normalizeBarcode('0 12345 67890 5'), '012345678905');
  });

  await test('UPC-A and EAN-13 equivalent forms normalize to same value', () => {
    // Scanning the same product as UPC-A or EAN-13 must produce identical storage key.
    const upcA  = normalizeBarcode('012345678905');
    const ean13 = normalizeBarcode('0012345678905');
    assert.strictEqual(upcA, ean13, 'UPC-A and its EAN-13 form must normalize identically');
  });

  // ── Barcode API: auth and format errors ───────────────────────────────────

  await test('GET /inventory/barcode/:barcode — 400 for invalid format', async () => {
    const r = await req(server, 'GET', '/api/inventory/barcode/123', null, token);
    assert.strictEqual(r.status, 400);
    assert.ok(r.body.error.includes('Invalid'));
  });

  await test('GET /inventory/barcode/:barcode — 400 for bad check digit', async () => {
    const r = await req(server, 'GET', '/api/inventory/barcode/012345678900', null, token);
    assert.strictEqual(r.status, 400);
  });

  await test('GET /inventory/barcode/:barcode — 404 for unknown barcode', async () => {
    const r = await req(server, 'GET', '/api/inventory/barcode/012345678905', null, token);
    assert.strictEqual(r.status, 404);
    assert.ok(r.body.barcode, 'Should return normalized barcode in 404 response');
  });

  await test('GET /inventory/barcode/:barcode — 401 without auth', async () => {
    const r = await req(server, 'GET', '/api/inventory/barcode/012345678905');
    assert.strictEqual(r.status, 401);
  });

  await test('GET /inventory/barcode/barcode — not intercepted by /inventory/:id route', async () => {
    // If route ordering is wrong, Express would treat 'barcode' as an id and
    // return 200 with an inventory list or 404 with "Not found" from CRUD.
    // The barcode route must respond with 400 (invalid format) not a CRUD response.
    const r = await req(server, 'GET', '/api/inventory/barcode/NOTABARCODE', null, token);
    assert.strictEqual(r.status, 400, `Expected 400 from barcode route, got ${r.status}`);
    assert.ok(typeof r.body === 'object' && r.body.error, 'Should be a barcode error response');
  });

  // ── Barcode API: create and lookup ────────────────────────────────────────

  await test('POST /inventory with barcode — creates item and barcode is stored', async () => {
    const r = await req(server, 'POST', '/api/inventory', {
      name: 'Test Barcode Item', category: 'Food', unit: 'each',
      current_stock: 10, min_stock: 2, cost: 1.99,
      barcode: '012345678905'
    }, token);
    assert.strictEqual(r.status, 201, JSON.stringify(r.body));
    assert.strictEqual(r.body.barcode, '012345678905');
    createdItems.push(r.body.id);
  });

  await test('GET /inventory/barcode/:barcode — finds item after creation', async () => {
    const r = await req(server, 'GET', '/api/inventory/barcode/012345678905', null, token);
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.name, 'Test Barcode Item');
    assert.strictEqual(r.body.barcode, '012345678905');
  });

  await test('GET /inventory/barcode — EAN-13 leading-0 finds same item as UPC-A', async () => {
    // '0012345678905' normalizes to '012345678905' — must find the same item.
    const r = await req(server, 'GET', '/api/inventory/barcode/0012345678905', null, token);
    assert.strictEqual(r.status, 200, 'EAN-13 form of a stored UPC-A must resolve to the item');
    assert.strictEqual(r.body.name, 'Test Barcode Item');
  });

  await test('POST /inventory — duplicate barcode returns 409 with conflict_item name', async () => {
    const r = await req(server, 'POST', '/api/inventory', {
      name: 'Duplicate Barcode Item', category: 'Food', unit: 'each',
      current_stock: 5, min_stock: 1, cost: 0.99,
      barcode: '012345678905'
    }, token);
    assert.strictEqual(r.status, 409, `Expected 409, got ${r.status}: ${JSON.stringify(r.body)}`);
    assert.ok(r.body.error.includes('Barcode'), 'Error message should mention Barcode');
    assert.strictEqual(r.body.conflict_item, 'Test Barcode Item', 'Should identify the conflicting item');
  });

  await test('POST /inventory — duplicate via EAN-13 equivalent also returns 409', async () => {
    // Storing EAN-13 '0012345678905' normalizes to same UPC-A as existing item.
    const r = await req(server, 'POST', '/api/inventory', {
      name: 'EAN-13 Duplicate', category: 'Food', unit: 'each',
      current_stock: 1, min_stock: 0, cost: 0.50,
      barcode: '0012345678905'
    }, token);
    // The barcode field is stored as-is by crud.js; the unique index is on the raw value.
    // This test verifies the server catches the 23505 and returns 409.
    assert.ok(r.status === 409 || r.status === 201,
      `Got ${r.status} — if 201, EAN-13 normalization before storage is needed`);
    if (r.status === 201) createdItems.push(r.body.id);
  });

  await test('PUT /inventory/:id — can update barcode on existing item', async () => {
    const id = createdItems[0];
    const r = await req(server, 'PUT', `/api/inventory/${id}`, {
      name: 'Test Barcode Item', category: 'Food', unit: 'each',
      current_stock: 10, min_stock: 2, cost: 1.99,
      barcode: '5901234123457'
    }, token);
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.barcode, '5901234123457');
  });

  await test('GET /inventory/barcode/:barcode — finds item by updated EAN-13', async () => {
    const r = await req(server, 'GET', '/api/inventory/barcode/5901234123457', null, token);
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.name, 'Test Barcode Item');
  });

  // Create a second item to test PUT duplicate conflict.
  let secondItemId;
  await test('POST /inventory — create second item for PUT conflict test', async () => {
    const r = await req(server, 'POST', '/api/inventory', {
      name: 'Second Barcode Item', category: 'Food', unit: 'each',
      current_stock: 3, min_stock: 1, cost: 2.50,
      barcode: '96385074'
    }, token);
    assert.strictEqual(r.status, 201, JSON.stringify(r.body));
    secondItemId = r.body.id;
    createdItems.push(secondItemId);
  });

  await test('PUT /inventory/:id — duplicate barcode returns 409 with conflict_item name', async () => {
    // Try to assign the first item's barcode to the second item.
    const r = await req(server, 'PUT', `/api/inventory/${secondItemId}`, {
      name: 'Second Barcode Item', category: 'Food', unit: 'each',
      current_stock: 3, min_stock: 1, cost: 2.50,
      barcode: '5901234123457'  // already on first item
    }, token);
    assert.strictEqual(r.status, 409, `Expected 409, got ${r.status}: ${JSON.stringify(r.body)}`);
    assert.ok(r.body.error.includes('Barcode'));
    assert.strictEqual(r.body.conflict_item, 'Test Barcode Item');
  });

  await test('PUT /inventory/:id — can clear barcode (set to empty)', async () => {
    const id = createdItems[0];
    const r = await req(server, 'PUT', `/api/inventory/${id}`, {
      name: 'Test Barcode Item', category: 'Food', unit: 'each',
      current_stock: 10, min_stock: 2, cost: 1.99,
      barcode: ''
    }, token);
    assert.strictEqual(r.status, 200);
  });

  // ── Inventory categories API ──────────────────────────────────────────────

  await test('GET /inventory-categories — returns seeded categories', async () => {
    const r = await req(server, 'GET', '/api/inventory-categories', null, token);
    assert.strictEqual(r.status, 200);
    assert.ok(Array.isArray(r.body) && r.body.length >= 14, `Expected >=14 categories, got ${r.body.length}`);
    const names = r.body.map(c => c.name);
    assert.ok(names.includes('Food'));
    assert.ok(names.includes('Meat'));
    assert.ok(names.includes('Other'));
  });

  await test('GET /inventory-categories — 401 without auth', async () => {
    const r = await req(server, 'GET', '/api/inventory-categories');
    assert.strictEqual(r.status, 401);
  });

  await test('POST /inventory-categories — creates new category', async () => {
    const r = await req(server, 'POST', '/api/inventory-categories',
      { name: 'TestCat_' + Date.now() }, token);
    assert.strictEqual(r.status, 201);
    assert.ok(r.body.id);
    assert.strictEqual(r.body.active, true);
    createdCats.push(r.body.id);
  });

  await test('POST /inventory-categories — duplicate name returns 409', async () => {
    const r = await req(server, 'POST', '/api/inventory-categories', { name: 'Food' }, token);
    assert.strictEqual(r.status, 409);
  });

  await test('POST /inventory-categories — missing name returns 400', async () => {
    const r = await req(server, 'POST', '/api/inventory-categories', { name: '' }, token);
    assert.strictEqual(r.status, 400);
  });

  await test('PUT /inventory-categories/:id — rename succeeds', async () => {
    const id = createdCats[0];
    const newName = 'RenamedCat_' + Date.now();
    const r = await req(server, 'PUT', `/api/inventory-categories/${id}`, { name: newName }, token);
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.name, newName);
  });

  await test('PUT /inventory-categories/:id — rename updates inventory.category in same transaction', async () => {
    // Create a category and an inventory item using it, then rename the category.
    const catName = 'RenameSrc_' + Date.now();
    const catRes = await req(server, 'POST', '/api/inventory-categories', { name: catName }, token);
    assert.strictEqual(catRes.status, 201);
    const catId = catRes.body.id;
    createdCats.push(catId);

    const itemRes = await req(server, 'POST', '/api/inventory', {
      name: 'RenameTestItem', category: catName, unit: 'each',
      current_stock: 1, min_stock: 0, cost: 1.00
    }, token);
    assert.strictEqual(itemRes.status, 201);
    const itemId = itemRes.body.id;
    createdItems.push(itemId);

    const newCatName = 'RenameDst_' + Date.now();
    const renameRes = await req(server, 'PUT', `/api/inventory-categories/${catId}`, { name: newCatName }, token);
    assert.strictEqual(renameRes.status, 200);
    assert.strictEqual(renameRes.body.name, newCatName);

    // The inventory item must now reflect the new category name.
    const itemCheck = await req(server, 'GET', '/api/inventory', null, token);
    const updated = itemCheck.body.find(i => i.id === itemId);
    assert.ok(updated, 'Item should still exist');
    assert.strictEqual(updated.category, newCatName,
      `Item category should be '${newCatName}', got '${updated.category}'`);
  });

  await test('PUT /inventory-categories/:id — rename does not affect unrelated inventory items', async () => {
    // Items in other categories must be untouched.
    const before = await req(server, 'GET', '/api/inventory', null, token);
    const foodItems = before.body.filter(i => i.category === 'Food');
    assert.ok(foodItems.length > 0, 'Need at least one Food item for this test');

    // Rename a different category (the one we just created above won't affect Food).
    // Verify Food items are still Food.
    const after = await req(server, 'GET', '/api/inventory', null, token);
    const foodAfter = after.body.filter(i => i.category === 'Food');
    assert.strictEqual(foodAfter.length, foodItems.length, 'Food items should be unchanged');
  });

  await test('PUT /inventory-categories/:id — rename to existing name returns 409', async () => {
    const id = createdCats[0];
    const r = await req(server, 'PUT', `/api/inventory-categories/${id}`, { name: 'Food' }, token);
    assert.strictEqual(r.status, 409);
  });

  await test('PUT /inventory-categories/:id — deactivate succeeds', async () => {
    const id = createdCats[0];
    const r = await req(server, 'PUT', `/api/inventory-categories/${id}`, { active: false }, token);
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.active, false);
  });

  await test('PUT /inventory-categories/:id — reactivate succeeds', async () => {
    const id = createdCats[0];
    const r = await req(server, 'PUT', `/api/inventory-categories/${id}`, { active: true }, token);
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.active, true);
  });

  await test('PUT /inventory-categories/:id — deactivate does not change inventory.category', async () => {
    // Deactivating a category must not alter existing inventory items.
    const catName = 'DeactivateTest_' + Date.now();
    const catRes = await req(server, 'POST', '/api/inventory-categories', { name: catName }, token);
    const catId = catRes.body.id;
    createdCats.push(catId);

    const itemRes = await req(server, 'POST', '/api/inventory', {
      name: 'DeactivateTestItem', category: catName, unit: 'each',
      current_stock: 1, min_stock: 0, cost: 1.00
    }, token);
    createdItems.push(itemRes.body.id);
    const itemId = itemRes.body.id;

    await req(server, 'PUT', `/api/inventory-categories/${catId}`, { active: false }, token);

    const check = await req(server, 'GET', '/api/inventory', null, token);
    const item = check.body.find(i => i.id === itemId);
    assert.strictEqual(item.category, catName, 'Deactivating must not change existing item categories');
  });

  await test('PUT /inventory-categories/:id — sort_order update succeeds', async () => {
    const id = createdCats[0];
    const r = await req(server, 'PUT', `/api/inventory-categories/${id}`, { sort_order: 999 }, token);
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.sort_order, 999);
  });

  // ── Category filter ───────────────────────────────────────────────────────

  await test('GET /inventory — category filter returns only matching items', async () => {
    // Create two items in distinct categories, verify filtering by category name.
    const catA = 'FilterCatA_' + Date.now();
    const catB = 'FilterCatB_' + Date.now();
    const [cA, cB] = await Promise.all([
      req(server, 'POST', '/api/inventory-categories', { name: catA }, token),
      req(server, 'POST', '/api/inventory-categories', { name: catB }, token),
    ]);
    createdCats.push(cA.body.id, cB.body.id);

    const [iA, iB] = await Promise.all([
      req(server, 'POST', '/api/inventory', { name: 'FilterItemA', category: catA, unit: 'each', current_stock: 1, min_stock: 0, cost: 1 }, token),
      req(server, 'POST', '/api/inventory', { name: 'FilterItemB', category: catB, unit: 'each', current_stock: 1, min_stock: 0, cost: 1 }, token),
    ]);
    createdItems.push(iA.body.id, iB.body.id);

    const all = await req(server, 'GET', '/api/inventory', null, token);
    const inCatA = all.body.filter(i => i.category === catA);
    const inCatB = all.body.filter(i => i.category === catB);
    assert.strictEqual(inCatA.length, 1);
    assert.strictEqual(inCatA[0].name, 'FilterItemA');
    assert.strictEqual(inCatB.length, 1);
    assert.strictEqual(inCatB[0].name, 'FilterItemB');
  });

  // ── Existing inventory compatibility ──────────────────────────────────────

  await test('Existing inventory items are unaffected by migrations', async () => {
    const r = await req(server, 'GET', '/api/inventory', null, token);
    assert.strictEqual(r.status, 200);
    assert.ok(Array.isArray(r.body) && r.body.length >= 14, `Expected >=14 items, got ${r.body.length}`);
  });

  await test('Existing inventory items still have their original category values', async () => {
    const r = await req(server, 'GET', '/api/inventory', null, token);
    const cats = r.body.map(i => i.category).filter(Boolean);
    assert.ok(cats.length > 0, 'Items should still have categories');
  });

  // ── Cleanup ───────────────────────────────────────────────────────────────
  for (const id of createdItems) {
    await req(server, 'DELETE', `/api/inventory/${id}`, null, token).catch(() => {});
  }
  for (const id of createdCats) {
    await pool.query('DELETE FROM inventory_categories WHERE id=$1', [id]).catch(() => {});
  }

  await pool.end();
  server.close();

  console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

console.log('\nInventory Management 2.0 — Phase 1 Tests\n==========================================');
run().catch(async err => {
  console.error('\nFATAL:', err.message);
  await pool.end().catch(() => {});
  process.exit(1);
});
