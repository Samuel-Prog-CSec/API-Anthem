/**
 * Rutas de Disponibilidad de Bicicletas
 *
 * Validaciones express-validator inline extraidas a
 * `validators/validadorBicicletas.js`.
 */

const express = require('express');
const rateLimit = require('express-rate-limit');
const { RATE_LIMITS, HTTP_STATUS, USER_ROLES } = require('../constants');

const bikeController = require('../controllers/controladorBicicletas');
const { authenticate } = require('../middleware/auth');
const { validateRequest } = require('../middleware/security');
const { etagMiddleware } = require('../middleware/etag');
const logger = require('../config/logger');
const {
  validatePagination,
  validateDateRange,
  validateBikeFilters
} = require('../middleware/validation');
const { cacheMiddleware } = require('../middleware/cache');
const {
  validarTendenciasMensuales,
  validarDiasMayorUso
} = require('../validators/validadorBicicletas');

const router = express.Router();

const generalLimit = rateLimit({
  windowMs: RATE_LIMITS.GENERAL.WINDOW_MS,
  max: RATE_LIMITS.GENERAL.MAX_REQUESTS,
  message: {
    error: 'Demasiadas consultas de bicicletas. Intente nuevamente en 15 minutos.',
    retryAfter: RATE_LIMITS.GENERAL.RETRY_AFTER
  },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.user && req.user.role === USER_ROLES.ADMIN
});

router.get('/',
  generalLimit,
  authenticate,
  validateDateRange,
  validatePagination,
  validateBikeFilters,
  cacheMiddleware('bikes'),
  bikeController.obtenerDisponibilidad
);

router.get('/estadisticas',
  generalLimit,
  authenticate,
  validateDateRange,
  etagMiddleware,
  cacheMiddleware('bikes'),
  bikeController.obtenerEstadisticas
);

router.get('/tendencias/mensual',
  generalLimit,
  authenticate,
  validarTendenciasMensuales,
  validateRequest,
  etagMiddleware,
  cacheMiddleware('bikes'),
  bikeController.obtenerTendenciasMensuales
);

router.get('/mayor-uso',
  generalLimit,
  authenticate,
  validarDiasMayorUso,
  validateRequest,
  cacheMiddleware('bikes'),
  bikeController.obtenerDiasMayorUso
);

router.get('/comparativa-suscripciones',
  generalLimit,
  authenticate,
  validateDateRange,
  etagMiddleware,
  cacheMiddleware('bikes'),
  bikeController.obtenerComparativaSuscripciones
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
    }, 'Consulta de bicicletas completada');
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
  }, 'Error en rutas de bicicletas');

  if (error.status || error.statusCode) {
    return res.status(error.status || error.statusCode).json({
      success: false,
      message: error.message
    });
  }

  res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
    success: false,
    message: 'Error interno en el procesamiento de datos de bicicletas',
    requestId: req.id || Date.now()
  });
});

module.exports = router;
