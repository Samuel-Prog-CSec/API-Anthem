/**
 * Validadores para endpoints de contenedores.
 * Extraidos de `routes/contenedores.js`.
 */

const { query, param } = require('express-validator');
const { CONTAINER_TYPES, PAGINATION, ROUTE_SPECIFIC_LIMITS } = require('../constants');

/**
 * GET /api/v1/contenedores/estadisticas/distrito
 */
const validarEstadisticasPorDistrito = [
  query('distrito').optional().trim().notEmpty().withMessage('Distrito no puede estar vacío'),
  query('lote').optional().isInt({ min: 1, max: 3 }).withMessage('Lote debe ser 1, 2 o 3')
];

/**
 * GET /api/v1/contenedores/estadisticas/barrio
 */
const validarEstadisticasPorBarrio = [
  query('distrito').notEmpty().withMessage('Distrito es obligatorio').trim(),
  query('barrio').optional().trim().notEmpty().withMessage('Barrio no puede estar vacío')
];

/**
 * GET /api/v1/contenedores/conteo-por-tipo
 */
const validarConteoPorTipo = [
  query('distrito').notEmpty().withMessage('Distrito es obligatorio').trim(),
  query('barrio').optional().trim().notEmpty().withMessage('Barrio no puede estar vacío')
];

/**
 * GET /api/v1/contenedores/barrios/:distrito
 */
const validarBarriosPorDistrito = [
  param('distrito').trim().notEmpty().withMessage('Distrito no puede estar vacío')
];

/**
 * GET /api/v1/contenedores/buscar
 */
const validarBusquedaContenedores = [
  query('q')
    .notEmpty()
    .withMessage('Parámetro de búsqueda q es obligatorio')
    .trim()
    .isLength({ min: 3 })
    .withMessage('La búsqueda debe tener al menos 3 caracteres'),
  query('limit')
    .optional()
    .isInt({
      min: PAGINATION.MIN_LIMIT,
      max: ROUTE_SPECIFIC_LIMITS.CONTAINERS.SEARCH_MAX_LIMIT
    })
    .withMessage(`Límite debe ser entre ${PAGINATION.MIN_LIMIT} y ${ROUTE_SPECIFIC_LIMITS.CONTAINERS.SEARCH_MAX_LIMIT}`)
];

/**
 * GET /api/v1/contenedores/cobertura
 */
const validarCoberturaContenedores = [
  query('distrito').optional().trim().notEmpty().withMessage('Distrito no puede estar vacío')
];

/**
 * GET /api/v1/contenedores/mapa
 *
 * bbox = minLng,minLat,maxLng,maxLat para limitar por viewport del mapa.
 */
const validarMapaContenedores = [
  query('distrito').optional().trim().notEmpty().withMessage('Distrito no puede estar vacío'),
  query('barrio').optional().trim().notEmpty().withMessage('Barrio no puede estar vacío'),
  query('lote').optional().isInt({ min: 1, max: 3 }).withMessage('Lote debe ser 1, 2 o 3'),
  query('bbox')
    .optional()
    .matches(/^-?\d+(\.\d+)?,-?\d+(\.\d+)?,-?\d+(\.\d+)?,-?\d+(\.\d+)?$/)
    .withMessage('bbox debe tener formato minLng,minLat,maxLng,maxLat')
];

/**
 * GET /api/v1/contenedores/analisis/densidad
 */
const validarAnalisisDensidad = [
  query('distrito').optional().trim().notEmpty().withMessage('Distrito no puede estar vacío'),
  query('tipoContenedor')
    .optional()
    .isIn(Object.values(CONTAINER_TYPES))
    .withMessage(`Tipo de contenedor inválido. Valores permitidos: ${Object.values(CONTAINER_TYPES).join(', ')}`),
  query('includeBarrios').optional().isBoolean().withMessage('includeBarrios debe ser true o false'),
  query('lote').optional().isInt({ min: 1, max: 3 }).withMessage('Lote debe ser 1, 2 o 3')
];

module.exports = {
  validarEstadisticasPorDistrito,
  validarEstadisticasPorBarrio,
  validarConteoPorTipo,
  validarBarriosPorDistrito,
  validarBusquedaContenedores,
  validarCoberturaContenedores,
  validarMapaContenedores,
  validarAnalisisDensidad
};
