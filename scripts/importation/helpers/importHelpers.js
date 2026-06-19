/**
 * Helpers comunes para scripts de importación
 *
 * Funciones utilitarias compartidas entre los diferentes scripts
 * de importación de datos CSV.
 */

const fs = require('fs');
const path = require('path');
const { VALIDATION_LIMITS } = require('../../../src/constants');
const { normalizarTexto } = require('./normalizarEncoding');

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

/** Maximo de warnings por tipo de rechazo antes de degradar a debug */
const MAX_WARN_POR_RAZON = 10;

/** Numero por defecto de muestras a guardar por tipo de rechazo */
const MAX_SAMPLES_POR_RAZON = 5;

/**
 * Clase para tracking de estadísticas de rechazo.
 *
 * Ademas del conteo, guarda hasta `maxSamples` muestras por razon. Las muestras
 * permiten ver ejemplos concretos en el resumen final sin tener que rebuscar
 * en los logs verbose. Reservoir-style: nos quedamos con las primeras N porque
 * suelen ser las mas representativas y no inflar memoria.
 */
class RejectionTracker {
  constructor({ maxSamples = MAX_SAMPLES_POR_RAZON } = {}) {
    this.stats = {};
    this.samples = {};
    this.coercions = {};
    this.coercionSamples = {};
    this.maxSamples = maxSamples;
    this.totalRejected = 0;
    this.totalCoerced = 0;
  }

  /**
   * Registrar un rechazo, opcionalmente con una muestra del dato original.
   * @param {string} reason - Razon del rechazo (de REJECTION_REASONS)
   * @param {*} [sampleData] - Datos representativos de la fila rechazada
   */
  track(reason, sampleData) {
    if (!this.stats[reason]) {
      this.stats[reason] = 0;
      this.samples[reason] = [];
    }
    this.stats[reason]++;
    this.totalRejected++;

    if (sampleData !== undefined && this.samples[reason].length < this.maxSamples) {
      this.samples[reason].push(sampleData);
    }
  }

  /**
   * Decidir si esta razon debe loggearse como warn (primeras N veces) o
   * como debug (silencioso por defecto). Llama a track() internamente para
   * mantener el contador sincronizado y guardar samples.
   *
   * Uso tipico:
   *   const nivel = rejectionTracker.shouldLogWarn(reason, datosOriginales) ? 'warn' : 'debug';
   *   logger[nivel]({ ... }, mensaje);
   *
   * @param {string} reason - Razon del rechazo
   * @param {*} [sampleData] - Datos representativos para el sample
   * @returns {boolean} - true si debe ser warn, false si debe ser debug
   */
  shouldLogWarn(reason, sampleData) {
    this.track(reason, sampleData);
    return this.stats[reason] <= MAX_WARN_POR_RAZON;
  }

  /**
   * Obtener estadisticas de rechazos
   * @returns {Object}
   */
  getStats() {
    return {
      total: this.totalRejected,
      porTipo: { ...this.stats }
    };
  }

  /**
   * Resumen ordenado por frecuencia, sin samples (compatible con codigo previo).
   * @returns {Array<{razon: string, cantidad: number, porcentaje: string}>}
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
   * Resumen detallado con muestras representativas por razon.
   * Pensado para el JSON de salida y el resumen global.
   * @returns {Array<{razon: string, cantidad: number, porcentaje: string, muestras: Array}>}
   */
  getDetailedSummary() {
    return Object.entries(this.stats)
      .sort((a, b) => b[1] - a[1])
      .map(([reason, count]) => ({
        razon: reason,
        cantidad: count,
        porcentaje: this.totalRejected > 0
          ? ((count / this.totalRejected) * 100).toFixed(2)
          : '0.00',
        muestras: this.samples[reason] || []
      }));
  }

  /**
   * Registrar una coercion: dato que se modifico para poder ser insertado
   * (ej: fecha 29/02 en año no bisiesto coercida a 28/02). NO incrementa
   * el contador de rechazos. Se reporta separado en el resumen para
   * trazabilidad.
   *
   * @param {string} reason - Razon de la coercion
   * @param {*} [sampleData] - Datos de la fila antes/despues
   */
  coerce(reason, sampleData) {
    if (!this.coercions[reason]) {
      this.coercions[reason] = 0;
      this.coercionSamples[reason] = [];
    }
    this.coercions[reason]++;
    this.totalCoerced++;

    if (sampleData !== undefined && this.coercionSamples[reason].length < this.maxSamples) {
      this.coercionSamples[reason].push(sampleData);
    }
  }

  /**
   * Resumen detallado de coerciones con muestras.
   * @returns {Array<{razon: string, cantidad: number, muestras: Array}>}
   */
  getCoercionsSummary() {
    return Object.entries(this.coercions)
      .sort((a, b) => b[1] - a[1])
      .map(([reason, count]) => ({
        razon: reason,
        cantidad: count,
        muestras: this.coercionSamples[reason] || []
      }));
  }

  /**
   * Resetear estadisticas
   */
  reset() {
    this.stats = {};
    this.samples = {};
    this.coercions = {};
    this.coercionSamples = {};
    this.totalRejected = 0;
    this.totalCoerced = 0;
  }
}

/**
 * Parsear una fecha+hora en formato ISO o "YYYY-MM-DD HH:MM:SS" SIN
 * dejar que JavaScript aplique la zona horaria del sistema. Util para
 * series temporales donde la deriva por DST u offsets locales corrompe
 * el bucketing horario (ej. mediciones de trafico cada 15 min).
 *
 * Estrategia: parsear los componentes manualmente y construir el Date
 * con `Date.UTC(...)`. El resultado es el mismo instante UTC
 * independientemente de la TZ del runtime.
 *
 * Acepta:
 *   "2051-01-15 14:30:00"
 *   "2051-01-15T14:30:00"
 *   "2051-01-15T14:30:00Z"      (la Z se ignora; ya tratamos como UTC)
 *   "2051-01-15"                (hora se asume 00:00:00)
 *
 * @param {string} valor - Cadena de fecha
 * @returns {Date|null} Date en UTC, o null si el formato no es valido
 */
function parsearFechaHoraUTC(valor) {
  if (!valor || typeof valor !== 'string') {return null;}
  const limpio = valor.trim();
  if (!limpio) {return null;}

  // Regex para "YYYY-MM-DD" o "YYYY-MM-DD HH:MM:SS" o "YYYY-MM-DDTHH:MM:SS[Z]"
  const match = limpio.match(
    /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?Z?$/
  );
  if (!match) {return null;}

  const año = parseInt(match[1], 10);
  const mes = parseInt(match[2], 10);
  const dia = parseInt(match[3], 10);
  const hora = match[4] ? parseInt(match[4], 10) : 0;
  const min = match[5] ? parseInt(match[5], 10) : 0;
  const seg = match[6] ? parseInt(match[6], 10) : 0;

  // Validar rangos basicos antes de construir el Date
  if (mes < 1 || mes > 12) {return null;}
  if (dia < 1 || dia > 31) {return null;}
  if (hora < 0 || hora > 23) {return null;}
  if (min < 0 || min > 59) {return null;}
  if (seg < 0 || seg > 59) {return null;}

  // Date.UTC ignora la TZ del sistema y produce un instante absoluto.
  const ms = Date.UTC(año, mes - 1, dia, hora, min, seg);
  const fecha = new Date(ms);
  if (isNaN(fecha.getTime())) {return null;}

  // El dataset Anthem 2051 trae fechas que en el calendario gregoriano real
  // NO existen, sobre todo `2051-02-29` (2051 no es bisiesto): ~380 K filas de
  // trafico y ~147 de accidentes. JS las rebobina silenciosamente (Date.UTC
  // de 29/02 -> 01/03). Estas fechas se RECHAZAN explicitamente (return null):
  //
  // La version anterior intentaba "salvar" la fila coercionandola al ultimo
  // dia del mes (28/02), pero eso era enganoso y fragil: como el 28/02 REAL ya
  // existe con las mismas claves (puntoMedidaId+fecha en trafico), la fila
  // coercionada colisionaba en el indice unico y se descartaba IGUAL -- y, peor,
  // segun el orden de insercion podia PISAR los valores reales del 28/02 con los
  // del 29. Rechazar la fecha inexistente es la opcion correcta y deterministica:
  // 2051-02-29 no existe, asi que no debe almacenarse ni corromper el 28/02.
  // Cualquier otro rebobinado (mes 13, 31 en mes corto, etc.) es igualmente un
  // error real del CSV y se rechaza.
  if (fecha.getUTCFullYear() !== año ||
      fecha.getUTCMonth() !== mes - 1 ||
      fecha.getUTCDate() !== dia) {
    return null;
  }

  return fecha;
}

/**
 * Parsear una fecha solo-dia (sin hora) en UTC, con la misma politica de
 * coercion que `parsearFechaHoraUTC` para el caso `29/02` en año no
 * bisiesto.
 *
 * Existe porque varios importadores (aforo-bicicletas, aforo-peatones,
 * bicicletas, calidad-aire) tienen su propia funcion `parsearFecha` que
 * llama directamente a `Date.UTC(y, m, d)`. JS acepta `Date.UTC(2051, 1, 29)`
 * silenciosamente y devuelve `2051-03-01`, por lo que esos importadores:
 *   1. Insertan la fila del 29/02 etiquetada como 01/03 en BD.
 *   2. Cuando llega la fila REAL del 01/03 con misma clave, la rechazan
 *      como duplicada (o la pisan en modo upsert).
 *
 * Auditoria de impacto medido al detectar el bug:
 *   - aforo-peatones: 452 grupos con valores distintos (hasta 4 965 peatones/h sobrescritos)
 *   - aforo-bicicletas: 632 grupos con valores distintos (hasta 96 bicis/h)
 *   - calidad-aire: 148 mediciones del 01/03 sobrescritas
 *   - bicicletas (disponibilidad diaria): 1 doc sobrescrito
 *
 * Este helper:
 *   - Devuelve `Date` con el dia solicitado cuando es valido en el calendario.
 *   - Devuelve `null` para fechas inexistentes (29/02 en año no bisiesto, 31/04,
 *     mes 13, etc.): se RECHAZAN en vez de coercerlas, para no corromper los
 *     datos reales del dia vecino (28/02, 01/03) segun el orden de insercion.
 *   - Devuelve `null` para componentes fuera de rango (mes 0, dia negativo, etc).
 *
 * Se mantiene el objeto `{ fecha, coercida }` por compatibilidad con los callers
 * (RejectionTracker). Tras eliminar la coercion, `coercida` es siempre `false`.
 *
 * @param {number} año
 * @param {number} mes - Mes en base 1 (enero=1)
 * @param {number} dia
 * @returns {{fecha: Date, coercida: boolean}|null} null si no se puede parsear
 */
function parsearFechaSoloDiaUTC(año, mes, dia) {
  if (!Number.isInteger(año) || !Number.isInteger(mes) || !Number.isInteger(dia)) {
    return null;
  }
  if (mes < 1 || mes > 12) {return null;}
  if (dia < 1 || dia > 31) {return null;}

  const fecha = new Date(Date.UTC(año, mes - 1, dia));
  if (isNaN(fecha.getTime())) {return null;}

  // Fechas inexistentes (29/02 en año no bisiesto, 31/04, etc.): JS las
  // rebobina al mes siguiente. Se RECHAZAN (return null) en vez de coercerlas
  // al ultimo dia del mes original: coercer arriesgaba PISAR los datos reales
  // del 28/02 (o del 01/03) segun el orden de insercion -- justo el tipo de
  // corrupcion documentada arriba. Rechazar la fecha inexistente es
  // deterministico y no corrompe fechas vecinas.
  if (fecha.getUTCFullYear() !== año ||
      fecha.getUTCMonth() !== mes - 1 ||
      fecha.getUTCDate() !== dia) {
    return null;
  }

  return { fecha, coercida: false };
}

/**
 * Parsear número con manejo de valores vacíos y formatos.
 *
 * **Comportamiento permisivo**: usa `parseFloat` que acepta strings con
 * sufijo no numerico (ej. "12abc" -> 12). Es util para CSVs con unidades
 * adheridas o whitespace residual, pero puede enmascarar datos corruptos.
 *
 * Para validacion estricta usar `parseNumeroEstricto` (devuelve null si
 * el string no es un numero completo).
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
 * Parsear numero con formato espanol clasico: punto como separador de
 * miles + coma como decimal. Pensado para datos municipales tipo
 * "1.085,25" -> 1085.25. A diferencia de `parseNumber`, que solo
 * reemplaza una coma, esta variante elimina TODOS los puntos antes de
 * convertir la coma en punto decimal.
 *
 *   parsearNumeroFormatoEspanol('1.085,25') -> 1085.25
 *   parsearNumeroFormatoEspanol('1,5')      -> 1.5
 *   parsearNumeroFormatoEspanol('1085')     -> 1085
 *   parsearNumeroFormatoEspanol('')         -> defaultValue
 *   parsearNumeroFormatoEspanol('abc')      -> defaultValue
 *
 * @param {string|number} value
 * @param {number} [defaultValue=0]
 * @returns {number}
 */
function parsearNumeroFormatoEspanol(value, defaultValue = 0) {
  if (value === null || value === undefined || value === '') {
    return defaultValue;
  }

  const normalized = value.toString()
    .replace(/\./g, '')
    .replace(/,/g, '.');

  const parsed = parseFloat(normalized);
  return isNaN(parsed) ? defaultValue : parsed;
}

/**
 * Variante estricta de `parseNumber`. A diferencia del permisivo, exige
 * que el string completo sea un numero valido tras limpieza:
 *
 *   parseNumeroEstricto('12abc')      -> null   (parseNumber: 12)
 *   parseNumeroEstricto('12.5')       -> 12.5
 *   parseNumeroEstricto('1,5')        -> 1.5    (acepta coma decimal)
 *   parseNumeroEstricto('  -3.7 ')    -> -3.7   (acepta espacios)
 *   parseNumeroEstricto('1.2.3')      -> null
 *   parseNumeroEstricto('')           -> null
 *
 * Recomendado para campos donde un sufijo no numerico indica corrupcion
 * de datos (coordenadas, importes, IDs numericos).
 *
 * @param {string|number} value
 * @returns {number|null}
 */
function parseNumeroEstricto(value) {
  if (value === null || value === undefined) {return null;}
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  const cleaned = String(value)
    .replace(/['"]/g, '')
    .replace(',', '.')
    .trim();

  if (!cleaned) {return null;}

  // Number() es mas estricto que parseFloat: 'abc' -> NaN, '12abc' -> NaN.
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
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
 * Limpiar string removiendo comillas, espacios extras y normalizando
 * mojibake (caracter U+FFFD) para corregir encoding latin1 erroneo
 * de los CSV del dataset (habitual en campos de distrito, barrio y
 * descripciones). Delega en normalizarTexto() para las sustituciones
 * deterministas.
 *
 * @param {string} value - Valor a limpiar
 * @param {string} defaultValue - Valor por defecto si vacio
 * @returns {string}
 */
function cleanString(value, defaultValue = '') {
  return normalizarTexto(value, defaultValue);
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

/** Directorio donde se escriben los resumenes de import */
const IMPORT_SUMMARIES_DIR = path.join(__dirname, '..', '..', '..', 'logs', 'import');

/**
 * Escribir un resumen estructurado del import a disco.
 *
 * Cada llamada genera dos archivos:
 *   - logs/import/<importerKey>-<isoTimestamp>.json (historico)
 *   - logs/import/<importerKey>-latest.json (sobrescribe; lo lee importAll)
 *
 * El JSON estructurado evita la perdida de informacion que provoca pino-pretty
 * cuando el padre re-emite los logs del child via execFile (la estructura JSON
 * queda partida en lineas distintas y deja de ser parseable).
 *
 * @param {string} importerKey - Clave del importer (ej. "accidentes", "ubicaciones")
 * @param {Object} summary - Datos del resumen
 * @returns {Object} - { latestPath, historicalPath }
 */
function writeImportSummary(importerKey, summary) {
  if (!fs.existsSync(IMPORT_SUMMARIES_DIR)) {
    fs.mkdirSync(IMPORT_SUMMARIES_DIR, { recursive: true });
  }

  const finishedAt = summary.finishedAt || new Date().toISOString();
  const safeTimestamp = finishedAt.replace(/[:.]/g, '-');

  const enriched = {
    importer: importerKey,
    finishedAt,
    ...summary
  };

  const json = JSON.stringify(enriched, null, 2);
  const historicalPath = path.join(IMPORT_SUMMARIES_DIR, `${importerKey}-${safeTimestamp}.json`);
  const latestPath = path.join(IMPORT_SUMMARIES_DIR, `${importerKey}-latest.json`);

  fs.writeFileSync(historicalPath, json);
  fs.writeFileSync(latestPath, json);

  return { latestPath, historicalPath };
}

/**
 * Helper alto-nivel: construye y escribe el summary tomando datos del tracker
 * y de los contadores del importer. Idempotente y resistente a errores
 * (no propaga excepciones si la escritura falla, solo lo loggea por consola).
 *
 * @param {string} importerKey - Clave del importer
 * @param {Object} options
 * @param {number} options.startTime - timestamp de inicio (Date.now())
 * @param {Object} options.counts - { totalProcessed, inserted, rejected, errors, ... }
 * @param {RejectionTracker} [options.rejectionTracker]
 * @param {Object} [options.extras] - Campos adicionales a incluir
 * @returns {Object|null} - Resultado de writeImportSummary o null si fallo
 */
function buildAndWriteSummary(importerKey, { startTime, counts, rejectionTracker, extras = {} }) {
  try {
    return writeImportSummary(importerKey, {
      startedAt: new Date(startTime).toISOString(),
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - startTime,
      counts,
      rejections: rejectionTracker?.getDetailedSummary?.() || [],
      coercions: rejectionTracker?.getCoercionsSummary?.() || [],
      ...extras
    });
  } catch (error) {
    // No queremos que un fallo de logging tumbe el importer
    process.stderr.write(`[buildAndWriteSummary] Error escribiendo resumen de '${importerKey}': ${error.message}\n`);
    return null;
  }
}

module.exports = {
  extractDateFromFileName,
  isValidMonthYear,
  RejectionTracker,
  MAX_WARN_POR_RAZON,
  MAX_SAMPLES_POR_RAZON,
  parseNumber,
  parseNumeroEstricto,
  parsearNumeroFormatoEspanol,
  parseInteger,
  parsearFechaHoraUTC,
  parsearFechaSoloDiaUTC,
  cleanString,
  isValidUTMCoordinate,
  formatDuration,
  calculateProcessingSpeed,
  writeImportSummary,
  buildAndWriteSummary,
  IMPORT_SUMMARIES_DIR
};
