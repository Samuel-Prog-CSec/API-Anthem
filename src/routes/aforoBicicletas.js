/**
 * Rutas de Aforo de Bicicletas
 *
 * Define todas las rutas relacionadas con la gestion y consulta de datos
 * de conteo de trafico de bicicletas en estaciones de aforo.
 * Incluye middlewares de autenticacion, validacion y limitacion de velocidad.
 */

const express = require('express');
const { param, query } = require('express-validator');
const rateLimit = require('express-rate-limit');
const { RATE_LIMITS, ROUTE_SPECIFIC_LIMITS, HTTP_STATUS } = require('../constants');

const bikeTrafficController = require('../controllers/controladorAforoBicicletas');
const { authenticate } = require('../middleware/auth');
const { validateRequest } = require('../middleware/security');
const { performanceMonitor } = require('../middleware/performanceMonitor');
const { etagMiddleware } = require('../middleware/etag');
const logger = require('../config/logger');
const {
  validatePagination,
  validateDateRange
} = require('../middleware/validation');
const { cacheMiddleware } = require('../middleware/cache');

const router = express.Router();

// Aplicar performanceMonitor a todas las rutas de aforo
router.use(performanceMonitor);

/**
 * Limitadores de velocidad
 */

// Para consultas generales
const generalLimit = rateLimit({
  windowMs: RATE_LIMITS.GENERAL.WINDOW_MS,
  max: RATE_LIMITS.GENERAL.MAX_REQUESTS,
  message: {
    error: 'Demasiadas consultas de aforo de bicicletas. Intente nuevamente en 15 minutos.',
    retryAfter: RATE_LIMITS.GENERAL.RETRY_AFTER
  },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.user && req.user.role === 'admin'
});

/**
 * RUTAS PRINCIPALES
 */

/**
 * @route   GET /api/bike-traffic
 * @desc    Obtener todos los registros de aforo con filtros
 * @access  Private
 */
router.get('/',
  generalLimit,
  authenticate,
  validateDateRange,
  validatePagination,
  [
    query('identificador')
      .optional()
      .isString()
      .trim()
      .withMessage('El identificador debe ser una cadena de texto'),
    query('distrito')
      .optional()
      .isString()
      .trim()
      .withMessage('El distrito debe ser una cadena de texto'),
    query('hora')
      .optional()
      .isInt({ min: 0, max: 23 })
      .withMessage('La hora debe ser un numero entre 0 y 23'),
    validateRequest
  ],
  cacheMiddleware('bikeTraffic'),
  bikeTrafficController.obtenerConteos
);

/**
 * @route   GET /api/bike-traffic/stats
 * @desc    Obtener estadisticas generales de aforo
 * @access  Private
 */
router.get('/estadisticas',
  generalLimit,
  authenticate,
  validateDateRange,
  etagMiddleware,
  cacheMiddleware('bikeTraffic'),
  bikeTrafficController.obtenerEstadisticas
);

/**
 * @route   GET /api/bike-traffic/hourly
 * @desc    Obtener distribucion horaria de trafico
 * @access  Private
 */
router.get('/distribucion-horaria',
  generalLimit,
  authenticate,
  [
    query('identificador')
      .optional()
      .isString()
      .trim()
      .withMessage('El identificador debe ser una cadena de texto'),
    query('distrito')
      .optional()
      .isString()
      .trim()
      .withMessage('El distrito debe ser una cadena de texto'),
    validateRequest
  ],
  validateDateRange,
  etagMiddleware,
  cacheMiddleware('bikeTraffic'),
  bikeTrafficController.obtenerDistribucionHoraria
);

/**
 * @route   GET /api/bike-traffic/stations
 * @desc    Obtener ranking de estaciones por trafico
 * @access  Private
 */
router.get('/estaciones',
  generalLimit,
  authenticate,
  [
    query('limit')
      .optional()
      .isInt({ min: 1, max: 100 })
      .withMessage('El limite debe ser un numero entre 1 y 100'),
    query('distrito')
      .optional()
      .isString()
      .trim()
      .withMessage('El distrito debe ser una cadena de texto'),
    validateRequest
  ],
  validateDateRange,
  etagMiddleware,
  cacheMiddleware('bikeTraffic'),
  bikeTrafficController.obtenerComparativaEstaciones
);

/**
 * @route   GET /api/bike-traffic/trends/daily
 * @desc    Obtener tendencias diarias de trafico
 * @access  Private
 */
router.get('/tendencias/diario',
  generalLimit,
  authenticate,
  [
    query('identificador')
      .optional()
      .isString()
      .trim()
      .withMessage('El identificador debe ser una cadena de texto'),
    query('distrito')
      .optional()
      .isString()
      .trim()
      .withMessage('El distrito debe ser una cadena de texto'),
    validateRequest
  ],
  validateDateRange,
  cacheMiddleware('bikeTraffic'),
  bikeTrafficController.obtenerTendenciasDiarias
);

/**
 * @route   GET /api/bike-traffic/station/:identificador
 * @desc    Obtener datos de una estacion especifica
 * @access  Private
 */
router.get('/estacion/:identificador',
  generalLimit,
  authenticate,
  [
    param('identificador')
      .isString()
      .trim()
      .notEmpty()
      .withMessage('El identificador de estacion es requerido'),
    validateRequest
  ],
  validateDateRange,
  cacheMiddleware('bikeTraffic'),
  bikeTrafficController.obtenerDatosEstacion
);

/**
 * Middleware de logging para todas las rutas de aforo
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
    }, 'Consulta de aforo de bicicletas completada');
  });

  next();
});

/**
 * Manejo de errores especifico para rutas de aforo
 */
router.use((error, req, res, _next) => {
  logger.error({
    error: error.message,
    stack: error.stack,
    path: req.path,
    method: req.method,
    userId: req.user?.id
  }, 'Error en rutas de aforo de bicicletas');

  if (error.status || error.statusCode) {
    return res.status(error.status || error.statusCode).json({
      success: false,
      message: error.message
    });
  }

  res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
    success: false,
    message: 'Error interno en el procesamiento de datos de aforo de bicicletas',
    requestId: req.id || Date.now()
  });
});

module.exports = router;
