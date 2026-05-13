/**
 * Rutas de Aforo de Bicicletas
 *
 * Validaciones express-validator inline extraidas a
 * `validators/validadorAforoBicicletas.js`.
 */

const express = require('express');
const rateLimit = require('express-rate-limit');
const { RATE_LIMITS, HTTP_STATUS } = require('../constants');

const bikeTrafficController = require('../controllers/controladorAforoBicicletas');
const { authenticate } = require('../middleware/auth');
const { validateRequest } = require('../middleware/security');
const { etagMiddleware } = require('../middleware/etag');
const logger = require('../config/logger');
const { validatePagination, validateDateRange } = require('../middleware/validation');
const { cacheMiddleware } = require('../middleware/cache');

const {
  validarObtenerConteos,
  validarDistribucionHoraria,
  validarComparativaEstaciones,
  validarTendenciasDiarias,
  validarDatosEstacion
} = require('../validators/validadorAforoBicicletas');

const router = express.Router();

const generalLimit = rateLimit({
  windowMs: RATE_LIMITS.GENERAL.WINDOW_MS,
  max: RATE_LIMITS.GENERAL.MAX_REQUESTS,
  message: {
    error: 'Demasiadas consultas de aforo de bicicletas. Intente nuevamente en 15 minutos.',
    retryAfter: RATE_LIMITS.GENERAL.RETRY_AFTER
  },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.user && req.user.role === 'admin'
});

router.get('/',
  generalLimit,
  authenticate,
  validateDateRange,
  validatePagination,
  validarObtenerConteos,
  validateRequest,
  cacheMiddleware('bikeTraffic'),
  bikeTrafficController.obtenerConteos
);

router.get('/estadisticas',
  generalLimit,
  authenticate,
  validateDateRange,
  etagMiddleware,
  cacheMiddleware('bikeTraffic'),
  bikeTrafficController.obtenerEstadisticas
);

router.get('/distribucion-horaria',
  generalLimit,
  authenticate,
  validarDistribucionHoraria,
  validateRequest,
  validateDateRange,
  etagMiddleware,
  cacheMiddleware('bikeTraffic'),
  bikeTrafficController.obtenerDistribucionHoraria
);

router.get('/estaciones',
  generalLimit,
  authenticate,
  validarComparativaEstaciones,
  validateRequest,
  validateDateRange,
  etagMiddleware,
  cacheMiddleware('bikeTraffic'),
  bikeTrafficController.obtenerComparativaEstaciones
);

router.get('/tendencias/diario',
  generalLimit,
  authenticate,
  validarTendenciasDiarias,
  validateRequest,
  validateDateRange,
  cacheMiddleware('bikeTraffic'),
  bikeTrafficController.obtenerTendenciasDiarias
);

router.get('/estacion/:identificador',
  generalLimit,
  authenticate,
  validarDatosEstacion,
  validateRequest,
  validateDateRange,
  cacheMiddleware('bikeTraffic'),
  bikeTrafficController.obtenerDatosEstacion
);

router.get('/mapa',
  generalLimit,
  authenticate,
  // `validateDateRange` es factory: hay que llamarla con parentesis para expandir el array
  ...validateDateRange(),
  cacheMiddleware('bikeTraffic'),
  bikeTrafficController.obtenerMapaAforo
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
    }, 'Consulta de aforo de bicicletas completada');
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
  }, 'Error en rutas de aforo de bicicletas');

  if (error.status || error.statusCode) {
    return res.status(error.status || error.statusCode).json({
      success: false,
      message: error.message
    });
  }

  res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
    success: false,
    message: 'Error interno en el procesamiento de datos de aforo de bicicletas',
    requestId: req.id || Date.now()
  });
});

module.exports = router;
