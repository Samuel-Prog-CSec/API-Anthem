/**
 * Validadores para endpoints de trafico.
 *
 * Extraidos de `routes/trafico.js`. Los chains que ya viven en
 * `middleware/validation.js` (validatePagination, validateTrafficFilters,
 * validateDateRange) se siguen importando desde alli en el archivo de rutas.
 */

const { query, param, body } = require('express-validator');
const { TRAFFIC_ELEMENT_TYPES, ROUTE_SPECIFIC_LIMITS } = require('../constants');
const { validarFechaDataset } = require('./validadorFechaDataset');

/**
 * GET /api/v1/trafico/punto/:id
 */
const validarTraficoPorPunto = [
  param('id')
    .matches(/^\d+$/)
    .withMessage('ID de punto debe ser numérico'),
  query('limit')
    .optional()
    .isInt({ min: 1, max: ROUTE_SPECIFIC_LIMITS.TRAFFIC.PUNTO_MAX_LIMIT })
    .withMessage(`Límite debe ser entre 1 y ${ROUTE_SPECIFIC_LIMITS.TRAFFIC.PUNTO_MAX_LIMIT} para consultas de punto`)
];

/**
 * GET /api/v1/trafico/estadisticas
 */
const validarEstadisticasTrafico = [
  query('tipoElemento')
    .optional()
    .isIn(Object.values(TRAFFIC_ELEMENT_TYPES))
    .withMessage(`Tipo de elemento debe ser ${Object.values(TRAFFIC_ELEMENT_TYPES).join(' o ')}`)
];

/**
 * GET /api/v1/trafico/analisis-congestion
 */
const validarAnalisisCongestion = [
  query('groupBy')
    .optional()
    .isIn(['distrito', 'tipoElemento'])
    .withMessage('Agrupación debe ser por distrito o tipoElemento'),
  query('tipoElemento')
    .optional()
    .isIn(Object.values(TRAFFIC_ELEMENT_TYPES))
    .withMessage(`Tipo de elemento debe ser ${Object.values(TRAFFIC_ELEMENT_TYPES).join(' o ')}`)
];

/**
 * GET /api/v1/trafico/historico
 */
const validarHistoricoTrafico = [
  query('aggregation')
    .optional()
    .isIn(['hour', 'day', 'week', 'month'])
    .withMessage('Agregación debe ser hour, day, week o month'),
  query('puntoMedidaId')
    .optional()
    .matches(/^\d+$/)
    .withMessage('ID de punto de medida debe ser numérico')
];

/**
 * GET /api/v1/trafico/mapa
 *
 * startDate y endDate son OBLIGATORIOS para limitar el coste de la query
 * (la coleccion Traffic supera 24M docs).
 */
const validarMapaTrafico = [
  query('startDate')
    .notEmpty()
    .withMessage('startDate es obligatorio (formato YYYY-MM-DD)')
    .isISO8601()
    .withMessage('startDate debe ser una fecha ISO 8601 valida'),
  query('endDate')
    .notEmpty()
    .withMessage('endDate es obligatorio (formato YYYY-MM-DD)')
    .isISO8601()
    .withMessage('endDate debe ser una fecha ISO 8601 valida'),
  query('tipoElemento')
    .optional()
    .isIn(Object.values(TRAFFIC_ELEMENT_TYPES))
    .withMessage(`tipoElemento debe ser uno de: ${Object.values(TRAFFIC_ELEMENT_TYPES).join(', ')}`),
  query('bbox')
    .optional()
    .matches(/^-?\d+(\.\d+)?,-?\d+(\.\d+)?,-?\d+(\.\d+)?,-?\d+(\.\d+)?$/)
    .withMessage('bbox debe tener formato minLng,minLat,maxLng,maxLat')
];

/**
 * Reglas de validacion de UNA medicion de trafico (ingesta IoT).
 * @param {string} [p=''] - Prefijo del campo ('' single, 'lecturas.*.' lote)
 * @returns {Array} Cadena de validadores express-validator
 */
const reglasIngestaTrafico = (p = '') => ([
  body(`${p}puntoMedidaId`).exists().withMessage('puntoMedidaId es obligatorio').bail()
    .custom((value) => /^\d+$/.test(String(value))).withMessage('puntoMedidaId debe ser numerico (cadena de digitos)'),
  body(`${p}fecha`).exists().withMessage('fecha es obligatoria').bail().custom(validarFechaDataset),
  body(`${p}tipoElemento`).isString().withMessage('tipoElemento debe ser texto').bail().trim().toUpperCase()
    .isIn(Object.values(TRAFFIC_ELEMENT_TYPES)).withMessage('tipoElemento debe ser URB o M30'),
  body(`${p}intensidad`).isInt({ min: 0, max: 10000 }).withMessage('intensidad debe ser un entero entre 0 y 10000'),
  body(`${p}ocupacion`).optional({ nullable: true }).isFloat({ min: 0, max: 100 }).withMessage('ocupacion debe estar entre 0 y 100'),
  body(`${p}carga`).optional({ nullable: true }).isFloat({ min: 0, max: 100 }).withMessage('carga debe estar entre 0 y 100'),
  body(`${p}velocidadMedia`).optional({ nullable: true }).isFloat({ min: 0, max: 300 }).withMessage('velocidadMedia debe estar entre 0 y 300'),
  body(`${p}periodoIntegracion`).optional().isInt({ min: 0, max: 5 }).withMessage('periodoIntegracion debe estar entre 0 y 5'),
  body(`${p}error`).optional().isString().trim().toUpperCase().isIn(['N', 'E', 'S']).withMessage('error debe ser N, E o S')
]);

/** POST /api/v1/trafico/ingesta (una medicion) */
const validarIngestaTrafico = reglasIngestaTrafico('');

/** POST /api/v1/trafico/ingesta/lote (hasta 100 mediciones) */
const validarIngestaLoteTrafico = [
  body('lecturas').isArray({ min: 1, max: 100 }).withMessage('lecturas debe ser un array de 1 a 100 elementos'),
  ...reglasIngestaTrafico('lecturas.*.')
];

module.exports = {
  validarTraficoPorPunto,
  validarEstadisticasTrafico,
  validarAnalisisCongestion,
  validarHistoricoTrafico,
  validarMapaTrafico,
  validarIngestaTrafico,
  validarIngestaLoteTrafico
};
