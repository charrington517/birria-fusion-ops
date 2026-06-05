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

async function seed() {
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

  await insertIfEmpty('inventory', [
    {name:'Birria Beef', category:'Food', unit:'lb', current_stock:18, min_stock:20, max_stock:80, cost:5.85, supplier:'Local Butcher', forecast_per_event:12},
    {name:'Corn Tortillas', category:'Food', unit:'pack', current_stock:6, min_stock:8, max_stock:30, cost:3.25, supplier:'Restaurant Depot', forecast_per_event:5},
    {name:'Consomé', category:'Prep', unit:'qt', current_stock:10, min_stock:8, max_stock:30, cost:2.10, supplier:'In-house', forecast_per_event:6},
    {name:'Cilantro', category:'Produce', unit:'bunch', current_stock:2, min_stock:5, max_stock:20, cost:.95, supplier:'Produce Vendor', forecast_per_event:3},
    {name:'To-Go Bowls', category:'Packaging', unit:'case', current_stock:1, min_stock:2, max_stock:8, cost:42, supplier:'Webstaurant', forecast_per_event:1}
  ]);

  await insertIfEmpty('menu_items', [
    {name:'Quesabirria Tacos', category:'Signature', price:14, cost:4.2, active:true, description:'3 crispy tacos with consommé', prep_notes:'Dip tortillas in birria oil; crisp on flat top.'},
    {name:'Birria Ramen', category:'Fusion', price:16, cost:5.1, active:true, description:'Ramen with birria consommé', prep_notes:'Keep broth hot; add meat last.'},
    {name:'Birria Torta', category:'Sandwich', price:15, cost:4.75, active:true, description:'Toasted torta with birria and cheese', prep_notes:'Toast roll hard enough to hold juice.'}
  ]);

  await insertIfEmpty('catering', [
    {client:'Toledo Summer Festival', date:'2026-05-18', guests:200, status:'Quote Sent', value:3800, deposit:0, location:'Toledo, OR', service_type:'Truck Service', notes:'Needs staffing estimate', readiness:62},
    {client:'Lincoln City Chamber', date:'2026-05-11', guests:85, status:'Booked', value:1650, deposit:500, location:'Lincoln City, OR', service_type:'On-Premise', notes:'Taco bar + ramen station', readiness:86}
  ]);

  await insertIfEmpty('events', [
    {name:'Toledo Market Day', date:'2026-05-10', location:'Toledo, OR', status:'Confirmed', expected_sales:1800, notes:'High lunch rush expected.'}
  ]);

  await insertIfEmpty('staff', [
    {name:'Chance', role:'Owner', status:'active', hours:28, food_card_expiry:'2027-02-14', notes:'Owner/operator'},
    {name:'Maria', role:'Cook', status:'clocked-in', hours:34, food_card_expiry:'2026-06-01', notes:'Strong on line service'},
    {name:'Jasmine', role:'Prep', status:'clocked-in', hours:39, food_card_expiry:'2026-09-10', notes:'Overtime watch'}
  ]);

  await insertIfEmpty('equipment', [
    {name:'Generator', status:'Maintenance Due', location:'Trailer', qr_code:'EQ-GEN-001', quantity_total:1, quantity_available:1, notes:'Oil change due this week'},
    {name:'Hot Holding Cabinet', status:'Available', location:'Truck', qr_code:'EQ-HOT-002', quantity_total:1, quantity_available:1, notes:'Ready'}
  ]);

  await insertIfEmpty('suppliers', [
    {name:'Restaurant Depot', category:'Food/Supplies', notes:'Bulk tortillas, noodles, paper goods'},
    {name:'Local Butcher', category:'Meat', notes:'Chuck, shank, ribs/cheeks'}
  ]);

  await insertIfEmpty('tasks', [
    {title:'Prep 18 lb birria batch', category:'Prep', status:'Open', priority:'High', due_time:'9:00 AM', notes:'Needed for weekend demand'},
    {title:'Check tortillas and consommé', category:'Inventory', status:'Open', priority:'Medium', due_time:'11:30 AM', notes:'Verify before lunch rush'}
  ]);

  await insertIfEmpty('playbook', [
    {title:'Brand Voice', category:'Brand', content:'Bold, friendly, welcoming, premium. Avoid cartoon/gimmick/cheap feel.'},
    {title:'Rush Service Rule', category:'Operations', content:'Keep menu tight, prep visible, call out bottlenecks early, protect consommé quality.'}
  ]);

  await insertIfEmpty('recipe_ingredients', [
    {recipe_id:1, ingredient_id:1, quantity:8, unit:'lb'},
    {recipe_id:1, ingredient_id:3, quantity:4, unit:'lb'},
    {recipe_id:1, ingredient_id:2, quantity:3, unit:'oz'}
  ]);

  await insertIfEmpty('ingredients', [
    {name:'Chuck Roast', category:'Meat', unit:'lb', quantity:20, cost:5.85, supplier:'Local Butcher', notes:'Primary birria protein'},
    {name:'Dried Guajillo Chiles', category:'Spice', unit:'oz', quantity:16, cost:0.45, supplier:'Restaurant Depot', notes:'Key flavor base'},
    {name:'Beef Shank', category:'Meat', unit:'lb', quantity:10, cost:4.20, supplier:'Local Butcher', notes:'Adds richness to consomme'}
  ]);

  await insertIfEmpty('expenses', [
    {title:'Propane Refill', category:'Operations', amount:85, date:'2026-05-01', notes:'Monthly truck fuel'},
    {title:'Commissary Fee', category:'Compliance', amount:350, date:'2026-05-01', notes:'Monthly commissary kitchen access'}
  ]);

  await insertIfEmpty('recipes', [
    {name:'Birria Consomme Base', category:'Prep', yield_amount:12, yield_unit:'qt', notes:'Core broth. Simmer 4hrs minimum.'},
    {name:'Quesabirria Assembly', category:'Service', yield_amount:1, yield_unit:'plate', notes:'Dip tortilla in birria oil, crisp on flat top, fill and fold.'}
  ]);

  // Map ingredients to inventory items
  await query('UPDATE ingredients SET inventory_item_id=1 WHERE id=1 AND inventory_item_id IS NULL');
  // Chuck Roast (ingredient 1) -> Birria Beef (inventory 1)

  // Link menu items to recipes via recipe_id
  await query('UPDATE menu_items SET recipe_id=2 WHERE id=1 AND recipe_id IS NULL');
  // Quesabirria Tacos (id=1) -> Quesabirria Assembly (recipe id=2)

  await query('INSERT INTO activity (message) VALUES ($1)', ['Production AI foundation seeded']);
  console.log('Seed complete. Login admin/admin123 unless .env changed.');
}

seed().then(() => close()).catch(async err => {
  console.error(err);
  await close();
  process.exit(1);
});
