/**
 * Configuración de Transportes de Logs con Pino
 *
 * Gestiona el direccionamiento de logs a archivos separados para el servidor y scripts.
 * Crea automáticamente la estructura de carpetas necesaria.
 *
 * Estrategia de Logging:
 * - Servidor API (server.js): logs/server/combined.log + logs/server/errors.log
 * - Scripts de importación: logs/scripts/combined.log + logs/scripts/errors.log
 * - Desarrollo: Consola con pino-pretty + archivos
 * - Producción: Solo archivos (JSON estructurado)
 *
 * @see https://getpino.io/#/docs/transports
 */

const fs = require('fs');
const path = require('path');
const pino = require('pino');

/**
 * Determina el tipo de proceso actual
 * @returns {'server'|'script'} Tipo de proceso
 */
function getProcessType() {
  // Los scripts de importación establecen SCRIPT_MODE=true
  if (process.env.SCRIPT_MODE === 'true') {
    return 'script';
  }

  // Si se está ejecutando server.js, es el servidor
  if (require.main && require.main.filename.includes('server.js')) {
    return 'server';
  }

  // Por defecto, si no se puede determinar, usar 'script' para evitar mezclar logs
  return 'script';
}

/**
 * Crea la estructura de carpetas de logs si no existe
 * @param {string} logDir - Directorio base de logs
 * @param {string} processType - Tipo de proceso ('server' o 'script')
 */
function ensureLogDirectories(logDir, processType) {
  const processLogDir = path.join(logDir, processType);

  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }

  if (!fs.existsSync(processLogDir)) {
    fs.mkdirSync(processLogDir, { recursive: true });
  }
}

/**
 * Crea un stream de escritura de logs con rotación automática
 * @param {string} filePath - Ruta del archivo de log
 * @returns {Object} Stream de pino
 * @private
 */
function _createLogStream(filePath) {
  return pino.destination({
    dest: filePath,
    sync: false, // Asíncrono para mejor rendimiento
    minLength: 4096, // Buffer mínimo antes de escribir (4KB)
    mkdir: true // Crear directorios automáticamente
  });
}

/**
 * Configurar transportes de logs según el entorno y tipo de proceso
 * @param {string} processType - Tipo de proceso ('server' o 'script')
 * @returns {Object} Configuración de transporte de Pino
 */
function setupLogTransport(processType = getProcessType()) {
  const isDevelopment = process.env.NODE_ENV !== 'production';
  const isTest = process.env.NODE_ENV === 'test';

  // En modo test, no escribir logs
  if (isTest) {
    return null;
  }

  // Directorio base de logs
  const LOG_DIR = path.join(process.cwd(), 'logs');

  // Crear estructura de carpetas
  ensureLogDirectories(LOG_DIR, processType);

  // Rutas de archivos de log según el tipo de proceso
  const logFiles = {
    combined: path.join(LOG_DIR, processType, 'combined.log'),
    errors: path.join(LOG_DIR, processType, 'errors.log')
  };

  /**
   * Configuración de transporte múltiple:
   * 1. Consola con pino-pretty (solo desarrollo)
   * 2. Archivo combined.log (todos los niveles)
   * 3. Archivo errors.log (solo errores: error, fatal)
   */
  const targets = [];

  // Target 1: Consola con pino-pretty (solo desarrollo)
  if (isDevelopment) {
    targets.push({
      target: 'pino-pretty',
      level: 'debug',
      options: {
        colorize: true,
        translateTime: 'SYS:standard',
        ignore: 'pid,hostname',
        singleLine: false,
        messageFormat: `[${processType.toUpperCase()}] {levelLabel} - {msg}`,
        errorLikeObjectKeys: ['err', 'error']
      }
    });
  }

  // Target 2: Archivo combined.log (todos los logs)
  targets.push({
    target: 'pino/file',
    level: process.env.LOG_LEVEL || (isDevelopment ? 'debug' : 'info'),
    options: {
      destination: logFiles.combined,
      mkdir: true
    }
  });

  // Target 3: Archivo errors.log (solo errores)
  targets.push({
    target: 'pino/file',
    level: 'error',
    options: {
      destination: logFiles.errors,
      mkdir: true
    }
  });

  return {
    targets
  };
}

/**
 * Obtener configuración de transporte para el proceso actual
 * @returns {Object|null} Configuración de transporte o null si es test
 */
function getLogTransport() {
  const processType = getProcessType();
  return setupLogTransport(processType);
}

module.exports = {
  getLogTransport,
  setupLogTransport,
  getProcessType,
  ensureLogDirectories
};
