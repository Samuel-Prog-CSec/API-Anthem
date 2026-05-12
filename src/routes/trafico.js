/**
 * Rutas de Tráfico
 *
 * Define todas las rutas relacionadas con la gestión y consulta de datos de tráfico.
 * Incluye middlewares de autenticación, validación y limitación de velocidad.
 */

const express = require('express');
const rateLimit = require('express-rate-limit');
const { query, param } = require('express-validator');

const controladorTrafico = require('../controllers/controladorTrafico');
const { authenticate } = require('../middleware/auth');
const { validateRequest, heavyQueryLimiter } = require('../middleware/security');
const { performanceMonitor } = require('../middleware/performanceMonitor');
const { etagMiddleware } = require('../middleware/etag');
const {
  TRAFFIC_ELEMENT_TYPES,
  RATE_LIMITS,
  DATE_RANGE_LIMITS,
  ROUTE_SPECIFIC_LIMITS,
  HTTP_STATUS
} = require('../constants');
const {
  validatePagination,
  validateDateRange,
  validateTrafficFilters
} = require('../middleware/validation');
const { cacheMiddleware } = require('../middleware/cache');
const logger = require('../config/logger');


const router = express.Router();

// Aplicar performanceMonitor a todas las rutas de tráfico
router.use(performanceMonitor);

/**
 * Limitadores de velocidad específicos para diferentes tipos de consultas
 */

// Para consultas generales (más restrictivo)
const generalLimit = rateLimit({
  windowMs: RATE_LIMITS.GENERAL.WINDOW_MS,
  max: RATE_LIMITS.GENERAL.MAX_REQUESTS,
  message: {
    error: 'Demasiadas consultas de tráfico. Intente nuevamente en 15 minutos.',
    retryAfter: RATE_LIMITS.GENERAL.RETRY_AFTER
  },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    // Saltear limitación para administradores
    return req.user && req.user.role === 'admin';
  }
});

/**
 * RUTAS PRINCIPALES
 */

/**
 * @route   GET /api/v1/trafico
 * @desc    Obtener todas las mediciones de tráfico con filtros
 * @access  Private
 * @rateLimit 100 requests per 15 minutes
 */
router.get('/',
  generalLimit,
  authenticate,
  // Trafico es la coleccion mas masiva (~24M docs); usamos TRAFFIC_MAX_DAYS=90
  // en lugar del DEFAULT_MAX=365 para forzar al cliente a paginar por trimestres
  // o aplicar filtros de puntoMedidaId que reduzcan el scope antes del scan.
  validateDateRange(DATE_RANGE_LIMITS.TRAFFIC_MAX_DAYS),
  validatePagination,
  validateTrafficFilters,
  controladorTrafico.obtenerDatosTrafico
);

/**
 * @route   GET /api/v1/trafico/punto/:id
 * @desc    Obtener datos de tráfico de un punto específico
 * @access  Private
 * @rateLimit 100 requests per 15 minutes
 */
router.get('/punto/:id',
  generalLimit,
  authenticate,
  [
    param('id')
      .matches(/^\d+$/)
      .withMessage('ID de punto debe ser numérico'),

    query('limit')
      .optional()
      .isInt({ min: 1, max: ROUTE_SPECIFIC_LIMITS.TRAFFIC.PUNTO_MAX_LIMIT })
      .withMessage(`Límite debe ser entre 1 y ${ROUTE_SPECIFIC_LIMITS.TRAFFIC.PUNTO_MAX_LIMIT} para consultas de punto`),

    validateRequest
  ],
  validateDateRange(DATE_RANGE_LIMITS.TRAFFIC_MAX_DAYS),
  controladorTrafico.obtenerTraficoPorPunto
);

/**
 * @route   GET /api/v1/trafico/estadisticas
 * @desc    Obtener estadísticas generales de tráfico
 * @access  Private
 * @rateLimit 5 requests per minute (heavy query)
 */
router.get('/estadisticas',
  generalLimit,
  heavyQueryLimiter, // Heavy query limiter for statistics
  authenticate,
  [
    query('tipoElemento')
      .optional()
      .isIn(Object.values(TRAFFIC_ELEMENT_TYPES))
      .withMessage(`Tipo de elemento debe ser ${Object.values(TRAFFIC_ELEMENT_TYPES).join(' o ')}`),

    validateRequest
  ],
  validateDateRange(DATE_RANGE_LIMITS.TRAFFIC_MAX_DAYS),
  // ETags para estadísticas agregadas (datos relativamente estables)
  etagMiddleware,
  // Caché de 5 minutos para estadísticas de tráfico (datos volátiles)
  cacheMiddleware('traffic', (req) =>
    `traffic-stats-${req.query.startDate || 'all'}-${req.query.endDate || 'all'}-${req.query.tipoElemento || 'all'}`
  ),
  controladorTrafico.obtenerEstadisticasTrafico
);

/**
 * @route   GET /api/v1/trafico/analisis-congestion
 * @desc    Obtener análisis de congestión por zonas
 * @access  Private
 * @rateLimit 100 requests per 15 minutes
 */
router.get('/analisis-congestion',
  generalLimit,
  authenticate,
  [
    query('groupBy')
      .optional()
      .isIn(['distrito', 'tipoElemento'])
      .withMessage('Agrupación debe ser por distrito o tipoElemento'),

    validateRequest
  ],
  validateDateRange(DATE_RANGE_LIMITS.TRAFFIC_MAX_DAYS),
  // Caché de 5 minutos para análisis de congestión
  cacheMiddleware('traffic', (req) =>
    `traffic-congestion-${req.query.startDate || 'all'}-${req.query.endDate || 'all'}-${req.query.groupBy || 'distrito'}`
  ),
  controladorTrafico.obtenerAnalisisCongestion
);

/**
 * @route   GET /api/v1/trafico/historico
 * @desc    Obtener datos históricos para gráficos
 * @access  Private
 * @rateLimit 100 requests per 15 minutes
 */
router.get('/historico',
  generalLimit,
  authenticate,
  [
    query('aggregation')
      .optional()
      .isIn(['hour', 'day', 'week', 'month'])
      .withMessage('Agregación debe ser hour, day, week o month'),

    query('puntoMedidaId')
      .optional()
      .matches(/^\d+$/)
      .withMessage('ID de punto de medida debe ser numérico'),

    validateRequest
  ],
  validateDateRange(DATE_RANGE_LIMITS.TRAFFIC_MAX_DAYS),
  validateTrafficFilters,
  // Caché de 5 minutos para datos históricos
  cacheMiddleware('traffic', (req) =>
    `traffic-historical-${req.query.startDate || 'all'}-${req.query.endDate || 'all'}-${req.query.aggregation || 'hour'}-${req.query.puntoMedidaId || 'all'}-${req.query.tipoElemento || 'all'}`
  ),
  controladorTrafico.obtenerDatosHistoricos
);

/**
 * @route   GET /api/v1/trafico/mapa
 * @desc    Mapa de trafico como FeatureCollection GeoJSON (RFC 7946)
 * @access  Private
 *
 * Filtros obligatorios: startDate, endDate (rango max 7 dias).
 * Filtros opcionales: tipoElemento (URB|M30), bbox (minLng,minLat,maxLng,maxLat).
 */
router.get('/mapa',
  generalLimit,
  authenticate,
  [
    query('startDate')
      .notEmpty()
      .withMessage('startDate es obligatorio (formato YYYY-MM-DD)')
      .isISO8601()
      .withMessage('startDate debe ser una fecha ISO 8601 valida'),
    query('endDate')
      .notEmpty()
      .withMessage('endDate es obligatorio (formato YYYY-MM-DD)')
      .isISO8601()
      .withMessage('endDate debe ser una fecha ISO 8601 valida'),
    query('tipoElemento')
      .optional()
      .isIn(Object.values(TRAFFIC_ELEMENT_TYPES))
      .withMessage(`tipoElemento debe ser uno de: ${Object.values(TRAFFIC_ELEMENT_TYPES).join(', ')}`),
    query('bbox')
      .optional()
      .matches(/^-?\d+(\.\d+)?,-?\d+(\.\d+)?,-?\d+(\.\d+)?,-?\d+(\.\d+)?$/)
      .withMessage('bbox debe tener formato minLng,minLat,maxLng,maxLat'),
    validateRequest
  ],
  // Cache de 5 minutos: el rango (start/end) es parte de la clave
  cacheMiddleware('traffic', (req) =>
    `traffic-mapa-${req.query.startDate}-${req.query.endDate}-${req.query.tipoElemento || 'all'}-${req.query.bbox || 'all'}`
  ),
  controladorTrafico.obtenerMapaTrafico
);

/**
 * Middleware de logging para todas las rutas de tráfico
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
    }, 'Consulta de tráfico completada');
  });

  next();
});

/**
 * Manejo de errores específico para rutas de tráfico
 */
router.use((error, req, res, _next) => {
  logger.error({
    error: error.message,
    stack: error.stack,
    path: req.path,
    method: req.method,
    userId: req.user?.id
  }, 'Error en rutas de tráfico');

  // Si el error ya fue manejado, pasarlo al siguiente middleware
  if (error.status || error.statusCode) {
    return res.status(error.status || error.statusCode).json({
      success: false,
      message: error.message
    });
  }

  // Error específico de tráfico
  res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
    success: false,
    message: 'Error interno en el procesamiento de datos de tráfico',
    requestId: req.id || Date.now()
  });
});

module.exports = router;
