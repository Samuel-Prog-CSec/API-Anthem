/**
 * Rutas de Trafico
 *
 * Validaciones express-validator inline extraidas a
 * `validators/validadorTrafico.js`. Validaciones compartidas siguen en
 * `middleware/validation.js`.
 */

const express = require('express');
const rateLimit = require('express-rate-limit');

const controladorTrafico = require('../controllers/controladorTrafico');
const { authenticate } = require('../middleware/auth');
const { validateRequest, heavyQueryLimiter } = require('../middleware/security');
const { etagMiddleware } = require('../middleware/etag');
const { RATE_LIMITS, DATE_RANGE_LIMITS, HTTP_STATUS } = require('../constants');
const {
  validatePagination,
  validateDateRange,
  validateTrafficFilters
} = require('../middleware/validation');
const { cacheMiddleware } = require('../middleware/cache');
const logger = require('../config/logger');
const {
  validarTraficoPorPunto,
  validarEstadisticasTrafico,
  validarAnalisisCongestion,
  validarHistoricoTrafico,
  validarMapaTrafico
} = require('../validators/validadorTrafico');

const router = express.Router();

// Limitador general (mas restrictivo) para consultas de trafico
const generalLimit = rateLimit({
  windowMs: RATE_LIMITS.GENERAL.WINDOW_MS,
  max: RATE_LIMITS.GENERAL.MAX_REQUESTS,
  message: {
    error: 'Demasiadas consultas de tráfico. Intente nuevamente en 15 minutos.',
    retryAfter: RATE_LIMITS.GENERAL.RETRY_AFTER
  },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.user && req.user.role === 'admin'
});

/**
 * GET /api/v1/trafico
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
 * GET /api/v1/trafico/punto/:id
 */
router.get('/punto/:id',
  generalLimit,
  authenticate,
  validarTraficoPorPunto,
  validateRequest,
  validateDateRange(DATE_RANGE_LIMITS.TRAFFIC_MAX_DAYS),
  controladorTrafico.obtenerTraficoPorPunto
);

/**
 * GET /api/v1/trafico/estadisticas
 */
router.get('/estadisticas',
  generalLimit,
  heavyQueryLimiter,
  authenticate,
  validarEstadisticasTrafico,
  validateRequest,
  validateDateRange(DATE_RANGE_LIMITS.TRAFFIC_MAX_DAYS),
  etagMiddleware,
  cacheMiddleware('traffic', (req) =>
    `traffic-stats-${req.query.startDate || 'all'}-${req.query.endDate || 'all'}-${req.query.tipoElemento || 'all'}`
  ),
  controladorTrafico.obtenerEstadisticasTrafico
);

/**
 * GET /api/v1/trafico/analisis-congestion
 */
router.get('/analisis-congestion',
  generalLimit,
  authenticate,
  validarAnalisisCongestion,
  validateRequest,
  validateDateRange(DATE_RANGE_LIMITS.TRAFFIC_MAX_DAYS),
  cacheMiddleware('traffic', (req) =>
    `traffic-congestion-${req.query.startDate || 'all'}-${req.query.endDate || 'all'}-${req.query.groupBy || 'distrito'}`
  ),
  controladorTrafico.obtenerAnalisisCongestion
);

/**
 * GET /api/v1/trafico/historico
 */
router.get('/historico',
  generalLimit,
  authenticate,
  validarHistoricoTrafico,
  validateRequest,
  validateDateRange(DATE_RANGE_LIMITS.TRAFFIC_MAX_DAYS),
  validateTrafficFilters,
  cacheMiddleware('traffic', (req) =>
    `traffic-historical-${req.query.startDate || 'all'}-${req.query.endDate || 'all'}-${req.query.aggregation || 'hour'}-${req.query.puntoMedidaId || 'all'}-${req.query.tipoElemento || 'all'}`
  ),
  controladorTrafico.obtenerDatosHistoricos
);

/**
 * GET /api/v1/trafico/mapa
 */
router.get('/mapa',
  generalLimit,
  authenticate,
  validarMapaTrafico,
  validateRequest,
  cacheMiddleware('traffic', (req) =>
    `traffic-mapa-${req.query.startDate}-${req.query.endDate}-${req.query.tipoElemento || 'all'}-${req.query.bbox || 'all'}`
  ),
  controladorTrafico.obtenerMapaTrafico
);

// Middleware de logging
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

// Manejo de errores especifico
router.use((error, req, res, _next) => {
  logger.error({
    error: error.message,
    stack: error.stack,
    path: req.path,
    method: req.method,
    userId: req.user?.id
  }, 'Error en rutas de tráfico');

  if (error.status || error.statusCode) {
    return res.status(error.status || error.statusCode).json({
      success: false,
      message: error.message
    });
  }

  res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
    success: false,
    message: 'Error interno en el procesamiento de datos de tráfico',
    requestId: req.id || Date.now()
  });
});

module.exports = router;
