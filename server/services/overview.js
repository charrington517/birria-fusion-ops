const { query } = require('../db/pool');

function margin(price, cost) {
  price = Number(price || 0);
  cost = Number(cost || 0);
  return price ? ((price - cost) / price) * 100 : 0;
}

async function buildOverview() {
  const [inventory, menu, catering, events, staff, equipment, suppliers, tasks, playbook, activity, ingredients, recipes] = await Promise.all([
    query('SELECT * FROM inventory ORDER BY id DESC'),
    query('SELECT * FROM menu_items ORDER BY id DESC'),
    query('SELECT * FROM catering ORDER BY date NULLS LAST'),
    query('SELECT * FROM events ORDER BY date NULLS LAST'),
    query('SELECT * FROM staff ORDER BY id DESC'),
    query('SELECT * FROM equipment ORDER BY id DESC'),
    query('SELECT * FROM suppliers ORDER BY id DESC'),
    query('SELECT * FROM tasks ORDER BY id DESC'),
    query('SELECT * FROM playbook ORDER BY id DESC'),
    query('SELECT * FROM activity ORDER BY created_at DESC LIMIT 50'),
    query('SELECT * FROM ingredients ORDER BY id DESC'),
    query('SELECT * FROM recipes ORDER BY id DESC')
  ]);

  const inv = inventory.rows;
  const menuRows = menu.rows;
  const cat = catering.rows;
  const staffRows = staff.rows;
  const equip = equipment.rows;
  const taskRows = tasks.rows;

  const low = inv.filter(x => Number(x.current_stock) <= Number(x.min_stock));
  const nearOvertime = staffRows.filter(x => Number(x.hours || 0) >= 38);
  const maint = equip.filter(x => String(x.status || '').toLowerCase().includes('maintenance'));
  const lowMargins = menuRows.filter(x => margin(x.price, x.cost) < 30);

  const insights = [
    ...low.map(x => ({ level:'Critical', title:`${x.name} is low`, detail:`${x.current_stock} ${x.unit} on hand. Minimum ${x.min_stock}.`, action:'Create purchase task' })),
    ...nearOvertime.map(x => ({ level:'Warning', title:`${x.name} is near overtime`, detail:`${x.hours} hours logged.`, action:'Review schedule' })),
    ...maint.map(x => ({ level:'Warning', title:`${x.name} needs maintenance`, detail:x.notes || x.status, action:'Schedule maintenance' })),
    ...lowMargins.map(x => ({ level:'Warning', title:`Low margin menu item`, detail:`${x.name}: ${margin(x.price, x.cost).toFixed(1)}%`, action:'Review pricing' }))
  ].slice(0, 20);

  const avgMargin = menuRows.length ? menuRows.reduce((s,x)=>s+margin(x.price,x.cost),0)/menuRows.length : 0;

  return {
    metrics: {
      inventory_alerts: low.length,
      inventory_value: inv.reduce((s,x)=>s + Number(x.current_stock||0)*Number(x.cost||0), 0),
      catering_pipeline: cat.reduce((s,x)=>s + Number(x.value||0), 0),
      open_tasks: taskRows.filter(x => x.status !== 'Done').length,
      active_staff: staffRows.filter(x => ['active','clocked-in'].includes(String(x.status).toLowerCase())).length,
      avg_menu_margin: Number(avgMargin.toFixed(1))
    },
    insights,
    timeline: [
      ...taskRows.map(x => ({ kind:'Task', time:x.due_time || 'Today', title:x.title, type:x.category, status:x.status, priority:x.priority })),
      ...cat.map(x => ({ kind:'Catering', time:x.date, title:x.client, type:x.service_type, status:x.status, priority:Number(x.readiness)<70?'High':'Normal' })),
      ...events.rows.map(x => ({ kind:'Event', time:x.date, title:x.name, type:x.location, status:x.status, priority:'Normal' }))
    ].slice(0, 30),
    data: {
      inventory: inv,
      menu: menuRows,
      catering: cat,
      events: events.rows,
      staff: staffRows,
      equipment: equip,
      suppliers: suppliers.rows,
      tasks: taskRows,
      playbook: playbook.rows,
      activity: activity.rows,
      ingredients: ingredients.rows,
      recipes: recipes.rows
    }
  };
}

module.exports = { buildOverview, margin };
