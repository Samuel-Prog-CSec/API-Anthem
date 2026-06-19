/**
 * Validadores para endpoints de aforo de bicicletas.
 * Extraidos de `routes/aforoBicicletas.js`.
 */

const { param, query } = require('express-validator');

const filtrosBaseEstacionDistrito = [
  query('identificador').optional().isString().trim().withMessage('El identificador debe ser una cadena de texto'),
  query('distrito').optional().isString().trim().withMessage('El distrito debe ser una cadena de texto'),
  // El frontend deriva estos params del filtro de franja horaria (horaMin/horaMax)
  // y del filtro de mes (startDate/endDate); el controlador los consume pero antes
  // no se validaban (llegaban sin acotar al buildFilters numericRange/dateRange).
  query('horaMin').optional().isInt({ min: 0, max: 23 }).toInt().withMessage('horaMin debe ser un numero entre 0 y 23'),
  query('horaMax').optional().isInt({ min: 0, max: 23 }).toInt().withMessage('horaMax debe ser un numero entre 0 y 23'),
  query('startDate').optional().isISO8601().withMessage('startDate debe ser una fecha ISO 8601 valida'),
  query('endDate').optional().isISO8601().withMessage('endDate debe ser una fecha ISO 8601 valida')
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
