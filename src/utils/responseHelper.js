/**
 * Response Helper Utilities
 *
 * Standardizes API response format and provides helper functions
 * for consistent response structure across the application.
 *
 * @author API Development Team
 * @version 1.0.0
 */

/**
 * Creates a standardized success response
 *
 * @param {string} message - Success message
 * @param {*} data - Response data (optional)
 * @param {object} meta - Additional metadata (optional)
 * @returns {object} Standardized success response
 */
const createResponse = (message, data = null, meta = null) => {
  const response = {
    success: true,
    message,
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
 * Creates a standardized error response
 * NOTA: Para errores complejos, considera usar AppError de errorUtils.js
 *
 * @param {string} message - Error message
 * @param {*} errors - Error details (optional)
 * @param {number} code - Error code (optional)
 * @returns {object} Standardized error response
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
 * Creates an unauthorized error response
 *
 * @param {string} message - Custom unauthorized message
 * @returns {object} Standardized unauthorized error response
 */
const createUnauthorizedResponse = (message = 'Unauthorized access') => {
  return createErrorResponse(
    message,
    null,
    'UNAUTHORIZED'
  );
};

/**
 * Creates a rate limit exceeded error response
 *
 * @param {number} resetTime - Time when rate limit resets (in seconds)
 * @returns {object} Standardized rate limit error response
 */
const createRateLimitResponse = (resetTime) => {
  return createErrorResponse(
    'Too many requests. Please try again later.',
    { resetTime },
    'RATE_LIMIT_EXCEEDED'
  );
};

module.exports = {
  createResponse,
  createErrorResponse,
  createUnauthorizedResponse,
  createRateLimitResponse
};
