/**
 * Rutas de Accidentalidad
 *
 * Define todas las rutas relacionadas con la gestión y consulta de datos de accidentes.
 * Incluye middlewares de autenticación, validación y limitación de velocidad.
 */

const express = require('express');
const rateLimit = require('express-rate-limit');
const { query } = require('express-validator');
const {
  SEVERITY_LEVELS,
  USER_ROLES,
  RATE_LIMITS,
  DATE_RANGE_LIMITS,
  ROUTE_SPECIFIC_LIMITS,
  HTTP_STATUS
} = require('../constants');

const accidentController = require('../controllers/accidentController');
const { authenticate } = require('../middleware/auth');
const { validateRequest } = require('../middleware/security');
const { cacheMiddleware } = require('../middleware/cache');
const { performanceMonitor } = require('../middleware/performanceMonitor');
const { etagMiddleware } = require('../middleware/etag');
const { createForbiddenResponse } = require('../utils/responseHelper');
const logger = require('../config/logger');
const {
  validateDateRange,
  validateDistrictQuery,
  validateExportFormat,
  validatePagination,
  validateAccidentFilters,
  validateFileNumber
} = require('../middleware/validation');


const router = express.Router();

// Aplicar performanceMonitor a todas las rutas de accidentes
router.use(performanceMonitor);

/**
 * Limitadores de velocidad específicos
 */

// Para consultas generales
const generalLimit = rateLimit({
  windowMs: RATE_LIMITS.GENERAL.WINDOW_MS,
  max: RATE_LIMITS.GENERAL.MAX_REQUESTS,
  message: {
    error: 'Demasiadas consultas de accidentalidad. Intente nuevamente en 15 minutos.',
    retryAfter: RATE_LIMITS.GENERAL.RETRY_AFTER
  },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    return req.user && req.user.role === USER_ROLES.ADMIN;
  }
});

// Para mapas de calor y análisis pesados
const heavyAnalysisLimit = rateLimit({
  windowMs: RATE_LIMITS.HEAVY_QUERY.WINDOW_MS,
  max: RATE_LIMITS.ACCIDENTS.HEATMAP_MAX,
  message: {
    error: 'Demasiadas consultas de análisis intensivo. Intente nuevamente en 5 minutos.',
    retryAfter: RATE_LIMITS.HEAVY_QUERY.RETRY_AFTER
  }
});

// Para exportaciones
const exportLimit = rateLimit({
  windowMs: RATE_LIMITS.EXPORT.WINDOW_MS,
  max: RATE_LIMITS.ACCIDENTS.EXPORT_MAX,
  message: {
    error: 'Límite de exportaciones de accidentes alcanzado. Intente nuevamente en 1 hora.',
    retryAfter: RATE_LIMITS.EXPORT.RETRY_AFTER
  }
});

/**
 * RUTAS PRINCIPALES
 */

/**
 * @route   GET /api/v1/accidents
 * @desc    Obtener datos de accidentalidad con filtros avanzados
 * @access  Private (requiere autenticación)
 * @rateLimit 100 requests por 15 minutos
 * @query   {string} startDate - Fecha de inicio (ISO8601)
 * @query   {string} endDate - Fecha de fin (ISO8601)
 * @query   {string} tipoAccidente - Tipo de accidente
 * @query   {string} gravedad - Gravedad del accidente
 * @query   {number} page - Página (defecto: 1)
 * @query   {number} limit - Elementos por página (defecto: 50, max: 100)
 */
router.get('/',
  generalLimit,
  authenticate,
  validateDateRange(DATE_RANGE_LIMITS.ACCIDENTS_MAX_DAYS),
  validatePagination,
  validateAccidentFilters,
  cacheMiddleware('statistics', (req) => `accidents:list:${JSON.stringify(req.query)}`),
  accidentController.getAllAccidents
);

/**
 * @route   GET /api/accidents/expediente/:numero
 * @desc    Obtener accidente específico por número de expediente
 * @access  Private
 * @rateLimit 100 requests per 15 minutes
 */
router.get('/expediente/:numero',
  generalLimit,
  authenticate,
  validateFileNumber,
  accidentController.getAccidentByFileNumber
);

/**
 * @route   GET /api/accidents/stats
 * @desc    Obtener estadísticas generales de accidentalidad
 * @access  Private
 * @rateLimit 100 requests per 15 minutes
 */
router.get('/stats',
  generalLimit,
  authenticate,
  validateDistrictQuery,
  validateDateRange(DATE_RANGE_LIMITS.ACCIDENTS_MAX_DAYS),
  etagMiddleware, // ETags para estadísticas agregadas (datos estables)
  cacheMiddleware('statistics', (req) => `accidents:stats:${JSON.stringify(req.query)}`),
  accidentController.getAccidentStats
);

/**
 * @route   GET /api/accidents/heatmap
 * @desc    Obtener mapa de calor de accidentes
 * @access  Private (requiere rol analyst o admin)
 * @rateLimit 10 requests per 5 minutes
 */
router.get('/heatmap',
  heavyAnalysisLimit,
  authenticate,
  [
    query('gravedad')
      .optional()
      .isIn(Object.values(SEVERITY_LEVELS.ACCIDENT))
      .withMessage(`Gravedad debe ser uno de: ${Object.values(SEVERITY_LEVELS.ACCIDENT).join(', ')}`),

    query('limite')
      .optional()
      .isInt({ min: ROUTE_SPECIFIC_LIMITS.ACCIDENTS.DISTANCE_MIN, max: ROUTE_SPECIFIC_LIMITS.ACCIDENTS.DISTANCE_MAX })
      .withMessage(`Límite debe ser entre ${ROUTE_SPECIFIC_LIMITS.ACCIDENTS.DISTANCE_MIN} y ${ROUTE_SPECIFIC_LIMITS.ACCIDENTS.DISTANCE_MAX}`),

    validateRequest
  ],
  validateDateRange(DATE_RANGE_LIMITS.ACCIDENTS_MAX_DAYS),
  cacheMiddleware('statistics', (req) => `accidents:heatmap:${JSON.stringify(req.query)}`),
  accidentController.getAccidentHeatmap
);

/**
 * @route   GET /api/accidents/safety-analysis
 * @desc    Obtener análisis de seguridad vial por zona
 * @access  Private (requiere rol analyst o admin)
 * @rateLimit 10 requests per 5 minutes
 */
router.get('/safety-analysis',
  heavyAnalysisLimit,
  authenticate,
  validateDistrictQuery,
  validateDateRange(DATE_RANGE_LIMITS.ACCIDENTS_MAX_DAYS),
  cacheMiddleware('statistics', (req) => `accidents:safety:${JSON.stringify(req.query)}`),
  accidentController.getSafetyAnalysis
);

/**
 * @route   GET /api/accidents/district-comparison
 * @desc    Obtener comparativa entre distritos
 * @access  Private
 * @rateLimit 100 requests per 15 minutes
 */
router.get('/district-comparison',
  generalLimit,
  authenticate,
  validateDateRange(DATE_RANGE_LIMITS.ACCIDENTS_MAX_DAYS),
  cacheMiddleware('statistics', (req) => `accidents:district-comp:${JSON.stringify(req.query)}`),
  accidentController.getDistrictComparison
);

/**
 * RUTAS ADMINISTRATIVAS
 */

/**
 * @route   GET /api/accidents/export
 * @desc    Exportar datos de accidentes (solo administradores y analistas)
 * @access  Admin/Analyst only
 * @rateLimit 3 requests per hour
 * @todo    IMPLEMENTAR: Controller de exportación con soporte para CSV/JSON/Excel
 *          - Debe incluir anonimización de datos personales para no-admins
 *          - Debe permitir filtros por fecha, gravedad, tipo de accidente
 *          - Debe generar archivos con formato configurable
 */
router.get('/export',
  exportLimit,
  authenticate,
  validateExportFormat,
  [
    query('includePersonalData')
      .optional()
      .isBoolean()
      .withMessage('includePersonalData debe ser boolean'),

    query('anonymize')
      .optional()
      .isBoolean()
      .withMessage('anonymize debe ser boolean'),

    validateRequest
  ],
  validateDateRange(DATE_RANGE_LIMITS.ACCIDENTS_MAX_DAYS),
  validateAccidentFilters,
  async (req, res, next) => {
    try {
      logger.info({
        userId: req.user.id,
        format: req.query.format || 'json',
        includePersonalData: req.query.includePersonalData === 'true',
        anonymize: req.query.anonymize !== 'false',
        filters: req.query,
        endpoint: 'POST /api/accidents/export'
      }, 'Exportación de datos de accidentes solicitada');

      // Por seguridad, siempre anonimizar para no-admins
      if (req.user.role !== 'admin' && req.query.includePersonalData === 'true') {
        return res.status(HTTP_STATUS.FORBIDDEN).json(createForbiddenResponse('No tiene permisos para exportar datos personales'));
      }

      // TODO: Implementar lógica de exportación con anonimización
      res.status(HTTP_STATUS.NOT_IMPLEMENTED).json({
        success: false,
        message: 'Funcionalidad de exportación en desarrollo'
      });

    } catch (error) {
      next(error);
    }
  }
);

/**
 * Middleware de logging para todas las rutas de accidentes
 */
router.use((req, res, next) => {
  const start = Date.now();

  res.on('finish', () => {
    const duration = Date.now() - start;

    logger.debug({
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      duration: `${duration}ms`,
      userId: req.user?.id,
      query: Object.keys(req.query).length > 0 ? req.query : undefined
    }, 'Consulta de accidentes completada');
  });

  next();
});

/**
 * Manejo de errores específico para rutas de accidentes
 */
router.use((error, req, res, _next) => {
  logger.error({
    error: error.message,
    stack: error.stack,
    path: req.path,
    method: req.method,
    userId: req.user?.id
  }, 'Error en rutas de accidentes');

  // Si el error ya fue manejado, pasarlo al siguiente middleware
  if (error.status || error.statusCode) {
    return res.status(error.status || error.statusCode).json({
      success: false,
      message: error.message
    });
  }

  // Error específico de accidentes
  res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
    success: false,
    message: 'Error interno en el procesamiento de datos de accidentalidad',
    requestId: req.id || Date.now()
  });
});

module.exports = router;
