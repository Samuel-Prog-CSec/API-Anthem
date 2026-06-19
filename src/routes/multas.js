/**
 * Rutas de Multas
 *
 * Define todos los endpoints relacionados con multas de trafico.
 * Las validaciones express-validator se han extraido a
 * `validators/validadorMultas.js` para mantener este archivo legible.
 */

const express = require('express');

const {
  obtenerMultas,
  obtenerMultaPorId,
  obtenerEstadisticasMultas,
  obtenerRankingUbicaciones,
  obtenerAnalisisTemporal,
  obtenerMetricasDashboard,
  obtenerMapaMultas
} = require('../controllers/controladorMultas');

const { authenticate } = require('../middleware/auth');
const { validateRequest, heavyQueryLimiter } = require('../middleware/security');
const { etagMiddleware } = require('../middleware/etag');
const { cacheMiddleware } = require('../middleware/cache');
const { generatePrefixedCacheKey } = require('../utils/cacheKeyGenerator');
const {
  validarObtenerMultas,
  validarEstadisticasMultas,
  validarRankingUbicaciones,
  validarAnalisisTemporal,
  validarMetricasDashboard,
  validarMapaMultas,
  validarMultaPorId
} = require('../validators/validadorMultas');

const router = express.Router();

// Nota: performanceMonitor se aplica una sola vez en routes/index.js

/**
 * GET /api/v1/multas
 * Obtener multas con filtros avanzados
 */
router.get('/',
  authenticate,
  ...validarObtenerMultas,
  validateRequest,
  cacheMiddleware('statistics', (req) => generatePrefixedCacheKey('fines:list', req.query)),
  obtenerMultas
);

/**
 * GET /api/v1/multas/estadisticas
 * Obtener estadisticas agregadas de multas
 */
router.get('/estadisticas',
  authenticate,
  heavyQueryLimiter,
  ...validarEstadisticasMultas,
  validateRequest,
  etagMiddleware,
  cacheMiddleware('statistics', (req) =>
    `fines-stats-${req.query.groupBy || 'month'}-${req.query.startDate || 'all'}-${req.query.endDate || 'all'}-${req.query.limit || 12}` +
    `-${req.query.denunciante || 'all'}-${req.query.tieneDescuento ?? req.query.conDescuento ?? 'all'}-${req.query.esGrave ?? 'all'}`
  ),
  obtenerEstadisticasMultas
);

/**
 * GET /api/v1/multas/ubicaciones/ranking
 * Obtener ranking de ubicaciones con mas multas
 */
router.get('/ubicaciones/ranking',
  authenticate,
  ...validarRankingUbicaciones,
  validateRequest,
  cacheMiddleware('statistics', (req) => generatePrefixedCacheKey('fines:ranking', req.query)),
  obtenerRankingUbicaciones
);

/**
 * GET /api/v1/multas/analisis/temporal
 * Analisis temporal de multas con evolucion y tendencias
 */
router.get('/analisis/temporal',
  authenticate,
  heavyQueryLimiter,
  ...validarAnalisisTemporal,
  validateRequest,
  cacheMiddleware('statistics', (req) =>
    // La clave usa `tipoAnalisis` (el parametro real que cambia la salida del
    // servicio). Antes usaba `granularity`, que el controlador no lee, por lo
    // que peticiones con distinto tipoAnalisis colisionaban en la misma clave
    // y la segunda recibia el analisis equivocado durante el TTL.
    `fines-temporal-analysis-${req.query.startDate || 'all'}-${req.query.endDate || 'all'}-${req.query.tipoAnalisis || 'monthly'}`
  ),
  obtenerAnalisisTemporal
);

/**
 * GET /api/v1/multas/dashboard
 * Obtener metricas del dashboard principal
 */
router.get('/dashboard',
  authenticate,
  heavyQueryLimiter,
  ...validarMetricasDashboard,
  validateRequest,
  cacheMiddleware('statistics', (req) => generatePrefixedCacheKey('fines:dashboard', req.query)),
  obtenerMetricasDashboard
);

/**
 * GET /api/v1/multas/mapa
 * FeatureCollection GeoJSON con multas georreferenciadas
 */
router.get('/mapa',
  authenticate,
  validarMapaMultas,
  validateRequest,
  cacheMiddleware('fines', (req) => generatePrefixedCacheKey('fines:mapa', req.query)),
  obtenerMapaMultas
);

/**
 * GET /api/v1/multas/:id
 * Obtener multa por ID con detalles completos
 */
router.get('/:id',
  authenticate,
  ...validarMultaPorId,
  validateRequest,
  cacheMiddleware('statistics', (req) => `fines:detail:${req.params.id}`),
  obtenerMultaPorId
);

module.exports = router;
