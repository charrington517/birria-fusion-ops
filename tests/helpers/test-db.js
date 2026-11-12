'use strict';
/**
 * tests/helpers/test-db.js
 *
 * Loads TEST_DATABASE_URL from .env.test (project root).
 * Fails immediately if the file is missing or points to production.
 * Never reads from .env or derives credentials from DATABASE_URL.
 *
 * Usage (at the top of every test file, before requiring server modules):
 *   require('./helpers/test-db');   // sets process.env.DATABASE_URL
 */

const path = require('path');
const fs   = require('fs');

const envTestPath = path.resolve(__dirname, '../../.env.test');

if (!fs.existsSync(envTestPath)) {
  console.error(
    'ERROR: .env.test not found at ' + envTestPath + '\n' +
    'Copy .env.test.example to .env.test and fill in test DB credentials.\n' +
    'Never point TEST_DATABASE_URL at birria_fusion_ops.'
  );
  process.exit(1);
}

const raw   = fs.readFileSync(envTestPath, 'utf8');
const match = raw.match(/^TEST_DATABASE_URL=(.+)$/m);
if (!match) {
  console.error('ERROR: TEST_DATABASE_URL not found in .env.test');
  process.exit(1);
}

const TEST_DB_URL = match[1].trim();
const dbName = (TEST_DB_URL.match(/\/([^/?]+)(\?|$)/) || [])[1] || '';

if (dbName === 'birria_fusion_ops') {
  console.error('REFUSED: .env.test TEST_DATABASE_URL points to production database birria_fusion_ops.');
  process.exit(1);
}
if (!dbName) {
  console.error('ERROR: Could not parse database name from TEST_DATABASE_URL in .env.test');
  process.exit(1);
}

process.env.TEST_DATABASE_URL = TEST_DB_URL;
process.env.DATABASE_URL      = TEST_DB_URL;

if (!process.env.JWT_SECRET) {
  process.env.JWT_SECRET = require('crypto').randomBytes(48).toString('hex');
}

process.env.NODE_ENV = 'test';
