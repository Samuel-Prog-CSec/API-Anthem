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
  MEASUREMENT_POINT_TYPES,
  TRANSPORT_ROUTE_TYPES
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
  authenticate, // Requiere autenticacion
  etagMiddleware, // ETags para datos estaticos de ubicaciones
  cacheMiddleware(),
  [
    query('type')
      .optional()
      .isIn(Object.values(LOCATION_TYPES))
      .withMessage('Type de ubicacion no valido'),
    query('distrito')
      .optional()
      .isInt({ min: 1, max: 21 })
      .withMessage('Distrito debe ser un numero entre 1 y 21'),
    query('limit')
      .optional()
      .isInt({ min: ROUTE_SPECIFIC_LIMITS.LOCATIONS.LIMIT_MIN, max: ROUTE_SPECIFIC_LIMITS.LOCATIONS.LIMIT_MAX })
      .withMessage(`El limite debe ser entre ${ROUTE_SPECIFIC_LIMITS.LOCATIONS.LIMIT_MIN} y ${ROUTE_SPECIFIC_LIMITS.LOCATIONS.LIMIT_MAX}`),
    query('page')
      .optional()
      .isInt({ min: 1 })
      .withMessage('La pagina debe ser mayor a 0'),
    query('bbox')
      .optional()
      .matches(/^-?\d+\.?\d*,-?\d+\.?\d*,-?\d+\.?\d*,-?\d+\.?\d*$/)
      .withMessage('El bounding box debe tener formato: minX,minY,maxX,maxY'),
    query('near')
      .optional()
      .matches(/^-?\d+\.?\d*,-?\d+\.?\d*,\d+$/)
      .withMessage('Proximidad debe tener formato: longitude,latitude,radio_metros (coordenadas GeoJSON WGS84)')
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
 * @desc    Obtener rutas de transporte publico
 * @access  Private (requiere autenticacion)
 */
router.get('/transport/:transportType',
  locationsLimiter, // Rate limiting permisivo para consultas ligeras
  authenticate, // Requiere autenticacion
  cacheMiddleware(),
  [
    param('transportType')
      .isIn(['todos', 'cercanias', 'autobus', 'interurbano', 'metro', 'metro_ligero', 'taxi'])
      .withMessage(`Tipo de transporte no valido. Valores permitidos: todos, cercanias, autobus, interurbano, metro, metro_ligero, taxi`)
  ],
  validateRequest,
  getTransportRoutes
);

/**
 * @route   GET /api/v1/locations/proximity
 * @desc    Analisis de proximidad a un punto (coordenadas GeoJSON WGS84)
 * @access  Private (requiere autenticacion)
 */
router.get('/proximity',
  locationsLimiter, // Rate limiting permisivo para consultas ligeras
  authenticate, // Requiere autenticacion
  cacheMiddleware(),
  [
    query('lon')
      .notEmpty()
      .isFloat({ min: -180, max: 180 })
      .withMessage('Longitud (lon) es requerida y debe estar entre -180 y 180'),
    query('lat')
      .notEmpty()
      .isFloat({ min: -90, max: 90 })
      .withMessage('Latitud (lat) es requerida y debe estar entre -90 y 90'),
    query('radius')
      .optional()
      .isInt({ min: ROUTE_SPECIFIC_LIMITS.LOCATIONS.DISTANCE_MIN, max: ROUTE_SPECIFIC_LIMITS.LOCATIONS.DISTANCE_MAX })
      .withMessage(`El radio debe estar entre ${ROUTE_SPECIFIC_LIMITS.LOCATIONS.DISTANCE_MIN} y ${ROUTE_SPECIFIC_LIMITS.LOCATIONS.DISTANCE_MAX} metros`)
  ],
  validateRequest,
  getProximityAnalysis
);

module.exports = router;
