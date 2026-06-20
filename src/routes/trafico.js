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
const { sensorOrAdmin } = require('../middleware/authorization');
const { validateRequest, heavyQueryLimiter, ingestLimiter } = require('../middleware/security');
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
  validarMapaTrafico,
  validarIngestaTrafico,
  validarIngestaLoteTrafico
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
  authenticate,
  generalLimit,
  // Trafico es la coleccion mas masiva (~132M mediciones crudas / ~1,45M en el
  // rollup traffic_daily). El cap de rango es TRAFFIC_MAX_DAYS=365 (un anio
  // completo del dataset 2051): las agregaciones se sirven desde traffic_daily,
  // por eso un anio entero es asumible; el listado crudo va acotado por indice.
  validateDateRange(DATE_RANGE_LIMITS.TRAFFIC_MAX_DAYS),
  validatePagination,
  validateTrafficFilters,
  controladorTrafico.obtenerDatosTrafico
);

/**
 * GET /api/v1/trafico/punto/:id
 */
router.get('/punto/:id',
  authenticate,
  generalLimit,
  validarTraficoPorPunto,
  validateRequest,
  validateDateRange(DATE_RANGE_LIMITS.TRAFFIC_MAX_DAYS),
  controladorTrafico.obtenerTraficoPorPunto
);

/**
 * GET /api/v1/trafico/estadisticas
 */
router.get('/estadisticas',
  authenticate,
  generalLimit,
  heavyQueryLimiter,
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
  authenticate,
  generalLimit,
  validarAnalisisCongestion,
  validateRequest,
  validateDateRange(DATE_RANGE_LIMITS.TRAFFIC_MAX_DAYS),
  cacheMiddleware('traffic', (req) =>
    `traffic-congestion-${req.query.startDate || 'all'}-${req.query.endDate || 'all'}-${req.query.groupBy || 'distrito'}-${req.query.tipoElemento || 'all'}`
  ),
  controladorTrafico.obtenerAnalisisCongestion
);

/**
 * GET /api/v1/trafico/historico
 */
router.get('/historico',
  authenticate,
  generalLimit,
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
  authenticate,
  generalLimit,
  validarMapaTrafico,
  validateRequest,
  cacheMiddleware('traffic', (req) =>
    `traffic-mapa-${req.query.startDate}-${req.query.endDate}-${req.query.tipoElemento || 'all'}-${req.query.bbox || 'all'}`
  ),
  controladorTrafico.obtenerMapaTrafico
);

// ========================================
// INGESTA (escritura) - nodos IoT
// ========================================

/**
 * Registrar una medicion de trafico (cada ~15 min por punto).
 * @route POST /api/v1/trafico/ingesta
 * @access Private (JWT)
 */
router.post('/ingesta',
  authenticate,
  sensorOrAdmin,
  ingestLimiter,
  validarIngestaTrafico,
  validateRequest,
  controladorTrafico.ingestarMedicionTrafico
);

/**
 * Registrar un lote de mediciones de trafico.
 * @route POST /api/v1/trafico/ingesta/lote
 * @access Private (JWT)
 */
router.post('/ingesta/lote',
  authenticate,
  sensorOrAdmin,
  ingestLimiter,
  validarIngestaLoteTrafico,
  validateRequest,
  controladorTrafico.ingestarLoteTrafico
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

  // error.status es la cadena 'fail'/'error' (convencion AppError), NO un codigo
  // HTTP. Usar error.statusCode (numerico); si no es un entero valido, caer al 500.
  const codigoEstado = Number.isInteger(error.statusCode) ? error.statusCode : null;
  if (codigoEstado) {
    return res.status(codigoEstado).json({
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
