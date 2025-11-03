/**
 * Rutas de Asignación de Patinetes
 *
 * Define todos los endpoints relacionados con la distribución de patinetes eléctricos.
 * Incluye middleware de validación, autenticación, límites de velocidad y manejo de errores.
 */

const express = require('express');
const { query, param } = require('express-validator');

const {
  getScooterAssignments,
  getDistrictStatistics,
  getProviderMarketAnalysis,
  getConcentrationZones,
  getDistributionDashboard,
  getAreaDetails,
  getOptimizationAnalysis,
  getTemporalComparison
} = require('../controllers/scooterAssignmentController');

const { authenticate } = require('../middleware/auth');
const { validateRequest } = require('../middleware/security');
const { cacheMiddleware } = require('../middleware/cache');
const {
  validateDateRange,
  validateDistritoQuery,
  validateBarrioQuery
} = require('../middleware/validation');

const router = express.Router();

/**
 * Validaciones comunes para filtros de fecha
 */
const dateValidation = [
  query('fecha')
    .optional()
    .isISO8601()
    .withMessage('Fecha debe ser válida (ISO8601)')
    .toDate()
    .custom((value) => {
      const now = new Date();
      const maxPastDate = new Date(now.getFullYear() - 5, 0, 1); // 5 años atrás
      if (value < maxPastDate || value > now) {
        throw new Error('Fecha debe estar dentro de los últimos 5 años');
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
    .isInt({ min: 1, max: 1000 })
    .withMessage('Página debe ser un número entre 1 y 1000')
    .toInt(),
  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('Límite debe ser un número entre 1 y 100')
    .toInt()
];

/**
 * Validaciones para ordenación
 */
const sortValidation = [
  query('sortBy')
    .optional()
    .isIn(['totalPatinetes', 'distrito', 'barrio', 'fecha', 'densidad'])
    .withMessage('Campo de ordenación no válido'),
  query('sortOrder')
    .optional()
    .isIn(['asc', 'desc'])
    .withMessage('Orden debe ser "asc" o "desc"')
];

/**
 * Validaciones para filtros geográficos - usando validadores consolidados
 */
const geographicValidation = [
  ...validateDistritoQuery,
  ...validateBarrioQuery
];

/**
 * Validaciones para filtros de categorías
 */
const categoryValidation = [
  query('tipoZona')
    .optional()
    .isIn(['CENTRO_URBANO', 'ZONA_COMERCIAL', 'ZONA_RESIDENCIAL', 'ZONA_UNIVERSITARIA',
           'ZONA_TURISTICA', 'ZONA_EMPRESARIAL', 'PERIFERIA', 'ZONA_TRANSPORTE'])
    .withMessage('Tipo de zona no válido'),
  query('densidad')
    .optional()
    .isIn(['BAJA', 'MEDIA', 'ALTA', 'MUY_ALTA'])
    .withMessage('Densidad no válida'),
  query('demanda')
    .optional()
    .isIn(['BAJA', 'MEDIA', 'ALTA', 'MUY_ALTA'])
    .withMessage('Demanda no válida'),
  query('concentracion')
    .optional()
    .isIn(['COMPETITIVA', 'MODERADA', 'CONCENTRADA', 'ALTA_CONCENTRACION'])
    .withMessage('Concentración no válida')
];

/**
 * Validaciones para filtros numéricos
 */
const numericValidation = [
  query('minPatinetes')
    .optional()
    .isInt({ min: 0, max: 1000 })
    .withMessage('Mínimo de patinetes debe ser un número entre 0 y 1000')
    .toInt(),
  query('maxPatinetes')
    .optional()
    .isInt({ min: 0, max: 1000 })
    .withMessage('Máximo de patinetes debe ser un número entre 0 y 1000')
    .toInt()
    .custom((value, { req }) => {
      if (req.query.minPatinetes && value < parseInt(req.query.minPatinetes)) {
        throw new Error('Máximo de patinetes debe ser mayor al mínimo');
      }
      return true;
    })
];

/**
 * Validaciones para proveedores
 */
const providerValidation = [
  query('proveedor')
    .optional()
    .isLength({ min: 2, max: 30 })
    .withMessage('Proveedor debe tener entre 2 y 30 caracteres')
    .matches(/^[a-zA-Z0-9s-]+$/)
    .withMessage('Proveedor solo puede contener letras, números, espacios y guiones'),
  query('soloProveedoresActivos')
    .optional()
    .isBoolean()
    .withMessage('soloProveedoresActivos debe ser true o false')
    .toBoolean()
];

/**
 * Validaciones para parámetros de ruta
 */
const paramValidation = [
  param('distrito')
    .notEmpty()
    .withMessage('Distrito es obligatorio')
    .isLength({ min: 2, max: 50 })
    .withMessage('Distrito debe tener entre 2 y 50 caracteres')
    .matches(/^[a-zA-ZáéíóúüñÁÉÍÓÚÜÑs-]+$/)
    .withMessage('Distrito solo puede contener letras, espacios y guiones'),
  param('barrio')
    .notEmpty()
    .withMessage('Barrio es obligatorio')
    .isLength({ min: 2, max: 50 })
    .withMessage('Barrio debe tener entre 2 y 50 caracteres')
    .matches(/^[a-zA-ZáéíóúüñÁÉÍÓÚÜÑs-]+$/)
    .withMessage('Barrio solo puede contener letras, espacios y guiones')
];

/**
 * RUTAS PÚBLICAS (requieren autenticación pero no roles específicos)
 */

/**
 * @route   GET /api/v1/scooter-assignments
 * @desc    Obtener datos de asignación de patinetes con filtros
 * @access  Private
 * @example GET /api/v1/scooter-assignments?distrito=Centro&page=1&limit=20
 */
router.get('/',
  authenticate,
  [
    ...dateValidation,
    ...paginationValidation,
    ...sortValidation,
    ...geographicValidation,
    ...categoryValidation,
    ...numericValidation,
    ...providerValidation,
    query('includeAnalisis')
      .optional()
      .isBoolean()
      .withMessage('includeAnalisis debe ser true o false')
      .toBoolean()
  ],
  validateRequest,
  cacheMiddleware('traffic', (req) => `scooters:list:${JSON.stringify(req.query)}`),
  getScooterAssignments
);

/**
 * @route   GET /api/v1/scooter-assignments/statistics/districts
 * @desc    Obtener estadísticas por distrito
 * @access  Private
 * @example GET /api/v1/scooter-assignments/statistics/districts?fecha=2024-01-15
 */
router.get('/statistics/districts',
  authenticate,
  [
    ...dateValidation
  ],
  validateRequest,
  cacheMiddleware('traffic', (req) => `scooters:stats:districts:${req.query.fecha || 'all'}`),
  getDistrictStatistics
);

/**
 * @route   GET /api/v1/scooter-assignments/market-analysis/providers
 * @desc    Obtener análisis de mercado por proveedor
 * @access  Private
 * @example GET /api/v1/scooter-assignments/market-analysis/providers
 */
router.get('/market-analysis/providers',
  authenticate,
  [
    ...dateValidation
  ],
  validateRequest,
  cacheMiddleware('traffic', (req) => `scooters:market:providers:${req.query.fecha || 'all'}`),
  getProviderMarketAnalysis
);

/**
 * @route   GET /api/v1/scooter-assignments/concentration-zones
 * @desc    Obtener zonas de mayor concentración
 * @access  Private
 * @example GET /api/v1/scooter-assignments/concentration-zones?limite=10
 */
router.get('/concentration-zones',
  authenticate,
  [
    ...dateValidation,
    query('limite')
      .optional()
      .isInt({ min: 1, max: 50 })
      .withMessage('Límite debe ser un número entre 1 y 50')
      .toInt()
  ],
  validateRequest,
  cacheMiddleware('traffic', (req) => `scooters:concentration:${req.query.fecha || 'all'}:${req.query.limite || 10}`),
  getConcentrationZones
);

/**
 * @route   GET /api/v1/scooter-assignments/dashboard
 * @desc    Obtener dashboard completo de distribución
 * @access  Private
 * @example GET /api/v1/scooter-assignments/dashboard?fecha=2024-01-15
 */
router.get('/dashboard',
  authenticate,
  [
    ...dateValidation
  ],
  validateRequest,
  cacheMiddleware('traffic', (req) => `scooters:dashboard:${req.query.fecha || 'all'}`),
  getDistributionDashboard
);

/**
 * @route   GET /api/v1/scooter-assignments/area/:distrito/:barrio
 * @desc    Obtener detalles de un área específica
 * @access  Private
 * @example GET /api/v1/scooter-assignments/area/Centro/Sol?fecha=2024-01-15
 */
router.get('/area/:distrito/:barrio',
  authenticate,
  [
    ...paramValidation,
    ...dateValidation
  ],
  validateRequest,
  cacheMiddleware('traffic', (req) => `scooters:area:${req.params.distrito}:${req.params.barrio}:${req.query.fecha || 'all'}`),
  getAreaDetails
);

/**
 * @route   GET /api/v1/scooter-assignments/optimization-analysis
 * @desc    Obtener análisis de optimización y recomendaciones
 * @access  Private
 * @example GET /api/v1/scooter-assignments/optimization-analysis?fecha=2024-01-15
 */
router.get('/optimization-analysis',
  authenticate,
  [
    ...dateValidation
  ],
  validateRequest,
  cacheMiddleware('traffic', (req) => `scooters:optimization:${req.query.fecha || 'all'}`),
  getOptimizationAnalysis
);

/**
 * @route   GET /api/v1/scooter-assignments/temporal-comparison
 * @desc    Obtener comparativa temporal entre fechas
 * @access  Private
 * @example GET /api/v1/scooter-assignments/temporal-comparison?fechaInicio=2024-01-01&fechaFin=2024-01-31
 */
router.get('/temporal-comparison',
  authenticate,
  validateDateRange(365), // 1 año
  validateDistritoQuery,
  [
    query('agrupacion')
      .optional()
      .isIn(['distrito', 'barrio'])
      .withMessage('Agrupación debe ser "distrito" o "barrio"')
  ],
  validateRequest,
  cacheMiddleware('traffic', (req) => `scooters:temporal:${req.query.fechaInicio}:${req.query.fechaFin}:${req.query.agrupacion || 'distrito'}`),
  getTemporalComparison
);

/**
 * Express 5 Compatibility Note:
 * Se ha eliminado el catch-all local ('*') porque Express 5 requiere nombres de parámetros explícitos.
 * El notFoundHandler global en server.js manejará todas las rutas 404.
 */

module.exports = router;
