/**
 * Validadores para endpoints de calidad del aire.
 * Extraidos de `routes/calidadAire.js`.
 */

const { query } = require('express-validator');
const {
  MAGNITUDES_PERMITIDAS,
  SORT_FIELDS,
  TIME_PERIODS,
  ROUTE_SPECIFIC_LIMITS
} = require('../constants');

/**
 * GET /api/v1/calidad-aire
 */
const validarDatosCalidadAire = [
  query('startDate')
    .optional()
    .isISO8601()
    .withMessage('startDate debe ser una fecha válida en formato ISO 8601'),
  query('endDate')
    .optional()
    .isISO8601()
    .withMessage('endDate debe ser una fecha válida en formato ISO 8601')
    .custom((value, { req }) => {
      if (req.query.startDate && value <= req.query.startDate) {
        throw new Error('endDate debe ser posterior a startDate');
      }
      return true;
    }),
  query('provincia')
    .optional()
    .isInt({
      min: ROUTE_SPECIFIC_LIMITS.AIR.PROVINCIA_MIN,
      max: ROUTE_SPECIFIC_LIMITS.AIR.PROVINCIA_MAX
    })
    .withMessage(`provincia debe ser un número entre ${ROUTE_SPECIFIC_LIMITS.AIR.PROVINCIA_MIN} y ${ROUTE_SPECIFIC_LIMITS.AIR.PROVINCIA_MAX}`),
  query('municipio').optional().isInt({ min: 1 }).withMessage('municipio debe ser un número entero positivo'),
  query('estacion').optional().isInt({ min: 1 }).withMessage('estacion debe ser un número entero positivo'),
  query('magnitud')
    .optional()
    .custom((value) => {
      const validMagnitudes = [...MAGNITUDES_PERMITIDAS];
      if (Array.isArray(value)) {
        return value.every(v => validMagnitudes.includes(parseInt(v, 10)));
      }
      return validMagnitudes.includes(parseInt(value, 10));
    })
    .withMessage('magnitud debe ser un código válido de contaminante'),
  query('page').optional().isInt({ min: 1 }).withMessage('page debe ser un número entero positivo'),
  query('limit')
    .optional()
    .isInt({
      min: ROUTE_SPECIFIC_LIMITS.AIR.LIMIT_MIN,
      max: ROUTE_SPECIFIC_LIMITS.AIR.LIMIT_MAX
    })
    .withMessage(`limit debe ser un número entre ${ROUTE_SPECIFIC_LIMITS.AIR.LIMIT_MIN} y ${ROUTE_SPECIFIC_LIMITS.AIR.LIMIT_MAX}`),
  query('sortBy')
    .optional()
    .toLowerCase()
    .trim()
    .isIn(SORT_FIELDS.AIR_QUALITY)
    .escape()
    .withMessage('sortBy debe ser un campo válido para ordenamiento'),
  query('sortOrder')
    .optional()
    .toLowerCase()
    .trim()
    .isIn(['asc', 'desc'])
    .escape()
    .withMessage('sortOrder debe ser "asc" o "desc"'),
  query('includeInvalid').optional().toBoolean().isBoolean().withMessage('includeInvalid debe ser true o false')
];

/**
 * GET /api/v1/calidad-aire/estadisticas
 */
const validarEstadisticasCalidadAire = [
  query('startDate').optional().isISO8601().withMessage('startDate debe ser una fecha válida'),
  query('endDate').optional().isISO8601().withMessage('endDate debe ser una fecha válida'),
  query('groupBy')
    .optional()
    .toUpperCase()
    .trim()
    .isIn([...Object.keys(TIME_PERIODS), 'STATION'])
    .withMessage(`groupBy debe ser: ${Object.values(TIME_PERIODS).join(', ')} o "STATION"`),
  query('provincia')
    .optional()
    .isInt({
      min: ROUTE_SPECIFIC_LIMITS.AIR.PROVINCIA_MIN,
      max: ROUTE_SPECIFIC_LIMITS.AIR.PROVINCIA_MAX
    })
    .withMessage(`provincia debe ser un número entre ${ROUTE_SPECIFIC_LIMITS.AIR.PROVINCIA_MIN} y ${ROUTE_SPECIFIC_LIMITS.AIR.PROVINCIA_MAX}`),
  query('municipio').optional().isInt({ min: 1 }).withMessage('municipio debe ser un número entero positivo'),
  query('magnitud')
    .optional()
    .isInt({ min: 1 })
    .isIn(MAGNITUDES_PERMITIDAS)
    .withMessage('magnitud debe ser un número entero')
];

/**
 * GET /api/v1/calidad-aire/tendencias
 */
const validarTendenciasCalidadAire = [
  query('startDate').optional().isISO8601(),
  query('endDate').optional().isISO8601(),
  query('provincia')
    .optional()
    .isInt({
      min: ROUTE_SPECIFIC_LIMITS.AIR.PROVINCIA_MIN,
      max: ROUTE_SPECIFIC_LIMITS.AIR.PROVINCIA_MAX
    }),
  query('municipio').optional().isInt({ min: 1 }),
  query('magnitud').optional().isInt({ min: 1 }).isIn(MAGNITUDES_PERMITIDAS)
];

module.exports = {
  validarDatosCalidadAire,
  validarEstadisticasCalidadAire,
  validarTendenciasCalidadAire
};
