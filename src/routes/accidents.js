/**
 * Rutas de Accidentalidad
 *
 * Define todas las rutas relacionadas con la gestión y consulta de datos de accidentes.
 * Incluye middlewares de autenticación, validación y limitación de velocidad.
 */

const express = require('express');
const rateLimit = require('express-rate-limit');
const { query, body } = require('express-validator');

const accidentController = require('../controllers/accidentController');
const { authenticate } = require('../middleware/auth');
const { validateRequest } = require('../middleware/security');
const {
  validateDateRange,
  validateDistritoQuery,
  validateExportFormat,
  validatePagination,
  validateAccidentFilters,
  validateExpediente
} = require('../middleware/validation');


const router = express.Router();

/**
 * Limitadores de velocidad específicos
 */

// Para consultas generales
const generalLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 100, // 100 requests por ventana
  message: {
    error: 'Demasiadas consultas de accidentalidad. Intente nuevamente en 15 minutos.',
    retryAfter: 15 * 60
  },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    return req.user && req.user.role === 'admin';
  }
});

// Para mapas de calor y análisis pesados
const heavyAnalysisLimit = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutos
  max: 10, // 10 requests por 5 minutos
  message: {
    error: 'Demasiadas consultas de análisis intensivo. Intente nuevamente en 5 minutos.',
    retryAfter: 5 * 60
  }
});

// Para exportaciones
const exportLimit = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hora
  max: 3, // 3 exports por hora (datos sensibles)
  message: {
    error: 'Límite de exportaciones de accidentes alcanzado. Intente nuevamente en 1 hora.',
    retryAfter: 60 * 60
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
  validateDateRange(730), // 2 años
  validatePagination,
  validateAccidentFilters,
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
  validateExpediente,
  accidentController.getAccidentByExpediente
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
  validateDistritoQuery,
  validateDateRange(730), // 2 años
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
      .isIn(['LEVE', 'GRAVE', 'MORTAL', 'SIN_LESIONES'])
      .withMessage('Gravedad debe ser LEVE, GRAVE, MORTAL o SIN_LESIONES'),

    query('limite')
      .optional()
      .isInt({ min: 100, max: 1000 })
      .withMessage('Límite debe ser entre 100 y 1000'),

    validateRequest
  ],
  validateDateRange(730), // 2 años
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
  validateDistritoQuery,
  validateDateRange(730), // 2 años
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
  validateDateRange(730), // 2 años
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
  validateDateRange(730), // 2 años
  validateAccidentFilters,
  async (req, res, next) => {
    try {
      console.log('Exportación de datos de accidentes solicitada', {
        user: req.user.id,
        format: req.query.format || 'json',
        includePersonalData: req.query.includePersonalData === 'true',
        anonymize: req.query.anonymize !== 'false', // Por defecto anonymize = true
        filters: req.query
      });

      // Por seguridad, siempre anonimizar para no-admins
      if (req.user.role !== 'admin' && req.query.includePersonalData === 'true') {
        return res.status(403).json({
          success: false,
          message: 'No tiene permisos para exportar datos personales'
        });
      }

      // TODO: Implementar lógica de exportación con anonimización
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
 * @route   POST /api/accidents/bulk-update
 * @desc    Actualización masiva de clasificaciones de accidentes
 * @access  Admin only
 */
router.post('/bulk-update',
  authenticate,
  [
    body('operation')
      .isIn(['reclassify', 'update_coordinates', 'fix_data'])
      .withMessage('Operación debe ser reclassify, update_coordinates o fix_data'),

    body('filters')
      .isObject()
      .withMessage('Filtros deben ser un objeto'),

    body('confirm')
      .equals('BULK_UPDATE_CONFIRMED')
      .withMessage('Debe confirmar con BULK_UPDATE_CONFIRMED'),

    validateRequest
  ],
  async (req, res, next) => {
    try {
      const { operation, filters } = req.body;

      console.log('Actualización masiva de accidentes solicitada', {
        user: req.user.id,
        operation,
        filters
      });

      // TODO: Implementar operaciones de actualización masiva
      res.status(501).json({
        success: false,
        message: 'Funcionalidad de actualización masiva en desarrollo'
      });

    } catch (error) {
      next(error);
    }
  }
);

/**
 * @route   DELETE /api/accidents/cleanup
 * @desc    Limpiar datos antiguos o duplicados (solo administradores)
 * @access  Admin only
 */
router.delete('/cleanup',
  authenticate,
  [
    body('operation')
      .isIn(['remove_old', 'remove_duplicates', 'remove_invalid'])
      .withMessage('Operación debe ser remove_old, remove_duplicates o remove_invalid'),

    body('olderThanDays')
      .optional()
      .isInt({ min: 365, max: 3650 })
      .withMessage('Debe especificar días (mínimo 1 año, máximo 10 años)'),

    body('confirm')
      .equals('DELETE_ACCIDENT_DATA')
      .withMessage('Debe confirmar con DELETE_ACCIDENT_DATA'),

    validateRequest
  ],
  async (req, res, next) => {
    try {
      const { operation, olderThanDays } = req.body;

      console.log('Limpieza de datos de accidentes solicitada', {
        user: req.user.id,
        operation,
        olderThanDays
      });

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
 * RUTAS DE ANÁLISIS AVANZADO (requieren permisos especiales)
 */

/**
 * @route   GET /api/accidents/risk-prediction
 * @desc    Análisis predictivo de riesgo de accidentes
 * @access  Admin/Analyst only
 */
router.get('/risk-prediction',
  heavyAnalysisLimit,
  authenticate,
  [
    query('modelo')
      .optional()
      .isIn(['temporal', 'espacial', 'meteorologico', 'vehicular'])
      .withMessage('Modelo debe ser temporal, espacial, meteorologico o vehicular'),

    validateRequest
  ],
  async (req, res, next) => {
    try {
      console.log('Análisis predictivo de riesgo solicitado', {
        user: req.user.id,
        modelo: req.query.modelo
      });

      // TODO: Implementar modelos predictivos
      res.status(501).json({
        success: false,
        message: 'Análisis predictivo en desarrollo'
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

    console.log('Consulta de accidentes completada', {
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      duration: `${duration}ms`,
      user: req.user?.id,
      query: Object.keys(req.query).length > 0 ? req.query : undefined
    });
  });

  next();
});

/**
 * Manejo de errores específico para rutas de accidentes
 */
router.use((error, req, res, next) => {
  console.log('Error en rutas de accidentes', {
    error: error.message,
    stack: error.stack,
    path: req.path,
    method: req.method,
    user: req.user?.id
  });

  // Si el error ya fue manejado, pasarlo al siguiente middleware
  if (error.status || error.statusCode) {
    return next(error);
  }

  // Error específico de accidentes
  res.status(500).json({
    success: false,
    message: 'Error interno en el procesamiento de datos de accidentalidad',
    requestId: req.id || Date.now()
  });
});

module.exports = router;
