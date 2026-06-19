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
/**
 * Rutas que SIEMPRE se redactan, sin importar el entorno.
 *
 * Razon: dejar passwords/tokens/cookies en logs de desarrollo es un riesgo
 * (los logs pueden compartirse en QA, GitHub issues, capturas de pantalla).
 * Mejor uniformidad: si una clave es secreta, se redacta siempre.
 */
const REDACT_PATHS = [
  'password',
  'newPassword',
  'currentPassword',
  'token',
  'accessToken',
  'refreshToken',
  'authorization',
  'cookie',
  'req.body.password',
  'req.body.newPassword',
  'req.body.currentPassword',
  'req.body.refreshToken',
  'req.body.accessToken',
  'req.body.token',
  'req.headers.authorization',
  'req.headers.cookie',
  'req.cookies.accessToken',
  'req.cookies.refreshToken',
  'req.cookies.token',
  'res.headers["set-cookie"]',
  'creditCard',
  'cvv',
  'ssn'
];

const pinoConfig = {
  // Nivel de log según entorno
  level: process.env.LOG_LEVEL || (isDevelopment ? 'debug' : 'info'),

  // Configuración de transporte (consola + archivos)
  // En test mode, el transporte retorna null y se silencia el logger después
  ...(!isTest && {
    transport: getLogTransport()
  }),

  // Redact universal: aplica en desarrollo y produccion para evitar fugas
  // accidentales por logs compartidos. `remove: true` elimina la clave en
  // lugar de sustituirla por "[Redacted]" (mejor higiene).
  redact: {
    paths: REDACT_PATHS,
    remove: true
  },

  // Configuración para producción
  //
  // IMPORTANTE: `formatters.level` (emitir el nivel como string en vez de
  // numero) NO es compatible con `transport.targets`. Pino lo prohibe porque
  // los formatters son funciones que no pueden serializarse al worker thread
  // del transporte, y lanza "option.transport.targets do not allow custom
  // level formatters" en el arranque -> el servidor NO levantaba en produccion
  // (donde getLogTransport() usa targets). Se elimina el formatter; el nivel
  // viaja como numero (estandar Pino, que los agregadores de logs entienden) y
  // el render de etiqueta se delega al target del transporte (pino-pretty).
  // `timestamp` ISO SI es compatible con transportes y se mantiene.
  ...(!isDevelopment && {
    timestamp: pino.stdTimeFunctions.isoTime
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
