require('dotenv').config();
const { query, close } = require('./pool');

// Expected counts matching live production state
const EXPECTED = {
  inventory:           14,
  ingredients:         14,
  recipes:             4,
  recipe_ingredients:  29,
  menu_items:          3,
  catering:            2,
  events:              1,
  staff:               3,
  equipment:           2,
  suppliers:           2,
  tasks:               2,
  playbook:            2,
  expenses:            3,
};

// Expected FK linkages verified by name
const EXPECTED_INGREDIENT_INV_LINKS = [
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

const EXPECTED_MENU_RECIPE_LINKS = [
  ['Quesabirria Tacos', 'Quesabirria Assembly'],
  ['Birria Ramen',      'Birria Ramen'],
  ['Birria Torta',      'Birria Torta'],
];

const EXPECTED_RI_COUNTS = {
  'Birria Consomme Base': 3,
  'Quesabirria Assembly': 8,
  'Birria Ramen':         9,
  'Birria Torta':         9,
};

async function verify() {
  let passed = 0;
  let failed = 0;

  function pass(label) {
    console.log(`  \u2705 ${label}`);
    passed++;
  }
  function fail(label, detail) {
    console.error(`  \u274c ${label}${detail ? ' — ' + detail : ''}`);
    failed++;
  }

  // ── Row counts ─────────────────────────────────────────────────────────────
  console.log('\nRow counts:');
  for (const [table, expected] of Object.entries(EXPECTED)) {
    const res = await query(`SELECT COUNT(*)::int AS count FROM ${table}`);
    const actual = res.rows[0].count;
    if (actual === expected) {
      pass(`${table}: ${actual}`);
    } else {
      fail(`${table}`, `expected ${expected}, got ${actual}`);
    }
  }

  // ── Ingredient -> inventory FK links ──────────────────────────────────────
  console.log('\nIngredient → inventory links:');
  for (const [ingName, invName] of EXPECTED_INGREDIENT_INV_LINKS) {
    const res = await query(
      `SELECT i.inventory_item_id, inv.name AS inv_name
       FROM ingredients i
       LEFT JOIN inventory inv ON inv.id = i.inventory_item_id
       WHERE i.name = $1`,
      [ingName]
    );
    if (!res.rows.length) {
      fail(`"${ingName}"`, 'ingredient not found');
    } else if (res.rows[0].inv_name === invName) {
      pass(`"${ingName}" -> "${invName}"`);
    } else {
      fail(`"${ingName}"`, `expected inv "${invName}", got "${res.rows[0].inv_name}"`);
    }
  }

  // ── Menu item -> recipe links ─────────────────────────────────────────────
  console.log('\nMenu item → recipe links:');
  for (const [menuName, recipeName] of EXPECTED_MENU_RECIPE_LINKS) {
    const res = await query(
      `SELECT m.recipe_id, r.name AS recipe_name
       FROM menu_items m
       LEFT JOIN recipes r ON r.id = m.recipe_id
       WHERE m.name = $1`,
      [menuName]
    );
    if (!res.rows.length) {
      fail(`"${menuName}"`, 'menu item not found');
    } else if (res.rows[0].recipe_name === recipeName) {
      pass(`"${menuName}" -> "${recipeName}"`);
    } else {
      fail(`"${menuName}"`, `expected recipe "${recipeName}", got "${res.rows[0].recipe_name}"`);
    }
  }

  // ── Recipe ingredient counts per recipe ───────────────────────────────────
  console.log('\nRecipe ingredient counts:');
  for (const [recipeName, expectedCount] of Object.entries(EXPECTED_RI_COUNTS)) {
    const res = await query(
      `SELECT COUNT(*)::int AS count FROM recipe_ingredients ri
       JOIN recipes r ON r.id = ri.recipe_id WHERE r.name = $1`,
      [recipeName]
    );
    const actual = res.rows[0].count;
    if (actual === expectedCount) {
      pass(`"${recipeName}": ${actual} ingredients`);
    } else {
      fail(`"${recipeName}"`, `expected ${expectedCount}, got ${actual}`);
    }
  }

  // ── Recipe costs sanity check ─────────────────────────────────────────────
  console.log('\nRecipe cost sanity (must be > 0):');
  const costRes = await query(
    `SELECT r.name,
            ROUND(SUM(ri.quantity * (i.cost / NULLIF(i.servings_per_purchase, 0)))::numeric, 2) AS cost
     FROM recipes r
     JOIN recipe_ingredients ri ON ri.recipe_id = r.id
     JOIN ingredients i ON i.id = ri.ingredient_id
     GROUP BY r.name ORDER BY r.name`
  );
  for (const row of costRes.rows) {
    if (row.cost > 0) {
      pass(`"${row.name}" cost: $${row.cost}`);
    } else {
      fail(`"${row.name}"`, 'cost is $0 — missing recipe_ingredients or ingredient costs');
    }
  }


  // ── servings_per_purchase correctness ─────────────────────────────────────
  console.log('\nServings per purchase (spp) checks:');
  const sppExpected = [
    { name: 'Corn Tortilla',   cost: 3.25,  spp: 22,  cps: 3.25/22 },
    { name: 'To-Go Bowl',      cost: 42.00, spp: 100, cps: 42.00/100 },
    { name: 'Oaxaca Cheese',   cost: 6.00,  spp: 16,  cps: 6.00/16 },
    { name: 'Jalapeño Slice', cost: 0.25, spp: 10, cps: 0.25/10 },
  ];
  for (const exp of sppExpected) {
    const res = await query(
      'SELECT cost::float AS cost, servings_per_purchase::float AS spp FROM ingredients WHERE name=$1',
      [exp.name]
    );
    if (!res.rows.length) {
      fail('"' + exp.name + '"', 'ingredient not found');
      continue;
    }
    const { cost, spp } = res.rows[0];
    const cps = cost / spp;
    if (Math.abs(cost - exp.cost) < 0.001 && Math.abs(spp - exp.spp) < 0.1) {
      pass('"' + exp.name + '" cost=' + cost + ' spp=' + spp + ' cps=' + cps.toFixed(4));
    } else {
      fail('"' + exp.name + '"', 'expected cost=' + exp.cost + ' spp=' + exp.spp + ', got cost=' + cost + ' spp=' + spp);
    }
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log(`\n${'─'.repeat(50)}`);
  console.log(`Result: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.error('SEED VERIFICATION FAILED — DB rebuild will not match production.');
    process.exit(1);
  } else {
    console.log('SEED VERIFICATION PASSED — DB rebuild matches production.');
  }
}

verify().then(() => close()).catch(async err => {
  console.error(err);
  await close();
  process.exit(1);
});
