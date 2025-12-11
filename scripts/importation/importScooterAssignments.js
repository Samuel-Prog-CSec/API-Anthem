/**
 * Script de Importacion de Asignacion de Patinetes
 *
 * Script especializado para importar datos CSV de asignacion de patinetes
 * electricos a la base de datos MongoDB. Procesa el archivo de asignacion
 * del directorio datos_hpe/
 *
 * Uso: node scripts/importation/importScooterAssignments.js [opciones]
 *
 * Opciones:
 *   --force         Sobrescribir datos existentes (upsert)
 *   --batch=N       Tamano del lote (default: 50)
 *   --help          Mostrar ayuda
 *
 * @module scripts/importation/importScooterAssignments
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
const { importScootersLogger: logger } = require('../../src/config/scriptLogger');
const { handleMongoError } = require('../../src/utils/errorUtils');
const ScooterAssignment = require('../../src/models/ScooterAssignment');
const {
  RejectionTracker,
  formatDuration,
  calculateProcessingSpeed,
  cleanString
} = require('./helpers/importHelpers');
const {
  SCOOTER_PROVIDERS,
  DATASET_YEARS
} = require('../../src/constants');

// ============================================================================
// CONFIGURACION
// ============================================================================

const IMPORT_CONFIG = {
  dataFile: path.join(__dirname, '..', '..', 'datos_hpe', 'Anthem_CTC_AsignaciónPatinetes.csv'),
  batchSize: 50,
  skipExisting: true,
  logInterval: 50,
  csvSeparator: ';'
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
  DISTRITO_FALTANTE: 'Distrito faltante o vacio',
  BARRIO_FALTANTE: 'Barrio faltante o vacio',
  FILA_TOTAL: 'Fila de totales (no es dato real)',
  SIN_PROVEEDORES: 'Sin proveedores validos',

  // Errores de procesamiento
  ERROR_PROCESAMIENTO_FILA: 'Error durante el procesamiento de la fila',
  ERROR_VALIDACION_MONGOOSE: 'Error de validacion de esquema Mongoose',
  ERROR_INSERCION_BD: 'Error al insertar en base de datos',
  ERROR_DUPLICADO: 'Registro duplicado en base de datos'
};

// ============================================================================
// MAPEOS Y CONSTANTES
// ============================================================================

/**
 * Mapeo de nombres de proveedores para normalizacion
 * Mapea desde nombres en CSV a valores de constantes SCOOTER_PROVIDERS
 * @constant {Object}
 */
const PROVIDER_NAME_MAPPING = {
  'ACCIONA': SCOOTER_PROVIDERS.ACCIONA,
  'Taxify': SCOOTER_PROVIDERS.TAXIFY,
  'KOKO': SCOOTER_PROVIDERS.KOKO,
  'UFO': SCOOTER_PROVIDERS.UFO,
  'RIDECONGA': SCOOTER_PROVIDERS.RIDECONGA,
  'FLASH': SCOOTER_PROVIDERS.FLASH,
  'LIME': SCOOTER_PROVIDERS.LIME,
  'WIND ': SCOOTER_PROVIDERS.WIND,
  'WIND': SCOOTER_PROVIDERS.WIND,
  'BIRD': SCOOTER_PROVIDERS.BIRD,
  'REBY RIDES': SCOOTER_PROVIDERS.REBY_RIDES,
  'MOVO': SCOOTER_PROVIDERS.MOVO,
  'MYGO': SCOOTER_PROVIDERS.MYGO,
  'JUMP UBER': SCOOTER_PROVIDERS.JUMP_UBER,
  'SJV CONSULTING': SCOOTER_PROVIDERS.SJV_CONSULTING
};

/**
 * Campos que deben ignorarse (no son proveedores)
 * @constant {Array}
 */
const IGNORED_FIELDS = [
  'DISTRITO',
  'BARRIO',
  'TOTAL',
  '',
  ' ',
  'Total'
];

// ============================================================================
// CONTADORES GLOBALES
// ============================================================================

let totalProcessed = 0;
let totalInserted = 0;
let totalUpdated = 0;
let totalSkipped = 0;
let totalRejected = 0;
let totalErrors = 0;
let isShuttingDown = false;

// Tracker de rechazos por tipo
const rejectionTracker = new RejectionTracker();

// ============================================================================
// FUNCIONES DE PARSEO
// ============================================================================

/**
 * Parsear numero de forma segura
 * @param {string|number} value - Valor a parsear
 * @param {number} defaultValue - Valor por defecto
 * @returns {number}
 */
function parseNumber(value, defaultValue = 0) {
  if (!value || value.toString().trim() === '') {
    return defaultValue;
  }
  const cleaned = value.toString().replace(/['"]/g, '').trim();
  const parsed = parseInt(cleaned, 10);
  return isNaN(parsed) ? defaultValue : Math.max(0, parsed);
}

/**
 * Parsear datos de una fila CSV de asignacion de patinetes
 * @param {Object} row - Fila del CSV
 * @param {string} sourceFile - Archivo origen
 * @param {number} rowIndex - Indice de fila para logging
 * @returns {Object|null} - Datos procesados o null si se rechaza
 */
function parseScooterAssignmentRow(row, sourceFile, rowIndex) {
  // Limpiar y validar campos basicos
  const distrito = cleanString(row.DISTRITO, '').toUpperCase();
  const barrio = cleanString(row.BARRIO, '');

  // Validar campos obligatorios
  if (!distrito) {
    rejectionTracker.track(REJECTION_REASONS.DISTRITO_FALTANTE);
    logger.warn({
      fila: rowIndex,
      razon: REJECTION_REASONS.DISTRITO_FALTANTE,
      datosOriginales: { distrito: row.DISTRITO, barrio: row.BARRIO }
    }, 'Fila rechazada: distrito faltante');
    return null;
  }

  if (!barrio) {
    rejectionTracker.track(REJECTION_REASONS.BARRIO_FALTANTE);
    logger.warn({
      fila: rowIndex,
      razon: REJECTION_REASONS.BARRIO_FALTANTE,
      datosOriginales: { distrito: row.DISTRITO, barrio: row.BARRIO }
    }, 'Fila rechazada: barrio faltante');
    return null;
  }

  // Ignorar filas de totales
  if (distrito.includes('TOTAL') || barrio.toLowerCase().includes('total')) {
    rejectionTracker.track(REJECTION_REASONS.FILA_TOTAL);
    logger.debug({
      fila: rowIndex,
      razon: REJECTION_REASONS.FILA_TOTAL,
      datosOriginales: { distrito, barrio }
    }, 'Fila ignorada: fila de totales');
    return null;
  }

  // Procesar proveedores
  const proveedores = [];
  let totalCalculado = 0;

  Object.keys(row).forEach(columnName => {
    const cleanColumnName = cleanString(columnName, '');

    // Ignorar campos que no son proveedores
    if (IGNORED_FIELDS.includes(cleanColumnName) ||
        IGNORED_FIELDS.includes(columnName)) {
      return;
    }

    // Mapear nombre del proveedor
    const proveedorNombre = PROVIDER_NAME_MAPPING[cleanColumnName] ||
                           PROVIDER_NAME_MAPPING[columnName] ||
                           cleanColumnName;

    if (proveedorNombre && proveedorNombre.length > 0) {
      const cantidad = parseNumber(row[columnName]);

      if (cantidad >= 0) {
        proveedores.push({
          nombre: proveedorNombre,
          cantidad: cantidad,
          activo: cantidad > 0
        });
        totalCalculado += cantidad;
      }
    }
  });

  // Validar que hay al menos un proveedor
  if (proveedores.length === 0) {
    rejectionTracker.track(REJECTION_REASONS.SIN_PROVEEDORES);
    logger.warn({
      fila: rowIndex,
      razon: REJECTION_REASONS.SIN_PROVEEDORES,
      datosOriginales: { distrito, barrio }
    }, 'Fila rechazada: sin proveedores validos');
    return null;
  }

  // Verificar discrepancia en total
  const totalCSV = parseNumber(row.TOTAL);
  if (totalCSV > 0 && totalCalculado !== totalCSV) {
    logger.debug({
      fila: rowIndex,
      distrito,
      barrio,
      totalCalculado,
      totalCSV
    }, 'Discrepancia en total, usando valor calculado');
  }

  return {
    fechaAsignacion: new Date(DATASET_YEARS.DEFAULT_START_DATE),
    distrito: {
      nombre: distrito
    },
    barrio: {
      nombre: barrio
    },
    proveedores,
    estadisticas: {
      totalPatinetes: totalCalculado
    },
    procesamiento: {
      archivoOrigen: path.basename(sourceFile),
      importadoEn: new Date(),
      versionDatos: '1.0'
    }
  };
}

// ============================================================================
// PROCESAMIENTO DE ARCHIVOS
// ============================================================================

/**
 * Procesar el archivo CSV de asignacion de patinetes
 * @param {string} filePath - Ruta al archivo CSV
 * @param {Object} options - Opciones de procesamiento
 * @returns {Promise<Object>} - Estadisticas de procesamiento
 */
async function processScooterFile(filePath, options = {}) {
  const fileName = path.basename(filePath);
  logger.info({ archivo: fileName }, 'Procesando archivo de asignacion de patinetes');

  return new Promise((resolve, reject) => {
    const stats = {
      fileName,
      totalRows: 0,
      processedRows: 0,
      errorRows: 0,
      rejectedRows: 0,
      insertedRecords: 0,
      updatedRecords: 0,
      skippedRecords: 0,
      errors: []
    };

    const batch = [];
    let rowIndex = 0;

    const stream = createReadStream(filePath)
      .pipe(csv({ separator: options.csvSeparator || IMPORT_CONFIG.csvSeparator }))
      .on('data', async (row) => {
        if (isShuttingDown) {
          stream.destroy();
          return;
        }

        stats.totalRows++;
        rowIndex++;

        try {
          const assignmentData = parseScooterAssignmentRow(row, fileName, rowIndex);

          if (assignmentData) {
            batch.push(assignmentData);
            stats.processedRows++;

            // Procesar lote cuando alcance el tamano configurado
            if (batch.length >= options.batchSize) {
              stream.pause();
              const batchResult = await processBatch(batch, options);
              stats.insertedRecords += batchResult.inserted;
              stats.updatedRecords += batchResult.updated;
              stats.skippedRecords += batchResult.skipped;
              stats.errorRows += batchResult.errors;
              batch.length = 0;
              stream.resume();
            }
          } else {
            stats.rejectedRows++;
          }

          // Log de progreso
          if (stats.totalRows % (options.logInterval || IMPORT_CONFIG.logInterval) === 0) {
            logger.info({
              archivo: fileName,
              filasProcesadas: stats.totalRows,
              insertadas: stats.insertedRecords,
              rechazadas: stats.rejectedRows
            }, 'Progreso de procesamiento');
          }

        } catch (error) {
          stats.errorRows++;
          totalErrors++;
          rejectionTracker.track(REJECTION_REASONS.ERROR_PROCESAMIENTO_FILA);
          logger.error({
            fila: rowIndex,
            archivo: fileName,
            razon: REJECTION_REASONS.ERROR_PROCESAMIENTO_FILA,
            error: error.message
          }, 'Error procesando fila');

          if (stats.errors.length < 100) {
            stats.errors.push({
              row: rowIndex,
              error: error.message
            });
          }
        }
      })
      .on('end', async () => {
        try {
          // Procesar lote restante
          if (batch.length > 0 && !isShuttingDown) {
            const batchResult = await processBatch(batch, options);
            stats.insertedRecords += batchResult.inserted;
            stats.updatedRecords += batchResult.updated;
            stats.skippedRecords += batchResult.skipped;
            stats.errorRows += batchResult.errors;
          }

          // Actualizar contadores globales
          totalProcessed += stats.totalRows;
          totalInserted += stats.insertedRecords;
          totalUpdated += stats.updatedRecords;
          totalSkipped += stats.skippedRecords;
          totalRejected += stats.rejectedRows;

          logger.info({
            archivo: fileName,
            totalFilas: stats.totalRows,
            procesadas: stats.processedRows,
            insertadas: stats.insertedRecords,
            actualizadas: stats.updatedRecords,
            omitidas: stats.skippedRecords,
            rechazadas: stats.rejectedRows,
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
// PROCESAMIENTO DE LOTES
// ============================================================================

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
    logger.debug({
      razon: REJECTION_REASONS.ERROR_DUPLICADO,
      distrito: failedDoc?.distrito?.nombre,
      barrio: failedDoc?.barrio?.nombre
    }, 'Registro omitido - duplicado');
  } else {
    result.errors++;
    const errorInfo = handleMongoError(writeError.err || writeError);
    logger.warn({
      razon: REJECTION_REASONS.ERROR_INSERCION_BD,
      datosOriginales: {
        distrito: failedDoc?.distrito?.nombre,
        barrio: failedDoc?.barrio?.nombre
      },
      errorMongo: errorInfo
    }, 'Error en insercion de asignacion');
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
 * Procesar un lote de asignaciones con manejo de errores detallado
 * @param {Array} batch - Lote de datos de asignaciones
 * @param {Object} options - Opciones de procesamiento
 * @returns {Promise<Object>} - Resultado del procesamiento
 */
async function processBatch(batch, options) {
  const result = { inserted: 0, updated: 0, skipped: 0, errors: 0 };

  if (batch.length === 0) {
    return result;
  }

  if (options.skipExisting) {
    return processBatchInsert(batch, result);
  }

  return processBatchUpsert(batch, result);
}

/**
 * Procesar lote con insercion (skip existing)
 * @param {Array} batch - Lote de documentos
 * @param {Object} result - Objeto de resultado
 * @returns {Promise<Object>}
 */
async function processBatchInsert(batch, result) {
  const operations = batch.map(assignmentData => ({
    insertOne: { document: assignmentData }
  }));

  try {
    const bulkResult = await ScooterAssignment.bulkWrite(operations, {
      ordered: false,
      bypassDocumentValidation: false
    });
    result.inserted = bulkResult.insertedCount || 0;
  } catch (bulkError) {
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
  const operations = batch.map(assignmentData => ({
    updateOne: {
      filter: {
        'distrito.nombre': assignmentData.distrito.nombre,
        'barrio.nombre': assignmentData.barrio.nombre
      },
      update: { $set: assignmentData },
      upsert: true
    }
  }));

  try {
    const bulkResult = await ScooterAssignment.bulkWrite(operations, { ordered: false });
    result.inserted = bulkResult.upsertedCount || 0;
    result.updated = bulkResult.modifiedCount || 0;
    result.skipped = (bulkResult.matchedCount || 0) - (bulkResult.modifiedCount || 0);
  } catch (bulkError) {
    const errorInfo = handleMongoError(bulkError);
    logger.error({
      razon: REJECTION_REASONS.ERROR_INSERCION_BD,
      errorMongo: errorInfo
    }, 'Error en operacion upsert de lote');

    // Contar resultados parciales
    if (bulkError.result) {
      result.inserted += bulkError.result.nUpserted || 0;
      result.updated += bulkError.result.nModified || 0;
    }
  }

  return result;
}

// ============================================================================
// FUNCION DE IMPORTACION PRINCIPAL
// ============================================================================

/**
 * Importar datos de asignacion de patinetes
 * @param {Object} options - Opciones de importacion
 * @returns {Promise<Object>} - Estadisticas finales
 */
async function importScooterData(options = {}) {
  const importConfig = { ...IMPORT_CONFIG, ...options };

  logger.info({
    archivo: importConfig.dataFile,
    batchSize: importConfig.batchSize,
    skipExisting: importConfig.skipExisting
  }, 'Iniciando importacion de datos de asignacion de patinetes');

  try {
    // Verificar que existe el archivo
    try {
      await fs.access(importConfig.dataFile);
    } catch {
      throw new Error(`Archivo no encontrado: ${importConfig.dataFile}`);
    }

    const globalStats = {
      startTime: Date.now(),
      totalRows: 0,
      processedRows: 0,
      errorRows: 0,
      rejectedRows: 0,
      insertedRecords: 0,
      updatedRecords: 0,
      skippedRecords: 0
    };

    // Procesar archivo
    const fileStats = await processScooterFile(importConfig.dataFile, importConfig);

    // Acumular estadisticas
    globalStats.totalRows = fileStats.totalRows;
    globalStats.processedRows = fileStats.processedRows;
    globalStats.errorRows = fileStats.errorRows;
    globalStats.rejectedRows = fileStats.rejectedRows;
    globalStats.insertedRecords = fileStats.insertedRecords;
    globalStats.updatedRecords = fileStats.updatedRecords;
    globalStats.skippedRecords = fileStats.skippedRecords;

    globalStats.endTime = Date.now();
    globalStats.duration = globalStats.endTime - globalStats.startTime;

    return globalStats;

  } catch (error) {
    logger.error({ error: error.message }, 'Error en importacion de asignacion de patinetes');
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
    actualizadas: totalUpdated,
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

  // Mostrar ayuda
  if (args.includes('--help') || args.includes('-h')) {
    logger.info(`
Script de Importacion de Asignacion de Patinetes

Uso: node scripts/importation/importScooterAssignments.js [opciones]

Opciones:
  --force         Sobrescribir datos existentes (upsert)
  --batch=N       Tamano del lote (default: ${IMPORT_CONFIG.batchSize})
  --help, -h      Mostrar esta ayuda

Ejemplos:
  node scripts/importation/importScooterAssignments.js
  node scripts/importation/importScooterAssignments.js --force
  node scripts/importation/importScooterAssignments.js --batch=50
    `);
    return;
  }

  const options = {
    skipExisting: !args.includes('--force'),
    batchSize: parseInt(args.find(arg => arg.startsWith('--batch='))?.split('=')[1], 10) || IMPORT_CONFIG.batchSize
  };

  logger.info({
    omitirExistentes: options.skipExisting,
    tamanoLote: options.batchSize
  }, 'Iniciando script de importacion de asignacion de patinetes');

  try {
    // Conectar a MongoDB
    logger.info('Conectando a MongoDB...');
    await connectDB(config.database.uri);
    logger.info('Conexion establecida con MongoDB');

    // Verificar modelo
    const assignmentsCount = await ScooterAssignment.countDocuments().maxTimeMS(10000);
    logger.info({ registrosActuales: assignmentsCount }, 'Estado actual de la coleccion de asignaciones');

    // Ejecutar importacion
    const result = await importScooterData(options);

    // Mostrar resultados finales
    logger.info({
      duracion: formatDuration(result.duration),
      velocidad: calculateProcessingSpeed(result.totalRows, result.duration),
      filasTotales: result.totalRows,
      registrosInsertados: result.insertedRecords,
      registrosActualizados: result.updatedRecords,
      registrosOmitidos: result.skippedRecords,
      registrosRechazados: result.rejectedRows,
      errores: result.errorRows
    }, 'Importacion de asignacion de patinetes completada');

    // Estadisticas finales de la base de datos
    const finalCount = await ScooterAssignment.countDocuments().maxTimeMS(10000);
    logger.info({ totalAsignacionesBD: finalCount }, 'Total de asignaciones en la base de datos');

    // Resumen de rechazos por tipo
    const rejectionSummary = rejectionTracker.getSortedSummary();
    if (rejectionSummary.length > 0) {
      logger.info({
        totalRechazos: rejectionTracker.totalRejected,
        desglose: rejectionSummary
      }, 'Resumen de rechazos por tipo');
    }

    // Estadisticas adicionales
    const totalPatinetes = await ScooterAssignment.aggregate([
      {
        $group: {
          _id: null,
          total: { $sum: '$estadisticas.totalPatinetes' }
        }
      }
    ], { maxTimeMS: 10000 });

    if (totalPatinetes.length > 0) {
      logger.info({
        totalPatinetes: totalPatinetes[0].total
      }, 'Total de patinetes registrados');
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
  importScooterData,
  parseScooterAssignmentRow,
  REJECTION_REASONS
};
