/**
 * Validadores express-validator para los endpoints de multas.
 *
 * Extraidos desde `routes/multas.js` para mantener las rutas mas legibles
 * y permitir reutilizacion entre endpoints relacionados. Cada export es un
 * array de middlewares que se pasa con spread (`...validarX`) al router.
 */

const { query, param } = require('express-validator');
const {
  SEVERITY_LEVELS,
  INFRACTION_TYPES,
  ROUTE_SPECIFIC_LIMITS,
  SORT_FIELDS,
  DATE_RANGE_LIMITS,
  MAP_LIMITS
} = require('../constants');
const { validateDateRange } = require('../middleware/validation');

/**
 * Validacion de rango de fechas con cap aplicado (FINES_MAX_DAYS).
 * Antes este modulo usaba dateValidation local sin cap, permitiendo queries
 * de varios anos que tumbaban la BD.
 */
const dateValidation = validateDateRange(DATE_RANGE_LIMITS.FINES_MAX_DAYS);

/**
 * Validacion comun para paginacion offset + sort.
 */
const paginationValidation = [
  query('page')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Página debe ser un número entero positivo')
    .toInt(),
  query('limit')
    .optional()
    .isInt({
      min: ROUTE_SPECIFIC_LIMITS.FINES.LIMIT_MIN,
      max: ROUTE_SPECIFIC_LIMITS.FINES.LIMIT_MAX
    })
    .withMessage(`Límite debe estar entre ${ROUTE_SPECIFIC_LIMITS.FINES.LIMIT_MIN} y ${ROUTE_SPECIFIC_LIMITS.FINES.LIMIT_MAX}`)
    .toInt(),
  query('sortBy')
    .optional()
    .isIn(SORT_FIELDS.FINE)
    .withMessage('Campo de ordenamiento no válido'),
  query('sortOrder')
    .optional()
    .isIn(['asc', 'desc'])
    .withMessage('Orden debe ser asc o desc')
];

/**
 * GET /api/v1/multas
 */
const validarObtenerMultas = [
  ...dateValidation,
  ...paginationValidation,
  query('calificacion')
    .optional()
    .custom((value) => {
      const validValues = Object.values(SEVERITY_LEVELS.FINE);
      const values = Array.isArray(value) ? value : [value];
      return values.every(v => validValues.includes(v.toUpperCase()));
    })
    .withMessage(`Calificación debe ser ${Object.values(SEVERITY_LEVELS.FINE).join(', ')}`),
  query('lugar')
    .optional()
    .trim()
    .isLength({ min: 2 })
    .withMessage('Lugar debe tener al menos 2 caracteres')
    .escape(),
  query('tipoInfraccion')
    .optional()
    .custom((value) => {
      const validValues = Object.values(INFRACTION_TYPES);
      const values = Array.isArray(value) ? value : [value];
      return values.every(v => validValues.includes(v));
    })
    .withMessage(`Tipo de infracción debe ser uno de: ${Object.values(INFRACTION_TYPES).join(', ')}`),
  query('denunciante')
    .optional()
    .trim()
    .isLength({ min: 2 })
    .withMessage('Denunciante debe tener al menos 2 caracteres')
    .escape(),
  query('minImporte')
    .optional()
    .isFloat({ min: 0 })
    .withMessage('Importe mínimo debe ser un número positivo')
    .toFloat(),
  query('maxImporte')
    .optional()
    .isFloat({ min: 0 })
    .withMessage('Importe máximo debe ser un número positivo')
    .toFloat(),
  query('minPuntos')
    .optional()
    .isInt({
      min: ROUTE_SPECIFIC_LIMITS.FINES.POINTS_MIN,
      max: ROUTE_SPECIFIC_LIMITS.FINES.POINTS_MAX
    })
    .withMessage(`Puntos mínimos debe estar entre ${ROUTE_SPECIFIC_LIMITS.FINES.POINTS_MIN} y ${ROUTE_SPECIFIC_LIMITS.FINES.POINTS_MAX}`)
    .toInt(),
  query('maxPuntos')
    .optional()
    .isInt({
      min: ROUTE_SPECIFIC_LIMITS.FINES.POINTS_MIN,
      max: ROUTE_SPECIFIC_LIMITS.FINES.POINTS_MAX
    })
    .withMessage(`Puntos máximos debe estar entre ${ROUTE_SPECIFIC_LIMITS.FINES.POINTS_MIN} y ${ROUTE_SPECIFIC_LIMITS.FINES.POINTS_MAX}`)
    .toInt(),
  query('conDescuento')
    .optional()
    .isBoolean()
    .withMessage('Con descuento debe ser true o false')
    .toBoolean(),
  query('esGrave')
    .optional()
    .isBoolean()
    .withMessage('Es grave debe ser true o false')
    .toBoolean(),
  query('includeCoordinates')
    .optional()
    .isBoolean()
    .withMessage('Incluir coordenadas debe ser true o false')
    .toBoolean()
];

/**
 * GET /api/v1/multas/estadisticas
 */
const validarEstadisticasMultas = [
  ...dateValidation,
  query('groupBy')
    .optional()
    .isIn(['day', 'month', 'year', 'type', 'location', 'severity'])
    .withMessage('Agrupación debe ser day, month, year, type, location o severity'),
  query('limit')
    .optional()
    .isInt({
      min: ROUTE_SPECIFIC_LIMITS.FINES.TOP_N_MIN,
      max: ROUTE_SPECIFIC_LIMITS.FINES.TOP_N_MAX
    })
    .withMessage(`Límite debe estar entre ${ROUTE_SPECIFIC_LIMITS.FINES.TOP_N_MIN} y ${ROUTE_SPECIFIC_LIMITS.FINES.TOP_N_MAX}`)
    .toInt()
];

/**
 * GET /api/v1/multas/ubicaciones/ranking
 */
const validarRankingUbicaciones = [
  ...dateValidation,
  query('limit')
    .optional()
    .isInt({
      min: ROUTE_SPECIFIC_LIMITS.FINES.TOP_N_MIN,
      max: ROUTE_SPECIFIC_LIMITS.FINES.TOP_N_MAX
    })
    .withMessage(`Límite debe estar entre ${ROUTE_SPECIFIC_LIMITS.FINES.TOP_N_MIN} y ${ROUTE_SPECIFIC_LIMITS.FINES.TOP_N_MAX}`)
    .toInt(),
  query('tipoInfraccion')
    .optional()
    .isIn(Object.keys(INFRACTION_TYPES))
    .withMessage('Tipo de infracción no válido'),
  query('calificacion')
    .optional()
    .custom((value) => {
      const validValues = Object.values(SEVERITY_LEVELS.FINE);
      const values = Array.isArray(value) ? value : [value];
      return values.every(v => validValues.includes(v.toUpperCase()));
    })
    .withMessage(`Calificación debe ser ${Object.values(SEVERITY_LEVELS.FINE).join(', ')}`),
  query('denunciante')
    .optional()
    .trim()
    .isLength({ min: 2 })
    .withMessage('Denunciante debe tener al menos 2 caracteres')
    .escape(),
  query('tieneDescuento')
    .optional()
    .isBoolean()
    .withMessage('tieneDescuento debe ser true o false')
];

/**
 * GET /api/v1/multas/analisis/temporal
 */
const validarAnalisisTemporal = [
  ...dateValidation,
  query('granularity')
    .optional()
    .isIn(['day', 'week', 'month', 'year'])
    .withMessage('Granularidad debe ser day, week, month o year')
];

/**
 * GET /api/v1/multas/dashboard
 */
const validarMetricasDashboard = [
  ...dateValidation,
  query('periodo')
    .optional()
    .isIn(['7days', '30days', '90days', 'year'])
    .withMessage('Periodo debe ser 7days, 30days, 90days o year'),
  query('calificacion')
    .optional()
    .custom((value) => {
      const validValues = Object.values(SEVERITY_LEVELS.FINE);
      const values = Array.isArray(value) ? value : [value];
      return values.every(v => validValues.includes(v.toUpperCase()));
    })
    .withMessage(`Calificación debe ser ${Object.values(SEVERITY_LEVELS.FINE).join(', ')}`),
  query('denunciante')
    .optional()
    .trim()
    .isLength({ min: 2 })
    .withMessage('Denunciante debe tener al menos 2 caracteres')
    .escape(),
  query('tipoInfraccion')
    .optional()
    .custom((value) => {
      const validValues = Object.values(INFRACTION_TYPES);
      const values = Array.isArray(value) ? value : [value];
      return values.every(v => validValues.includes(v));
    })
    .withMessage(`Tipo de infracción debe ser uno de: ${Object.values(INFRACTION_TYPES).join(', ')}`),
  query('tieneDescuento')
    .optional()
    .isBoolean()
    .withMessage('tieneDescuento debe ser true o false')
];

/**
 * GET /api/v1/multas/mapa
 */
const validarMapaMultas = [
  query('startDate').optional().isISO8601().withMessage('startDate debe ser ISO 8601'),
  query('endDate').optional().isISO8601().withMessage('endDate debe ser ISO 8601'),
  query('calificacion')
    .optional()
    .isIn(Object.values(SEVERITY_LEVELS.FINE))
    .withMessage('calificacion invalida'),
  query('bbox')
    .optional()
    .matches(/^-?\d+\.?\d*,-?\d+\.?\d*,-?\d+\.?\d*,-?\d+\.?\d*$/)
    .withMessage('bbox debe ser minLng,minLat,maxLng,maxLat'),
  // distrito: codigo numerico (1-21) o nombre. El controlador resuelve a bbox
  // via `bboxDeDistrito` para vistas cross-domain "por distrito".
  query('distrito')
    .optional()
    .trim()
    .isLength({ min: 1, max: 50 })
    .matches(/^([1-9]|1[0-9]|2[01])$|^[A-Za-zÑñÁÉÍÓÚáéíóú\s-]{2,50}$/)
    .withMessage('distrito debe ser codigo (1-21) o nombre (max 50 chars)')
    .escape(),
  query('radioKm')
    .optional()
    .isFloat({ min: 1, max: 15 })
    .withMessage('radioKm debe estar entre 1 y 15')
    .toFloat(),
  query('limite')
    .optional()
    .isInt({ min: MAP_LIMITS.MIN, max: MAP_LIMITS.DEFAULT_MAX })
    .withMessage(`limite debe estar entre ${MAP_LIMITS.MIN} y ${MAP_LIMITS.DEFAULT_MAX}`)
];

/**
 * GET /api/v1/multas/:id
 */
const validarMultaPorId = [
  param('id')
    .isMongoId()
    .withMessage('ID de multa debe ser un ObjectId válido')
];

module.exports = {
  validarObtenerMultas,
  validarEstadisticasMultas,
  validarRankingUbicaciones,
  validarAnalisisTemporal,
  validarMetricasDashboard,
  validarMapaMultas,
  validarMultaPorId,
  // Exports auxiliares por si otros modulos quieren reutilizar
  paginationValidation,
  dateValidation
};
