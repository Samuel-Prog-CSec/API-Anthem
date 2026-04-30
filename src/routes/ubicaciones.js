const express = require('express');
const rateLimit = require('express-rate-limit');
const { query, param } = require('express-validator');
const {
  obtenerUbicaciones,
  obtenerPuntosMedicion,
  obtenerRutasTransporte,
  obtenerMapaUbicaciones
} = require('../controllers/controladorUbicaciones');

const {
  ROUTE_SPECIFIC_LIMITS,
  RATE_LIMITS,
  LOCATION_TYPES,
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
 * @access  Privado (requiere autenticacion)
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
      .withMessage('Tipo de ubicacion no valido'),
    query('distrito')
      .optional()
      .isInt({ min: 1, max: 21 })
      .withMessage('Distrito debe ser un numero entre 1 y 21'),
    query('nombre')
      .optional()
      .trim()
      .escape()
      .isLength({ min: 2, max: 100 })
      .withMessage('nombre debe tener entre 2 y 100 caracteres'),
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
  obtenerUbicaciones
);

/**
 * @route   GET /api/v1/ubicaciones/puntos-medicion/:measurementType
 * @desc    Obtener puntos de medicion especificos
 * @access  Privado (requiere autenticacion)
 */
router.get('/puntos-medicion/:measurementType',
  locationsLimiter, // Rate limiting permisivo para consultas ligeras
  authenticate, // Requiere autenticación
  cacheMiddleware(),
  [
    param('measurementType')
      .isIn(Object.values(MEASUREMENT_POINT_TYPES))
      .withMessage('Tipo de medición debe ser: acustica, trafico')
  ],
  validateRequest,
  obtenerPuntosMedicion
);

/**
 * @route   GET /api/v1/ubicaciones/transporte/:transportType
 * @desc    Obtener rutas de transporte publico
 * @access  Privado (requiere autenticacion)
 */
router.get('/transporte/:transportType',
  locationsLimiter, // Rate limiting permisivo para consultas ligeras
  authenticate, // Requiere autenticacion
  cacheMiddleware(),
  [
    param('transportType')
      .isIn(['todos', 'cercanias', 'autobus', 'interurbano', 'metro', 'metro_ligero', 'taxi'])
      .withMessage(`Tipo de transporte no valido. Valores permitidos: todos, cercanias, autobus, interurbano, metro, metro_ligero, taxi`)
  ],
  validateRequest,
  obtenerRutasTransporte
);

/**
 * @route   GET /api/v1/ubicaciones/mapa
 * @desc    Obtener ubicaciones como FeatureCollection GeoJSON para mapas
 * @access  Privado (requiere autenticacion)
 */
router.get('/mapa',
  locationsLimiter,
  authenticate,
  etagMiddleware,
  cacheMiddleware(),
  [
    query('type')
      .optional()
      .isString()
      .withMessage('type debe ser una cadena'),
    query('distrito')
      .optional()
      .isInt({ min: 1, max: 21 })
      .withMessage('Distrito debe ser un numero entre 1 y 21'),
    query('bbox')
      .optional()
      .matches(/^-?\d+\.?\d*,-?\d+\.?\d*,-?\d+\.?\d*,-?\d+\.?\d*$/)
      .withMessage('bbox debe tener formato: minLng,minLat,maxLng,maxLat (WGS84)')
  ],
  validateRequest,
  obtenerMapaUbicaciones
);

module.exports = router;
