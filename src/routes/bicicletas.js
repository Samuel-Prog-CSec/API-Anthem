/**
 * Rutas de Disponibilidad de Bicicletas
 *
 * Define todas las rutas relacionadas con la gestión y consulta de datos
 * de disponibilidad de bicicletas eléctricas.
 * Incluye middlewares de autenticación, validación y limitación de velocidad.
 */

const express = require('express');
const { query } = require('express-validator');
const rateLimit = require('express-rate-limit');
const { RATE_LIMITS, ROUTE_SPECIFIC_LIMITS, HTTP_STATUS, USER_ROLES } = require('../constants');

const bikeController = require('../controllers/controladorBicicletas');
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
  windowMs: RATE_LIMITS.GENERAL.WINDOW_MS,
  max: RATE_LIMITS.GENERAL.MAX_REQUESTS,
  message: {
    error: 'Demasiadas consultas de bicicletas. Intente nuevamente en 15 minutos.',
    retryAfter: RATE_LIMITS.GENERAL.RETRY_AFTER
  },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.user && req.user.role === USER_ROLES.ADMIN
});

/**
 * RUTAS PRINCIPALES
 */

/**
 * @route   GET /api/bikes
 * @desc    Obtener todos los registros de disponibilidad con filtros
 * @access  Privado
 */
router.get('/',
  generalLimit,
  authenticate,
  validateDateRange,
  validatePagination,
  validateBikeFilters,
  cacheMiddleware('bikes'), // Cache por 5 minutos
  bikeController.obtenerDisponibilidad
);

/**
 * @route   GET /api/bikes/stats
 * @desc    Obtener estadísticas generales de disponibilidad
 * @access  Privado
 */
router.get('/estadisticas',
  generalLimit,
  authenticate,
  validateDateRange,
  etagMiddleware, // ETags para estadísticas (datos agregados relativamente estables)
  cacheMiddleware('bikes'), // Cache por 5 minutos
  bikeController.obtenerEstadisticas
);

/**
 * @route   GET /api/bikes/trends/monthly
 * @desc    Obtener tendencias mensuales
 * @access  Privado
 */
router.get('/tendencias/mensual',
  generalLimit,
  authenticate,
  [
    query('year')
      .optional()
      .isInt({ min: ROUTE_SPECIFIC_LIMITS.BIKE.YEAR_MIN, max: ROUTE_SPECIFIC_LIMITS.BIKE.YEAR_MAX })
      .withMessage(`Año debe ser un número entre ${ROUTE_SPECIFIC_LIMITS.BIKE.YEAR_MIN} y ${ROUTE_SPECIFIC_LIMITS.BIKE.YEAR_MAX}`),
    validateRequest
  ],
  etagMiddleware, // ETags para tendencias mensuales (datos agregados estables)
  cacheMiddleware('bikes'), // Cache por 5 minutos
  bikeController.obtenerTendenciasMensuales
);

/**
 * @route   GET /api/bikes/top-usage
 * @desc    Obtener días con mayor y menor uso
 * @access  Privado
 */
router.get('/mayor-uso',
  generalLimit,
  authenticate,
  [
    query('limit')
      .optional()
      .isInt({ min: ROUTE_SPECIFIC_LIMITS.BIKE.TOP_N_MIN, max: ROUTE_SPECIFIC_LIMITS.BIKE.TOP_N_MAX })
      .withMessage(`Límite debe ser entre ${ROUTE_SPECIFIC_LIMITS.BIKE.TOP_N_MIN} y ${ROUTE_SPECIFIC_LIMITS.BIKE.TOP_N_MAX}`),
    validateRequest
  ],
  cacheMiddleware('bikes'), // Cache por 5 minutos
  bikeController.obtenerDiasMayorUso
);

/**
 * @route   GET /api/bikes/subscription-comparison
 * @desc    Comparar uso por tipo de abonado
 * @access  Privado
 */
router.get('/comparativa-suscripciones',
  generalLimit,
  authenticate,
  validateDateRange,
  etagMiddleware, // ETags para comparación de suscripciones (datos agregados)
  cacheMiddleware('bikes'), // Cache por 5 minutos
  bikeController.obtenerComparativaSuscripciones
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

  res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
    success: false,
    message: 'Error interno en el procesamiento de datos de bicicletas',
    requestId: req.id || Date.now()
  });
});

module.exports = router;
