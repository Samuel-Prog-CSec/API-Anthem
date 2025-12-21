const express = require('express');
const rateLimit = require('express-rate-limit');
const { query, param } = require('express-validator');
const {
  getLocations,
  getMeasurementPoints,
  getTransportRoutes,
  getProximityAnalysis
} = require('../controllers/locationController');

const {
  ROUTE_SPECIFIC_LIMITS,
  RATE_LIMITS,
  LOCATION_TYPES,
  SEARCH_LIMITS,
  MEASUREMENT_POINT_TYPES
} = require('../constants');

// Middleware
const { authenticate } = require('../middleware/auth');
const { validateRequest } = require('../middleware/security');
const { cacheMiddleware } = require('../middleware/cache');
const { performanceMonitor } = require('../middleware/performanceMonitor');
const { etagMiddleware } = require('../middleware/etag');

const router = express.Router();

// Aplicar performanceMonitor a todas las rutas de ubicaciones
router.use(performanceMonitor);

/**
 * Rate limiter para endpoints de ubicaciones
 * Límite permisivo ya que las consultas son ligeras y consumen pocos recursos
 */
const locationsLimiter = rateLimit({
  windowMs: RATE_LIMITS.GENERAL.WINDOW_MS,
  max: RATE_LIMITS.GENERAL.MAX_REQUESTS * 3, // Triple límite (300 req/15min) - consultas muy ligeras
  message: {
    success: false,
    message: 'Demasiadas consultas de ubicaciones, intente nuevamente en 15 minutos'
  },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.user && req.user.role === 'admin' // Admins sin límite
});

/**
 * @route   GET /api/v1/locations
 * @desc    Obtener todas las ubicaciones con filtros
 * @access  Private (requiere autenticación)
 */
router.get('/',
  locationsLimiter, // Rate limiting permisivo para consultas ligeras
  authenticate, // Requiere autenticación
  etagMiddleware, // ETags para datos estáticos de ubicaciones
  cacheMiddleware(),
  [
    query('type')
      .optional()
      .isIn(Object.values(LOCATION_TYPES))
      .withMessage('Type de ubicación no válido'),
    query('limit')
      .optional()
      .isInt({ min: ROUTE_SPECIFIC_LIMITS.LOCATIONS.LIMIT_MIN, max: ROUTE_SPECIFIC_LIMITS.LOCATIONS.LIMIT_MAX })
      .withMessage(`El límite debe ser entre ${ROUTE_SPECIFIC_LIMITS.LOCATIONS.LIMIT_MIN} y ${ROUTE_SPECIFIC_LIMITS.LOCATIONS.LIMIT_MAX}`),
    query('page')
      .optional()
      .isInt({ min: 1 })
      .withMessage('La página debe ser mayor a 0'),
    query('bbox')
      .optional()
      .matches(/^-?\d+\.?\d*,-?\d+\.?\d*,-?\d+\.?\d*,-?\d+\.?\d*$/)
      .withMessage('El bounding box debe tener formato: minX,minY,maxX,maxY'),
    query('near')
      .optional()
      .matches(/^-?\d+\.?\d*,-?\d+\.?\d*,\d+$/)
      .withMessage('Proximidad debe tener formato: x,y,radio_metros')
  ],
  validateRequest,
  getLocations
);

/**
 * @route   GET /api/v1/locations/measurement-points/:measurementType
 * @desc    Obtener puntos de medición específicos
 * @access  Private (requiere autenticación)
 */
router.get('/measurement-points/:measurementType',
  locationsLimiter, // Rate limiting permisivo para consultas ligeras
  authenticate, // Requiere autenticación
  cacheMiddleware(),
  [
    param('measurementType')
      .isIn(Object.values(MEASUREMENT_POINT_TYPES))
      .withMessage('Tipo de medición debe ser: acustica, trafico')
  ],
  validateRequest,
  getMeasurementPoints
);

/**
 * @route   GET /api/v1/locations/transport/:transportType
 * @desc    Obtener rutas de transporte público
 * @access  Private (requiere autenticación)
 */
router.get('/transport/:transportType',
  locationsLimiter, // Rate limiting permisivo para consultas ligeras
  authenticate, // Requiere autenticación
  cacheMiddleware(),
  [
    param('transportType')
      .isIn(['todos', 'cercanias', 'autobus', 'interurbano', 'metro', 'metro_ligero', 'taxi'])
      .withMessage('Tipo de transporte no válido')
  ],
  validateRequest,
  getTransportRoutes
);

/**
 * @route   GET /api/v1/locations/proximity
 * @desc    Análisis de proximidad a un punto
 * @access  Private (requiere autenticación)
 */
router.get('/proximity',
  locationsLimiter, // Rate limiting permisivo para consultas ligeras
  authenticate, // Requiere autenticación
  cacheMiddleware(),
  [
    query('x')
      .notEmpty()
      .isFloat()
      .withMessage('Coordenada X es requerida y debe ser numérica'),
    query('y')
      .notEmpty()
      .isFloat()
      .withMessage('Coordenada Y es requerida y debe ser numérica'),
    query('radius')
      .optional()
      .isInt({ min: ROUTE_SPECIFIC_LIMITS.LOCATIONS.DISTANCE_MIN, max: ROUTE_SPECIFIC_LIMITS.LOCATIONS.DISTANCE_MAX })
      .withMessage(`El radio debe estar entre ${ROUTE_SPECIFIC_LIMITS.LOCATIONS.DISTANCE_MIN} y ${ROUTE_SPECIFIC_LIMITS.LOCATIONS.DISTANCE_MAX} metros`)
  ],
  validateRequest,
  getProximityAnalysis
);

module.exports = router;
