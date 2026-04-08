/**
 * Logger Específico para Scripts de Importación
 *
 * Logger configurado específicamente para scripts de importación de datos.
 * Los logs se escriben a logs/scripts/ en lugar de logs/server/
 *
 * Uso en scripts:
 * ```javascript
 * process.env.SCRIPT_MODE = 'true'; // Al inicio del script
 * const logger = require('../src/config/scriptLogger');
 * logger.info('Iniciando importación...');
 * ```
 */

// Establecer modo script antes de importar el logger
process.env.SCRIPT_MODE = 'true';

const pino = require('pino');
const { setupLogTransport } = require('./loggerTransport');

const isDevelopment = process.env.NODE_ENV !== 'production';
const isTest = process.env.NODE_ENV === 'test';

/**
 * Configuración del logger para scripts
 */
const scriptLoggerConfig = {
  // Nivel de log según entorno
  level: process.env.LOG_LEVEL || (isDevelopment ? 'debug' : 'info'),

  // Transporte configurado para scripts
  ...(!isTest && {
    transport: setupLogTransport('script')
  }),

  // Configuración para producción
  ...(!isDevelopment && {
    formatters: {
      level: (label) => {
        return { level: label };
      }
    },
    timestamp: pino.stdTimeFunctions.isoTime
  }),

  // Campos base para identificar logs de scripts
  base: {
    env: process.env.NODE_ENV || 'development',
    app: 'smart-city-api',
    processType: 'script',
    version: process.env.npm_package_version || '1.0.0'
  },

  // Serializers estándar
  serializers: {
    err: pino.stdSerializers.err
  }
};

/**
 * Crear instancia del logger para scripts
 */
const scriptLogger = pino(scriptLoggerConfig);

/**
 * Logger para tests (silencioso)
 */
if (isTest) {
  scriptLogger.level = 'silent';
}

/**
 * Loggers especializados para diferentes tipos de importación
 */
const importAccidentsLogger = scriptLogger.child({ scriptType: 'import-accidents' });
const importCensusLogger = scriptLogger.child({ scriptType: 'import-census' });
const importTrafficLogger = scriptLogger.child({ scriptType: 'import-traffic' });
const importFinesLogger = scriptLogger.child({ scriptType: 'import-fines' });
const importNoiseLogger = scriptLogger.child({ scriptType: 'import-noise' });
const importLocationsLogger = scriptLogger.child({ scriptType: 'import-locations' });
const importAirQualityLogger = scriptLogger.child({ scriptType: 'import-air-quality' });
const importScootersLogger = scriptLogger.child({ scriptType: 'import-scooters' });
const importBikesLogger = scriptLogger.child({ scriptType: 'import-bikes' });
const importContainersLogger = scriptLogger.child({ scriptType: 'import-containers' });
const importBikeTrafficLogger = scriptLogger.child({ scriptType: 'import-bike-traffic' });
const importAllLogger = scriptLogger.child({ scriptType: 'import-all' });

module.exports = scriptLogger;
module.exports.importAccidentsLogger = importAccidentsLogger;
module.exports.importCensusLogger = importCensusLogger;
module.exports.importTrafficLogger = importTrafficLogger;
module.exports.importFinesLogger = importFinesLogger;
module.exports.importNoiseLogger = importNoiseLogger;
module.exports.importLocationsLogger = importLocationsLogger;
module.exports.importAirQualityLogger = importAirQualityLogger;
module.exports.importScootersLogger = importScootersLogger;
module.exports.importBikesLogger = importBikesLogger;
module.exports.importContainersLogger = importContainersLogger;
module.exports.importBikeTrafficLogger = importBikeTrafficLogger;
module.exports.importAllLogger = importAllLogger;
