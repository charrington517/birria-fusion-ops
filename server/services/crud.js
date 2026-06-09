const { query } = require('../db/pool');

const tableMap = {
  inventory: 'inventory',
  menu: 'menu_items',
  catering: 'catering',
  events: 'events',
  staff: 'staff',
  equipment: 'equipment',
  suppliers: 'suppliers',
  ingredients: 'ingredients',
  vendors: 'suppliers',
  expenses: 'expenses',
  recipes: 'recipes',
  'recipe-ingredients': 'recipe_ingredients',
  'inventory-transactions': 'inventory_transactions',
  tasks: 'tasks',
  playbook: 'playbook',
  activity: 'activity'
};

const writableFields = {
  inventory: ['name','category','unit','current_stock','min_stock','max_stock','cost','supplier','forecast_per_event'],
  menu: ['name','category','price','cost','active','description','prep_notes','recipe_id','portions'],
  catering: ['client','date','guests','status','value','deposit','location','service_type','notes','readiness'],
  events: ['name','date','location','status','expected_sales','notes'],
  staff: ['name','role','status','hours','food_card_expiry','phone','notes'],
  equipment: ['name','status','location','qr_code','quantity_total','quantity_available','notes'],
  suppliers: ['name','category','phone','email','notes'],
  ingredients: ['name','category','unit','quantity','cost','supplier','notes','servings_per_purchase','inventory_item_id'],
  vendors: ['name','category','phone','email','notes'],
  expenses: ['title','category','amount','date','notes','event_id'],
  recipes: ['name','category','yield_amount','yield_unit','notes','prep_time','cook_time','instructions'],
  'recipe-ingredients': ['recipe_id','ingredient_id','quantity','unit'],
  tasks: ['title','category','status','priority','due_time','notes'],
  playbook: ['title','category','content']
};

function getTable(collection) {
  const table = tableMap[collection];
  if (!table) throw new Error('Unknown collection');
  return table;
}

async function list(collection) {
  const table = getTable(collection);
  const order = collection === 'activity' ? 'created_at DESC' : 'id DESC';
  const result = await query(`SELECT * FROM ${table} ORDER BY ${order}`);
  return result.rows;
}

async function create(collection, data) {
  const table = getTable(collection);
  const allowed = writableFields[collection] || [];
  const keys = Object.keys(data).filter(k => allowed.includes(k));
  if (!keys.length) throw new Error('No valid fields');
  const values = keys.map(k => data[k]);
  const params = keys.map((_, i) => `$${i+1}`).join(',');
  const result = await query(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${params}) RETURNING *`, values);
  await activity(`Added ${collection}: ${data.name || data.title || data.client || result.rows[0].id}`);
  return result.rows[0];
}

async function update(collection, id, data) {
  const table = getTable(collection);
  const allowed = writableFields[collection] || [];
  const keys = Object.keys(data).filter(k => allowed.includes(k));
  if (!keys.length) throw new Error('No valid fields');
  const sets = keys.map((k, i) => `${k}=$${i+1}`).join(',');
  const values = keys.map(k => data[k]);
  values.push(id);
  const result = await query(`UPDATE ${table} SET ${sets} WHERE id=$${values.length} RETURNING *`, values);
  if (!result.rows[0]) return null;
  await activity(`Updated ${collection}: ${data.name || data.title || data.client || id}`);
  return result.rows[0];
}

async function remove(collection, id) {
  const table = getTable(collection);
  const result = await query(`DELETE FROM ${table} WHERE id=$1 RETURNING *`, [id]);
  if (result.rows[0]) await activity(`Deleted ${collection} item ${id}`);
  return result.rows[0];
}

async function activity(message) {
  await query('INSERT INTO activity (message) VALUES ($1)', [message]);
}

module.exports = { tableMap, list, create, update, remove, activity };
