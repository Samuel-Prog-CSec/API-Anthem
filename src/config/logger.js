/**
 * Configuración del Logger con Pino
 *
 * Configuración profesional de logging usando Pino.js
 * Soporta diferentes niveles por entorno, escritura a archivos y formato estructurado.
 *
 * Características:
 * - Logs separados: servidor (logs/server/) y scripts (logs/scripts/)
 * - Dual output: Consola (desarrollo) + Archivos (siempre)
 * - Archivos: combined.log (todos) + errors.log (solo errores)
 *
 * @see https://getpino.io/
 */

const pino = require('pino');
const { getLogTransport } = require('./loggerTransport');

const isDevelopment = process.env.NODE_ENV !== 'production';
const isTest = process.env.NODE_ENV === 'test';

/**
 * Opciones de configuración de Pino según el entorno
 */
const pinoConfig = {
  // Nivel de log según entorno
  level: process.env.LOG_LEVEL || (isDevelopment ? 'debug' : 'info'),

  // Configuración de transporte (consola + archivos)
  // En test mode, el transporte retorna null y se silencia el logger después
  ...(!isTest && {
    transport: getLogTransport()
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
 * Logger específico para importación de datos
 */
const importLogger = logger.child({ component: 'data-import' });

/**
 * Logger específico para CORS
 */
const corsLogger = logger.child({ component: 'cors' });

/**
 * Logger específico para eventos de seguridad
 */
const securityLogger = logger.child({ component: 'security' });

/**
 * Logger específico para rendimiento y performance
 */
const performanceLogger = logger.child({ component: 'performance' });

module.exports = logger;
module.exports.dbLogger = dbLogger;
module.exports.authLogger = authLogger;
module.exports.cacheLogger = cacheLogger;
module.exports.importLogger = importLogger;
module.exports.corsLogger = corsLogger;
module.exports.securityLogger = securityLogger;
module.exports.performanceLogger = performanceLogger;
