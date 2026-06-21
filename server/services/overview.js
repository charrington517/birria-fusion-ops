const { query } = require('../db/pool');

function margin(price, cost) {
  price = Number(price || 0);
  cost = Number(cost || 0);
  return price ? ((price - cost) / price) * 100 : 0;
}

async function buildOverview() {
  const [inventory, menu, catering, events, staff, equipment, suppliers, tasks, playbook, activity, ingredients, recipes, compounds, expenses] = await Promise.all([
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
    query('SELECT * FROM recipes ORDER BY id DESC'),
    query('SELECT * FROM compound_ingredients ORDER BY id DESC'),
    query('SELECT * FROM expenses ORDER BY date DESC')
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
  const today = new Date(); today.setHours(0,0,0,0);
  const in30 = new Date(today); in30.setDate(in30.getDate()+30);
  const membershipAlerts = suppliers.rows.filter(s => s.membership_required && s.membership_expiration).map(s => {
    const exp = new Date(s.membership_expiration); exp.setHours(0,0,0,0);
    const daysLeft = Math.ceil((exp - today) / 86400000);
    if (exp < today) return { level:'Critical', title:`${s.name} membership expired`, detail:`Expired ${s.membership_expiration}`, action:'Renew membership' };
    if (exp <= in30) return { level:'Warning', title:`${s.name} membership expiring soon`, detail:`Expires in ${daysLeft} day${daysLeft===1?'':'s'} (${s.membership_expiration})`, action:'Renew membership' };
    return null;
  }).filter(Boolean);

  const insights = [
    ...membershipAlerts,
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
      suppliers: suppliers.rows.map(s => {
        const sid = s.id;
        const linked = inv.filter(i => Number(i.supplier_id) === sid);
        const linked_count = linked.length;
        const low_count = linked.filter(i =>
          Number(i.min_stock) > 0 &&
          Number(i.current_stock) > 0 &&
          Number(i.current_stock) <= Number(i.min_stock)
        ).length;
        const out_count = linked.filter(i =>
          Number(i.min_stock) > 0 &&
          Number(i.current_stock) <= 0
        ).length;
        return { ...s, linked_count, low_count, out_count };
      }),
      tasks: taskRows,
      playbook: playbook.rows,
      activity: activity.rows,
      ingredients: ingredients.rows,
      recipes: recipes.rows,
      compounds: compounds.rows,
      expenses: expenses.rows
    }
  };
}

module.exports = { buildOverview, margin };
