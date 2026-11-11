'use strict';
/**
 * tests/change-password.test.js
 * Run: TEST_DATABASE_URL=... node tests/change-password.test.js
 * Targets birria_fusion_test — never touches birria_fusion_ops.
 * Restores the original password hash after each test.
 */

const assert = require('assert');
const http   = require('http');
const { Pool } = require('pg');

const TEST_DB_URL = process.env.TEST_DATABASE_URL;
if (!TEST_DB_URL) {
  console.error('TEST_DATABASE_URL env var required');
  process.exit(1);
}

// Safety guard: refuse to run against the production database.
const _testDbName = TEST_DB_URL.match(/\/([^/?]+)(\?|$)/)?.[1] || '';
if (_testDbName === 'birria_fusion_ops') {
  console.error('REFUSED: TEST_DATABASE_URL points to the production database (birria_fusion_ops). Use birria_fusion_test.');
  process.exit(1);
}

// Point the app at the test database and provide a strong JWT secret
// BEFORE any app modules are required.
process.env.DATABASE_URL = TEST_DB_URL;
process.env.JWT_SECRET   = require('crypto').randomBytes(48).toString('hex');
process.env.NODE_ENV     = 'test';

const express    = require('express');
const authRoutes = require('../server/routes/auth');

const app = express();
app.use(express.json());
app.use('/api/auth', authRoutes);

const pool = new Pool({ connectionString: TEST_DB_URL });

// ── Helpers ───────────────────────────────────────────────────────────────────

function request(server, method, path, body, token) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : '';
    const headers = { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const addr = server.address();
    const req = http.request({ host: '127.0.0.1', port: addr.port, method, path, headers }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    req.end(payload);
  });
}

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`\n  PASS  ${name}`);
    passed++;
  } catch (e) {
    console.log(`\n  FAIL  ${name}`);
    console.log(`        ${e.message}`);
    failed++;
  }
}

// ── Test suite ────────────────────────────────────────────────────────────────

async function run() {
  const server = http.createServer(app);
  await new Promise(r => server.listen(0, '127.0.0.1', r));

  // Capture the admin user's original password hash so we can restore it.
  const { rows: [adminUser] } = await pool.query(
    "SELECT id, password_hash FROM users WHERE username = 'admin' LIMIT 1"
  );
  if (!adminUser) throw new Error('No admin user in test database');
  const originalHash = adminUser.password_hash;

  async function restorePassword() {
    await pool.query('UPDATE users SET password_hash=$1 WHERE id=$2', [originalHash, adminUser.id]);
  }

  // Login to get a valid token.
  const loginRes = await request(server, 'POST', '/api/auth/login', { username: 'admin', password: 'admin123' });
  assert.strictEqual(loginRes.status, 200, `Login failed: ${JSON.stringify(loginRes.body)}`);
  const token = loginRes.body.token;

  // ── Tests ──────────────────────────────────────────────────────────────────

  await test('change-password: missing fields returns 400', async () => {
    const r = await request(server, 'POST', '/api/auth/change-password', {}, token);
    assert.strictEqual(r.status, 400);
    assert.ok(r.body.error.includes('required'));
  });

  await test('change-password: new_password too short returns 400', async () => {
    const r = await request(server, 'POST', '/api/auth/change-password',
      { current_password: 'admin123', new_password: 'short' }, token);
    assert.strictEqual(r.status, 400);
    assert.ok(r.body.error.includes('12 characters'));
  });

  await test('change-password: same password returns 400', async () => {
    // Use a 12+ char value that matches itself for both fields
    const r = await request(server, 'POST', '/api/auth/change-password',
      { current_password: 'SamePassword!99', new_password: 'SamePassword!99' }, token);
    assert.strictEqual(r.status, 400);
    assert.ok(r.body.error.includes('differ'));
  });

  await test('change-password: wrong current_password returns 401', async () => {
    const r = await request(server, 'POST', '/api/auth/change-password',
      { current_password: 'wrongpassword', new_password: 'NewStr0ng!Pass#2026' }, token);
    assert.strictEqual(r.status, 401);
    assert.ok(r.body.error.includes('incorrect'));
  });

  await test('change-password: unauthenticated returns 401', async () => {
    const r = await request(server, 'POST', '/api/auth/change-password',
      { current_password: 'admin123', new_password: 'NewStr0ng!Pass#2026' });
    assert.strictEqual(r.status, 401);
  });

  await test('change-password: valid change succeeds and new password works for login', async () => {
    const newPass = 'NewStr0ng!Pass#2026';
    const r = await request(server, 'POST', '/api/auth/change-password',
      { current_password: 'admin123', new_password: newPass }, token);
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.strictEqual(r.body.ok, true);

    // New password must work for login.
    const loginNew = await request(server, 'POST', '/api/auth/login',
      { username: 'admin', password: newPass });
    assert.strictEqual(loginNew.status, 200, 'New password should allow login');

    // Old password must be rejected.
    const loginOld = await request(server, 'POST', '/api/auth/login',
      { username: 'admin', password: 'admin123' });
    assert.strictEqual(loginOld.status, 401, 'Old password should be rejected');

    await restorePassword();
  });

  await test('change-password: existing JWT token remains valid after password change', async () => {
    const newPass = 'AnotherStr0ng!Pass#99';
    await request(server, 'POST', '/api/auth/change-password',
      { current_password: 'admin123', new_password: newPass }, token);

    // Old token should still authenticate (JWT is stateless).
    const meRes = await request(server, 'GET', '/api/auth/me', null, token);
    assert.strictEqual(meRes.status, 200);

    await restorePassword();
  });

  // ── Cleanup ────────────────────────────────────────────────────────────────
  await restorePassword();
  await pool.end();
  server.close();

  console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

console.log('\nchange-password Integration Tests\n===================================');
run().catch(async err => {
  console.error('\nFATAL:', err.message);
  await pool.end().catch(() => {});
  process.exit(1);
});
