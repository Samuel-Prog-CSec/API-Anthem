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
  authenticate,
  generalLimit,
  validatePagination,
  validateContainerType,
  validateContainerFilters,
  etagMiddleware,
  cacheMiddleware('containers'),
  controladorContenedores.obtenerContenedores
);

router.get('/cercanos',
  authenticate,
  generalLimit,
  validateCoordinates,
  validateContainerType,
  cacheMiddleware('containers'),
  controladorContenedores.obtenerContenedoresCercanos
);

router.get('/estadisticas',
  authenticate,
  generalLimit,
  etagMiddleware,
  cacheMiddleware('containers'),
  controladorContenedores.obtenerEstadisticasContenedores
);

router.get('/estadisticas/distrito',
  authenticate,
  generalLimit,
  validarEstadisticasPorDistrito,
  validateRequest,
  etagMiddleware,
  cacheMiddleware('containers'),
  controladorContenedores.obtenerEstadisticasPorDistrito
);

router.get('/estadisticas/barrio',
  authenticate,
  generalLimit,
  validarEstadisticasPorBarrio,
  validateRequest,
  etagMiddleware,
  cacheMiddleware('containers'),
  controladorContenedores.obtenerEstadisticasPorBarrio
);

router.get('/conteo-por-tipo',
  authenticate,
  generalLimit,
  validarConteoPorTipo,
  validateRequest,
  cacheMiddleware('containers'),
  controladorContenedores.contarPorTipo
);

router.get('/distritos',
  authenticate,
  generalLimit,
  cacheMiddleware('containers'),
  controladorContenedores.obtenerDistritos
);

router.get('/barrios/:distrito',
  authenticate,
  generalLimit,
  validarBarriosPorDistrito,
  validateRequest,
  cacheMiddleware('containers'),
  controladorContenedores.obtenerBarriosPorDistrito
);

router.get('/buscar',
  authenticate,
  generalLimit,
  validarBusquedaContenedores,
  validateRequest,
  validateContainerType,
  cacheMiddleware('containers'),
  controladorContenedores.buscarPorDireccion
);

router.get('/mapa-calor',
  authenticate,
  generalLimit,
  validateContainerType,
  cacheMiddleware('containers'),
  controladorContenedores.obtenerMapaCalor
);

router.get('/cobertura',
  authenticate,
  generalLimit,
  validarCoberturaContenedores,
  validateRequest,
  cacheMiddleware('containers'),
  controladorContenedores.obtenerAnalisisCobertura
);

router.get('/mapa',
  authenticate,
  generalLimit,
  validarMapaContenedores,
  validateRequest,
  validateContainerType,
  etagMiddleware,
  cacheMiddleware('containers'),
  controladorContenedores.obtenerMapaContenedores
);

router.get('/analisis/densidad',
  authenticate,
  generalLimit,
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
    message: 'Error interno en el procesamiento de datos de contenedores',
    requestId: req.id || Date.now()
  });
});

module.exports = router;
