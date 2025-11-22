/**
 * Rutas de Contaminación Acústica
 *
 * Define todos los endpoints relacionados con datos de contaminación acústica,
 * incluyendo consultas, estadísticas, ranking y búsqueda de estaciones.
 */

const express = require('express');
const { query, param } = require('express-validator');
const rateLimit = require('express-rate-limit');

// Constantes
const { RATE_LIMITS, ROUTE_SPECIFIC_LIMITS, DATE_RANGE_LIMITS } = require('../constants');

// Middleware de autenticación y seguridad
const { authenticate } = require('../middleware/auth');
const { validateRequest } = require('../middleware/security');
const { validateDateRange } = require('../middleware/validation');
const { performanceMonitor } = require('../middleware/performanceMonitor');
const { etagMiddleware } = require('../middleware/etag');

// Middleware de caché optimizado
const { cacheMiddleware } = require('../middleware/cache');

// Controladores
const {
  getNoiseMonitoringData,
  getNoiseMonitoringById,
  getNoiseStatistics,
  getNoiseRanking,
  searchStations,
  compareStations,
  getTemporalTrends,
  getComplianceByZone
} = require('../controllers/noiseMonitoringController');

const router = express.Router();

// Aplicar performanceMonitor a todas las rutas de ruido
router.use(performanceMonitor);

/**
 * Rate limiting específico para endpoints de contaminación acústica
 */
const noiseDataLimiter = rateLimit({
  windowMs: RATE_LIMITS.WINDOWS.ONE_MINUTE,
  max: RATE_LIMITS.NOISE_MONITORING.LIST_MAX,
  message: {
    success: false,
    message: 'Demasiadas consultas de datos acústicos, intente nuevamente en 1 minuto'
  },
  standardHeaders: true,
  legacyHeaders: false
});

const noiseStatisticsLimiter = rateLimit({
  windowMs: RATE_LIMITS.WINDOWS.FIVE_MINUTES,
  max: RATE_LIMITS.NOISE_MONITORING.STATS_MAX,
  message: {
    success: false,
    message: 'Límite de consultas estadísticas acústicas alcanzado, intente nuevamente en 5 minutos'
  }
});

const searchLimiter = rateLimit({
  windowMs: RATE_LIMITS.WINDOWS.ONE_MINUTE,
  max: RATE_LIMITS.NOISE_MONITORING.SEARCH_MAX,
  message: {
    success: false,
    message: 'Demasiadas búsquedas, intente nuevamente en 1 minuto'
  }
});

/**
 * Validaciones para consultas de datos de contaminación acústica
 */
const noiseQueryValidation = [
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
        return value.every(v => Number.isInteger(parseInt(v)) && parseInt(v) > 0);
      }
      return Number.isInteger(parseInt(value)) && parseInt(value) > 0;
    })
    .withMessage('nmt debe ser un número entero positivo o array de números'),

  query('nombre')
    .optional()
    .trim()
    .escape() // Sanitización XSS ANTES de validación de longitud
    .isLength({ min: ROUTE_SPECIFIC_LIMITS.NOISE.POINT_LIMIT_MIN, max: ROUTE_SPECIFIC_LIMITS.NOISE.LIMIT_MAX })
    .withMessage(`nombre debe tener entre ${ROUTE_SPECIFIC_LIMITS.NOISE.POINT_LIMIT_MIN} y ${ROUTE_SPECIFIC_LIMITS.NOISE.LIMIT_MAX} caracteres`),

  query('page')
    .optional()
    .isInt({ min: 1 })
    .withMessage('page debe ser un número entero positivo'),

  query('limit')
    .optional()
    .isInt({ min: ROUTE_SPECIFIC_LIMITS.NOISE.LIMIT_MIN, max: ROUTE_SPECIFIC_LIMITS.NOISE.LIMIT_MAX })
    .withMessage(`limit debe ser un número entre ${ROUTE_SPECIFIC_LIMITS.NOISE.LIMIT_MIN} y ${ROUTE_SPECIFIC_LIMITS.NOISE.LIMIT_MAX}`),

  query('sortBy')
    .optional()
    .isIn(['fecha', 'nmt', 'nombre', 'laeq24', 'año', 'mes'])
    .withMessage('sortBy debe ser un campo válido para ordenamiento'),

  query('sortOrder')
    .optional()
    .isIn(['asc', 'desc'])
    .withMessage('sortOrder debe ser "asc" o "desc"'),

  query('includeInvalid')
    .optional()
    .isBoolean()
    .withMessage('includeInvalid debe ser true o false')
];

/**
 * Validaciones para estadísticas de ruido
 */
const noiseStatisticsValidation = [
  query('groupBy')
    .optional()
    .isIn(['station', 'month', 'year'])
    .withMessage('groupBy debe ser "station", "month" o "year"'),

  query('nmt')
    .optional()
    .isInt({ min: 1 })
    .withMessage('nmt debe ser un número entero positivo')
];

/**
 * Validaciones para ranking
 */
const rankingValidation = [
  query('startDate')
    .optional()
    .isISO8601()
    .withMessage('startDate debe ser una fecha válida'),

  query('endDate')
    .optional()
    .isISO8601()
    .withMessage('endDate debe ser una fecha válida'),

  query('orderBy')
    .optional()
    .isIn(['laeq24', 'diurno', 'vespertino', 'nocturno'])
    .withMessage('orderBy debe ser "laeq24", "diurno", "vespertino" o "nocturno"'),

  query('limit')
    .optional()
    .isInt({ min: ROUTE_SPECIFIC_LIMITS.NOISE.TOP_N_MIN, max: ROUTE_SPECIFIC_LIMITS.NOISE.TOP_N_MAX })
    .withMessage(`limit debe ser un número entre ${ROUTE_SPECIFIC_LIMITS.NOISE.TOP_N_MIN} y ${ROUTE_SPECIFIC_LIMITS.NOISE.TOP_N_MAX}`)
];

/**
 * Validaciones para búsqueda de estaciones
 */
const searchValidation = [
  query('q')
    .notEmpty()
    .withMessage('Parámetro de búsqueda "q" es requerido')
    .trim()
    .escape() // Sanitización XSS ANTES de validación de longitud
    .isLength({ min: ROUTE_SPECIFIC_LIMITS.NOISE.POINT_LIMIT_MIN, max: ROUTE_SPECIFIC_LIMITS.NOISE.LIMIT_MAX })
    .withMessage(`Búsqueda debe tener entre ${ROUTE_SPECIFIC_LIMITS.NOISE.POINT_LIMIT_MIN} y ${ROUTE_SPECIFIC_LIMITS.NOISE.LIMIT_MAX} caracteres`),

  query('limit')
    .optional()
    .isInt({ min: ROUTE_SPECIFIC_LIMITS.NOISE.LIMIT_MIN, max: ROUTE_SPECIFIC_LIMITS.NOISE.POINT_LIMIT_MAX })
    .withMessage(`limit debe ser un número entre ${ROUTE_SPECIFIC_LIMITS.NOISE.LIMIT_MIN} y ${ROUTE_SPECIFIC_LIMITS.NOISE.POINT_LIMIT_MAX}`)
];

/**
 * Validación para parámetro ID
 */
const idValidation = [
  param('id')
    .isMongoId()
    .withMessage('ID debe ser un ObjectId válido de MongoDB')
];

/**
 * RUTAS DE CONTAMINACIÓN ACÚSTICA
 */

/**
 * @route   GET /api/v1/noise-monitoring
 * @desc    Obtener datos de contaminación acústica con filtros
 * @access  Privado (requiere autenticación)
 */
router.get('/',
  noiseDataLimiter,
  authenticate,
  validateDateRange(DATE_RANGE_LIMITS.NOISE_MAX_DAYS),
  noiseQueryValidation,
  validateRequest,
  cacheMiddleware('noise'), // Cache por 3 minutos
  getNoiseMonitoringData
);

/**
 * @route   GET /api/v1/noise-monitoring/statistics
 * @desc    Obtener estadísticas de contaminación acústica
 * @access  Privado (requiere autenticación)
 */
router.get('/statistics',
  noiseStatisticsLimiter,
  authenticate,
  validateDateRange(DATE_RANGE_LIMITS.NOISE_MAX_DAYS),
  noiseStatisticsValidation,
  validateRequest,
  etagMiddleware, // ETags para estadísticas agregadas (datos estables)
  cacheMiddleware('noise'), // Cache por 1 hora
  getNoiseStatistics
);

/**
 * @route   GET /api/v1/noise-monitoring/ranking
 * @desc    Obtener ranking de estaciones por nivel de ruido
 * @access  Privado (requiere autenticación)
 */
router.get('/ranking',
  noiseStatisticsLimiter,
  authenticate,
  rankingValidation,
  validateRequest,
  etagMiddleware, // ETags para ranking (datos agregados estables)
  cacheMiddleware('noise'), // Cache por 1 hora
  getNoiseRanking
);

/**
 * @route   GET /api/v1/noise-monitoring/stations/compare
 * @desc    Comparar niveles de ruido entre estaciones
 * @access  Privado (requiere autenticación)
 */
router.get('/stations/compare',
  noiseStatisticsLimiter,
  authenticate,
  [
    query('stations')
      .notEmpty()
      .withMessage('Se requiere el parámetro "stations"'),
    query('startDate')
      .optional()
      .isISO8601()
      .withMessage('startDate debe ser una fecha válida'),
    query('endDate')
      .optional()
      .isISO8601()
      .withMessage('endDate debe ser una fecha válida'),
    query('metric')
      .optional()
      .isIn(['laeq24', 'diurno', 'vespertino', 'nocturno'])
      .withMessage('metric debe ser un tipo válido')
  ],
  validateRequest,
  cacheMiddleware('noise'),
  compareStations
);

/**
 * @route   GET /api/v1/noise-monitoring/trends/temporal
 * @desc    Obtener tendencias temporales de ruido
 * @access  Privado (requiere autenticación)
 */
router.get('/trends/temporal',
  noiseStatisticsLimiter,
  authenticate,
  [
    query('nmt')
      .optional()
      .isInt({ min: 1 })
      .withMessage('nmt debe ser un número entero positivo'),
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
      .isIn(['day', 'week', 'month', 'year'])
      .withMessage('groupBy debe ser "day", "week", "month" o "year"'),
    query('metric')
      .optional()
      .isIn(['laeq24', 'diurno', 'vespertino', 'nocturno'])
      .withMessage('metric debe ser un tipo válido')
  ],
  validateRequest,
  cacheMiddleware('noise'),
  getTemporalTrends
);

/**
 * @route   GET /api/v1/noise-monitoring/compliance/zone
 * @desc    Análisis de cumplimiento normativo por zona
 * @access  Privado (requiere autenticación)
 */
router.get('/compliance/zone',
  noiseStatisticsLimiter,
  authenticate,
  [
    query('startDate')
      .optional()
      .isISO8601()
      .withMessage('startDate debe ser una fecha válida'),
    query('endDate')
      .optional()
      .isISO8601()
      .withMessage('endDate debe ser una fecha válida'),
    query('threshold')
      .optional()
      .isInt({ min: ROUTE_SPECIFIC_LIMITS.NOISE.DB_THRESHOLD_MIN, max: ROUTE_SPECIFIC_LIMITS.NOISE.DB_THRESHOLD_MAX })
      .withMessage(`threshold debe ser un número entre ${ROUTE_SPECIFIC_LIMITS.NOISE.DB_THRESHOLD_MIN} y ${ROUTE_SPECIFIC_LIMITS.NOISE.DB_THRESHOLD_MAX}`),
    query('zoneType')
      .optional()
      .isIn(['residential', 'commercial', 'industrial', 'mixed'])
      .withMessage('zoneType debe ser un tipo de zona válido')
  ],
  validateRequest,
  cacheMiddleware('noise'),
  getComplianceByZone
);

/**
 * @route   GET /api/v1/noise-monitoring/stations/search
 * @desc    Buscar estaciones de monitoreo por nombre
 * @access  Privado (requiere autenticación)
 */
router.get('/stations/search',
  searchLimiter,
  authenticate,
  searchValidation,
  validateRequest,
  cacheMiddleware('noise'), // Cache por 10 minutos (búsquedas cambian poco)
  searchStations
);

/**
 * @route   GET /api/v1/noise-monitoring/:id
 * @desc    Obtener datos detallados de contaminación acústica por ID
 * @access  Privado (requiere autenticación)
 */
router.get('/:id',
  noiseDataLimiter,
  authenticate,
  idValidation,
  validateRequest,
  cacheMiddleware('noise'), // Cache por 5 minutos
  getNoiseMonitoringById
);

module.exports = router;
