/**
 * Rutas de Disponibilidad de Bicicletas
 *
 * Define todas las rutas relacionadas con la gestión y consulta de datos
 * de disponibilidad de bicicletas eléctricas.
 * Incluye middlewares de autenticación, validación y limitación de velocidad.
 */

const express = require('express');
const { param, query } = require('express-validator');
const rateLimit = require('express-rate-limit');

const bikeController = require('../controllers/bikeAvailabilityController');
const { authenticate } = require('../middleware/auth');
const { validateRequest } = require('../middleware/security');
const { performanceMonitor } = require('../middleware/performanceMonitor');
const { etagMiddleware } = require('../middleware/etag');
const logger = require('../config/logger');
const {
  validatePagination,
  validateDateRange,
  validateBikeFilters
} = require('../middleware/validation');
const { cacheMiddleware } = require('../middleware/cache');

const router = express.Router();

// Aplicar performanceMonitor a todas las rutas de bicicletas
router.use(performanceMonitor);

/**
 * Limitadores de velocidad
 */

// Para consultas generales
const generalLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 100,
  message: {
    error: 'Demasiadas consultas de bicicletas. Intente nuevamente en 15 minutos.',
    retryAfter: 15 * 60
  },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.user && req.user.role === 'admin'
});

/**
 * RUTAS PRINCIPALES
 */

/**
 * @route   GET /api/bikes
 * @desc    Obtener todos los registros de disponibilidad con filtros
 * @access  Private
 */
router.get('/',
  generalLimit,
  authenticate,
  validateDateRange,
  validatePagination,
  validateBikeFilters,
  cacheMiddleware('bikes'), // Cache por 5 minutos
  bikeController.getAllBikeAvailability
);

/**
 * @route   GET /api/bikes/date/:date
 * @desc    Obtener disponibilidad de una fecha específica
 * @access  Private
 */
router.get('/date/:date',
  generalLimit,
  authenticate,
  [
    param('date')
      .isISO8601()
      .withMessage('Fecha debe estar en formato ISO8601 (YYYY-MM-DD)'),
    validateRequest
  ],
  cacheMiddleware('bikes'), // Cache por 5 minutos
  bikeController.getBikeAvailabilityByDate
);

/**
 * @route   GET /api/bikes/stats
 * @desc    Obtener estadísticas generales de disponibilidad
 * @access  Private
 */
router.get('/stats',
  generalLimit,
  authenticate,
  validateDateRange,
  etagMiddleware, // ETags para estadísticas (datos agregados relativamente estables)
  cacheMiddleware('bikes'), // Cache por 5 minutos
  bikeController.getBikeStats
);

/**
 * @route   GET /api/bikes/trends/monthly
 * @desc    Obtener tendencias mensuales
 * @access  Private
 */
router.get('/trends/monthly',
  generalLimit,
  authenticate,
  [
    query('year')
      .optional()
      .isInt({ min: 2050, max: 2052 })
      .withMessage('Año debe ser un número entre 2050 y 2052'),
    validateRequest
  ],
  cacheMiddleware('bikes'), // Cache por 5 minutos
  bikeController.getMonthlyTrends
);

/**
 * @route   GET /api/bikes/top-usage
 * @desc    Obtener días con mayor y menor uso
 * @access  Private
 */
router.get('/top-usage',
  generalLimit,
  authenticate,
  [
    query('limit')
      .optional()
      .isInt({ min: 1, max: 50 })
      .withMessage('Límite debe ser entre 1 y 50'),
    validateRequest
  ],
  cacheMiddleware('bikes'), // Cache por 5 minutos
  bikeController.getTopUsageDays
);

/**
 * @route   GET /api/bikes/subscription-comparison
 * @desc    Comparar uso por tipo de abonado
 * @access  Private
 */
router.get('/subscription-comparison',
  generalLimit,
  authenticate,
  validateDateRange,
  cacheMiddleware('bikes'), // Cache por 5 minutos
  bikeController.getSubscriptionComparison
);

/**
 * @route   GET /api/bikes/efficiency
 * @desc    Obtener análisis de eficiencia del servicio
 * @access  Private
 */
router.get('/efficiency',
  generalLimit,
  authenticate,
  validateDateRange,
  cacheMiddleware('bikes'), // Cache por 5 minutos
  bikeController.getEfficiencyAnalysis
);

/**
 * @route   GET /api/bikes/historical
 * @desc    Obtener datos históricos agregados para gráficos
 * @access  Private
 */
router.get('/historical',
  generalLimit,
  authenticate,
  [
    query('aggregation')
      .optional()
      .isIn(['day', 'week', 'month'])
      .withMessage('Agregación debe ser day, week o month'),
    validateRequest
  ],
  validateDateRange,
  cacheMiddleware('bikes'), // Cache por 5 minutos
  bikeController.getHistoricalData
);

/**
 * @route   GET /api/bikes/trends/usage
 * @desc    Obtener tendencias de uso con agregación flexible
 * @access  Private
 */
router.get('/trends/usage',
  generalLimit,
  authenticate,
  [
    query('startDate')
      .notEmpty()
      .withMessage('startDate es requerido')
      .isISO8601()
      .withMessage('startDate debe ser una fecha válida'),
    query('endDate')
      .notEmpty()
      .withMessage('endDate es requerido')
      .isISO8601()
      .withMessage('endDate debe ser una fecha válida'),
    query('groupBy')
      .optional()
      .isIn(['day', 'week', 'month'])
      .withMessage('groupBy debe ser day, week o month'),
    query('includeUserTypes')
      .optional()
      .isBoolean()
      .withMessage('includeUserTypes debe ser true o false'),
    validateRequest
  ],
  cacheMiddleware('bikes'), // Cache por 10 minutos
  bikeController.getUsageTrendsAnalysis
);

/**
 * @route   GET /api/bikes/prediction/demand
 * @desc    Obtener predicción de demanda basada en patrones históricos
 * @access  Private
 */
router.get('/prediction/demand',
  generalLimit,
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
      .isInt({ min: 50, max: 100 })
      .withMessage('threshold debe ser un número entre 50 y 100'),
    validateRequest
  ],
  cacheMiddleware('bikes'), // Cache por 30 minutos
  bikeController.getDemandPredictionAnalysis
);

/**
 * Middleware de logging para todas las rutas de bicicletas
 */
router.use((req, res, next) => {
  const start = Date.now();

  res.on('finish', () => {
    const duration = Date.now() - start;

    logger.debug({
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      duration: `${duration}ms`,
      userId: req.user?.id,
      query: Object.keys(req.query).length > 0 ? req.query : undefined
    }, 'Consulta de bicicletas completada');
  });

  next();
});

/**
 * Manejo de errores específico para rutas de bicicletas
 */
router.use((error, req, res, _next) => {
  logger.error({
    error: error.message,
    stack: error.stack,
    path: req.path,
    method: req.method,
    userId: req.user?.id
  }, 'Error en rutas de bicicletas');

  if (error.status || error.statusCode) {
    return res.status(error.status || error.statusCode).json({
      success: false,
      message: error.message
    });
  }

  res.status(500).json({
    success: false,
    message: 'Error interno en el procesamiento de datos de bicicletas',
    requestId: req.id || Date.now()
  });
});

module.exports = router;
