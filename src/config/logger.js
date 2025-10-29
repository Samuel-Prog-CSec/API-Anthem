/**
 * Logger Configuration with Pino
 *
 * Configuración profesional de logging usando Pino.js
 * Soporta diferentes niveles por entorno, rotación de logs y formato estructurado.
 *
 * @see https://getpino.io/
 */

const pino = require('pino');
const path = require('path');

const isDevelopment = process.env.NODE_ENV !== 'production';
const isTest = process.env.NODE_ENV === 'test';

/**
 * Opciones de configuración de Pino según el entorno
 */
const pinoConfig = {
  // Nivel de log según entorno
  level: process.env.LOG_LEVEL || (isDevelopment ? 'debug' : 'info'),

  // Configuración para desarrollo
  ...(isDevelopment && !isTest && {
    transport: {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'SYS:standard',
        ignore: 'pid,hostname',
        singleLine: false,
        messageFormat: '{levelLabel} - {msg}',
        errorLikeObjectKeys: ['err', 'error']
      }
    }
  }),

  // Configuración para producción
  ...(!isDevelopment && {
    formatters: {
      level: (label) => {
        return { level: label };
      }
    },
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: {
      paths: [
        'password',
        'token',
        'accessToken',
        'refreshToken',
        'authorization',
        'cookie',
        'req.headers.authorization',
        'req.headers.cookie',
        'creditCard',
        'cvv',
        'ssn'
      ],
      remove: true
    }
  }),

  // Campos base que se incluyen en todos los logs
  base: {
    env: process.env.NODE_ENV || 'development',
    app: 'smart-city-api',
    version: process.env.npm_package_version || '1.0.0'
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
      remoteAddress: req.ip || req.connection?.remoteAddress,
      remotePort: req.connection?.remotePort,
      userId: req.user?.id,
      userRole: req.user?.role
    }),
    res: (res) => ({
      statusCode: res.statusCode,
      headers: res.getHeaders?.()
    }),
    err: pino.stdSerializers.err
  }
};

/**
 * Crear instancia del logger
 */
const logger = pino(pinoConfig);

/**
 * Logger para tests (silencioso)
 */
if (isTest) {
  logger.level = 'silent';
}

/**
 * Crear logger hijo con contexto adicional
 * Útil para asociar logs a una operación específica
 *
 * @param {Object} bindings - Contexto adicional
 * @returns {pino.Logger} Logger hijo
 *
 * @example
 * const userLogger = createChildLogger({ userId: '123', operation: 'checkout' });
 * userLogger.info('Procesando pago');
 */
const createChildLogger = (bindings = {}) => {
  return logger.child(bindings);
};

/**
 * Logger específico para base de datos
 */
const dbLogger = logger.child({ component: 'database' });

/**
 * Logger específico para autenticación
 */
const authLogger = logger.child({ component: 'auth' });

/**
 * Logger específico para caché
 */
const cacheLogger = logger.child({ component: 'cache' });

/**
 * Logger específico para APIs externas
 */
const externalApiLogger = logger.child({ component: 'external-api' });

/**
 * Logger específico para importación de datos
 */
const importLogger = logger.child({ component: 'data-import' });

/**
 * Logger específico para tareas programadas
 */
const schedulerLogger = logger.child({ component: 'scheduler' });

/**
 * Helper para logear tiempos de operación
 *
 * @param {string} operation - Nombre de la operación
 * @param {Function} fn - Función a ejecutar
 * @returns {Promise<any>} Resultado de la función
 *
 * @example
 * const result = await logOperationTime('getAccidents', async () => {
 *   return await Accident.find(filters);
 * });
 */
const logOperationTime = async (operation, fn, context = {}) => {
  const startTime = Date.now();

  try {
    const result = await fn();
    const duration = Date.now() - startTime;

    logger.debug({
      operation,
      duration: `${duration}ms`,
      ...context
    }, `Operation completed: ${operation}`);

    // Warning si la operación tarda mucho
    if (duration > 3000) {
      logger.warn({
        operation,
        duration: `${duration}ms`,
        ...context
      }, `Slow operation detected: ${operation}`);
    }

    return result;
  } catch (error) {
    const duration = Date.now() - startTime;

    logger.error({
      operation,
      duration: `${duration}ms`,
      error: error.message,
      stack: error.stack,
      ...context
    }, `Operation failed: ${operation}`);

    throw error;
  }
};

/**
 * Helper para logear queries de MongoDB
 *
 * @param {string} model - Nombre del modelo
 * @param {string} operation - Tipo de operación (find, aggregate, update, etc.)
 * @param {Object} filters - Filtros aplicados
 * @param {Object} options - Opciones adicionales
 */
const logQuery = (model, operation, filters = {}, options = {}) => {
  logger.debug({
    component: 'database',
    model,
    operation,
    filters: JSON.stringify(filters),
    options: JSON.stringify(options)
  }, `MongoDB query: ${model}.${operation}`);
};

/**
 * Helper para logear eventos de caché
 *
 * @param {string} event - Tipo de evento (hit, miss, set, delete)
 * @param {string} key - Key del caché
 * @param {Object} metadata - Metadata adicional
 */
const logCache = (event, key, metadata = {}) => {
  cacheLogger.debug({
    event,
    key,
    ...metadata
  }, `Cache ${event}: ${key}`);
};

/**
 * Helper para logear llamadas a APIs externas
 *
 * @param {string} api - Nombre de la API
 * @param {string} endpoint - Endpoint llamado
 * @param {Object} metadata - Metadata adicional
 */
const logExternalApi = (api, endpoint, metadata = {}) => {
  externalApiLogger.info({
    api,
    endpoint,
    ...metadata
  }, `External API call: ${api} - ${endpoint}`);
};

/**
 * Formatear error para logging
 *
 * @param {Error} error - Error a formatear
 * @param {Object} context - Contexto adicional
 * @returns {Object} Error formateado
 */
const formatError = (error, context = {}) => {
  return {
    name: error.name,
    message: error.message,
    stack: isDevelopment ? error.stack : undefined,
    code: error.code,
    statusCode: error.statusCode,
    isOperational: error.isOperational,
    ...context
  };
};

module.exports = logger;
module.exports.createChildLogger = createChildLogger;
module.exports.dbLogger = dbLogger;
module.exports.authLogger = authLogger;
module.exports.cacheLogger = cacheLogger;
module.exports.externalApiLogger = externalApiLogger;
module.exports.importLogger = importLogger;
module.exports.schedulerLogger = schedulerLogger;
module.exports.logOperationTime = logOperationTime;
module.exports.logQuery = logQuery;
module.exports.logCache = logCache;
module.exports.logExternalApi = logExternalApi;
module.exports.formatError = formatError;
