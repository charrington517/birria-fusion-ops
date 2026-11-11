require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

async function query(text, params) {
  return pool.query(text, params);
}

async function close() {
  await pool.end();
}

/**
 * Run `fn(client)` inside a single PostgreSQL transaction.
 * Acquires a dedicated client, issues BEGIN, calls fn, then COMMITs.
 * On any error, issues ROLLBACK and re-throws.
 * Always releases the client back to the pool.
 *
 * @param {(client: import('pg').PoolClient) => Promise<T>} fn
 * @returns {Promise<T>}
 */
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

module.exports = { pool, query, close, withTransaction };
