require('dotenv').config();
const fs   = require('fs');
const path = require('path');
const { pool, close } = require('./pool');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

async function run() {
  // Ensure tracking table exists — idempotent, safe to run repeatedly.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id          SERIAL PRIMARY KEY,
      filename    TEXT UNIQUE NOT NULL,
      applied_at  TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  const applied = new Set(
    (await pool.query('SELECT filename FROM schema_migrations ORDER BY filename')).rows.map(r => r.filename)
  );

  if (!fs.existsSync(MIGRATIONS_DIR)) {
    console.log('No migrations directory found. Nothing to apply.');
    return;
  }

  const files = fs.readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.sql'))
    .sort();

  if (files.length === 0) {
    console.log('No migration files found.');
    return;
  }

  let ran = 0;

  for (const file of files) {
    if (applied.has(file)) {
      console.log(`  skip  ${file}`);
      continue;
    }

    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');

    // Each migration runs in its own transaction.
    // If the SQL fails, the transaction rolls back and schema_migrations is NOT updated.
    // The migration can be corrected and re-run safely.
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
      await client.query('COMMIT');
      console.log(`  apply ${file}`);
      ran++;
    } catch (err) {
      await client.query('ROLLBACK');
      // Re-throw with the filename so the caller knows which migration failed.
      throw new Error(`Migration failed [${file}]: ${err.message}`);
    } finally {
      client.release();
    }
  }

  if (ran === 0) console.log('All migrations already applied.');
  else console.log(`${ran} migration(s) applied.`);
}

run()
  .then(() => close())
  .catch(async err => {
    console.error(err.message);
    await close();
    process.exit(1);
  });
