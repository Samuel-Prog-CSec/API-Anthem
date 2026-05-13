/**
 * Validadores para endpoints de administracion.
 * Extraidos de `routes/admin.js`.
 */

const { query } = require('express-validator');
const { ROUTE_SPECIFIC_LIMITS } = require('../constants');

/**
 * DELETE /api/v1/admin/cache/clear
 */
const validarLimpiezaCache = [
  query('type')
    .optional()
    .isString()
    .trim()
    .withMessage('Type debe ser una cadena de texto válida'),
  query('pattern')
    .optional()
    .isString()
    .trim()
    .isLength({
      min: ROUTE_SPECIFIC_LIMITS.ADMIN.PATTERN_MIN_LENGTH,
      max: ROUTE_SPECIFIC_LIMITS.ADMIN.PATTERN_MAX_LENGTH
    })
    .withMessage(`Pattern debe tener entre ${ROUTE_SPECIFIC_LIMITS.ADMIN.PATTERN_MIN_LENGTH} y ${ROUTE_SPECIFIC_LIMITS.ADMIN.PATTERN_MAX_LENGTH} caracteres`)
];

module.exports = {
  validarLimpiezaCache
};
