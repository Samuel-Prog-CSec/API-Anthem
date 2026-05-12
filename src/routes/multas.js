/**
 * Rutas de Multas
 *
 * Define todos los endpoints relacionados con multas de tráfico.
 * Incluye middleware de validación, autenticación y manejo de errores.
 */

const express = require('express');
const { query, param } = require('express-validator');

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
const {
  SEVERITY_LEVELS, INFRACTION_TYPES, ROUTE_SPECIFIC_LIMITS, SORT_FIELDS,
  DATE_RANGE_LIMITS, MAP_LIMITS
} = require('../constants');
const { validateDateRange } = require('../middleware/validation');
const { performanceMonitor } = require('../middleware/performanceMonitor');
const { etagMiddleware } = require('../middleware/etag');

// Middleware de caché optimizado
const { cacheMiddleware } = require('../middleware/cache');

const router = express.Router();

// Aplicar performanceMonitor a todas las rutas de multas
router.use(performanceMonitor);

/**
 * Validaciones comunes para filtros de fecha.
 * Usa el helper centralizado `validateDateRange(maxDays)` que ademas de
 * verificar formato ISO8601 y orden cronologico aplica un cap de rango maximo
 * (FINES_MAX_DAYS dias). Antes este modulo definia su propio `dateValidation`
 * sin cap, permitiendo queries con rangos de varios anos que tumbaban la BD.
 */
const dateValidation = validateDateRange(DATE_RANGE_LIMITS.FINES_MAX_DAYS);

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
    .isInt({ min: ROUTE_SPECIFIC_LIMITS.FINES.LIMIT_MIN, max: ROUTE_SPECIFIC_LIMITS.FINES.LIMIT_MAX })
    .withMessage(`Límite debe estar entre ${ROUTE_SPECIFIC_LIMITS.FINES.LIMIT_MIN} y ${ROUTE_SPECIFIC_LIMITS.FINES.LIMIT_MAX}`)
    .toInt(),
  query('sortBy')
    .optional()
    .isIn(SORT_FIELDS.FINE)
    .withMessage('Campo de ordenamiento no válido'),
  query('sortOrder')
    .optional()
    .isIn(['asc', 'desc'])
    .withMessage('Orden debe ser asc o desc')
];

/**
 * GET /api/v1/multas
 * Obtener multas con filtros avanzados
 */
router.get('/',
  // Middleware de autenticación
  authenticate,

  // Validaciones
  ...dateValidation,
  ...paginationValidation,

  query('calificacion')
    .optional()
    .custom((value) => {
      const validValues = Object.values(SEVERITY_LEVELS.FINE);
      const values = Array.isArray(value) ? value : [value];
      return values.every(v => validValues.includes(v.toUpperCase()));
    })
    .withMessage(`Calificación debe ser ${Object.values(SEVERITY_LEVELS.FINE).join(', ')}`),

  query('lugar')
    .optional()
    .trim()
    .isLength({ min: 2 })
    .withMessage('Lugar debe tener al menos 2 caracteres')
    .escape(), // Sanitización XSS

  query('tipoInfraccion')
    .optional()
    .custom((value) => {
      const validValues = Object.values(INFRACTION_TYPES);
      const values = Array.isArray(value) ? value : [value];
      return values.every(v => validValues.includes(v));
    })
    .withMessage(`Tipo de infracción debe ser uno de: ${Object.values(INFRACTION_TYPES).join(', ')}`),

  query('denunciante')
    .optional()
    .trim()
    .isLength({ min: 2 })
    .withMessage('Denunciante debe tener al menos 2 caracteres')
    .escape(), // Sanitización XSS

  query('minImporte')
    .optional()
    .isFloat({ min: 0 })
    .withMessage('Importe mínimo debe ser un número positivo')
    .toFloat(),

  query('maxImporte')
    .optional()
    .isFloat({ min: 0 })
    .withMessage('Importe máximo debe ser un número positivo')
    .toFloat(),

  query('minPuntos')
    .optional()
    .isInt({ min: ROUTE_SPECIFIC_LIMITS.FINES.POINTS_MIN, max: ROUTE_SPECIFIC_LIMITS.FINES.POINTS_MAX })
    .withMessage(`Puntos mínimos debe estar entre ${ROUTE_SPECIFIC_LIMITS.FINES.POINTS_MIN} y ${ROUTE_SPECIFIC_LIMITS.FINES.POINTS_MAX}`)
    .toInt(),

  query('maxPuntos')
    .optional()
    .isInt({ min: ROUTE_SPECIFIC_LIMITS.FINES.POINTS_MIN, max: ROUTE_SPECIFIC_LIMITS.FINES.POINTS_MAX })
    .withMessage(`Puntos máximos debe estar entre ${ROUTE_SPECIFIC_LIMITS.FINES.POINTS_MIN} y ${ROUTE_SPECIFIC_LIMITS.FINES.POINTS_MAX}`)
    .toInt(),

  query('conDescuento')
    .optional()
    .isBoolean()
    .withMessage('Con descuento debe ser true o false')
    .toBoolean(),

  query('esGrave')
    .optional()
    .isBoolean()
    .withMessage('Es grave debe ser true o false')
    .toBoolean(),

  query('includeCoordinates')
    .optional()
    .isBoolean()
    .withMessage('Incluir coordenadas debe ser true o false')
    .toBoolean(),

  // Middleware de validación
  validateRequest,

  // Middleware de caché (30 minutos para datos de multas)
  cacheMiddleware('statistics', (req) => `fines:list:${JSON.stringify(req.query)}`),

  // Controlador
  obtenerMultas
);

/**
 * GET /api/v1/multas/estadisticas
 * Obtener estadísticas agregadas de multas
 */
router.get('/estadisticas',
  // Middleware de autenticación (usuario o admin)
  authenticate,

  // Heavy query rate limiter
  heavyQueryLimiter,

  // Validaciones
  ...dateValidation,

  query('groupBy')
    .optional()
    .isIn(['day', 'month', 'year', 'type', 'location', 'severity'])
    .withMessage('Agrupación debe ser day, month, year, type, location o severity'),

  query('limit')
    .optional()
    .isInt({ min: ROUTE_SPECIFIC_LIMITS.FINES.TOP_N_MIN, max: ROUTE_SPECIFIC_LIMITS.FINES.TOP_N_MAX })
    .withMessage(`Límite debe estar entre ${ROUTE_SPECIFIC_LIMITS.FINES.TOP_N_MIN} y ${ROUTE_SPECIFIC_LIMITS.FINES.TOP_N_MAX}`)
    .toInt(),

  // Middleware de validación
  validateRequest,

  // ETags para estadísticas agregadas (datos relativamente estables)
  etagMiddleware,

  // Middleware de caché (30 minutos para estadísticas)
  cacheMiddleware('statistics', (req) =>
    `fines-stats-${req.query.groupBy || 'month'}-${req.query.startDate || 'all'}-${req.query.endDate || 'all'}-${req.query.limit || 12}`
  ),

  // Controlador
  obtenerEstadisticasMultas
);

/**
 * GET /api/v1/multas/ubicaciones/ranking
 * Obtener ranking de ubicaciones con más multas
 */
router.get('/ubicaciones/ranking',
  // Middleware de autenticación
  authenticate,

  // Validaciones
  ...dateValidation,

  query('limit')
    .optional()
    .isInt({ min: ROUTE_SPECIFIC_LIMITS.FINES.TOP_N_MIN, max: ROUTE_SPECIFIC_LIMITS.FINES.TOP_N_MAX })
    .withMessage(`Límite debe estar entre ${ROUTE_SPECIFIC_LIMITS.FINES.TOP_N_MIN} y ${ROUTE_SPECIFIC_LIMITS.FINES.TOP_N_MAX}`)
    .toInt(),

  query('tipoInfraccion')
    .optional()
    .isIn(Object.keys(INFRACTION_TYPES))
    .withMessage('Tipo de infracción no válido'),

  // Middleware de validación
  validateRequest,

  // Middleware de caché (30 minutos para estadísticas)
  cacheMiddleware('statistics', (req) =>
    `fines-locations-ranking-${req.query.startDate || 'all'}-${req.query.endDate || 'all'}-${req.query.limit || 10}-${req.query.tipoInfraccion || 'all'}`
  ),

  // Controlador
  obtenerRankingUbicaciones
);

/**
 * GET /api/v1/multas/analisis/temporal
 * Análisis temporal de multas con evolución y tendencias
 */
router.get('/analisis/temporal',
  // Middleware de autenticación
  authenticate,

  // Heavy query rate limiter
  heavyQueryLimiter,

  // Validaciones
  ...dateValidation,

  query('granularity')
    .optional()
    .isIn(['day', 'week', 'month', 'year'])
    .withMessage('Granularidad debe ser day, week, month o year'),

  // Middleware de validación
  validateRequest,

  // Middleware de caché (30 minutos para análisis temporal)
  cacheMiddleware('statistics', (req) =>
    `fines-temporal-analysis-${req.query.startDate || 'all'}-${req.query.endDate || 'all'}-${req.query.granularity || 'month'}`
  ),

  // Controlador
  obtenerAnalisisTemporal
);

/**
 * GET /api/v1/multas/dashboard
 * Obtener métricas del dashboard principal
 */
router.get('/dashboard',
  // Middleware de autenticación
  authenticate,

  // Heavy query rate limiter
  heavyQueryLimiter,

  // Validaciones
  query('periodo')
    .optional()
    .isIn(['7days', '30days', '90days', 'year'])
    .withMessage('Periodo debe ser 7days, 30days, 90days o year'),

  // Middleware de validación
  validateRequest,

  // Middleware de caché (30 minutos para métricas de dashboard)
  cacheMiddleware('statistics', (req) =>
    `fines-dashboard-${req.query.periodo || '30days'}`
  ),

  // Controlador
  obtenerMetricasDashboard
);

/**
 * GET /api/v1/multas/mapa
 * FeatureCollection GeoJSON con multas georreferenciadas.
 */
router.get('/mapa',
  authenticate,
  [
    query('startDate').optional().isISO8601().withMessage('startDate debe ser ISO 8601'),
    query('endDate').optional().isISO8601().withMessage('endDate debe ser ISO 8601'),
    query('calificacion').optional().isIn(Object.values(SEVERITY_LEVELS.FINE)).withMessage('calificacion invalida'),
    query('bbox').optional().matches(/^-?\d+\.?\d*,-?\d+\.?\d*,-?\d+\.?\d*,-?\d+\.?\d*$/).withMessage('bbox debe ser minLng,minLat,maxLng,maxLat'),
    // distrito: acepta codigo numerico (1-21) o nombre. El controlador
    // se encarga de resolverlo a bbox via `bboxDeDistrito`. Permite vistas
    // cross-domain "por distrito" sin necesitar campo distrito normalizado
    // en la coleccion Multas.
    query('distrito').optional().trim().isLength({ min: 1, max: 50 })
      .matches(/^([1-9]|1[0-9]|2[01])$|^[A-Za-zÑñÁÉÍÓÚáéíóú\s-]{2,50}$/)
      .withMessage('distrito debe ser codigo (1-21) o nombre (max 50 chars)')
      .escape(),
    query('radioKm').optional().isFloat({ min: 1, max: 15 })
      .withMessage('radioKm debe estar entre 1 y 15')
      .toFloat(),
    query('limite').optional().isInt({ min: MAP_LIMITS.MIN, max: MAP_LIMITS.DEFAULT_MAX }).withMessage(`limite debe estar entre ${MAP_LIMITS.MIN} y ${MAP_LIMITS.DEFAULT_MAX}`)
  ],
  validateRequest,
  cacheMiddleware('fines', (req) => `fines:mapa:${JSON.stringify(req.query)}`),
  obtenerMapaMultas
);

/**
 * GET /api/v1/multas/:id
 * Obtener multa por ID con detalles completos
 */
router.get('/:id',
  // Middleware de autenticación
  authenticate,

  // Validaciones
  param('id')
    .isMongoId()
    .withMessage('ID de multa debe ser un ObjectId válido'),

  // Middleware de validación
  validateRequest,

  // Middleware de caché (30 minutos para datos individuales)
  cacheMiddleware('statistics', (req) => `fines:detail:${req.params.id}`),

  // Controlador
  obtenerMultaPorId
);

module.exports = router;
