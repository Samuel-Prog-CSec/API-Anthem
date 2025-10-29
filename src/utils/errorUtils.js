/**
 * Utilidades de Manejo de Errores
 *
 * Clases y funciones para manejar errores de manera consistente en la API.
 */

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
  return new AppError(message, 400, {
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
  return new AppError(message, 401, {
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
  return new AppError(message, 500, {
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
  return new AppError(message, 409, {
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
    return new AppError(`Formato inválido para ${error.path}: ${error.value}`, 400);
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
    statusCode: error.statusCode || 500
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
  handleMongoError,
  handleJWTError,
  formatErrorResponse
};
