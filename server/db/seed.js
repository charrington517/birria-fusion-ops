require('dotenv').config();
const bcrypt = require('bcryptjs');
const { query, close } = require('./pool');

async function insertIfEmpty(table, rows) {
  const count = await query(`SELECT COUNT(*)::int AS count FROM ${table}`);
  if (count.rows[0].count > 0) return;
  for (const row of rows) {
    const keys = Object.keys(row);
    const values = Object.values(row);
    const params = keys.map((_, i) => `$${i + 1}`).join(',');
    await query(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${params})`, values);
  }
}

async function lookupId(table, nameCol, name) {
  const res = await query(`SELECT id FROM ${table} WHERE ${nameCol}=$1`, [name]);
  if (!res.rows.length) throw new Error(`seed: ${table} row not found: "${name}"`);
  return res.rows[0].id;
}

async function seed() {
  // ── Users ─────────────────────────────────────────────────────────────────
  const username = process.env.DEFAULT_ADMIN_USERNAME || 'admin';
  const password = process.env.DEFAULT_ADMIN_PASSWORD || 'admin123';
  const existing = await query('SELECT id FROM users WHERE username=$1', [username]);
  if (!existing.rows.length) {
    const hash = await bcrypt.hash(password, 10);
    await query(
      'INSERT INTO users (username, password_hash, name, role) VALUES ($1,$2,$3,$4)',
      [username, hash, 'Chance', 'Owner']
    );
  }

  // ── Inventory (ALL 14 items in one block) ─────────────────────────────────
  await insertIfEmpty('inventory', [
    { name: 'Birria Beef',           category: 'Food',      unit: 'lb',      current_stock: 18, min_stock: 20, max_stock: 80, cost: 5.85, supplier: 'Local Butcher',    forecast_per_event: 12 },
    { name: 'Corn Tortillas',        category: 'Food',      unit: 'pack',    current_stock: 6,  min_stock: 8,  max_stock: 30, cost: 3.25, supplier: 'Restaurant Depot', forecast_per_event: 5  },
    { name: 'Consom\u00e9',          category: 'Prep',      unit: 'qt',      current_stock: 10, min_stock: 8,  max_stock: 30, cost: 2.10, supplier: 'In-house',         forecast_per_event: 6  },
    { name: 'Cilantro',              category: 'Produce',   unit: 'bunch',   current_stock: 2,  min_stock: 5,  max_stock: 20, cost: 0.95, supplier: 'Produce Vendor',   forecast_per_event: 3  },
    { name: 'To-Go Bowls',           category: 'Packaging', unit: 'case',    current_stock: 1,  min_stock: 2,  max_stock: 8,  cost: 42,   supplier: 'Webstaurant',      forecast_per_event: 1  },
    { name: 'Beef Shank',            category: 'Meat',      unit: 'lb',      current_stock: 0,  min_stock: 0,  cost: 4.20 },
    { name: 'Dried Guajillo Chiles', category: 'Spice',     unit: 'oz',      current_stock: 0,  min_stock: 0,  cost: 0.45 },
    { name: 'White Onion',           category: 'Produce',   unit: 'each',    current_stock: 0,  min_stock: 0,  cost: 0.75 },
    { name: 'Oaxaca Cheese',         category: 'Dairy',     unit: 'lb',      current_stock: 0,  min_stock: 0,  cost: 6.00 },
    { name: 'Ramen Noodles',         category: 'Dry Goods', unit: 'serving', current_stock: 0,  min_stock: 0,  cost: 0.75 },
    { name: 'Eggs',                  category: 'Dairy',     unit: 'each',    current_stock: 0,  min_stock: 0,  cost: 0.35 },
    { name: 'Bolillo Roll',          category: 'Bakery',    unit: 'each',    current_stock: 0,  min_stock: 0,  cost: 0.65 },
    { name: 'Refried Beans',         category: 'Pantry',    unit: 'oz',      current_stock: 0,  min_stock: 0,  cost: 0.15 },
    { name: 'Jalape\u00f1o',   category: 'Produce',   unit: 'each',    current_stock: 0,  min_stock: 0,  cost: 0.25 },
  ]);

  // ── Ingredients (ALL 14 in one block) ─────────────────────────────────────
  await insertIfEmpty('ingredients', [
    { name: 'Chuck Roast Updated',   category: 'Meat',      unit: 'lb',      cost: 5.85  },
    { name: 'Dried Guajillo Chiles', category: 'Spice',     unit: 'oz',      cost: 0.45  },
    { name: 'Beef Shank',            category: 'Meat',      unit: 'lb',      cost: 4.20  },
    { name: 'Corn Tortilla',         category: 'Grain',     unit: 'each',    cost: 3.25,  servings_per_purchase: 22  },
    { name: 'Consom\u00e9',          category: 'Prep',      unit: 'qt',      cost: 2.10  },
    { name: 'Cilantro',              category: 'Produce',   unit: 'bunch',   cost: 0.95  },
    { name: 'To-Go Bowl',            category: 'Packaging', unit: 'each',    cost: 42.00, servings_per_purchase: 100 },
    { name: 'Oaxaca Cheese',         category: 'Dairy',     unit: 'oz',      cost: 6.00,  servings_per_purchase: 16  },
    { name: 'White Onion',           category: 'Produce',   unit: 'each',    cost: 0.75  },
    { name: 'Ramen Noodles',         category: 'Dry Goods', unit: 'serving', cost: 0.75  },
    { name: 'Egg',                   category: 'Dairy',     unit: 'each',    cost: 0.35  },
    { name: 'Bolillo Roll',          category: 'Bakery',    unit: 'each',    cost: 0.65  },
    { name: 'Refried Beans',         category: 'Pantry',    unit: 'oz',      cost: 0.15  },
    { name: 'Jalape\u00f1o Slice', category: 'Produce', unit: 'slice',  cost: 0.25,  servings_per_purchase: 10  },
  ]);

  // Link ingredients -> inventory by name
  const ingToInv = [
    ['Chuck Roast Updated',   'Birria Beef'],
    ['Dried Guajillo Chiles', 'Dried Guajillo Chiles'],
    ['Beef Shank',            'Beef Shank'],
    ['Corn Tortilla',         'Corn Tortillas'],
    ['Consom\u00e9',          'Consom\u00e9'],
    ['Cilantro',              'Cilantro'],
    ['To-Go Bowl',            'To-Go Bowls'],
    ['Oaxaca Cheese',         'Oaxaca Cheese'],
    ['White Onion',           'White Onion'],
    ['Ramen Noodles',         'Ramen Noodles'],
    ['Egg',                   'Eggs'],
    ['Bolillo Roll',          'Bolillo Roll'],
    ['Refried Beans',         'Refried Beans'],
    ['Jalape\u00f1o Slice', 'Jalape\u00f1o'],
  ];
  for (const [ingName, invName] of ingToInv) {
    const invId = await lookupId('inventory', 'name', invName);
    await query(
      'UPDATE ingredients SET inventory_item_id=$1 WHERE name=$2 AND inventory_item_id IS NULL',
      [invId, ingName]
    );
  }

  // ── Recipes (ALL 4 in one block) ──────────────────────────────────────────
  await insertIfEmpty('recipes', [
    { name: 'Birria Consomme Base', category: 'Prep',      yield_amount: 12, yield_unit: 'qt',       notes: 'Core broth. Simmer 4hrs minimum.' },
    { name: 'Quesabirria Assembly', category: 'Service',   yield_amount: 1,  yield_unit: 'plate',    notes: 'Dip tortilla in birria oil, crisp on flat top, fill and fold.' },
    { name: 'Birria Ramen',         category: 'Signature', yield_amount: 1,  yield_unit: 'bowl',     notes: 'Birria broth ramen with consom\u00e9 base' },
    { name: 'Birria Torta',         category: 'Signature', yield_amount: 1,  yield_unit: 'sandwich', notes: 'Toasted torta with birria and cheese' },
  ]);

  // ── Recipe Ingredients (ALL 29 rows, FKs resolved by name) ───────────────
  const riCount = await query('SELECT COUNT(*)::int AS count FROM recipe_ingredients');
  if (riCount.rows[0].count === 0) {
    const rConsomme    = await lookupId('recipes', 'name', 'Birria Consomme Base');
    const rQuesabirria = await lookupId('recipes', 'name', 'Quesabirria Assembly');
    const rRamen       = await lookupId('recipes', 'name', 'Birria Ramen');
    const rTorta       = await lookupId('recipes', 'name', 'Birria Torta');

    const iChuck    = await lookupId('ingredients', 'name', 'Chuck Roast Updated');
    const iGuajillo = await lookupId('ingredients', 'name', 'Dried Guajillo Chiles');
    const iShank    = await lookupId('ingredients', 'name', 'Beef Shank');
    const iTortilla = await lookupId('ingredients', 'name', 'Corn Tortilla');
    const iConsome  = await lookupId('ingredients', 'name', 'Consom\u00e9');
    const iCilantro = await lookupId('ingredients', 'name', 'Cilantro');
    const iBowl     = await lookupId('ingredients', 'name', 'To-Go Bowl');
    const iOaxaca   = await lookupId('ingredients', 'name', 'Oaxaca Cheese');
    const iOnion    = await lookupId('ingredients', 'name', 'White Onion');
    const iRamen    = await lookupId('ingredients', 'name', 'Ramen Noodles');
    const iEgg      = await lookupId('ingredients', 'name', 'Egg');
    const iBolillo  = await lookupId('ingredients', 'name', 'Bolillo Roll');
    const iBeans    = await lookupId('ingredients', 'name', 'Refried Beans');
    const iJalap    = await lookupId('ingredients', 'name', 'Jalape\u00f1o Slice');

    const rows = [
      // Birria Consomme Base (3)
      { recipe_id: rConsomme,    ingredient_id: iChuck,    quantity: 8,    unit: 'lb'      },
      { recipe_id: rConsomme,    ingredient_id: iShank,    quantity: 4,    unit: 'lb'      },
      { recipe_id: rConsomme,    ingredient_id: iGuajillo, quantity: 3,    unit: 'oz'      },
      // Quesabirria Assembly (8)
      { recipe_id: rQuesabirria, ingredient_id: iChuck,    quantity: 0.25, unit: 'lb'      },
      { recipe_id: rQuesabirria, ingredient_id: iGuajillo, quantity: 0.1,  unit: 'oz'      },
      { recipe_id: rQuesabirria, ingredient_id: iTortilla, quantity: 3,    unit: 'each'    },
      { recipe_id: rQuesabirria, ingredient_id: iConsome,  quantity: 0.25, unit: 'qt'      },
      { recipe_id: rQuesabirria, ingredient_id: iCilantro, quantity: 0.05, unit: 'bunch'   },
      { recipe_id: rQuesabirria, ingredient_id: iBowl,     quantity: 1,    unit: 'each'    },
      { recipe_id: rQuesabirria, ingredient_id: iOaxaca,   quantity: 2.0,  unit: 'oz'      },
      { recipe_id: rQuesabirria, ingredient_id: iOnion,    quantity: 0.1,  unit: 'each'    },
      // Birria Ramen (9)
      { recipe_id: rRamen,       ingredient_id: iChuck,    quantity: 0.2,  unit: 'lb'      },
      { recipe_id: rRamen,       ingredient_id: iShank,    quantity: 0.1,  unit: 'lb'      },
      { recipe_id: rRamen,       ingredient_id: iConsome,  quantity: 1.0,  unit: 'qt'      },
      { recipe_id: rRamen,       ingredient_id: iRamen,    quantity: 1.0,  unit: 'serving' },
      { recipe_id: rRamen,       ingredient_id: iGuajillo, quantity: 0.1,  unit: 'oz'      },
      { recipe_id: rRamen,       ingredient_id: iEgg,      quantity: 1.0,  unit: 'each'    },
      { recipe_id: rRamen,       ingredient_id: iCilantro, quantity: 0.05, unit: 'bunch'   },
      { recipe_id: rRamen,       ingredient_id: iOnion,    quantity: 0.1,  unit: 'each'    },
      { recipe_id: rRamen,       ingredient_id: iBowl,     quantity: 1.0,  unit: 'each'    },
      // Birria Torta (9)
      { recipe_id: rTorta,       ingredient_id: iChuck,    quantity: 0.2,  unit: 'lb'      },
      { recipe_id: rTorta,       ingredient_id: iConsome,  quantity: 0.25, unit: 'qt'      },
      { recipe_id: rTorta,       ingredient_id: iBolillo,  quantity: 1.0,  unit: 'each'    },
      { recipe_id: rTorta,       ingredient_id: iOaxaca,   quantity: 2.0,  unit: 'oz'      },
      { recipe_id: rTorta,       ingredient_id: iBeans,    quantity: 2.0,  unit: 'oz'      },
      { recipe_id: rTorta,       ingredient_id: iCilantro, quantity: 0.05, unit: 'bunch'   },
      { recipe_id: rTorta,       ingredient_id: iOnion,    quantity: 0.1,  unit: 'each'    },
      { recipe_id: rTorta,       ingredient_id: iJalap,    quantity: 2.0,  unit: 'slice'   },
      { recipe_id: rTorta,       ingredient_id: iBowl,     quantity: 1.0,  unit: 'each'    },
    ];
    for (const row of rows) {
      await query(
        'INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES ($1,$2,$3,$4)',
        [row.recipe_id, row.ingredient_id, row.quantity, row.unit]
      );
    }
  }

  // ── Menu Items ────────────────────────────────────────────────────────────
  await insertIfEmpty('menu_items', [
    { name: 'Quesabirria Tacos', category: 'Signature', price: 14, cost: 4.20, active: true, description: '3 crispy tacos with consomm\u00e9',        prep_notes: 'Dip tortillas in birria oil; crisp on flat top.' },
    { name: 'Birria Ramen',      category: 'Fusion',    price: 16, cost: 5.10, active: true, description: 'Ramen with birria consomm\u00e9',           prep_notes: 'Keep broth hot; add meat last.'                  },
    { name: 'Birria Torta',      category: 'Sandwich',  price: 15, cost: 4.75, active: true, description: 'Toasted torta with birria and cheese',     prep_notes: 'Toast roll hard enough to hold juice.'          },
  ]);

  // Link all 3 menu items -> recipes by name
  const menuRecipeLinks = [
    ['Quesabirria Tacos', 'Quesabirria Assembly'],
    ['Birria Ramen',      'Birria Ramen'],
    ['Birria Torta',      'Birria Torta'],
  ];
  for (const [menuName, recipeName] of menuRecipeLinks) {
    const recipeId = await lookupId('recipes', 'name', recipeName);
    await query(
      'UPDATE menu_items SET recipe_id=$1 WHERE name=$2 AND recipe_id IS NULL',
      [recipeId, menuName]
    );
  }

  // ── Supporting tables ─────────────────────────────────────────────────────
  await insertIfEmpty('catering', [
    { client: 'Toledo Summer Festival', date: '2026-05-18', guests: 200, status: 'Quote Sent', value: 3800, deposit: 0,   location: 'Toledo, OR',       service_type: 'Truck Service', notes: 'Needs staffing estimate',  readiness: 62 },
    { client: 'Lincoln City Chamber',   date: '2026-05-11', guests: 85,  status: 'Booked',     value: 1650, deposit: 500, location: 'Lincoln City, OR', service_type: 'On-Premise',    notes: 'Taco bar + ramen station', readiness: 86 },
  ]);

  await insertIfEmpty('events', [
    { name: 'Toledo Market Day', date: '2026-05-10', location: 'Toledo, OR', status: 'Confirmed', expected_sales: 1800, notes: 'High lunch rush expected.' },
  ]);

  await insertIfEmpty('staff', [
    { name: 'Chance',  role: 'Owner', status: 'active',     hours: 28, food_card_expiry: '2027-02-14', notes: 'Owner/operator'        },
    { name: 'Maria',   role: 'Cook',  status: 'clocked-in', hours: 34, food_card_expiry: '2026-06-01', notes: 'Strong on line service' },
    { name: 'Jasmine', role: 'Prep',  status: 'clocked-in', hours: 39, food_card_expiry: '2026-09-10', notes: 'Overtime watch'        },
  ]);

  await insertIfEmpty('equipment', [
    { name: 'Generator',           status: 'Maintenance Due', location: 'Trailer', qr_code: 'EQ-GEN-001', quantity_total: 1, quantity_available: 1, notes: 'Oil change due this week' },
    { name: 'Hot Holding Cabinet', status: 'Available',       location: 'Truck',   qr_code: 'EQ-HOT-002', quantity_total: 1, quantity_available: 1, notes: 'Ready'                   },
  ]);

  await insertIfEmpty('suppliers', [
    { name: 'Restaurant Depot', category: 'Food/Supplies', notes: 'Bulk tortillas, noodles, paper goods' },
    { name: 'Local Butcher',    category: 'Meat',          notes: 'Chuck, shank, ribs/cheeks'           },
  ]);

  await insertIfEmpty('tasks', [
    { title: 'Prep 18 lb birria batch',      category: 'Prep',      status: 'Open', priority: 'High',   due_time: '9:00 AM',  notes: 'Needed for weekend demand' },
    { title: 'Check tortillas and consomm\u00e9', category: 'Inventory', status: 'Open', priority: 'Medium', due_time: '11:30 AM', notes: 'Verify before lunch rush'  },
  ]);

  await insertIfEmpty('playbook', [
    { title: 'Brand Voice',       category: 'Brand',      content: 'Bold, friendly, welcoming, premium. Avoid cartoon/gimmick/cheap feel.' },
    { title: 'Rush Service Rule', category: 'Operations', content: 'Keep menu tight, prep visible, call out bottlenecks early, protect consomm\u00e9 quality.' },
  ]);

  await insertIfEmpty('expenses', [
    { title: 'Propane Refill', category: 'Operations', amount: 85,  date: '2026-05-01', notes: 'Monthly truck fuel'                },
    { title: 'Commissary Fee', category: 'Compliance', amount: 350, date: '2026-05-01', notes: 'Monthly commissary kitchen access' },
  ]);

  // Event-linked expense (idempotent)
  await query(
    'INSERT INTO expenses (title, category, amount, date, notes, event_id) SELECT $1,$2,$3,$4,$5,$6 WHERE NOT EXISTS (SELECT 1 FROM expenses WHERE event_id=1)',
    ['Toledo Market Day \u2014 Propane', 'Operations', 45, '2026-05-10', 'Propane for event day', 1]
  );

  // Link test sales_orders to Toledo Market Day
  await query('UPDATE sales_orders SET event_id=1 WHERE event_id IS NULL');


  // ── Compound Ingredients ─────────────────────────────────────────────────
  const ciCount = await query('SELECT COUNT(*)::int AS count FROM compound_ingredients');
  if (ciCount.rows[0].count === 0) {
    // Insert Birria Consomé Base as a compound ingredient
    const ciResult = await query(
      `INSERT INTO compound_ingredients (name, category, yield_amount, yield_unit, notes, active)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [
        'Birria Consomé Base',
        'Broth',
        12,
        'qt',
        'In-house birria broth. Batch yields 12 qt. Simmer 4 hrs minimum.',
        true
      ]
    );
    const compoundId = ciResult.rows[0].id;

    // Resolve ingredient IDs by name for the 3 components
    const chuckId   = await lookupId('ingredients', 'name', 'Chuck Roast Updated');
    const shankId   = await lookupId('ingredients', 'name', 'Beef Shank');
    const guajilloId = await lookupId('ingredients', 'name', 'Dried Guajillo Chiles');

    // Insert component rows: 8 lb Chuck Roast, 4 lb Beef Shank, 3 oz Guajillo
    const components = [
      { ingredient_id: chuckId,    quantity: 8, unit: 'lb' },
      { ingredient_id: shankId,    quantity: 4, unit: 'lb' },
      { ingredient_id: guajilloId, quantity: 3, unit: 'oz' },
    ];
    for (const c of components) {
      await query(
        `INSERT INTO compound_ingredient_components
           (parent_id, ingredient_id, nested_compound_id, quantity, unit)
         VALUES ($1, $2, NULL, $3, $4)`,
        [compoundId, c.ingredient_id, c.quantity, c.unit]
      );
    }
    console.log('Seeded compound ingredient: Birria Consomé Base (id=' + compoundId + ')');
  }

  await query('INSERT INTO activity (message) VALUES ($1)', ['Production AI foundation seeded']);
  console.log('Seed complete. Login: admin/admin123 (or .env overrides)');
}

seed().then(() => close()).catch(async err => {
  console.error(err);
  await close();
  process.exit(1);
});
