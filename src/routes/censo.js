/**
 * Rutas de Censo
 *
 * Validaciones express-validator extraidas a `validators/validadorCenso.js`.
 */

const express = require('express');

const {
  obtenerDatosCenso,
  obtenerPiramidePoblacional,
  obtenerEstadisticasDistritos,
  obtenerAnalisisDemografico,
  obtenerEvolucionDemografica,
  obtenerDashboardDemografico,
  obtenerResumenDistritos
} = require('../controllers/controladorCenso');

const { CENSUS_DEFAULTS, DATASET_YEARS } = require('../constants');

const { authenticate } = require('../middleware/auth');
const { validateRequest, heavyQueryLimiter } = require('../middleware/security');
const { cacheMiddleware } = require('../middleware/cache');
const { generatePrefixedCacheKey } = require('../utils/cacheKeyGenerator');
const { etagMiddleware } = require('../middleware/etag');

const {
  validarDatosCenso,
  validarPiramidePoblacional,
  validarEstadisticasDistritos,
  validarAnalisisDemografico,
  validarEvolucionDemografica,
  validarDashboardDemografico,
  validarResumenDistritos
} = require('../validators/validadorCenso');

const router = express.Router();

/**
 * GET /api/v1/censo
 */
router.get('/',
  authenticate,
  validarDatosCenso,
  validateRequest,
  cacheMiddleware('demographic', (req) => generatePrefixedCacheKey('census:list', req.query)),
  obtenerDatosCenso
);

/**
 * GET /api/v1/censo/piramide
 */
router.get('/piramide',
  authenticate,
  validarPiramidePoblacional,
  validateRequest,
  etagMiddleware,
  cacheMiddleware('demographic', (req) =>
    // El `mes` DEBE estar en la clave: la piramide es una foto de un mes y el
    // servicio lo usa en el $match; omitirlo servia el mes equivocado al filtrar.
    // `incluirExtranjeros` ya es boolean aqui (validateRequest aplico .toBoolean()
    // antes que cacheMiddleware). `|| true` daba 'true' tambien para false (false
    // es falsy) -> colisionaba true/false en la misma clave. `!== false` refleja
    // el valor real: undefined/true -> 'true', false -> 'false'.
    `census:pyramid:${req.query.año || CENSUS_DEFAULTS.START_YEAR}:${req.query.distrito || 'all'}:${req.query.mes || 'all'}:${req.query.incluirExtranjeros !== false}`
  ),
  obtenerPiramidePoblacional
);

/**
 * GET /api/v1/censo/distritos/estadisticas
 */
router.get('/distritos/estadisticas',
  authenticate,
  heavyQueryLimiter,
  validarEstadisticasDistritos,
  validateRequest,
  cacheMiddleware('demographic', (req) =>
    `census:districts:stats:${req.query.año || CENSUS_DEFAULTS.START_YEAR}:${req.query.mes || 'all'}:${req.query.incluirBarrios || false}`
  ),
  obtenerEstadisticasDistritos
);

/**
 * GET /api/v1/censo/analisis/demografico
 */
router.get('/analisis/demografico',
  authenticate,
  heavyQueryLimiter,
  validarAnalisisDemografico,
  validateRequest,
  cacheMiddleware('demographic', (req) =>
    `census:demographic:${req.query.año || CENSUS_DEFAULTS.START_YEAR}:${req.query.distrito || 'all'}:${req.query.mes || 'all'}`
  ),
  obtenerAnalisisDemografico
);

/**
 * GET /api/v1/censo/evolucion
 */
router.get('/evolucion',
  authenticate,
  validarEvolucionDemografica,
  validateRequest,
  cacheMiddleware('demographic', (req) =>
    `census:evolution:${req.query.distrito || 'all'}:${req.query.startYear || DATASET_YEARS.MIN_YEAR}:${req.query.endYear || CENSUS_DEFAULTS.END_YEAR}:${req.query.metrica || 'poblacionTotal'}`
  ),
  obtenerEvolucionDemografica
);

/**
 * GET /api/v1/censo/dashboard
 */
router.get('/dashboard',
  authenticate,
  heavyQueryLimiter,
  validarDashboardDemografico,
  validateRequest,
  cacheMiddleware('demographic', (req) =>
    // El `mes` DEBE formar parte de la clave: el controlador lo usa en el
    // $match. Omitirlo hacia que peticiones de meses distintos (mismo año y
    // distrito) colisionaran en la misma clave y se sirvieran datos del mes
    // equivocado durante el TTL.
    `census:dashboard:${req.query.año || CENSUS_DEFAULTS.START_YEAR}:${req.query.distrito || 'all'}:${req.query.mes || 'all'}:${req.query.barrio || 'all'}:${req.query.grupoEdad || 'all'}`
  ),
  obtenerDashboardDemografico
);

/**
 * GET /api/v1/censo/distritos/resumen
 */
router.get('/distritos/resumen',
  authenticate,
  validarResumenDistritos,
  validateRequest,
  cacheMiddleware('demographic', (req) =>
    `census:distritos:resumen:${req.query.año || 'default'}:${req.query.mes || 'all'}`
  ),
  obtenerResumenDistritos
);

module.exports = router;
