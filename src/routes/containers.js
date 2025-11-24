/**
 * Rutas de Contenedores
 *
 * Define todas las rutas relacionadas con la gestión y consulta de datos
 * de contenedores de residuos.
 * Incluye middlewares de autenticación, validación y limitación de velocidad.
 */

const express = require('express');
const rateLimit = require('express-rate-limit');
const { query, param } = require('express-validator');
const {
  CONTAINER_TYPES,
  PAGINATION,
  RATE_LIMITS,
  ROUTE_SPECIFIC_LIMITS,
  HTTP_STATUS
} = require('../constants');

const containerController = require('../controllers/containerController');
const { authenticate } = require('../middleware/auth');
const { validateRequest } = require('../middleware/security');
const { cacheMiddleware } = require('../middleware/cache');
const { performanceMonitor } = require('../middleware/performanceMonitor');
const { etagMiddleware } = require('../middleware/etag');
const logger = require('../config/logger');
const {
  validatePagination,
  validateContainerType,
  validateContainerFilters,
  validateCoordinates
} = require('../middleware/validation');

const router = express.Router();

// Aplicar performanceMonitor a todas las rutas de contenedores
router.use(performanceMonitor);

/**
 * Limitadores de velocidad
 */

// Para consultas generales
const generalLimit = rateLimit({
  windowMs: RATE_LIMITS.GENERAL.WINDOW_MS,
  max: RATE_LIMITS.GENERAL.MAX_REQUESTS,
  message: {
    error: 'Demasiadas consultas de contenedores. Intente nuevamente en 15 minutos.',
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
 * @route   GET /api/containers
 * @desc    Obtener todos los contenedores con filtros
 * @access  Private
 */
router.get('/',
  generalLimit,
  authenticate,
  validatePagination,
  validateContainerType,
  validateContainerFilters,
  etagMiddleware, // ETags para datos estáticos de contenedores
  cacheMiddleware('containers'), // Cache por 24 horas (datos estáticos)
  containerController.getAllContainers
);

/**
 * @route   GET /api/containers/nearby
 * @desc    Buscar contenedores cercanos a una ubicación
 * @access  Private
 */
router.get('/nearby',
  generalLimit,
  authenticate,
  validateCoordinates,
  validateContainerType,
  cacheMiddleware('containers'), // Cache por 24 horas (datos estáticos)
  containerController.getNearbyContainers
);

/**
 * @route   GET /api/containers/stats
 * @desc    Obtener estadísticas generales de contenedores
 * @access  Private
 */
router.get('/stats',
  generalLimit,
  authenticate,
  etagMiddleware, // ETags para estadísticas agregadas (datos estáticos)
  cacheMiddleware('containers'), // Cache por 24 horas (datos estáticos)
  containerController.getContainerStats
);

/**
 * @route   GET /api/containers/stats/district
 * @desc    Obtener estadísticas por distrito
 * @access  Private
 */
router.get('/stats/district',
  generalLimit,
  authenticate,
  [
    query('distrito')
      .optional()
      .trim()
      .notEmpty()
      .withMessage('Distrito no puede estar vacío'),
    validateRequest
  ],
  etagMiddleware, // ETags para estadísticas por distrito (datos estáticos)
  cacheMiddleware('containers'), // Cache por 24 horas (datos estáticos)
  containerController.getStatsByDistrict
);

/**
 * @route   GET /api/containers/stats/neighborhood
 * @desc    Obtener estadísticas por barrio
 * @access  Private
 */
router.get('/stats/neighborhood',
  generalLimit,
  authenticate,
  [
    query('distrito')
      .notEmpty()
      .withMessage('Distrito es obligatorio')
      .trim(),

    query('barrio')
      .optional()
      .trim()
      .notEmpty()
      .withMessage('Barrio no puede estar vacío'),

    validateRequest
  ],
  etagMiddleware, // ETags para estadísticas por barrio (datos estáticos)
  cacheMiddleware('containers'), // Cache por 24 horas (datos estáticos)
  containerController.getStatsByNeighborhood
);

/**
 * @route   GET /api/containers/count-by-type
 * @desc    Contar contenedores por tipo en un área
 * @access  Private
 */
router.get('/count-by-type',
  generalLimit,
  authenticate,
  [
    query('distrito')
      .notEmpty()
      .withMessage('Distrito es obligatorio')
      .trim(),

    query('barrio')
      .optional()
      .trim()
      .notEmpty()
      .withMessage('Barrio no puede estar vacío'),

    validateRequest
  ],
  cacheMiddleware('containers'), // Cache por 24 horas (datos estáticos)
  containerController.countByType
);

/**
 * @route   GET /api/containers/districts
 * @desc    Obtener lista de distritos únicos
 * @access  Private
 */
router.get('/districts',
  generalLimit,
  authenticate,
  cacheMiddleware('containers'), // Cache por 24 horas (datos estáticos)
  containerController.getDistricts
);

/**
 * @route   GET /api/containers/neighborhoods/:distrito
 * @desc    Obtener lista de barrios por distrito
 * @access  Private
 */
router.get('/neighborhoods/:distrito',
  generalLimit,
  authenticate,
  [
    param('distrito')
      .trim()
      .notEmpty()
      .withMessage('Distrito no puede estar vacío'),
    validateRequest
  ],
  cacheMiddleware('containers'), // Cache por 24 horas (datos estáticos)
  containerController.getNeighborhoodsByDistrict
);

/**
 * @route   GET /api/containers/search
 * @desc    Buscar contenedores por dirección
 * @access  Private
 */
router.get('/search',
  generalLimit,
  authenticate,
  [
    query('q')
      .notEmpty()
      .withMessage('Parámetro de búsqueda q es obligatorio')
      .trim()
      .isLength({ min: 3 })
      .withMessage('La búsqueda debe tener al menos 3 caracteres'),

    query('limit')
      .optional()
      .isInt({ min: PAGINATION.MIN_LIMIT, max: ROUTE_SPECIFIC_LIMITS.CONTAINERS.SEARCH_MAX_LIMIT })
      .withMessage(`Límite debe ser entre ${PAGINATION.MIN_LIMIT} y ${ROUTE_SPECIFIC_LIMITS.CONTAINERS.SEARCH_MAX_LIMIT}`),

    validateRequest
  ],
  validateContainerType,
  cacheMiddleware('containers'), // Cache por 24 horas (datos estáticos)
  containerController.searchByAddress
);

/**
 * @route   GET /api/containers/heatmap
 * @desc    Obtener datos para mapa de calor
 * @access  Private
 */
router.get('/heatmap',
  generalLimit,
  authenticate,
  validateContainerType,
  cacheMiddleware('containers'), // Cache por 24 horas (datos estáticos)
  containerController.getHeatmapData
);

/**
 * @route   GET /api/containers/coverage
 * @desc    Obtener análisis de cobertura
 * @access  Private
 */
router.get('/coverage',
  generalLimit,
  authenticate,
  [
    query('distrito')
      .optional()
      .trim()
      .notEmpty()
      .withMessage('Distrito no puede estar vacío'),
    validateRequest
  ],
  cacheMiddleware('containers'), // Cache por 24 horas (datos estáticos)
  containerController.getCoverageAnalysis
);

/**
 * @route   GET /api/containers/analysis/density
 * @desc    Obtener análisis de densidad de contenedores por distrito
 * @access  Private
 */
router.get('/analysis/density',
  generalLimit,
  authenticate,
  [
    query('distrito')
      .optional()
      .trim()
      .notEmpty()
      .withMessage('Distrito no puede estar vacío'),
    query('tipoContenedor')
      .optional()
      .isIn(CONTAINER_TYPES)
      .withMessage(`Tipo de contenedor inválido. Valores permitidos: ${CONTAINER_TYPES.join(', ')}`),
    query('includeBarrios')
      .optional()
      .isBoolean()
      .withMessage('includeBarrios debe ser true o false'),
    validateRequest
  ],
  cacheMiddleware('containers'), // Cache por 24 horas
  containerController.getDensityAnalysis
);

/**
 * Middleware de logging para todas las rutas de contenedores
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
    }, 'Consulta de contenedores completada');
  });

  next();
});

/**
 * Manejo de errores específico para rutas de contenedores
 */
router.use((error, req, res, _next) => {
  logger.error({
    error: error.message,
    stack: error.stack,
    path: req.path,
    method: req.method,
    userId: req.user?.id
  }, 'Error en rutas de contenedores');

  if (error.status || error.statusCode) {
    return res.status(error.status || error.statusCode).json({
      success: false,
      message: error.message
    });
  }

  res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
    success: false,
    message: 'Error interno en el procesamiento de datos de contenedores',
    requestId: req.id || Date.now()
  });
});

module.exports = router;
