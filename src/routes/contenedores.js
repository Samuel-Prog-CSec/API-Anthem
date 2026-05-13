/**
 * Rutas de Contenedores
 *
 * Validaciones express-validator extraidas a `validators/validadorContenedores.js`.
 */

const express = require('express');
const rateLimit = require('express-rate-limit');
const { RATE_LIMITS, HTTP_STATUS } = require('../constants');

const controladorContenedores = require('../controllers/controladorContenedores');
const { authenticate } = require('../middleware/auth');
const { validateRequest } = require('../middleware/security');
const { cacheMiddleware } = require('../middleware/cache');
const { etagMiddleware } = require('../middleware/etag');
const logger = require('../config/logger');
const {
  validatePagination,
  validateContainerType,
  validateContainerFilters,
  validateCoordinates
} = require('../middleware/validation');
const {
  validarEstadisticasPorDistrito,
  validarEstadisticasPorBarrio,
  validarConteoPorTipo,
  validarBarriosPorDistrito,
  validarBusquedaContenedores,
  validarCoberturaContenedores,
  validarMapaContenedores,
  validarAnalisisDensidad
} = require('../validators/validadorContenedores');

const router = express.Router();

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

router.get('/',
  generalLimit,
  authenticate,
  validatePagination,
  validateContainerType,
  validateContainerFilters,
  etagMiddleware,
  cacheMiddleware('containers'),
  controladorContenedores.obtenerContenedores
);

router.get('/cercanos',
  generalLimit,
  authenticate,
  validateCoordinates,
  validateContainerType,
  cacheMiddleware('containers'),
  controladorContenedores.obtenerContenedoresCercanos
);

router.get('/estadisticas',
  generalLimit,
  authenticate,
  etagMiddleware,
  cacheMiddleware('containers'),
  controladorContenedores.obtenerEstadisticasContenedores
);

router.get('/estadisticas/distrito',
  generalLimit,
  authenticate,
  validarEstadisticasPorDistrito,
  validateRequest,
  etagMiddleware,
  cacheMiddleware('containers'),
  controladorContenedores.obtenerEstadisticasPorDistrito
);

router.get('/estadisticas/barrio',
  generalLimit,
  authenticate,
  validarEstadisticasPorBarrio,
  validateRequest,
  etagMiddleware,
  cacheMiddleware('containers'),
  controladorContenedores.obtenerEstadisticasPorBarrio
);

router.get('/conteo-por-tipo',
  generalLimit,
  authenticate,
  validarConteoPorTipo,
  validateRequest,
  cacheMiddleware('containers'),
  controladorContenedores.contarPorTipo
);

router.get('/distritos',
  generalLimit,
  authenticate,
  cacheMiddleware('containers'),
  controladorContenedores.obtenerDistritos
);

router.get('/barrios/:distrito',
  generalLimit,
  authenticate,
  validarBarriosPorDistrito,
  validateRequest,
  cacheMiddleware('containers'),
  controladorContenedores.obtenerBarriosPorDistrito
);

router.get('/buscar',
  generalLimit,
  authenticate,
  validarBusquedaContenedores,
  validateRequest,
  validateContainerType,
  cacheMiddleware('containers'),
  controladorContenedores.buscarPorDireccion
);

router.get('/mapa-calor',
  generalLimit,
  authenticate,
  validateContainerType,
  cacheMiddleware('containers'),
  controladorContenedores.obtenerMapaCalor
);

router.get('/cobertura',
  generalLimit,
  authenticate,
  validarCoberturaContenedores,
  validateRequest,
  cacheMiddleware('containers'),
  controladorContenedores.obtenerAnalisisCobertura
);

router.get('/mapa',
  generalLimit,
  authenticate,
  validarMapaContenedores,
  validateRequest,
  validateContainerType,
  etagMiddleware,
  cacheMiddleware('containers'),
  controladorContenedores.obtenerMapaContenedores
);

router.get('/analisis/densidad',
  generalLimit,
  authenticate,
  validarAnalisisDensidad,
  validateRequest,
  cacheMiddleware('containers'),
  controladorContenedores.obtenerAnalisisDensidad
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
    }, 'Consulta de contenedores completada');
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
