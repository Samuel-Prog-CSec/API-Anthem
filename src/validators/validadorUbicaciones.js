/**
 * Validadores para endpoints de ubicaciones.
 * Extraidos de `routes/ubicaciones.js`.
 */

const { query, param } = require('express-validator');
const {
  ROUTE_SPECIFIC_LIMITS,
  LOCATION_TYPES,
  MEASUREMENT_POINT_TYPES
} = require('../constants');

const TIPOS_TRANSPORTE_VALIDOS = [
  'todos',
  'cercanias',
  'autobus',
  'interurbano',
  'metro',
  'metro_ligero',
  'taxi'
];

/**
 * GET /api/v1/ubicaciones
 */
const validarObtenerUbicaciones = [
  query('type').optional().isIn(Object.values(LOCATION_TYPES)).withMessage('Tipo de ubicacion no valido'),
  query('distrito').optional().isInt({ min: 1, max: 21 }).withMessage('Distrito debe ser un numero entre 1 y 21'),
  query('nombre')
    .optional()
    .trim()
    .escape()
    .isLength({ min: 2, max: 100 })
    .withMessage('nombre debe tener entre 2 y 100 caracteres'),
  query('limit')
    .optional()
    .isInt({
      min: ROUTE_SPECIFIC_LIMITS.LOCATIONS.LIMIT_MIN,
      max: ROUTE_SPECIFIC_LIMITS.LOCATIONS.LIMIT_MAX
    })
    .withMessage(`El limite debe ser entre ${ROUTE_SPECIFIC_LIMITS.LOCATIONS.LIMIT_MIN} y ${ROUTE_SPECIFIC_LIMITS.LOCATIONS.LIMIT_MAX}`),
  query('page').optional().isInt({ min: 1 }).withMessage('La pagina debe ser mayor a 0'),
  query('bbox')
    .optional()
    .matches(/^-?\d+\.?\d*,-?\d+\.?\d*,-?\d+\.?\d*,-?\d+\.?\d*$/)
    .withMessage('El bounding box debe tener formato: minX,minY,maxX,maxY'),
  query('near')
    .optional()
    .matches(/^-?\d+\.?\d*,-?\d+\.?\d*,\d+$/)
    .withMessage('Proximidad debe tener formato: longitude,latitude,radio_metros (coordenadas GeoJSON WGS84)')
];

/**
 * GET /api/v1/ubicaciones/puntos-medicion/:measurementType
 */
const validarPuntosMedicion = [
  param('measurementType')
    .isIn(Object.values(MEASUREMENT_POINT_TYPES))
    .withMessage('Tipo de medición debe ser: acustica, trafico')
];

/**
 * GET /api/v1/ubicaciones/transporte/:transportType
 */
const validarRutasTransporte = [
  param('transportType')
    .isIn(TIPOS_TRANSPORTE_VALIDOS)
    .withMessage(`Tipo de transporte no valido. Valores permitidos: ${TIPOS_TRANSPORTE_VALIDOS.join(', ')}`)
];

/**
 * GET /api/v1/ubicaciones/mapa
 */
const validarMapaUbicaciones = [
  query('type').optional().isString().withMessage('type debe ser una cadena'),
  query('distrito').optional().isInt({ min: 1, max: 21 }).withMessage('Distrito debe ser un numero entre 1 y 21'),
  query('bbox')
    .optional()
    .matches(/^-?\d+\.?\d*,-?\d+\.?\d*,-?\d+\.?\d*,-?\d+\.?\d*$/)
    .withMessage('bbox debe tener formato: minLng,minLat,maxLng,maxLat (WGS84)')
];

module.exports = {
  validarObtenerUbicaciones,
  validarPuntosMedicion,
  validarRutasTransporte,
  validarMapaUbicaciones
};
