/**
 * Middleware de Manejo de Errores
 *
 * Proporciona middlewares centralizados para el manejo de errores,
 * rutas no encontradas y excepciones no manejadas.
 */

const { formatErrorResponse, handleMongoError, handleJWTError } = require('../utils/errorUtils');
const config = require('../config/config');
const logger = require('../config/logger');

/**
 * Middleware para manejo centralizado de errores
 */
const globalErrorHandler = (err, req, res, _next) => {
  // Log del error con logger
  logger.error({
    error: err.message,
    stack: err.stack,
    url: req.originalUrl,
    method: req.method,
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    userId: req.user?.id
  }, 'Error capturado por globalErrorHandler');

  // Manejar errores específicos de MongoDB
  if (err.name === 'ValidationError' || err.name === 'CastError' || err.code === 11000) {
    err = handleMongoError(err);
  }

  // Manejar errores específicos de JWT
  if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError' || err.name === 'NotBeforeError') {
    err = handleJWTError(err);
  }

  // Enviar respuesta de error
  const errorResponse = formatErrorResponse(
    err,
    config.NODE_ENV === 'development'
  );

  res.status(err.statusCode || 500).json(errorResponse);
};

/**
 * Middleware para rutas no encontradas
 */
const notFoundHandler = (req, res, _next) => {
  const error = {
    message: `Ruta ${req.originalUrl} no encontrada`,
    statusCode: 404,
    status: 'fail'
  };

  logger.warn({
    url: req.originalUrl,
    method: req.method,
    ip: req.ip,
    userAgent: req.get('User-Agent')
  }, 'Ruta no encontrada');

  res.status(404).json({
    success: false,
    status: 'fail',
    message: error.message,
    statusCode: 404
  });
};

/**
 * Manejador de promesas rechazadas no capturadas
 * NOTA: No intenta cerrar el servidor gracefully porque esta función
 * se registra antes de que el servidor se inicie
 */
const handleUnhandledRejection = () => {
  process.on('unhandledRejection', (reason, promise) => {
    logger.fatal({
      reason: reason,
      promise: promise
    }, 'Unhandled Rejection detectado');

    logger.fatal('Proceso terminado debido a Unhandled Rejection');
    process.exit(1);
  });
};

/**
 * Manejador de excepciones no capturadas
 */
const handleUncaughtException = () => {
  process.on('uncaughtException', (error) => {
    logger.fatal({
      error: error.message,
      stack: error.stack
    }, 'Uncaught Exception detectado');

    logger.fatal('Proceso terminado debido a Uncaught Exception');
    process.exit(1);
  });
};

/**
 * Middleware de timeout para requests
 */
const timeoutHandler = (timeout = 30000) => {
  return (req, res, next) => {
    res.setTimeout(timeout, () => {
      logger.error({
        url: req.originalUrl,
        method: req.method,
        timeout: timeout,
        ip: req.ip
      }, 'Request timeout');

      res.status(408).json({
        success: false,
        status: 'error',
        message: 'Request timeout',
        statusCode: 408
      });
    });
    next();
  };
};

module.exports = {
  globalErrorHandler,
  notFoundHandler,
  handleUnhandledRejection,
  handleUncaughtException,
  timeoutHandler
};
