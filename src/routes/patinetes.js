/**
 * Rutas de Asignacion de Patinetes
 *
 * Validaciones express-validator extraidas a `validators/validadorPatinetes.js`.
 */

const express = require('express');

const {
  obtenerAsignaciones,
  obtenerEstadisticasDistritos,
  obtenerAnalisisMercadoProveedores,
  obtenerZonasConcentracion,
  obtenerDetallesArea,
  obtenerMapaPatinetes
} = require('../controllers/controladorPatinetes');

const { authenticate } = require('../middleware/auth');
const { validateRequest, heavyQueryLimiter } = require('../middleware/security');
const { cacheMiddleware } = require('../middleware/cache');
const { generatePrefixedCacheKey } = require('../utils/cacheKeyGenerator');
const { etagMiddleware } = require('../middleware/etag');
const {
  validarAsignacionesPatinetes,
  validarEstadisticasDistritosPatinetes,
  validarAnalisisMercadoProveedores,
  validarZonasConcentracion,
  validarDetallesArea,
  validarMapaPatinetes
} = require('../validators/validadorPatinetes');

const router = express.Router();

router.get('/',
  authenticate,
  validarAsignacionesPatinetes,
  validateRequest,
  cacheMiddleware('traffic', (req) => generatePrefixedCacheKey('scooters:list', req.query)),
  obtenerAsignaciones
);

router.get('/estadisticas/distritos',
  authenticate,
  heavyQueryLimiter,
  validarEstadisticasDistritosPatinetes,
  validateRequest,
  etagMiddleware,
  cacheMiddleware('traffic', (req) => `scooters:stats:districts:${req.query.fecha || 'all'}:${req.query.distrito || 'all'}:${req.query.densidad || 'all'}:${req.query.tipoZona || 'all'}`),
  obtenerEstadisticasDistritos
);

router.get('/analisis-mercado/proveedores',
  authenticate,
  heavyQueryLimiter,
  validarAnalisisMercadoProveedores,
  validateRequest,
  etagMiddleware,
  cacheMiddleware('traffic', (req) => `scooters:market:providers:${req.query.fecha || 'all'}:${req.query.distrito || 'all'}:${req.query.densidad || 'all'}:${req.query.tipoZona || 'all'}`),
  obtenerAnalisisMercadoProveedores
);

router.get('/zonas-concentracion',
  authenticate,
  validarZonasConcentracion,
  validateRequest,
  etagMiddleware,
  cacheMiddleware('traffic', (req) => `scooters:concentration:${req.query.fecha || 'all'}:${req.query.limite || 10}:${req.query.distrito || 'all'}:${req.query.densidad || 'all'}:${req.query.tipoZona || 'all'}`),
  obtenerZonasConcentracion
);

router.get('/area/:distrito/:barrio',
  authenticate,
  validarDetallesArea,
  validateRequest,
  cacheMiddleware('traffic', (req) => `scooters:area:${req.params.distrito}:${req.params.barrio}:${req.query.fecha || 'all'}`),
  obtenerDetallesArea
);

router.get('/mapa',
  authenticate,
  validarMapaPatinetes,
  validateRequest,
  etagMiddleware,
  cacheMiddleware('traffic', (req) => `scooters:mapa:${req.query.fecha || 'all'}:${req.query.distrito || 'all'}:${req.query.densidad || 'all'}:${req.query.tipoZona || 'all'}`),
  obtenerMapaPatinetes
);

// Express 5 Compatibility: el notFoundHandler global en server.js maneja 404s.
// No registramos catch-all local ('*') porque requeriria nombres de param explicitos.

module.exports = router;
