/**
 * Script de Importacion de Disponibilidad de Bicicletas
 *
 * Procesa y carga datos de disponibilidad de bicicletas desde CSV a MongoDB.
 * Optimizado para rendimiento con manejo robusto de errores y cierre de conexiones.
 *
 * Uso: node scripts/importation/importBikeAvailability.js [--force] [--batch=N]
 *
 * Opciones:
 *   --force    Sobrescribir registros existentes (upsert)
 *   --batch=N  Tamano del lote para inserciones (default: 50)
 *
 * @module scripts/importation/importBikeAvailability
 */

// Configurar modo script para evitar reconexiones infinitas
process.env.SCRIPT_MODE = 'true';

const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const mongoose = require('mongoose');

// Configuracion y utilidades
const { connectDB } = require('../../src/config/database');
const config = require('../../src/config/config');
const { importBikesLogger: logger } = require('../../src/config/scriptLogger');
const { handleMongoError } = require('../../src/utils/errorUtils');
const { DATASET_YEARS, VALIDATION_LIMITS } = require('../../src/constants');
const {
  RejectionTracker,
  formatDuration,
  calculateProcessingSpeed
} = require('./helpers/importHelpers');

// Modelo
const BikeAvailability = require('../../src/models/BikeAvailability');

/**
 * Configuracion del importador
 * @constant {Object}
 */
const IMPORT_CONFIG = {
  batchSize: 50,
  dataFile: path.join(__dirname, '../../datos_hpe/Anthem_CTC_Bicicletas_Disponibilidad.csv'),
  logInterval: 50,
  csvSeparator: ';'
};

// ============================================================================
// CONTADORES GLOBALES
// ============================================================================

let totalProcessed = 0;
let totalInserted = 0;
let totalSkipped = 0;
let totalRejected = 0;
let totalErrors = 0;
let startTime = null;

// Tracker de rechazos por tipo
const rejectionTracker = new RejectionTracker();

/** Flag para controlar cierre graceful */
let isShuttingDown = false;

/**
 * Parsear argumentos de linea de comandos
 * @returns {Object} Opciones parseadas
 */
function parseArguments() {
  const args = process.argv.slice(2);
  const options = {
    skipExisting: true,
    batchSize: IMPORT_CONFIG.batchSize
  };

  for (const arg of args) {
    if (arg === '--force') {
      options.skipExisting = false;
    } else if (arg.startsWith('--batch=')) {
      const batchValue = parseInt(arg.split('=')[1], 10);
      if (!isNaN(batchValue) && batchValue > 0) {
        options.batchSize = batchValue;
      }
    }
  }

  return options;
}

/**
 * Registrar manejadores de senales para cierre graceful
 */
function registerSignalHandlers() {
  const signals = ['SIGINT', 'SIGTERM', 'SIGHUP'];

  signals.forEach(signal => {
    process.on(signal, async () => {
      if (isShuttingDown) {return;}
      isShuttingDown = true;

      logger.warn({ signal }, 'Senal de terminacion recibida, cerrando conexiones...');

      try {
        if (mongoose.connection.readyState === 1) {
          await mongoose.connection.close();
          logger.info('Conexion a MongoDB cerrada correctamente');
        }
      } catch (error) {
        logger.error({ error: error.message }, 'Error al cerrar conexion');
      }

      process.exit(0);
    });
  });

  process.on('uncaughtException', async (error) => {
    logger.fatal({ error: error.message, stack: error.stack }, 'Excepcion no capturada');

    try {
      if (mongoose.connection.readyState === 1) {
        await mongoose.connection.close();
      }
    } catch (closeError) {
      logger.error({ error: closeError.message }, 'Error al cerrar conexion tras excepcion');
    }

    process.exit(1);
  });

  process.on('unhandledRejection', async (reason) => {
    logger.fatal({ reason: String(reason) }, 'Promesa rechazada no manejada');

    try {
      if (mongoose.connection.readyState === 1) {
        await mongoose.connection.close();
      }
    } catch (closeError) {
      logger.error({ error: closeError.message }, 'Error al cerrar conexion tras rechazo');
    }

    process.exit(1);
  });
}

/**
 * Parsear numero con formato espanol (coma decimal, punto miles)
 * @param {string|number} value - Valor a parsear
 * @returns {number} Valor numerico o 0 si invalido
 */
function parseSpanishNumber(value) {
  if (value === null || value === undefined || value === '') {return 0;}

  const normalized = value.toString()
    .replace(/\./g, '')
    .replace(/,/g, '.');

  const parsed = parseFloat(normalized);
  return isNaN(parsed) ? 0 : parsed;
}

/**
 * Codigos de razon de rechazo para trazabilidad
 * @constant {Object}
 */
const REJECTION_REASONS = {
  EMPTY_DATE: 'FECHA_VACIA',
  INVALID_DATE_FORMAT: 'FORMATO_FECHA_INVALIDO',
  DAY_OUT_OF_RANGE: 'DIA_FUERA_RANGO',
  MONTH_OUT_OF_RANGE: 'MES_FUERA_RANGO',
  YEAR_OUT_OF_RANGE: 'ANO_FUERA_RANGO_DATASET',
  INVALID_DATE: 'FECHA_INVALIDA',
  NEGATIVE_VALUES: 'VALORES_NEGATIVOS',
  DUPLICATE_IN_DB: 'DUPLICADO_EN_BD',
  DUPLICATE_IN_FILE: 'DUPLICADO_EN_ARCHIVO',
  DUPLICATE_KEY: 'CLAVE_DUPLICADA',
  VALIDATION_ERROR: 'ERROR_VALIDACION_MODELO'
};

/**
 * Parsear fecha en formato DD/MM/YYYY
 * @param {string} dateStr - Fecha en formato DD/MM/YYYY
 * @returns {Date} Objeto Date
 * @throws {Error} Si el formato es invalido o la fecha no esta en rango del dataset
 */
function parseDate(dateStr) {
  if (!dateStr || typeof dateStr !== 'string') {
    throw new Error(`${REJECTION_REASONS.EMPTY_DATE}: valor='${dateStr}'`);
  }

  const parts = dateStr.trim().split('/');
  if (parts.length !== 3) {
    throw new Error(`${REJECTION_REASONS.INVALID_DATE_FORMAT}: valor='${dateStr}'`);
  }

  const day = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10) - 1;
  const year = parseInt(parts[2], 10);

  // Validar componentes
  if (day < VALIDATION_LIMITS.DAY_MIN || day > VALIDATION_LIMITS.DAY_MAX) {
    throw new Error(`${REJECTION_REASONS.DAY_OUT_OF_RANGE}: dia=${day}, limites=[${VALIDATION_LIMITS.DAY_MIN}-${VALIDATION_LIMITS.DAY_MAX}]`);
  }
  if (month < 0 || month > 11) {
    throw new Error(`${REJECTION_REASONS.MONTH_OUT_OF_RANGE}: mes=${month + 1}`);
  }
  if (year < DATASET_YEARS.MIN_YEAR || year > DATASET_YEARS.MAX_YEAR) {
    throw new Error(`${REJECTION_REASONS.YEAR_OUT_OF_RANGE}: ano=${year}, rango=[${DATASET_YEARS.MIN_YEAR}-${DATASET_YEARS.MAX_YEAR}]`);
  }

  const date = new Date(year, month, day);
  if (isNaN(date.getTime())) {
    throw new Error(`${REJECTION_REASONS.INVALID_DATE}: valor='${dateStr}'`);
  }

  return date;
}

/**
 * Validar y transformar una fila de datos CSV
 * @param {Object} row - Fila del CSV
 * @param {number} rowIndex - Indice de la fila
 * @returns {Object} Datos transformados para el modelo
 * @throws {Error} Si la validacion falla
 */
function validateAndTransformRow(row, rowIndex) {
  // Parsear fecha
  const dia = parseDate(row.DIA);

  // Parsear valores numericos (manejar espacios en nombres de columna del CSV)
  const horasTotalesUsosBicicletas = parseSpanishNumber(row.HORAS_TOTALES_USOS_BICICLETAS);

  // Nota: El CSV tiene un espacio extra en el nombre de esta columna
  const horasTotalesDisponibilidadBicicletasEnAnclajes = parseSpanishNumber(
    row['HORAS_TOTALES_DISPONIBILIDAD_BICICLETAS_EN _ANCLAJES'] ||
    row.HORAS_TOTALES_DISPONIBILIDAD_BICICLETAS_EN_ANCLAJES
  );

  const totalHorasServicioBicicletas = parseSpanishNumber(row.TOTAL_HORAS_SERVICIO_BICICLETAS);
  const mediaBicicletasDisponibles = parseSpanishNumber(row.MEDIA_BICICLETAS_DISPONIBLES);
  const usosAbonadoAnual = parseInt(row.USOS_ABONADO_ANUAL, 10) || 0;
  const usosAbonadoOcasional = parseInt(row.USOS_ABONADO_OCASIONAL, 10) || 0;
  const totalUsos = parseInt(row.TOTAL_USOS, 10) || 0;

  // Validar valores no negativos
  if (horasTotalesUsosBicicletas < 0 ||
      horasTotalesDisponibilidadBicicletasEnAnclajes < 0 ||
      totalHorasServicioBicicletas < 0 ||
      mediaBicicletasDisponibles < 0) {
    const valoresNegativos = [];
    if (horasTotalesUsosBicicletas < 0) {valoresNegativos.push(`horasTotalesUsosBicicletas=${horasTotalesUsosBicicletas}`);}
    if (horasTotalesDisponibilidadBicicletasEnAnclajes < 0) {valoresNegativos.push(`horasDisponibilidad=${horasTotalesDisponibilidadBicicletasEnAnclajes}`);}
    if (totalHorasServicioBicicletas < 0) {valoresNegativos.push(`totalHorasServicio=${totalHorasServicioBicicletas}`);}
    if (mediaBicicletasDisponibles < 0) {valoresNegativos.push(`mediaBicicletasDisponibles=${mediaBicicletasDisponibles}`);}
    throw new Error(`${REJECTION_REASONS.NEGATIVE_VALUES}: ${valoresNegativos.join(', ')}`);
  }

  // Validar coherencia de usos (modelo valida que totalUsos = anual + ocasional)
  const sumUsos = usosAbonadoAnual + usosAbonadoOcasional;
  if (totalUsos !== sumUsos && totalUsos !== 0) {
    logger.debug(
      { rowIndex, totalUsos, sumUsos },
      'Discrepancia en suma de usos, usando valor calculado'
    );
  }

  return {
    dia,
    horasTotalesUsosBicicletas,
    horasTotalesDisponibilidadBicicletasEnAnclajes,
    totalHorasServicioBicicletas,
    mediaBicicletasDisponibles,
    usosAbonadoAnual,
    usosAbonadoOcasional,
    totalUsos: sumUsos || totalUsos
  };
}

/**
 * Verificar duplicados en base de datos
 * @param {Array<Date>} dates - Array de fechas a verificar
 * @returns {Promise<Set<string>>} Set con fechas existentes en formato ISO
 */
async function checkDuplicates(dates) {
  const existingDocs = await BikeAvailability.find({
    dia: { $in: dates }
  })
    .select('dia')
    .lean()
    .maxTimeMS(10000);

  return new Set(existingDocs.map(doc => doc.dia.toISOString()));
}

/**
 * Procesar lote de registros con bulkWrite
 * @param {Array<Object>} batch - Lote de registros a insertar
 * @param {Object} options - Opciones de procesamiento
 * @returns {Promise<Object>} Resultado de la operacion
 */
async function processBatch(batch, options) {
  const result = { inserted: 0, skipped: 0, errors: 0 };

  if (batch.length === 0) {return result;}

  if (options.skipExisting) {
    // Insertar solo nuevos registros
    try {
      const insertResult = await BikeAvailability.insertMany(batch, {
        ordered: false,
        lean: true
      });
      result.inserted = insertResult.length;
    } catch (error) {
      if (error.code === 11000) {
        // Error de duplicado parcial - contar insertados exitosos
        const insertedCount = error.insertedDocs?.length || 0;
        result.inserted = insertedCount;
        result.skipped = batch.length - insertedCount;

        // Loguear cada duplicado individual
        if (error.writeErrors) {
          error.writeErrors.forEach(writeErr => {
            if (writeErr.code === 11000) {
              const duplicateDoc = batch[writeErr.index];
              logger.warn(
                {
                  fecha: duplicateDoc?.dia?.toISOString().split('T')[0],
                  razon: REJECTION_REASONS.DUPLICATE_KEY,
                  detalle: 'Clave unica ya existe en BD'
                },
                'Registro rechazado - duplicado'
              );
            }
          });
        }
      } else {
        const handledError = handleMongoError(error);
        logger.error({ error: handledError.message }, 'Error en insercion de lote');
        result.errors = batch.length;
        throw error;
      }
    }
  } else {
    // Modo upsert - actualizar si existe
    const operations = batch.map(record => ({
      updateOne: {
        filter: { dia: record.dia },
        update: { $set: record },
        upsert: true
      }
    }));

    try {
      const bulkResult = await BikeAvailability.bulkWrite(operations, { ordered: false });
      result.inserted = (bulkResult.upsertedCount || 0) + (bulkResult.modifiedCount || 0);
      result.skipped = (bulkResult.matchedCount || 0) - (bulkResult.modifiedCount || 0);
    } catch (error) {
      const handledError = handleMongoError(error);
      logger.error({ error: handledError.message }, 'Error en bulkWrite');
      result.errors = batch.length;
      throw error;
    }
  }

  return result;
}

/**
 * Procesar archivo CSV y cargar datos
 * @param {Object} options - Opciones de procesamiento
 * @returns {Promise<void>}
 */
async function processCSV(options) {
  logger.info(
    { file: IMPORT_CONFIG.dataFile },
    'Iniciando procesamiento de archivo CSV'
  );

  return new Promise((resolve, reject) => {
    const batch = [];
    let isProcessingBatch = false;
    const seenDatesInFile = new Set();
    let stream;

    const flushBatch = async () => {
      if (batch.length === 0) {return;}
      isProcessingBatch = true;
      stream.pause();

      try {
        let workingBatch = batch.splice(0, batch.length);

        if (options.skipExisting) {
          const dates = workingBatch.map(r => r.dia);
          const existingSet = await checkDuplicates(dates);
          workingBatch = workingBatch.filter(record => {
            const isDuplicate = existingSet.has(record.dia.toISOString());
            if (isDuplicate) {
              totalSkipped++;
            }
            return !isDuplicate;
          });
        }

        if (workingBatch.length > 0) {
          const result = await processBatch(workingBatch, options);
          totalInserted += result.inserted;
          totalSkipped += result.skipped;
        }
      } catch (error) {
        totalErrors++;
        logger.error({ error: error.message }, 'Error procesando lote');
      } finally {
        isProcessingBatch = false;
        if (!isShuttingDown) {
          stream.resume();
        }
      }
    };

    stream = fs.createReadStream(IMPORT_CONFIG.dataFile)
      .pipe(csv({ separator: IMPORT_CONFIG.csvSeparator }));

    stream.on('data', async (row) => {
      if (isShuttingDown || isProcessingBatch) {return;}

      totalProcessed++;

      try {
        const transformedData = validateAndTransformRow(row, totalProcessed);
        const dateKey = transformedData.dia.toISOString();

        if (seenDatesInFile.has(dateKey)) {
          totalRejected++;
          rejectionTracker.track(REJECTION_REASONS.DUPLICATE_IN_FILE);
          return;
        }

        seenDatesInFile.add(dateKey);
        batch.push(transformedData);

        if (batch.length >= options.batchSize) {
          await flushBatch();
        }

        if (totalProcessed % IMPORT_CONFIG.logInterval === 0) {
          logger.debug(
            { processed: totalProcessed, buffered: batch.length },
            'Progreso de lectura'
          );
        }
      } catch (error) {
        totalErrors++;
        totalRejected++;
        rejectionTracker.track(error.message.split(':')[0] || 'ERROR_DESCONOCIDO');
        logger.warn(
          {
            fila: totalProcessed,
            razon: error.message,
            datosOriginales: {
              DIA: row.DIA,
              TOTAL_USOS: row.TOTAL_USOS,
              USOS_ABONADO_ANUAL: row.USOS_ABONADO_ANUAL
            }
          },
          'Fila rechazada - no insertada en BD'
        );
      }
    });

    stream.on('end', async () => {
      logger.info(
        { totalProcessed, buffered: batch.length, errors: totalErrors },
        'Lectura de CSV completada'
      );

      try {
        await flushBatch();
        resolve();
      } catch (error) {
        reject(error);
      }
    });

    stream.on('error', (error) => {
      logger.error({ error: error.message }, 'Error leyendo archivo CSV');
      reject(error);
    });
  });
}

/**
 * Mostrar estadisticas finales
 * @returns {Promise<void>}
 */
async function showStatistics() {
  const durationMs = Date.now() - startTime;

  // Estadisticas de la base de datos
  const [totalInDB, minDateDoc, maxDateDoc] = await Promise.all([
    BikeAvailability.countDocuments().maxTimeMS(5000),
    BikeAvailability.findOne().sort({ dia: 1 }).select('dia').lean().maxTimeMS(5000),
    BikeAvailability.findOne().sort({ dia: -1 }).select('dia').lean().maxTimeMS(5000)
  ]);

  logger.info({
    duracion: formatDuration(durationMs),
    velocidad: calculateProcessingSpeed(totalProcessed, durationMs),
    filasProcesadas: totalProcessed,
    registrosInsertados: totalInserted,
    registrosOmitidos: totalSkipped,
    registrosRechazados: totalRejected,
    errores: totalErrors,
    totalEnBD: totalInDB,
    fechaMinima: minDateDoc?.dia?.toISOString().split('T')[0] || 'N/A',
    fechaMaxima: maxDateDoc?.dia?.toISOString().split('T')[0] || 'N/A'
  }, 'Importacion de disponibilidad de bicicletas completada');

  // Resumen de rechazos por tipo
  const rejectionSummary = rejectionTracker.getSortedSummary();
  if (rejectionSummary.length > 0) {
    logger.info({
      totalRechazos: rejectionTracker.totalRejected,
      desglose: rejectionSummary
    }, 'Resumen de rechazos por tipo');
  }
}

/**
 * Funcion principal
 */
async function main() {
  startTime = Date.now();

  // Registrar manejadores de senales
  registerSignalHandlers();

  // Parsear argumentos
  const options = parseArguments();

  logger.info({
    skipExisting: options.skipExisting,
    batchSize: options.batchSize,
    dataFile: IMPORT_CONFIG.dataFile
  }, 'Iniciando importacion de disponibilidad de bicicletas');

  try {
    // Verificar que el archivo existe
    if (!fs.existsSync(IMPORT_CONFIG.dataFile)) {
      throw new Error(`Archivo no encontrado: ${IMPORT_CONFIG.dataFile}`);
    }

    // Conectar a la base de datos
    logger.info('Conectando a MongoDB...');
    await connectDB(config.database.uri);
    logger.info('Conexion a MongoDB establecida');

    // Verificar estado inicial
    const initialCount = await BikeAvailability.countDocuments().maxTimeMS(5000);
    logger.info({ registrosActuales: initialCount }, 'Estado inicial de la coleccion');

    // Procesar CSV
    await processCSV(options);

    // Mostrar estadisticas finales
    await showStatistics();

  } catch (error) {
    const handledError = handleMongoError(error);
    logger.error({
      error: handledError.message,
      stack: error.stack
    }, 'Error fatal durante la importacion');
    process.exitCode = 1;
  } finally {
    // Cerrar conexion
    if (mongoose.connection.readyState === 1) {
      logger.info('Cerrando conexion a MongoDB...');
      try {
        await mongoose.connection.close();
        logger.info('Conexion cerrada correctamente');
      } catch (error) {
        logger.error({ error: error.message }, 'Error al cerrar conexion');
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
  parseSpanishNumber,
  parseDate,
  validateAndTransformRow,
  REJECTION_REASONS
};
