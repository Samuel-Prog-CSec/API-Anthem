/**
 * Validadores para endpoints de bicicletas (disponibilidad).
 * Extraidos de `routes/bicicletas.js`.
 */

const { query } = require('express-validator');
const { ROUTE_SPECIFIC_LIMITS } = require('../constants');

/**
 * GET /api/v1/bicicletas/tendencias/mensual
 */
const validarTendenciasMensuales = [
  query('year')
    .optional()
    .isInt({
      min: ROUTE_SPECIFIC_LIMITS.BIKE.YEAR_MIN,
      max: ROUTE_SPECIFIC_LIMITS.BIKE.YEAR_MAX
    })
    .withMessage(`Año debe ser un número entre ${ROUTE_SPECIFIC_LIMITS.BIKE.YEAR_MIN} y ${ROUTE_SPECIFIC_LIMITS.BIKE.YEAR_MAX}`)
];

/**
 * GET /api/v1/bicicletas/mayor-uso
 */
const validarDiasMayorUso = [
  query('limit')
    .optional()
    .isInt({
      min: ROUTE_SPECIFIC_LIMITS.BIKE.TOP_N_MIN,
      max: ROUTE_SPECIFIC_LIMITS.BIKE.TOP_N_MAX
    })
    .withMessage(`Límite debe ser entre ${ROUTE_SPECIFIC_LIMITS.BIKE.TOP_N_MIN} y ${ROUTE_SPECIFIC_LIMITS.BIKE.TOP_N_MAX}`)
];

module.exports = {
  validarTendenciasMensuales,
  validarDiasMayorUso
};
