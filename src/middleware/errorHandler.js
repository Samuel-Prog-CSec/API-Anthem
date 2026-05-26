/**
 * Middleware de Manejo de Errores
 *
 * Proporciona middlewares centralizados para el manejo de errores,
 * rutas no encontradas y excepciones no manejadas.
 */

const { formatErrorResponse, handleMongoError, handleJWTError } = require('../utils/errorUtils');
const { getFallbackPayload } = require('./cache');
const config = require('../config/config');
const logger = require('../config/logger');
const { cacheLogger } = logger;
const { HTTP_STATUS } = require('../constants');

/**
 * Determina si un error indica un fallo de la base de datos (no del cliente).
 * Usado para decidir si conviene servir un payload de fallback desde el cache L2.
 */
const isDatabaseFailure = (err) => {
  if (!err) {return false;}
  const dbErrorNames = [
    'MongoNetworkError',
    'MongoServerSelectionError',
    'MongoTimeoutError',
    'MongoNotConnectedError',
    'MongoPoolClosedError'
  ];
  if (dbErrorNames.includes(err.name)) {return true;}
  // statusCode >= 500 sin tipo conocido tambien lo tratamos como fallo de servidor
  if (err.statusCode === undefined || err.statusCode >= 500) {return true;}
  return false;
};

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

  // Stale cache fallback: ante fallos de la DB o 5xx, intentar servir el ultimo
  // payload conocido desde el cache L2 (`fallbackCache` en middleware/cache.js).
  // Asi el dashboard sigue siendo usable durante incidencias transitorias en
  // lugar de cascadear errores 500 al cliente. El usuario ve un header
  // `X-Cache-Status: STALE_FALLBACK` y un campo `_cache.fallback` en el body.
  if (req._cacheContext && req.method === 'GET' && isDatabaseFailure(err)) {
    const fallback = getFallbackPayload(req._cacheContext.cacheKey);
    if (fallback) {
      const cacheAge = Math.floor((Date.now() - (fallback.timestamp || Date.now())) / 1000);
      cacheLogger.warn({
        cacheKey: req._cacheContext.cacheKey,
        cacheType: req._cacheContext.cacheType,
        url: req.originalUrl,
        cacheAgeSeconds: cacheAge,
        errorName: err.name,
        errorMessage: err.message
      }, 'Sirviendo stale fallback desde cache L2 ante fallo de DB');

      return res.status(HTTP_STATUS.OK)
        .set('X-Cache-Status', 'STALE_FALLBACK')
        .set('X-Cache-Type', req._cacheContext.cacheType)
        .set('X-Cache-Age', `${cacheAge}s`)
        .set('X-Stale-Reason', 'database_error')
        .json({
          ...fallback.data,
          _cache: {
            hit: true,
            stale: true,
            fallback: true,
            ageSeconds: cacheAge,
            reason: 'database_error',
            note: 'Respuesta servida desde cache de emergencia. Los datos pueden estar desactualizados.'
          }
        });
    }
  }

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
    config.server.env === 'development'
  );

  res.status(err.statusCode || HTTP_STATUS.INTERNAL_SERVER_ERROR).json(errorResponse);
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

  res.status(HTTP_STATUS.NOT_FOUND).json({
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
      }, 'Timeout de peticion alcanzado');

      res.status(HTTP_STATUS.REQUEST_TIMEOUT).json({
        success: false,
        status: 'error',
        message: 'La peticion ha excedido el tiempo maximo permitido',
        statusCode: HTTP_STATUS.REQUEST_TIMEOUT
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
