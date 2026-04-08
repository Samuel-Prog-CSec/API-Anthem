/**
 * Rutas de calidad de aire
 *
 * Define todos los endpoints relacionados con datos de calidad de aire,
 * incluyendo consultas, filtros, estadísticas y tendencias.
 */

const express = require('express');
const { query } = require('express-validator');
const rateLimit = require('express-rate-limit');

// Middleware de autenticación y seguridad
const { authenticate } = require('../middleware/auth');
const { validateRequest, heavyQueryLimiter } = require('../middleware/security');
const { performanceMonitor } = require('../middleware/performanceMonitor');

// Middleware de caché optimizado
const { cacheMiddleware } = require('../middleware/cache');

// Constantes
const {
  MAGNITUDES_PERMITIDAS,
  SORT_FIELDS,
  TIME_PERIODS,
  RATE_LIMITS,
  ROUTE_SPECIFIC_LIMITS
} = require('../constants');

// Controladores
const {
  getAirQualityData,
  getAirQualityStatistics,
  getAirQualityTrends
} = require('../controllers/controladorCalidadAire');

const router = express.Router();

// Aplicar performanceMonitor a todas las rutas de calidad de aire
router.use(performanceMonitor);

/**
 * Rate limiting específico para endpoints de datos ambientales
 *
 * ESTRATEGIA:
 * - dataQueryLimiter: Para consultas normales de datos (30 req/min)
 * - heavyQueryLimiter: Para estadísticas/análisis pesados (5 req/min) - desde security.js
 *
 * NOTA: El statisticsLimiter local (10 req/5min) se REEMPLAZA por heavyQueryLimiter (5 req/1min)
 * para mantener consistencia con otros endpoints de estadísticas del proyecto.
 */
const dataQueryLimiter = rateLimit({
  windowMs: RATE_LIMITS.WINDOWS.ONE_MINUTE,
  max: RATE_LIMITS.AIR_QUALITY.LIST_MAX,
  message: {
    success: false,
    message: 'Demasiadas consultas de datos, intente nuevamente en 1 minuto'
  },
  standardHeaders: true,
  legacyHeaders: false
});

/**
 * Validaciones para consultas de datos de calidad de aire
 */
const airQualityQueryValidation = [
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
    .isInt({ min: ROUTE_SPECIFIC_LIMITS.AIR.PROVINCIA_MIN, max: ROUTE_SPECIFIC_LIMITS.AIR.PROVINCIA_MAX })
    .withMessage(`provincia debe ser un número entre ${ROUTE_SPECIFIC_LIMITS.AIR.PROVINCIA_MIN} y ${ROUTE_SPECIFIC_LIMITS.AIR.PROVINCIA_MAX}`),

  query('municipio')
    .optional()
    .isInt({ min: 1 })
    .withMessage('municipio debe ser un número entero positivo'),

  query('estacion')
    .optional()
    .isInt({ min: 1 })
    .withMessage('estacion debe ser un número entero positivo'),

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

  query('page')
    .optional()
    .isInt({ min: 1 })
    .withMessage('page debe ser un número entero positivo'),

  query('limit')
    .optional()
    .isInt({ min: ROUTE_SPECIFIC_LIMITS.AIR.LIMIT_MIN, max: ROUTE_SPECIFIC_LIMITS.AIR.LIMIT_MAX })
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

  query('includeInvalid')
    .optional()
    .toBoolean() // Convertir string a boolean
    .isBoolean()
    .withMessage('includeInvalid debe ser true o false')
];

/**
 * Validaciones para estadísticas
 */
const statisticsValidation = [
  query('startDate')
    .optional()
    .isISO8601()
    .withMessage('startDate debe ser una fecha válida'),

  query('endDate')
    .optional()
    .isISO8601()
    .withMessage('endDate debe ser una fecha válida'),

  query('groupBy')
    .optional()
    .toUpperCase()
    .trim()
    .isIn([...Object.keys(TIME_PERIODS), 'STATION'])
    .withMessage(`groupBy debe ser: ${Object.values(TIME_PERIODS).join(', ')} o "STATION"`),

  query('provincia')
    .optional()
    .isInt({ min: ROUTE_SPECIFIC_LIMITS.AIR.PROVINCIA_MIN, max: ROUTE_SPECIFIC_LIMITS.AIR.PROVINCIA_MAX })
    .withMessage(`provincia debe ser un número entre ${ROUTE_SPECIFIC_LIMITS.AIR.PROVINCIA_MIN} y ${ROUTE_SPECIFIC_LIMITS.AIR.PROVINCIA_MAX}`),

  query('municipio')
    .optional()
    .isInt({ min: 1 })
    .withMessage('municipio debe ser un número entero positivo'),

  query('magnitud')
    .optional()
    .isInt({ min: 1 })
    .isIn(MAGNITUDES_PERMITIDAS)
    .withMessage('magnitud debe ser un número entero')
];

/**
 * RUTAS DE CALIDAD DE AIRE
 */

/**
 * @route   GET /api/v1/air-quality
 * @desc    Obtener datos de calidad de aire con filtros
 * @access  Privado (requiere autenticación)
 */
router.get('/',
  dataQueryLimiter,
  authenticate,
  airQualityQueryValidation,
  validateRequest,
  cacheMiddleware('airQuality'), // Cache por 30 minutos (calidad de aire)
  getAirQualityData
);

/**
 * @route   GET /api/v1/calidad-aire/estadisticas
 * @desc    Obtener estadisticas agregadas de calidad de aire
 * @access  Privado (requiere autenticacion)
 */
router.get('/estadisticas',
  heavyQueryLimiter,
  authenticate,
  statisticsValidation,
  validateRequest,
  cacheMiddleware('airQuality'), // Cache por 30 minutos
  getAirQualityStatistics
);

/**
 * @route   GET /api/v1/calidad-aire/tendencias
 * @desc    Obtener tendencias de calidad de aire
 * @access  Privado (requiere autenticacion)
 */
router.get('/tendencias',
  heavyQueryLimiter,
  authenticate,
  [
    query('startDate').optional().isISO8601(),
    query('endDate').optional().isISO8601(),
    query('provincia').optional().isInt({ min: ROUTE_SPECIFIC_LIMITS.AIR.PROVINCIA_MIN, max: ROUTE_SPECIFIC_LIMITS.AIR.PROVINCIA_MAX }),
    query('municipio').optional().isInt({ min: 1 }),
    query('magnitud').optional().isInt({ min: 1 }).isIn(MAGNITUDES_PERMITIDAS)
  ],
  validateRequest,
  cacheMiddleware('airQuality'), // Cache por 30 minutos
  getAirQualityTrends
);

module.exports = router;
