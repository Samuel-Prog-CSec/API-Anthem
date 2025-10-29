/**
 * Input Validation Middleware
 *
 * Provides validation rules and middleware for API endpoints using express-validator.
 * Ensures data integrity and prevents malicious input.
 *
 * @author API Development Team
 * @version 1.0.0
 */

const { body, param, query, validationResult } = require('express-validator');

/**
 * User registration validation rules
 *
 * Validates user registration input including username, email, password,
 * and optional profile information.
 */
const validateRegistration = [
  body('username')
    .trim()
    .isLength({ min: 3, max: 30 })
    .withMessage('Username must be between 3 and 30 characters')
    .matches(/^[a-zA-Z0-9_-]+$/)
    .withMessage('Username can only contain letters, numbers, hyphens, and underscores')
    .escape()
    .custom(async (value) => {
      // Additional username validation can be added here
      const forbiddenUsernames = ['admin', 'root', 'api', 'system', 'null', 'undefined'];
      if (forbiddenUsernames.includes(value.toLowerCase())) {
        throw new Error('This username is not allowed');
      }
      return true;
    }),

  body('email')
    .trim()
    .isEmail()
    .withMessage('Please provide a valid email address')
    .normalizeEmail()
    .escape()
    .isLength({ max: 255 })
    .withMessage('Email address is too long'),

  body('password')
    .isLength({ min: 8, max: 128 })
    .withMessage('Password must be between 8 and 128 characters')
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]+$/)
    .withMessage('Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character'),

  body('firstName')
    .optional()
    .trim()
    .isLength({ max: 50 })
    .withMessage('First name cannot exceed 50 characters')
    .matches(/^[a-zA-ZÀ-ÿ\s-']+$/)
    .withMessage('First name can only contain letters, spaces, hyphens, and apostrophes')
    .escape(),

  body('lastName')
    .optional()
    .trim()
    .isLength({ max: 50 })
    .withMessage('Last name cannot exceed 50 characters')
    .matches(/^[a-zA-ZÀ-ÿ\s-']+$/)
    .withMessage('Last name can only contain letters, spaces, hyphens, and apostrophes')
    .escape()
];

/**
 * User login validation rules
 *
 * Validates login credentials (email/username and password).
 */
const validateLogin = [
  body('identifier')
    .trim()
    .notEmpty()
    .withMessage('Email or username is required')
    .isLength({ min: 3, max: 255 })
    .withMessage('Identifier must be between 3 and 255 characters')
    .escape(),

  body('password')
    .notEmpty()
    .withMessage('Password is required')
    .isLength({ min: 1, max: 128 })
    .withMessage('Password cannot exceed 128 characters')
];

/**
 * Profile update validation rules
 *
 * Validates user profile update data.
 */
const validateProfileUpdate = [
  body('firstName')
    .optional()
    .trim()
    .isLength({ max: 50 })
    .withMessage('First name cannot exceed 50 characters')
    .matches(/^[a-zA-ZÀ-ÿ\s-']+$/)
    .withMessage('First name can only contain letters, spaces, hyphens, and apostrophes')
    .escape(),

  body('lastName')
    .optional()
    .trim()
    .isLength({ max: 50 })
    .withMessage('Last name cannot exceed 50 characters')
    .matches(/^[a-zA-ZÀ-ÿ\s-']+$/)
    .withMessage('Last name can only contain letters, spaces, hyphens, and apostrophes')
    .escape()
];

/**
 * Password change validation rules
 *
 * Validates password change requests.
 */
const validatePasswordChange = [
  body('currentPassword')
    .notEmpty()
    .withMessage('Current password is required'),

  body('newPassword')
    .isLength({ min: 8, max: 128 })
    .withMessage('New password must be between 8 and 128 characters')
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/)
    .withMessage('New password must contain at least one uppercase letter, one lowercase letter, one number, and one special character'),

  body('confirmPassword')
    .custom((value, { req }) => {
      if (value !== req.body.newPassword) {
        throw new Error('Password confirmation does not match new password');
      }
      return true;
    })
];

/**
 * Password reset request validation rules
 *
 * Validates password reset request (email only).
 */
const validatePasswordResetRequest = [
  body('email')
    .trim()
    .isEmail()
    .withMessage('Please provide a valid email address')
    .normalizeEmail()
];

/**
 * Password reset validation rules
 *
 * Validates password reset with token.
 */
const validatePasswordReset = [
  body('token')
    .notEmpty()
    .withMessage('Reset token is required')
    .isLength({ min: 10, max: 255 })
    .withMessage('Invalid reset token format'),

  body('newPassword')
    .isLength({ min: 8, max: 128 })
    .withMessage('Password must be between 8 and 128 characters')
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/)
    .withMessage('Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character'),

  body('confirmPassword')
    .custom((value, { req }) => {
      if (value !== req.body.newPassword) {
        throw new Error('Password confirmation does not match new password');
      }
      return true;
    })
];

/**
 * MongoDB ObjectId validation
 *
 * Validates MongoDB ObjectId parameters.
 */
const validateObjectId = (paramName = 'id') => [
  param(paramName)
    .isMongoId()
    .withMessage(`Invalid ${paramName} format`)
];

/**
 * Pagination validation rules
 *
 * Validates pagination query parameters.
 */
const validatePagination = [
  query('page')
    .optional()
    .isInt({ min: 1, max: 1000 })
    .withMessage('Page must be a positive integer between 1 and 1000')
    .toInt(),

  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('Limit must be a positive integer between 1 and 100')
    .toInt(),

  query('sort')
    .optional()
    .isIn(['asc', 'desc', '1', '-1'])
    .withMessage('Sort must be either asc, desc, 1, or -1'),

  query('sortBy')
    .optional()
    .matches(/^[a-zA-Z][a-zA-Z0-9_]*$/)
    .withMessage('SortBy must be a valid field name')
];

/**
 * Search validation rules
 *
 * Validates search query parameters.
 */
const validateSearch = [
  query('q')
    .optional()
    .trim()
    .isLength({ min: 1, max: 100 })
    .withMessage('Search query must be between 1 and 100 characters')
    .escape(), // Escape HTML entities for security

  query('fields')
    .optional()
    .matches(/^[a-zA-Z,_]+$/)
    .withMessage('Fields must be comma-separated field names')
];

/**
 * Custom validation for file uploads (if needed in future)
 *
 * Validates file upload requests.
 */
const validateFileUpload = [
  body('fileType')
    .optional()
    .isIn(['image/jpeg', 'image/png', 'image/gif', 'application/pdf'])
    .withMessage('Invalid file type'),

  body('maxSize')
    .optional()
    .isInt({ min: 1, max: 5242880 }) // 5MB max
    .withMessage('File size must be between 1 byte and 5MB')
];

/**
 * Request validation middleware
 *
 * Processes validation results from express-validator and returns
 * properly formatted error responses if validation fails.
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
 * Date range validation for queries
 *
 * Validates start and end dates with configurable max range
 * Used across multiple controllers (accidents, traffic, air quality, etc.)
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
 * Common query parameters validation
 * For distrito, barrio, and location-based queries
 */
const validateDistritoQuery = [
  query('distrito')
    .optional()
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage('Distrito debe tener entre 2 y 100 caracteres')
    .escape()
];

const validateBarrioQuery = [
  query('barrio')
    .optional()
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage('Barrio debe tener entre 2 y 100 caracteres')
    .escape()
];

/**
 * Export format validation
 * Used by endpoints that support data export
 */
const validateExportFormat = [
  query('format')
    .optional()
    .isIn(['json', 'csv', 'xml'])
    .withMessage('Formato debe ser json, csv o xml')
];

/**
 * Temporal aggregation validation
 * For time-series data grouping
 */
const validateTemporalAggregation = [
  query('groupBy')
    .optional()
    .isIn(['hourly', 'daily', 'weekly', 'monthly', 'yearly'])
    .withMessage('groupBy debe ser: hourly, daily, weekly, monthly, o yearly'),

  query('aggregation')
    .optional()
    .isIn(['avg', 'sum', 'min', 'max', 'count'])
    .withMessage('aggregation debe ser: avg, sum, min, max, o count')
];

/**
 * Validaciones específicas de Accidentes
 */
const validateAccidentFilters = [
  ...validateDistritoQuery,

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
const validateExpediente = [
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
  ...validateDistritoQuery,
  ...validateBarrioQuery,

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
  validateProfileUpdate,
  validatePasswordChange,
  validatePasswordResetRequest,
  validatePasswordReset,
  validateObjectId,
  validatePagination,
  validateSearch,
  validateFileUpload,
  validateRequest,
  // Validaciones consolidadas generales
  validateDateRange,
  validateDistritoQuery,
  validateBarrioQuery,
  validateExportFormat,
  validateTemporalAggregation,
  // Validaciones específicas de dominio
  validateAccidentFilters,
  validateExpediente,
  validateTrafficFilters,
  validateContainerType,
  validateContainerFilters,
  validateCoordinates,
  validateBikeFilters
};

