/**
 * Rutas de Censo
 *
 * Define todos los endpoints relacionados con datos demográficos del censo.
 * Incluye middleware de validación, autenticación y manejo de errores.
 */

const express = require('express');
const { query } = require('express-validator');

const {
  obtenerDatosCenso,
  obtenerPiramidePoblacional,
  obtenerEstadisticasDistritos,
  obtenerAnalisisDemografico,
  obtenerEvolucionDemografica,
  obtenerDashboardDemografico,
  obtenerResumenDistritos
} = require('../controllers/controladorCenso');

const {
  ROUTE_SPECIFIC_LIMITS,
  CENSUS_DEFAULTS,
  AGE_GROUPS,
  DATASET_YEARS
} = require('../constants');

const { authenticate } = require('../middleware/auth');
const { validateRequest, heavyQueryLimiter } = require('../middleware/security');
const { cacheMiddleware } = require('../middleware/cache');
const { performanceMonitor } = require('../middleware/performanceMonitor');
const { etagMiddleware } = require('../middleware/etag');

const router = express.Router();

// Aplicar performanceMonitor a todas las rutas de censo
router.use(performanceMonitor);

/**
 * Validaciones comunes para filtros de fecha
 */
const dateValidation = [
  query('startDate')
    .optional()
    .isISO8601()
    .withMessage('Fecha de inicio debe ser válida (ISO8601)')
    .toDate(),
  query('endDate')
    .optional()
    .isISO8601()
    .withMessage('Fecha de fin debe ser válida (ISO8601)')
    .toDate()
    .custom((value, { req }) => {
      if (req.query.startDate && value < req.query.startDate) {
        throw new Error('Fecha de fin debe ser posterior a fecha de inicio');
      }
      return true;
    })
];

/**
 * Validaciones para paginación
 */
const paginationValidation = [
  query('page')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Página debe ser un número entero positivo')
    .toInt(),
  query('limit')
    .optional()
    .isInt({ min: ROUTE_SPECIFIC_LIMITS.CENSUS.LIMIT_MIN, max: ROUTE_SPECIFIC_LIMITS.CENSUS.LIMIT_MAX })
    .withMessage(`Límite debe estar entre ${ROUTE_SPECIFIC_LIMITS.CENSUS.LIMIT_MIN} y ${ROUTE_SPECIFIC_LIMITS.CENSUS.LIMIT_MAX}`)
    .toInt(),
  query('sortBy')
    .optional()
    .isIn([
      'fechaCenso', 'estadisticas.totalPoblacion', 'estadisticas.porcentajeExtranjeros',
      'edad', 'distrito.descripcion', 'barrio.descripcion'
    ])
    .withMessage('Campo de ordenamiento no válido'),
  query('sortOrder')
    .optional()
    .isIn(['asc', 'desc'])
    .withMessage('Orden debe ser asc o desc')
];

/**
 * Validaciones para códigos geográficos
 */
const geographicValidation = [
  query('distrito')
    .optional()
    .custom((value) => {
      const values = Array.isArray(value) ? value : [value];
      return values.every(v => Number.isInteger(parseInt(v, 10)) && parseInt(v, 10) > 0);
    })
    .withMessage('Código de distrito debe ser un número entero positivo'),

  query('barrio')
    .optional()
    .custom((value) => {
      const values = Array.isArray(value) ? value : [value];
      return values.every(v => Number.isInteger(parseInt(v, 10)) && parseInt(v, 10) > 0);
    })
    .withMessage('Código de barrio debe ser un número entero positivo')
];

/**
 * @route   GET /api/v1/censo
 * @desc    Obtener datos de censo con filtros demográficos avanzados
 * @access  Private (requiere autenticación)
 * @query   {string} startDate - Fecha de inicio (ISO8601)
 * @query   {string} endDate - Fecha de fin (ISO8601)
 * @query   {number} distrito - Código del distrito
 * @query   {number} barrio - Código del barrio
 * @query   {string} grupoEdad - Grupo de edad (INFANTIL, JUVENIL, ADULTO_JOVEN, ADULTO, MAYOR, ANCIANO)
 * @query   {number} minEdad - Edad mínima (0-150)
 * @query   {number} maxEdad - Edad máxima (0-150)
 * @query   {boolean} soloProductivos - Solo población productiva
 * @query   {number} page - Página (defecto: 1)
 * @query   {number} limit - Elementos por página (defecto: 50, max: 100)
 * @example GET /api/v1/censo?distrito=1&grupoEdad=ADULTO_JOVEN&page=1&limit=20
 */
router.get('/',
  // Middleware de autenticación
  authenticate,

  // Validaciones
  ...dateValidation,
  ...paginationValidation,
  ...geographicValidation,

  query('grupoEdad')
    .optional()
    .custom((value) => {
      const validValues = [ ...Object.values(AGE_GROUPS) ];
      const values = Array.isArray(value) ? value : [value];
      return values.every(v => validValues.includes(v));
    })
    .withMessage('Grupo de edad no válido'),

  query('minEdad')
    .optional()
    .isInt({ min: ROUTE_SPECIFIC_LIMITS.CENSUS.AGE_MIN, max: ROUTE_SPECIFIC_LIMITS.CENSUS.AGE_MAX })
    .withMessage(`Edad mínima debe estar entre ${ROUTE_SPECIFIC_LIMITS.CENSUS.AGE_MIN} y ${ROUTE_SPECIFIC_LIMITS.CENSUS.AGE_MAX}`)
    .toInt(),

  query('maxEdad')
    .optional()
    .isInt({ min: ROUTE_SPECIFIC_LIMITS.CENSUS.AGE_MIN, max: ROUTE_SPECIFIC_LIMITS.CENSUS.AGE_MAX })
    .withMessage(`Edad máxima debe estar entre ${ROUTE_SPECIFIC_LIMITS.CENSUS.AGE_MIN} y ${ROUTE_SPECIFIC_LIMITS.CENSUS.AGE_MAX}`)
    .toInt()
    .custom((value, { req }) => {
      if (req.query.minEdad && value < req.query.minEdad) {
        throw new Error('Edad máxima debe ser mayor que edad mínima');
      }
      return true;
    }),

  query('minPoblacion')
    .optional()
    .isInt({ min: 0 })
    .withMessage('Población mínima debe ser un número entero positivo')
    .toInt(),

  query('maxPoblacion')
    .optional()
    .isInt({ min: 0 })
    .withMessage('Población máxima debe ser un número entero positivo')
    .toInt()
    .custom((value, { req }) => {
      if (req.query.minPoblacion && value < req.query.minPoblacion) {
        throw new Error('Población máxima debe ser mayor que población mínima');
      }
      return true;
    }),

  query('soloProductivos')
    .optional()
    .isBoolean()
    .withMessage('Solo productivos debe ser true o false')
    .toBoolean(),

  query('soloTerceraEdad')
    .optional()
    .isBoolean()
    .withMessage('Solo tercera edad debe ser true o false')
    .toBoolean(),

  query('includeEstadisticas')
    .optional()
    .isBoolean()
    .withMessage('Incluir estadísticas debe ser true o false')
    .toBoolean(),

  // Middleware de validación
  validateRequest,

  // Middleware de caché (1 hora para datos demográficos)
  cacheMiddleware('demographic', (req) => `census:list:${JSON.stringify(req.query)}`),

  // Controlador
  obtenerDatosCenso
);

/**
 * GET /api/v1/censo/piramide
 * Obtener pirámide poblacional
 */
router.get('/piramide',
  // Middleware de autenticación
  authenticate,

  // Validaciones
  query('distrito')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Código de distrito debe ser un número entero positivo')
    .toInt(),

  query('año')
    .optional()
    .isInt({ min: ROUTE_SPECIFIC_LIMITS.CENSUS.YEAR_MIN, max: ROUTE_SPECIFIC_LIMITS.CENSUS.YEAR_MAX })
    .withMessage(`Año debe estar entre ${ROUTE_SPECIFIC_LIMITS.CENSUS.YEAR_MIN} y ${ROUTE_SPECIFIC_LIMITS.CENSUS.YEAR_MAX}`)
    .toInt(),

  query('incluirExtranjeros')
    .optional()
    .isBoolean()
    .withMessage('Incluir extranjeros debe ser true o false')
    .toBoolean(),

  // Middleware de validación
  validateRequest,

  // ETags para pirámide poblacional (datos muy estables)
  etagMiddleware,

  // Middleware de caché (1 hora para datos demográficos)
  cacheMiddleware('demographic', (req) =>
    `census:pyramid:${req.query.año || CENSUS_DEFAULTS.START_YEAR}:${req.query.distrito || 'all'}:${req.query.incluirExtranjeros || true}`
  ),

  // Controlador
  obtenerPiramidePoblacional
);

/**
 * GET /api/v1/censo/distritos/estadisticas
 * Obtener estadísticas por distritos
 */
router.get('/distritos/estadisticas',
  // Middleware de autenticación
  authenticate,

  // Heavy query rate limiter
  heavyQueryLimiter,

  // Validaciones
  query('año')
    .optional()
    .isInt({ min: ROUTE_SPECIFIC_LIMITS.CENSUS.YEAR_MIN, max: ROUTE_SPECIFIC_LIMITS.CENSUS.YEAR_MAX })
    .withMessage(`Año debe estar entre ${ROUTE_SPECIFIC_LIMITS.CENSUS.YEAR_MIN} y ${ROUTE_SPECIFIC_LIMITS.CENSUS.YEAR_MAX}`)
    .toInt(),

  query('mes')
    .optional()
    .isInt({ min: ROUTE_SPECIFIC_LIMITS.CENSUS.MONTH_MIN, max: ROUTE_SPECIFIC_LIMITS.CENSUS.MONTH_MAX })
    .withMessage(`Mes debe estar entre ${ROUTE_SPECIFIC_LIMITS.CENSUS.MONTH_MIN} y ${ROUTE_SPECIFIC_LIMITS.CENSUS.MONTH_MAX}`)
    .toInt(),

  query('incluirBarrios')
    .optional()
    .isBoolean()
    .withMessage('Incluir barrios debe ser true o false')
    .toBoolean(),

  // Middleware de validación
  validateRequest,

  // Middleware de caché (1 hora para datos demográficos)
  cacheMiddleware('demographic', (req) =>
    `census:districts:stats:${req.query.año || CENSUS_DEFAULTS.START_YEAR}:${req.query.mes || 'all'}:${req.query.incluirBarrios || false}`
  ),

  // Controlador
  obtenerEstadisticasDistritos
);

/**
 * GET /api/v1/censo/analisis/demografico
 * Obtener análisis demográfico avanzado
 */
router.get('/analisis/demografico',
  // Middleware de autenticación
  authenticate,

  // Heavy query rate limiter
  heavyQueryLimiter,

  // Validaciones
  query('distrito')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Código de distrito debe ser un número entero positivo')
    .toInt(),

  query('año')
    .optional()
    .isInt({ min: ROUTE_SPECIFIC_LIMITS.CENSUS.YEAR_MIN, max: ROUTE_SPECIFIC_LIMITS.CENSUS.YEAR_MAX })
    .withMessage(`Año debe estar entre ${ROUTE_SPECIFIC_LIMITS.CENSUS.YEAR_MIN} y ${ROUTE_SPECIFIC_LIMITS.CENSUS.YEAR_MAX}`)
    .toInt(),

  query('tipoAnalisis')
    .optional()
    .isIn(['completo', 'edad', 'nacionalidad', 'genero'])
    .withMessage('Tipo de análisis debe ser completo, edad, nacionalidad o genero'),

  // Middleware de validación
  validateRequest,

  // Middleware de caché (1 hora para análisis demográfico)
  cacheMiddleware('demographic', (req) =>
    `census:demographic:${req.query.año || CENSUS_DEFAULTS.START_YEAR}:${req.query.distrito || 'all'}:${req.query.mes || 'all'}`
  ),

  // Controlador
  obtenerAnalisisDemografico
);

/**
 * GET /api/v1/censo/evolucion
 * Obtener evolución demográfica temporal
 */
router.get('/evolucion',
  // Middleware de autenticación
  authenticate,

  // Validaciones
  query('distrito')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Código de distrito debe ser un número entero positivo')
    .toInt(),

  query('startYear')
    .optional()
    .isInt({ min: ROUTE_SPECIFIC_LIMITS.CENSUS.YEAR_MIN, max: ROUTE_SPECIFIC_LIMITS.CENSUS.YEAR_MAX })
    .withMessage(`Año de inicio debe estar entre ${ROUTE_SPECIFIC_LIMITS.CENSUS.YEAR_MIN} y ${ROUTE_SPECIFIC_LIMITS.CENSUS.YEAR_MAX}`)
    .toInt(),

  query('endYear')
    .optional()
    .isInt({ min: ROUTE_SPECIFIC_LIMITS.CENSUS.YEAR_MIN, max: ROUTE_SPECIFIC_LIMITS.CENSUS.YEAR_MAX })
    .withMessage(`Año de fin debe estar entre ${ROUTE_SPECIFIC_LIMITS.CENSUS.YEAR_MIN} y ${ROUTE_SPECIFIC_LIMITS.CENSUS.YEAR_MAX}`)
    .toInt()
    .custom((value, { req }) => {
      if (req.query.startYear && value < req.query.startYear) {
        throw new Error('Año de fin debe ser posterior al año de inicio');
      }
      return true;
    }),

  query('metrica')
    .optional()
    .isIn(['poblacionTotal', 'extranjeros', 'productiva'])
    .withMessage('Métrica debe ser poblacionTotal, extranjeros o productiva'),

  // Middleware de validación
  validateRequest,

  // Middleware de caché (1 hora para datos demográficos)
  cacheMiddleware('demographic', (req) =>
    `census:evolution:${req.query.distrito || 'all'}:${req.query.startYear || DATASET_YEARS.MIN_YEAR}:${req.query.endYear || CENSUS_DEFAULTS.END_YEAR}:${req.query.metrica || 'poblacionTotal'}`
  ),

  // Controlador
  obtenerEvolucionDemografica
);

/**
 * GET /api/v1/censo/dashboard
 * Obtener métricas del dashboard demográfico
 */
router.get('/dashboard',
  // Middleware de autenticación
  authenticate,

  // Heavy query rate limiter
  heavyQueryLimiter,

  // Validaciones
  query('año')
    .optional()
    .isInt({ min: ROUTE_SPECIFIC_LIMITS.CENSUS.YEAR_MIN, max: ROUTE_SPECIFIC_LIMITS.CENSUS.YEAR_MAX })
    .withMessage(`Año debe estar entre ${ROUTE_SPECIFIC_LIMITS.CENSUS.YEAR_MIN} y ${ROUTE_SPECIFIC_LIMITS.CENSUS.YEAR_MAX}`)
    .toInt(),

  query('distrito')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Código de distrito debe ser un número entero positivo')
    .toInt(),

  // Middleware de validación
  validateRequest,

  // Middleware de caché (1 hora para datos demográficos)
  cacheMiddleware('demographic', (req) =>
    `census:dashboard:${req.query.año || CENSUS_DEFAULTS.START_YEAR}:${req.query.distrito || 'all'}`
  ),

  // Controlador
  obtenerDashboardDemografico
);

/**
 * GET /api/v1/censo/distritos/resumen
 * Resumen ligero de distritos con poblacion total.
 * Disenado para metricas cruzadas (per capita) desde otras paginas.
 */
router.get('/distritos/resumen',
  authenticate,

  query('año')
    .optional()
    .isInt({ min: ROUTE_SPECIFIC_LIMITS.CENSUS.YEAR_MIN, max: ROUTE_SPECIFIC_LIMITS.CENSUS.YEAR_MAX })
    .withMessage(`Año debe estar entre ${ROUTE_SPECIFIC_LIMITS.CENSUS.YEAR_MIN} y ${ROUTE_SPECIFIC_LIMITS.CENSUS.YEAR_MAX}`)
    .toInt(),

  query('mes')
    .optional()
    .isInt({ min: ROUTE_SPECIFIC_LIMITS.CENSUS.MONTH_MIN, max: ROUTE_SPECIFIC_LIMITS.CENSUS.MONTH_MAX })
    .withMessage(`Mes debe estar entre ${ROUTE_SPECIFIC_LIMITS.CENSUS.MONTH_MIN} y ${ROUTE_SPECIFIC_LIMITS.CENSUS.MONTH_MAX}`)
    .toInt(),

  validateRequest,

  // Cache largo (1h) - datos muy estables
  cacheMiddleware('demographic', (req) =>
    `census:distritos:resumen:${req.query.año || 'default'}:${req.query.mes || 'all'}`
  ),

  obtenerResumenDistritos
);

module.exports = router;
