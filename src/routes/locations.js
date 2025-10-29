const express = require('express');
const { query, param } = require('express-validator');
const {
  getLocations,
  getMeasurementPoints,
  getTransportRoutes,
  getProximityAnalysis
} = require('../controllers/locationController');

// Middleware
const { authenticate } = require('../middleware/auth');
const { validateRequest } = require('../middleware/security');
const { cacheMiddleware } = require('../middleware/cache');

const router = express.Router();

/**
 * @route   GET /api/v0.1/ubicaciones
 * @desc    Obtener todas las ubicaciones con filtros
 * @access  Public
 */
router.get('/',
  cacheMiddleware(),
  [
    query('tipo')
      .optional()
      .isIn(['estacion_acustica', 'punto_trafico', 'ruta_cercanias', 'ruta_autobus', 'ruta_interurbano', 'ruta_metro', 'ruta_metro_ligero', 'zona_taxi'])
      .withMessage('Tipo de ubicación no válido'),
    query('limit')
      .optional()
      .isInt({ min: 1, max: 1000 })
      .withMessage('El límite debe ser entre 1 y 1000'),
    query('page')
      .optional()
      .isInt({ min: 1 })
      .withMessage('La página debe ser mayor a 0'),
    query('bbox')
      .optional()
      .matches(/^-?\d+\.?\d*,-?\d+\.?\d*,-?\d+\.?\d*,-?\d+\.?\d*$/)
      .withMessage('El bounding box debe tener formato: minX,minY,maxX,maxY'),
    query('cerca_de')
      .optional()
      .matches(/^-?\d+\.?\d*,-?\d+\.?\d*,\d+$/)
      .withMessage('Proximidad debe tener formato: x,y,radio_metros')
  ],
  validateRequest,
  getLocations
);

/**
 * @route   GET /api/v0.1/ubicaciones/puntos-medicion/:tipo_medicion
 * @desc    Obtener puntos de medición específicos
 * @access  Public
 */
router.get('/puntos-medicion/:tipo_medicion',
  cacheMiddleware(),
  [
    param('tipo_medicion')
      .isIn(['acustica', 'trafico'])
      .withMessage('Tipo de medición debe ser: acustica, trafico')
  ],
  validateRequest,
  getMeasurementPoints
);

/**
 * @route   GET /api/v0.1/ubicaciones/transporte/:tipo_transporte
 * @desc    Obtener rutas de transporte público
 * @access  Public
 */
router.get('/transporte/:tipo_transporte',
  cacheMiddleware(),
  [
    param('tipo_transporte')
      .isIn(['todos', 'cercanias', 'autobus', 'interurbano', 'metro', 'metro_ligero', 'taxi'])
      .withMessage('Tipo de transporte no válido')
  ],
  validateRequest,
  getTransportRoutes
);

/**
 * @route   GET /api/v0.1/ubicaciones/proximidad
 * @desc    Análisis de proximidad a un punto
 * @access  Public
 */
router.get('/proximidad',
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
    query('radio')
      .optional()
      .isInt({ min: 100, max: 50000 })
      .withMessage('El radio debe estar entre 100 y 50000 metros')
  ],
  validateRequest,
  getProximityAnalysis
);

module.exports = router;
