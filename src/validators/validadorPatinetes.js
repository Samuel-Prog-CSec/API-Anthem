/**
 * Validadores para endpoints de patinetes (asignaciones).
 * Extraidos de `routes/patinetes.js`.
 */

const { query, param } = require('express-validator');
const {
  TIPOS_ZONA_PATINETES,
  NIVELES_DENSIDAD_PATINETES,
  NIVELES_DEMANDA_PATINETES,
  CONCENTRACION_MERCADO_PATINETES,
  ROUTE_SPECIFIC_LIMITS,
  SORT_FIELDS
} = require('../constants');
const {
  validateDistrictQuery,
  validateNeighborhoodQuery
} = require('../middleware/validation');

const dateValidation = [
  query('fecha')
    .optional()
    .isISO8601()
    .withMessage('Fecha debe ser válida (ISO8601)')
    .toDate()
    .custom((value) => {
      const now = new Date();
      const maxPastDate = new Date(now.getFullYear() - 5, 0, 1);
      if (value < maxPastDate || value > now) {
        throw new Error('Fecha debe estar dentro de los últimos 5 años');
      }
      return true;
    })
];

const paginationValidation = [
  query('page')
    .optional()
    .isInt({
      min: ROUTE_SPECIFIC_LIMITS.SCOOTER.PAGE_MIN,
      max: ROUTE_SPECIFIC_LIMITS.SCOOTER.PAGE_MAX
    })
    .withMessage(`Página debe ser un número entre ${ROUTE_SPECIFIC_LIMITS.SCOOTER.PAGE_MIN} y ${ROUTE_SPECIFIC_LIMITS.SCOOTER.PAGE_MAX}`)
    .toInt(),
  query('limit')
    .optional()
    .isInt({
      min: ROUTE_SPECIFIC_LIMITS.SCOOTER.LIMIT_MIN,
      max: ROUTE_SPECIFIC_LIMITS.SCOOTER.LIMIT_MAX
    })
    .withMessage(`Límite debe ser un número entre ${ROUTE_SPECIFIC_LIMITS.SCOOTER.LIMIT_MIN} y ${ROUTE_SPECIFIC_LIMITS.SCOOTER.LIMIT_MAX}`)
    .toInt()
];

const sortValidation = [
  query('sortBy').optional().isIn(SORT_FIELDS.SCOOTER_ASSIGNMENT).withMessage('Campo de ordenación no válido'),
  query('sortOrder').optional().isIn(['asc', 'desc']).withMessage('Orden debe ser "asc" o "desc"')
];

const geographicValidation = [...validateDistrictQuery, ...validateNeighborhoodQuery];

const categoryValidation = [
  query('tipoZona').optional().isIn(Object.values(TIPOS_ZONA_PATINETES)).withMessage('Tipo de zona no válido'),
  query('densidad').optional().isIn(Object.values(NIVELES_DENSIDAD_PATINETES)).withMessage('Densidad no válida'),
  query('demanda').optional().isIn(Object.values(NIVELES_DEMANDA_PATINETES)).withMessage('Demanda no válida'),
  query('concentracion').optional().isIn(Object.values(CONCENTRACION_MERCADO_PATINETES)).withMessage('Concentración no válida')
];

const numericValidation = [
  query('minPatinetes')
    .optional()
    .isInt({
      min: ROUTE_SPECIFIC_LIMITS.SCOOTER.PATINETES_MIN,
      max: ROUTE_SPECIFIC_LIMITS.SCOOTER.PATINETES_MAX
    })
    .withMessage(`Mínimo de patinetes debe ser un número entre ${ROUTE_SPECIFIC_LIMITS.SCOOTER.PATINETES_MIN} y ${ROUTE_SPECIFIC_LIMITS.SCOOTER.PATINETES_MAX}`)
    .toInt(),
  query('maxPatinetes')
    .optional()
    .isInt({
      min: ROUTE_SPECIFIC_LIMITS.SCOOTER.PATINETES_MIN,
      max: ROUTE_SPECIFIC_LIMITS.SCOOTER.PATINETES_MAX
    })
    .withMessage(`Máximo de patinetes debe ser un número entre ${ROUTE_SPECIFIC_LIMITS.SCOOTER.PATINETES_MIN} y ${ROUTE_SPECIFIC_LIMITS.SCOOTER.PATINETES_MAX}`)
    .toInt()
    .custom((value, { req }) => {
      if (req.query.minPatinetes && value < parseInt(req.query.minPatinetes, 10)) {
        throw new Error('Máximo de patinetes debe ser mayor al mínimo');
      }
      return true;
    })
];

const providerValidation = [
  query('proveedor')
    .optional()
    .trim()
    .isLength({
      min: ROUTE_SPECIFIC_LIMITS.SCOOTER.PROVIDER_MIN_LENGTH,
      max: ROUTE_SPECIFIC_LIMITS.SCOOTER.PROVIDER_MAX_LENGTH
    })
    .withMessage(`Proveedor debe tener entre ${ROUTE_SPECIFIC_LIMITS.SCOOTER.PROVIDER_MIN_LENGTH} y ${ROUTE_SPECIFIC_LIMITS.SCOOTER.PROVIDER_MAX_LENGTH} caracteres`)
    .matches(/^[a-zA-Z0-9áéíóúüñÁÉÍÓÚÜÑ\s-]+$/)
    .withMessage('Proveedor solo puede contener letras, numeros, espacios y guiones')
    .escape(),
  query('soloProveedoresActivos').optional().isBoolean().withMessage('soloProveedoresActivos debe ser true o false').toBoolean()
];

const paramValidation = [
  param('distrito')
    .notEmpty()
    .withMessage('Distrito es obligatorio')
    .isLength({
      min: ROUTE_SPECIFIC_LIMITS.SCOOTER.DISTRICT_MIN_LENGTH,
      max: ROUTE_SPECIFIC_LIMITS.SCOOTER.DISTRICT_MAX_LENGTH
    })
    .withMessage(`Distrito debe tener entre ${ROUTE_SPECIFIC_LIMITS.SCOOTER.DISTRICT_MIN_LENGTH} y ${ROUTE_SPECIFIC_LIMITS.SCOOTER.DISTRICT_MAX_LENGTH} caracteres`)
    .matches(/^[a-zA-ZáéíóúüñÁÉÍÓÚÜÑ\s-]+$/)
    .withMessage('Distrito solo puede contener letras, espacios y guiones'),
  param('barrio')
    .notEmpty()
    .withMessage('Barrio es obligatorio')
    .isLength({
      min: ROUTE_SPECIFIC_LIMITS.SCOOTER.NEIGHBORHOOD_MIN_LENGTH,
      max: ROUTE_SPECIFIC_LIMITS.SCOOTER.NEIGHBORHOOD_MAX_LENGTH
    })
    .withMessage(`Barrio debe tener entre ${ROUTE_SPECIFIC_LIMITS.SCOOTER.NEIGHBORHOOD_MIN_LENGTH} y ${ROUTE_SPECIFIC_LIMITS.SCOOTER.NEIGHBORHOOD_MAX_LENGTH} caracteres`)
    .matches(/^[a-zA-ZáéíóúüñÁÉÍÓÚÜÑ\s-]+$/)
    .withMessage('Barrio solo puede contener letras, espacios y guiones')
];

/**
 * GET /api/v1/patinetes
 */
const validarAsignacionesPatinetes = [
  ...dateValidation,
  ...paginationValidation,
  ...sortValidation,
  ...geographicValidation,
  ...categoryValidation,
  ...numericValidation,
  ...providerValidation,
  query('includeAnalisis').optional().isBoolean().withMessage('includeAnalisis debe ser true o false').toBoolean()
];

/**
 * GET /api/v1/patinetes/estadisticas/distritos
 */
const validarEstadisticasDistritosPatinetes = [...dateValidation, ...geographicValidation, ...categoryValidation];

/**
 * GET /api/v1/patinetes/analisis-mercado/proveedores
 */
const validarAnalisisMercadoProveedores = [...dateValidation, ...geographicValidation, ...categoryValidation];

/**
 * GET /api/v1/patinetes/zonas-concentracion
 */
const validarZonasConcentracion = [
  ...dateValidation,
  ...geographicValidation,
  ...categoryValidation,
  query('limite')
    .optional()
    .isInt({
      min: ROUTE_SPECIFIC_LIMITS.SCOOTER.TOP_N_MIN,
      max: ROUTE_SPECIFIC_LIMITS.SCOOTER.TOP_N_MAX
    })
    .withMessage(`Límite debe ser un número entre ${ROUTE_SPECIFIC_LIMITS.SCOOTER.TOP_N_MIN} y ${ROUTE_SPECIFIC_LIMITS.SCOOTER.TOP_N_MAX}`)
    .toInt()
];

/**
 * GET /api/v1/patinetes/area/:distrito/:barrio
 */
const validarDetallesArea = [...paramValidation, ...dateValidation];

/**
 * GET /api/v1/patinetes/mapa
 */
const validarMapaPatinetes = [
  ...dateValidation,
  query('distrito').optional().isString().withMessage('distrito debe ser cadena'),
  query('densidad').optional().isIn(Object.values(NIVELES_DENSIDAD_PATINETES)).withMessage('Densidad no válida'),
  query('tipoZona').optional().isIn(Object.values(TIPOS_ZONA_PATINETES)).withMessage('Tipo de zona no válido')
];

module.exports = {
  validarAsignacionesPatinetes,
  validarEstadisticasDistritosPatinetes,
  validarAnalisisMercadoProveedores,
  validarZonasConcentracion,
  validarDetallesArea,
  validarMapaPatinetes,
  dateValidation
};
