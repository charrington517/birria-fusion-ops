require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { pool, close } = require('./pool');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

async function run() {
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

  const files = fs.readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith('.sql')).sort();
  let ran = 0;

  for (const file of files) {
    if (applied.has(file)) { console.log(`  skip  ${file}`); continue; }
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    await pool.query(sql);
    await pool.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
    console.log(`  apply ${file}`);
    ran++;
  }

  if (ran === 0) console.log('All migrations already applied.');
  else console.log(`${ran} migration(s) applied.`);
}

run().then(() => close()).catch(async err => {
  console.error('Migration failed:', err.message);
  await close();
  process.exit(1);
});
