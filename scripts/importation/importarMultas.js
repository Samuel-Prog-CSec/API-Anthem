/**
 * Script de Importación de Multas
 *
 * Script especializado para importar datos CSV de multas de tráfico
 * a la base de datos MongoDB. Procesa todos los archivos de multas
 * del directorio datos_hpe/Multas/
 */

process.env.SCRIPT_MODE = 'true';

const fs = require('fs').promises;
const path = require('path');
const csv = require('csv-parser');
const mongoose = require('mongoose');
const { connectDB } = require('../../src/config/database');
const config = require('../../src/config/config');
const Fine = require('../../src/models/Multa');
const { importarMultasLogger: logger } = require('../../src/config/scriptLogger');
const { handleMongoError } = require('../../src/utils/errorUtils');
const { VALIDATION_LIMITS, SEVERITY_LEVELS, INFRACTION_TYPES, FINE_CONFIG } = require('../../src/constants');
const { normalizarTexto, crearLectorCSV } = require('./helpers/normalizarEncoding');
const { extraerCoordenadasModulo } = require('./helpers/coordenadas');
const {
  extractDateFromFileName,
  RejectionTracker,
  formatDuration,
  calculateProcessingSpeed,
  buildAndWriteSummary
} = require('./helpers/importHelpers');

// ============================================================================
// CONFIGURACIÓN
// ============================================================================

const IMPORT_CONFIG = {
  dataDirectory: path.join(__dirname, '..', '..', 'datos_hpe', 'Multas'),
  batchSize: 10000,
  skipExisting: true,
  logInterval: 50000,
  maxParallel: 3
};

// ============================================================================
// RAZONES DE RECHAZO
// ============================================================================

/**
 * Razones de rechazo para filas que no se insertan en la BD
 * @constant {Object}
 */
const REJECTION_REASONS = {
  // Campos obligatorios faltantes
  ARCHIVO_SIN_FECHA: 'No se pudo extraer mes/año del nombre del archivo',

  // Validación de campos
  CALIFICACION_INVALIDA: 'Calificacion de multa invalida (esperado: LEVE, GRAVE, MUY GRAVE)',
  IMPORTE_NEGATIVO: 'Importe del boletin negativo',
  PUNTOS_FUERA_RANGO: `Puntos detraidos fuera de rango (${VALIDATION_LIMITS.DRIVER_POINTS_MIN}-${VALIDATION_LIMITS.DRIVER_POINTS_MAX})`,
  COORDENADA_X_INVALIDA: 'Coordenada X invalida o fuera de rango',
  COORDENADA_Y_INVALIDA: 'Coordenada Y invalida o fuera de rango',
  VELOCIDAD_LIMITE_INVALIDA: 'Velocidad limite invalida',
  VELOCIDAD_CIRCULACION_INVALIDA: 'Velocidad de circulacion invalida',

  // Errores de procesamiento
  ERROR_PROCESAMIENTO_FILA: 'Error durante el procesamiento de la fila',
  ERROR_VALIDACION_MONGOOSE: 'Error de validacion de esquema Mongoose',
  ERROR_INSERCION_BD: 'Error al insertar en base de datos',
  ERROR_DUPLICADO: 'Registro duplicado en base de datos'
};

// ============================================================================
// CONTADORES GLOBALES
// ============================================================================

let totalProcessed = 0;
let totalInserted = 0;
let totalSkipped = 0;
let totalRejected = 0;
let totalErrors = 0;
let isShuttingDown = false;

// Tracker de rechazos por tipo
const rejectionTracker = new RejectionTracker();

// ============================================================================
// FUNCIONES DE CALCULO DE CAMPOS DERIVADOS
// ============================================================================

// Detector de multas de velocidad por descripcion textual.
// Cubre los patrones "SOBREPASAR LA VELOCIDAD M(AÁ)XIMA", "EXCEDER (LA)
// VELOCIDAD M(AÁ)XIMA" y "EXCESO DE VELOCIDAD". Sensible a tildes con
// y sin acento porque el dataset municipal mezcla ambas formas.
const REGEX_DESCRIPCION_VELOCIDAD = /(SOBREPAS(AR|ANDO).+VELOCIDAD\s+M[AÁ]XIMA|EXCEDE(R|NDO).+VELOCIDAD\s+M[AÁ]XIMA|EXCESO\s+DE\s+VELOCIDAD)/;

/**
 * Clasificar el tipo de infraccion por palabras clave en la descripcion.
 *
 * Bug previo: el clasificador solo distinguia VELOCIDAD vs OTRAS, dejando 5 de
 * las 7 categorias del enum INFRACTION_TYPES a 0 docs y ~78% de las multas en
 * OTRAS, pese a que la descripcion (columna HECHO-BOL) identifica claramente
 * estacionamiento, semaforo, alcohol/drogas, telefono y documentacion.
 * Los patrones se eligen tolerantes al mojibake del CSV (acentos perdidos):
 * se apoyan en raices sin tilde (ESTACIONAR, TELEFON, SEMAFORO/FASE ROJA...).
 *
 * @param {string} descripcion - Descripcion de la infraccion EN MAYUSCULAS.
 * @param {boolean} esVelocidad - Si ya se detecto exceso de velocidad.
 * @returns {string} Valor de INFRACTION_TYPES.
 */
function clasificarTipoInfraccion(descripcion, esVelocidad) {
  if (esVelocidad) { return INFRACTION_TYPES.VELOCIDAD; }
  const d = descripcion || '';
  if (/ESTACIONAR|ESTACIONAMIENTO|DOBLE\s+FILA|EN\s+VADO|ZONA\s+(SER|ORA)|APARCAR/.test(d)) {
    return INFRACTION_TYPES.ESTACIONAMIENTO;
  }
  if (/SEM[A-Z]?FORO|FASE\s+ROJA|LUZ\s+ROJA/.test(d)) {
    return INFRACTION_TYPES.SEMAFORO;
  }
  if (/ALCOHOL|ALCOHOLEMIA|DROGA|ESTUPEFACIENTE/.test(d)) {
    return INFRACTION_TYPES.ALCOHOL_DROGAS;
  }
  if (/TELEFON|TEL.{0,2}FON|NAVEGADOR|DISPOSITIVO|PANTALLA/.test(d)) {
    return INFRACTION_TYPES.TELEFONO_MOVIL;
  }
  if (/DOCUMENTACI|PERMISO\s+DE\s+CONDUC|CARN[E-Z]|SEGURO\s+OBLIGAT|\bITV\b|LICENCIA/.test(d)) {
    return INFRACTION_TYPES.DOCUMENTACION;
  }
  return INFRACTION_TYPES.OTRAS;
}

/**
 * Calcular campos derivados de una multa.
 * Replica la logica del hook pre('save') del modelo Fine, ya que
 * bulkWrite NO ejecuta middleware de Mongoose.
 *
 * @param {Object} multa - Datos de la multa
 * @returns {Object} - Multa con campos derivados calculados
 */
function calcularCamposDerivadosMulta(multa) {
  // Calcular importe final con descuento
  if (multa.tieneDescuento && multa.importeBoletín) {
    multa.importeFinal = multa.importeBoletín * FINE_CONFIG.DISCOUNT_RATE;
  } else {
    multa.importeFinal = multa.importeBoletín;
  }

  // Calcular exceso de velocidad si aplica
  const vel = multa.datosVelocidad;
  if (vel && vel.velocidadLimite && vel.velocidadCirculacion) {
    vel.exceso = Math.max(0, vel.velocidadCirculacion - vel.velocidadLimite);
  }

  // Inicializar metadatos.
  //
  // Bug previo: tipoInfraccion solo era VELOCIDAD si el CSV traia los
  // campos numericos VEL_LIMITE y VEL_CIRCULA. Pero muchas multas que en
  // la descripcion explicitan "SOBREPASAR LA VELOCIDAD MAXIMA..." vienen
  // SIN esos numericos, asi que el 98 % de las multas acababan como
  // 'OTRAS' aunque la descripcion las identifique como exceso de
  // velocidad. Ahora se detecta tambien via descripcion.
  //
  // La regex cubre las dos formas habituales que aparecen en el dataset
  // ("VELOCIDAD MAXIMA" y "EXCESO ... VELOCIDAD ...").
  const tieneDatosVelocidad = Boolean(vel && vel.velocidadLimite && vel.velocidadCirculacion);
  const descripcion = (multa.descripcionInfraccion || '').toUpperCase();
  const descripcionEsVelocidad = REGEX_DESCRIPCION_VELOCIDAD.test(descripcion);
  const esVelocidad = tieneDatosVelocidad || descripcionEsVelocidad;

  multa.metadatos = {
    tipoInfraccion: clasificarTipoInfraccion(descripcion, esVelocidad),
    esInfraccionGrave: multa.calificacion === SEVERITY_LEVELS.FINE.GRAVE ||
                       multa.calificacion === SEVERITY_LEVELS.FINE.MUY_GRAVE,
    esInfraccionVelocidad: esVelocidad,
    zonaUrbana: true
  };

  return multa;
}

// ============================================================================
// FUNCIONES DE PARSEO
// ============================================================================

/**
 * Parsear datos de una fila CSV de multas
 * @param {Object} row - Fila del CSV
 * @param {string} sourceFile - Archivo origen
 * @param {number} rowIndex - Índice de fila para logging
 * @returns {Object|null} - Datos procesados para la multa o null si se rechaza
 */
function parseMultaRow(row, sourceFile, rowIndex) {
  // Extraer mes y año del nombre del archivo usando helper
  const dateInfo = extractDateFromFileName(sourceFile);
  if (!dateInfo) {
    const razon = REJECTION_REASONS.ARCHIVO_SIN_FECHA;
    const nivel = rejectionTracker.shouldLogWarn(razon, { archivo: sourceFile }) ? 'warn' : 'debug';
    logger[nivel]({
      fila: rowIndex,
      razon,
      datosOriginales: { archivo: sourceFile }
    }, 'Fila rechazada: no se pudo extraer fecha del archivo');
    return null;
  }

  let { mes, año } = dateInfo;

  // Preferir MES y ANIO de la propia fila del CSV si estan disponibles
  const mesCSV = row.MES ? parseInt(row.MES, 10) : null;
  const añoCSV = row.ANIO ? parseInt(row.ANIO, 10) : null;
  if (mesCSV && !isNaN(mesCSV) && mesCSV >= 1 && mesCSV <= 12) {
    mes = mesCSV;
  }
  if (añoCSV && !isNaN(añoCSV) && añoCSV >= 2000) {
    año = añoCSV;
  }

  // Crear fecha basada en mes y año (UTC para evitar desfases de TZ)
  const fecha = new Date(Date.UTC(año, mes - 1, 1));

  // Procesar coordenadas via framework unificado.
  // Multas tiene perfil con utm.unidades='m' y wgs84=null. Coordenadas
  // opcionales: si no estan, geometry sera null (no rechaza la fila).
  let coordenadas = {};
  let geometryDerivada = null;
  try {
    const coords = extraerCoordenadasModulo(row, 'multas');
    if (coords) {
      coordenadas = coords.utm ? { x: coords.utm.x, y: coords.utm.y } : {};
      geometryDerivada = coords.geometry;
      // Reportar advertencias del cross-check sin rechazar
      for (const adv of coords.advertencias) {
        const razon = REJECTION_REASONS.COORDENADA_X_INVALIDA;
        if (rejectionTracker.shouldLogWarn(razon, { advertencia: adv, fila: rowIndex })) {
          logger.warn({ fila: rowIndex, advertencia: adv }, 'Coordenadas con advertencia');
        }
      }
    }
  } catch (e) {
    // Solo deberia ocurrir si perfil.requerida=true; multas tiene false.
    logger.debug({ fila: rowIndex, error: e.message }, 'extraerCoordenadasModulo lanzo excepcion en multas');
  }

  // Procesar datos de velocidad
  const datosVelocidad = {};
  if (row.VEL_LIMITE && row.VEL_LIMITE.trim() !== '') {
    const velLimite = parseInt(row.VEL_LIMITE);
    if (!isNaN(velLimite) && velLimite >= VALIDATION_LIMITS.SPEED_MIN && velLimite <= VALIDATION_LIMITS.SPEED_MAX) {
      datosVelocidad.velocidadLimite = velLimite;
    } else if (!isNaN(velLimite)) {
      const razon = REJECTION_REASONS.VELOCIDAD_LIMITE_INVALIDA;
      const nivel = rejectionTracker.shouldLogWarn(razon, { velocidadLimite: row.VEL_LIMITE, valor: velLimite }) ? 'warn' : 'debug';
      logger[nivel]({
        fila: rowIndex,
        razon,
        datosOriginales: { velocidadLimite: row.VEL_LIMITE, valor: velLimite }
      }, 'Velocidad limite fuera de rango - se omite');
    }
  }

  if (row.VEL_CIRCULA && row.VEL_CIRCULA.trim() !== '') {
    const velCircula = parseInt(row.VEL_CIRCULA);
    if (!isNaN(velCircula) && velCircula >= VALIDATION_LIMITS.SPEED_MIN && velCircula <= VALIDATION_LIMITS.SPEED_MAX) {
      datosVelocidad.velocidadCirculacion = velCircula;
    } else if (!isNaN(velCircula)) {
      const razon = REJECTION_REASONS.VELOCIDAD_CIRCULACION_INVALIDA;
      const nivel = rejectionTracker.shouldLogWarn(razon, { velocidadCirculacion: row.VEL_CIRCULA, valor: velCircula }) ? 'warn' : 'debug';
      logger[nivel]({
        fila: rowIndex,
        razon,
        datosOriginales: { velocidadCirculacion: row.VEL_CIRCULA, valor: velCircula }
      }, 'Velocidad de circulacion fuera de rango - se omite');
    }
  }

  // Procesar importe
  const importeStr = row.IMP_BOL ? row.IMP_BOL.replace(',', '.').trim() : '0';
  const importe = parseFloat(importeStr) || 0;

  if (importe < 0) {
    const razon = REJECTION_REASONS.IMPORTE_NEGATIVO;
    const nivel = rejectionTracker.shouldLogWarn(razon, { importe: row.IMP_BOL, valor: importe }) ? 'warn' : 'debug';
    logger[nivel]({
      fila: rowIndex,
      razon,
      datosOriginales: { importe: row.IMP_BOL, valor: importe }
    }, 'Importe negativo - se convierte a 0');
  }

  // Procesar puntos
  const puntos = parseInt(row.PUNTOS) || 0;
  if (puntos < VALIDATION_LIMITS.DRIVER_POINTS_MIN || puntos > VALIDATION_LIMITS.DRIVER_POINTS_MAX) {
    const razon = REJECTION_REASONS.PUNTOS_FUERA_RANGO;
    const nivel = rejectionTracker.shouldLogWarn(razon, { puntos: row.PUNTOS, valor: puntos }) ? 'warn' : 'debug';
    logger[nivel]({
      fila: rowIndex,
      razon,
      datosOriginales: { puntos: row.PUNTOS, valor: puntos }
    }, `Puntos fuera de rango (${VALIDATION_LIMITS.DRIVER_POINTS_MIN}-${VALIDATION_LIMITS.DRIVER_POINTS_MAX}) - se usa valor original`);
  }

  // Procesar descuento
  const tieneDescuento = row.DESCUENTO &&
    (row.DESCUENTO.toLowerCase().includes('si') || row.DESCUENTO.toLowerCase().includes('sí'));

  // Validar calificación
  // Detectamos dos casos en los que asumimos LEVE como fallback:
  //   1. CALIFICACION viene vacia / null en el CSV.
  //   2. CALIFICACION trae un valor que no encaja en {LEVE, GRAVE, MUY GRAVE}.
  // En ambos casos guardamos calificacionInferida=true en metadatos para
  // que el BI pueda separar LEVE real de LEVE inferido sin reparsear logs.
  const calificacionOriginal = row.CALIFICACION;
  let calificacionRaw = (calificacionOriginal || SEVERITY_LEVELS.FINE.LEVE).toUpperCase().trim();

  // Normalizar valores conocidos que difieren de la constante
  if (calificacionRaw === 'MUY GRAVE') {
    calificacionRaw = SEVERITY_LEVELS.FINE.MUY_GRAVE;
  }

  const calificacionesValidas = [SEVERITY_LEVELS.FINE.LEVE, SEVERITY_LEVELS.FINE.GRAVE, SEVERITY_LEVELS.FINE.MUY_GRAVE];
  const calificacionEsValida = calificacionesValidas.includes(calificacionRaw);
  const calificacion = calificacionEsValida ? calificacionRaw : SEVERITY_LEVELS.FINE.LEVE;

  // Inferida = no habia calificacion en el CSV o llego invalida.
  // Si llego LEVE de forma explicita y valida, NO se considera inferida.
  const calificacionInferida = !calificacionOriginal || !calificacionEsValida;

  if (!calificacionEsValida && calificacionRaw !== SEVERITY_LEVELS.FINE.LEVE) {
    const razon = REJECTION_REASONS.CALIFICACION_INVALIDA;
    const nivel = rejectionTracker.shouldLogWarn(razon, { calificacion: calificacionOriginal, valorUsado: SEVERITY_LEVELS.FINE.LEVE }) ? 'warn' : 'debug';
    logger[nivel]({
      fila: rowIndex,
      razon,
      datosOriginales: { calificacion: calificacionOriginal, valorUsado: SEVERITY_LEVELS.FINE.LEVE }
    }, 'Calificacion invalida - se usa LEVE por defecto');
  }

  // Geometry GeoJSON ya viene derivada del framework (puede ser null si
  // no habia coordenadas validas en el CSV).
  const geometry = geometryDerivada;

  // Crear objeto de multa (campos de texto normalizados para corregir
  // mojibake latin1 del CSV).
  //
  // OJO: si `geometry` es null, NO incluimos la clave en el objeto. Si
  // pasaramos `geometry: undefined`, Mongoose detecta el path y aplica
  // los defaults del subdocumento (geometry.type='Point'), generando
  // `{ type: 'Point' }` sin `coordinates`, que el indice 2dsphere
  // rechaza silenciosamente y rompe TODA la insercion del batch.
  const multa = {
    fecha,
    mes,
    año,
    hora: row.HORA || '00.00',
    calificacion,
    lugar: normalizarTexto(row.LUGAR, 'NO ESPECIFICADO'),
    importeBoletín: Math.max(0, importe),
    tieneDescuento,
    puntosDetraídos: Math.max(0, Math.min(puntos, VALIDATION_LIMITS.DRIVER_POINTS_MAX)),
    denunciante: normalizarTexto(row.DENUNCIANTE, 'NO ESPECIFICADO'),
    descripcionInfraccion: normalizarTexto(row['HECHO-BOL']),
    datosVelocidad: Object.keys(datosVelocidad).length > 0 ? datosVelocidad : undefined,
    procesamiento: {
      archivoOrigen: sourceFile
    }
  };

  // Solo anadir `coordenadas` y `geometry` si tenemos datos validos. La
  // asignacion condicional evita que Mongoose genere subdocumentos con
  // defaults aplicados (geometry.type='Point' sin coordinates), que
  // romperia el indice 2dsphere y haria fallar el batch entero.
  if (Object.keys(coordenadas).length > 0) {
    multa.coordenadas = coordenadas;
  }
  if (geometry) {
    multa.geometry = geometry;
  }

  // Calcular campos derivados que el pre-save hook normalmente computa,
  // pero que bulkWrite omite al no ejecutar middleware de Mongoose
  calcularCamposDerivadosMulta(multa);

  // calcularCamposDerivadosMulta reescribe metadatos desde cero. Anadimos
  // la marca de inferencia despues, para no perderla.
  multa.metadatos.calificacionInferida = calificacionInferida;

  return multa;
}

// ============================================================================
// FUNCIONES DE PROCESAMIENTO DE ARCHIVOS
// ============================================================================

/**
 * Procesar un archivo CSV de multas
 * @param {string} filePath - Ruta al archivo CSV
 * @param {Object} options - Opciones de procesamiento
 * @returns {Promise<Object>} - Estadísticas de procesamiento
 */
async function processMultasFile(filePath, options = {}) {
  const fileName = path.basename(filePath);
  logger.info({ archivo: fileName }, 'Iniciando procesamiento de archivo');

  return new Promise((resolve, reject) => {
    const stats = {
      fileName,
      totalRows: 0,
      processedRows: 0,
      errorRows: 0,
      insertedRecords: 0,
      skippedRecords: 0,
      rejectedRecords: 0,
      errors: []
    };

    const batch = [];
    let rowIndex = 0;
    let isProcessingBatch = false;

    const stream = crearLectorCSV(filePath)
      // mapHeaders: recorta espacios en los nombres de columna. Los CSV de
      // febrero a diciembre traen cabeceras con espacios espurios (` PUNTOS`,
      // `VEL_CIRCULA `, y trailing spaces), por lo que `row.PUNTOS` /
      // `row.VEL_CIRCULA` salian `undefined` y se perdian los puntos detraidos
      // (~1,76M multas a 0) y la velocidad de circulacion. El trim normaliza
      // las claves para los 12 meses sin afectar a enero (cabecera ya limpia).
      .pipe(csv({ separator: ';', mapHeaders: ({ header }) => header.trim() }))
      .on('data', async (row) => {
        if (isShuttingDown || isProcessingBatch) {
          return;
        }

        stats.totalRows++;
        rowIndex++;

        try {
          const multaData = parseMultaRow(row, fileName, rowIndex);

          if (multaData) {
            batch.push(multaData);
            stats.processedRows++;

            // Procesar lote cuando alcance el tamano configurado
            if (batch.length >= options.batchSize) {
              isProcessingBatch = true;
              stream.pause();
              try {
                await processBatch(batch, options, stats);
                batch.length = 0;
              } finally {
                isProcessingBatch = false;
                if (!isShuttingDown) {
                  stream.resume();
                }
              }
            }
          } else {
            stats.rejectedRecords++;
          }

          // Log de progreso
          if (stats.totalRows % (options.logInterval || IMPORT_CONFIG.logInterval) === 0) {
            logger.info({
              archivo: fileName,
              filasProcesadas: stats.totalRows,
              insertadas: stats.insertedRecords,
              rechazadas: stats.rejectedRecords
            }, 'Progreso de procesamiento');
          }

        } catch (error) {
          stats.errorRows++;
          totalErrors++;
          logger.error({
            fila: rowIndex,
            archivo: fileName,
            razon: REJECTION_REASONS.ERROR_PROCESAMIENTO_FILA,
            error: error.message
          }, 'Error procesando fila');

          if (stats.errors.length < 100) {
            stats.errors.push({
              row: stats.totalRows,
              error: error.message
            });
          }
        }
      })
      .on('end', async () => {
        try {
          // Procesar lote restante
          if (batch.length > 0 && !isShuttingDown) {
            isProcessingBatch = true;
            try {
              await processBatch(batch, options, stats);
            } finally {
              isProcessingBatch = false;
            }
          }

          // Actualizar contadores globales
          totalProcessed += stats.totalRows;
          totalInserted += stats.insertedRecords;
          totalSkipped += stats.skippedRecords;
          totalRejected += stats.rejectedRecords;

          logger.info({
            archivo: fileName,
            totalFilas: stats.totalRows,
            procesadas: stats.processedRows,
            insertadas: stats.insertedRecords,
            omitidas: stats.skippedRecords,
            rechazadas: stats.rejectedRecords,
            errores: stats.errorRows
          }, 'Archivo completado');

          resolve(stats);
        } catch (error) {
          reject(error);
        }
      })
      .on('error', (error) => {
        logger.error({
          archivo: fileName,
          error: error.message
        }, 'Error leyendo archivo CSV');
        reject(error);
      });
  });
}

// ============================================================================
// FUNCIONES DE PROCESAMIENTO DE LOTES
// ============================================================================

/**
 * Procesar un error individual de escritura de bulk
 * @param {Object} writeError - Error de escritura
 * @param {Object} failedDoc - Documento que fallo
 * @param {Object} stats - Estadisticas de procesamiento
 */
function handleWriteError(writeError, failedDoc, stats) {
  const errorCode = writeError.err?.code || writeError.code;

  if (errorCode === 11000) {
    stats.skippedRecords++;
    // No logueamos duplicados como advertencia por volumen
  } else {
    stats.errorRows++;
    const errorInfo = handleMongoError(writeError.err || writeError);
    logger.warn({
      fila: writeError.index,
      razon: REJECTION_REASONS.ERROR_INSERCION_BD,
      datosOriginales: {
        lugar: failedDoc?.lugar,
        fecha: failedDoc?.fecha,
        hora: failedDoc?.hora
      },
      errorMongo: errorInfo
    }, 'Error en insercion de multa');
  }
}

/**
 * Procesar errores de bulk write
 * @param {Object} bulkError - Error de bulk write
 * @param {Array} batch - Lote de documentos
 * @param {Object} stats - Estadisticas de procesamiento
 */
function processBulkWriteErrors(bulkError, batch, stats) {
  if (!bulkError.writeErrors) {
    return;
  }

  for (const writeError of bulkError.writeErrors) {
    const operationIndex = writeError.index;
    const failedDoc = batch[operationIndex];
    handleWriteError(writeError, failedDoc, stats);
  }
}

/**
 * Procesar lote con insercion masiva via insertMany (BD vacia).
 *
 * Modo mas rapido cuando la coleccion esta vacia: evita el lookup del
 * indice unico que `bulkWrite([{insertOne}])` realiza por documento, y
 * tampoco arrastra el coste del upsert. Usa `ordered: false` para que un
 * fallo individual no aborte el lote, y captura `BulkWriteError` para
 * contabilizar correctamente exitos parciales y errores de escritura.
 *
 * @param {Array} batch - Lote de documentos
 * @param {Object} stats - Estadisticas de procesamiento
 * @returns {Promise<void>}
 */
async function processBatchInsertMany(batch, stats) {
  try {
    const inserted = await Fine.insertMany(batch, {
      ordered: false,
      lean: true,
      bypassDocumentValidation: true
    });
    stats.insertedRecords += inserted.length;
  } catch (error) {
    // BulkWriteError: insertMany expone `insertedDocs` con los exitosos
    // y `writeErrors` con los fallos individuales (incluye duplicados 11000)
    if (Array.isArray(error.insertedDocs)) {
      stats.insertedRecords += error.insertedDocs.length;
    }

    if (Array.isArray(error.writeErrors) && error.writeErrors.length > 0) {
      for (const writeError of error.writeErrors) {
        const failedDoc = batch[writeError.index];
        handleWriteError(writeError, failedDoc, stats);
      }
      return;
    }

    const errorInfo = handleMongoError(error);
    logger.error({
      razon: REJECTION_REASONS.ERROR_INSERCION_BD,
      loteSize: batch.length,
      errorMongo: errorInfo
    }, 'Error en insertMany de lote');
    throw error;
  }
}

/**
 * Procesar lote con insercion (skip existing)
 * @param {Array} batch - Lote de documentos
 * @param {Object} stats - Estadisticas de procesamiento
 * @returns {Promise<void>}
 */
async function processBatchInsert(batch, stats) {
  const operations = batch.map(multaData => ({
    insertOne: { document: multaData }
  }));

  try {
    const result = await Fine.bulkWrite(operations, {
      ordered: false,
      bypassDocumentValidation: true
    });
    stats.insertedRecords += result.insertedCount || 0;
  } catch (bulkError) {
    processBulkWriteErrors(bulkError, batch, stats);

    // Contar inserciones exitosas del bulkWrite
    if (bulkError.result) {
      stats.insertedRecords += bulkError.result.nInserted || 0;
    }
  }
}

/**
 * Procesar lote con upsert (force mode)
 * @param {Array} batch - Lote de documentos
 * @param {Object} stats - Estadisticas de procesamiento
 * @returns {Promise<void>}
 */
async function processBatchUpsert(batch, stats) {
  const operations = batch.map(multaData => ({
    updateOne: {
      filter: {
        lugar: multaData.lugar,
        fecha: multaData.fecha,
        hora: multaData.hora,
        importeBoletín: multaData.importeBoletín
      },
      update: { $set: multaData },
      upsert: true
    }
  }));

  try {
    // Usamos `Fine.collection.bulkWrite` (driver nativo) en vez de
    // `Fine.bulkWrite` (Mongoose). Con Mongoose 9 + `bypassDocumentValidation`,
    // `Fine.bulkWrite(... updateOne + upsert)` retorna `{ upsertedCount: 0,
    // matchedCount: 0, hasWriteErrors: false }` SILENCIOSAMENTE: el batch
    // se reporta como exitoso pero no inserta nada (verificado contra
    // el dataset 2051 con docs que no traen `geometry`). El driver nativo
    // no tiene ese problema porque salta el casting/validacion Mongoose.
    const result = await Fine.collection.bulkWrite(operations, {
      ordered: false,
      bypassDocumentValidation: true
    });
    stats.insertedRecords += (result.upsertedCount || 0);
    stats.insertedRecords += (result.modifiedCount || 0);
    stats.skippedRecords += (result.matchedCount || 0) - (result.modifiedCount || 0);
  } catch (bulkError) {
    const errorInfo = handleMongoError(bulkError);
    logger.error({
      razon: REJECTION_REASONS.ERROR_INSERCION_BD,
      errorMongo: errorInfo
    }, 'Error en operacion upsert de lote');

    // Contar resultados parciales
    if (bulkError.result) {
      stats.insertedRecords += bulkError.result.nUpserted || 0;
      stats.insertedRecords += bulkError.result.nModified || 0;
    }
  }
}

/**
 * Procesar un lote de multas con manejo de errores detallado.
 *
 * Despacha al modo de insercion adecuado segun `options.modoInsercion`:
 * - 'insertMany': BD vacia, ruta mas rapida (sin lookup ni upsert)
 * - 'bulkInsert': BD con datos pero sin --force, permite duplicados 11000
 * - 'upsert': --force activado, sobrescribe registros existentes
 *
 * @param {Array} batch - Lote de datos de multas
 * @param {Object} options - Opciones de procesamiento (incluye modoInsercion)
 * @param {Object} stats - Estadísticas de procesamiento
 */
async function processBatch(batch, options, stats) {
  try {
    switch (options.modoInsercion) {
      case 'insertMany':
        await processBatchInsertMany(batch, stats);
        break;
      case 'upsert':
        await processBatchUpsert(batch, stats);
        break;
      case 'bulkInsert':
      default:
        await processBatchInsert(batch, stats);
        break;
    }
  } catch (error) {
    const errorInfo = handleMongoError(error);
    logger.error({
      razon: REJECTION_REASONS.ERROR_INSERCION_BD,
      loteSize: batch.length,
      errorMongo: errorInfo
    }, 'Error procesando lote de multas');
    throw error;
  }
}

// ============================================================================
// FUNCION DE IMPORTACION PRINCIPAL
// ============================================================================

/**
 * Importar todos los archivos de multas con procesamiento paralelo optimizado
 * @param {Object} options - Opciones de importacion
 * @returns {Promise<Object>} - Estadisticas finales
 */
async function importMultasData(options = {}) {
  const importConfig = { ...IMPORT_CONFIG, ...options };

  // Detectar modo de insercion segun estado de la BD.
  // - 'insertMany': BD vacia y sin --force, ruta mas rapida (~30-50% menos
  //   tiempo en BD vacia: no hay lookup de indice unico ni upsert).
  // - 'bulkInsert': BD con datos sin --force, mantiene compatibilidad con
  //   el comportamiento `skipExisting` heredado (duplicados 11000 silentes).
  // - 'upsert': --force activado, sobrescribe registros existentes.
  // Patron analogo al de `importarTrafico.js`.
  const forceMode = importConfig.skipExisting === false;
  const countActual = await Fine.countDocuments().maxTimeMS(10000);
  importConfig.modoInsercion = forceMode
    ? 'upsert'
    : (countActual === 0 ? 'insertMany' : 'bulkInsert');

  logger.info({
    directorio: importConfig.dataDirectory,
    batchSize: importConfig.batchSize,
    maxParallel: importConfig.maxParallel,
    modoInsercion: importConfig.modoInsercion,
    registrosExistentes: countActual.toLocaleString(),
    force: forceMode
  }, `Iniciando importacion de datos de multas (modo: ${importConfig.modoInsercion})`);

  try {
    // Verificar que existe el directorio
    const dirStats = await fs.stat(importConfig.dataDirectory);
    if (!dirStats.isDirectory()) {
      throw new Error(`No se encontro el directorio: ${importConfig.dataDirectory}`);
    }

    // Obtener lista de archivos CSV
    const files = await fs.readdir(importConfig.dataDirectory);
    const csvFiles = files
      .filter(file => file.endsWith('.csv') && file.includes('Multas'))
      .sort();

    if (csvFiles.length === 0) {
      throw new Error('No se encontraron archivos CSV de multas');
    }

    logger.info({ archivosEncontrados: csvFiles.length, archivos: csvFiles }, 'Archivos CSV detectados');

    const globalStats = {
      startTime: new Date(),
      totalFiles: csvFiles.length,
      completedFiles: 0,
      totalRows: 0,
      processedRows: 0,
      errorRows: 0,
      insertedRecords: 0,
      skippedRecords: 0,
      rejectedRecords: 0,
      fileStats: []
    };

    // Procesar archivos en paralelo
    const maxParallel = importConfig.maxParallel || IMPORT_CONFIG.maxParallel;

    const processFile = async (file) => {
      if (isShuttingDown) {
        return {
          fileName: file,
          totalRows: 0,
          processedRows: 0,
          errorRows: 0,
          insertedRecords: 0,
          skippedRecords: 0,
          rejectedRecords: 0,
          errors: ['Proceso interrumpido']
        };
      }

      const filePath = path.join(importConfig.dataDirectory, file);
      try {
        return await processMultasFile(filePath, importConfig);
      } catch (error) {
        logger.error({
          archivo: file,
          error: error.message
        }, 'Error procesando archivo de multas');
        return {
          fileName: file,
          totalRows: 0,
          processedRows: 0,
          errorRows: 1,
          insertedRecords: 0,
          skippedRecords: 0,
          rejectedRecords: 0,
          errors: [error.message]
        };
      }
    };

    // Procesar en lotes paralelos
    for (let i = 0; i < csvFiles.length && !isShuttingDown; i += maxParallel) {
      const batch = csvFiles.slice(i, i + maxParallel);
      const loteNum = Math.floor(i / maxParallel) + 1;
      const totalLotes = Math.ceil(csvFiles.length / maxParallel);

      logger.info({
        lote: loteNum,
        totalLotes,
        archivos: batch
      }, 'Procesando lote de archivos');

      const promises = batch.map(file => processFile(file));
      const batchResults = await Promise.all(promises);

      // Acumular estadisticas
      batchResults.forEach(fileStats => {
        globalStats.fileStats.push(fileStats);
        globalStats.completedFiles++;
        globalStats.totalRows += fileStats.totalRows;
        globalStats.processedRows += fileStats.processedRows;
        globalStats.errorRows += fileStats.errorRows;
        globalStats.insertedRecords += fileStats.insertedRecords;
        globalStats.skippedRecords += fileStats.skippedRecords;
        globalStats.rejectedRecords += fileStats.rejectedRecords || 0;
      });

      logger.info({
        lote: loteNum,
        progreso: `${globalStats.completedFiles}/${csvFiles.length}`,
        insertadasAcumuladas: globalStats.insertedRecords
      }, 'Lote completado');
    }

    globalStats.endTime = new Date();
    globalStats.duration = globalStats.endTime - globalStats.startTime;

    return globalStats;

  } catch (error) {
    logger.error({ error: error.message }, 'Error en importacion de multas');
    throw error;
  }
}

// ============================================================================
// MANEJO DE SENALES DE TERMINACION
// ============================================================================

/**
 * Manejador de cierre graceful
 * @param {string} signal - Senal recibida
 */
async function handleShutdown(signal) {
  if (isShuttingDown) {
    return;
  }
  isShuttingDown = true;

  logger.warn({ signal }, 'Senal de terminacion recibida, cerrando gracefully...');

  // Resumen parcial
  logger.info({
    procesadas: totalProcessed,
    insertadas: totalInserted,
    omitidas: totalSkipped,
    rechazadas: totalRejected,
    errores: totalErrors
  }, 'Resumen parcial de importacion (interrumpida)');

  try {
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.close();
      logger.info('Conexion a MongoDB cerrada correctamente');
    }
  } catch (error) {
    logger.error({ error: error.message }, 'Error cerrando conexion a MongoDB');
  }

  process.exit(0);
}

// Registrar manejadores de senales
process.on('SIGINT', () => handleShutdown('SIGINT'));
process.on('SIGTERM', () => handleShutdown('SIGTERM'));

process.on('uncaughtException', (error) => {
  console.error('UNCAUGHT EXCEPTION:', error);
  logger.fatal({ error: error.message, stack: error.stack }, 'Error no capturado');
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('UNHANDLED REJECTION:', reason);
  logger.fatal({ reason, promise }, 'Promesa rechazada no manejada');
  process.exit(1);
});

// ============================================================================
// FUNCION PRINCIPAL
// ============================================================================

/**
 * Funcion principal del script
 */
async function main() {
  const args = process.argv.slice(2);
  const options = {
    skipExisting: !args.includes('--force'),
    batchSize: parseInt(args.find(arg => arg.startsWith('--batch='))?.split('=')[1]) || IMPORT_CONFIG.batchSize
  };

  logger.info({
    omitirExistentes: options.skipExisting,
    tamanoLote: options.batchSize
  }, 'Iniciando script de importacion de multas');

  const startTime = Date.now();
  let result;

  try {
    // Conectar a MongoDB usando connectDB centralizado
    logger.info('Conectando a MongoDB...');
    await connectDB(config.database.uri);
    logger.info('Conexion establecida con MongoDB');

    // Verificar modelo de multas
    const finesCount = await Fine.countDocuments().maxTimeMS(10000);
    logger.info({ registrosActuales: finesCount }, 'Estado actual de la coleccion de multas');

    // Ejecutar importacion
    result = await importMultasData(options);

    // Mostrar resultados finales
    logger.info({
      duracion: formatDuration(result.duration),
      velocidad: calculateProcessingSpeed(result.totalRows, result.duration),
      archivosProcesados: result.completedFiles,
      totalArchivos: result.totalFiles,
      filasTotales: result.totalRows,
      registrosInsertados: result.insertedRecords,
      registrosOmitidos: result.skippedRecords,
      registrosRechazados: result.rejectedRecords,
      errores: result.errorRows
    }, 'Importacion de multas completada');

    // Estadisticas finales de la base de datos.
    // estimatedDocumentCount usa metadata (instantaneo); countDocuments() haria un
    // collection scan que sobre millones de docs sin indices recreados puede tardar.
    const finalCount = await Fine.estimatedDocumentCount();
    logger.info({ totalMultasBD: finalCount }, 'Total de multas en la base de datos');

    // Resumen de rechazos por tipo
    const rejectionSummary = rejectionTracker.getSortedSummary();
    if (rejectionSummary.length > 0) {
      logger.info({
        totalRechazos: rejectionTracker.totalRejected,
        desglose: rejectionSummary.slice(0, 10) // Top 10 razones
      }, 'Resumen de rechazos por tipo');
    }

  } catch (error) {
    const errorInfo = handleMongoError(error);
    logger.error({
      mensaje: error.message,
      errorInfo
    }, 'Error durante la importacion');
    process.exit(1);

  } finally {
    buildAndWriteSummary('multas', {
      startTime,
      counts: {
        totalProcessed: result?.totalRows || 0,
        inserted: result?.insertedRecords || 0,
        rejected: rejectionTracker.totalRejected,
        skipped: result?.skippedRecords || 0,
        errors: result?.errorRows || 0
      },
      rejectionTracker
    });

    if (!isShuttingDown && mongoose.connection.readyState === 1) {
      logger.info('Cerrando conexion a MongoDB...');
      try {
        await mongoose.connection.close();
        logger.info('Conexion cerrada correctamente');
      } catch (error) {
        logger.error({ error: error.message }, 'Error cerrando conexion');
      }
    }
  }

  logger.info('Script completado');
  if (process.exitCode === 1) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

// Ejecutar si es llamado directamente
if (require.main === module) {
  main().catch(error => {
    logger.error({ error: error.message }, 'Error fatal en script de importacion');
    process.exit(1);
  });
}

module.exports = {
  importMultasData,
  parseMultaRow,
  REJECTION_REASONS
};
