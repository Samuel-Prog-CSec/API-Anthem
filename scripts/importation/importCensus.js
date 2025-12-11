/**
 * Script de Importación de Censo
 *
 * Script especializado para importar datos CSV del censo poblacional
 * a la base de datos MongoDB. Procesa todos los archivos de censo
 * del directorio datos_hpe/Censo/
 */

process.env.SCRIPT_MODE = 'true';

const fs = require('fs').promises;
const path = require('path');
const csv = require('csv-parser');
const { createReadStream } = require('fs');
const mongoose = require('mongoose');
const { connectDB } = require('../../src/config/database');
const config = require('../../src/config/config');
const Census = require('../../src/models/Census');
const { importCensusLogger: logger } = require('../../src/config/scriptLogger');
const { handleMongoError } = require('../../src/utils/errorUtils');
const { VALIDATION_LIMITS, DEFAULT_VALUES } = require('../../src/constants');
const {
  extractDateFromFileName,
  RejectionTracker,
  formatDuration,
  calculateProcessingSpeed,
  parseInteger,
  cleanString
} = require('./helpers/importHelpers');

// ============================================================================
// CONFIGURACIÓN
// ============================================================================

const IMPORT_CONFIG = {
  dataDirectory: path.join(__dirname, '..', '..', 'datos_hpe', 'Censo'),
  batchSize: 500,
  skipExisting: true,
  logInterval: 10000,
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
  POBLACION_CERO: 'Registro sin datos de poblacion (todos los campos poblacionales son 0)',

  // Errores de datos
  CODIGO_DISTRITO_INVALIDO: 'Codigo de distrito invalido o no numerico',
  CODIGO_BARRIO_INVALIDO: 'Codigo de barrio invalido o no numerico',
  CODIGO_SECCION_INVALIDO: 'Codigo de seccion censal invalido',
  EDAD_INVALIDA: 'Edad fuera de rango valido',

  // Errores de procesamiento
  ERROR_PROCESAMIENTO_FILA: 'Error durante el procesamiento de la fila',
  ERROR_VALIDACION_MONGOOSE: 'Error de validacion de esquema Mongoose',
  ERROR_INSERCION_BD: 'Error al insertar en base de datos',
  ERROR_DUPLICADO: 'Registro duplicado en base de datos'
};

// ============================================================================
// CONTADORES GLOBALES
// ============================================================================

let isShuttingDown = false;

// Tracker de rechazos por tipo
const rejectionTracker = new RejectionTracker();

// ============================================================================
// FUNCIONES DE PARSEO
// ============================================================================

/**
 * Parsear datos de una fila CSV de censo
 * @param {Object} row - Fila del CSV
 * @param {string} sourceFile - Archivo origen
 * @param {number} rowIndex - Índice de fila para logging
 * @returns {Object|null} - Datos procesados para el censo o null si se rechaza
 */
function parseCensusRow(row, sourceFile, rowIndex) {
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

  const { mes, año } = dateInfo;

  // Crear fecha del censo
  const fechaCenso = new Date(año, mes - 1, 1);

  // Extraer datos poblacionales usando helpers
  const españolesHombres = parseInteger(row.EspanolesHombres, 0);
  const españolesMujeres = parseInteger(row.EspanolesMujeres, 0);
  const extranjerosHombres = parseInteger(row.ExtranjerosHombres, 0);
  const extranjerosMujeres = parseInteger(row.ExtranjerosMujeres, 0);

  // Validar que al menos hay algún dato poblacional
  const totalPoblacion = españolesHombres + españolesMujeres + extranjerosHombres + extranjerosMujeres;
  if (totalPoblacion === 0) {
    rejectionTracker.track(REJECTION_REASONS.POBLACION_CERO);
    logger.warn({
      fila: rowIndex,
      razon: REJECTION_REASONS.POBLACION_CERO,
      datosOriginales: {
        españolesHombres,
        españolesMujeres,
        extranjerosHombres,
        extranjerosMujeres,
        archivo: sourceFile
      }
    }, 'Fila rechazada: registro sin poblacion');
    return null;
  }

  // Validar código de distrito
  const codigoDistrito = parseInteger(row.COD_DISTRITO, 1);
  if (codigoDistrito < 1 || codigoDistrito > 99) {
    rejectionTracker.track(REJECTION_REASONS.CODIGO_DISTRITO_INVALIDO);
    logger.warn({
      fila: rowIndex,
      razon: REJECTION_REASONS.CODIGO_DISTRITO_INVALIDO,
      datosOriginales: { codigoDistrito: row.COD_DISTRITO }
    }, 'Fila rechazada: codigo de distrito invalido');
    return null;
  }

  // Validar edad
  const edad = parseInteger(row.COD_EDAD_INT, 0);
  if (edad < VALIDATION_LIMITS.AGE_MIN || edad > VALIDATION_LIMITS.AGE_MAX) {
    rejectionTracker.track(REJECTION_REASONS.EDAD_INVALIDA);
    logger.warn({
      fila: rowIndex,
      razon: REJECTION_REASONS.EDAD_INVALIDA,
      datosOriginales: { edad: row.COD_EDAD_INT }
    }, 'Fila rechazada: edad fuera de rango');
    return null;
  }

  const censusData = {
    fechaCenso,
    mes,
    año,

    // Información del distrito
    distrito: {
      codigo: codigoDistrito,
      descripcion: cleanString(row.DESC_DISTRITO, DEFAULT_VALUES.UNSPECIFIED)
    },

    // Información del barrio
    barrio: {
      codigoDistritoBarrio: parseInteger(row.COD_DIST_BARRIO, 1),
      codigo: parseInteger(row.COD_BARRIO, 1),
      descripcion: cleanString(row.DESC_BARRIO, DEFAULT_VALUES.UNSPECIFIED)
    },

    // Información de la sección censal
    seccionCensal: {
      codigoDistritoSeccion: parseInteger(row.COD_DIST_SECCION, 1),
      codigo: parseInteger(row.COD_SECCION, 1)
    },

    // Edad del grupo poblacional
    edad,

    // Datos poblacionales por género y nacionalidad
    poblacion: {
      españoles: {
        hombres: españolesHombres,
        mujeres: españolesMujeres
      },
      extranjeros: {
        hombres: extranjerosHombres,
        mujeres: extranjerosMujeres
      }
    },

    // Información de procesamiento
    procesamiento: {
      archivoOrigen: sourceFile,
      versionDatos: '1.0'
    }
  };

  return censusData;
}

// ============================================================================
// PROCESAMIENTO DE ARCHIVOS
// ============================================================================

/**
 * Procesar un archivo CSV de censo
 * @param {string} filePath - Ruta al archivo CSV
 * @param {Object} options - Opciones de procesamiento
 * @returns {Promise<Object>} - Estadísticas de procesamiento
 */
async function processCensusFile(filePath, options = {}) {
  const fileName = path.basename(filePath);
  logger.info({ archivo: fileName }, 'Procesando archivo de censo');

  return new Promise((resolve, reject) => {
    const stats = {
      fileName,
      totalRows: 0,
      processedRows: 0,
      errorRows: 0,
      emptyRows: 0,
      insertedRecords: 0,
      skippedRecords: 0,
      errors: []
    };

    const batch = [];
    let rowIndex = 0;

    const stream = createReadStream(filePath)
      .pipe(csv({ separator: ';' }))
      .on('data', async (row) => {
        if (isShuttingDown) {
          stream.destroy();
          return;
        }

        stats.totalRows++;
        rowIndex++;

        try {
          const censusData = parseCensusRow(row, fileName, rowIndex);

          if (censusData) {
            batch.push(censusData);
            stats.processedRows++;

            // Procesar lote cuando alcance el tamaño configurado
            if (batch.length >= options.batchSize) {
              stream.pause();
              await processBatch(batch, options, stats);
              batch.length = 0;
              if (!isShuttingDown) {
                stream.resume();
              }
            }
          } else {
            stats.emptyRows++;
          }

          // Log de progreso
          if (stats.totalRows % (options.logInterval || 10000) === 0) {
            logger.info({
              archivo: fileName,
              procesadas: stats.totalRows.toLocaleString(),
              insertadas: stats.insertedRecords,
              rechazadas: stats.emptyRows
            }, 'Progreso de importacion');
          }

        } catch (error) {
          stats.errorRows++;
          logger.warn({
            fila: rowIndex,
            razon: REJECTION_REASONS.ERROR_PROCESAMIENTO_FILA,
            error: error.message,
            archivo: fileName
          }, 'Error procesando fila de censo');

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
            await processBatch(batch, options, stats);
          }

          logger.info({
            archivo: fileName,
            totalFilas: stats.totalRows,
            procesadas: stats.processedRows,
            vacias: stats.emptyRows,
            errores: stats.errorRows,
            insertadas: stats.insertedRecords,
            omitidas: stats.skippedRecords
          }, 'Archivo de censo completado');

          resolve(stats);
        } catch (error) {
          reject(error);
        }
      })
      .on('error', (error) => {
        logger.error({ error: error.message, archivo: fileName }, 'Error leyendo archivo CSV');
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
 * @param {Object} stats - Estadisticas de procesamiento
 */
function handleWriteError(writeError, failedDoc, stats) {
  const errorCode = writeError.err?.code || writeError.code;

  if (errorCode === 11000) {
    stats.skippedRecords++;
  } else {
    const mongoError = handleMongoError(writeError.err || writeError);
    logger.warn({
      razon: REJECTION_REASONS.ERROR_VALIDACION_MONGOOSE,
      error: mongoError.message,
      datosOriginales: {
        distrito: failedDoc?.distrito?.codigo,
        barrio: failedDoc?.barrio?.codigo,
        edad: failedDoc?.edad,
        mes: failedDoc?.mes,
        año: failedDoc?.año
      }
    }, 'Error insertando registro de censo');
    stats.errorRows++;
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
  const operations = batch.map(censusData => ({
    insertOne: { document: censusData }
  }));

  try {
    const result = await Census.bulkWrite(operations, {
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
  const operations = batch.map(censusData => ({
    updateOne: {
      filter: {
        'distrito.codigo': censusData.distrito.codigo,
        'barrio.codigo': censusData.barrio.codigo,
        'seccionCensal.codigo': censusData.seccionCensal.codigo,
        edad: censusData.edad,
        año: censusData.año,
        mes: censusData.mes
      },
      update: { $set: censusData },
      upsert: true
    }
  }));

  const result = await Census.bulkWrite(operations, { ordered: false });
  const nuevos = result.upsertedCount || 0;
  const actualizados = result.modifiedCount || 0;

  stats.insertedRecords += nuevos + actualizados;

  // Los matched count son registros que ya existían
  const omitidos = (result.matchedCount || 0) - actualizados;
  stats.skippedRecords += omitidos;
}

/**
 * Procesar un lote de datos de censo
 * @param {Array} batch - Lote de datos de censo
 * @param {Object} options - Opciones de procesamiento
 * @param {Object} stats - Estadísticas de procesamiento
 * @returns {Promise<void>}
 */
async function processBatch(batch, options, stats) {
  if (batch.length === 0) {
    return;
  }

  try {
    if (options.skipExisting) {
      await processBatchInsert(batch, stats);
    } else {
      await processBatchUpsert(batch, stats);
    }
  } catch (error) {
    const mongoError = handleMongoError(error);
    logger.error({
      error: mongoError.message,
      tipo: mongoError.type,
      loteSize: batch.length
    }, 'Error procesando lote de censo');
    stats.errorRows += batch.length;
  }
}

// ============================================================================
// IMPORTACIÓN PRINCIPAL
// ============================================================================

/**
 * Importar todos los archivos de censo
 * @param {Object} options - Opciones de importación
 * @returns {Promise<Object>} - Estadísticas finales
 */
async function importCensusData(options = {}) {
  const importConfig = { ...IMPORT_CONFIG, ...options };

  logger.info({
    directorio: importConfig.dataDirectory,
    batchSize: importConfig.batchSize,
    skipExisting: importConfig.skipExisting
  }, 'Iniciando importacion de datos de censo');

  try {
    // Verificar que existe el directorio
    const dirStats = await fs.stat(importConfig.dataDirectory);
    if (!dirStats.isDirectory()) {
      throw new Error(`No se encontro el directorio: ${importConfig.dataDirectory}`);
    }

    // Obtener lista de archivos CSV
    const files = await fs.readdir(importConfig.dataDirectory);
    const csvFiles = files
      .filter(file => file.endsWith('.csv') && file.includes('Censo'))
      .sort();

    if (csvFiles.length === 0) {
      throw new Error('No se encontraron archivos CSV de censo');
    }

    logger.info({
      archivosEncontrados: csvFiles.length,
      archivos: csvFiles
    }, 'Archivos de censo encontrados');

    const globalStats = {
      startTime: new Date(),
      totalFiles: csvFiles.length,
      completedFiles: 0,
      totalRows: 0,
      processedRows: 0,
      emptyRows: 0,
      errorRows: 0,
      insertedRecords: 0,
      skippedRecords: 0,
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
          emptyRows: 0,
          errorRows: 0,
          insertedRecords: 0,
          skippedRecords: 0,
          errors: ['Proceso interrumpido']
        };
      }

      const filePath = path.join(importConfig.dataDirectory, file);
      try {
        return await processCensusFile(filePath, importConfig);
      } catch (error) {
        logger.error({
          archivo: file,
          error: error.message
        }, 'Error procesando archivo de censo');
        return {
          fileName: file,
          totalRows: 0,
          processedRows: 0,
          emptyRows: 0,
          errorRows: 1,
          insertedRecords: 0,
          skippedRecords: 0,
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
        globalStats.emptyRows += fileStats.emptyRows;
        globalStats.errorRows += fileStats.errorRows;
        globalStats.insertedRecords += fileStats.insertedRecords;
        globalStats.skippedRecords += fileStats.skippedRecords;
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
    logger.error({ error: error.message }, 'Error en importacion de censo');
    throw error;
  }
}

// ============================================================================
// FUNCIÓN PRINCIPAL
// ============================================================================

/**
 * Función principal del script
 */
async function main() {
  logger.info('Iniciando script de importacion de censo');

  try {
    // Conectar a MongoDB
    logger.info('Conectando a MongoDB...');
    await connectDB(config.database.uri);
    logger.info('Conexion a MongoDB establecida');

    // Verificar que el modelo de censo esté disponible
    const censusCount = await Census.countDocuments().maxTimeMS(10000);
    logger.info({
      registrosExistentes: censusCount.toLocaleString()
    }, 'Modelo de censo verificado');

    // Ejecutar importación
    const result = await importCensusData();

    // Mostrar resultados finales
    logger.info({
      resumen: {
        duracion: formatDuration(result.duration),
        velocidad: calculateProcessingSpeed(result.totalRows, result.duration),
        archivosProcesados: `${result.completedFiles}/${result.totalFiles}`,
        totalFilasProcesadas: result.totalRows.toLocaleString(),
        registrosInsertados: result.insertedRecords.toLocaleString(),
        registrosOmitidos: result.skippedRecords.toLocaleString(),
        filasVacias: result.emptyRows.toLocaleString(),
        errores: result.errorRows.toLocaleString()
      }
    }, 'Importacion de censo completada');

    // Resumen de rechazos por tipo
    const rejectionSummary = rejectionTracker.getSortedSummary();
    if (rejectionSummary.length > 0) {
      logger.info({
        totalRechazos: rejectionTracker.totalRejected,
        desglose: rejectionSummary
      }, 'Resumen de rechazos por tipo');
    }

    // Estadísticas finales de la base de datos
    const finalCount = await Census.countDocuments().maxTimeMS(10000);
    logger.info({
      registrosFinales: finalCount.toLocaleString(),
      incremento: (finalCount - censusCount).toLocaleString()
    }, 'Estadisticas finales de la base de datos');

  } catch (error) {
    logger.error({
      error: error.message,
      stack: error.stack
    }, 'Error durante la importacion');
    process.exit(1);

  } finally {
    if (mongoose.connection.readyState === 1) {
      try {
        await mongoose.connection.close();
        logger.info('Conexion a MongoDB cerrada');
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

// ============================================================================
// MANEJO DE SEÑALES
// ============================================================================

/**
 * Manejador de señales de terminación
 * @param {string} signal - Señal recibida
 */
async function handleShutdown(signal) {
  if (isShuttingDown) {
    return;
  }
  isShuttingDown = true;

  logger.warn({ signal }, 'Senal de terminacion recibida, cerrando...');

  if (mongoose.connection.readyState === 1) {
    try {
      await mongoose.connection.close();
      logger.info('Conexion cerrada por senal de terminacion');
    } catch (error) {
      logger.error({ error: error.message }, 'Error cerrando conexion');
    }
  }

  process.exit(0);
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

// ============================================================================
// EJECUCIÓN
// ============================================================================

if (require.main === module) {
  main().catch(error => {
    logger.fatal({ error: error.message }, 'Error fatal ejecutando script');
    process.exit(1);
  });
}

module.exports = {
  importCensusData,
  parseCensusRow,
  REJECTION_REASONS
};
