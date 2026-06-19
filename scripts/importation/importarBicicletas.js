/**
 * Script de Importacion de Disponibilidad de Bicicletas
 *
 * Procesa y carga datos de disponibilidad de bicicletas desde CSV a MongoDB.
 * Optimizado para rendimiento con manejo robusto de errores y cierre de conexiones.
 *
 * Uso: node scripts/importation/importarBicicletas.js [--force] [--batch=N]
 *
 * Opciones:
 *   --force    Sobrescribir registros existentes (upsert)
 *   --batch=N  Tamano del lote para inserciones (default: 50)
 *
 * @module scripts/importation/importarBicicletas
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
const { importarBicicletasLogger: logger } = require('../../src/config/scriptLogger');
const { handleMongoError } = require('../../src/utils/errorUtils');
const { DATASET_YEARS, VALIDATION_LIMITS } = require('../../src/constants');
const {
  RejectionTracker,
  formatDuration,
  calculateProcessingSpeed,
  buildAndWriteSummary,
  parsearNumeroFormatoEspanol,
  parsearFechaSoloDiaUTC
} = require('./helpers/importHelpers');
const { crearLectorCSV } = require('./helpers/normalizarEncoding');

// Modelo
const BikeAvailability = require('../../src/models/DisponibilidadBicicletas');

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
function parsearArgumentos() {
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
function registrarManejadoresSenales() {
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
    logger.fatal({ error: error.message, stack: error.stack }, 'UNCAUGHT EXCEPTION: excepcion no capturada');

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
    logger.fatal({ reason: String(reason) }, 'UNHANDLED REJECTION: promesa rechazada no manejada');

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

// Alias local del helper compartido en `importHelpers`. Mantenemos el
// nombre `parsearNumeroEspanol` para no cambiar todas las llamadas
// internas del importador (riesgo bajo, valor alto).
const parsearNumeroEspanol = parsearNumeroFormatoEspanol;

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
 * Parsear fecha en formato DD/MM/YYYY.
 *
 * Mismo bug que aforo-bicicletas/peatones: `Date.UTC(2051,1,29)`
 * rebobinaba silenciosamente a 01/03 y pisaba la fila real del 01/03 en
 * la dedupe `seenKeysInFile`. En este importador (registros diarios) era
 * 1 doc perdido del 01/03/2051. Ahora delegamos en
 * `parsearFechaSoloDiaUTC` que coerciona 29/02 → 28/02 y permite
 * registrar la coercion en el rejectionTracker.
 *
 * @param {string} dateStr - Fecha en formato DD/MM/YYYY
 * @param {Object} [opts]
 * @param {Object} [opts.rejectionTracker]
 * @param {number} [opts.fila]
 * @returns {Date} Objeto Date
 * @throws {Error} Si el formato es invalido o la fecha no esta en rango del dataset
 */
function parsearFecha(dateStr, opts = {}) {
  if (!dateStr || typeof dateStr !== 'string') {
    throw new Error(`${REJECTION_REASONS.EMPTY_DATE}: valor='${dateStr}'`);
  }

  const parts = dateStr.trim().split('/');
  if (parts.length !== 3) {
    throw new Error(`${REJECTION_REASONS.INVALID_DATE_FORMAT}: valor='${dateStr}'`);
  }

  const day = parseInt(parts[0], 10);
  const monthBase1 = parseInt(parts[1], 10);
  const year = parseInt(parts[2], 10);

  // Validar componentes
  if (day < VALIDATION_LIMITS.DAY_MIN || day > VALIDATION_LIMITS.DAY_MAX) {
    throw new Error(`${REJECTION_REASONS.DAY_OUT_OF_RANGE}: dia=${day}, limites=[${VALIDATION_LIMITS.DAY_MIN}-${VALIDATION_LIMITS.DAY_MAX}]`);
  }
  if (monthBase1 < 1 || monthBase1 > 12) {
    throw new Error(`${REJECTION_REASONS.MONTH_OUT_OF_RANGE}: mes=${monthBase1}`);
  }
  if (year < DATASET_YEARS.MIN_YEAR || year > DATASET_YEARS.MAX_YEAR) {
    throw new Error(`${REJECTION_REASONS.YEAR_OUT_OF_RANGE}: ano=${year}, rango=[${DATASET_YEARS.MIN_YEAR}-${DATASET_YEARS.MAX_YEAR}]`);
  }

  const result = parsearFechaSoloDiaUTC(year, monthBase1, day);
  if (!result) {
    throw new Error(`${REJECTION_REASONS.INVALID_DATE}: valor='${dateStr}'`);
  }

  // El dataset trae fechas 29/02/2051 (dia ficticio: 2051 NO es bisiesto). En
  // datos diarios/horarios el 28/02 ya existe con datos propios, asi que
  // coercionar 29->28 pisaria/duplicaria el 28 real. Por decision del proyecto se
  // DESCARTA el 29/02 explicitamente (en vez del drop silencioso por colision del
  // indice unico, que ademas corrompia el 28 en modo --force); se cuenta como
  // rechazo para que el resumen de importacion sea transparente.
  if (result.coercida) {
    throw new Error(`${REJECTION_REASONS.INVALID_DATE}: 29/02 inexistente en ${year} (dia ficticio descartado, fila ${opts.fila}): valor='${dateStr}'`);
  }

  return result.fecha;
}

/**
 * Validar y transformar una fila de datos CSV
 * @param {Object} row - Fila del CSV
 * @param {number} rowIndex - Indice de la fila
 * @returns {Object} Datos transformados para el modelo
 * @throws {Error} Si la validacion falla
 */
function validarYTransformarFila(row, rowIndex) {
  // Parsear fecha (registra coercion 29/02 → 28/02 si aplica)
  const dia = parsearFecha(row.DIA, { rejectionTracker, fila: rowIndex });

  // Parsear valores numericos. Headers ya vienen normalizados (trim) por csv-parser
  const horasTotalesUsosBicicletas = parsearNumeroEspanol(row.HORAS_TOTALES_USOS_BICICLETAS);

  const horasTotalesDisponibilidadBicicletasEnAnclajes = parsearNumeroEspanol(
    row.HORAS_TOTALES_DISPONIBILIDAD_BICICLETAS_EN_ANCLAJES
  );

  const totalHorasServicioBicicletas = parsearNumeroEspanol(row.TOTAL_HORAS_SERVICIO_BICICLETAS);
  const mediaBicicletasDisponibles = parsearNumeroEspanol(row.MEDIA_BICICLETAS_DISPONIBLES);
  // BUG fix: el CSV trae estos campos con separador de miles espanol
  // ("3.215", "5.911"...). parseInt(..., 10) trunca en el punto:
  // parseInt("3.215", 10) === 3. Usar parsearNumeroEspanol que ya maneja
  // "." como millares y "," como decimal. Sin este fix 323/366 filas (88%)
  // tenian usosAbonadoAnual y totalUsos colapsados a un solo digito.
  const usosAbonadoAnual = parsearNumeroEspanol(row.USOS_ABONADO_ANUAL);
  const usosAbonadoOcasional = parsearNumeroEspanol(row.USOS_ABONADO_OCASIONAL);
  const totalUsos = parsearNumeroEspanol(row.TOTAL_USOS);

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
    logger.warn(
      { rowIndex, totalUsos, sumUsos, diferencia: Math.abs(totalUsos - sumUsos) },
      'Discrepancia en suma de usos: totalUsos != anual + ocasional. Usando valor calculado'
    );
  }

  // Computar campos que el pre-save calcularia (bulkWrite/insertMany bypasses middleware)
  let tasaOcupacion = null;
  if (totalHorasServicioBicicletas > 0) {
    tasaOcupacion = Number(
      ((horasTotalesUsosBicicletas / totalHorasServicioBicicletas) * 100).toFixed(2)
    );
  }

  const totalUsosCalculado = sumUsos || totalUsos;
  let promedioUsosPorBicicleta = null;
  if (mediaBicicletasDisponibles > 0) {
    promedioUsosPorBicicleta = Number(
      (totalUsosCalculado / mediaBicicletasDisponibles).toFixed(2)
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
    totalUsos: totalUsosCalculado,
    tasaOcupacion,
    promedioUsosPorBicicleta
  };
}

/**
 * Verificar duplicados en base de datos
 * @param {Array<Date>} dates - Array de fechas a verificar
 * @returns {Promise<Set<string>>} Set con fechas existentes en formato ISO
 */
async function verificarDuplicados(dates) {
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
async function procesarLote(batch, options) {
  const result = { inserted: 0, skipped: 0, errors: 0 };

  if (batch.length === 0) {return result;}

  if (options.skipExisting) {
    // Insertar solo nuevos registros
    try {
      const insertResult = await BikeAvailability.insertMany(batch, {
        ordered: false,
        lean: true,
        bypassDocumentValidation: true
      });
      result.inserted = insertResult.length;
    } catch (error) {
      if (error.code === 11000) {
        // Error de duplicado parcial - contar insertados exitosos
        const insertedCount = error.insertedDocs?.length || 0;
        result.inserted = insertedCount;
        result.skipped = batch.length - insertedCount;

        // Loguear cada duplicado individual y trackearlo en el summary,
        // para que no quede como rechazo silencioso al revisar el resumen.
        if (error.writeErrors) {
          error.writeErrors.forEach(writeErr => {
            if (writeErr.code === 11000) {
              const duplicateDoc = batch[writeErr.index];
              const fechaIso = duplicateDoc?.dia?.toISOString().split('T')[0];
              rejectionTracker.track(REJECTION_REASONS.DUPLICATE_KEY, { fecha: fechaIso });
              logger.warn(
                {
                  fecha: fechaIso,
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
      const bulkResult = await BikeAvailability.bulkWrite(operations, {
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
 * Procesar archivo CSV y cargar datos
 * @param {Object} options - Opciones de procesamiento
 * @returns {Promise<void>}
 */
async function procesarCSV(options) {
  logger.info(
    { file: IMPORT_CONFIG.dataFile },
    'Iniciando procesamiento de archivo CSV'
  );

  return new Promise((resolve, reject) => {
    const batch = [];
    let isProcessingBatch = false;
    const seenDatesInFile = new Set();
    // stream se declara con let porque flushBatch (definido antes) lo referencia
    // en su closure y necesitamos asignarlo despues del setup
    // eslint-disable-next-line prefer-const
    let stream;

    const flushBatch = async () => {
      if (batch.length === 0) {return;}
      isProcessingBatch = true;
      stream.pause();

      try {
        let workingBatch = batch.splice(0, batch.length);

        if (options.skipExisting) {
          const dates = workingBatch.map(r => r.dia);
          const existingSet = await verificarDuplicados(dates);
          workingBatch = workingBatch.filter(record => {
            const isDuplicate = existingSet.has(record.dia.toISOString());
            if (isDuplicate) {
              totalSkipped++;
            }
            return !isDuplicate;
          });
        }

        if (workingBatch.length > 0) {
          const result = await procesarLote(workingBatch, options);
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

    stream = crearLectorCSV(IMPORT_CONFIG.dataFile)
      .pipe(csv({
        separator: IMPORT_CONFIG.csvSeparator,
        // Normalizar headers:
        //  - trim de bordes
        //  - reemplazar espacios internos por _
        //  - colapsar _+ a _ (sin esto, "EN _ANCLAJES" deviene "EN__ANCLAJES"
        //    y el lookup row.HORAS_..._EN_ANCLAJES devuelve undefined para
        //    las 366 filas, perdiendo el campo de disponibilidad anclajes
        //    al 100%).
        mapHeaders: ({ header }) => header.trim().replace(/\s+/g, '_').replace(/_+/g, '_')
      }));

    stream.on('data', async (row) => {
      if (isShuttingDown || isProcessingBatch) {return;}

      totalProcessed++;

      try {
        const transformedData = validarYTransformarFila(row, totalProcessed);
        const dateKey = transformedData.dia.toISOString();

        if (seenDatesInFile.has(dateKey)) {
          totalRejected++;
          rejectionTracker.track(REJECTION_REASONS.DUPLICATE_IN_FILE, { fila: totalProcessed, dateKey });
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
        rejectionTracker.track(error.message.split(':')[0] || 'ERROR_DESCONOCIDO', { fila: totalProcessed, error: error.message });
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
async function mostrarEstadisticas() {
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
  registrarManejadoresSenales();

  // Parsear argumentos
  const options = parsearArgumentos();

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
    await procesarCSV(options);

    // Mostrar estadisticas finales
    await mostrarEstadisticas();

  } catch (error) {
    const handledError = handleMongoError(error);
    logger.error({
      error: handledError.message,
      stack: error.stack
    }, 'Error fatal durante la importacion');
    process.exitCode = 1;
  } finally {
    buildAndWriteSummary('bicicletas', {
      startTime,
      counts: {
        totalProcessed,
        inserted: totalInserted,
        rejected: totalRejected,
        skipped: totalSkipped,
        errors: totalErrors
      },
      rejectionTracker
    });

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
  parsearNumeroEspanol,
  parsearFecha,
  validarYTransformarFila,
  REJECTION_REASONS
};
