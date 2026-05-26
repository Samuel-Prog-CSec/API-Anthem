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
const { validateRequest } = require('../middleware/security');
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
  validarDatosEstacion
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

// Cache reutiliza la instancia configurada para trafico (aforo horario
// peatonal tiene perfil de cardinalidad y volatilidad similar al de
// bicicletas y trafico vehicular). Si se observase desplazamiento de
// caches o invalidaciones cruzadas se podria anadir una instancia
// dedicada en `middleware/cache.js`.
const CACHE_BUCKET = 'traffic';

router.get('/',
  generalLimit,
  authenticate,
  ...validateDateRange(),
  validatePagination,
  validarObtenerConteos,
  validateRequest,
  cacheMiddleware(CACHE_BUCKET, (req) => generatePrefixedCacheKey('pedestrian:list', req.query)),
  pedestrianTrafficController.obtenerConteos
);

router.get('/estadisticas',
  generalLimit,
  authenticate,
  ...validateDateRange(),
  etagMiddleware,
  cacheMiddleware(CACHE_BUCKET, (req) => generatePrefixedCacheKey('pedestrian:stats', req.query)),
  pedestrianTrafficController.obtenerEstadisticas
);

router.get('/distribucion-horaria',
  generalLimit,
  authenticate,
  validarDistribucionHoraria,
  validateRequest,
  ...validateDateRange(),
  etagMiddleware,
  cacheMiddleware(CACHE_BUCKET, (req) => generatePrefixedCacheKey('pedestrian:hourly', req.query)),
  pedestrianTrafficController.obtenerDistribucionHoraria
);

router.get('/estaciones',
  generalLimit,
  authenticate,
  validarComparativaEstaciones,
  validateRequest,
  ...validateDateRange(),
  etagMiddleware,
  cacheMiddleware(CACHE_BUCKET, (req) => generatePrefixedCacheKey('pedestrian:stations', req.query)),
  pedestrianTrafficController.obtenerComparativaEstaciones
);

router.get('/tendencias/diario',
  generalLimit,
  authenticate,
  validarTendenciasDiarias,
  validateRequest,
  ...validateDateRange(),
  cacheMiddleware(CACHE_BUCKET, (req) => generatePrefixedCacheKey('pedestrian:trends-daily', req.query)),
  pedestrianTrafficController.obtenerTendenciasDiarias
);

router.get('/estacion/:identificador',
  generalLimit,
  authenticate,
  validarDatosEstacion,
  validateRequest,
  ...validateDateRange(),
  cacheMiddleware(CACHE_BUCKET, (req) => generatePrefixedCacheKey(`pedestrian:station:${req.params.identificador}`, req.query)),
  pedestrianTrafficController.obtenerDatosEstacion
);

router.get('/mapa',
  generalLimit,
  authenticate,
  // `validateDateRange` es factory: hay que llamarla con parentesis para expandir el array
  ...validateDateRange(),
  cacheMiddleware(CACHE_BUCKET, (req) => generatePrefixedCacheKey('pedestrian:mapa', req.query)),
  pedestrianTrafficController.obtenerMapaAforo
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

  if (error.status || error.statusCode) {
    return res.status(error.status || error.statusCode).json({
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
