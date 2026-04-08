/**
 * Rutas de Accidentalidad
 *
 * Define todas las rutas relacionadas con la gestión y consulta de datos de accidentes.
 * Incluye middlewares de autenticación, validación y limitación de velocidad.
 */

const express = require('express');
const rateLimit = require('express-rate-limit');
const {
  USER_ROLES,
  RATE_LIMITS,
  DATE_RANGE_LIMITS,
  HTTP_STATUS
} = require('../constants');

const accidentController = require('../controllers/controladorAccidentes');
const { authenticate } = require('../middleware/auth');
const { cacheMiddleware } = require('../middleware/cache');
const { performanceMonitor } = require('../middleware/performanceMonitor');
const { etagMiddleware } = require('../middleware/etag');
const logger = require('../config/logger');
const {
  validateDateRange,
  validateDistrictQuery,
  validatePagination,
  validateAccidentFilters,
  validateFileNumber
} = require('../middleware/validation');


const router = express.Router();

// Aplicar performanceMonitor a todas las rutas de accidentes
router.use(performanceMonitor);

/**
 * Limitadores de velocidad específicos
 */

// Para consultas generales
const generalLimit = rateLimit({
  windowMs: RATE_LIMITS.GENERAL.WINDOW_MS,
  max: RATE_LIMITS.GENERAL.MAX_REQUESTS,
  message: {
    error: 'Demasiadas consultas de accidentalidad. Intente nuevamente en 15 minutos.',
    retryAfter: RATE_LIMITS.GENERAL.RETRY_AFTER
  },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    return req.user && req.user.role === USER_ROLES.ADMIN;
  }
});

/**
 * RUTAS PRINCIPALES
 */

/**
 * @route   GET /api/v1/accidents
 * @desc    Obtener datos de accidentalidad con filtros avanzados
 * @access  Privado (requiere autenticación)
 * @rateLimit 100 requests por 15 minutos
 * @query   {string} startDate - Fecha de inicio (ISO8601)
 * @query   {string} endDate - Fecha de fin (ISO8601)
 * @query   {string} tipoAccidente - Tipo de accidente
 * @query   {string} gravedad - Gravedad del accidente
 * @query   {number} page - Página (defecto: 1)
 * @query   {number} limit - Elementos por página (defecto: 50, max: 100)
 */
router.get('/',
  generalLimit,
  authenticate,
  validateDateRange(DATE_RANGE_LIMITS.ACCIDENTS_MAX_DAYS),
  validatePagination,
  validateAccidentFilters,
  cacheMiddleware('statistics', (req) => `accidents:list:${JSON.stringify(req.query)}`),
  accidentController.obtenerAccidentes
);

/**
 * @route   GET /api/accidents/expediente/:numero
 * @desc    Obtener accidente específico por número de expediente
 * @access  Privado
 * @rateLimit 100 requests per 15 minutes
 */
router.get('/expediente/:numero',
  generalLimit,
  authenticate,
  validateFileNumber,
  accidentController.obtenerAccidentePorExpediente
);

/**
 * @route   GET /api/accidents/stats
 * @desc    Obtener estadísticas generales de accidentalidad
 * @access  Privado
 * @rateLimit 100 requests per 15 minutes
 */
router.get('/estadisticas',
  generalLimit,
  authenticate,
  validateDistrictQuery,
  validateDateRange(DATE_RANGE_LIMITS.ACCIDENTS_MAX_DAYS),
  etagMiddleware, // ETags para estadísticas agregadas (datos estables)
  cacheMiddleware('statistics', (req) => `accidents:stats:${JSON.stringify(req.query)}`),
  accidentController.obtenerEstadisticasAccidentes
);

/**
 * @route   GET /api/accidents/district-comparison
 * @desc    Obtener comparativa entre distritos
 * @access  Privado
 * @rateLimit 100 requests per 15 minutes
 */
router.get('/comparativa-distritos',
  generalLimit,
  authenticate,
  validateDateRange(DATE_RANGE_LIMITS.ACCIDENTS_MAX_DAYS),
  cacheMiddleware('statistics', (req) => `accidents:district-comp:${JSON.stringify(req.query)}`),
  accidentController.obtenerComparativaDistritos
);

/**
 * Middleware de logging para todas las rutas de accidentes
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
    }, 'Consulta de accidentes completada');
  });

  next();
});

/**
 * Manejo de errores específico para rutas de accidentes
 */
router.use((error, req, res, _next) => {
  logger.error({
    error: error.message,
    stack: error.stack,
    path: req.path,
    method: req.method,
    userId: req.user?.id
  }, 'Error en rutas de accidentes');

  // Si el error ya fue manejado, pasarlo al siguiente middleware
  if (error.status || error.statusCode) {
    return res.status(error.status || error.statusCode).json({
      success: false,
      message: error.message
    });
  }

  // Error específico de accidentes
  res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
    success: false,
    message: 'Error interno en el procesamiento de datos de accidentalidad',
    requestId: req.id || Date.now()
  });
});

/**
 * @route   GET /api/v1/accidentes/mapa-calor
 * @desc    Obtener datos agrupados para mapa de calor de accidentes
 * @access  Privado
 */
router.get('/mapa-calor',
  generalLimit,
  authenticate,
  cacheMiddleware('accidents'),
  accidentController.obtenerMapaCalorAccidentes
);

module.exports = router;
