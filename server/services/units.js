'use strict';
/**
 * server/services/units.js
 *
 * Converts between purchase units and base inventory units.
 * Uses the unit_conversions table for named standard conversions.
 * A product-specific conversionFactor overrides the table lookup.
 * Throws a descriptive error for incompatible unit pairs with no known factor.
 */

const { query } = require('../db/pool');

/**
 * Convert qty from fromUnit to toUnit.
 * @param {number} qty
 * @param {string} fromUnit
 * @param {string} toUnit
 * @param {number|null} conversionFactor  product-specific override (optional)
 * @returns {Promise<number>}
 */
async function convertUnits(qty, fromUnit, toUnit, conversionFactor = null) {
  if (!fromUnit || !toUnit) throw new Error('Both fromUnit and toUnit are required');
  const from = fromUnit.trim().toLowerCase();
  const to   = toUnit.trim().toLowerCase();

  if (from === to) return qty;

  // Product-specific override takes precedence.
  if (conversionFactor != null && Number(conversionFactor) > 0) {
    return qty * Number(conversionFactor);
  }

  // Look up the standard conversion table (both directions).
  const result = await query(
    `SELECT factor FROM unit_conversions
     WHERE (LOWER(from_unit)=$1 AND LOWER(to_unit)=$2)
        OR (LOWER(from_unit)=$2 AND LOWER(to_unit)=$1)
     LIMIT 1`,
    [from, to]
  );

  if (!result.rows.length) {
    throw new Error(
      `No conversion rule found for "${fromUnit}" → "${toUnit}". ` +
      `Provide a product-specific conversion factor to proceed.`
    );
  }

  const row = result.rows[0];
  // If the stored rule is from→to, multiply. If it's to→from, divide.
  const isForward = result.rows[0]._direction !== 'reverse';

  // Re-query to know direction explicitly.
  const fwd = await query(
    `SELECT factor FROM unit_conversions
     WHERE LOWER(from_unit)=$1 AND LOWER(to_unit)=$2 LIMIT 1`,
    [from, to]
  );
  if (fwd.rows.length) return qty * Number(fwd.rows[0].factor);

  // Reverse direction: divide.
  const rev = await query(
    `SELECT factor FROM unit_conversions
     WHERE LOWER(from_unit)=$1 AND LOWER(to_unit)=$2 LIMIT 1`,
    [to, from]
  );
  if (rev.rows.length) return qty / Number(rev.rows[0].factor);

  throw new Error(`No conversion rule found for "${fromUnit}" → "${toUnit}".`);
}

/**
 * Compute cost_per_base_unit from purchase fields.
 * If purchase_unit === base_unit, cost_per_base_unit = purchase_price / pkg_qty.
 * Otherwise convert pkg_qty from purchase_unit to base_unit first.
 *
 * @param {number} purchasePrice   price per package
 * @param {number} pkgQty          quantity of base units per package (already in base unit)
 *                                 OR quantity in purchase_unit if purchase_unit !== base_unit
 * @param {string} purchaseUnit    unit of the package
 * @param {string} baseUnit        inventory base unit
 * @param {number|null} convFactor product-specific conversion factor
 * @returns {Promise<number>}      cost per one base unit
 */
async function computeCostPerBaseUnit(purchasePrice, pkgQty, purchaseUnit, baseUnit, convFactor = null) {
  if (!purchasePrice || !pkgQty) return null;
  const price = Number(purchasePrice);
  const qty   = Number(pkgQty);
  if (price <= 0 || qty <= 0) return null;

  const pu = (purchaseUnit || '').trim().toLowerCase();
  const bu = (baseUnit     || '').trim().toLowerCase();

  // If units match, pkg_qty is already in base units.
  if (!pu || !bu || pu === bu) {
    return price / qty;
  }

  // Convert pkg_qty from purchase_unit to base_unit.
  const baseQty = await convertUnits(qty, purchaseUnit, baseUnit, convFactor);
  return price / baseQty;
}

/**
 * List all known conversion rules from the DB.
 */
async function listConversions() {
  const result = await query('SELECT * FROM unit_conversions ORDER BY from_unit, to_unit');
  return result.rows;
}

module.exports = { convertUnits, computeCostPerBaseUnit, listConversions };
