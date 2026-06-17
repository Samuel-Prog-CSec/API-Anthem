/**
 * Validadores para endpoints de ruido (contaminacion acustica).
 *
 * Extraidos de `routes/ruido.js`.
 */

const { query } = require('express-validator');
const { ROUTE_SPECIFIC_LIMITS, SORT_FIELDS, ZONE_TYPES } = require('../constants');

/**
 * Validaciones para consultas de datos de contaminacion acustica
 * (GET /api/v1/ruido).
 */
const validarDatosRuido = [
  query('año')
    .optional()
    .isInt({ min: ROUTE_SPECIFIC_LIMITS.NOISE.YEAR_MIN, max: ROUTE_SPECIFIC_LIMITS.NOISE.YEAR_MAX })
    .withMessage(`año debe ser un número válido entre ${ROUTE_SPECIFIC_LIMITS.NOISE.YEAR_MIN} y ${ROUTE_SPECIFIC_LIMITS.NOISE.YEAR_MAX}`),
  query('mes')
    .optional()
    .isInt({ min: ROUTE_SPECIFIC_LIMITS.NOISE.MONTH_MIN, max: ROUTE_SPECIFIC_LIMITS.NOISE.MONTH_MAX })
    .withMessage(`mes debe ser un número entre ${ROUTE_SPECIFIC_LIMITS.NOISE.MONTH_MIN} y ${ROUTE_SPECIFIC_LIMITS.NOISE.MONTH_MAX}`),
  query('nmt')
    .optional()
    .custom((value) => {
      if (Array.isArray(value)) {
        return value.every(v => Number.isInteger(parseInt(v, 10)) && parseInt(v, 10) > 0);
      }
      return Number.isInteger(parseInt(value, 10)) && parseInt(value, 10) > 0;
    })
    .withMessage('nmt debe ser un número entero positivo o array de números'),
  query('nombre')
    .optional()
    .trim()
    .escape()
    .isLength({
      min: ROUTE_SPECIFIC_LIMITS.NOISE.POINT_LIMIT_MIN,
      max: ROUTE_SPECIFIC_LIMITS.NOISE.LIMIT_MAX
    })
    .withMessage(`nombre debe tener entre ${ROUTE_SPECIFIC_LIMITS.NOISE.POINT_LIMIT_MIN} y ${ROUTE_SPECIFIC_LIMITS.NOISE.LIMIT_MAX} caracteres`),
  query('page').optional().isInt({ min: 1 }).withMessage('page debe ser un número entero positivo'),
  query('limit')
    .optional()
    .isInt({
      min: ROUTE_SPECIFIC_LIMITS.NOISE.LIMIT_MIN,
      max: ROUTE_SPECIFIC_LIMITS.NOISE.LIMIT_MAX
    })
    .withMessage(`limit debe ser un número entre ${ROUTE_SPECIFIC_LIMITS.NOISE.LIMIT_MIN} y ${ROUTE_SPECIFIC_LIMITS.NOISE.LIMIT_MAX}`),
  query('sortBy')
    .optional()
    .isIn(Object.values(SORT_FIELDS.NOISE_MONITORING))
    .withMessage('sortBy debe ser un campo válido para ordenamiento'),
  query('sortOrder').optional().isIn(['asc', 'desc']).withMessage('sortOrder debe ser "asc" o "desc"'),
  query('includeInvalid').optional().isBoolean().withMessage('includeInvalid debe ser true o false')
];

/**
 * GET /api/v1/ruido/estadisticas
 */
const validarEstadisticasRuido = [
  query('groupBy')
    .optional()
    .isIn(['station', 'month', 'year'])
    .withMessage('groupBy debe ser "station", "month" o "year"'),
  query('nmt').optional().isInt({ min: 1 }).withMessage('nmt debe ser un número entero positivo')
];

/**
 * GET /api/v1/ruido/ranking
 */
const validarRankingRuido = [
  query('startDate').optional().isISO8601().withMessage('startDate debe ser una fecha válida'),
  query('endDate').optional().isISO8601().withMessage('endDate debe ser una fecha válida'),
  query('orderBy')
    .optional()
    .isIn(['laeq24', 'diurno', 'vespertino', 'nocturno'])
    .withMessage('orderBy debe ser "laeq24", "diurno", "vespertino" o "nocturno"'),
  query('limit')
    .optional()
    .isInt({
      min: ROUTE_SPECIFIC_LIMITS.NOISE.TOP_N_MIN,
      max: ROUTE_SPECIFIC_LIMITS.NOISE.TOP_N_MAX
    })
    .withMessage(`limit debe ser un número entre ${ROUTE_SPECIFIC_LIMITS.NOISE.TOP_N_MIN} y ${ROUTE_SPECIFIC_LIMITS.NOISE.TOP_N_MAX}`)
];

/**
 * GET /api/v1/ruido/cumplimiento/zona
 */
const validarCumplimientoZona = [
  query('startDate').optional().isISO8601().withMessage('startDate debe ser una fecha válida'),
  query('endDate').optional().isISO8601().withMessage('endDate debe ser una fecha válida'),
  query('año').optional().isInt({ min: 2000, max: 2100 }).withMessage('año debe ser un entero válido'),
  query('mes').optional().isInt({ min: 1, max: 12 }).withMessage('mes debe ser un entero entre 1 y 12'),
  query('nmt').optional().isInt({ min: 1 }).withMessage('nmt debe ser un entero positivo'),
  query('threshold')
    .optional()
    .isInt({
      min: ROUTE_SPECIFIC_LIMITS.NOISE.DB_THRESHOLD_MIN,
      max: ROUTE_SPECIFIC_LIMITS.NOISE.DB_THRESHOLD_MAX
    })
    .withMessage(`threshold debe ser un número entre ${ROUTE_SPECIFIC_LIMITS.NOISE.DB_THRESHOLD_MIN} y ${ROUTE_SPECIFIC_LIMITS.NOISE.DB_THRESHOLD_MAX}`),
  query('zoneType')
    .optional()
    .isIn(Object.values(ZONE_TYPES))
    .withMessage('zoneType debe ser un tipo de zona válido')
];

/**
 * GET /api/v1/ruido/tendencias/temporal
 */
const validarTendenciasTemporales = [
  query('startDate').notEmpty().isISO8601().withMessage('startDate es obligatorio en formato ISO 8601'),
  query('endDate').notEmpty().isISO8601().withMessage('endDate es obligatorio en formato ISO 8601'),
  query('nmt').optional().isInt({ min: 1 }).withMessage('nmt debe ser un entero positivo'),
  query('groupBy').optional().isIn(['day', 'month', 'year']).withMessage('groupBy debe ser: day, month, year'),
  query('metric')
    .optional()
    .isIn(['laeq24', 'nivelDiurno', 'nivelVespertino', 'nivelNocturno'])
    .withMessage('metric debe ser: laeq24, nivelDiurno, nivelVespertino, nivelNocturno')
];

/**
 * GET /api/v1/ruido/mapa
 */
const validarMapaRuido = [
  query('startDate').optional().isISO8601().withMessage('startDate debe ser ISO 8601'),
  query('endDate').optional().isISO8601().withMessage('endDate debe ser ISO 8601'),
  query('año').optional().isInt({ min: 2000, max: 2100 }).withMessage('año debe ser valido'),
  query('nmt').optional().isString().withMessage('nmt debe ser string separado por comas')
];

module.exports = {
  validarDatosRuido,
  validarEstadisticasRuido,
  validarRankingRuido,
  validarCumplimientoZona,
  validarTendenciasTemporales,
  validarMapaRuido
};
