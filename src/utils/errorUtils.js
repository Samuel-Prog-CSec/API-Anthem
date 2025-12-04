/**
 * Utilidades de Manejo de Errores
 *
 * Clases y funciones para manejar errores de manera consistente en la API.
 */

const { HTTP_STATUS } = require('../constants');

/**
 * Clase de Error Personalizada para la Aplicación
 */
class AppError extends Error {
  constructor(message, statusCode, details = null) {
    super(message);

    this.statusCode = statusCode;
    this.status = `${statusCode}`.startsWith('4') ? 'fail' : 'error';
    this.isOperational = true;
    this.details = details;

    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Crear error de validación con detalles
 * @param {string} message - Mensaje principal del error
 * @param {Array} validationErrors - Array de errores de validación
 * @returns {AppError} Error de validación
 */
const createValidationError = (message, validationErrors = []) => {
  return new AppError(message, HTTP_STATUS.BAD_REQUEST, {
    type: 'validation_error',
    errors: validationErrors
  });
};

/**
 * Crear error de autorización
 * @param {string} message - Mensaje del error
 * @returns {AppError} Error 401
 */
const createAuthError = (message = 'No autorizado') => {
  return new AppError(message, HTTP_STATUS.UNAUTHORIZED, {
    type: 'auth_error'
  });
};

/**
 * Crear error interno del servidor
 * @param {string} message - Mensaje del error
 * @param {Error} originalError - Error original (opcional)
 * @returns {AppError} Error 500
 */
const createInternalError = (message = 'Error interno del servidor', originalError = null) => {
  return new AppError(message, HTTP_STATUS.INTERNAL_SERVER_ERROR, {
    type: 'internal_error',
    originalError: originalError?.message
  });
};

/**
 * Crear error de conflicto (duplicado)
 * @param {string} message - Mensaje del error
 * @param {Object} conflictData - Datos que causan el conflicto
 * @returns {AppError} Error 409
 */
const createConflictError = (message, conflictData = null) => {
  return new AppError(message, HTTP_STATUS.CONFLICT, {
    type: 'conflict_error',
    conflict: conflictData
  });
};

/**
 * Manejar errores de MongoDB/Mongoose
 * @param {Error} error - Error de MongoDB
 * @returns {AppError} Error personalizado
 */
const handleMongoError = (error) => {
  if (error.name === 'ValidationError') {
    const errors = Object.values(error.errors).map(err => ({
      field: err.path,
      message: err.message,
      value: err.value
    }));
    return createValidationError('Error de validación de datos', errors);
  }

  if (error.code === 11000) {
    const field = Object.keys(error.keyValue)[0];
    const value = error.keyValue[field];
    return createConflictError(
      `El ${field} '${value}' ya existe`,
      { field, value }
    );
  }

  if (error.name === 'CastError') {
    return new AppError(`Formato inválido para ${error.path}: ${error.value}`, HTTP_STATUS.BAD_REQUEST);
  }

  return createInternalError('Error de base de datos', error);
};

/**
 * Manejar errores de JWT
 * @param {Error} error - Error de JWT
 * @returns {AppError} Error personalizado
 */
const handleJWTError = (error) => {
  if (error.name === 'JsonWebTokenError') {
    return createAuthError('Token inválido');
  }

  if (error.name === 'TokenExpiredError') {
    return createAuthError('Token expirado');
  }

  return createAuthError('Error de autenticación');
};

/**
 * Crear error de recurso no encontrado (404)
 * @param {string} resource - Nombre del recurso (ej: 'Usuario', 'Multa', 'Accidente')
 * @param {string|number} identifier - Identificador del recurso buscado (opcional)
 * @returns {AppError} Error 404
 */
const createNotFoundError = (resource, identifier = null) => {
  const message = identifier
    ? `${resource} con identificador '${identifier}' no encontrado`
    : `${resource} no encontrado`;

  return new AppError(message, HTTP_STATUS.NOT_FOUND, {
    type: 'not_found_error',
    resource,
    identifier
  });
};

/**
 * Crear error de solicitud incorrecta (400)
 * @param {string} message - Mensaje del error
 * @param {Object} details - Detalles adicionales del error (opcional)
 * @returns {AppError} Error 400
 */
const createBadRequestError = (message, details = null) => {
  return new AppError(message, HTTP_STATUS.BAD_REQUEST, {
    type: 'bad_request_error',
    details
  });
};

/**
 * Crear error de prohibido/acceso denegado (403)
 * @param {string} message - Mensaje del error
 * @param {Object} details - Detalles adicionales (opcional)
 * @returns {AppError} Error 403
 */
const createForbiddenError = (message = 'Acceso denegado', details = null) => {
  return new AppError(message, HTTP_STATUS.FORBIDDEN, {
    type: 'forbidden_error',
    details
  });
};

/**
 * Formatear error para respuesta HTTP
 * @param {AppError} error - Error a formatear
 * @param {boolean} includeStack - Incluir stack trace (solo desarrollo)
 * @returns {Object} Error formateado para respuesta
 */
const formatErrorResponse = (error, includeStack = false) => {
  const response = {
    success: false,
    status: error.status || 'error',
    message: error.message,
    statusCode: error.statusCode || HTTP_STATUS.INTERNAL_SERVER_ERROR
  };

  if (error.details) {
    response.details = error.details;
  }

  if (includeStack && error.stack) {
    response.stack = error.stack;
  }

  return response;
};

module.exports = {
  AppError,
  createValidationError,
  createAuthError,
  createInternalError,
  createConflictError,
  createNotFoundError,
  createBadRequestError,
  createForbiddenError,
  handleMongoError,
  handleJWTError,
  formatErrorResponse
};
