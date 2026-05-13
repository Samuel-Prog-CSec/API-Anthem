/**
 * Validadores para endpoints de aforo de bicicletas.
 * Extraidos de `routes/aforoBicicletas.js`.
 */

const { param, query } = require('express-validator');

const filtrosBaseEstacionDistrito = [
  query('identificador').optional().isString().trim().withMessage('El identificador debe ser una cadena de texto'),
  query('distrito').optional().isString().trim().withMessage('El distrito debe ser una cadena de texto')
];

/**
 * GET /api/v1/aforo-bicicletas
 */
const validarObtenerConteos = [
  ...filtrosBaseEstacionDistrito,
  query('hora').optional().isInt({ min: 0, max: 23 }).withMessage('La hora debe ser un numero entre 0 y 23')
];

/**
 * GET /api/v1/aforo-bicicletas/distribucion-horaria
 */
const validarDistribucionHoraria = [...filtrosBaseEstacionDistrito];

/**
 * GET /api/v1/aforo-bicicletas/estaciones
 */
const validarComparativaEstaciones = [
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('El limite debe ser un numero entre 1 y 100'),
  query('distrito').optional().isString().trim().withMessage('El distrito debe ser una cadena de texto')
];

/**
 * GET /api/v1/aforo-bicicletas/tendencias/diario
 */
const validarTendenciasDiarias = [...filtrosBaseEstacionDistrito];

/**
 * GET /api/v1/aforo-bicicletas/estacion/:identificador
 */
const validarDatosEstacion = [
  param('identificador').isString().trim().notEmpty().withMessage('El identificador de estacion es requerido')
];

module.exports = {
  validarObtenerConteos,
  validarDistribucionHoraria,
  validarComparativaEstaciones,
  validarTendenciasDiarias,
  validarDatosEstacion
};
