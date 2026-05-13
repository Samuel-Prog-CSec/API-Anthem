/**
 * Rutas de Contaminacion Acustica
 *
 * Validaciones express-validator inline extraidas a
 * `validators/validadorRuido.js`.
 */

const express = require('express');
const rateLimit = require('express-rate-limit');

const { RATE_LIMITS, DATE_RANGE_LIMITS } = require('../constants');

const { authenticate } = require('../middleware/auth');
const { validateRequest } = require('../middleware/security');
const { validateDateRange } = require('../middleware/validation');
const { etagMiddleware } = require('../middleware/etag');
const { cacheMiddleware } = require('../middleware/cache');

const {
  obtenerDatosRuido,
  obtenerEstadisticasRuido,
  obtenerRankingRuido,
  obtenerCumplimientoPorZona,
  obtenerTendenciasTemporales,
  obtenerMapaRuido
} = require('../controllers/controladorRuido');

const {
  validarDatosRuido,
  validarEstadisticasRuido,
  validarRankingRuido,
  validarCumplimientoZona,
  validarTendenciasTemporales,
  validarMapaRuido
} = require('../validators/validadorRuido');

const router = express.Router();

// Rate limiting especifico para endpoints de ruido
const noiseDataLimiter = rateLimit({
  windowMs: RATE_LIMITS.WINDOWS.ONE_MINUTE,
  max: RATE_LIMITS.NOISE_MONITORING.LIST_MAX,
  message: {
    success: false,
    message: 'Demasiadas consultas de datos acústicos, intente nuevamente en 1 minuto'
  },
  standardHeaders: true,
  legacyHeaders: false
});

const noiseStatisticsLimiter = rateLimit({
  windowMs: RATE_LIMITS.WINDOWS.FIVE_MINUTES,
  max: RATE_LIMITS.NOISE_MONITORING.STATS_MAX,
  message: {
    success: false,
    message: 'Límite de consultas estadísticas acústicas alcanzado, intente nuevamente en 5 minutos'
  }
});

/**
 * GET /api/v1/ruido
 */
router.get('/',
  noiseDataLimiter,
  authenticate,
  validateDateRange(DATE_RANGE_LIMITS.NOISE_MAX_DAYS),
  validarDatosRuido,
  validateRequest,
  cacheMiddleware('noise'),
  obtenerDatosRuido
);

/**
 * GET /api/v1/ruido/estadisticas
 */
router.get('/estadisticas',
  noiseStatisticsLimiter,
  authenticate,
  validateDateRange(DATE_RANGE_LIMITS.NOISE_MAX_DAYS),
  validarEstadisticasRuido,
  validateRequest,
  etagMiddleware,
  cacheMiddleware('noise'),
  obtenerEstadisticasRuido
);

/**
 * GET /api/v1/ruido/ranking
 */
router.get('/ranking',
  noiseStatisticsLimiter,
  authenticate,
  validarRankingRuido,
  validateRequest,
  etagMiddleware,
  cacheMiddleware('noise'),
  obtenerRankingRuido
);

/**
 * GET /api/v1/ruido/cumplimiento/zona
 */
router.get('/cumplimiento/zona',
  noiseStatisticsLimiter,
  authenticate,
  validarCumplimientoZona,
  validateRequest,
  etagMiddleware,
  cacheMiddleware('noise'),
  obtenerCumplimientoPorZona
);

/**
 * GET /api/v1/ruido/tendencias/temporal
 */
router.get('/tendencias/temporal',
  noiseStatisticsLimiter,
  authenticate,
  validarTendenciasTemporales,
  validateRequest,
  cacheMiddleware('noise'),
  obtenerTendenciasTemporales
);

/**
 * GET /api/v1/ruido/mapa
 */
router.get('/mapa',
  noiseStatisticsLimiter,
  authenticate,
  validarMapaRuido,
  validateRequest,
  etagMiddleware,
  cacheMiddleware('noise'),
  obtenerMapaRuido
);

module.exports = router;
