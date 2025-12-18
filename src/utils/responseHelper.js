/**
 * Utilidades de Helper de Respuestas
 *
 * Estandariza el formato de respuesta de la API y proporciona funciones helper
 * para una estructura de respuesta consistente en toda la aplicación.
 *
 */

const config = require('../config/config');

/**
 * Crea una respuesta de éxito estandarizada
 *
 * @param {*} data - Datos de respuesta (null si no hay datos)
 * @param {string} message - Mensaje de éxito
 * @param {object} meta - Metadatos adicionales (opcional)
 * @returns {object} Respuesta de éxito estandarizada
 */
const createResponse = (data = null, message, meta = null) => {
  const response = {
    success: true,
    message,
    version: config.api.version,
    timestamp: new Date().toISOString(),
  };

  if (data !== null) {
    response.data = data;
  }

  if (meta !== null) {
    response.meta = meta;
  }

  return response;
};

/**
 * Crea una respuesta de error estandarizada
 * NOTA: Para errores complejos, considera usar AppError de errorUtils.js
 *
 * @param {string} message - Mensaje de error
 * @param {*} errors - Detalles del error (opcional)
 * @param {number} code - Código de error (opcional)
 * @returns {object} Respuesta de error estandarizada
 */
const createErrorResponse = (message, errors = null, code = null) => {
  const response = {
    success: false,
    message,
    timestamp: new Date().toISOString(),
  };

  if (errors !== null) {
    response.errors = errors;
  }

  if (code !== null) {
    response.code = code;
  }

  return response;
};

/**
 * Crea una respuesta de error no autorizado
 *
 * @param {string} message - Mensaje de no autorizado personalizado
 * @returns {object} Respuesta de error no autorizado estandarizada
 */
const createUnauthorizedResponse = (message = 'Acceso no autorizado') => {
  return createErrorResponse(
    message,
    null,
    'UNAUTHORIZED'
  );
};

/**
 * Crea una respuesta de límite de tasa excedido
 *
 * @param {number} resetTime - Tiempo cuando el límite de tasa se reinicia (en segundos)
 * @returns {object} Respuesta de error de límite de tasa estandarizada
 */
const createRateLimitResponse = (resetTime) => {
  return createErrorResponse(
    'Demasiadas peticiones. Por favor, inténtelo de nuevo más tarde.',
    { resetTime },
    'RATE_LIMIT_EXCEEDED'
  );
};

/**
 * Crea una respuesta de acceso prohibido
 *
 * @param {string} message - Mensaje de prohibido personalizado
 * @returns {object} Respuesta de error prohibido estandarizada
 */
const createForbiddenResponse = (message = 'Acceso prohibido a este recurso') => {
  return createErrorResponse(
    message,
    null,
    'FORBIDDEN'
  );
};

module.exports = {
  createResponse,
  createErrorResponse,
  createUnauthorizedResponse,
  createRateLimitResponse,
  createForbiddenResponse
};
