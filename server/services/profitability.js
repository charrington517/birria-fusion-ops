const { query } = require('../db/pool');

async function calculateEventProfit(eventId) {
  // Get event record
  const evtResult = await query('SELECT * FROM events WHERE id=$1', [eventId]);
  const event = evtResult.rows[0];
  if (!event) throw new Error('Event not found');

  // Gross sales: quantity × menu price
  const salesResult = await query(`
    SELECT
      COALESCE(SUM(so.quantity * m.price), 0) AS gross_sales,
      COALESCE(SUM(so.quantity), 0)            AS units_sold,
      COUNT(so.id)                             AS order_count
    FROM sales_orders so
    JOIN menu_items m ON m.id = so.menu_item_id
    WHERE so.event_id = $1
  `, [eventId]);
  const { gross_sales, units_sold, order_count } = salesResult.rows[0];

  // Food cost — dual method
  // Method 1: actual (from inventory_transactions)
  const actualCostResult = await query(`
    SELECT COALESCE(SUM(i.cost * ABS(it.change_amount)), 0) AS food_cost_actual
    FROM inventory_transactions it
    JOIN sales_orders so ON so.id = it.sales_order_id
    JOIN inventory i ON i.id = it.inventory_id
    WHERE so.event_id = $1
  `, [eventId]);
  const food_cost_actual = Number(actualCostResult.rows[0].food_cost_actual);

  // Method 2: estimated (menu_items.cost × quantity — always available)
  const estCostResult = await query(`
    SELECT COALESCE(SUM(so.quantity * m.cost), 0) AS food_cost_estimated
    FROM sales_orders so
    JOIN menu_items m ON m.id = so.menu_item_id
    WHERE so.event_id = $1
  `, [eventId]);
  const food_cost_estimated = Number(estCostResult.rows[0].food_cost_estimated);

  // Use actual if available and > 0, otherwise estimated
  const food_cost = food_cost_actual > 0 ? food_cost_actual : food_cost_estimated;
  const food_cost_source = food_cost_actual > 0 ? 'actual' : 'estimated';

  // Event expenses
  const expResult = await query(`
    SELECT COALESCE(SUM(amount), 0) AS event_expenses,
           json_agg(json_build_object('title', title, 'category', category, 'amount', amount)) AS expense_items
    FROM expenses
    WHERE event_id = $1
  `, [eventId]);
  const event_expenses = Number(expResult.rows[0].event_expenses);
  const expense_items = expResult.rows[0].expense_items || [];

  // Sales breakdown by menu item
  const salesBreakdownResult = await query(`
    SELECT m.name, SUM(so.quantity) AS qty, SUM(so.quantity * m.price) AS revenue,
           SUM(so.quantity * m.cost) AS cost_est
    FROM sales_orders so
    JOIN menu_items m ON m.id = so.menu_item_id
    WHERE so.event_id = $1
    GROUP BY m.name ORDER BY revenue DESC
  `, [eventId]);

  const gs = Number(gross_sales);
  const gross_profit = Number((gs - food_cost).toFixed(2));
  const net_profit   = Number((gross_profit - event_expenses).toFixed(2));
  const gross_margin = gs > 0 ? Number(((gross_profit / gs) * 100).toFixed(1)) : 0;
  const net_margin   = gs > 0 ? Number(((net_profit / gs) * 100).toFixed(1)) : 0;
  const vs_expected  = Number((gs - Number(event.expected_sales)).toFixed(2));

  return {
    event: {
      id: event.id,
      name: event.name,
      date: event.date,
      location: event.location,
      status: event.status,
      expected_sales: Number(event.expected_sales)
    },
    gross_sales: Number(gs.toFixed(2)),
    units_sold: Number(units_sold),
    order_count: Number(order_count),
    food_cost: Number(food_cost.toFixed(2)),
    food_cost_source,
    food_cost_actual: Number(food_cost_actual.toFixed(2)),
    food_cost_estimated: Number(food_cost_estimated.toFixed(2)),
    event_expenses: Number(event_expenses.toFixed(2)),
    expense_items,
    gross_profit,
    net_profit,
    gross_margin_percent: gross_margin,
    net_margin_percent: net_margin,
    vs_expected,
    sales_breakdown: salesBreakdownResult.rows.map(r => ({
      item: r.name,
      qty: Number(r.qty),
      revenue: Number(Number(r.revenue).toFixed(2)),
      cost_estimated: Number(Number(r.cost_est).toFixed(2))
    }))
  };
}

async function getEventProfitSummary() {
  const eventsResult = await query('SELECT id FROM events ORDER BY date DESC');
  const results = await Promise.all(
    eventsResult.rows.map(row => calculateEventProfit(row.id).catch(e => ({ event_id: row.id, error: e.message })))
  );
  return results;
}

module.exports = { calculateEventProfit, getEventProfitSummary };
