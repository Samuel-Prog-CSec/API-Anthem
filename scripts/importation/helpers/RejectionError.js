/**
 * Clase RejectionError
 *
 * Error tipado para senalar rechazos de filas en los importers. Lleva un
 * `code` (uno de los valores de REJECTION_REASONS del importer) separado
 * del mensaje, para que el codigo de captura no tenga que parsear el
 * `error.message` con regex frágiles (split(':'), etc.).
 *
 * Uso:
 *   const { RejectionError } = require('./helpers/RejectionError');
 *
 *   if (!fechaStr) {
 *     throw new RejectionError(REJECTION_REASONS.FECHA_FALTANTE,
 *       'fecha vacia en CSV', { fecha: row.fecha });
 *   }
 *
 *   // En el catch:
 *   try { ... } catch (e) {
 *     if (e instanceof RejectionError) {
 *       rejectionTracker.track(e.code, e.sampleData);
 *     } else {
 *       throw e;
 *     }
 *   }
 */

class RejectionError extends Error {
  /**
   * @param {string} code - Codigo de razon de rechazo (ej. 'FECHA_FALTANTE')
   * @param {string} [message] - Mensaje legible. Si se omite, se usa el code.
   * @param {*} [sampleData] - Datos de la fila relevantes para diagnostico
   */
  constructor(code, message, sampleData) {
    super(message || code);
    this.name = 'RejectionError';
    this.code = code;
    this.sampleData = sampleData;
    // Mantener el stack util en V8
    if (typeof Error.captureStackTrace === 'function') {
      Error.captureStackTrace(this, RejectionError);
    }
  }
}

module.exports = { RejectionError };
