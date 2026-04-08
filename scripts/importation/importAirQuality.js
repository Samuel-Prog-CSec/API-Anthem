/**
 * Script de Importacion de Calidad del Aire
 *
 * Procesa y carga datos de calidad del aire desde multiples archivos CSV
 * con procesamiento paralelo optimizado. Incluye mediciones horarias
 * de diferentes magnitudes (PM2.5, PM10, NO2, SO2, O3, CO, etc.)
 *
 * Uso: node scripts/importation/importAirQuality.js [opciones]
 *
 * Opciones:
 *   --force         Sobrescribir datos existentes (upsert)
 *   --batch=N       Tamano del lote (default: 2000)
 *   --parallel=N    Archivos en paralelo (default: 4)
 *   --no-summary    Omitir resumen estadistico
 *
 * @module scripts/importation/importAirQuality
 */

// Configurar modo script para evitar reconexiones infinitas
process.env.SCRIPT_MODE = 'true';

const fs = require('fs').promises;
const path = require('path');
const csv = require('csv-parser');
const { createReadStream } = require('fs');
const mongoose = require('mongoose');

// Configuracion y utilidades
const { connectDB } = require('../../src/config/database');
const config = require('../../src/config/config');
const { importAirQualityLogger: logger } = require('../../src/config/scriptLogger');
const { handleMongoError } = require('../../src/utils/errorUtils');
const {
  MAGNITUDES_PERMITIDAS,
  AIR_QUALITY_MAGNITUDES,
  VALIDATION_CODES,
  DATASET_YEARS,
  VALIDATION_LIMITS
} = require('../../src/constants');
const {
  RejectionTracker,
  formatDuration,
  calculateProcessingSpeed
} = require('./helpers/importHelpers');

// Modelo
const AirQuality = require('../../src/models/CalidadAire');

/**
 * Codigos de razon de rechazo para trazabilidad
 * @constant {Object}
 */
const REJECTION_REASONS = {
  MISSING_REQUIRED_FIELDS: 'CAMPOS_OBLIGATORIOS_FALTANTES',
  INVALID_IDENTIFIERS: 'IDENTIFICADORES_INVALIDOS',
  INVALID_MAGNITUDE: 'MAGNITUD_NO_PERMITIDA',
  MISSING_PUNTO_MUESTREO: 'PUNTO_MUESTREO_FALTANTE',
  INVALID_DATE_COMPONENTS: 'COMPONENTES_FECHA_INVALIDOS',
  DATE_OUT_OF_RANGE: 'FECHA_FUERA_RANGO',
  INVALID_DATE: 'FECHA_INVALIDA',
  INCOMPLETE_HOURLY_DATA: 'MEDICIONES_HORARIAS_INCOMPLETAS',
  DUPLICATE_KEY: 'CLAVE_DUPLICADA',
  VALIDATION_ERROR: 'ERROR_VALIDACION'
};

/**
 * Configuracion del importador de calidad del aire
 * @constant {Object}
 */
const IMPORT_CONFIG = {
  dataDirectory: path.join(__dirname, '..', '..', 'datos_hpe', 'Aire'),
  batchSize: 2000,
  skipExisting: true,
  logInterval: 500,
  maxParallel: 4,
  maxRetries: 3,
  retryDelay: 2000,
  csvSeparator: ';'
};

/**
 * Mapeo de meses en espanol a numeros
 * @constant {Object}
 */
const MONTH_MAP = {
  'enero': 1, 'febrero': 2, 'marzo': 3, 'abril': 4,
  'mayo': 5, 'junio': 6, 'julio': 7, 'agosto': 8,
  'septiembre': 9, 'octubre': 10, 'noviembre': 11, 'diciembre': 12
};

/** Flag para controlar cierre graceful */
let isShuttingDown = false;

// Tracker de rechazos por tipo
const rejectionTracker = new RejectionTracker();

/**
 * Extraer mes del nombre del archivo
 * @param {string} fileName - Nombre del archivo (ej: Anthem_CTC_Aire_Enero.csv)
 * @returns {number|null} Numero del mes o null si no se puede determinar
 */
function extractMonthFromFileName(fileName) {
  try {
    const lowerFileName = fileName.toLowerCase();
    for (const [monthName, monthNumber] of Object.entries(MONTH_MAP)) {
      if (lowerFileName.includes(monthName)) {
        return monthNumber;
      }
    }
    return null;
  } catch (error) {
    logger.warn({ fileName, error: error.message }, 'Error extrayendo mes del archivo');
    return null;
  }
}

/**
 * Parsear una fila de datos de calidad del aire
 * @param {Object} row - Fila del CSV
 * @param {string} sourceFile - Archivo origen
 * @param {number} rowIndex - Indice de la fila para logging
 * @returns {Object} Datos procesados
 * @throws {Error} Si la validacion falla con razon especifica
 */
function parseAirQualityRow(row, _sourceFile, _rowIndex) {
  // Validar campos obligatorios basicos
  if (!row.PROVINCIA || !row.MUNICIPIO || !row.ESTACION || !row.MAGNITUD) {
    const missing = [];
    if (!row.PROVINCIA) {missing.push('PROVINCIA');}
    if (!row.MUNICIPIO) {missing.push('MUNICIPIO');}
    if (!row.ESTACION) {missing.push('ESTACION');}
    if (!row.MAGNITUD) {missing.push('MAGNITUD');}
    throw new Error(`${REJECTION_REASONS.MISSING_REQUIRED_FIELDS}: campos=[${missing.join(', ')}]`);
  }

  // Parsear identificadores
  const provincia = parseInt(row.PROVINCIA, 10);
  const municipio = parseInt(row.MUNICIPIO, 10);
  const estacion = parseInt(row.ESTACION, 10);
  const magnitud = parseInt(row.MAGNITUD, 10);

  if (isNaN(provincia) || isNaN(municipio) || isNaN(estacion) || isNaN(magnitud)) {
    const invalid = [];
    if (isNaN(provincia)) {invalid.push(`PROVINCIA='${row.PROVINCIA}'`);}
    if (isNaN(municipio)) {invalid.push(`MUNICIPIO='${row.MUNICIPIO}'`);}
    if (isNaN(estacion)) {invalid.push(`ESTACION='${row.ESTACION}'`);}
    if (isNaN(magnitud)) {invalid.push(`MAGNITUD='${row.MAGNITUD}'`);}
    throw new Error(`${REJECTION_REASONS.INVALID_IDENTIFIERS}: ${invalid.join(', ')}`);
  }

  // Validar magnitud usando constantes
  if (!MAGNITUDES_PERMITIDAS.includes(magnitud)) {
    throw new Error(`${REJECTION_REASONS.INVALID_MAGNITUDE}: valor=${magnitud}, permitidas=[${MAGNITUDES_PERMITIDAS.slice(0, 5).join(', ')}...]`);
  }

  // Obtener punto de muestreo
  const puntoMuestreo = row.PUNTO_MUESTREO?.toString().trim();
  if (!puntoMuestreo) {
    throw new Error(`${REJECTION_REASONS.MISSING_PUNTO_MUESTREO}: columna vacia`);
  }

  // Parsear fecha
  const año = parseInt(row.ANO, 10);
  const mes = parseInt(row.MES, 10);
  const dia = parseInt(row.DIA, 10);

  if (isNaN(año) || isNaN(mes) || isNaN(dia)) {
    throw new Error(`${REJECTION_REASONS.INVALID_DATE_COMPONENTS}: ANO='${row.ANO}', MES='${row.MES}', DIA='${row.DIA}'`);
  }

  // Validar fecha usando constantes
  if (año < DATASET_YEARS.VALIDATION_MIN || año > DATASET_YEARS.VALIDATION_MAX ||
      mes < VALIDATION_LIMITS.MONTH_MIN || mes > VALIDATION_LIMITS.MONTH_MAX ||
      dia < VALIDATION_LIMITS.DAY_MIN || dia > VALIDATION_LIMITS.DAY_MAX) {
    throw new Error(`${REJECTION_REASONS.DATE_OUT_OF_RANGE}: ano=${año}, mes=${mes}, dia=${dia}`);
  }

  // Crear fecha
  const fecha = new Date(año, mes - 1, dia);
  if (isNaN(fecha.getTime())) {
    throw new Error(`${REJECTION_REASONS.INVALID_DATE}: ano=${año}, mes=${mes}, dia=${dia}`);
  }

  // Procesar mediciones horarias (H01-H24 con V01-V24)
  const medicionesHorarias = new Map();
  let validMeasurements = 0;

  for (let hour = 1; hour <= 24; hour++) {
    const hourKey = `H${hour.toString().padStart(2, '0')}`;
    const validationKey = `V${hour.toString().padStart(2, '0')}`;

    const hourValue = row[hourKey];
    const validationCode = row[validationKey];

    // Valor por defecto para mediciones faltantes
    const measurement = {
      value: null,
      validationCode: VALIDATION_CODES.INVALID
    };

    if (hourValue !== undefined && hourValue !== null && hourValue !== '') {
      const numericValue = parseFloat(hourValue);
      if (!isNaN(numericValue) && numericValue >= 0) {
        measurement.value = numericValue;
      }
    }

    // Codigo de validacion usando constantes
    if (validationCode === VALIDATION_CODES.VALID || validationCode === VALIDATION_CODES.INVALID) {
      measurement.validationCode = validationCode;

      if (validationCode === VALIDATION_CODES.VALID && measurement.value !== null) {
        validMeasurements++;
      }
    }

    medicionesHorarias.set(hourKey, measurement);
  }

  // Verificar que tenemos las 24 mediciones
  if (medicionesHorarias.size !== 24) {
    throw new Error(`${REJECTION_REASONS.INCOMPLETE_HOURLY_DATA}: mediciones=${medicionesHorarias.size}/24`);
  }

  // Calcular score de calidad de datos
  const dataQualityScore = validMeasurements / 24;

  // Calcular estadisticas de mediciones validas (averageValue, maxValue, minValue)
  let averageValue = null;
  let maxValue = null;
  let minValue = null;

  if (validMeasurements > 0) {
    const validValues = [];
    for (const [, measurement] of medicionesHorarias) {
      if (measurement.validationCode === VALIDATION_CODES.VALID && measurement.value !== null) {
        validValues.push(measurement.value);
      }
    }
    if (validValues.length > 0) {
      averageValue = validValues.reduce((sum, v) => sum + v, 0) / validValues.length;
      maxValue = Math.max(...validValues);
      minValue = Math.min(...validValues);
    }
  }

  return {
    provincia,
    municipio,
    estacion,
    magnitud,
    puntoMuestreo,
    fecha,
    medicionesHorarias,
    processingMetadata: {
      importedAt: new Date(),
      validMeasurements,
      dataQualityScore,
      averageValue,
      maxValue,
      minValue
    }
  };
}

/**
 * Procesar un archivo CSV de calidad del aire
 * @param {string} filePath - Ruta al archivo CSV
 * @param {Object} options - Opciones de procesamiento
 * @returns {Promise<Object>} Estadisticas de procesamiento
 */
async function processAirQualityFile(filePath, options = {}) {
  const fileName = path.basename(filePath);
  logger.info({ fileName }, 'Procesando archivo de calidad del aire');

  return new Promise((resolve, reject) => {
    const stats = {
      fileName,
      totalRows: 0,
      processedRows: 0,
      errorRows: 0,
      emptyRows: 0,
      insertedRecords: 0,
      skippedRecords: 0,
      duplicateErrors: 0
    };

    const batch = [];
    let isProcessing = false;

    const stream = createReadStream(filePath, { encoding: 'latin1' })
      .pipe(csv({ separator: IMPORT_CONFIG.csvSeparator }))
      .on('data', async (row) => {
        if (isProcessing || isShuttingDown) {return;}

        stats.totalRows++;

        try {
          const airQualityData = parseAirQualityRow(row, fileName, stats.totalRows);

          batch.push(airQualityData);
          stats.processedRows++;

          // Procesar lote cuando alcance el tamano configurado
          if (batch.length >= options.batchSize) {
            stream.pause();
            isProcessing = true;

            try {
              const result = await processBatch(batch, options, stats);
              stats.insertedRecords += result.inserted;
              stats.skippedRecords += result.skipped;
              stats.duplicateErrors += result.duplicates;
              batch.length = 0;
            } catch (error) {
              logger.error({ error: error.message }, 'Error procesando lote');
              stats.errorRows++;
            } finally {
              isProcessing = false;
              stream.resume();
            }
          }

          // Log de progreso
          if (stats.totalRows % options.logInterval === 0) {
            logger.debug({
              fileName,
              totalRows: stats.totalRows,
              validRows: stats.processedRows
            }, 'Progreso de lectura');
          }
        } catch (error) {
          stats.errorRows++;
          stats.emptyRows++;
          logger.warn(
            {
              fila: stats.totalRows,
              archivo: fileName,
              razon: error.message,
              datosOriginales: {
                PROVINCIA: row.PROVINCIA,
                MUNICIPIO: row.MUNICIPIO,
                ESTACION: row.ESTACION,
                MAGNITUD: row.MAGNITUD,
                ANO: row.ANO,
                MES: row.MES,
                DIA: row.DIA
              }
            },
            'Fila rechazada - no insertada en BD'
          );
        }
      })
      .on('end', async () => {
        try {
          // Procesar lote restante
          if (batch.length > 0) {
            logger.debug({ fileName, batchSize: batch.length }, 'Procesando lote final');
            const result = await processBatch(batch, options, stats);
            stats.insertedRecords += result.inserted;
            stats.skippedRecords += result.skipped;
            stats.duplicateErrors += result.duplicates;
          }

          logger.info({
            fileName,
            totalRows: stats.totalRows,
            processedRows: stats.processedRows,
            emptyRows: stats.emptyRows,
            errorRows: stats.errorRows,
            insertedRecords: stats.insertedRecords,
            skippedRecords: stats.skippedRecords,
            duplicateErrors: stats.duplicateErrors
          }, 'Archivo completado');

          resolve(stats);
        } catch (error) {
          reject(error);
        }
      })
      .on('error', (error) => {
        logger.error({ fileName, error: error.message }, 'Error leyendo archivo');
        reject(error);
      });
  });
}

/**
 * Procesar un error individual de escritura de bulk
 * @param {Object} writeError - Error de escritura
 * @param {Object} failedDoc - Documento que fallo
 * @param {Object} result - Objeto de resultado para actualizar
 */
function handleWriteError(writeError, failedDoc, result) {
  const errorCode = writeError.err?.code || writeError.code;

  if (errorCode === 11000) {
    result.skipped++;
    result.duplicates++;
    logger.debug(
      {
        razon: REJECTION_REASONS.DUPLICATE_KEY,
        estacion: failedDoc?.estacion,
        magnitud: failedDoc?.magnitud,
        fecha: failedDoc?.fecha?.toISOString().split('T')[0],
        detalle: 'Combinacion estacion+magnitud+fecha ya existe'
      },
      'Registro omitido - duplicado'
    );
  } else {
    result.errors++;
    logger.warn(
      {
        razon: REJECTION_REASONS.VALIDATION_ERROR,
        error: writeError.errmsg || writeError.err?.errmsg
      },
      'Registro rechazado - error de insercion'
    );
  }
}

/**
 * Procesar errores de bulk write
 * @param {Object} bulkError - Error de bulk write
 * @param {Array} batch - Lote de documentos
 * @param {Object} result - Objeto de resultado para actualizar
 */
function processBulkWriteErrors(bulkError, batch, result) {
  if (!bulkError.writeErrors) {
    return;
  }

  for (const writeError of bulkError.writeErrors) {
    const operationIndex = writeError.index;
    const failedDoc = batch[operationIndex];
    handleWriteError(writeError, failedDoc, result);
  }
}

/**
 * Procesar lote con insercion (skip existing)
 * @param {Array} batch - Lote de documentos
 * @param {Object} result - Objeto de resultado
 * @returns {Promise<Object>}
 */
async function processBatchInsert(batch, result) {
  const operations = batch.map(airQualityData => ({
    insertOne: { document: airQualityData }
  }));

  try {
    const bulkResult = await AirQuality.bulkWrite(operations, {
      ordered: false,
      bypassDocumentValidation: false
    });
    result.inserted = bulkResult.insertedCount || 0;
  } catch (bulkError) {
    if (!bulkError.writeErrors) {
      throw bulkError;
    }
    processBulkWriteErrors(bulkError, batch, result);

    // Contar inserciones exitosas del bulkWrite
    if (bulkError.result) {
      result.inserted += bulkError.result.nInserted || 0;
    }
  }

  return result;
}

/**
 * Procesar lote con upsert (force mode)
 * @param {Array} batch - Lote de documentos
 * @param {Object} result - Objeto de resultado
 * @returns {Promise<Object>}
 */
async function processBatchUpsert(batch, result) {
  const operations = batch.map(airQualityData => ({
    updateOne: {
      filter: {
        provincia: airQualityData.provincia,
        municipio: airQualityData.municipio,
        estacion: airQualityData.estacion,
        magnitud: airQualityData.magnitud,
        fecha: airQualityData.fecha
      },
      update: { $set: airQualityData },
      upsert: true
    }
  }));

  const bulkResult = await AirQuality.bulkWrite(operations, {
    ordered: false,
    bypassDocumentValidation: false
  });

  result.inserted = (bulkResult.upsertedCount || 0) + (bulkResult.modifiedCount || 0);
  result.skipped = (bulkResult.matchedCount || 0) - (bulkResult.modifiedCount || 0);

  return result;
}

/**
 * Procesar un lote de datos con bulkWrite optimizado
 * @param {Array} batch - Lote de datos
 * @param {Object} options - Opciones de procesamiento
 * @param {Object} stats - Estadisticas de procesamiento
 * @returns {Promise<Object>} Resultado de la operacion
 */
async function processBatch(batch, options, stats) {
  const result = { inserted: 0, skipped: 0, duplicates: 0, errors: 0 };
  let retries = 0;

  while (retries < (options.maxRetries || 3)) {
    try {
      if (options.skipExisting) {
        await processBatchInsert(batch, result);
      } else {
        await processBatchUpsert(batch, result);
      }

      // Transferir errores a stats
      stats.errorRows += result.errors;
      return result;
    } catch (error) {
      retries++;
      logger.warn({
        attempt: retries,
        maxRetries: options.maxRetries || 3,
        error: error.message
      }, 'Error en lote, reintentando');

      if (retries < (options.maxRetries || 3)) {
        await new Promise(resolve => setTimeout(resolve, options.retryDelay || 2000));
      } else {
        const handledError = handleMongoError(error);
        logger.error({ error: handledError.message }, 'Lote fallido tras reintentos');
        stats.errorRows += batch.length;
        throw error;
      }
    }
  }

  return result;
}

/**
 * Importar todos los archivos de calidad del aire con procesamiento paralelo
 * @param {Object} options - Opciones de importacion
 * @returns {Promise<Object>} Estadisticas finales
 */
async function importAirQualityData(options = {}) {
  const importConfig = { ...IMPORT_CONFIG, ...options };

  logger.info({
    dataDirectory: importConfig.dataDirectory,
    maxParallel: importConfig.maxParallel
  }, 'Iniciando importacion de datos de calidad del aire');

  try {
    // Verificar que existe el directorio
    const dirStats = await fs.stat(importConfig.dataDirectory);
    if (!dirStats.isDirectory()) {
      throw new Error(`No se encontro el directorio: ${importConfig.dataDirectory}`);
    }

    // Obtener lista de archivos CSV
    const files = await fs.readdir(importConfig.dataDirectory);
    const csvFiles = files
      .filter(file => file.endsWith('.csv') && file.includes('Aire'))
      .sort();

    if (csvFiles.length === 0) {
      throw new Error('No se encontraron archivos CSV de calidad del aire');
    }

    logger.info({
      totalFiles: csvFiles.length,
      files: csvFiles.map(f => ({ name: f, month: extractMonthFromFileName(f) }))
    }, 'Archivos encontrados');

    const globalStats = {
      startTime: Date.now(),
      totalFiles: csvFiles.length,
      completedFiles: 0,
      totalRows: 0,
      processedRows: 0,
      emptyRows: 0,
      errorRows: 0,
      insertedRecords: 0,
      skippedRecords: 0,
      duplicateErrors: 0,
      fileStats: []
    };

    // Procesar archivos en lotes paralelos
    const maxParallel = importConfig.maxParallel;

    for (let i = 0; i < csvFiles.length && !isShuttingDown; i += maxParallel) {
      const batchFiles = csvFiles.slice(i, i + maxParallel);
      const batchNumber = Math.floor(i / maxParallel) + 1;
      const totalBatches = Math.ceil(csvFiles.length / maxParallel);

      logger.info({
        batchNumber,
        totalBatches,
        files: batchFiles
      }, 'Procesando lote paralelo');

      const promises = batchFiles.map((file, batchIndex) => {
        const filePath = path.join(importConfig.dataDirectory, file);
        const fileIndex = i + batchIndex + 1;

        return processAirQualityFile(filePath, importConfig)
          .then(fileStats => {
            logger.info({
              file,
              fileIndex,
              totalFiles: csvFiles.length,
              insertedRecords: fileStats.insertedRecords
            }, 'Archivo procesado');
            return fileStats;
          })
          .catch(error => {
            logger.error({ file, error: error.message }, 'Error procesando archivo');
            return {
              fileName: file,
              totalRows: 0,
              processedRows: 0,
              errorRows: 1,
              emptyRows: 0,
              insertedRecords: 0,
              skippedRecords: 0,
              duplicateErrors: 0
            };
          });
      });

      const batchResults = await Promise.all(promises);

      // Acumular estadisticas
      batchResults.forEach(fileStats => {
        globalStats.fileStats.push(fileStats);
        globalStats.completedFiles++;
        globalStats.totalRows += fileStats.totalRows;
        globalStats.processedRows += fileStats.processedRows;
        globalStats.emptyRows += fileStats.emptyRows;
        globalStats.errorRows += fileStats.errorRows;
        globalStats.insertedRecords += fileStats.insertedRecords;
        globalStats.skippedRecords += fileStats.skippedRecords;
        globalStats.duplicateErrors += fileStats.duplicateErrors || 0;
      });

      logger.info({
        batchNumber,
        progress: `${Math.min(i + maxParallel, csvFiles.length)}/${csvFiles.length}`
      }, 'Lote paralelo completado');

      // Breve pausa entre lotes para liberar recursos
      if (i + maxParallel < csvFiles.length && !isShuttingDown) {
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
    }

    globalStats.endTime = Date.now();
    globalStats.duration = globalStats.endTime - globalStats.startTime;

    return globalStats;
  } catch (error) {
    const handledError = handleMongoError(error);
    logger.error({ error: handledError.message }, 'Error en importacion de calidad del aire');
    throw error;
  }
}

/**
 * Generar resumen estadistico post-importacion
 * @returns {Promise<void>}
 */
async function generatePostImportSummary() {
  logger.info('Generando resumen estadistico de calidad del aire...');

  try {
    const totalRecords = await AirQuality.countDocuments().maxTimeMS(10000);

    // Distribucion por magnitud
    const magnitudeDistribution = await AirQuality.aggregate([
      {
        $group: {
          _id: '$magnitud',
          totalRegistros: { $sum: 1 },
          promedioCalidad: { $avg: '$processingMetadata.dataQualityScore' },
          estacionesUnicas: { $addToSet: '$puntoMuestreo' }
        }
      },
      { $sort: { totalRegistros: -1 } },
      { $limit: 20 }
    ], { maxTimeMS: 15000 });

    // Distribucion temporal
    const temporalDistribution = await AirQuality.aggregate([
      {
        $group: {
          _id: {
            año: { $year: '$fecha' },
            mes: { $month: '$fecha' }
          },
          totalRegistros: { $sum: 1 },
          magnitudesUnicas: { $addToSet: '$magnitud' }
        }
      },
      { $sort: { '_id.año': 1, '_id.mes': 1 } },
      { $limit: 12 }
    ], { maxTimeMS: 15000 });

    // Analisis de calidad de datos
    const qualityAnalysis = await AirQuality.aggregate([
      {
        $group: {
          _id: null,
          totalRegistros: { $sum: 1 },
          promedioCalidad: { $avg: '$processingMetadata.dataQualityScore' },
          registrosAltaCalidad: {
            $sum: { $cond: [{ $gte: ['$processingMetadata.dataQualityScore', 0.8] }, 1, 0] }
          },
          registrosMediaCalidad: {
            $sum: { $cond: [{ $and: [
              { $gte: ['$processingMetadata.dataQualityScore', 0.5] },
              { $lt: ['$processingMetadata.dataQualityScore', 0.8] }
            ]}, 1, 0] }
          },
          registrosBajaCalidad: {
            $sum: { $cond: [{ $lt: ['$processingMetadata.dataQualityScore', 0.5] }, 1, 0] }
          }
        }
      }
    ], { maxTimeMS: 15000 });

    logger.info({
      totalRegistros: totalRecords,
      distribucionPorMagnitud: magnitudeDistribution.map(m => ({
        magnitud: m._id,
        nombre: AIR_QUALITY_MAGNITUDES[m._id] || `Magnitud ${m._id}`,
        registros: m.totalRegistros,
        estaciones: m.estacionesUnicas.length,
        calidad: (m.promedioCalidad * 100).toFixed(1) + '%'
      })),
      distribucionTemporal: temporalDistribution.map(t => ({
        periodo: `${t._id.año}-${String(t._id.mes).padStart(2, '0')}`,
        registros: t.totalRegistros,
        contaminantes: t.magnitudesUnicas.length
      })),
      calidadDatos: qualityAnalysis[0] ? {
        promedioCalidad: (qualityAnalysis[0].promedioCalidad * 100).toFixed(1) + '%',
        altaCalidad: {
          total: qualityAnalysis[0].registrosAltaCalidad,
          porcentaje: ((qualityAnalysis[0].registrosAltaCalidad / qualityAnalysis[0].totalRegistros) * 100).toFixed(1) + '%'
        },
        mediaCalidad: {
          total: qualityAnalysis[0].registrosMediaCalidad,
          porcentaje: ((qualityAnalysis[0].registrosMediaCalidad / qualityAnalysis[0].totalRegistros) * 100).toFixed(1) + '%'
        },
        bajaCalidad: {
          total: qualityAnalysis[0].registrosBajaCalidad,
          porcentaje: ((qualityAnalysis[0].registrosBajaCalidad / qualityAnalysis[0].totalRegistros) * 100).toFixed(1) + '%'
        }
      } : null
    }, 'Resumen estadistico de calidad del aire');

  } catch (error) {
    logger.error({ error: error.message }, 'Error generando resumen estadistico');
  }
}

/**
 * Cerrar conexion de forma segura
 * @returns {Promise<void>}
 */
async function closeConnection() {
  if (mongoose.connection.readyState !== 0) {
    logger.info('Cerrando conexion a MongoDB...');
    try {
      await mongoose.connection.close();
      logger.info('Conexion cerrada correctamente');
    } catch (error) {
      logger.error({ error: error.message }, 'Error cerrando conexion');
    }
  }
}

/**
 * Funcion principal del script
 * @returns {Promise<void>}
 */
async function main() {
  const args = process.argv.slice(2);
  const options = {
    skipExisting: !args.includes('--force'),
    batchSize: parseInt(args.find(arg => arg.startsWith('--batch='))?.split('=')[1], 10) || IMPORT_CONFIG.batchSize,
    maxParallel: parseInt(args.find(arg => arg.startsWith('--parallel='))?.split('=')[1], 10) || IMPORT_CONFIG.maxParallel,
    generateSummary: !args.includes('--no-summary')
  };

  logger.info({
    options: {
      skipExisting: options.skipExisting,
      batchSize: options.batchSize,
      maxParallel: options.maxParallel,
      generateSummary: options.generateSummary
    }
  }, 'Script de importacion de calidad del aire iniciado');

  // Configurar manejadores de senales para cierre graceful
  const handleSignal = async (signal) => {
    logger.warn({ signal }, 'Senal recibida, cerrando conexiones...');
    isShuttingDown = true;
    await closeConnection();
    process.exit(0);
  };

  process.on('SIGINT', () => handleSignal('SIGINT'));
  process.on('SIGTERM', () => handleSignal('SIGTERM'));

  try {
    // Conectar a MongoDB
    logger.info('Conectando a MongoDB...');
    await connectDB(config.database.uri);
    logger.info('Conexion establecida');

    // Verificar modelo y datos actuales
    const airQualityCount = await AirQuality.countDocuments().maxTimeMS(10000);
    logger.info({ registrosActuales: airQualityCount }, 'Estado actual de la base de datos');

    // Ejecutar importacion
    const result = await importAirQualityData(options);

    if (isShuttingDown) {
      logger.warn('Importacion interrumpida por senal de cierre');
    } else {
      // Mostrar resultados finales
      const finalCount = await AirQuality.countDocuments().maxTimeMS(10000);

      logger.info({
        duracion: formatDuration(result.duration),
        velocidad: calculateProcessingSpeed(result.totalRows, result.duration),
        archivosProcesados: `${result.completedFiles}/${result.totalFiles}`,
        filasTotales: result.totalRows,
        filasValidas: result.processedRows,
        registrosInsertados: result.insertedRecords,
        registrosOmitidos: result.skippedRecords,
        filasInvalidas: result.emptyRows,
        errores: result.errorRows,
        duplicados: result.duplicateErrors,
        totalEnBD: finalCount
      }, 'Importacion de calidad del aire completada');

      // Resumen de rechazos por tipo
      const rejectionSummary = rejectionTracker.getSortedSummary();
      if (rejectionSummary.length > 0) {
        logger.info({
          totalRechazos: rejectionTracker.totalRejected,
          desglose: rejectionSummary.slice(0, 10)
        }, 'Resumen de rechazos por tipo');
      }

      // Generar resumen estadistico adicional
      if (options.generateSummary) {
        await generatePostImportSummary();
      }
    }

  } catch (error) {
    const handledError = handleMongoError(error);
    logger.error({
      error: handledError.message,
      stack: error.stack
    }, 'Error durante la importacion');
    process.exitCode = 1;

  } finally {
    await closeConnection();
  }

  logger.info('Script completado');
  if (process.exitCode === 1) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

/**
 * Manejador de cierre graceful
 * @param {string} signal - Senal recibida
 */
function handleShutdown(signal) {
  logger.warn({ signal }, 'Senal recibida, iniciando cierre...');
  isShuttingDown = true;
  closeConnection().then(() => process.exit(0));
}

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

// Ejecutar si es llamado directamente
if (require.main === module) {
  main().catch(error => {
    logger.fatal({ error: error.message }, 'Error fatal');
    process.exit(1);
  });
}

module.exports = {
  importAirQualityData,
  parseAirQualityRow,
  processAirQualityFile,
  REJECTION_REASONS
};
