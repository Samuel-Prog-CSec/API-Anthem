/**
 * Validadores para endpoints de trafico.
 *
 * Extraidos de `routes/trafico.js`. Los chains que ya viven en
 * `middleware/validation.js` (validatePagination, validateTrafficFilters,
 * validateDateRange) se siguen importando desde alli en el archivo de rutas.
 */

const { query, param } = require('express-validator');
const { TRAFFIC_ELEMENT_TYPES, ROUTE_SPECIFIC_LIMITS } = require('../constants');

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
    .withMessage('Agrupación debe ser por distrito o tipoElemento')
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

module.exports = {
  validarTraficoPorPunto,
  validarEstadisticasTrafico,
  validarAnalisisCongestion,
  validarHistoricoTrafico,
  validarMapaTrafico
};
