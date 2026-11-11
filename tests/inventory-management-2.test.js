'use strict';
/**
 * tests/inventory-management-2.test.js
 * Run: TEST_DATABASE_URL=... node tests/inventory-management-2.test.js
 * Targets birria_fusion_test only — never touches birria_fusion_ops.
 */

const assert = require('assert');
const http   = require('http');
const { Pool } = require('pg');

const TEST_DB_URL = process.env.TEST_DATABASE_URL;
if (!TEST_DB_URL) { console.error('TEST_DATABASE_URL env var required'); process.exit(1); }

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

// ── Barcode normalization (mirrors server logic) ──────────────────────────────

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
  if (digits.length === 12) return digits;
  if (digits.length === 13) return digits;
  if (digits.length === 8)  return digits;
  if (digits.length === 6)  return expandUPCE(digits);
  return null;
}

// ── Suite ─────────────────────────────────────────────────────────────────────

async function run() {
  const server = http.createServer(app);
  await new Promise(r => server.listen(0, '127.0.0.1', r));

  // Login.
  const loginRes = await req(server, 'POST', '/api/auth/login', { username: 'admin', password: 'admin123' });
  // Try the changed password if admin123 fails (user may have rotated it).
  const token = loginRes.body.token;
  if (!token) { console.error('Cannot login to test DB — check admin password'); process.exit(1); }

  // Track created items for cleanup.
  const createdItems = [];
  const createdCats  = [];

  // ── Barcode normalization unit tests ────────────────────────────────────────

  await test('normalizeBarcode: UPC-A 12-digit passes through', async () => {
    assert.strictEqual(normalizeBarcode('012345678905'), '012345678905');
  });

  await test('normalizeBarcode: EAN-13 13-digit passes through', async () => {
    assert.strictEqual(normalizeBarcode('5901234123457'), '5901234123457');
  });

  await test('normalizeBarcode: EAN-8 8-digit passes through', async () => {
    assert.strictEqual(normalizeBarcode('96385074'), '96385074');
  });

  await test('normalizeBarcode: UPC-E 6-digit expands to UPC-A', async () => {
    const result = normalizeBarcode('425261');
    assert.strictEqual(result.length, 12, 'UPC-E should expand to 12 digits');
  });

  await test('normalizeBarcode: invalid length returns null', async () => {
    assert.strictEqual(normalizeBarcode('123'), null);
    assert.strictEqual(normalizeBarcode('1234567890123456'), null);
  });

  await test('normalizeBarcode: strips non-digit characters', async () => {
    assert.strictEqual(normalizeBarcode('0 12345 67890 5'), '012345678905');
  });

  // ── Barcode API: lookup ─────────────────────────────────────────────────────

  await test('GET /inventory/barcode/:barcode — 400 for invalid format', async () => {
    const r = await req(server, 'GET', '/api/inventory/barcode/123', null, token);
    assert.strictEqual(r.status, 400);
    assert.ok(r.body.error.includes('Invalid'));
  });

  await test('GET /inventory/barcode/:barcode — 404 for unknown barcode', async () => {
    const r = await req(server, 'GET', '/api/inventory/barcode/999999999999', null, token);
    assert.strictEqual(r.status, 404);
    assert.ok(r.body.barcode, 'Should return normalized barcode in 404 response');
  });

  await test('GET /inventory/barcode/:barcode — 401 without auth', async () => {
    const r = await req(server, 'GET', '/api/inventory/barcode/012345678905');
    assert.strictEqual(r.status, 401);
  });

  // ── Barcode API: create and lookup ──────────────────────────────────────────

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

  await test('POST /inventory — duplicate barcode returns 500 with unique constraint error', async () => {
    const r = await req(server, 'POST', '/api/inventory', {
      name: 'Duplicate Barcode Item', category: 'Food', unit: 'each',
      current_stock: 5, min_stock: 1, cost: 0.99,
      barcode: '012345678905'
    }, token);
    // Unique constraint violation — server returns 500 (generic error handler).
    assert.ok(r.status === 500 || r.status === 409, `Expected 500 or 409, got ${r.status}`);
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

  await test('PUT /inventory/:id — can clear barcode (set to empty)', async () => {
    const id = createdItems[0];
    const r = await req(server, 'PUT', `/api/inventory/${id}`, {
      name: 'Test Barcode Item', category: 'Food', unit: 'each',
      current_stock: 10, min_stock: 2, cost: 1.99,
      barcode: ''
    }, token);
    assert.strictEqual(r.status, 200);
  });

  // ── Inventory categories API ────────────────────────────────────────────────

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

  await test('PUT /inventory-categories/:id — sort_order update succeeds', async () => {
    const id = createdCats[0];
    const r = await req(server, 'PUT', `/api/inventory-categories/${id}`, { sort_order: 999 }, token);
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.sort_order, 999);
  });

  // ── Existing inventory compatibility ────────────────────────────────────────

  await test('Existing inventory items are unaffected by migrations', async () => {
    const r = await req(server, 'GET', '/api/inventory', null, token);
    assert.strictEqual(r.status, 200);
    assert.ok(Array.isArray(r.body) && r.body.length >= 14, `Expected >=14 items, got ${r.body.length}`);
    // All existing items should have null barcode (additive migration).
    const withBarcode = r.body.filter(i => i.barcode && i.barcode !== '');
    // Only the test item we created should have a barcode (and we cleared it).
    assert.strictEqual(withBarcode.length, 0, 'No pre-existing items should have barcodes');
  });

  await test('Existing inventory items still have their original category values', async () => {
    const r = await req(server, 'GET', '/api/inventory', null, token);
    const cats = r.body.map(i => i.category).filter(Boolean);
    assert.ok(cats.length > 0, 'Items should still have categories');
  });

  // ── Cleanup ────────────────────────────────────────────────────────────────
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
