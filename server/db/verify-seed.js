require('dotenv').config();
const { query, close } = require('./pool');

// Expected counts matching live production state
const EXPECTED = {
  inventory:           14,
  ingredients:         14,
  recipes:             4,
  recipe_ingredients:  24,
  menu_items:          3,
  catering:            2,
  events:              1,
  staff:               3,
  equipment:           2,
  suppliers:           2,
  tasks:               2,
  playbook:            2,
  expenses:            3,
  compound_ingredients:             2,
  compound_ingredient_components:   6,
  menu_item_compound_ingredients:   6,
  menu_item_ingredients:            17,
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
  'Quesabirria Assembly': 5,
  'Birria Ramen':         9,
  'Birria Torta':         7,
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


  // -- Compound ingredient checks -------------------------------------------
  console.log('\nCompound ingredient checks:');

  const ciRes = await query(
    'SELECT id, name, yield_amount, yield_unit, active FROM compound_ingredients WHERE name=$1',
    ['Birria Consom\u00e9 Base']
  );
  if (!ciRes.rows.length) {
    fail('"Birria Consom\u00e9 Base"', 'compound ingredient not found');
  } else {
    const ci = ciRes.rows[0];
    if (ci.active && Number(ci.yield_amount) === 12 && ci.yield_unit === 'qt') {
      pass('"Birria Consom\u00e9 Base" exists: yield=' + ci.yield_amount + ' ' + ci.yield_unit + ', active=' + ci.active);
    } else {
      fail('"Birria Consom\u00e9 Base"', 'expected yield=12 qt active=true, got yield=' + ci.yield_amount + ' ' + ci.yield_unit + ' active=' + ci.active);
    }
    const compId = ci.id;
    const compRes = await query(
      `SELECT c.quantity, c.unit, i.name AS ing_name, c.nested_compound_id
       FROM compound_ingredient_components c
       LEFT JOIN ingredients i ON i.id = c.ingredient_id
       WHERE c.parent_id = $1 ORDER BY i.name`,
      [compId]
    );
    const expectedComponents = [
      { name: 'Beef Shank',            qty: 4, unit: 'lb' },
      { name: 'Chuck Roast Updated',   qty: 8, unit: 'lb' },
      { name: 'Dried Guajillo Chiles', qty: 3, unit: 'oz' },
    ];
    if (compRes.rows.length !== 3) {
      fail('"Birria Consom\u00e9 Base" components', 'expected 3, got ' + compRes.rows.length);
    } else {
      for (let j = 0; j < expectedComponents.length; j++) {
        const exp = expectedComponents[j];
        const got = compRes.rows[j];
        if (got.ing_name === exp.name && Number(got.quantity) === exp.qty && got.unit === exp.unit && got.nested_compound_id === null) {
          pass('"Birria Consom\u00e9 Base" component: ' + exp.name + ' x' + exp.qty + ' ' + exp.unit);
        } else {
          fail('"Birria Consom\u00e9 Base" component', 'expected ' + exp.name + ' x' + exp.qty + ' ' + exp.unit + ', got ' + got.ing_name + ' x' + got.quantity + ' ' + got.unit);
        }
      }
    }
    const batchRes = await query(
      `SELECT ROUND(SUM((i.cost / NULLIF(i.servings_per_purchase, 0)) * c.quantity)::numeric, 2) AS batch_cost
       FROM compound_ingredient_components c
       JOIN ingredients i ON i.id = c.ingredient_id
       WHERE c.parent_id = $1`,
      [compId]
    );
    const batchCost = Number(batchRes.rows[0].batch_cost);
    const cpq = batchCost / 12;
    if (Math.abs(batchCost - 64.95) < 0.01) {
      pass('"Birria Consom\u00e9 Base" batch cost: $' + batchCost + ' ($' + cpq.toFixed(4) + '/qt)');
    } else {
      fail('"Birria Consom\u00e9 Base" batch cost', 'expected $64.95, got $' + batchCost);
    }
    const xorRes = await query(
      `SELECT COUNT(*)::int AS bad FROM compound_ingredient_components
       WHERE parent_id = $1 AND ingredient_id IS NOT NULL AND nested_compound_id IS NOT NULL`,
      [compId]
    );
    if (xorRes.rows[0].bad === 0) {
      pass('"Birria Consom\u00e9 Base" XOR constraint satisfied');
    } else {
      fail('"Birria Consom\u00e9 Base" XOR constraint', xorRes.rows[0].bad + ' rows violate rule');
    }
  }


  // ── menu_item_ingredients subtotal checks ─────────────────────────────────
  console.log('\nMenu item ingredient subtotals:');
  const miiItems = [
    { id: 1, name: 'Quesabirria Tacos', expected_subtotal: 1.7357 },
    { id: 2, name: 'Birria Ramen',      expected_subtotal: 1.6425 },
    { id: 3, name: 'Birria Torta',      expected_subtotal: 2.2925 },
  ];
  for (const item of miiItems) {
    const res = await query(
      `SELECT ROUND(SUM((i.cost / NULLIF(i.servings_per_purchase,0)) * mii.quantity)::numeric, 4) AS subtotal
       FROM menu_item_ingredients mii
       JOIN ingredients i ON i.id = mii.ingredient_id
       WHERE mii.menu_item_id = $1`,
      [item.id]
    );
    const actual = Number(res.rows[0].subtotal);
    if (Math.abs(actual - item.expected_subtotal) < 0.001) {
      pass('"' + item.name + '" mii subtotal: $' + actual);
    } else {
      fail('"' + item.name + '" mii subtotal', 'expected $' + item.expected_subtotal + ', got $' + actual);
    }
  }


  // ── Recipe cookbook content checks ─────────────────────────────────────────
  console.log('\nRecipe cookbook content:');
  const cookbookChecks = [
    { id: 1, name: 'Birria Consomme Base', expect_prep: '30 min', expect_cook: '4 hours' },
    { id: 2, name: 'Quesabirria Assembly', expect_prep: '5 min',  expect_cook: '8 min'   },
    { id: 3, name: 'Birria Ramen',         expect_prep: '5 min',  expect_cook: '10 min'  },
    { id: 4, name: 'Birria Torta',         expect_prep: '5 min',  expect_cook: '8 min'   },
  ];
  for (const check of cookbookChecks) {
    const res = await query(
      'SELECT prep_time, cook_time, instructions FROM recipes WHERE id=$1',
      [check.id]
    );
    const r = res.rows[0];
    const hasInstr = r && r.instructions && r.instructions.length > 50;
    const prepOk = r && r.prep_time === check.expect_prep;
    const cookOk = r && r.cook_time === check.expect_cook;
    if (hasInstr && prepOk && cookOk) {
      pass('"' + check.name + '" prep=' + r.prep_time + ' cook=' + r.cook_time + ' instructions=' + r.instructions.length + 'chars');
    } else {
      fail('"' + check.name + '"', 'prep=' + (r?.prep_time||'missing') + ' cook=' + (r?.cook_time||'missing') + ' instructions=' + (hasInstr?'ok':'missing'));
    }
  }


  // ── Ramen Phase 3 compound rows ────────────────────────────────────────────
  console.log('\nRamen Phase 3 compound rows:');
  const ramenMici = await query(
    `SELECT mici.compound_ingredient_id, ci.name, mici.quantity, mici.unit
     FROM menu_item_compound_ingredients mici
     JOIN compound_ingredients ci ON ci.id = mici.compound_ingredient_id
     WHERE mici.menu_item_id = 2 ORDER BY mici.compound_ingredient_id`,
    []
  );
  if (ramenMici.rows.length !== 2) {
    fail('"Birria Ramen" compound rows', 'expected 2, got ' + ramenMici.rows.length);
  } else {
    const bm = ramenMici.rows.find(r => r.name === 'Birria Meat');
    const cb = ramenMici.rows.find(r => r.name.includes('Consom'));
    if (bm && Number(bm.quantity) === 0.25 && bm.unit === 'lb') {
      pass('"Birria Ramen" Birria Meat: ' + bm.quantity + ' ' + bm.unit);
    } else {
      fail('"Birria Ramen" Birria Meat', 'expected 0.25 lb, got ' + (bm?.quantity||'missing') + ' ' + (bm?.unit||''));
    }
    if (cb && Number(cb.quantity) === 0.75 && cb.unit === 'qt') {
      pass('"Birria Ramen" Consomé Base: ' + cb.quantity + ' ' + cb.unit);
    } else {
      fail('"Birria Ramen" Consomé Base', 'expected 0.75 qt, got ' + (cb?.quantity||'missing') + ' ' + (cb?.unit||''));
    }
  }

  // Ramen total cost sanity
  const ramenCostRes = await query(
    `SELECT
       ROUND(SUM((i.cost / NULLIF(i.servings_per_purchase,0)) * mii.quantity)::numeric, 4) AS ing_cost
     FROM menu_item_ingredients mii
     JOIN ingredients i ON i.id = mii.ingredient_id
     WHERE mii.menu_item_id = 2`,
    []
  );
  const ingCost = Number(ramenCostRes.rows[0].ing_cost);
  const compCost = 0.25 * 8.525 + 0.75 * 5.4125;
  const totalCost = ingCost + compCost;
  if (Math.abs(totalCost - 7.8331) < 0.01) {
    pass('"Birria Ramen" total cost: $' + totalCost.toFixed(4) + ' (ing $' + ingCost + ' + comp $' + compCost.toFixed(4) + ')');
  } else {
    fail('"Birria Ramen" total cost', 'expected ~$7.83, got $' + totalCost.toFixed(4));
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
