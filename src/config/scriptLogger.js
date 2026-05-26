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
 * Loggers especializados para cada importador.
 *
 * Las claves siguen el patron `importar<Recurso>Logger` para mantener
 * coherencia con la regla de CLAUDE.md de codigo de dominio en espanol.
 * Los `scriptType` siguen el mismo patron para que el filtrado de logs
 * por tipo sea uniforme.
 */
const importarUbicacionesLogger = scriptLogger.child({ scriptType: 'importar-ubicaciones' });
const importarCalidadAireLogger = scriptLogger.child({ scriptType: 'importar-calidad-aire' });
const importarRuidoLogger = scriptLogger.child({ scriptType: 'importar-ruido' });
const importarTraficoLogger = scriptLogger.child({ scriptType: 'importar-trafico' });
const importarCensoLogger = scriptLogger.child({ scriptType: 'importar-censo' });
const importarContenedoresLogger = scriptLogger.child({ scriptType: 'importar-contenedores' });
const importarMultasLogger = scriptLogger.child({ scriptType: 'importar-multas' });
const importarAccidentesLogger = scriptLogger.child({ scriptType: 'importar-accidentes' });
const importarPatinetesLogger = scriptLogger.child({ scriptType: 'importar-patinetes' });
const importarBicicletasLogger = scriptLogger.child({ scriptType: 'importar-bicicletas' });
const importarAforoBicicletasLogger = scriptLogger.child({ scriptType: 'importar-aforo-bicicletas' });
const importarAforoPeatonesLogger = scriptLogger.child({ scriptType: 'importar-aforo-peatones' });
const importAllLogger = scriptLogger.child({ scriptType: 'importar-todos' });

module.exports = scriptLogger;
module.exports.importarUbicacionesLogger = importarUbicacionesLogger;
module.exports.importarCalidadAireLogger = importarCalidadAireLogger;
module.exports.importarRuidoLogger = importarRuidoLogger;
module.exports.importarTraficoLogger = importarTraficoLogger;
module.exports.importarCensoLogger = importarCensoLogger;
module.exports.importarContenedoresLogger = importarContenedoresLogger;
module.exports.importarMultasLogger = importarMultasLogger;
module.exports.importarAccidentesLogger = importarAccidentesLogger;
module.exports.importarPatinetesLogger = importarPatinetesLogger;
module.exports.importarBicicletasLogger = importarBicicletasLogger;
module.exports.importarAforoBicicletasLogger = importarAforoBicicletasLogger;
module.exports.importarAforoPeatonesLogger = importarAforoPeatonesLogger;
module.exports.importAllLogger = importAllLogger;
