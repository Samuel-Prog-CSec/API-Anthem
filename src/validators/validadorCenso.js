/**
 * Validadores para endpoints de censo demografico.
 *
 * Extraidos de `routes/censo.js`.
 */

const { query } = require('express-validator');
const { ROUTE_SPECIFIC_LIMITS, AGE_GROUPS } = require('../constants');

/**
 * Validaciones comunes para filtros de fecha (con custom para orden).
 */
const dateValidation = [
  query('startDate')
    .optional()
    .isISO8601()
    .withMessage('Fecha de inicio debe ser válida (ISO8601)')
    .toDate(),
  query('endDate')
    .optional()
    .isISO8601()
    .withMessage('Fecha de fin debe ser válida (ISO8601)')
    .toDate()
    .custom((value, { req }) => {
      if (req.query.startDate && value < req.query.startDate) {
        throw new Error('Fecha de fin debe ser posterior a fecha de inicio');
      }
      return true;
    })
];

/**
 * Validaciones de paginacion (offset + sort).
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
      min: ROUTE_SPECIFIC_LIMITS.CENSUS.LIMIT_MIN,
      max: ROUTE_SPECIFIC_LIMITS.CENSUS.LIMIT_MAX
    })
    .withMessage(`Límite debe estar entre ${ROUTE_SPECIFIC_LIMITS.CENSUS.LIMIT_MIN} y ${ROUTE_SPECIFIC_LIMITS.CENSUS.LIMIT_MAX}`)
    .toInt(),
  query('sortBy')
    .optional()
    .isIn([
      'fechaCenso', 'estadisticas.totalPoblacion', 'estadisticas.porcentajeExtranjeros',
      'edad', 'distrito.descripcion', 'barrio.descripcion'
    ])
    .withMessage('Campo de ordenamiento no válido'),
  query('sortOrder').optional().isIn(['asc', 'desc']).withMessage('Orden debe ser asc o desc')
];

/**
 * Validaciones para codigos geograficos (distrito/barrio).
 */
const geographicValidation = [
  query('distrito')
    .optional()
    .custom((value) => {
      const values = Array.isArray(value) ? value : [value];
      return values.every(v => Number.isInteger(parseInt(v, 10)) && parseInt(v, 10) > 0);
    })
    .withMessage('Código de distrito debe ser un número entero positivo'),
  query('barrio')
    .optional()
    .custom((value) => {
      const values = Array.isArray(value) ? value : [value];
      return values.every(v => Number.isInteger(parseInt(v, 10)) && parseInt(v, 10) > 0);
    })
    .withMessage('Código de barrio debe ser un número entero positivo')
];

/**
 * GET /api/v1/censo
 */
const validarDatosCenso = [
  ...dateValidation,
  ...paginationValidation,
  ...geographicValidation,
  query('grupoEdad')
    .optional()
    .custom((value) => {
      const validValues = [...Object.values(AGE_GROUPS)];
      const values = Array.isArray(value) ? value : [value];
      return values.every(v => validValues.includes(v));
    })
    .withMessage('Grupo de edad no válido'),
  query('minEdad')
    .optional()
    .isInt({
      min: ROUTE_SPECIFIC_LIMITS.CENSUS.AGE_MIN,
      max: ROUTE_SPECIFIC_LIMITS.CENSUS.AGE_MAX
    })
    .withMessage(`Edad mínima debe estar entre ${ROUTE_SPECIFIC_LIMITS.CENSUS.AGE_MIN} y ${ROUTE_SPECIFIC_LIMITS.CENSUS.AGE_MAX}`)
    .toInt(),
  query('maxEdad')
    .optional()
    .isInt({
      min: ROUTE_SPECIFIC_LIMITS.CENSUS.AGE_MIN,
      max: ROUTE_SPECIFIC_LIMITS.CENSUS.AGE_MAX
    })
    .withMessage(`Edad máxima debe estar entre ${ROUTE_SPECIFIC_LIMITS.CENSUS.AGE_MIN} y ${ROUTE_SPECIFIC_LIMITS.CENSUS.AGE_MAX}`)
    .toInt()
    .custom((value, { req }) => {
      if (req.query.minEdad && value < req.query.minEdad) {
        throw new Error('Edad máxima debe ser mayor que edad mínima');
      }
      return true;
    }),
  query('minPoblacion')
    .optional()
    .isInt({ min: 0 })
    .withMessage('Población mínima debe ser un número entero positivo')
    .toInt(),
  query('maxPoblacion')
    .optional()
    .isInt({ min: 0 })
    .withMessage('Población máxima debe ser un número entero positivo')
    .toInt()
    .custom((value, { req }) => {
      if (req.query.minPoblacion && value < req.query.minPoblacion) {
        throw new Error('Población máxima debe ser mayor que población mínima');
      }
      return true;
    }),
  query('soloProductivos').optional().isBoolean().withMessage('Solo productivos debe ser true o false').toBoolean(),
  query('soloTerceraEdad').optional().isBoolean().withMessage('Solo tercera edad debe ser true o false').toBoolean(),
  query('includeEstadisticas').optional().isBoolean().withMessage('Incluir estadísticas debe ser true o false').toBoolean()
];

/**
 * GET /api/v1/censo/piramide
 */
const validarPiramidePoblacional = [
  query('distrito')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Código de distrito debe ser un número entero positivo')
    .toInt(),
  query('año')
    .optional()
    .isInt({
      min: ROUTE_SPECIFIC_LIMITS.CENSUS.YEAR_MIN,
      max: ROUTE_SPECIFIC_LIMITS.CENSUS.YEAR_MAX
    })
    .withMessage(`Año debe estar entre ${ROUTE_SPECIFIC_LIMITS.CENSUS.YEAR_MIN} y ${ROUTE_SPECIFIC_LIMITS.CENSUS.YEAR_MAX}`)
    .toInt(),
  query('incluirExtranjeros').optional().isBoolean().withMessage('Incluir extranjeros debe ser true o false').toBoolean()
];

/**
 * GET /api/v1/censo/distritos/estadisticas
 */
const validarEstadisticasDistritos = [
  query('año')
    .optional()
    .isInt({
      min: ROUTE_SPECIFIC_LIMITS.CENSUS.YEAR_MIN,
      max: ROUTE_SPECIFIC_LIMITS.CENSUS.YEAR_MAX
    })
    .withMessage(`Año debe estar entre ${ROUTE_SPECIFIC_LIMITS.CENSUS.YEAR_MIN} y ${ROUTE_SPECIFIC_LIMITS.CENSUS.YEAR_MAX}`)
    .toInt(),
  query('mes')
    .optional()
    .isInt({
      min: ROUTE_SPECIFIC_LIMITS.CENSUS.MONTH_MIN,
      max: ROUTE_SPECIFIC_LIMITS.CENSUS.MONTH_MAX
    })
    .withMessage(`Mes debe estar entre ${ROUTE_SPECIFIC_LIMITS.CENSUS.MONTH_MIN} y ${ROUTE_SPECIFIC_LIMITS.CENSUS.MONTH_MAX}`)
    .toInt(),
  query('incluirBarrios').optional().isBoolean().withMessage('Incluir barrios debe ser true o false').toBoolean()
];

/**
 * GET /api/v1/censo/analisis/demografico
 */
const validarAnalisisDemografico = [
  query('distrito')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Código de distrito debe ser un número entero positivo')
    .toInt(),
  query('año')
    .optional()
    .isInt({
      min: ROUTE_SPECIFIC_LIMITS.CENSUS.YEAR_MIN,
      max: ROUTE_SPECIFIC_LIMITS.CENSUS.YEAR_MAX
    })
    .withMessage(`Año debe estar entre ${ROUTE_SPECIFIC_LIMITS.CENSUS.YEAR_MIN} y ${ROUTE_SPECIFIC_LIMITS.CENSUS.YEAR_MAX}`)
    .toInt(),
  query('tipoAnalisis')
    .optional()
    .isIn(['completo', 'edad', 'nacionalidad', 'genero'])
    .withMessage('Tipo de análisis debe ser completo, edad, nacionalidad o genero')
];

/**
 * GET /api/v1/censo/evolucion
 */
const validarEvolucionDemografica = [
  query('distrito').optional().isInt({ min: 1 }).withMessage('Código de distrito debe ser un número entero positivo').toInt(),
  query('startYear')
    .optional()
    .isInt({
      min: ROUTE_SPECIFIC_LIMITS.CENSUS.YEAR_MIN,
      max: ROUTE_SPECIFIC_LIMITS.CENSUS.YEAR_MAX
    })
    .withMessage(`Año de inicio debe estar entre ${ROUTE_SPECIFIC_LIMITS.CENSUS.YEAR_MIN} y ${ROUTE_SPECIFIC_LIMITS.CENSUS.YEAR_MAX}`)
    .toInt(),
  query('endYear')
    .optional()
    .isInt({
      min: ROUTE_SPECIFIC_LIMITS.CENSUS.YEAR_MIN,
      max: ROUTE_SPECIFIC_LIMITS.CENSUS.YEAR_MAX
    })
    .withMessage(`Año de fin debe estar entre ${ROUTE_SPECIFIC_LIMITS.CENSUS.YEAR_MIN} y ${ROUTE_SPECIFIC_LIMITS.CENSUS.YEAR_MAX}`)
    .toInt()
    .custom((value, { req }) => {
      if (req.query.startYear && value < req.query.startYear) {
        throw new Error('Año de fin debe ser posterior al año de inicio');
      }
      return true;
    }),
  query('metrica')
    .optional()
    .isIn(['poblacionTotal', 'extranjeros', 'productiva'])
    .withMessage('Métrica debe ser poblacionTotal, extranjeros o productiva')
];

/**
 * GET /api/v1/censo/dashboard
 */
const validarDashboardDemografico = [
  query('año')
    .optional()
    .isInt({
      min: ROUTE_SPECIFIC_LIMITS.CENSUS.YEAR_MIN,
      max: ROUTE_SPECIFIC_LIMITS.CENSUS.YEAR_MAX
    })
    .withMessage(`Año debe estar entre ${ROUTE_SPECIFIC_LIMITS.CENSUS.YEAR_MIN} y ${ROUTE_SPECIFIC_LIMITS.CENSUS.YEAR_MAX}`)
    .toInt(),
  // `mes` lo usa el controlador (obtenerDashboardDemografico) en el $match y en
  // la clave de cache; debe validarse para no aceptar valores arbitrarios.
  query('mes')
    .optional()
    .isInt({
      min: ROUTE_SPECIFIC_LIMITS.CENSUS.MONTH_MIN,
      max: ROUTE_SPECIFIC_LIMITS.CENSUS.MONTH_MAX
    })
    .withMessage(`Mes debe estar entre ${ROUTE_SPECIFIC_LIMITS.CENSUS.MONTH_MIN} y ${ROUTE_SPECIFIC_LIMITS.CENSUS.MONTH_MAX}`)
    .toInt(),
  query('distrito')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Código de distrito debe ser un número entero positivo')
    .toInt()
];

/**
 * GET /api/v1/censo/distritos/resumen
 */
const validarResumenDistritos = [
  query('año')
    .optional()
    .isInt({
      min: ROUTE_SPECIFIC_LIMITS.CENSUS.YEAR_MIN,
      max: ROUTE_SPECIFIC_LIMITS.CENSUS.YEAR_MAX
    })
    .withMessage(`Año debe estar entre ${ROUTE_SPECIFIC_LIMITS.CENSUS.YEAR_MIN} y ${ROUTE_SPECIFIC_LIMITS.CENSUS.YEAR_MAX}`)
    .toInt(),
  query('mes')
    .optional()
    .isInt({
      min: ROUTE_SPECIFIC_LIMITS.CENSUS.MONTH_MIN,
      max: ROUTE_SPECIFIC_LIMITS.CENSUS.MONTH_MAX
    })
    .withMessage(`Mes debe estar entre ${ROUTE_SPECIFIC_LIMITS.CENSUS.MONTH_MIN} y ${ROUTE_SPECIFIC_LIMITS.CENSUS.MONTH_MAX}`)
    .toInt()
];

module.exports = {
  validarDatosCenso,
  validarPiramidePoblacional,
  validarEstadisticasDistritos,
  validarAnalisisDemografico,
  validarEvolucionDemografica,
  validarDashboardDemografico,
  validarResumenDistritos,
  dateValidation,
  paginationValidation,
  geographicValidation
};
