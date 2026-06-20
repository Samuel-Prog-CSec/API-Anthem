/**
 * Validadores para endpoints de ubicaciones.
 * Extraidos de `routes/ubicaciones.js`.
 */

const { query, param, body } = require('express-validator');
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
  query('distrito').optional().isInt({ min: 1, max: 21 }).toInt().withMessage('Distrito debe ser un numero entre 1 y 21'),
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
  query('type').optional().isIn(Object.values(LOCATION_TYPES)).withMessage('Tipo de ubicacion no valido'),
  query('distrito').optional().isInt({ min: 1, max: 21 }).toInt().withMessage('Distrito debe ser un numero entre 1 y 21'),
  query('bbox')
    .optional()
    .matches(/^-?\d+\.?\d*,-?\d+\.?\d*,-?\d+\.?\d*,-?\d+\.?\d*$/)
    .withMessage('bbox debe tener formato: minLng,minLat,maxLng,maxLat (WGS84)')
];

/**
 * Reglas de FORMATO de un nodo de ubicacion (registro IoT). La obligatoriedad
 * condicional (id_punto para trafico, nmt para acustica) se valida aparte.
 * @param {string} [p=''] - Prefijo del campo ('' single, 'nodos.*.' lote)
 * @returns {Array} Cadena de validadores express-validator
 */
const reglasIngestaUbicacion = (p = '') => ([
  body(`${p}tipo`).isString().withMessage('tipo debe ser texto').bail().trim().toLowerCase()
    .isIn(Object.values(LOCATION_TYPES)).withMessage('tipo de ubicacion no valido'),
  body(`${p}nombre`).optional().isString().trim().isLength({ max: 200 }).withMessage('nombre invalido'),
  body(`${p}id_punto`).optional().custom((value) => /^\d+$/.test(String(value))).withMessage('id_punto debe ser numerico'),
  body(`${p}nmt`).optional().custom((value) => /^\d+$/.test(String(value))).withMessage('nmt debe ser numerico'),
  body(`${p}tipo_elem`).optional().isString().trim().toUpperCase().isIn(['URB', 'M30']).withMessage('tipo_elem debe ser URB o M30'),
  body(`${p}distrito`).optional({ nullable: true }).isInt({ min: 1, max: 21 }).withMessage('distrito debe ser un entero entre 1 y 21'),
  body(`${p}distritoNombre`).optional().isString().trim().isLength({ max: 100 }).withMessage('distritoNombre invalido'),
  body(`${p}direccion`).optional().isString().trim().isLength({ max: 300 }).withMessage('direccion invalida'),
  body(`${p}coordenadas.latitud`).optional({ nullable: true }).isFloat({ min: -90, max: 90 }).withMessage('latitud fuera de rango'),
  body(`${p}coordenadas.longitud`).optional({ nullable: true }).isFloat({ min: -180, max: 180 }).withMessage('longitud fuera de rango')
]);

/** Verifica la clave natural segun el tipo (id_punto / nmt). */
const exigeClaveNatural = (nodo) => {
  const tipo = String(nodo && nodo.tipo ? nodo.tipo : '').toLowerCase();
  if (tipo === LOCATION_TYPES.PUNTO_TRAFICO && !/^\d+$/.test(String(nodo.id_punto || ''))) {
    throw new Error('id_punto numerico es obligatorio para tipo punto_trafico');
  }
  if (tipo === LOCATION_TYPES.ESTACION_ACUSTICA && !/^\d+$/.test(String(nodo.nmt || ''))) {
    throw new Error('nmt numerico es obligatorio para tipo estacion_acustica');
  }
  return true;
};

/** POST /api/v1/ubicaciones/ingesta (un nodo) */
const validarIngestaUbicacion = [
  ...reglasIngestaUbicacion(''),
  body().custom((value, { req }) => exigeClaveNatural(req.body))
];

/** POST /api/v1/ubicaciones/ingesta/lote (hasta 100 nodos) */
const validarIngestaLoteUbicaciones = [
  body('nodos').isArray({ min: 1, max: 100 }).withMessage('nodos debe ser un array de 1 a 100 elementos').bail()
    .custom((nodos) => nodos.every(exigeClaveNatural)),
  ...reglasIngestaUbicacion('nodos.*.')
];

module.exports = {
  validarObtenerUbicaciones,
  validarPuntosMedicion,
  validarRutasTransporte,
  validarMapaUbicaciones,
  validarIngestaUbicacion,
  validarIngestaLoteUbicaciones
};
