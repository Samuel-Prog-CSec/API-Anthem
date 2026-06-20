/**
 * Rutas de Accidentalidad
 *
 * Las validaciones express-validator de mapa/heatmap se extraen a
 * `validators/validadorAccidentes.js`. Las validaciones compartidas
 * (paginacion, filtros, fechas, file number, distrito) siguen en
 * `middleware/validation.js`.
 */

const express = require('express');
const rateLimit = require('express-rate-limit');

const { USER_ROLES, RATE_LIMITS, DATE_RANGE_LIMITS } = require('../constants');

const accidentController = require('../controllers/controladorAccidentes');
const { authenticate } = require('../middleware/auth');
const { cacheMiddleware } = require('../middleware/cache');
const { generatePrefixedCacheKey } = require('../utils/cacheKeyGenerator');
const { validateRequest } = require('../middleware/security');
const { etagMiddleware } = require('../middleware/etag');
const logger = require('../config/logger');
const {
  validateDateRange,
  validateDistrictQuery,
  validatePagination,
  validateAccidentFilters,
  validateFileNumber
} = require('../middleware/validation');
const {
  validarMapaCalorAccidentes,
  validarMapaAccidentes
} = require('../validators/validadorAccidentes');

const router = express.Router();

// Nota: performanceMonitor se aplica una sola vez en routes/index.js

// Limitador general para todos los endpoints de accidentes
const generalLimit = rateLimit({
  windowMs: RATE_LIMITS.GENERAL.WINDOW_MS,
  max: RATE_LIMITS.GENERAL.MAX_REQUESTS,
  message: {
    error: 'Demasiadas consultas de accidentalidad. Intente nuevamente en 15 minutos.',
    retryAfter: RATE_LIMITS.GENERAL.RETRY_AFTER
  },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.user && req.user.role === USER_ROLES.ADMIN
});

/**
 * GET /api/v1/accidentes
 */
router.get('/',
  authenticate,
  generalLimit,
  validateDateRange(DATE_RANGE_LIMITS.ACCIDENTS_MAX_DAYS),
  validatePagination,
  validateAccidentFilters,
  cacheMiddleware('statistics', (req) => generatePrefixedCacheKey('accidents:list', req.query)),
  accidentController.obtenerAccidentes
);

/**
 * GET /api/v1/accidentes/expediente/:numero
 */
router.get('/expediente/:numero',
  authenticate,
  generalLimit,
  validateFileNumber,
  accidentController.obtenerAccidentePorExpediente
);

/**
 * GET /api/v1/accidentes/estadisticas
 */
router.get('/estadisticas',
  authenticate,
  generalLimit,
  // validateAccidentFilters (autocontenido, ya usado en la ruta `/`) incluye la
  // validacion de distrito MAS tipoAccidente/gravedad/tipoVehiculo, que el
  // controlador de estadisticas aplica pero antes no se validaban.
  validateAccidentFilters,
  validateDateRange(DATE_RANGE_LIMITS.ACCIDENTS_MAX_DAYS),
  etagMiddleware,
  cacheMiddleware('statistics', (req) => generatePrefixedCacheKey('accidents:stats', req.query)),
  accidentController.obtenerEstadisticasAccidentes
);

/**
 * GET /api/v1/accidentes/comparativa-distritos
 */
router.get('/comparativa-distritos',
  authenticate,
  generalLimit,
  // tipoAccidente/gravedad los aplica el controlador; antes entraban sin validar.
  validateAccidentFilters,
  validateDateRange(DATE_RANGE_LIMITS.ACCIDENTS_MAX_DAYS),
  cacheMiddleware('statistics', (req) => generatePrefixedCacheKey('accidents:district-comp', req.query)),
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
 * GET /api/v1/accidentes/mapa-calor
 */
router.get('/mapa-calor',
  authenticate,
  generalLimit,
  validarMapaCalorAccidentes,
  validateRequest,
  validateDateRange(DATE_RANGE_LIMITS.ACCIDENTS_MAX_DAYS),
  cacheMiddleware('accidents'),
  accidentController.obtenerMapaCalorAccidentes
);

/**
 * GET /api/v1/accidentes/mapa
 */
router.get('/mapa',
  authenticate,
  generalLimit,
  validarMapaAccidentes,
  validateRequest,
  validateDateRange(DATE_RANGE_LIMITS.ACCIDENTS_MAX_DAYS),
  cacheMiddleware('accidents'),
  accidentController.obtenerMapaAccidentes
);

module.exports = router;
