/**
 * Script de Importacion de Aforo de Peatones
 *
 * Procesa y carga datos de conteo horario de trafico peatonal desde CSV
 * a MongoDB. Estructura paralela al importador de aforo de bicicletas.
 *
 * Uso: node scripts/importation/importarAforoPeatones.js [--force] [--batch=N]
 *
 * Opciones:
 *   --force    Sobrescribir registros existentes (upsert)
 *   --batch=N  Tamano del lote para inserciones (default: 500)
 *
 * @module scripts/importation/importarAforoPeatones
 */

process.env.SCRIPT_MODE = 'true';

const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const mongoose = require('mongoose');

const { connectDB } = require('../../src/config/database');
const config = require('../../src/config/config');
const { importarAforoPeatonesLogger: logger } = require('../../src/config/scriptLogger');
const { handleMongoError } = require('../../src/utils/errorUtils');
const { DATASET_YEARS, VALIDATION_LIMITS, DAY_PERIODS } = require('../../src/constants');
const {
  RejectionTracker,
  formatDuration,
  calculateProcessingSpeed,
  buildAndWriteSummary,
  parsearFechaSoloDiaUTC
} = require('./helpers/importHelpers');
const { normalizarTexto, crearLectorCSV } = require('./helpers/normalizarEncoding');
const { construirGeometryDesdeWGS84 } = require('./helpers/conversorCoordenadas');

const PedestrianTrafficCount = require('../../src/models/AforoPeatones');

const IMPORT_CONFIG = {
  batchSize: 500,
  dataFile: path.join(__dirname, '../../datos_hpe/Anthem_CTC_PeatonesAforo.csv'),
  logInterval: 5000,
  csvSeparator: ';'
};

let totalProcessed = 0;
let totalInserted = 0;
let totalSkipped = 0;
let totalRejected = 0;
let totalErrors = 0;
let startTime = null;

const rejectionTracker = new RejectionTracker();

let isShuttingDown = false;

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

const REJECTION_REASONS = {
  EMPTY_DATE: 'FECHA_VACIA',
  INVALID_DATE_FORMAT: 'FORMATO_FECHA_INVALIDO',
  DAY_OUT_OF_RANGE: 'DIA_FUERA_RANGO',
  MONTH_OUT_OF_RANGE: 'MES_FUERA_RANGO',
  YEAR_OUT_OF_RANGE: 'ANO_FUERA_RANGO_DATASET',
  INVALID_DATE: 'FECHA_INVALIDA',
  INVALID_HOUR: 'HORA_INVALIDA',
  NEGATIVE_VALUES: 'VALORES_NEGATIVOS',
  DUPLICATE_IN_DB: 'DUPLICADO_EN_BD',
  DUPLICATE_IN_FILE: 'DUPLICADO_EN_ARCHIVO',
  DUPLICATE_KEY: 'CLAVE_DUPLICADA',
  VALIDATION_ERROR: 'ERROR_VALIDACION_MODELO',
  MISSING_IDENTIFIER: 'IDENTIFICADOR_VACIO',
  // Errores de escritura en BD (writeErrors de insertMany ordered:false)
  CLAVE_DUPLICADA_INDICE_UNICO: 'CLAVE_DUPLICADA_INDICE_UNICO',
  VALIDACION_SCHEMA_FALLIDA: 'VALIDACION_SCHEMA_FALLIDA'
};

// Mismo bug que aforo-bicicletas: `new Date(Date.UTC(2051,1,29))`
// rebobinaba a 01/03/2051 sin avisar, y la fila real del 01/03 con
// misma hora+identificador se rechazaba como duplicada. Auditoria midio
// 452 grupos con valores distintos perdiendo hasta 4 965 peatones/h.
// Ahora delegamos en `parsearFechaSoloDiaUTC` (coerciona 29/02 → 28/02)
// y registramos cada coercion en el rejectionTracker para trazabilidad.
function parsearFecha(dateStr, opts = {}) {
  if (!dateStr || typeof dateStr !== 'string') {
    throw new Error(`${REJECTION_REASONS.EMPTY_DATE}: valor='${dateStr}'`);
  }

  const datePart = dateStr.trim().split(' ')[0];

  const parts = datePart.split('/');
  if (parts.length !== 3) {
    throw new Error(`${REJECTION_REASONS.INVALID_DATE_FORMAT}: valor='${dateStr}'`);
  }

  const day = parseInt(parts[0], 10);
  const monthBase1 = parseInt(parts[1], 10);
  const year = parseInt(parts[2], 10);

  if (day < VALIDATION_LIMITS.DAY_MIN || day > VALIDATION_LIMITS.DAY_MAX) {
    throw new Error(`${REJECTION_REASONS.DAY_OUT_OF_RANGE}: dia=${day}, limites=[${VALIDATION_LIMITS.DAY_MIN}-${VALIDATION_LIMITS.DAY_MAX}]`);
  }
  if (monthBase1 < 1 || monthBase1 > 12) {
    throw new Error(`${REJECTION_REASONS.MONTH_OUT_OF_RANGE}: mes=${monthBase1}`);
  }
  if (year < DATASET_YEARS.MIN_YEAR || year > DATASET_YEARS.MAX_YEAR) {
    throw new Error(`${REJECTION_REASONS.YEAR_OUT_OF_RANGE}: año=${year}, rango=[${DATASET_YEARS.MIN_YEAR}-${DATASET_YEARS.MAX_YEAR}]`);
  }

  const result = parsearFechaSoloDiaUTC(year, monthBase1, day);
  if (!result) {
    throw new Error(`${REJECTION_REASONS.INVALID_DATE}: valor='${dateStr}'`);
  }

  if (result.coercida && opts.rejectionTracker) {
    opts.rejectionTracker.coerce('FECHA_COERCIDA_AL_ULTIMO_DIA_DEL_MES', {
      fila: opts.fila,
      original: dateStr,
      coercida: result.fecha.toISOString().slice(0, 10)
    });
  }

  return result.fecha;
}

function parseHour(horaStr) {
  if (!horaStr || typeof horaStr !== 'string') {
    throw new Error(`${REJECTION_REASONS.INVALID_HOUR}: valor='${horaStr}'`);
  }

  const hour = parseInt(horaStr.trim().split(':')[0], 10);

  if (isNaN(hour) || hour < 0 || hour > 23) {
    throw new Error(`${REJECTION_REASONS.INVALID_HOUR}: valor='${horaStr}', parseado=${hour}`);
  }

  return hour;
}

function parseSpanishCoordinate(value) {
  if (value === null || value === undefined || value === '') {return null;}

  const normalized = value.toString().replace(',', '.');
  const parsed = parseFloat(normalized);
  return isNaN(parsed) ? null : parsed;
}

function getFranjaHoraria(hora) {
  if (hora >= 0 && hora <= 5) {
    return DAY_PERIODS.MADRUGADA;
  } if (hora >= 6 && hora <= 11) {
    return DAY_PERIODS.MAÑANA;
  } if (hora >= 12 && hora <= 14) {
    return DAY_PERIODS.MEDIODIA;
  } if (hora >= 15 && hora <= 20) {
    return DAY_PERIODS.TARDE;
  }
  return DAY_PERIODS.NOCHE;
}

function validarYTransformarFila(row, rowIndex) {
  // Manejar BOM en primera columna
  const fechaKey = Object.keys(row).find(k => k.includes('FECHA')) || 'FECHA';
  const fechaValue = row[fechaKey];

  const fecha = parsearFecha(fechaValue, { rejectionTracker, fila: rowIndex });
  const hora = parseHour(row.HORA);

  const identificador = normalizarTexto(row.IDENTIFICADOR);
  if (!identificador) {
    throw new Error(`${REJECTION_REASONS.MISSING_IDENTIFIER}: fila=${rowIndex}`);
  }

  const peatones = parseInt(row.PEATONES, 10);
  if (isNaN(peatones) || peatones < 0) {
    throw new Error(`${REJECTION_REASONS.NEGATIVE_VALUES}: peatones=${row.PEATONES}`);
  }

  const latitud = parseSpanishCoordinate(row.LATITUD);
  const longitud = parseSpanishCoordinate(row.LONGITUD);

  const franjaHoraria = getFranjaHoraria(hora);
  const año = fecha.getUTCFullYear();
  const mes = fecha.getUTCMonth() + 1;
  const diaSemana = fecha.getUTCDay();

  const geometry = construirGeometryDesdeWGS84(longitud, latitud);

  return {
    fecha,
    hora,
    identificador,
    peatones,
    ubicacion: {
      numeroDistrito: parseInt(row.NUMERO_DISTRITO || row['NÚMERO_DISTRITO'], 10) || null,
      distrito: normalizarTexto(row.DISTRITO) || null,
      nombreVial: normalizarTexto(row.NOMBRE_VIAL) || null,
      numero: normalizarTexto(row.NUMERO || row['NÚMERO']) || null,
      codigoPostal: normalizarTexto(row.CODIGO_POSTAL || row['CÓDIGO_POSTAL']) || null,
      observacionesDireccion: normalizarTexto(row.OBSERVACIONES_DIRECCION) || null,
      coordenadas: {
        latitud,
        longitud
      },
      geometry: geometry || undefined
    },
    franjaHoraria,
    año,
    mes,
    diaSemana,
    procesamiento: {
      archivoOrigen: 'Anthem_CTC_PeatonesAforo.csv',
      importadoEn: new Date()
    }
  };
}

async function procesarLote(batch, options) {
  const result = { inserted: 0, skipped: 0, errors: 0 };

  if (batch.length === 0) {return result;}

  if (options.skipExisting) {
    try {
      const insertResult = await PedestrianTrafficCount.insertMany(batch, {
        ordered: false,
        lean: true,
        bypassDocumentValidation: true
      });
      result.inserted = insertResult.length;
    } catch (error) {
      if (error.code === 11000) {
        const insertedCount = error.insertedDocs?.length || 0;
        result.inserted = insertedCount;
        result.skipped = batch.length - insertedCount;

        // Clasificar cada writeError por su codigo MongoDB para no perder
        // trazabilidad. El catch original solo loggeaba el conteo a debug sin
        // pasar por rejectionTracker, dejando los duplicados como cifra opaca.
        // Loggea UNA vez por codigo (primera ocurrencia) y trackea todos los
        // writeErrors en el tracker (que aplica su propio tope de samples).
        if (error.writeErrors) {
          const codigosVistos = new Set();
          for (const we of error.writeErrors) {
            const code = we.code;
            let razon;
            if (code === 11000) {
              razon = REJECTION_REASONS.CLAVE_DUPLICADA_INDICE_UNICO;
            } else if (code === 121) {
              razon = REJECTION_REASONS.VALIDACION_SCHEMA_FALLIDA;
            } else {
              razon = `WRITE_ERROR_${code}`;
            }
            if (!codigosVistos.has(code)) {
              codigosVistos.add(code);
              logger.warn(
                { code, sample: (we.errmsg || '').substring(0, 200) },
                `WriteError ${razon}: primera ocurrencia`
              );
            }
            rejectionTracker.track(razon, { code, errmsg: (we.errmsg || '').substring(0, 200) });
          }
        }
      } else {
        const handledError = handleMongoError(error);
        logger.error({ error: handledError.message }, 'Error en insercion de lote');
        result.errors = batch.length;
        throw error;
      }
    }
  } else {
    const operations = batch.map(record => ({
      updateOne: {
        filter: {
          identificador: record.identificador,
          fecha: record.fecha,
          hora: record.hora
        },
        update: { $set: record },
        upsert: true
      }
    }));

    try {
      const bulkResult = await PedestrianTrafficCount.bulkWrite(operations, {
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

async function procesarCSV(options) {
  logger.info(
    { file: IMPORT_CONFIG.dataFile },
    'Iniciando procesamiento de archivo CSV'
  );

  return new Promise((resolve, reject) => {
    const batch = [];
    let isProcessingBatch = false;
    const seenKeysInFile = new Set();
    // eslint-disable-next-line prefer-const
    let stream;

    const flushBatch = async () => {
      if (batch.length === 0) {return;}
      isProcessingBatch = true;
      stream.pause();

      try {
        const workingBatch = batch.splice(0, batch.length);

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
        // Normalizar cabeceras: el CSV es UTF-8 con BOM leido como latin1,
        // por lo que NÚMERO_DISTRITO/NÚMERO/CÓDIGO_POSTAL llegan como
        // mojibake (NÃ\x9AMERO_DISTRITO, etc.). Sin esto los lookups
        // row.NUMERO_DISTRITO / row['NÚMERO_DISTRITO'] fallan al 100%
        // y los 3 campos se importan como null.
        //
        // Pipeline (orden importa):
        //  1) Strip BOM al inicio (ï»¿ de leer UTF-8 como latin1).
        //  2) normalizarTexto: corrige mojibake (NÃ\x9A -> NÚ).
        //  3) NFD + strip combining marks: quita acentos (Ú -> U, Ó -> O)
        //     para que los lookups del importador funcionen con ASCII.
        mapHeaders: ({ header }) => normalizarTexto(
          header.replace(/^[\uFEFFï»¿]+/, '')
        )
          .normalize('NFD')
          .replace(/[̀-ͯ]/g, '')
      }));

    stream.on('data', async (row) => {
      if (isShuttingDown || isProcessingBatch) {return;}

      totalProcessed++;

      try {
        const transformedData = validarYTransformarFila(row, totalProcessed);

        const recordKey = `${transformedData.identificador}_${transformedData.fecha.toISOString()}_${transformedData.hora}`;

        if (seenKeysInFile.has(recordKey)) {
          totalRejected++;
          rejectionTracker.track(REJECTION_REASONS.DUPLICATE_IN_FILE, { fila: totalProcessed, recordKey });
          return;
        }

        seenKeysInFile.add(recordKey);
        batch.push(transformedData);

        if (batch.length >= options.batchSize) {
          await flushBatch();
        }

        if (totalProcessed % IMPORT_CONFIG.logInterval === 0) {
          const elapsed = Date.now() - startTime;
          logger.info(
            {
              procesadas: totalProcessed,
              insertadas: totalInserted,
              rechazadas: totalRejected,
              velocidad: calculateProcessingSpeed(totalProcessed, elapsed)
            },
            'Progreso de importacion'
          );
        }
      } catch (error) {
        totalErrors++;
        totalRejected++;
        rejectionTracker.track(error.message.split(':')[0] || 'ERROR_DESCONOCIDO', { fila: totalProcessed, error: error.message });

        if (totalRejected <= 20) {
          logger.warn(
            {
              fila: totalProcessed,
              razon: error.message,
              datosOriginales: {
                FECHA: row[Object.keys(row).find(k => k.includes('FECHA'))] || row.FECHA,
                IDENTIFICADOR: row.IDENTIFICADOR,
                PEATONES: row.PEATONES
              }
            },
            'Fila rechazada - no insertada en BD'
          );
        }
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

async function mostrarEstadisticas() {
  const durationMs = Date.now() - startTime;

  const [totalInDB, minDateDoc, maxDateDoc, stationCount] = await Promise.all([
    PedestrianTrafficCount.countDocuments().maxTimeMS(5000),
    PedestrianTrafficCount.findOne().sort({ fecha: 1 }).select('fecha').lean().maxTimeMS(5000),
    PedestrianTrafficCount.findOne().sort({ fecha: -1 }).select('fecha').lean().maxTimeMS(5000),
    PedestrianTrafficCount.distinct('identificador').maxTimeMS(5000)
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
    estacionesUnicas: stationCount.length,
    fechaMinima: minDateDoc?.fecha?.toISOString().split('T')[0] || 'N/A',
    fechaMaxima: maxDateDoc?.fecha?.toISOString().split('T')[0] || 'N/A'
  }, 'Importacion de aforo de peatones completada');

  const rejectionSummary = rejectionTracker.getSortedSummary();
  if (rejectionSummary.length > 0) {
    logger.info({
      totalRechazos: rejectionTracker.totalRejected,
      desglose: rejectionSummary
    }, 'Resumen de rechazos por tipo');
  }
}

async function main() {
  startTime = Date.now();

  registrarManejadoresSenales();

  const options = parsearArgumentos();

  logger.info({
    skipExisting: options.skipExisting,
    batchSize: options.batchSize,
    dataFile: IMPORT_CONFIG.dataFile
  }, 'Iniciando importacion de aforo de peatones');

  try {
    if (!fs.existsSync(IMPORT_CONFIG.dataFile)) {
      throw new Error(`Archivo no encontrado: ${IMPORT_CONFIG.dataFile}`);
    }

    logger.info('Conectando a MongoDB...');
    await connectDB(config.database.uri);
    logger.info('Conexion a MongoDB establecida');

    const initialCount = await PedestrianTrafficCount.countDocuments().maxTimeMS(5000);
    logger.info({ registrosActuales: initialCount }, 'Estado inicial de la coleccion');

    await procesarCSV(options);

    await mostrarEstadisticas();

  } catch (error) {
    const handledError = handleMongoError(error);
    logger.error({
      error: handledError.message,
      stack: error.stack
    }, 'Error fatal durante la importacion');
    process.exitCode = 1;
  } finally {
    buildAndWriteSummary('aforo-peatones', {
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

if (require.main === module) {
  main().catch(error => {
    logger.error({ error: error.message }, 'Error fatal en script de importacion');
    process.exit(1);
  });
}

module.exports = {
  parsearFecha,
  parseHour,
  parseSpanishCoordinate,
  getFranjaHoraria,
  validarYTransformarFila,
  REJECTION_REASONS
};
