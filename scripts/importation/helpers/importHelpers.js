/**
 * Helpers comunes para scripts de importación
 *
 * Funciones utilitarias compartidas entre los diferentes scripts
 * de importación de datos CSV.
 */

const { VALIDATION_LIMITS } = require('../../../src/constants');

/**
 * Extraer mes y año del nombre de un archivo
 * Soporta formatos: MMAAAA, MM_AAAA, AAAA_MM
 *
 * @param {string} fileName - Nombre del archivo
 * @returns {Object|null} - { mes, año } o null si no se puede extraer
 */
function extractDateFromFileName(fileName) {
  if (!fileName) {
    return null;
  }

  // Formato MMAAAA (ej: 012051, 122051)
  let match = fileName.match(/(\d{2})(\d{4})/);
  if (match) {
    const mes = parseInt(match[1]);
    const año = parseInt(match[2]);

    if (isValidMonthYear(mes, año)) {
      return { mes, año };
    }
  }

  // Formato AAAA_MM o AAAA-MM
  match = fileName.match(/(\d{4})[_-](\d{2})/);
  if (match) {
    const año = parseInt(match[1]);
    const mes = parseInt(match[2]);

    if (isValidMonthYear(mes, año)) {
      return { mes, año };
    }
  }

  // Formato MM_AAAA o MM-AAAA
  match = fileName.match(/(\d{2})[_-](\d{4})/);
  if (match) {
    const mes = parseInt(match[1]);
    const año = parseInt(match[2]);

    if (isValidMonthYear(mes, año)) {
      return { mes, año };
    }
  }

  return null;
}

/**
 * Validar que mes y año están en rangos válidos
 *
 * @param {number} mes - Mes (1-12)
 * @param {number} año - Año
 * @returns {boolean}
 */
function isValidMonthYear(mes, año) {
  return (
    mes >= VALIDATION_LIMITS.MONTH_MIN &&
    mes <= VALIDATION_LIMITS.MONTH_MAX &&
    año >= VALIDATION_LIMITS.YEAR_MIN &&
    año <= VALIDATION_LIMITS.YEAR_MAX
  );
}

/**
 * Clase para tracking de estadísticas de rechazo
 */
class RejectionTracker {
  constructor() {
    this.stats = {};
    this.totalRejected = 0;
  }

  /**
   * Registrar un rechazo
   * @param {string} reason - Razón del rechazo (de REJECTION_REASONS)
   */
  track(reason) {
    if (!this.stats[reason]) {
      this.stats[reason] = 0;
    }
    this.stats[reason]++;
    this.totalRejected++;
  }

  /**
   * Obtener estadísticas de rechazos
   * @returns {Object}
   */
  getStats() {
    return {
      total: this.totalRejected,
      porTipo: { ...this.stats }
    };
  }

  /**
   * Obtener resumen ordenado por frecuencia
   * @returns {Array}
   */
  getSortedSummary() {
    return Object.entries(this.stats)
      .sort((a, b) => b[1] - a[1])
      .map(([reason, count]) => ({
        razon: reason,
        cantidad: count,
        porcentaje: this.totalRejected > 0
          ? ((count / this.totalRejected) * 100).toFixed(2)
          : '0.00'
      }));
  }

  /**
   * Resetear estadísticas
   */
  reset() {
    this.stats = {};
    this.totalRejected = 0;
  }
}

/**
 * Parsear número con manejo de valores vacíos y formatos
 *
 * @param {string|number} value - Valor a parsear
 * @param {number} defaultValue - Valor por defecto si inválido
 * @returns {number}
 */
function parseNumber(value, defaultValue = 0) {
  if (value === null || value === undefined || value === '') {
    return defaultValue;
  }

  const cleaned = value.toString()
    .replace(/['"]/g, '')
    .replace(',', '.')
    .trim();

  const parsed = parseFloat(cleaned);
  return isNaN(parsed) ? defaultValue : parsed;
}

/**
 * Parsear entero con manejo de valores vacíos
 *
 * @param {string|number} value - Valor a parsear
 * @param {number} defaultValue - Valor por defecto si inválido
 * @param {boolean} ensurePositive - Si true, garantiza valor >= 0
 * @returns {number}
 */
function parseInteger(value, defaultValue = 0, ensurePositive = false) {
  const num = parseNumber(value, defaultValue);
  const result = Math.floor(num);
  return ensurePositive ? Math.max(0, result) : result;
}

/**
 * Limpiar string removiendo comillas y espacios extras
 *
 * @param {string} value - Valor a limpiar
 * @param {string} defaultValue - Valor por defecto si vacío
 * @returns {string}
 */
function cleanString(value, defaultValue = '') {
  if (!value) {
    return defaultValue;
  }
  return value.toString().replace(/['"]/g, '').trim() || defaultValue;
}

/**
 * Validar coordenadas UTM para España
 *
 * @param {number} x - Coordenada X
 * @param {number} y - Coordenada Y
 * @returns {boolean}
 */
function isValidUTMCoordinate(x, y) {
  return (
    x >= VALIDATION_LIMITS.UTM_X_MIN &&
    x <= VALIDATION_LIMITS.UTM_X_MAX &&
    y >= VALIDATION_LIMITS.UTM_Y_MIN &&
    y <= VALIDATION_LIMITS.UTM_Y_MAX
  );
}

/**
 * Formatear duración en formato legible
 *
 * @param {number} ms - Milisegundos
 * @returns {string}
 */
function formatDuration(ms) {
  if (ms < 1000) {
    return `${ms}ms`;
  }
  if (ms < 60000) {
    return `${(ms / 1000).toFixed(2)}s`;
  }
  const minutes = Math.floor(ms / 60000);
  const seconds = ((ms % 60000) / 1000).toFixed(0);
  return `${minutes}m ${seconds}s`;
}

/**
 * Calcular velocidad de procesamiento
 *
 * @param {number} records - Número de registros
 * @param {number} durationMs - Duración en milisegundos
 * @returns {string}
 */
function calculateProcessingSpeed(records, durationMs) {
  if (durationMs <= 0) {
    return '0 reg/s';
  }
  const speed = Math.floor(records / (durationMs / 1000));
  return `${speed.toLocaleString()} reg/s`;
}

module.exports = {
  extractDateFromFileName,
  isValidMonthYear,
  RejectionTracker,
  parseNumber,
  parseInteger,
  cleanString,
  isValidUTMCoordinate,
  formatDuration,
  calculateProcessingSpeed
};
