/**
 * Middleware de Validación de Entrada
 *
 * Proporciona reglas de validación y middleware para endpoints de la API usando express-validator.
 * Asegura la integridad de los datos y previene entrada maliciosa.
 *
 */

const { body, param, query, validationResult } = require('express-validator');

/**
 * Reglas de validación de registro de usuario
 *
 * Valida la entrada de registro de usuario incluyendo nombre de usuario, email, contraseña
 * e información opcional de perfil.
 */
const validateRegistration = [
  body('username')
    .trim()
    .isLength({ min: 3, max: 30 })
    .withMessage('El nombre de usuario debe tener entre 3 y 30 caracteres')
    .matches(/^[a-zA-Z0-9_-]+$/)
    .withMessage('El nombre de usuario solo puede contener letras, números, guiones y guiones bajos')
    .escape()
    .custom(async (value) => {
      // Validación adicional de nombre de usuario
      const forbiddenUsernames = ['admin', 'root', 'api', 'system', 'null', 'undefined'];
      if (forbiddenUsernames.includes(value.toLowerCase())) {
        throw new Error('Este nombre de usuario no está permitido');
      }
      return true;
    }),

  body('email')
    .trim()
    .isEmail()
    .withMessage('Por favor proporciona una dirección de email válida')
    .normalizeEmail()
    .escape()
    .isLength({ max: 155 })
    .withMessage('La dirección de email es demasiado larga'),

  body('password')
    .isLength({ min: 8, max: 64 })
    .withMessage('La contraseña debe tener entre 8 y 64 caracteres')
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]+$/)
    .withMessage('La contraseña debe contener al menos una letra mayúscula, una minúscula, un número y un carácter especial'),
];

/**
 * Reglas de validación de inicio de sesión de usuario
 *
 * Valida las credenciales de inicio de sesión (email/nombre de usuario y contraseña).
 */
const validateLogin = [
  body('identifier')
    .trim()
    .notEmpty()
    .withMessage('Se requiere email o nombre de usuario')
    .isLength({ min: 3, max: 30 })
    .withMessage('El identificador debe tener entre 3 y 30 caracteres')
    .escape(),

  body('password')
    .notEmpty()
    .withMessage('Se requiere contraseña')
    .isLength({ min: 1, max: 64 })
    .withMessage('La contraseña no puede exceder 64 caracteres')
];

/**
 * Reglas de validación de cambio de contraseña
 *
 * Valida las solicitudes de cambio de contraseña.
 */
const validatePasswordChange = [
  body('currentPassword')
    .notEmpty()
    .withMessage('Se requiere la contraseña actual'),

  body('newPassword')
    .isLength({ min: 8, max: 64 })
    .withMessage('La nueva contraseña debe tener entre 8 y 64 caracteres')
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/)
    .withMessage('La nueva contraseña debe contener al menos una letra mayúscula, una minúscula, un número y un carácter especial'),

  body('confirmPassword')
    .custom((value, { req }) => {
      if (value !== req.body.newPassword) {
        throw new Error('La confirmación de contraseña no coincide con la nueva contraseña');
      }
      return true;
    })
];

/**
 * Validación de MongoDB ObjectId
 *
 * Valida parámetros de MongoDB ObjectId.
 */
const validateObjectId = (paramName = 'id') => [
  param(paramName)
    .isMongoId()
    .withMessage(`Formato de ${paramName} inválido`)
];

/**
 * Reglas de validación de paginación
 *
 * Valida los parámetros de query de paginación.
 */
const validatePagination = [
  query('page')
    .optional()
    .isInt({ min: 1, max: 1000 })
    .withMessage('La página debe ser un entero positivo entre 1 y 1000')
    .toInt(),

  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('El límite debe ser un entero positivo entre 1 y 100')
    .toInt(),

  query('sort')
    .optional()
    .isIn(['asc', 'desc', '1', '-1'])
    .withMessage('El orden debe ser asc, desc, 1 o -1'),

  query('sortBy')
    .optional()
    .matches(/^[a-zA-Z][a-zA-Z0-9_]*$/)
    .withMessage('SortBy debe ser un nombre de campo válido')
];

/**
 * Reglas de validación de búsqueda
 *
 * Valida los parámetros de query de búsqueda.
 */
const validateSearch = [
  query('q')
    .optional()
    .trim()
    .isLength({ min: 1, max: 100 })
    .withMessage('La consulta de búsqueda debe tener entre 1 y 100 caracteres')
    .escape(), // Escapar entidades HTML para seguridad

  query('fields')
    .optional()
    .matches(/^[a-zA-Z,_]+$/)
    .withMessage('Fields debe ser nombres de campos separados por comas')
];

/**
 * Middleware de validación de peticiones
 *
 * Procesa los resultados de validación de express-validator y devuelve
 * respuestas de error formateadas correctamente si la validación falla.
 */
const validateRequest = (req, res, next) => {
  const errors = validationResult(req);

  if (!errors.isEmpty()) {
    const formattedErrors = errors.array().map(error => ({
      field: error.path || error.param,
      message: error.msg,
      value: error.value
    }));

    return res.status(400).json({
      success: false,
      message: 'Errores de validación',
      errors: formattedErrors
    });
  }

  next();
};

/**
 * Validación de rango de fechas para consultas
 *
 * Valida fechas de inicio y fin con rango máximo configurable
 * Usado en múltiples controladores (accidentes, tráfico, calidad del aire, etc.)
 */
const validateDateRange = (maxRangeDays = 365) => [
  query('startDate')
    .optional()
    .isISO8601()
    .withMessage('Fecha de inicio debe estar en formato ISO8601')
    .toDate()
    .escape()
    .custom((value, { req }) => {
      if (value && req.query.endDate) {
        const start = new Date(value);
        const end = new Date(req.query.endDate);

        if (start > end) {
          throw new Error('Fecha de inicio debe ser anterior a fecha de fin');
        }

        const maxRange = maxRangeDays * 24 * 60 * 60 * 1000;
        if (end - start > maxRange) {
          throw new Error(`El rango de fechas no puede exceder ${maxRangeDays} días`);
        }
      }
      return true;
    }),

  query('endDate')
    .optional()
    .isISO8601()
    .withMessage('Fecha de fin debe estar en formato ISO8601')
    .toDate()
    .escape()
    .custom((value) => {
      if (value) {
        const endDate = new Date(value);
        const now = new Date();
        if (endDate > now) {
          throw new Error('Fecha de fin no puede ser futura');
        }
      }
      return true;
    })
];

/**
 * Validación de parámetros de consulta comunes
 * Para consultas basadas en distrito, barrio y ubicación
 */
const validateDistrictQuery = [
  query('distrito')
    .optional()
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage('Distrito debe tener entre 2 y 100 caracteres')
    .escape()
];

const validateNeighborhoodQuery = [
  query('barrio')
    .optional()
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage('Barrio debe tener entre 2 y 100 caracteres')
    .escape()
];

/**
 * Validación de formato de exportación
 * Usado por endpoints que soportan exportación de datos
 */
const validateExportFormat = [
  query('format')
    .optional()
    .isIn(['json', 'csv', 'xml'])
    .withMessage('Formato debe ser json, csv o xml')
];

/**
 * Validación de agregación temporal
 * Para agrupación de datos de series temporales
 */
const validateTemporalAggregation = [
  query('groupBy')
    .optional()
    .isIn(['daily', 'weekly', 'monthly', 'yearly'])
    .withMessage('groupBy debe ser: daily, weekly, monthly, o yearly'),

  query('aggregation')
    .optional()
    .isIn(['avg', 'sum', 'min', 'max', 'count'])
    .withMessage('aggregation debe ser: avg, sum, min, max, o count')
];

/**
 * Validaciones específicas de Accidentes
 */
const validateAccidentFilters = [
  ...validateDistrictQuery,

  query('tipoAccidente')
    .optional()
    .isIn([
      'COLISION_DOBLE', 'COLISION_MULTIPLE', 'ALCANCE',
      'CHOQUE_OBSTACULO', 'CHOQUE_OBSTACULO_FIJO',
      'ATROPELLO_PERSONA', 'VUELCO', 'CAIDA',
      'COLISION_FRONTO_LATERAL', 'OTRAS_CAUSAS'
    ])
    .withMessage('Tipo de accidente no válido'),

  query('gravedad')
    .optional()
    .isIn(['LEVE', 'GRAVE', 'MORTAL', 'SIN_LESIONES'])
    .withMessage('Gravedad debe ser LEVE, GRAVE, MORTAL o SIN_LESIONES'),

  query('tipoVehiculo')
    .optional()
    .isIn([
      'TURISMO', 'MOTOCICLETA', 'CICLOMOTOR', 'BICICLETA',
      'AUTOBUS', 'CAMION', 'FURGONETA', 'TAXI', 'AMBULANCIA', 'OTROS'
    ])
    .withMessage('Tipo de vehículo no válido'),

  query('tipoLesion')
    .optional()
    .isIn(['LEVE', 'GRAVE', 'FALLECIDO', 'SIN_ASISTENCIA', 'DESCONOCIDO'])
    .withMessage('Tipo de lesión no válido'),

  query('conAlcohol')
    .optional()
    .isIn(['true', 'false'])
    .withMessage('conAlcohol debe ser true o false'),

  query('conDrogas')
    .optional()
    .isIn(['true', 'false'])
    .withMessage('conDrogas debe ser true o false'),

  query('sortBy')
    .optional()
    .isIn(['fecha', 'gravedad', 'distrito', 'tipoAccidente', 'puntuacionGravedad'])
    .withMessage('Campo de ordenamiento no válido'),

  query('sortOrder')
    .optional()
    .isIn(['asc', 'desc'])
    .withMessage('Orden debe ser asc o desc'),

  validateRequest
];

/**
 * Validación de número de expediente de accidente
 */
const validateFileNumber = [
  param('numero')
    .matches(/^\d{4}S\d{6}$/)
    .withMessage('Formato de expediente inválido. Debe ser AAAASnnnnnn'),

  validateRequest
];

/**
 * Validaciones específicas de Tráfico
 */
const validateTrafficFilters = [
  query('tipoElemento')
    .optional()
    .isIn(['URB', 'M-30', 'urb', 'm-30'])
    .withMessage('Tipo de elemento debe ser URB o M-30'),

  query('nivelCongestion')
    .optional()
    .isIn(['FLUIDO', 'DENSO', 'CONGESTIONADO', 'COLAPSADO'])
    .withMessage('Nivel de congestión no válido'),

  query('calidad')
    .optional()
    .isIn(['ALTA', 'MEDIA', 'BAJA'])
    .withMessage('Calidad debe ser ALTA, MEDIA o BAJA'),

  query('puntoMedidaId')
    .optional()
    .matches(/^\d+$/)
    .withMessage('ID de punto de medida debe ser numérico'),

  query('sortBy')
    .optional()
    .isIn(['fecha', 'intensidad', 'ocupacion', 'carga', 'puntoMedidaId'])
    .withMessage('Campo de ordenamiento no válido'),

  query('sortOrder')
    .optional()
    .isIn(['asc', 'desc'])
    .withMessage('Orden debe ser asc o desc'),

  validateRequest
];

/**
 * Validaciones específicas de Contenedores
 */
const validateContainerType = [
  query('tipoContenedor')
    .optional()
    .isIn(['ORGANICA', 'RESTO', 'ENVASES', 'VIDRIO', 'PAPEL-CARTON'])
    .withMessage('Tipo de contenedor no válido'),
  validateRequest
];

const validateContainerFilters = [
  ...validateDistrictQuery,
  ...validateNeighborhoodQuery,

  query('lote')
    .optional()
    .isInt({ min: 1, max: 3 })
    .withMessage('Lote debe ser 1, 2 o 3'),

  query('sortBy')
    .optional()
    .isIn(['distrito', 'barrio', 'tipoContenedor', 'cantidad', 'lote'])
    .withMessage('Campo de ordenamiento no válido'),

  query('sortOrder')
    .optional()
    .isIn(['asc', 'desc'])
    .withMessage('Orden debe ser asc o desc'),

  validateRequest
];

const validateCoordinates = [
  query('longitude')
    .notEmpty()
    .withMessage('Longitud es obligatoria')
    .isFloat({ min: -180, max: 180 })
    .withMessage('Longitud debe estar entre -180 y 180'),

  query('latitude')
    .notEmpty()
    .withMessage('Latitud es obligatoria')
    .isFloat({ min: -90, max: 90 })
    .withMessage('Latitud debe estar entre -90 y 90'),

  query('maxDistance')
    .optional()
    .isInt({ min: 50, max: 5000 })
    .withMessage('Distancia debe estar entre 50 y 5000 metros'),

  validateRequest
];

/**
 * Validaciones específicas de Bicicletas
 */
const validateBikeFilters = [
  query('sortBy')
    .optional()
    .isIn(['dia', 'totalUsos', 'mediaBicicletasDisponibles', 'tasaOcupacion'])
    .withMessage('Campo de ordenamiento no válido'),

  query('sortOrder')
    .optional()
    .isIn(['asc', 'desc'])
    .withMessage('Orden debe ser asc o desc'),

  validateRequest
];

module.exports = {
  validateRegistration,
  validateLogin,
  validatePasswordChange,
  validateObjectId,
  validatePagination,
  validateSearch,
  validateRequest,
  // Validaciones consolidadas generales
  validateDateRange,
  validateDistrictQuery,
  validateNeighborhoodQuery,
  validateExportFormat,
  validateTemporalAggregation,
  // Validaciones específicas de dominio
  validateAccidentFilters,
  validateFileNumber,
  validateTrafficFilters,
  validateContainerType,
  validateContainerFilters,
  validateCoordinates,
  validateBikeFilters
};

