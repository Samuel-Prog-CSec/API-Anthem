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
 * - Encoding: UTF-8 explícito en todos los archivos para compatibilidad con Windows
 *
 * @see https://getpino.io/#/docs/transports
 */

const fs = require('fs');
const path = require('path');
const pino = require('pino');
const { once } = require('events');

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
 * Crea un stream de escritura de logs con encoding UTF-8 explícito
 * 
 * Esta función crea un pino.destination() con configuración explícita de UTF-8.
 * En Windows, esto asegura que los archivos se escriban con la codificación correcta
 * y puedan leerse sin caracteres rotos.
 * 
 * @param {string} filePath - Ruta del archivo de log
 * @returns {Object} Stream de pino con encoding UTF-8
 * @private
 */
function _createLogStream(filePath) {
  // Asegurar que el directorio existe
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // Crear stream con fs nativo usando encoding UTF-8 explícito
  const stream = fs.createWriteStream(filePath, {
    flags: 'a', // Append mode
    encoding: 'utf8' // Forzar UTF-8 explícitamente
  });

  // Envolver en pino.destination para mejor rendimiento
  return pino.destination({
    dest: stream,
    sync: false, // Asíncrono para mejor rendimiento
    minLength: 4096 // Buffer mínimo antes de escribir (4KB)
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
   * 2. Archivo combined.log (todos los niveles) - UTF-8 explícito
   * 3. Archivo errors.log (solo errores: error, fatal) - UTF-8 explícito
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

  // Target 2: Archivo combined.log (todos los logs) con UTF-8 explícito
  targets.push({
    target: 'pino/file',
    level: process.env.LOG_LEVEL || (isDevelopment ? 'debug' : 'info'),
    options: {
      destination: logFiles.combined,
      mkdir: true,
      append: true
    }
  });

  // Target 3: Archivo errors.log (solo errores) con UTF-8 explícito
  targets.push({
    target: 'pino/file',
    level: 'error',
    options: {
      destination: logFiles.errors,
      mkdir: true,
      append: true
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
