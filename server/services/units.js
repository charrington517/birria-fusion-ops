'use strict';
/**
 * server/services/units.js
 *
 * Physical unit conversion and purchase cost computation.
 *
 * Packaging types (case, bag, box, bottle, pack) are NOT in the unit_conversions
 * table because they have no universal fixed quantity. Each inventory item defines
 * its own package contents via:
 *   - pkg_qty          : total quantity of base units in one purchased package
 *   - conversion_factor: base units per purchase_unit (overrides table lookup)
 *
 * For packaging purchase units the caller MUST supply pkg_qty directly as the
 * total base-unit quantity in the package (e.g. 1 case of 30-lb cheese → pkg_qty=480
 * with base unit oz, or pkg_qty=30 with base unit lb).
 *
 * For physical purchase units (lb, kg, liter, etc.) the table lookup converts
 * pkg_qty from purchase_unit to base_unit automatically.
 */

const { query } = require('../db/pool');

// Units that are packaging containers — they have no universal physical quantity.
// Conversions for these MUST come from the product's pkg_qty or conversion_factor.
const PACKAGING_UNITS = new Set(['case','bag','box','bottle','pack','bundle','pallet','crate','drum','jug','can','jar','tub','pouch','sleeve','roll','sheet','each']);

/**
 * Convert qty from fromUnit to toUnit using the unit_conversions table.
 * A product-specific conversionFactor overrides the table lookup.
 *
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

  // Product-specific override takes precedence over table lookup.
  if (conversionFactor != null && Number(conversionFactor) > 0) {
    return qty * Number(conversionFactor);
  }

  // Packaging units have no universal conversion — require explicit factor.
  if (PACKAGING_UNITS.has(from) || PACKAGING_UNITS.has(to)) {
    throw new Error(
      `"${fromUnit}" is a packaging type with no universal conversion to "${toUnit}". ` +
      `Set pkg_qty to the total ${toUnit} in one package, or supply a conversion_factor.`
    );
  }

  // Look up forward direction first.
  const fwd = await query(
    `SELECT factor FROM unit_conversions WHERE LOWER(from_unit)=$1 AND LOWER(to_unit)=$2 LIMIT 1`,
    [from, to]
  );
  if (fwd.rows.length) return qty * Number(fwd.rows[0].factor);

  // Look up reverse direction.
  const rev = await query(
    `SELECT factor FROM unit_conversions WHERE LOWER(from_unit)=$1 AND LOWER(to_unit)=$2 LIMIT 1`,
    [to, from]
  );
  if (rev.rows.length) return qty / Number(rev.rows[0].factor);

  throw new Error(
    `No conversion rule found for "${fromUnit}" → "${toUnit}". ` +
    `Provide a product-specific conversion_factor to proceed.`
  );
}

/**
 * Compute cost_per_base_unit from purchase fields.
 *
 * pkg_qty is ALWAYS the total quantity of base units in one purchased package.
 * The caller is responsible for expressing pkg_qty in base units.
 *
 * For packaging purchase units (case, bag, box, bottle, etc.):
 *   pkg_qty = total base units in the package (e.g. 480 oz for a 30-lb case)
 *   conversion_factor is ignored (pkg_qty already encodes the product-specific quantity)
 *
 * For physical purchase units (lb, kg, liter, etc.) where purchase_unit !== base_unit:
 *   pkg_qty is in purchase_unit; convertUnits() converts it to base_unit.
 *   conversion_factor overrides the table lookup if supplied.
 *
 * @param {number} purchasePrice   price per package ($)
 * @param {number} pkgQty          quantity per package (in purchase_unit)
 * @param {string} purchaseUnit    unit of the package
 * @param {string} baseUnit        inventory base unit
 * @param {number|null} convFactor product-specific conversion factor (optional)
 * @returns {Promise<number>}      cost per one base unit
 */
async function computeCostPerBaseUnit(purchasePrice, pkgQty, purchaseUnit, baseUnit, convFactor = null) {
  if (!purchasePrice || !pkgQty) return null;
  const price = Number(purchasePrice);
  const qty   = Number(pkgQty);
  if (price <= 0 || qty <= 0) return null;

  const pu = (purchaseUnit || '').trim().toLowerCase();
  const bu = (baseUnit     || '').trim().toLowerCase();

  // Same unit or no units specified: pkg_qty is already in base units.
  if (!pu || !bu || pu === bu) {
    return price / qty;
  }

  // Product-specific conversion_factor overrides everything, including packaging.
  // convFactor means: 1 purchase_unit = convFactor base_units.
  if (convFactor != null && Number(convFactor) > 0) {
    const baseQty = qty * Number(convFactor);
    return price / baseQty;
  }

  // Packaging unit: pkg_qty IS the total base-unit quantity (product-specific).
  // No table lookup needed — the user has already expressed the package contents.
  if (PACKAGING_UNITS.has(pu)) {
    return price / qty;
  }

  // Physical unit cross-conversion: convert pkg_qty from purchase_unit to base_unit.
  const baseQty = await convertUnits(qty, purchaseUnit, baseUnit, convFactor);
  return price / baseQty;
}

/**
 * Compute cost per ingredient unit from cost_per_base_unit.
 * Used when propagating inventory purchase cost to a linked ingredient whose
 * unit may differ from the inventory base unit.
 *
 * @param {number} costPerBaseUnit   cost per one inventory base unit
 * @param {string} baseUnit          inventory base unit (e.g. 'oz')
 * @param {string} ingredientUnit    ingredient usage unit (e.g. 'g', 'tbsp')
 * @param {number|null} convFactor   product-specific override (optional)
 * @returns {Promise<number>}        cost per one ingredient unit
 */
async function costPerIngredientUnit(costPerBaseUnit, baseUnit, ingredientUnit, convFactor = null) {
  const bu = (baseUnit       || '').trim().toLowerCase();
  const iu = (ingredientUnit || '').trim().toLowerCase();
  if (!bu || !iu || bu === iu) return costPerBaseUnit;
  // Convert 1 ingredient unit → base units, then multiply by cost per base unit.
  const baseUnitsPerIngUnit = await convertUnits(1, ingredientUnit, baseUnit, convFactor);
  return costPerBaseUnit * baseUnitsPerIngUnit;
}

/**
 * List all known physical conversion rules from the DB.
 */
async function listConversions() {
  const result = await query('SELECT * FROM unit_conversions ORDER BY from_unit, to_unit');
  return result.rows;
}

module.exports = { convertUnits, computeCostPerBaseUnit, costPerIngredientUnit, listConversions, PACKAGING_UNITS };
