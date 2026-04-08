/**
 * Middleware de Validación de Entrada
 *
 * Proporciona reglas de validación y middleware para endpoints de la API usando express-validator.
 * Asegura la integridad de los datos y previene entrada maliciosa.
 *
 */

const { body, param, query, validationResult } = require('express-validator');
const {
  HTTP_STATUS,
  SEVERITY_LEVELS,
  TIPOS_ACCIDENTE,
  TIPOS_VEHICULO,
  TIPOS_LESION,
  CONTAINER_TYPES,
  CONGESTION_LEVELS,
  DATA_QUALITY_LEVELS,
  TRAFFIC_ELEMENT_TYPES,
  SORT_FIELDS,
  USER_VALIDATION,
  USER_ROLES,
  PAGINATION,
  SEARCH_LIMITS,
  GEO_LIMITS,
  DATE_RANGE_LIMITS,
  ROUTE_SPECIFIC_LIMITS,
  TOKEN_VALIDATION
} = require('../constants');

/**
 * Reglas de validación de registro de usuario
 *
 * Valida la entrada de registro de usuario incluyendo nombre de usuario, email, contraseña
 * e información opcional de perfil.
 */
const validateRegistration = [
  body('username')
    .trim()
    .isLength({ min: USER_VALIDATION.MIN_USERNAME_LENGTH, max: USER_VALIDATION.MAX_USERNAME_LENGTH })
    .withMessage(`El nombre de usuario debe tener entre ${USER_VALIDATION.MIN_USERNAME_LENGTH} y ${USER_VALIDATION.MAX_USERNAME_LENGTH} caracteres`)
    .matches(USER_VALIDATION.USERNAME_PATTERN)
    .withMessage('El nombre de usuario solo puede contener letras, números, guiones y guiones bajos')
    .escape()
    .custom(async (value) => {
      // Validación adicional de nombre de usuario
      if (USER_VALIDATION.FORBIDDEN_USERNAMES.includes(value.toLowerCase())) {
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
    .isLength({ max: USER_VALIDATION.MAX_EMAIL_LENGTH })
    .withMessage('La dirección de email es demasiado larga'),

  body('password')
    .isLength({ min: USER_VALIDATION.MIN_PASSWORD_LENGTH, max: USER_VALIDATION.MAX_PASSWORD_LENGTH })
    .withMessage(`La contraseña debe tener entre ${USER_VALIDATION.MIN_PASSWORD_LENGTH} y ${USER_VALIDATION.MAX_PASSWORD_LENGTH} caracteres`)
    .matches(USER_VALIDATION.PASSWORD_PATTERN)
    .withMessage('La contraseña debe contener al menos una letra mayúscula, una minúscula, un número y un carácter especial'),

  body('role')
    .optional()
    .isIn(Object.values(USER_ROLES))
    .withMessage('Rol inválido')
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
    .isLength({ min: USER_VALIDATION.MIN_IDENTIFIER_LENGTH, max: USER_VALIDATION.MAX_IDENTIFIER_LENGTH })
    .withMessage(`El identificador debe tener entre ${USER_VALIDATION.MIN_IDENTIFIER_LENGTH} y ${USER_VALIDATION.MAX_IDENTIFIER_LENGTH} caracteres`)
    .escape(),

  body('password')
    .notEmpty()
    .withMessage('Se requiere contraseña')
    .isLength({ min: 1, max: USER_VALIDATION.MAX_PASSWORD_LENGTH })
    .withMessage(`La contraseña no puede exceder ${USER_VALIDATION.MAX_PASSWORD_LENGTH} caracteres`)
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
    .isLength({ min: USER_VALIDATION.MIN_PASSWORD_LENGTH, max: USER_VALIDATION.MAX_PASSWORD_LENGTH })
    .withMessage(`La nueva contraseña debe tener entre ${USER_VALIDATION.MIN_PASSWORD_LENGTH} y ${USER_VALIDATION.MAX_PASSWORD_LENGTH} caracteres`)
    .matches(USER_VALIDATION.PASSWORD_PATTERN)
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

    return res.status(HTTP_STATUS.BAD_REQUEST).json({
      success: false,
      message: 'Errores de validación',
      errors: formattedErrors
    });
  }

  next();
};

const validateRefreshToken = [
  body('refreshToken')
    .custom((value, { req }) => {
      const token = value || req.cookies?.refreshToken;

      if (!token) {
        throw new Error('Refresh token es obligatorio');
      }

      if (token.length > TOKEN_VALIDATION.MAX_TOKEN_LENGTH) {
        throw new Error(`El refresh token no puede exceder ${TOKEN_VALIDATION.MAX_TOKEN_LENGTH} caracteres`);
      }

      if (!TOKEN_VALIDATION.JWT_REGEX.test(token)) {
        throw new Error('Formato de refresh token inválido');
      }

      // Normalizar: exponer el token validado en req para el controlador
      req.validatedRefreshToken = token;
      return true;
    }),
  validateRequest
];

const validateOptionalRefreshToken = [
  body('refreshToken')
    .custom((value, { req }) => {
      const token = value || req.cookies?.refreshToken;

      if (!token) {
        return true; // nada que validar
      }

      if (token.length > TOKEN_VALIDATION.MAX_TOKEN_LENGTH) {
        throw new Error(`El refresh token no puede exceder ${TOKEN_VALIDATION.MAX_TOKEN_LENGTH} caracteres`);
      }

      if (!TOKEN_VALIDATION.JWT_REGEX.test(token)) {
        throw new Error('Formato de refresh token inválido');
      }

      req.validatedRefreshToken = token;
      return true;
    }),
  validateRequest
];

/**
 * Reglas de validación de paginación
 *
 * Valida los parámetros de query de paginación.
 */
const validatePagination = [
  query('page')
    .optional()
    .isInt({ min: 1, max: PAGINATION.MAX_PAGE })
    .withMessage(`La página debe ser un entero positivo entre 1 y ${PAGINATION.MAX_PAGE}`)
    .toInt(),

  query('limit')
    .optional()
    .isInt({ min: PAGINATION.MIN_LIMIT, max: PAGINATION.MAX_LIMIT })
    .withMessage(`El límite debe ser un entero positivo entre ${PAGINATION.MIN_LIMIT} y ${PAGINATION.MAX_LIMIT}`)
    .toInt(),

  query('sort')
    .optional()
    .isIn(['asc', 'desc', '1', '-1'])
    .withMessage('El orden debe ser asc, desc, 1 o -1'),

  query('sortBy')
    .optional()
    .matches(SEARCH_LIMITS.SORTBY_PATTERN)
    .withMessage('SortBy debe ser un nombre de campo válido'),

  validateRequest
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
    .isLength({ min: SEARCH_LIMITS.QUERY_MIN_LENGTH, max: SEARCH_LIMITS.QUERY_MAX_LENGTH })
    .withMessage(`La consulta de búsqueda debe tener entre ${SEARCH_LIMITS.QUERY_MIN_LENGTH} y ${SEARCH_LIMITS.QUERY_MAX_LENGTH} caracteres`)
    .escape(), // Escapar entidades HTML para seguridad

  query('fields')
    .optional()
    .matches(SEARCH_LIMITS.FIELDS_PATTERN)
    .withMessage('Fields debe ser nombres de campos separados por comas')
];

/**
 * Validación de rango de fechas para consultas
 *
 * Valida fechas de inicio y fin con rango máximo configurable
 * Usado en múltiples controladores (accidentes, tráfico, calidad del aire, etc.)
 */
const validateDateRange = (maxRangeDays = DATE_RANGE_LIMITS.DEFAULT_MAX_DAYS) => [
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

        const maxRange = maxRangeDays * DATE_RANGE_LIMITS.MAX_MILLISECONDS_CALCULATION;
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
        // Eliminada validación de fecha futura para permitir datos de 2051
        return true;
      }
      return true;
    }),

  validateRequest
];

/**
 * Validación de parámetros de consulta comunes
 * Para consultas basadas en distrito, barrio y ubicación
 */
const validateDistrictQuery = [
  query('distrito')
    .optional()
    .trim()
    .isLength({ min: SEARCH_LIMITS.DISTRITO_MIN_LENGTH, max: SEARCH_LIMITS.DISTRITO_MAX_LENGTH })
    .withMessage(`Distrito debe tener entre ${SEARCH_LIMITS.DISTRITO_MIN_LENGTH} y ${SEARCH_LIMITS.DISTRITO_MAX_LENGTH} caracteres`)
    .escape()
];

const validateNeighborhoodQuery = [
  query('barrio')
    .optional()
    .trim()
    .isLength({ min: SEARCH_LIMITS.BARRIO_MIN_LENGTH, max: SEARCH_LIMITS.BARRIO_MAX_LENGTH })
    .withMessage(`Barrio debe tener entre ${SEARCH_LIMITS.BARRIO_MIN_LENGTH} y ${SEARCH_LIMITS.BARRIO_MAX_LENGTH} caracteres`)
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
    .trim()
    .isIn(Object.values(TIPOS_ACCIDENTE))
    .withMessage('Tipo de accidente no válido')
    .escape(), // Sanitización XSS

  query('gravedad')
    .optional()
    .trim()
    .isIn(Object.values(SEVERITY_LEVELS.ACCIDENT))
    .withMessage('Gravedad debe ser LEVE, GRAVE, MORTAL o SIN_LESIONES')
    .escape(), // Sanitización XSS

  query('tipoVehiculo')
    .optional()
    .trim()
    .isIn(Object.values(TIPOS_VEHICULO))
    .withMessage('Tipo de vehículo no válido')
    .escape(), // Sanitización XSS

  query('tipoLesion')
    .optional()
    .trim()
    .isIn(Object.values(TIPOS_LESION))
    .withMessage('Tipo de lesión no válido')
    .escape(), // Sanitización XSS

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
    .isIn([...SORT_FIELDS.ACCIDENT, 'puntuacionGravedad'])
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
    .isIn(Object.values(TRAFFIC_ELEMENT_TYPES))
    .withMessage(`Tipo de elemento debe ser ${Object.values(TRAFFIC_ELEMENT_TYPES).join(' o ')}`),

  query('nivelCongestion')
    .optional()
    .isIn(Object.values(CONGESTION_LEVELS).filter(v => v !== 'SIN_DATOS'))
    .withMessage('Nivel de congestión no válido'),

  query('calidad')
    .optional()
    .isIn(Object.values(DATA_QUALITY_LEVELS).filter(v => v !== 'SIN_DATOS'))
    .withMessage('Calidad debe ser ALTA, MEDIA o BAJA'),

  query('puntoMedidaId')
    .optional()
    .matches(/^\d+$/)
    .withMessage('ID de punto de medida debe ser numérico'),

  query('sortBy')
    .optional()
    .isIn(SORT_FIELDS.TRAFFIC)
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
    .isIn(CONTAINER_TYPES)
    .withMessage('Tipo de contenedor no válido'),
  validateRequest
];

const validateContainerFilters = [
  ...validateDistrictQuery,
  ...validateNeighborhoodQuery,

  query('lote')
    .optional()
    .isInt({ min: ROUTE_SPECIFIC_LIMITS.CONTAINERS.LOTE_MIN, max: ROUTE_SPECIFIC_LIMITS.CONTAINERS.LOTE_MAX })
    .withMessage(`Lote debe ser ${ROUTE_SPECIFIC_LIMITS.CONTAINERS.LOTE_MIN}, ${ROUTE_SPECIFIC_LIMITS.CONTAINERS.LOTE_MIN + 1} o ${ROUTE_SPECIFIC_LIMITS.CONTAINERS.LOTE_MAX}`),

  query('sortBy')
    .optional()
    .isIn([...SORT_FIELDS.CONTAINER, 'cantidad'])
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
    .isFloat({ min: GEO_LIMITS.LONGITUDE_MIN, max: GEO_LIMITS.LONGITUDE_MAX })
    .withMessage(`Longitud debe estar entre ${GEO_LIMITS.LONGITUDE_MIN} y ${GEO_LIMITS.LONGITUDE_MAX}`),

  query('latitude')
    .notEmpty()
    .withMessage('Latitud es obligatoria')
    .isFloat({ min: GEO_LIMITS.LATITUDE_MIN, max: GEO_LIMITS.LATITUDE_MAX })
    .withMessage(`Latitud debe estar entre ${GEO_LIMITS.LATITUDE_MIN} y ${GEO_LIMITS.LATITUDE_MAX}`),

  query('maxDistance')
    .optional()
    .isInt({ min: GEO_LIMITS.MIN_DISTANCE_METERS, max: GEO_LIMITS.MAX_DISTANCE_METERS })
    .withMessage(`Distancia debe estar entre ${GEO_LIMITS.MIN_DISTANCE_METERS} y ${GEO_LIMITS.MAX_DISTANCE_METERS} metros`),

  validateRequest
];

/**
 * Validaciones específicas de Bicicletas
 */
const validateBikeFilters = [
  query('sortBy')
    .optional()
    .isIn([...SORT_FIELDS.BIKE_AVAILABILITY, 'tasaOcupacion'])
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
  validateRefreshToken,
  validateOptionalRefreshToken,
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
