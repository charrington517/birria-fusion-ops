'use strict';
/**
 * tests/settings-change-password-ui.test.js
 *
 * Tests the behaviour that the Settings > Change Password UI depends on.
 * Targets birria_fusion_test only — never touches birria_fusion_ops.
 * Run: TEST_DATABASE_URL=... node tests/settings-change-password-ui.test.js
 */

const assert = require('assert');
const http   = require('http');
const { Pool } = require('pg');

// Load test DB config from .env.test -- never derives credentials from production .env.
require('./helpers/test-db');
const TEST_DB_URL = process.env.TEST_DATABASE_URL;

const express    = require('express');
const authRoutes = require('../server/routes/auth');

const app = express();
app.use(express.json());
app.use('/api/auth', authRoutes);

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

// ── Suite ─────────────────────────────────────────────────────────────────────

async function run() {
  const server = http.createServer(app);
  await new Promise(r => server.listen(0, '127.0.0.1', r));

  const { rows: [admin] } = await pool.query(
    "SELECT id, password_hash FROM users WHERE username='admin' LIMIT 1"
  );
  if (!admin) throw new Error('No admin user in test database');
  const originalHash = admin.password_hash;
  const restore = () => pool.query('UPDATE users SET password_hash=$1 WHERE id=$2', [originalHash, admin.id]);

  // Get a valid token.
  const loginRes = await req(server, 'POST', '/api/auth/login', { username: 'admin', password: 'admin123' });
  assert.strictEqual(loginRes.status, 200, `Login failed: ${JSON.stringify(loginRes.body)}`);
  const token = loginRes.body.token;

  // ── Client-side validation equivalents (server enforces same rules) ─────────

  await test('UI rule: new password < 12 chars → server returns 400', async () => {
    const r = await req(server, 'POST', '/api/auth/change-password',
      { current_password: 'admin123', new_password: 'short1!' }, token);
    assert.strictEqual(r.status, 400);
    assert.ok(r.body.error.includes('12 characters'));
  });

  await test('UI rule: new password same as current → server returns 400', async () => {
    // Use a 12+ char value equal for both fields to reach the differ check.
    const r = await req(server, 'POST', '/api/auth/change-password',
      { current_password: 'SamePass!1234', new_password: 'SamePass!1234' }, token);
    assert.strictEqual(r.status, 400);
    assert.ok(r.body.error.includes('differ'));
  });

  await test('UI rule: missing current_password → server returns 400', async () => {
    const r = await req(server, 'POST', '/api/auth/change-password',
      { new_password: 'NewPassword!99' }, token);
    assert.strictEqual(r.status, 400);
    assert.ok(r.body.error.includes('required'));
  });

  await test('UI rule: missing new_password → server returns 400', async () => {
    const r = await req(server, 'POST', '/api/auth/change-password',
      { current_password: 'admin123' }, token);
    assert.strictEqual(r.status, 400);
    assert.ok(r.body.error.includes('required'));
  });

  // ── Authentication ──────────────────────────────────────────────────────────

  await test('UI: unauthenticated request → 401 (no token)', async () => {
    const r = await req(server, 'POST', '/api/auth/change-password',
      { current_password: 'admin123', new_password: 'NewPassword!99' });
    assert.strictEqual(r.status, 401);
  });

  await test('UI: wrong current password → 401 with clear message', async () => {
    const r = await req(server, 'POST', '/api/auth/change-password',
      { current_password: 'wrongpassword!', new_password: 'NewPassword!99' }, token);
    assert.strictEqual(r.status, 401);
    assert.ok(r.body.error.includes('incorrect'));
  });

  // ── Successful change ───────────────────────────────────────────────────────

  await test('UI: valid change → 200, ok:true, message present', async () => {
    const newPass = 'ValidNewPass!2026';
    const r = await req(server, 'POST', '/api/auth/change-password',
      { current_password: 'admin123', new_password: newPass }, token);
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.strictEqual(r.body.ok, true);
    assert.ok(typeof r.body.message === 'string' && r.body.message.length > 0);
    // Response must not echo back any password value.
    const bodyStr = JSON.stringify(r.body);
    assert.ok(!bodyStr.includes('admin123'), 'Response must not contain old password');
    assert.ok(!bodyStr.includes(newPass),    'Response must not contain new password');
    await restore();
  });

  await test('UI: after change, old password rejected for login', async () => {
    const newPass = 'ValidNewPass!2026';
    await req(server, 'POST', '/api/auth/change-password',
      { current_password: 'admin123', new_password: newPass }, token);
    const oldLogin = await req(server, 'POST', '/api/auth/login',
      { username: 'admin', password: 'admin123' });
    assert.strictEqual(oldLogin.status, 401, 'Old password must be rejected');
    await restore();
  });

  await test('UI: after change, new password accepted for login (re-login flow)', async () => {
    const newPass = 'ValidNewPass!2026';
    await req(server, 'POST', '/api/auth/change-password',
      { current_password: 'admin123', new_password: newPass }, token);
    const newLogin = await req(server, 'POST', '/api/auth/login',
      { username: 'admin', password: newPass });
    assert.strictEqual(newLogin.status, 200, 'New password must allow login');
    assert.ok(newLogin.body.token, 'New login must return a token');
    await restore();
  });

  await test('UI: existing token still valid immediately after change (stateless JWT)', async () => {
    const newPass = 'ValidNewPass!2026';
    await req(server, 'POST', '/api/auth/change-password',
      { current_password: 'admin123', new_password: newPass }, token);
    // Old token should still work until it expires (JWT is stateless).
    const me = await req(server, 'GET', '/api/auth/me', null, token);
    assert.strictEqual(me.status, 200);
    await restore();
  });

  // ── Cleanup ────────────────────────────────────────────────────────────────
  await restore();
  await pool.end();
  server.close();

  console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

console.log('\nSettings > Change Password UI Tests\n=====================================');
run().catch(async err => {
  console.error('\nFATAL:', err.message);
  await pool.end().catch(() => {});
  process.exit(1);
});
