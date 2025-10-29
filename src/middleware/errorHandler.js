/**
 * Middleware de Manejo de Errores
 *
 * Proporciona middlewares centralizados para el manejo de errores,
 * rutas no encontradas y excepciones no manejadas.
 */

const { formatErrorResponse, handleMongoError, handleJWTError } = require('../utils/errorUtils');
const config = require('../config/config');

/**
 * Middleware para manejo centralizado de errores
 */
const globalErrorHandler = (err, req, res, next) => {
  // Log del error
  console.error('Error capturado por globalErrorHandler:', {
    message: err.message,
    stack: err.stack,
    url: req.originalUrl,
    method: req.method,
    ip: req.ip,
    userAgent: req.get('User-Agent')
  });

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
const notFoundHandler = (req, res, next) => {
  const error = {
    message: `Ruta ${req.originalUrl} no encontrada`,
    statusCode: 404,
    status: 'fail'
  };

  console.log('Ruta no encontrada:', {
    url: req.originalUrl,
    method: req.method,
    ip: req.ip
  });

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
    console.error('❌ Unhandled Rejection:', {
      reason: reason,
      promise: promise
    });

    console.error('⚠️  Proceso terminado debido a Unhandled Rejection');
    process.exit(1);
  });
};

/**
 * Manejador de excepciones no capturadas
 */
const handleUncaughtException = () => {
  process.on('uncaughtException', (error) => {
    console.error('❌ Uncaught Exception:', {
      message: error.message,
      stack: error.stack
    });

    console.error('⚠️  Proceso terminado debido a Uncaught Exception');
    process.exit(1);
  });
};

/**
 * Middleware de timeout para requests
 */
const timeoutHandler = (timeout = 30000) => {
  return (req, res, next) => {
    res.setTimeout(timeout, () => {
      console.error('Request timeout:', {
        url: req.originalUrl,
        method: req.method,
        timeout: timeout
      });

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
