/**
 * HTTP Request Logger Middleware
 *
 * Middleware para logging automático de requests HTTP usando pino-http.
 * Registra automáticamente requests entrantes y respuestas con contexto enriquecido.
 * También maneja logging de errores no capturados durante el procesamiento de requests.
 */

const pinoHttp = require('pino-http');
const logger = require('../config/logger');

/**
 * Configuración del middleware HTTP logger
 */
const httpLoggerMiddleware = pinoHttp({
  logger: logger,

  // Nivel de log según código de respuesta
  customLogLevel: (req, res, err) => {
    if (res.statusCode >= 400 && res.statusCode < 500) {
      return 'warn';
    } else if (res.statusCode >= 500 || err) {
      return 'error';
    } else if (res.statusCode >= 300 && res.statusCode < 400) {
      return 'info';
    }
    return 'info';
  },

  // Personalizar mensaje de log
  customSuccessMessage: (req, res) => {
    return `${req.method} ${req.url} ${res.statusCode}`;
  },

  customErrorMessage: (req, res, err) => {
    return `${req.method} ${req.url} ${res.statusCode} - ${err.message}`;
  },

  // Atributos personalizados en el log
  customAttributeKeys: {
    req: 'request',
    res: 'response',
    err: 'error',
    responseTime: 'duration'
  },

  // Serializers personalizados
  serializers: {
    req: (req) => ({
      id: req.id,
      method: req.method,
      url: req.url,
      path: req.path,
      params: req.params,
      query: req.query,
      headers: {
        host: req.headers.host,
        userAgent: req.headers['user-agent'],
        referer: req.headers.referer
      },
      remoteAddress: req.ip || req.connection?.remoteAddress,
      userId: req.user?.id,
      userRole: req.user?.role
    }),
    res: (res) => ({
      statusCode: res.statusCode,
      headers: {
        contentType: res.getHeader('content-type'),
        contentLength: res.getHeader('content-length')
      }
    }),
    err: (err) => ({
      type: err.type,
      message: err.message,
      stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
      statusCode: err.statusCode,
      code: err.code
    })
  },

  // Rutas a ignorar (health checks, etc.)
  autoLogging: {
    ignore: (req) => {
      // No logear health checks
      if (req.url === '/health' || req.url === '/ping') {
        return true;
      }
      // No logear assets estáticos si los sirves
      if (req.url.startsWith('/public/') || req.url.startsWith('/static/')) {
        return true;
      }
      return false;
    }
  },

  // Redactar información sensible
  redact: {
    paths: [
      'request.headers.authorization',
      'request.headers.cookie',
      'request.body.password',
      'request.body.token',
      'request.body.newPassword',
      'request.body.currentPassword'
    ],
    remove: true
  }
});

/**
 * Middleware para agregar información de contexto al logger
 */
const enrichRequestContext = (req, res, next) => {
  // Agregar información adicional al request logger
  if (req.log) {
    // Crear child logger con contexto de request
    req.log = req.log.child({
      requestId: req.id,
      userId: req.user?.id,
      userRole: req.user?.role,
      ip: req.ip
    });
  }

  next();
};

/**
 * Middleware para logear errores no capturados
 */
const errorLogger = (err, req, res, next) => {
  const errorLog = {
    error: {
      name: err.name,
      message: err.message,
      stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
      statusCode: err.statusCode || 500,
      code: err.code,
      isOperational: err.isOperational
    },
    request: {
      method: req.method,
      url: req.url,
      params: req.params,
      query: req.query,
      body: req.body,
      userId: req.user?.id
    }
  };

  if (req.log) {
    req.log.error(errorLog, 'Unhandled error in request');
  } else {
    logger.error(errorLog, 'Unhandled error in request');
  }

  next(err);
};

module.exports = {
  httpLoggerMiddleware,
  enrichRequestContext,
  errorLogger
};
