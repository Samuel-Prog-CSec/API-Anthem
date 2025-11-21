/**
 * Rutas de Multas
 *
 * Define todos los endpoints relacionados con multas de tráfico.
 * Incluye middleware de validación, autenticación y manejo de errores.
 */

const express = require('express');
const { query, param } = require('express-validator');

const {
  getFines,
  getFineById,
  getFinesStatistics,
  getLocationsRanking,
  getTemporalAnalysis,
  getDashboardMetrics
} = require('../controllers/fineController');

const { authenticate } = require('../middleware/auth');
const { validateRequest, heavyQueryLimiter } = require('../middleware/security');
const { SEVERITY_LEVELS, INFRACTION_TYPES } = require('../constants');
const { performanceMonitor } = require('../middleware/performanceMonitor');
const { etagMiddleware } = require('../middleware/etag');

// Middleware de caché optimizado
const { cacheMiddleware } = require('../middleware/cache');

const router = express.Router();

// Aplicar performanceMonitor a todas las rutas de multas
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
    .isInt({ min: 1, max: 100 })
    .withMessage('Límite debe estar entre 1 y 100')
    .toInt(),
  query('sortBy')
    .optional()
    .isIn(['fecha', 'importeFinal', 'puntosDetraídos', 'lugar', 'calificacion'])
    .withMessage('Campo de ordenamiento no válido'),
  query('sortOrder')
    .optional()
    .isIn(['asc', 'desc'])
    .withMessage('Orden debe ser asc o desc')
];

/**
 * GET /api/v1/fines
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
    .isInt({ min: 0, max: 12 })
    .withMessage('Puntos mínimos debe estar entre 0 y 12')
    .toInt(),

  query('maxPuntos')
    .optional()
    .isInt({ min: 0, max: 12 })
    .withMessage('Puntos máximos debe estar entre 0 y 12')
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
  getFines
);

/**
 * GET /api/v1/fines/statistics
 * Obtener estadísticas agregadas de multas
 */
router.get('/statistics',
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
    .isInt({ min: 1, max: 50 })
    .withMessage('Límite debe estar entre 1 y 50')
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
  getFinesStatistics
);

/**
 * GET /api/v1/fines/locations/ranking
 * Obtener ranking de ubicaciones con más multas
 */
router.get('/locations/ranking',
  // Middleware de autenticación
  authenticate,

  // Validaciones
  ...dateValidation,

  query('limit')
    .optional()
    .isInt({ min: 1, max: 50 })
    .withMessage('Límite debe estar entre 1 y 50')
    .toInt(),

  query('tipoInfraccion')
    .optional()
    .isIn([
      'VELOCIDAD', 'ESTACIONAMIENTO', 'TELEFONO_MOVIL',
      'SEMAFORO', 'ALCOHOL_DROGAS', 'DOCUMENTACION', 'OTRAS'
    ])
    .withMessage('Tipo de infracción no válido'),

  // Middleware de validación
  validateRequest,

  // Middleware de caché (30 minutos para estadísticas)
  cacheMiddleware('statistics', (req) =>
    `fines-locations-ranking-${req.query.startDate || 'all'}-${req.query.endDate || 'all'}-${req.query.limit || 10}-${req.query.tipoInfraccion || 'all'}`
  ),

  // Controlador
  getLocationsRanking
);

/**
 * GET /api/v1/fines/analysis/temporal
 * Análisis temporal de multas con evolución y tendencias
 */
router.get('/analysis/temporal',
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

  // Controlador
  getTemporalAnalysis
);

/**
 * GET /api/v1/fines/dashboard
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

  // Controlador
  getDashboardMetrics
);

/**
 * GET /api/v1/fines/:id
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
  getFineById
);

module.exports = router;
