/**
 * Rutas de Calidad del Aire
 *
 * Validaciones express-validator extraidas a `validators/validadorCalidadAire.js`.
 */

const express = require('express');
const rateLimit = require('express-rate-limit');

const { authenticate } = require('../middleware/auth');
const { validateRequest, heavyQueryLimiter } = require('../middleware/security');
const { cacheMiddleware } = require('../middleware/cache');
const { RATE_LIMITS } = require('../constants');

const {
  obtenerDatosCalidadAire,
  obtenerEstadisticasCalidadAire,
  obtenerTendenciasCalidadAire
} = require('../controllers/controladorCalidadAire');

const {
  validarDatosCalidadAire,
  validarEstadisticasCalidadAire,
  validarTendenciasCalidadAire
} = require('../validators/validadorCalidadAire');

const router = express.Router();

/**
 * Rate limiting especifico para consultas normales de calidad del aire.
 * Las consultas pesadas (estadisticas/tendencias) usan `heavyQueryLimiter` global.
 */
const dataQueryLimiter = rateLimit({
  windowMs: RATE_LIMITS.WINDOWS.ONE_MINUTE,
  max: RATE_LIMITS.AIR_QUALITY.LIST_MAX,
  message: {
    success: false,
    message: 'Demasiadas consultas de datos, intente nuevamente en 1 minuto'
  },
  standardHeaders: true,
  legacyHeaders: false
});

router.get('/',
  dataQueryLimiter,
  authenticate,
  validarDatosCalidadAire,
  validateRequest,
  cacheMiddleware('airQuality'),
  obtenerDatosCalidadAire
);

router.get('/estadisticas',
  heavyQueryLimiter,
  authenticate,
  validarEstadisticasCalidadAire,
  validateRequest,
  cacheMiddleware('airQuality'),
  obtenerEstadisticasCalidadAire
);

router.get('/tendencias',
  heavyQueryLimiter,
  authenticate,
  validarTendenciasCalidadAire,
  validateRequest,
  cacheMiddleware('airQuality'),
  obtenerTendenciasCalidadAire
);

module.exports = router;
