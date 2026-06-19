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
 * Formatear error para respuesta HTTP.
 *
 * No incluye el stack trace: Pino ya lo loguea con `globalErrorHandler` y
 * duplicarlo en el body filtra detalles internos al cliente.
 *
 * SEGURIDAD: en produccion los errores NO operacionales (bugs de runtime,
 * TypeError, fallos de driver no normalizados, etc.) no deben filtrar su
 * `message` crudo ni `details` al cliente -- revelarian estructura interna
 * util para fingerprinting/explotacion. Se enmascaran con un mensaje generico;
 * el mensaje real queda unicamente en el log de Pino. Solo los errores
 * operacionales (instancias de AppError creadas a proposito) exponen su
 * mensaje. Ademas `details.originalError` (mensaje crudo de la BD que
 * `createInternalError` guarda para el log) nunca se expone en produccion.
 *
 * @param {AppError|Error} error - Error a formatear
 * @param {boolean} [exposeInternals=false] - true en desarrollo: expone el
 *        mensaje y detalles reales de cualquier error. false en produccion.
 * @returns {Object} Error formateado para respuesta
 */
const formatErrorResponse = (error, exposeInternals = false) => {
  const isOperational = error instanceof AppError && error.isOperational === true;
  const statusCode = error.statusCode || HTTP_STATUS.INTERNAL_SERVER_ERROR;

  let message = error.message;
  let details = error.details;

  // Enmascarar errores no operacionales en produccion
  if (!exposeInternals && !isOperational) {
    message = 'Error interno del servidor';
    details = null;
  }

  // Nunca exponer el mensaje del error de BD original en produccion, aunque
  // el error sea operacional (createInternalError lo guarda solo para el log)
  if (!exposeInternals && details && Object.prototype.hasOwnProperty.call(details, 'originalError')) {
    const { originalError: _omit, ...rest } = details;
    details = rest;
  }

  const response = {
    success: false,
    status: error.status || (statusCode >= 500 ? 'error' : 'fail'),
    message,
    statusCode
  };

  if (details) {
    response.details = details;
  }

  // Codigo de error programatico para que el frontend pueda discriminar sin
  // parsear `message`. Solo se incluye si esta definido y es seguro exponerlo
  // (operacional o entorno de desarrollo) para no filtrar codigos internos de
  // driver (p.ej. codigos numericos de MongoServerError no normalizados).
  if (error.code && (isOperational || exposeInternals)) {
    response.code = error.code;
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
