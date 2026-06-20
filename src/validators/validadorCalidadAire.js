/**
 * Validadores para endpoints de calidad del aire.
 * Extraidos de `routes/calidadAire.js`.
 */

const { query, body } = require('express-validator');
const {
  MAGNITUDES_PERMITIDAS,
  SORT_FIELDS,
  TIME_PERIODS,
  ROUTE_SPECIFIC_LIMITS
} = require('../constants');
const { validarFechaDataset } = require('./validadorFechaDataset');

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
    .bail()
    // toInt antes de isIn: MAGNITUDES_PERMITIDAS son numeros; sin convertir, isIn
    // comparaba el string de la query ('8') contra numeros y daba 400 a TODO codigo
    // valido (incluido NO2=8, el contaminante por defecto del frontend).
    .toInt()
    .isIn(MAGNITUDES_PERMITIDAS)
    .withMessage('magnitud debe ser un código válido de contaminante')
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
  query('magnitud').optional().isInt({ min: 1 }).bail().toInt().isIn(MAGNITUDES_PERMITIDAS).withMessage('magnitud debe ser un código válido de contaminante')
];

/**
 * Reglas de validacion de UNA medicion horaria de calidad del aire (ingesta IoT).
 * @param {string} [p=''] - Prefijo del campo ('' single, 'lecturas.*.' lote)
 * @returns {Array} Cadena de validadores express-validator
 */
const reglasIngestaAire = (p = '') => ([
  body(`${p}provincia`).optional().isInt({ min: 1, max: 99 }).withMessage('provincia invalida'),
  body(`${p}municipio`).optional().isInt({ min: 1 }).withMessage('municipio invalido'),
  body(`${p}estacion`).isInt({ min: 0 }).withMessage('estacion debe ser un entero >= 0'),
  body(`${p}magnitud`).isInt().withMessage('magnitud debe ser un entero').bail()
    .custom((value) => MAGNITUDES_PERMITIDAS.includes(Number(value))).withMessage('magnitud no permitida'),
  body(`${p}fecha`).exists().withMessage('fecha es obligatoria').bail().custom(validarFechaDataset),
  body(`${p}hora`).isInt({ min: 0, max: 23 }).withMessage('hora debe ser un entero entre 0 y 23'),
  body(`${p}valor`).isFloat({ min: 0, max: 10000 }).withMessage('valor debe estar entre 0 y 10000'),
  body(`${p}validacion`).optional().isString().trim().toUpperCase().isIn(['V', 'N']).withMessage('validacion debe ser V o N'),
  body(`${p}puntoMuestreo`).optional().isString().trim().isLength({ max: 100 }).withMessage('puntoMuestreo invalido')
]);

/** POST /api/v1/calidad-aire/ingesta (una medicion horaria) */
const validarIngestaAire = reglasIngestaAire('');

/** POST /api/v1/calidad-aire/ingesta/lote (hasta 100 mediciones) */
const validarIngestaLoteAire = [
  body('lecturas').isArray({ min: 1, max: 100 }).withMessage('lecturas debe ser un array de 1 a 100 elementos'),
  ...reglasIngestaAire('lecturas.*.')
];

module.exports = {
  validarDatosCalidadAire,
  validarEstadisticasCalidadAire,
  validarTendenciasCalidadAire,
  validarIngestaAire,
  validarIngestaLoteAire
};
