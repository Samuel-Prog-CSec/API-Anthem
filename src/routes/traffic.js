/**
 * Rutas de Tráfico
 *
 * Define todas las rutas relacionadas con la gestión y consulta de datos de tráfico.
 * Incluye middlewares de autenticación, validación y limitación de velocidad.
 */

const express = require('express');
const rateLimit = require('express-rate-limit');
const { query, body, param } = require('express-validator');

const trafficController = require('../controllers/trafficController');
const { authenticate } = require('../middleware/auth');
const { validateRequest } = require('../middleware/security');
const {
  validatePagination,
  validateDateRange,
  validateExportFormat,
  validateTrafficFilters
} = require('../middleware/validation');
const { cacheMiddleware } = require('../middleware/cache');
const logger = require('../config/logger');


const router = express.Router();

/**
 * Limitadores de velocidad específicos para diferentes tipos de consultas
 */

// Para consultas generales (más restrictivo)
const generalLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 100, // 100 requests por ventana
  message: {
    error: 'Demasiadas consultas de tráfico. Intente nuevamente en 15 minutos.',
    retryAfter: 15 * 60
  },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    // Saltear limitación para administradores
    return req.user && req.user.role === 'admin';
  }
});

// Para exportación de datos (muy restrictivo)
const exportLimit = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hora
  max: 5, // 5 exports por hora
  message: {
    error: 'Límite de exportaciones alcanzado. Intente nuevamente en 1 hora.',
    retryAfter: 60 * 60
  }
});

/**
 * RUTAS PRINCIPALES
 */

/**
 * @route   GET /api/traffic
 * @desc    Obtener todas las mediciones de tráfico con filtros
 * @access  Private
 * @rateLimit 100 requests per 15 minutes
 */
router.get('/',
  generalLimit,
  authenticate,
  validateDateRange(365), // 1 año
  validatePagination,
  validateTrafficFilters,
  trafficController.getAllTrafficData
);

/**
 * @route   GET /api/traffic/punto/:id
 * @desc    Obtener datos de tráfico de un punto específico
 * @access  Private
 * @rateLimit 100 requests per 15 minutes
 */
router.get('/punto/:id',
  generalLimit,
  authenticate,
  [
    param('id')
      .matches(/^\d+$/)
      .withMessage('ID de punto debe ser numérico'),

    query('limit')
      .optional()
      .isInt({ min: 1, max: 500 })
      .withMessage('Límite debe ser entre 1 y 500 para consultas de punto'),

    validateRequest
  ],
  validateDateRange(365), // 1 año
  trafficController.getTrafficByPoint
);

/**
 * @route   GET /api/traffic/stats
 * @desc    Obtener estadísticas generales de tráfico
 * @access  Private
 * @rateLimit 100 requests per 15 minutes
 */
router.get('/stats',
  generalLimit,
  authenticate,
  [
    query('tipoElemento')
      .optional()
      .isIn(['URB', 'M-30'])
      .withMessage('Tipo de elemento debe ser URB o M-30'),

    validateRequest
  ],
  validateDateRange(365), // 1 año
  // Caché de 5 minutos para estadísticas de tráfico (datos volátiles)
  cacheMiddleware('traffic', (req) =>
    `traffic-stats-${req.query.startDate || 'all'}-${req.query.endDate || 'all'}-${req.query.tipoElemento || 'all'}`
  ),
  trafficController.getTrafficStats
);

/**
 * @route   GET /api/traffic/congestion-analysis
 * @desc    Obtener análisis de congestión por zonas
 * @access  Private
 * @rateLimit 100 requests per 15 minutes
 */
router.get('/congestion-analysis',
  generalLimit,
  authenticate,
  [
    query('groupBy')
      .optional()
      .isIn(['distrito', 'tipoElemento'])
      .withMessage('Agrupación debe ser por distrito o tipoElemento'),

    validateRequest
  ],
  validateDateRange(365), // 1 año
  // Caché de 5 minutos para análisis de congestión
  cacheMiddleware('traffic', (req) =>
    `traffic-congestion-${req.query.startDate || 'all'}-${req.query.endDate || 'all'}-${req.query.groupBy || 'distrito'}`
  ),
  trafficController.getCongestionAnalysis
);

/**
 * @route   GET /api/traffic/historical
 * @desc    Obtener datos históricos para gráficos
 * @access  Private
 * @rateLimit 100 requests per 15 minutes
 */
router.get('/historical',
  generalLimit,
  authenticate,
  [
    query('aggregation')
      .optional()
      .isIn(['hour', 'day', 'week', 'month'])
      .withMessage('Agregación debe ser hour, day, week o month'),

    query('puntoMedidaId')
      .optional()
      .matches(/^\d+$/)
      .withMessage('ID de punto de medida debe ser numérico'),

    validateRequest
  ],
  validateDateRange(365), // 1 año
  validateTrafficFilters,
  // Caché de 5 minutos para datos históricos
  cacheMiddleware('traffic', (req) =>
    `traffic-historical-${req.query.startDate || 'all'}-${req.query.endDate || 'all'}-${req.query.aggregation || 'hour'}-${req.query.puntoMedidaId || 'all'}-${req.query.tipoElemento || 'all'}`
  ),
  trafficController.getHistoricalData
);

/**
 * RUTAS ADMINISTRATIVAS
 */

/**
 * @route   GET /api/traffic/export
 * @desc    Exportar datos de tráfico (solo administradores)
 * @access  Admin only
 * @rateLimit 5 requests per hour
 */
router.get('/export',
  exportLimit,
  authenticate,
  validateExportFormat,
  [
    query('includeMetadata')
      .optional()
      .isBoolean()
      .withMessage('includeMetadata debe ser boolean'),

    validateRequest
  ],
  validateDateRange(365), // 1 año
  validateTrafficFilters,
  async (req, res, next) => {
    try {
      logger.info({
        userId: req.user.id,
        format: req.query.format || 'json',
        filters: req.query,
        endpoint: 'POST /api/traffic/export'
      }, 'Exportación de datos de tráfico solicitada');

      // TODO: Implementar lógica de exportación
      res.status(501).json({
        success: false,
        message: 'Funcionalidad de exportación en desarrollo'
      });

    } catch (error) {
      next(error);
    }
  }
);

/**
 * @route   DELETE /api/traffic/cleanup
 * @desc    Limpiar datos antiguos de tráfico (solo administradores)
 * @access  Admin only
 */
router.delete('/cleanup',
  authenticate,
  [
    body('olderThanDays')
      .isInt({ min: 30, max: 3650 })
      .withMessage('Debe especificar días (entre 30 y 3650)'),

    body('confirm')
      .equals('DELETE_OLD_DATA')
      .withMessage('Debe confirmar con CONFIRM: DELETE_OLD_DATA'),

    validateRequest
  ],
  async (req, res, next) => {
    try {
      const { olderThanDays } = req.body;

      logger.info({
        userId: req.user.id,
        olderThanDays,
        endpoint: 'DELETE /api/traffic/cleanup'
      }, 'Limpieza de datos de tráfico solicitada');

      // TODO: Implementar lógica de limpieza
      res.status(501).json({
        success: false,
        message: 'Funcionalidad de limpieza en desarrollo'
      });

    } catch (error) {
      next(error);
    }
  }
);

/**
 * Middleware de logging para todas las rutas de tráfico
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
    }, 'Consulta de tráfico completada');
  });

  next();
});

/**
 * Manejo de errores específico para rutas de tráfico
 */
router.use((error, req, res, _next) => {
  logger.error({
    error: error.message,
    stack: error.stack,
    path: req.path,
    method: req.method,
    userId: req.user?.id
  }, 'Error en rutas de tráfico');

  // Si el error ya fue manejado, pasarlo al siguiente middleware
  if (error.status || error.statusCode) {
    return res.status(error.status || error.statusCode).json({
      success: false,
      message: error.message
    });
  }

  // Error específico de tráfico
  res.status(500).json({
    success: false,
    message: 'Error interno en el procesamiento de datos de tráfico',
    requestId: req.id || Date.now()
  });
});

module.exports = router;
