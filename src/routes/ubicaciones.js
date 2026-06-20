/**
 * Rutas de Ubicaciones
 *
 * Validaciones express-validator extraidas a `validators/validadorUbicaciones.js`.
 */

const express = require('express');
const rateLimit = require('express-rate-limit');

const {
  obtenerUbicaciones,
  obtenerPuntosMedicion,
  obtenerRutasTransporte,
  obtenerMapaUbicaciones,
  registrarUbicacion,
  registrarUbicacionesLote
} = require('../controllers/controladorUbicaciones');

const { RATE_LIMITS } = require('../constants');

const { authenticate } = require('../middleware/auth');
const { sensorOrAdmin } = require('../middleware/authorization');
const { validateRequest, ingestLimiter } = require('../middleware/security');
const { cacheMiddleware } = require('../middleware/cache');
const { etagMiddleware } = require('../middleware/etag');

const {
  validarObtenerUbicaciones,
  validarPuntosMedicion,
  validarRutasTransporte,
  validarMapaUbicaciones,
  validarIngestaUbicacion,
  validarIngestaLoteUbicaciones
} = require('../validators/validadorUbicaciones');

const router = express.Router();

/**
 * Rate limiter permisivo (3x el general) porque las consultas de ubicaciones
 * son ligeras y se llaman muy frecuentemente desde el frontend.
 */
const locationsLimiter = rateLimit({
  windowMs: RATE_LIMITS.GENERAL.WINDOW_MS,
  max: RATE_LIMITS.GENERAL.MAX_REQUESTS * 3,
  message: {
    success: false,
    message: 'Demasiadas consultas de ubicaciones, intente nuevamente en 15 minutos'
  },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.user && req.user.role === 'admin'
});

router.get('/',
  locationsLimiter,
  authenticate,
  etagMiddleware,
  cacheMiddleware('static'),
  validarObtenerUbicaciones,
  validateRequest,
  obtenerUbicaciones
);

router.get('/puntos-medicion/:measurementType',
  locationsLimiter,
  authenticate,
  cacheMiddleware('static'),
  validarPuntosMedicion,
  validateRequest,
  obtenerPuntosMedicion
);

router.get('/transporte/:transportType',
  locationsLimiter,
  authenticate,
  cacheMiddleware('static'),
  validarRutasTransporte,
  validateRequest,
  obtenerRutasTransporte
);

router.get('/mapa',
  locationsLimiter,
  authenticate,
  etagMiddleware,
  cacheMiddleware('static'),
  validarMapaUbicaciones,
  validateRequest,
  obtenerMapaUbicaciones
);

// ========================================
// INGESTA (escritura) - registro de nodos IoT
// ========================================

/**
 * Registrar un nodo de infraestructura/medicion (punto de trafico o estacion
 * acustica). Permite al simulador dar de alta sus nodos para que el mapa y el
 * analisis por distrito de trafico, el mapa de ruido y esta misma pagina tengan
 * datos geolocalizados.
 * @route POST /api/v1/ubicaciones/ingesta
 * @access Private (JWT)
 */
router.post('/ingesta',
  authenticate,
  sensorOrAdmin,
  ingestLimiter,
  validarIngestaUbicacion,
  validateRequest,
  registrarUbicacion
);

/**
 * Registrar un lote de nodos de ubicacion.
 * @route POST /api/v1/ubicaciones/ingesta/lote
 * @access Private (JWT)
 */
router.post('/ingesta/lote',
  authenticate,
  sensorOrAdmin,
  ingestLimiter,
  validarIngestaLoteUbicaciones,
  validateRequest,
  registrarUbicacionesLote
);

module.exports = router;
