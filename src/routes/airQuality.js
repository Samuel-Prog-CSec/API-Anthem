/**
 * Rutas de Calidad de Aire
 *
 * Define todos los endpoints relacionados con datos de calidad de aire,
 * incluyendo consultas, filtros, estadísticas y tendencias.
 */

const express = require('express');
const { body, query, param } = require('express-validator');
const rateLimit = require('express-rate-limit');

// Middleware de autenticación y seguridad
const { authenticate } = require('../middleware/auth');
const { validateRequest } = require('../middleware/security');

// Middleware de caché optimizado
const { cacheMiddleware, statsCacheMiddleware, compressionMiddleware } = require('../middleware/cache');

// Controladores
const {
  getAirQualityData,
  getAirQualityById,
  getAirQualityStatistics,
  getAirQualityTrends
} = require('../controllers/airQualityController');

const router = express.Router();

/**
 * Rate limiting específico para endpoints de datos ambientales
 * Permite más consultas que el rate limiting general debido a las necesidades del dashboard
 */
const dataQueryLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minuto
  max: 30, // 30 peticiones por minuto por IP
  message: {
    success: false,
    message: 'Demasiadas consultas de datos, intente nuevamente en 1 minuto'
  },
  standardHeaders: true,
  legacyHeaders: false
});

const statisticsLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutos
  max: 10, // 10 peticiones por 5 minutos (estadísticas son más costosas)
  message: {
    success: false,
    message: 'Límite de consultas estadísticas alcanzado, intente nuevamente en 5 minutos'
  }
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
    .isInt({ min: 1, max: 99 })
    .withMessage('provincia debe ser un número entre 1 y 99'),

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
      const validMagnitudes = [1, 6, 7, 8, 9, 10, 12, 14, 20, 30, 42, 43, 44];
      if (Array.isArray(value)) {
        return value.every(v => validMagnitudes.includes(parseInt(v)));
      }
      return validMagnitudes.includes(parseInt(value));
    })
    .withMessage('magnitud debe ser un código válido de contaminante'),

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
    .isIn(['fecha', 'provincia', 'municipio', 'estacion', 'magnitud'])
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
    .isIn(['day', 'month', 'year', 'station'])
    .withMessage('groupBy debe ser "day", "month", "year" o "station"'),

  query('provincia')
    .optional()
    .isInt({ min: 1, max: 99 })
    .withMessage('provincia debe ser un número entre 1 y 99'),

  query('municipio')
    .optional()
    .isInt({ min: 1 })
    .withMessage('municipio debe ser un número entero positivo'),

  query('magnitud')
    .optional()
    .isInt({ min: 1 })
    .withMessage('magnitud debe ser un número entero')
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
  compressionMiddleware(),
  getAirQualityData
);

/**
 * @route   GET /api/v1/air-quality/statistics
 * @desc    Obtener estadísticas agregadas de calidad de aire
 * @access  Privado (requiere autenticación)
 */
router.get('/statistics',
  statisticsLimiter,
  authenticate,
  statisticsValidation,
  validateRequest,
  cacheMiddleware('airQuality'), // Cache por 30 minutos
  compressionMiddleware(),
  getAirQualityStatistics
);

/**
 * @route   GET /api/v1/air-quality/trends
 * @desc    Obtener tendencias de calidad de aire
 * @access  Privado (requiere autenticación)
 */
router.get('/trends',
  statisticsLimiter,
  authenticate,
  [
    query('startDate').optional().isISO8601(),
    query('endDate').optional().isISO8601(),
    query('provincia').optional().isInt({ min: 1, max: 99 }),
    query('municipio').optional().isInt({ min: 1 }),
    query('magnitud').optional().isInt({ min: 1 })
  ],
  validateRequest,
  cacheMiddleware('airQuality'), // Cache por 30 minutos
  compressionMiddleware(),
  getAirQualityTrends
);

/**
 * @route   GET /api/v1/air-quality/:id
 * @desc    Obtener datos detallados de calidad de aire por ID
 * @access  Privado (requiere autenticación)
 */
router.get('/:id',
  dataQueryLimiter,
  authenticate,
  idValidation,
  validateRequest,
  cacheMiddleware('airQuality'), // Cache por 30 minutos
  getAirQualityById
);

module.exports = router;
