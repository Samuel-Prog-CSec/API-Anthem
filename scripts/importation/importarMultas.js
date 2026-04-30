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
const { createReadStream } = require('fs');
const mongoose = require('mongoose');
const { connectDB } = require('../../src/config/database');
const config = require('../../src/config/config');
const Fine = require('../../src/models/Multa');
const { importFinesLogger: logger } = require('../../src/config/scriptLogger');
const { handleMongoError } = require('../../src/utils/errorUtils');
const iconv = require('iconv-lite');
const { VALIDATION_LIMITS, SEVERITY_LEVELS, INFRACTION_TYPES, FINE_CONFIG } = require('../../src/constants');
const { normalizarTexto } = require('./helpers/normalizarEncoding');
const { construirGeometryDesdeUTM } = require('./helpers/conversorCoordenadas');
const {
  extractDateFromFileName,
  RejectionTracker,
  formatDuration,
  calculateProcessingSpeed
} = require('./helpers/importHelpers');

// ============================================================================
// CONFIGURACIÓN
// ============================================================================

const IMPORT_CONFIG = {
  dataDirectory: path.join(__dirname, '..', '..', 'datos_hpe', 'Multas'),
  batchSize: 5000,
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

  // Inicializar metadatos
  const esVelocidad = vel && vel.velocidadLimite && vel.velocidadCirculacion;
  multa.metadatos = {
    tipoInfraccion: esVelocidad ? INFRACTION_TYPES.VELOCIDAD : INFRACTION_TYPES.OTRAS,
    esInfraccionGrave: multa.calificacion === SEVERITY_LEVELS.FINE.GRAVE ||
                       multa.calificacion === SEVERITY_LEVELS.FINE.MUY_GRAVE,
    esInfraccionVelocidad: Boolean(esVelocidad),
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
    rejectionTracker.track(REJECTION_REASONS.ARCHIVO_SIN_FECHA);
    logger.warn({
      fila: rowIndex,
      razon: REJECTION_REASONS.ARCHIVO_SIN_FECHA,
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

  // Crear fecha basada en mes y año
  const fecha = new Date(año, mes - 1, 1);

  // Procesar coordenadas
  const coordenadas = {};
  if (row.COORDENADA_X && row.COORDENADA_X.trim() !== '') {
    const coordX = parseFloat(row.COORDENADA_X.replace(',', '.'));
    if (!isNaN(coordX)) {
      if (coordX >= VALIDATION_LIMITS.UTM_X_MIN && coordX <= VALIDATION_LIMITS.UTM_X_MAX) {
        coordenadas.x = coordX;
      } else {
        rejectionTracker.track(REJECTION_REASONS.COORDENADA_X_INVALIDA);
        logger.warn({
          fila: rowIndex,
          razon: REJECTION_REASONS.COORDENADA_X_INVALIDA,
          datosOriginales: { coordenadaX: row.COORDENADA_X, valor: coordX }
        }, 'Coordenada X fuera de rango - se omite');
      }
    }
  }

  if (row.COORDENADA_Y && row.COORDENADA_Y.trim() !== '') {
    const coordY = parseFloat(row.COORDENADA_Y.replace(',', '.'));
    if (!isNaN(coordY)) {
      if (coordY >= VALIDATION_LIMITS.UTM_Y_MIN && coordY <= VALIDATION_LIMITS.UTM_Y_MAX) {
        coordenadas.y = coordY;
      } else {
        rejectionTracker.track(REJECTION_REASONS.COORDENADA_Y_INVALIDA);
        logger.warn({
          fila: rowIndex,
          razon: REJECTION_REASONS.COORDENADA_Y_INVALIDA,
          datosOriginales: { coordenadaY: row.COORDENADA_Y, valor: coordY }
        }, 'Coordenada Y fuera de rango - se omite');
      }
    }
  }

  // Procesar datos de velocidad
  const datosVelocidad = {};
  if (row.VEL_LIMITE && row.VEL_LIMITE.trim() !== '') {
    const velLimite = parseInt(row.VEL_LIMITE);
    if (!isNaN(velLimite) && velLimite >= VALIDATION_LIMITS.SPEED_MIN && velLimite <= VALIDATION_LIMITS.SPEED_MAX) {
      datosVelocidad.velocidadLimite = velLimite;
    } else if (!isNaN(velLimite)) {
      rejectionTracker.track(REJECTION_REASONS.VELOCIDAD_LIMITE_INVALIDA);
      logger.warn({
        fila: rowIndex,
        razon: REJECTION_REASONS.VELOCIDAD_LIMITE_INVALIDA,
        datosOriginales: { velocidadLimite: row.VEL_LIMITE, valor: velLimite }
      }, 'Velocidad limite fuera de rango - se omite');
    }
  }

  if (row.VEL_CIRCULA && row.VEL_CIRCULA.trim() !== '') {
    const velCircula = parseInt(row.VEL_CIRCULA);
    if (!isNaN(velCircula) && velCircula >= VALIDATION_LIMITS.SPEED_MIN && velCircula <= VALIDATION_LIMITS.SPEED_MAX) {
      datosVelocidad.velocidadCirculacion = velCircula;
    } else if (!isNaN(velCircula)) {
      rejectionTracker.track(REJECTION_REASONS.VELOCIDAD_CIRCULACION_INVALIDA);
      logger.warn({
        fila: rowIndex,
        razon: REJECTION_REASONS.VELOCIDAD_CIRCULACION_INVALIDA,
        datosOriginales: { velocidadCirculacion: row.VEL_CIRCULA, valor: velCircula }
      }, 'Velocidad de circulacion fuera de rango - se omite');
    }
  }

  // Procesar importe
  const importeStr = row.IMP_BOL ? row.IMP_BOL.replace(',', '.').trim() : '0';
  const importe = parseFloat(importeStr) || 0;

  if (importe < 0) {
    rejectionTracker.track(REJECTION_REASONS.IMPORTE_NEGATIVO);
    logger.warn({
      fila: rowIndex,
      razon: REJECTION_REASONS.IMPORTE_NEGATIVO,
      datosOriginales: { importe: row.IMP_BOL, valor: importe }
    }, 'Importe negativo - se convierte a 0');
  }

  // Procesar puntos
  const puntos = parseInt(row.PUNTOS) || 0;
  if (puntos < VALIDATION_LIMITS.DRIVER_POINTS_MIN || puntos > VALIDATION_LIMITS.DRIVER_POINTS_MAX) {
    rejectionTracker.track(REJECTION_REASONS.PUNTOS_FUERA_RANGO);
    logger.warn({
      fila: rowIndex,
      razon: REJECTION_REASONS.PUNTOS_FUERA_RANGO,
      datosOriginales: { puntos: row.PUNTOS, valor: puntos }
    }, `Puntos fuera de rango (${VALIDATION_LIMITS.DRIVER_POINTS_MIN}-${VALIDATION_LIMITS.DRIVER_POINTS_MAX}) - se usa valor original`);
  }

  // Procesar descuento
  const tieneDescuento = row.DESCUENTO &&
    (row.DESCUENTO.toLowerCase().includes('si') || row.DESCUENTO.toLowerCase().includes('sí'));

  // Validar calificación
  let calificacionRaw = (row.CALIFICACION || SEVERITY_LEVELS.FINE.LEVE).toUpperCase().trim();

  // Normalizar valores conocidos que difieren de la constante
  if (calificacionRaw === 'MUY GRAVE') {
    calificacionRaw = SEVERITY_LEVELS.FINE.MUY_GRAVE;
  }

  const calificacionesValidas = [SEVERITY_LEVELS.FINE.LEVE, SEVERITY_LEVELS.FINE.GRAVE, SEVERITY_LEVELS.FINE.MUY_GRAVE];
  const calificacion = calificacionesValidas.includes(calificacionRaw) ? calificacionRaw : SEVERITY_LEVELS.FINE.LEVE;

  if (!calificacionesValidas.includes(calificacionRaw) && calificacionRaw !== SEVERITY_LEVELS.FINE.LEVE) {
    rejectionTracker.track(REJECTION_REASONS.CALIFICACION_INVALIDA);
    logger.warn({
      fila: rowIndex,
      razon: REJECTION_REASONS.CALIFICACION_INVALIDA,
      datosOriginales: { calificacion: row.CALIFICACION, valorUsado: SEVERITY_LEVELS.FINE.LEVE }
    }, 'Calificacion invalida - se usa LEVE por defecto');
  }

  // Derivar geometry GeoJSON desde UTM para alimentar el endpoint
  // /multas/mapa y queries geoespaciales (solo si tiene ambas UTM).
  const geometry = (coordenadas.x && coordenadas.y)
    ? construirGeometryDesdeUTM(coordenadas.x, coordenadas.y)
    : null;

  // Crear objeto de multa (campos de texto normalizados para corregir
  // mojibake latin1 del CSV)
  const multa = {
    fecha,
    mes,
    año,
    hora: row.HORA || '00.00',
    calificacion,
    lugar: normalizarTexto(row.LUGAR, 'NO ESPECIFICADO'),
    coordenadas: Object.keys(coordenadas).length > 0 ? coordenadas : undefined,
    geometry: geometry || undefined,
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

  // Calcular campos derivados que el pre-save hook normalmente computa,
  // pero que bulkWrite omite al no ejecutar middleware de Mongoose
  calcularCamposDerivadosMulta(multa);

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

    const stream = createReadStream(filePath)
      .pipe(iconv.decodeStream('latin1'))
      .pipe(csv({ separator: ';' }))
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
      bypassDocumentValidation: false
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
    const result = await Fine.bulkWrite(operations, { ordered: false });
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
 * Procesar un lote de multas con manejo de errores detallado
 * @param {Array} batch - Lote de datos de multas
 * @param {Object} options - Opciones de procesamiento
 * @param {Object} stats - Estadísticas de procesamiento
 */
async function processBatch(batch, options, stats) {
  try {
    if (options.skipExisting) {
      await processBatchInsert(batch, stats);
    } else {
      await processBatchUpsert(batch, stats);
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

  logger.info({
    directorio: importConfig.dataDirectory,
    batchSize: importConfig.batchSize,
    maxParallel: importConfig.maxParallel
  }, 'Iniciando importacion de datos de multas');

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
  logger.fatal({ error: error.message, stack: error.stack }, 'Error no capturado');
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
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

  try {
    // Conectar a MongoDB usando connectDB centralizado
    logger.info('Conectando a MongoDB...');
    await connectDB(config.database.uri);
    logger.info('Conexion establecida con MongoDB');

    // Verificar modelo de multas
    const finesCount = await Fine.countDocuments().maxTimeMS(10000);
    logger.info({ registrosActuales: finesCount }, 'Estado actual de la coleccion de multas');

    // Ejecutar importacion
    const result = await importMultasData(options);

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

    // Estadisticas finales de la base de datos
    const finalCount = await Fine.countDocuments().maxTimeMS(10000);
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
