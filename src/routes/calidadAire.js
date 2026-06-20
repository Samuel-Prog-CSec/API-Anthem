/**
 * Rutas de Calidad del Aire
 *
 * Validaciones express-validator extraidas a `validators/validadorCalidadAire.js`.
 */

const express = require('express');
const rateLimit = require('express-rate-limit');

const { authenticate } = require('../middleware/auth');
const { sensorOrAdmin } = require('../middleware/authorization');
const { validateRequest, heavyQueryLimiter, ingestLimiter } = require('../middleware/security');
const { cacheMiddleware } = require('../middleware/cache');
const { RATE_LIMITS } = require('../constants');

const {
  obtenerDatosCalidadAire,
  obtenerEstadisticasCalidadAire,
  obtenerTendenciasCalidadAire,
  ingestarMedicionAire,
  ingestarLoteAire
} = require('../controllers/controladorCalidadAire');

const {
  validarDatosCalidadAire,
  validarEstadisticasCalidadAire,
  validarTendenciasCalidadAire,
  validarIngestaAire,
  validarIngestaLoteAire
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
  authenticate,
  heavyQueryLimiter,
  validarEstadisticasCalidadAire,
  validateRequest,
  cacheMiddleware('airQuality'),
  obtenerEstadisticasCalidadAire
);

router.get('/tendencias',
  authenticate,
  heavyQueryLimiter,
  validarTendenciasCalidadAire,
  validateRequest,
  cacheMiddleware('airQuality'),
  obtenerTendenciasCalidadAire
);

// ========================================
// INGESTA (escritura) - nodos IoT
// ========================================

/**
 * Registrar una medicion horaria de calidad del aire.
 * @route POST /api/v1/calidad-aire/ingesta
 * @access Private (JWT)
 */
router.post('/ingesta',
  authenticate,
  sensorOrAdmin,
  ingestLimiter,
  validarIngestaAire,
  validateRequest,
  ingestarMedicionAire
);

/**
 * Registrar un lote de mediciones horarias de calidad del aire.
 * @route POST /api/v1/calidad-aire/ingesta/lote
 * @access Private (JWT)
 */
router.post('/ingesta/lote',
  authenticate,
  sensorOrAdmin,
  ingestLimiter,
  validarIngestaLoteAire,
  validateRequest,
  ingestarLoteAire
);

module.exports = router;
