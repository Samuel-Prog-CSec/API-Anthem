/**
 * Rutas de Contaminación Acústica
 *
 * Define todos los endpoints relacionados con datos de contaminación acústica,
 * incluyendo consultas, estadísticas, ranking y búsqueda de estaciones.
 */

const express = require('express');
const { query } = require('express-validator');
const rateLimit = require('express-rate-limit');

// Constantes
const {
  RATE_LIMITS,
  ROUTE_SPECIFIC_LIMITS,
  DATE_RANGE_LIMITS,
  SORT_FIELDS,
  ZONE_TYPES
} = require('../constants');

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
  getNoiseStatistics,
  getNoiseRanking,
  getComplianceByZone,
  obtenerTendenciasTemporales
} = require('../controllers/controladorRuido');

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
        return value.every(v => Number.isInteger(parseInt(v, 10)) && parseInt(v, 10) > 0);
      }
      return Number.isInteger(parseInt(value, 10)) && parseInt(value, 10) > 0;
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
    .isIn(Object.values(SORT_FIELDS.NOISE_MONITORING))
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
 * @route   GET /api/v1/ruido/estadisticas
 * @desc    Obtener estadisticas de contaminacion acustica
 * @access  Privado (requiere autenticacion)
 */
router.get('/estadisticas',
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
 * @route   GET /api/v1/ruido/ranking
 * @desc    Obtener ranking de estaciones por nivel de ruido
 * @access  Privado (requiere autenticacion)
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
 * @route   GET /api/v1/ruido/cumplimiento/zona
 * @desc    Analisis de cumplimiento normativo por zona
 * @access  Privado (requiere autenticacion)
 */
router.get('/cumplimiento/zona',
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
      .isIn(Object.values(ZONE_TYPES))
      .withMessage('zoneType debe ser un tipo de zona válido')
  ],
  validateRequest,
  etagMiddleware, // ETags para análisis de cumplimiento (datos agregados)
  cacheMiddleware('noise'),
  getComplianceByZone
);

/**
 * @route   GET /api/v1/ruido/tendencias/temporal
 * @desc    Obtener tendencias temporales de ruido
 * @access  Privado
 */
router.get('/tendencias/temporal',
  noiseStatisticsLimiter,
  authenticate,
  [
    query('startDate').notEmpty().isISO8601().withMessage('startDate es obligatorio en formato ISO 8601'),
    query('endDate').notEmpty().isISO8601().withMessage('endDate es obligatorio en formato ISO 8601'),
    query('nmt').optional().isInt({ min: 1 }).withMessage('nmt debe ser un entero positivo'),
    query('groupBy').optional().isIn(['day', 'month', 'year']).withMessage('groupBy debe ser: day, month, year'),
    query('metric').optional().isIn(['laeq24', 'nivelDiurno', 'nivelVespertino', 'nivelNocturno']).withMessage('metric debe ser: laeq24, nivelDiurno, nivelVespertino, nivelNocturno')
  ],
  validateRequest,
  cacheMiddleware('noise'),
  obtenerTendenciasTemporales
);

module.exports = router;
