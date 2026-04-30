/**
 * Script de Importacion de Contaminacion Acustica
 *
 * Procesa y carga datos de contaminacion acustica desde CSV a MongoDB.
 * Incluye mediciones de niveles sonoros (Ld, Le, Ln, LAeq24) y percentiles.
 *
 * Uso: node scripts/importation/importNoise.js [opciones]
 *
 * Opciones:
 *   --force         Sobrescribir datos existentes (upsert)
 *   --batch=N       Tamano del lote para insercion (default: 50)
 *   --station=NMT   Importar solo una estacion especifica
 *   --year=YYYY     Importar solo un ano especifico
 *   --month=MM      Importar solo un mes especifico (01-12)
 *   --validate      Solo validar archivo sin importar
 *   --help          Mostrar ayuda
 *
 * @module scripts/importation/importNoise
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
const { importNoiseLogger: logger } = require('../../src/config/scriptLogger');
const { handleMongoError } = require('../../src/utils/errorUtils');
const {
  NOISE_LIMITS,
  VALIDATION_LIMITS,
  DATASET_YEARS
} = require('../../src/constants');
const {
  RejectionTracker,
  formatDuration,
  calculateProcessingSpeed
} = require('./helpers/importHelpers');
const { normalizarTexto } = require('./helpers/normalizarEncoding');

// Modelo
const NoiseMonitoring = require('../../src/models/Ruido');

/**
 * Codigos de razon de rechazo para trazabilidad
 * @constant {Object}
 */
const REJECTION_REASONS = {
  EMPTY_DATE: 'FECHA_VACIA',
  INVALID_MONTH: 'MES_INVALIDO',
  INVALID_YEAR: 'ANO_INVALIDO',
  INVALID_NMT: 'NMT_INVALIDO',
  INVALID_DATE: 'FECHA_INVALIDA',
  NO_VALID_DATA: 'SIN_DATOS_VALIDOS',
  NOISE_OUT_OF_RANGE: 'NIVEL_RUIDO_FUERA_RANGO',
  DUPLICATE_KEY: 'CLAVE_DUPLICADA',
  VALIDATION_ERROR: 'ERROR_VALIDACION'
};

/**
 * Configuracion del importador de contaminacion acustica
 * @constant {Object}
 */
const IMPORT_CONFIG = {
  dataDirectory: path.join(__dirname, '..', '..', 'datos_hpe'),
  fileName: 'Anthem_CTC_ContaminacionAcustica.csv',
  // batchSize 1000 alineado con resto de importadores. Antes era 50 -> demasiados
  // round-trips a Mongo penalizando importacion 10-20x sin justificacion
  batchSize: 1000,
  skipExisting: true,
  logInterval: 500,
  csvSeparator: ';'
};

/**
 * Mapeo de meses en espanol a numeros
 * @constant {Object}
 */
const MONTH_MAP = {
  'ene': 1, 'feb': 2, 'mar': 3, 'abr': 4, 'may': 5, 'jun': 6,
  'jul': 7, 'ago': 8, 'sep': 9, 'oct': 10, 'nov': 11, 'dic': 12
};

/**
 * Estadisticas de importacion
 * @type {Object}
 */
const stats = {
  totalRows: 0,
  processedRows: 0,
  errorRows: 0,
  emptyRows: 0,
  insertedRecords: 0,
  skippedRecords: 0,
  startTime: null,
  errors: []
};

// Tracker de rechazos por tipo
const rejectionTracker = new RejectionTracker();

/** Flag para controlar cierre graceful */
let isShuttingDown = false;

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
 * Mostrar ayuda del script
 */
function showHelp() {
  logger.info(`
Script de Importacion de Contaminacion Acustica

Uso: node scripts/importation/importNoise.js [opciones]

Opciones:
  --force         Sobrescribir datos existentes (upsert)
  --batch=N       Tamano del lote para insercion (default: 50)
  --station=NMT   Importar solo una estacion especifica (NMT)
  --year=YYYY     Importar solo un ano especifico
  --month=MM      Importar solo un mes especifico (01-12)
  --validate      Solo validar archivo sin importar
  --help          Mostrar esta ayuda

Ejemplos:
  node scripts/importation/importNoise.js                    # Importar todos los datos
  node scripts/importation/importNoise.js --station=1        # Solo estacion NMT 1
  node scripts/importation/importNoise.js --force            # Con sobreescritura
  node scripts/importation/importNoise.js --validate         # Solo validar datos
  `);
}

/**
 * Parsear argumentos de linea de comandos
 * @returns {Object} Opciones parseadas
 */
function parseArguments() {
  const args = process.argv.slice(2);
  const options = {
    skipExisting: true,
    batchSize: IMPORT_CONFIG.batchSize,
    targetStation: null,
    targetYear: null,
    targetMonth: null,
    validateOnly: false,
    showHelp: false,
    logInterval: IMPORT_CONFIG.logInterval
  };

  for (const arg of args) {
    if (arg === '--help') {
      options.showHelp = true;
    } else if (arg === '--force') {
      options.skipExisting = false;
    } else if (arg === '--validate') {
      options.validateOnly = true;
    } else if (arg.startsWith('--batch=')) {
      const batchValue = parseInt(arg.split('=')[1], 10);
      if (!isNaN(batchValue) && batchValue > 0) {
        options.batchSize = batchValue;
      }
    } else if (arg.startsWith('--station=')) {
      const stationValue = parseInt(arg.split('=')[1], 10);
      if (!isNaN(stationValue) && stationValue > 0) {
        options.targetStation = stationValue;
      }
    } else if (arg.startsWith('--year=')) {
      const yearValue = parseInt(arg.split('=')[1], 10);
      if (!isNaN(yearValue) && yearValue >= DATASET_YEARS.VALIDATION_MIN && yearValue <= DATASET_YEARS.VALIDATION_MAX) {
        options.targetYear = yearValue;
      }
    } else if (arg.startsWith('--month=')) {
      const monthValue = parseInt(arg.split('=')[1], 10);
      if (!isNaN(monthValue) && monthValue >= VALIDATION_LIMITS.MONTH_MIN && monthValue <= VALIDATION_LIMITS.MONTH_MAX) {
        options.targetMonth = monthValue;
      }
    }
  }

  return options;
}

/**
 * Parsear nivel de ruido con validacion
 * @param {string|number} value - Valor a parsear
 * @returns {number|null} Nivel de ruido validado o null
 */
function parseNoiseLevel(value) {
  if (value === null || value === undefined || value === '' ||
      value.toString().trim() === '' || value.toString().trim() === 'N/D') {
    return null;
  }

  const parsed = parseFloat(value.toString().replace(',', '.'));

  // Validar rango usando constantes
  if (isNaN(parsed) ||
      parsed < VALIDATION_LIMITS.NOISE_MIN ||
      parsed > VALIDATION_LIMITS.NOISE_MAX) {
    return null;
  }

  return parsed;
}

/**
 * Parsear datos de una fila CSV de contaminacion acustica
 * @param {Object} row - Fila del CSV
 * @param {string} sourceFile - Archivo origen
 * @param {number} rowIndex - Indice de la fila para logging
 * @returns {Object} Datos procesados
 * @throws {Error} Si la validacion falla con razon especifica
 */
function parseNoiseRow(row, sourceFile, _rowIndex) {
  // Parsear fecha en formato "ene-51", "feb-51", etc.
  const fechaStr = row.Fecha;
  if (!fechaStr) {
    throw new Error(`${REJECTION_REASONS.EMPTY_DATE}: columna='Fecha' vacia`);
  }

  const [mesStr, añoStr] = fechaStr.split('-');
  const mes = MONTH_MAP[mesStr.toLowerCase()];
  const año = parseInt('20' + añoStr, 10);

  if (!mes) {
    throw new Error(`${REJECTION_REASONS.INVALID_MONTH}: valor='${mesStr}', permitidos=[${Object.keys(MONTH_MAP).join(', ')}]`);
  }
  if (!año || isNaN(año)) {
    throw new Error(`${REJECTION_REASONS.INVALID_YEAR}: valor='${añoStr}'`);
  }

  // Parsear NMT
  const nmt = parseInt(row.NMT, 10);
  if (isNaN(nmt)) {
    throw new Error(`${REJECTION_REASONS.INVALID_NMT}: valor='${row.NMT}'`);
  }

  // Crear fecha (primer dia del mes)
  const fecha = new Date(año, mes - 1, 1);
  if (isNaN(fecha.getTime())) {
    throw new Error(`${REJECTION_REASONS.INVALID_DATE}: ano=${año}, mes=${mes}`);
  }

  // Obtener nombre de la estacion (normalizado para corregir mojibake
  // latin1 del CSV: 'Plaza de Espa\uFFFDa' -> 'Plaza de España').
  const nombre = normalizarTexto(row.Nombre, `Estacion ${nmt}`);

  // Parsear niveles de ruido
  const nivelDiurno = parseNoiseLevel(row.Ld);
  const nivelVespertino = parseNoiseLevel(row.Le);
  const nivelNocturno = parseNoiseLevel(row.Ln);
  const laeq24 = parseNoiseLevel(row.LAeq24);

  // Parsear percentiles
  const percentiles = {
    las01: parseNoiseLevel(row.LAS01),
    las10: parseNoiseLevel(row.LAS10),
    las50: parseNoiseLevel(row.LAS50),
    las90: parseNoiseLevel(row.LAS90),
    las99: parseNoiseLevel(row.LAS99)
  };

  // Verificar que hay al menos un nivel valido
  const hasValidData = nivelDiurno !== null || nivelVespertino !== null ||
                      nivelNocturno !== null || laeq24 !== null;

  if (!hasValidData) {
    throw new Error(`${REJECTION_REASONS.NO_VALID_DATA}: Ld='${row.Ld}', Le='${row.Le}', Ln='${row.Ln}', LAeq24='${row.LAeq24}'`);
  }

  return {
    fecha,
    mes,
    año,
    nmt,
    nombre,
    nivelDiurno,
    nivelVespertino,
    nivelNocturno,
    laeq24,
    percentiles,
    processingInfo: {
      sourceFile
    }
  };
}

/**
 * Procesar el archivo CSV de contaminacion acustica
 * @param {string} filePath - Ruta al archivo CSV
 * @param {Object} options - Opciones de procesamiento
 * @returns {Promise<void>}
 */
async function processNoiseFile(filePath, options = {}) {
  const fileName = path.basename(filePath);
  logger.info({ fileName }, 'Procesando archivo de contaminacion acustica');

  return new Promise((resolve, reject) => {
    const batch = [];
    let isProcessing = false;

    const stream = createReadStream(filePath, { encoding: 'latin1' })
      .pipe(csv({ separator: IMPORT_CONFIG.csvSeparator }))
      .on('data', async (row) => {
        if (isProcessing || isShuttingDown) {return;}

        stats.totalRows++;

        try {
          const noiseData = parseNoiseRow(row, fileName, stats.totalRows);

          // Aplicar filtros opcionales
          if (options.targetStation && noiseData.nmt !== options.targetStation) {
            return;
          }
          if (options.targetYear && noiseData.año !== options.targetYear) {
            return;
          }
          if (options.targetMonth && noiseData.mes !== options.targetMonth) {
            return;
          }

          if (!options.validateOnly) {
            batch.push(noiseData);
            stats.processedRows++;

            // Procesar lote cuando alcance el tamano configurado
            if (batch.length >= options.batchSize) {
              stream.pause();
              isProcessing = true;

              try {
                const result = await processBatch(batch, options);
                stats.insertedRecords += result.inserted;
                stats.skippedRecords += result.skipped;
                stats.errorRows += result.errors;
                batch.length = 0;
              } catch (error) {
                logger.error({ error: error.message }, 'Error procesando lote');
                stats.errorRows++;
              } finally {
                isProcessing = false;
                stream.resume();
              }
            }
          } else {
            stats.processedRows++;
          }

          // Log de progreso
          if (stats.totalRows % options.logInterval === 0) {
            logger.debug({
              totalRows: stats.totalRows,
              validRows: stats.processedRows
            }, 'Progreso de lectura');
          }
        } catch (error) {
          stats.errorRows++;
          stats.emptyRows++;
          // Extraer razon de rechazo del mensaje de error
          const razon = error.message.split(':')[0] || REJECTION_REASONS.VALIDATION_ERROR;
          rejectionTracker.track(razon);
          if (stats.errors.length < 100) {
            stats.errors.push({ row: stats.totalRows, error: error.message });
          }
          logger.warn(
            {
              fila: stats.totalRows,
              razon: error.message,
              datosOriginales: {
                Fecha: row.Fecha,
                NMT: row.NMT,
                Nombre: row.Nombre,
                Ld: row.Ld,
                Le: row.Le,
                Ln: row.Ln
              }
            },
            'Fila rechazada - no insertada en BD'
          );
        }
      })
      .on('end', async () => {
        try {
          // Procesar lote restante
          if (batch.length > 0 && !options.validateOnly) {
            const result = await processBatch(batch, options);
            stats.insertedRecords += result.inserted;
            stats.skippedRecords += result.skipped;
            stats.errorRows += result.errors;
          }

          logger.info({
            fileName,
            totalRows: stats.totalRows,
            processedRows: stats.processedRows,
            emptyRows: stats.emptyRows,
            errorRows: stats.errorRows,
            insertedRecords: stats.insertedRecords,
            skippedRecords: stats.skippedRecords
          }, 'Archivo completado');

          resolve();
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
 * Procesar un lote de datos de contaminacion acustica
 * @param {Array} batch - Lote de datos
 * @param {Object} options - Opciones de procesamiento
 * @returns {Promise<Object>} Resultado de la operacion
 */
async function processBatch(batch, options) {
  const result = { inserted: 0, skipped: 0, errors: 0 };

  if (batch.length === 0) {return result;}

  if (options.skipExisting) {
    // Insertar solo si no existen
    for (const noiseData of batch) {
      try {
        const noiseMonitoring = new NoiseMonitoring(noiseData);
        await noiseMonitoring.save();
        result.inserted++;
      } catch (error) {
        if (error.code === 11000) {
          result.skipped++;
          rejectionTracker.track(REJECTION_REASONS.DUPLICATE_KEY);
          logger.debug(
            {
              razon: REJECTION_REASONS.DUPLICATE_KEY,
              nmt: noiseData.nmt,
              ano: noiseData.año,
              mes: noiseData.mes,
              detalle: 'Combinacion NMT+ano+mes ya existe'
            },
            'Registro omitido - duplicado'
          );
        } else {
          const handledError = handleMongoError(error);
          rejectionTracker.track(REJECTION_REASONS.VALIDATION_ERROR);
          logger.warn(
            {
              razon: REJECTION_REASONS.VALIDATION_ERROR,
              nmt: noiseData.nmt,
              error: handledError.message
            },
            'Registro rechazado - error de validacion'
          );
          result.errors++;
        }
      }
    }
  } else {
    // Usar upsert para sobrescribir existentes
    const operations = batch.map(noiseData => ({
      updateOne: {
        filter: {
          nmt: noiseData.nmt,
          año: noiseData.año,
          mes: noiseData.mes
        },
        update: { $set: noiseData },
        upsert: true
      }
    }));

    try {
      const bulkResult = await NoiseMonitoring.bulkWrite(operations, {
        ordered: false,
        bypassDocumentValidation: true
      });
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
 * Generar resumen estadistico post-importacion
 * @returns {Promise<void>}
 */
async function generatePostImportSummary() {
  logger.info('Generando resumen estadistico...');

  try {
    const totalRecords = await NoiseMonitoring.countDocuments().maxTimeMS(10000);

    // Distribucion por ano
    const yearDistribution = await NoiseMonitoring.aggregate([
      {
        $group: {
          _id: '$año',
          totalRegistros: { $sum: 1 },
          estacionesUnicas: { $addToSet: '$nmt' }
        }
      },
      { $sort: { _id: 1 } },
      { $limit: 10 }
    ], { maxTimeMS: 10000 });

    // Distribucion por estacion
    const stationDistribution = await NoiseMonitoring.aggregate([
      {
        $group: {
          _id: {
            nmt: '$nmt',
            nombre: '$nombre'
          },
          totalRegistros: { $sum: 1 },
          promedioLaeq24: { $avg: '$laeq24' }
        }
      },
      { $sort: { totalRegistros: -1 } },
      { $limit: 10 }
    ], { maxTimeMS: 10000 });

    // Analisis de cumplimiento normativo
    const complianceAnalysis = await NoiseMonitoring.aggregate([
      {
        $match: {
          $or: [
            { nivelDiurno: { $exists: true, $ne: null } },
            { nivelVespertino: { $exists: true, $ne: null } },
            { nivelNocturno: { $exists: true, $ne: null } }
          ]
        }
      },
      {
        $group: {
          _id: null,
          registrosConDiurno: {
            $sum: { $cond: [{ $ne: ['$nivelDiurno', null] }, 1, 0] }
          },
          excesoDiurno: {
            $sum: { $cond: [{ $gt: ['$nivelDiurno', NOISE_LIMITS.DIURNO] }, 1, 0] }
          },
          registrosConVespertino: {
            $sum: { $cond: [{ $ne: ['$nivelVespertino', null] }, 1, 0] }
          },
          excesoVespertino: {
            $sum: { $cond: [{ $gt: ['$nivelVespertino', NOISE_LIMITS.VESPERTINO] }, 1, 0] }
          },
          registrosConNocturno: {
            $sum: { $cond: [{ $ne: ['$nivelNocturno', null] }, 1, 0] }
          },
          excesoNocturno: {
            $sum: { $cond: [{ $gt: ['$nivelNocturno', NOISE_LIMITS.NOCTURNO] }, 1, 0] }
          }
        }
      }
    ], { maxTimeMS: 10000 });

    logger.info({
      totalRegistros: totalRecords,
      distribucionPorAno: yearDistribution.map(y => ({
        año: y._id,
        registros: y.totalRegistros,
        estaciones: y.estacionesUnicas.length
      })),
      topEstaciones: stationDistribution.map(s => ({
        nmt: s._id.nmt,
        nombre: s._id.nombre,
        registros: s.totalRegistros,
        promedioLaeq24: s.promedioLaeq24?.toFixed(1) || 'N/A'
      })),
      cumplimientoNormativo: complianceAnalysis[0] ? {
        diurno: {
          total: complianceAnalysis[0].registrosConDiurno,
          exceden: complianceAnalysis[0].excesoDiurno,
          limite: NOISE_LIMITS.DIURNO
        },
        vespertino: {
          total: complianceAnalysis[0].registrosConVespertino,
          exceden: complianceAnalysis[0].excesoVespertino,
          limite: NOISE_LIMITS.VESPERTINO
        },
        nocturno: {
          total: complianceAnalysis[0].registrosConNocturno,
          exceden: complianceAnalysis[0].excesoNocturno,
          limite: NOISE_LIMITS.NOCTURNO
        }
      } : null
    }, 'Resumen estadistico de contaminacion acustica');

  } catch (error) {
    logger.error({ error: error.message }, 'Error generando resumen estadistico');
  }
}

/**
 * Funcion principal del script
 */
async function main() {
  stats.startTime = Date.now();

  // Registrar manejadores de senales
  registerSignalHandlers();

  // Parsear argumentos
  const options = parseArguments();

  if (options.showHelp) {
    showHelp();
    return;
  }

  logger.info({
    skipExisting: options.skipExisting,
    batchSize: options.batchSize,
    validateOnly: options.validateOnly,
    targetStation: options.targetStation,
    targetYear: options.targetYear,
    targetMonth: options.targetMonth
  }, 'Iniciando importacion de contaminacion acustica');

  try {
    const filePath = path.join(IMPORT_CONFIG.dataDirectory, IMPORT_CONFIG.fileName);

    // Verificar que existe el archivo
    try {
      await fs.stat(filePath);
    } catch {
      throw new Error(`Archivo no encontrado: ${filePath}`);
    }

    if (!options.validateOnly) {
      // Conectar a MongoDB
      logger.info('Conectando a MongoDB...');
      await connectDB(config.database.uri);
      logger.info('Conexion a MongoDB establecida');

      const initialCount = await NoiseMonitoring.countDocuments().maxTimeMS(5000);
      logger.info({ registrosActuales: initialCount }, 'Estado inicial de la coleccion');
    } else {
      logger.info('Modo validacion: solo se verificaran los datos sin importar');
    }

    // Procesar archivo
    await processNoiseFile(filePath, options);

    // Mostrar resultados finales
    const durationMs = Date.now() - stats.startTime;

    logger.info({
      duracion: formatDuration(durationMs),
      velocidad: calculateProcessingSpeed(stats.totalRows, durationMs),
      filasTotales: stats.totalRows,
      filasProcesadas: stats.processedRows,
      filasVacias: stats.emptyRows,
      errores: stats.errorRows,
      registrosInsertados: stats.insertedRecords,
      registrosOmitidos: stats.skippedRecords
    }, options.validateOnly ? 'Validacion completada' : 'Importacion de contaminacion acustica completada');

    // Resumen de rechazos por tipo
    const rejectionSummary = rejectionTracker.getSortedSummary();
    if (rejectionSummary.length > 0) {
      logger.info({
        totalRechazos: rejectionTracker.totalRejected,
        desglose: rejectionSummary
      }, 'Resumen de rechazos por tipo');
    }

    // Generar resumen estadistico adicional
    if (!options.validateOnly) {
      await generatePostImportSummary();
    }

  } catch (error) {
    const handledError = handleMongoError(error);
    logger.error({
      error: handledError.message,
      stack: error.stack
    }, 'Error durante la importacion');
    process.exitCode = 1;
  } finally {
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
    logger.fatal({ error: error.message }, 'Error fatal');
    process.exit(1);
  });
}

module.exports = {
  parseNoiseRow,
  parseNoiseLevel,
  REJECTION_REASONS
};
