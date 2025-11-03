/**
 * Rutas de Contaminación Acústica
 *
 * Define todos los endpoints relacionados con datos de contaminación acústica,
 * incluyendo consultas, estadísticas, ranking y búsqueda de estaciones.
 */

const express = require('express');
const { body, query, param } = require('express-validator');
const rateLimit = require('express-rate-limit');

// Middleware de autenticación y seguridad
const { authenticate } = require('../middleware/auth');
const { validateRequest } = require('../middleware/security');
const { validateDateRange } = require('../middleware/validation');

// Middleware de caché optimizado
const { cacheMiddleware, statsCacheMiddleware, compressionMiddleware } = require('../middleware/cache');

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

/**
 * Rate limiting específico para endpoints de contaminación acústica
 */
const noiseDataLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minuto
  max: 25, // 25 peticiones por minuto por IP
  message: {
    success: false,
    message: 'Demasiadas consultas de datos acústicos, intente nuevamente en 1 minuto'
  },
  standardHeaders: true,
  legacyHeaders: false
});

const noiseStatisticsLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutos
  max: 10, // 10 peticiones por 5 minutos
  message: {
    success: false,
    message: 'Límite de consultas estadísticas acústicas alcanzado, intente nuevamente en 5 minutos'
  }
});

const searchLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minuto
  max: 15, // 15 búsquedas por minuto
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
    .isInt({ min: 1900, max: 2100 })
    .withMessage('año debe ser un número válido entre 1900 y 2100'),

  query('mes')
    .optional()
    .isInt({ min: 1, max: 12 })
    .withMessage('mes debe ser un número entre 1 y 12'),

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
    .isLength({ min: 2, max: 100 })
    .withMessage('nombre debe tener entre 2 y 100 caracteres')
    .trim()
    .escape(),

  query('page')
    .optional()
    .isInt({ min: 1 })
    .withMessage('page debe ser un número entero positivo'),

  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('limit debe ser un número entre 1 y 100'),

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
    .isInt({ min: 5, max: 50 })
    .withMessage('limit debe ser un número entre 5 y 50')
];

/**
 * Validaciones para búsqueda de estaciones
 */
const searchValidation = [
  query('q')
    .notEmpty()
    .withMessage('Parámetro de búsqueda "q" es requerido')
    .isLength({ min: 2, max: 100 })
    .withMessage('Búsqueda debe tener entre 2 y 100 caracteres')
    .trim()
    .escape(),

  query('limit')
    .optional()
    .isInt({ min: 1, max: 50 })
    .withMessage('limit debe ser un número entre 1 y 50')
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
  validateDateRange(1825), // 5 años
  noiseQueryValidation,
  validateRequest,
  cacheMiddleware('noise'), // Cache por 3 minutos
  compressionMiddleware(),
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
  validateDateRange(1825), // 5 años
  noiseStatisticsValidation,
  validateRequest,
  cacheMiddleware('noise'), // Cache por 1 hora
  compressionMiddleware(),
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
  cacheMiddleware('noise'), // Cache por 1 hora
  compressionMiddleware(),
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
  compressionMiddleware(),
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
  compressionMiddleware(),
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
      .isInt({ min: 40, max: 100 })
      .withMessage('threshold debe ser un número entre 40 y 100'),
    query('zoneType')
      .optional()
      .isIn(['residential', 'commercial', 'industrial', 'mixed'])
      .withMessage('zoneType debe ser un tipo de zona válido')
  ],
  validateRequest,
  cacheMiddleware('noise'),
  compressionMiddleware(),
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
