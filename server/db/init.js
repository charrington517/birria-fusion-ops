const { query, close } = require('./pool');

async function init() {
  // Tables are ordered so every FK target exists before any reference to it:
  //   recipes, ingredients, expenses, inventory  (no deps)
  //   → then menu_items ALTER (refs recipes)
  //   → then expenses ALTER (refs events)
  //   → then ingredients ALTER (refs inventory)
  //   → then recipe_ingredients (refs recipes + ingredients)
  //   → then sales_orders (refs menu_items + events)
  //   → then inventory_transactions (refs inventory + sales_orders)

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

    CREATE TABLE IF NOT EXISTS recipes (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      category TEXT,
      yield_amount NUMERIC DEFAULT 0,
      yield_unit TEXT,
      notes TEXT,
      prep_time TEXT,
      cook_time TEXT,
      instructions TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
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
      servings_per_purchase NUMERIC DEFAULT 1,
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
      vendor_type TEXT,
      phone TEXT,
      email TEXT,
      contact_name TEXT,
      website TEXT,
      address TEXT,
      delivery_days TEXT,
      default_order_day TEXT,
      lead_time_days INTEGER DEFAULT 1,
      minimum_order NUMERIC DEFAULT 0,
      payment_terms TEXT,
      active BOOLEAN DEFAULT true,
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

    CREATE TABLE IF NOT EXISTS activity (
      id SERIAL PRIMARY KEY,
      message TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    -- menu_items: created before recipe_id ALTER so the table exists first
    CREATE TABLE IF NOT EXISTS menu_items (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      category TEXT,
      price NUMERIC DEFAULT 0,
      cost NUMERIC DEFAULT 0,
      active BOOLEAN DEFAULT true,
      description TEXT,
      prep_notes TEXT,
      portions INTEGER DEFAULT 1,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    -- Add recipe_id FK to menu_items (recipes table now exists above)
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='menu_items' AND column_name='recipe_id'
      ) THEN
        ALTER TABLE menu_items ADD COLUMN recipe_id INTEGER REFERENCES recipes(id);
      END IF;
    END $$;

    -- Add event_id FK to expenses (events table now exists above)
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='expenses' AND column_name='event_id'
      ) THEN
        ALTER TABLE expenses ADD COLUMN event_id INTEGER REFERENCES events(id);
      END IF;
    END $$;

    -- Add servings_per_purchase to ingredients if not present
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='ingredients' AND column_name='servings_per_purchase'
      ) THEN
        ALTER TABLE ingredients ADD COLUMN servings_per_purchase NUMERIC DEFAULT 1;
      END IF;
    END $$;

    -- Add prep_time/cook_time/instructions to recipes if not present
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='recipes' AND column_name='prep_time') THEN
        ALTER TABLE recipes ADD COLUMN prep_time TEXT;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='recipes' AND column_name='cook_time') THEN
        ALTER TABLE recipes ADD COLUMN cook_time TEXT;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='recipes' AND column_name='instructions') THEN
        ALTER TABLE recipes ADD COLUMN instructions TEXT;
      END IF;
    END $$;

    -- Add portions to menu_items if not present
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='menu_items' AND column_name='portions') THEN
        ALTER TABLE menu_items ADD COLUMN portions INTEGER DEFAULT 1;
      END IF;
    END $$;

    -- Add inventory_item_id FK to ingredients (inventory table now exists above)
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='ingredients' AND column_name='inventory_item_id'
      ) THEN
        ALTER TABLE ingredients ADD COLUMN inventory_item_id INTEGER REFERENCES inventory(id);
      END IF;
    END $$;

    -- Add new columns to suppliers if not present
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='suppliers' AND column_name='vendor_type') THEN
        ALTER TABLE suppliers ADD COLUMN vendor_type TEXT;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='suppliers' AND column_name='contact_name') THEN
        ALTER TABLE suppliers ADD COLUMN contact_name TEXT;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='suppliers' AND column_name='website') THEN
        ALTER TABLE suppliers ADD COLUMN website TEXT;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='suppliers' AND column_name='address') THEN
        ALTER TABLE suppliers ADD COLUMN address TEXT;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='suppliers' AND column_name='delivery_days') THEN
        ALTER TABLE suppliers ADD COLUMN delivery_days TEXT;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='suppliers' AND column_name='default_order_day') THEN
        ALTER TABLE suppliers ADD COLUMN default_order_day TEXT;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='suppliers' AND column_name='lead_time_days') THEN
        ALTER TABLE suppliers ADD COLUMN lead_time_days INTEGER DEFAULT 1;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='suppliers' AND column_name='minimum_order') THEN
        ALTER TABLE suppliers ADD COLUMN minimum_order NUMERIC DEFAULT 0;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='suppliers' AND column_name='payment_terms') THEN
        ALTER TABLE suppliers ADD COLUMN payment_terms TEXT;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='suppliers' AND column_name='active') THEN
        ALTER TABLE suppliers ADD COLUMN active BOOLEAN DEFAULT true;
      END IF;
    END $$;

    -- Add supplier_id FK to inventory
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='inventory' AND column_name='supplier_id') THEN
        ALTER TABLE inventory ADD COLUMN supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL;
      END IF;
    END $$;

    -- recipe_ingredients: refs recipes + ingredients (both exist above)
    CREATE TABLE IF NOT EXISTS recipe_ingredients (
      id            SERIAL PRIMARY KEY,
      recipe_id     INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
      ingredient_id INTEGER NOT NULL REFERENCES ingredients(id),
      quantity      NUMERIC NOT NULL DEFAULT 0,
      unit          TEXT,
      created_at    TIMESTAMPTZ DEFAULT NOW()
    );

    -- sales_orders: refs menu_items + events (both exist above)
    CREATE TABLE IF NOT EXISTS sales_orders (
      id           SERIAL PRIMARY KEY,
      menu_item_id INTEGER NOT NULL REFERENCES menu_items(id),
      quantity     INTEGER NOT NULL DEFAULT 1,
      event_id     INTEGER REFERENCES events(id),
      note         TEXT,
      sold_at      TIMESTAMPTZ DEFAULT NOW()
    );


    -- compound_ingredients: batch-produced items (no FK deps except self-ref on components)
    CREATE TABLE IF NOT EXISTS compound_ingredients (
      id           SERIAL PRIMARY KEY,
      name         TEXT NOT NULL,
      category     TEXT,
      yield_amount NUMERIC NOT NULL DEFAULT 1,
      yield_unit   TEXT NOT NULL,
      notes        TEXT,
      active       BOOLEAN NOT NULL DEFAULT true,
      created_at   TIMESTAMPTZ DEFAULT NOW()
    );

    -- compound_ingredient_components: sub-ingredient rows for a compound
    -- parent_id         -> the compound being defined
    -- ingredient_id     -> a regular ingredient (XOR with nested_compound_id)
    -- nested_compound_id -> a nested compound ingredient (XOR with ingredient_id)
    CREATE TABLE IF NOT EXISTS compound_ingredient_components (
      id                  SERIAL PRIMARY KEY,
      parent_id           INTEGER NOT NULL
                            REFERENCES compound_ingredients(id) ON DELETE CASCADE,
      ingredient_id       INTEGER
                            REFERENCES ingredients(id),
      nested_compound_id  INTEGER
                            REFERENCES compound_ingredients(id),
      quantity            NUMERIC NOT NULL DEFAULT 0,
      unit                TEXT NOT NULL,
      created_at          TIMESTAMPTZ DEFAULT NOW(),
      CONSTRAINT compound_components_exactly_one_source CHECK (
        (ingredient_id IS NOT NULL AND nested_compound_id IS NULL) OR
        (ingredient_id IS NULL     AND nested_compound_id IS NOT NULL)
      )
    );

    -- Indexes for compound_ingredient_components lookups
    CREATE INDEX IF NOT EXISTS idx_cic_parent_id
      ON compound_ingredient_components(parent_id);
    CREATE INDEX IF NOT EXISTS idx_cic_ingredient_id
      ON compound_ingredient_components(ingredient_id)
      WHERE ingredient_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_cic_nested_compound_id
      ON compound_ingredient_components(nested_compound_id)
      WHERE nested_compound_id IS NOT NULL;

    -- menu_item_compound_ingredients: compound ingredients used by a menu item
    CREATE TABLE IF NOT EXISTS menu_item_compound_ingredients (
      id                     SERIAL PRIMARY KEY,
      menu_item_id           INTEGER NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
      compound_ingredient_id INTEGER NOT NULL REFERENCES compound_ingredients(id),
      quantity               NUMERIC NOT NULL DEFAULT 0,
      unit                   TEXT NOT NULL,
      created_at             TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_mici_menu_item_id
      ON menu_item_compound_ingredients(menu_item_id);
    CREATE INDEX IF NOT EXISTS idx_mici_compound_ingredient_id
      ON menu_item_compound_ingredients(compound_ingredient_id);

    -- menu_item_ingredients: assembly ingredients owned directly by a menu item
    CREATE TABLE IF NOT EXISTS menu_item_ingredients (
      id            SERIAL PRIMARY KEY,
      menu_item_id  INTEGER NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
      ingredient_id INTEGER NOT NULL REFERENCES ingredients(id),
      quantity      NUMERIC NOT NULL DEFAULT 0,
      unit          TEXT NOT NULL,
      created_at    TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_mii_menu_item_id
      ON menu_item_ingredients(menu_item_id);
    CREATE INDEX IF NOT EXISTS idx_mii_ingredient_id
      ON menu_item_ingredients(ingredient_id);
    -- inventory_transactions: refs inventory + sales_orders (both exist above)
    CREATE TABLE IF NOT EXISTS inventory_transactions (
      id             SERIAL PRIMARY KEY,
      inventory_id   INTEGER NOT NULL REFERENCES inventory(id),
      change_amount  NUMERIC NOT NULL,
      reason         TEXT,
      sales_order_id INTEGER REFERENCES sales_orders(id),
      created_at     TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  console.log('Database initialized.');
}

init().then(() => close()).catch(async err => {
  console.error(err);
  await close();
  process.exit(1);
});
