/**
 * Validadores para endpoints de aforo de bicicletas.
 * Extraidos de `routes/aforoBicicletas.js`.
 */

const { param, query, body } = require('express-validator');
const { validarFechaDataset } = require('./validadorFechaDataset');

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
  query('distrito').optional().isString().trim().withMessage('El distrito debe ser una cadena de texto'),
  query('horaMin').optional().isInt({ min: 0, max: 23 }).toInt().withMessage('horaMin debe ser un numero entre 0 y 23'),
  query('horaMax').optional().isInt({ min: 0, max: 23 }).toInt().withMessage('horaMax debe ser un numero entre 0 y 23')
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

/**
 * Reglas de validacion de UNA lectura de aforo de bicicletas (ingesta IoT).
 * @param {string} [p=''] - Prefijo del campo ('' para single, 'lecturas.*.' para lote)
 * @returns {Array} Cadena de validadores express-validator
 */
const reglasIngestaBicicletas = (p = '') => ([
  body(`${p}identificador`).isString().withMessage('identificador debe ser texto').bail()
    .trim().notEmpty().withMessage('identificador es obligatorio')
    .isLength({ max: 100 }).withMessage('identificador demasiado largo'),
  body(`${p}fecha`).exists().withMessage('fecha es obligatoria').bail().custom(validarFechaDataset),
  body(`${p}hora`).isInt({ min: 0, max: 23 }).withMessage('hora debe ser un entero entre 0 y 23'),
  body(`${p}bicicletas`).isInt({ min: 0, max: 1000000 }).withMessage('bicicletas debe ser un entero >= 0'),
  body(`${p}ubicacion`).optional().isObject().withMessage('ubicacion debe ser un objeto'),
  body(`${p}ubicacion.distrito`).optional().isString().trim().isLength({ max: 100 }).withMessage('distrito invalido'),
  body(`${p}ubicacion.nombreVial`).optional().isString().trim().isLength({ max: 200 }).withMessage('nombreVial invalido'),
  body(`${p}ubicacion.numeroDistrito`).optional().isInt({ min: 0, max: 99 }).withMessage('numeroDistrito invalido'),
  body(`${p}ubicacion.coordenadas.latitud`).optional().isFloat({ min: -90, max: 90 }).withMessage('latitud fuera de rango'),
  body(`${p}ubicacion.coordenadas.longitud`).optional().isFloat({ min: -180, max: 180 }).withMessage('longitud fuera de rango')
]);

/** POST /api/v1/aforo-bicicletas/ingesta (una lectura) */
const validarIngestaConteo = reglasIngestaBicicletas('');

/** POST /api/v1/aforo-bicicletas/ingesta/lote (hasta 100 lecturas) */
const validarIngestaLote = [
  body('lecturas').isArray({ min: 1, max: 100 }).withMessage('lecturas debe ser un array de 1 a 100 elementos'),
  ...reglasIngestaBicicletas('lecturas.*.')
];

module.exports = {
  validarObtenerConteos,
  validarDistribucionHoraria,
  validarComparativaEstaciones,
  validarTendenciasDiarias,
  validarDatosEstacion,
  validarIngestaConteo,
  validarIngestaLote
};
