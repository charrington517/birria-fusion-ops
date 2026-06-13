const { query } = require('../db/pool');

async function previewConsumption(menuItemId, quantity) {
  const itemResult = await query(
    'SELECT m.*, r.name AS recipe_name FROM menu_items m LEFT JOIN recipes r ON r.id=m.recipe_id WHERE m.id=$1',
    [menuItemId]
  );
  const item = itemResult.rows[0];
  if (!item) throw new Error('Menu item not found');
  if (!item.recipe_id) return { menu_item: item.name, quantity, consumptions: [], warning: 'No recipe linked — no inventory consumed' };

  const lines = await query(`
    SELECT ri.quantity AS qty_per_unit, ri.unit,
           i.name AS ingredient_name, i.id AS ingredient_id,
           i.inventory_item_id,
           COALESCE(i.servings_per_purchase, 1) AS servings_per_purchase,
           inv.name AS inventory_name, inv.unit AS inv_unit,
           inv.current_stock, inv.id AS inventory_id
    FROM recipe_ingredients ri
    JOIN ingredients i ON i.id=ri.ingredient_id
    LEFT JOIN inventory inv ON inv.id=i.inventory_item_id
    WHERE ri.recipe_id=$1
  `, [item.recipe_id]);

  const consumptions = lines.rows.map(line => {
    const spp = Number(line.servings_per_purchase) || 1;
    // How many ingredient units are needed for this sale
    const ingredient_qty_used = Number((Number(line.qty_per_unit) * quantity).toFixed(6));
    // Convert to inventory purchase units by dividing by spp
    const inventory_qty_deducted = Number((ingredient_qty_used / spp).toFixed(6));
    const stock_after = line.current_stock !== null
      ? Number((Number(line.current_stock) - inventory_qty_deducted).toFixed(6))
      : null;
    return {
      ingredient: line.ingredient_name,
      qty_per_unit: Number(line.qty_per_unit),
      unit: line.unit,
      spp,
      ingredient_qty_used,
      inventory_qty_deducted,
      total_consumed: inventory_qty_deducted,  // kept for backward compat
      inventory_item: line.inventory_name || null,
      inventory_id: line.inventory_id || null,
      inv_unit: line.inv_unit || line.unit,
      current_stock: line.current_stock !== null ? Number(line.current_stock) : null,
      stock_after,
      will_go_negative: stock_after !== null && stock_after < 0,
      mapped: !!line.inventory_id
    };
  });

  return {
    menu_item: item.name,
    recipe: item.recipe_name,
    quantity,
    consumptions
  };
}

async function consumeInventory(salesOrderId) {
  const orderResult = await query('SELECT * FROM sales_orders WHERE id=$1', [salesOrderId]);
  const order = orderResult.rows[0];
  if (!order) throw new Error('Sales order not found');

  const preview = await previewConsumption(order.menu_item_id, order.quantity);
  const deductions = [];

  for (const c of preview.consumptions) {
    if (!c.inventory_id) continue;

    const inv_deduction = c.inventory_qty_deducted;

    // Deduct inventory_qty_deducted (already converted to purchase units via spp)
    await query(
      'UPDATE inventory SET current_stock = current_stock - $1 WHERE id=$2',
      [inv_deduction, c.inventory_id]
    );

    // Record transaction with clear unit labeling
    const reason = `Sales order #${salesOrderId}: ${c.ingredient_qty_used} ${c.unit} ${c.ingredient}` +
      (c.spp > 1 ? ` → ${inv_deduction.toFixed(4)} ${c.inv_unit} (÷${c.spp})` : '');
    await query(
      'INSERT INTO inventory_transactions (inventory_id, change_amount, reason, sales_order_id) VALUES ($1,$2,$3,$4)',
      [c.inventory_id, -inv_deduction, reason, salesOrderId]
    );

    deductions.push({
      inventory_item: c.inventory_item,
      ingredient_qty: c.ingredient_qty_used,
      ingredient_unit: c.unit,
      spp: c.spp,
      deducted: Number(inv_deduction.toFixed(4)),
      inventory_unit: c.inv_unit,
      unit: c.inv_unit,
      stock_after: c.stock_after
    });
  }

  return {
    sales_order_id: salesOrderId,
    menu_item: preview.menu_item,
    quantity: order.quantity,
    deductions,
    unmapped_ingredients: preview.consumptions.filter(c => !c.inventory_id).map(c => c.ingredient)
  };
}

module.exports = { previewConsumption, consumeInventory };
