/**
 * Rutas de Accidentalidad
 *
 * Define todas las rutas relacionadas con la gestión y consulta de datos de accidentes.
 * Incluye middlewares de autenticación, validación y limitación de velocidad.
 */

const express = require('express');
const rateLimit = require('express-rate-limit');
const { query } = require('express-validator');

const {
  USER_ROLES,
  RATE_LIMITS,
  DATE_RANGE_LIMITS,
  MAP_LIMITS,
  SEVERITY_LEVELS
} = require('../constants');

const accidentController = require('../controllers/controladorAccidentes');
const { authenticate } = require('../middleware/auth');
const { cacheMiddleware } = require('../middleware/cache');
const { validateRequest } = require('../middleware/security');
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
 * @route   GET /api/v1/accidentes/mapa-calor
 * @desc    Obtener datos agrupados para mapa de calor de accidentes
 * @access  Privado
 *
 * Cap de `limite` y `precision` mas conservador que /mapa porque cada punto del
 * heatmap es una agregacion (no un documento crudo) y costaria mas iterar
 * miles de puntos en el cliente Leaflet.
 */
router.get('/mapa-calor',
  generalLimit,
  authenticate,
  [
    query('limite').optional().isInt({ min: MAP_LIMITS.MIN, max: MAP_LIMITS.HEATMAP_MAX })
      .withMessage(`limite debe estar entre ${MAP_LIMITS.MIN} y ${MAP_LIMITS.HEATMAP_MAX}`),
    query('precision').optional().isInt({ min: 50, max: 500 })
      .withMessage('precision debe estar entre 50 y 500 metros'),
    query('distrito').optional().trim().isLength({ min: 2, max: 100 }).escape(),
    query('gravedad').optional().isIn(Object.values(SEVERITY_LEVELS.ACCIDENT))
      .withMessage('gravedad invalida'),
    query('tipoAccidente').optional().trim().escape()
  ],
  validateRequest,
  validateDateRange(DATE_RANGE_LIMITS.ACCIDENTS_MAX_DAYS),
  cacheMiddleware('accidents'),
  accidentController.obtenerMapaCalorAccidentes
);

/**
 * @route   GET /api/v1/accidentes/mapa
 * @desc    Devuelve FeatureCollection GeoJSON para visualizacion en mapas
 * @access  Privado
 */
router.get('/mapa',
  generalLimit,
  authenticate,
  [
    query('limite').optional().isInt({ min: MAP_LIMITS.MIN, max: MAP_LIMITS.DEFAULT_MAX })
      .withMessage(`limite debe estar entre ${MAP_LIMITS.MIN} y ${MAP_LIMITS.DEFAULT_MAX}`),
    query('distrito').optional().trim().isLength({ min: 2, max: 100 }).escape(),
    query('gravedad').optional().isIn(Object.values(SEVERITY_LEVELS.ACCIDENT))
      .withMessage('gravedad invalida'),
    query('tipoAccidente').optional().trim().escape(),
    query('bbox').optional().matches(/^-?\d+\.?\d*,-?\d+\.?\d*,-?\d+\.?\d*,-?\d+\.?\d*$/)
      .withMessage('bbox debe ser minLng,minLat,maxLng,maxLat')
  ],
  validateRequest,
  validateDateRange(DATE_RANGE_LIMITS.ACCIDENTS_MAX_DAYS),
  cacheMiddleware('accidents'),
  accidentController.obtenerMapaAccidentes
);

module.exports = router;
