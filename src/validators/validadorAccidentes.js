/**
 * Validadores para endpoints de accidentes.
 *
 * Los middlewares principales de paginacion/fechas/filtros ya viven en
 * `middleware/validation.js` (compartidos entre dominios). Aqui solo se
 * extraen las cadenas inline `query(...)` que estaban dispersas en
 * `routes/accidentes.js` para los endpoints de mapa y heatmap.
 */

const { query } = require('express-validator');
const { MAP_LIMITS, SEVERITY_LEVELS, TIPOS_VEHICULO } = require('../constants');

/**
 * GET /api/v1/accidentes/mapa-calor
 *
 * Cap de `limite` y `precision` mas conservador que /mapa porque cada punto
 * del heatmap es una agregacion (no documento crudo).
 */
const validarMapaCalorAccidentes = [
  query('limite')
    .optional()
    .isInt({ min: MAP_LIMITS.MIN, max: MAP_LIMITS.HEATMAP_MAX })
    .withMessage(`limite debe estar entre ${MAP_LIMITS.MIN} y ${MAP_LIMITS.HEATMAP_MAX}`),
  query('precision')
    .optional()
    .isInt({ min: 50, max: 500 })
    .withMessage('precision debe estar entre 50 y 500 metros'),
  query('distrito').optional().trim().isLength({ min: 2, max: 100 }).escape(),
  query('gravedad')
    .optional()
    .isIn(Object.values(SEVERITY_LEVELS.ACCIDENT))
    .withMessage('gravedad invalida'),
  query('tipoAccidente').optional().trim().escape(),
  query('tipoVehiculo').optional().isIn(Object.values(TIPOS_VEHICULO)).withMessage('Tipo de vehiculo no valido')
];

/**
 * GET /api/v1/accidentes/mapa
 */
const validarMapaAccidentes = [
  query('limite')
    .optional()
    .isInt({ min: MAP_LIMITS.MIN, max: MAP_LIMITS.DEFAULT_MAX })
    .withMessage(`limite debe estar entre ${MAP_LIMITS.MIN} y ${MAP_LIMITS.DEFAULT_MAX}`),
  query('distrito').optional().trim().isLength({ min: 2, max: 100 }).escape(),
  query('gravedad')
    .optional()
    .isIn(Object.values(SEVERITY_LEVELS.ACCIDENT))
    .withMessage('gravedad invalida'),
  query('tipoAccidente').optional().trim().escape(),
  query('tipoVehiculo').optional().isIn(Object.values(TIPOS_VEHICULO)).withMessage('Tipo de vehiculo no valido'),
  query('bbox')
    .optional()
    .matches(/^-?\d+\.?\d*,-?\d+\.?\d*,-?\d+\.?\d*,-?\d+\.?\d*$/)
    .withMessage('bbox debe ser minLng,minLat,maxLng,maxLat')
];

module.exports = {
  validarMapaCalorAccidentes,
  validarMapaAccidentes
};
