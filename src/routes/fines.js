/**
 * Rutas de Multas
 *
 * Define todos los endpoints relacionados con multas de tráfico.
 * Incluye middleware de validación, autenticación y manejo de errores.
 */

const express = require('express');
const { body, query, param } = require('express-validator');

const {
  getFines,
  getFineById,
  getFinesStatistics,
  getLocationsRanking,
  getTemporalAnalysis,
  getDashboardMetrics
} = require('../controllers/fineController');

const { authenticate } = require('../middleware/auth');
const { validateRequest } = require('../middleware/security');

// Middleware de caché optimizado
const { cacheMiddleware, statsCacheMiddleware, compressionMiddleware } = require('../middleware/cache');

const router = express.Router();

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
      const validValues = ['LEVE', 'GRAVE', 'MUY GRAVE'];
      const values = Array.isArray(value) ? value : [value];
      return values.every(v => validValues.includes(v.toUpperCase()));
    })
    .withMessage('Calificación debe ser LEVE, GRAVE o MUY GRAVE'),

  query('lugar')
    .optional()
    .trim()
    .isLength({ min: 2 })
    .withMessage('Lugar debe tener al menos 2 caracteres'),

  query('tipoInfraccion')
    .optional()
    .custom((value) => {
      const validValues = [
        'VELOCIDAD', 'ESTACIONAMIENTO', 'TELEFONO_MOVIL',
        'SEMAFORO', 'ALCOHOL_DROGAS', 'DOCUMENTACION', 'OTRAS'
      ];
      const values = Array.isArray(value) ? value : [value];
      return values.every(v => validValues.includes(v));
    })
    .withMessage('Tipo de infracción no válido'),

  query('denunciante')
    .optional()
    .trim()
    .isLength({ min: 2 })
    .withMessage('Denunciante debe tener al menos 2 caracteres'),

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

  // Controlador
  getFines
);

/**
 * GET /api/v1/fines/statistics
 * Obtener estadísticas generales de multas
 */
router.get('/statistics',
  // Middleware de autenticación (usuario o admin)
  authenticate,

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
 * Obtener análisis temporal de multas
 */
router.get('/analysis/temporal',
  // Middleware de autenticación
  authenticate,

  // Validaciones
  ...dateValidation,

  query('tipoAnalisis')
    .optional()
    .isIn(['hourly', 'daily', 'monthly', 'yearly'])
    .withMessage('Tipo de análisis debe ser hourly, daily, monthly o yearly'),

  // Middleware de validación
  validateRequest,

  // Middleware de caché (30 minutos para estadísticas)
  cacheMiddleware('statistics', (req) =>
    `fines-temporal-analysis-${req.query.startDate || 'all'}-${req.query.endDate || 'all'}-${req.query.tipoAnalisis || 'monthly'}`
  ),

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

  // Controlador
  getFineById
);

module.exports = router;
