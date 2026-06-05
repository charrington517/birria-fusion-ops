const { query, close } = require('./pool');

async function init() {
  await query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'Owner',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS inventory (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      category TEXT,
      unit TEXT,
      current_stock NUMERIC DEFAULT 0,
      min_stock NUMERIC DEFAULT 0,
      max_stock NUMERIC DEFAULT 0,
      cost NUMERIC DEFAULT 0,
      supplier TEXT,
      forecast_per_event NUMERIC DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS menu_items (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      category TEXT,
      price NUMERIC DEFAULT 0,
      cost NUMERIC DEFAULT 0,
      active BOOLEAN DEFAULT true,
      description TEXT,
      prep_notes TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    -- Add recipe_id FK to menu_items if not already present
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='menu_items' AND column_name='recipe_id'
      ) THEN
        ALTER TABLE menu_items ADD COLUMN recipe_id INTEGER REFERENCES recipes(id);
      END IF;
    END $$;

    CREATE TABLE IF NOT EXISTS catering (
      id SERIAL PRIMARY KEY,
      client TEXT NOT NULL,
      date DATE,
      guests INTEGER DEFAULT 0,
      status TEXT DEFAULT 'Inquiry',
      value NUMERIC DEFAULT 0,
      deposit NUMERIC DEFAULT 0,
      location TEXT,
      service_type TEXT,
      notes TEXT,
      readiness INTEGER DEFAULT 50,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS events (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      date DATE,
      location TEXT,
      status TEXT DEFAULT 'Interested',
      expected_sales NUMERIC DEFAULT 0,
      notes TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS staff (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      role TEXT,
      status TEXT DEFAULT 'off',
      hours NUMERIC DEFAULT 0,
      food_card_expiry DATE,
      phone TEXT,
      notes TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS equipment (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      status TEXT DEFAULT 'Available',
      location TEXT,
      qr_code TEXT,
      quantity_total INTEGER DEFAULT 1,
      quantity_available INTEGER DEFAULT 1,
      notes TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS suppliers (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      category TEXT,
      phone TEXT,
      email TEXT,
      notes TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      category TEXT,
      status TEXT DEFAULT 'Open',
      priority TEXT DEFAULT 'Medium',
      due_time TEXT,
      notes TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS playbook (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      category TEXT,
      content TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS ai_tasks (
      id SERIAL PRIMARY KEY,
      prompt TEXT NOT NULL,
      context_type TEXT,
      status TEXT DEFAULT 'queued',
      result TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      completed_at TIMESTAMPTZ
    );

    CREATE TABLE IF NOT EXISTS recipe_ingredients (
      id            SERIAL PRIMARY KEY,
      recipe_id     INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
      ingredient_id INTEGER NOT NULL REFERENCES ingredients(id),
      quantity      NUMERIC NOT NULL DEFAULT 0,
      unit          TEXT,
      created_at    TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS ingredients (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      category TEXT,
      unit TEXT,
      quantity NUMERIC DEFAULT 0,
      cost NUMERIC DEFAULT 0,
      supplier TEXT,
      notes TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS expenses (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      category TEXT,
      amount NUMERIC DEFAULT 0,
      date DATE,
      notes TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS recipes (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      category TEXT,
      yield_amount NUMERIC DEFAULT 0,
      yield_unit TEXT,
      notes TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS activity (
      id SERIAL PRIMARY KEY,
      message TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  console.log('Database initialized.');
}

init().then(() => close()).catch(async err => {
  console.error(err);
  await close();
  process.exit(1);
});
