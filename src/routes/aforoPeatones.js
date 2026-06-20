/**
 * Rutas de Aforo de Peatones
 *
 * Estructura paralela a `aforoBicicletas.js`. Las validaciones
 * express-validator viven en `validators/validadorAforoPeatones.js`.
 */

const express = require('express');
const rateLimit = require('express-rate-limit');
const { RATE_LIMITS, HTTP_STATUS } = require('../constants');

const pedestrianTrafficController = require('../controllers/controladorAforoPeatones');
const { authenticate } = require('../middleware/auth');
const { sensorOrAdmin } = require('../middleware/authorization');
const { validateRequest, ingestLimiter } = require('../middleware/security');
const { etagMiddleware } = require('../middleware/etag');
const logger = require('../config/logger');
const { validatePagination, validateDateRange } = require('../middleware/validation');
const { cacheMiddleware } = require('../middleware/cache');
const { generatePrefixedCacheKey } = require('../utils/cacheKeyGenerator');

const {
  validarObtenerConteos,
  validarDistribucionHoraria,
  validarComparativaEstaciones,
  validarTendenciasDiarias,
  validarDatosEstacion,
  validarIngestaConteo,
  validarIngestaLote
} = require('../validators/validadorAforoPeatones');

const router = express.Router();

const generalLimit = rateLimit({
  windowMs: RATE_LIMITS.GENERAL.WINDOW_MS,
  max: RATE_LIMITS.GENERAL.MAX_REQUESTS,
  message: {
    error: 'Demasiadas consultas de aforo de peatones. Intente nuevamente en 15 minutos.',
    retryAfter: RATE_LIMITS.GENERAL.RETRY_AFTER
  },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.user && req.user.role === 'admin'
});

// Instancia de cache dedicada para aforo peatonal (`pedestrianTraffic`, ver
// middleware/cache.js). Antes reutilizaba la instancia `traffic` del trafico
// vehicular; se separo al cablear la invalidacion por escritura (ingesta IoT)
// para que un POST de aforo peatonal no vacie tambien el cache de trafico.
const CACHE_BUCKET = 'pedestrianTraffic';

router.get('/',
  authenticate,
  generalLimit,
  ...validateDateRange(),
  validatePagination,
  validarObtenerConteos,
  validateRequest,
  cacheMiddleware(CACHE_BUCKET, (req) => generatePrefixedCacheKey('pedestrian:list', req.query)),
  pedestrianTrafficController.obtenerConteos
);

router.get('/estadisticas',
  authenticate,
  generalLimit,
  ...validateDateRange(),
  etagMiddleware,
  cacheMiddleware(CACHE_BUCKET, (req) => generatePrefixedCacheKey('pedestrian:stats', req.query)),
  pedestrianTrafficController.obtenerEstadisticas
);

router.get('/distribucion-horaria',
  authenticate,
  generalLimit,
  validarDistribucionHoraria,
  validateRequest,
  ...validateDateRange(),
  etagMiddleware,
  cacheMiddleware(CACHE_BUCKET, (req) => generatePrefixedCacheKey('pedestrian:hourly', req.query)),
  pedestrianTrafficController.obtenerDistribucionHoraria
);

router.get('/estaciones',
  authenticate,
  generalLimit,
  validarComparativaEstaciones,
  validateRequest,
  ...validateDateRange(),
  etagMiddleware,
  cacheMiddleware(CACHE_BUCKET, (req) => generatePrefixedCacheKey('pedestrian:stations', req.query)),
  pedestrianTrafficController.obtenerComparativaEstaciones
);

router.get('/tendencias/diario',
  authenticate,
  generalLimit,
  validarTendenciasDiarias,
  validateRequest,
  ...validateDateRange(),
  cacheMiddleware(CACHE_BUCKET, (req) => generatePrefixedCacheKey('pedestrian:trends-daily', req.query)),
  pedestrianTrafficController.obtenerTendenciasDiarias
);

router.get('/estacion/:identificador',
  authenticate,
  generalLimit,
  validarDatosEstacion,
  validateRequest,
  ...validateDateRange(),
  cacheMiddleware(CACHE_BUCKET, (req) => generatePrefixedCacheKey(`pedestrian:station:${req.params.identificador}`, req.query)),
  pedestrianTrafficController.obtenerDatosEstacion
);

router.get('/mapa',
  authenticate,
  generalLimit,
  // `validateDateRange` es factory: hay que llamarla con parentesis para expandir el array
  ...validateDateRange(),
  cacheMiddleware(CACHE_BUCKET, (req) => generatePrefixedCacheKey('pedestrian:mapa', req.query)),
  pedestrianTrafficController.obtenerMapaAforo
);

// ========================================
// INGESTA (escritura) - nodos IoT
// ========================================

/**
 * Registrar una lectura horaria de aforo de peatones.
 * @route POST /api/v1/aforo-peatones/ingesta
 * @access Private (JWT)
 */
router.post('/ingesta',
  authenticate,
  sensorOrAdmin,
  ingestLimiter,
  validarIngestaConteo,
  validateRequest,
  pedestrianTrafficController.ingestarConteo
);

/**
 * Registrar un lote de lecturas horarias de aforo de peatones.
 * @route POST /api/v1/aforo-peatones/ingesta/lote
 * @access Private (JWT)
 */
router.post('/ingesta/lote',
  authenticate,
  sensorOrAdmin,
  ingestLimiter,
  validarIngestaLote,
  validateRequest,
  pedestrianTrafficController.ingestarLote
);

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
    }, 'Consulta de aforo de peatones completada');
  });
  next();
});

router.use((error, req, res, _next) => {
  logger.error({
    error: error.message,
    stack: error.stack,
    path: req.path,
    method: req.method,
    userId: req.user?.id
  }, 'Error en rutas de aforo de peatones');

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
    message: 'Error interno en el procesamiento de datos de aforo de peatones',
    requestId: req.id || Date.now()
  });
});

module.exports = router;
