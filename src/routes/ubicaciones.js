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
  obtenerMapaUbicaciones
} = require('../controllers/controladorUbicaciones');

const { RATE_LIMITS } = require('../constants');

const { authenticate } = require('../middleware/auth');
const { validateRequest } = require('../middleware/security');
const { cacheMiddleware } = require('../middleware/cache');
const { etagMiddleware } = require('../middleware/etag');

const {
  validarObtenerUbicaciones,
  validarPuntosMedicion,
  validarRutasTransporte,
  validarMapaUbicaciones
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
  cacheMiddleware(),
  validarObtenerUbicaciones,
  validateRequest,
  obtenerUbicaciones
);

router.get('/puntos-medicion/:measurementType',
  locationsLimiter,
  authenticate,
  cacheMiddleware(),
  validarPuntosMedicion,
  validateRequest,
  obtenerPuntosMedicion
);

router.get('/transporte/:transportType',
  locationsLimiter,
  authenticate,
  cacheMiddleware(),
  validarRutasTransporte,
  validateRequest,
  obtenerRutasTransporte
);

router.get('/mapa',
  locationsLimiter,
  authenticate,
  etagMiddleware,
  cacheMiddleware(),
  validarMapaUbicaciones,
  validateRequest,
  obtenerMapaUbicaciones
);

module.exports = router;
