/**
 * Script de Importacion de Aforo de Bicicletas
 *
 * Procesa y carga datos de conteo horario de trafico de bicicletas desde CSV a MongoDB.
 * Optimizado para rendimiento con manejo robusto de errores y cierre de conexiones.
 *
 * Uso: node scripts/importation/importarAforoBicicletas.js [--force] [--batch=N]
 *
 * Opciones:
 *   --force    Sobrescribir registros existentes (upsert)
 *   --batch=N  Tamano del lote para inserciones (default: 500)
 *
 * @module scripts/importation/importarAforoBicicletas
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
const { importarAforoBicicletasLogger: logger } = require('../../src/config/scriptLogger');
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
const atlasPlan = require('./helpers/atlasPlan');
const { crearLimitador } = require('./helpers/limitadorAtlas');

// Modelo
const BikeTrafficCount = require('../../src/models/AforoBicicletas');

/**
 * Configuracion del importador
 * @constant {Object}
 */
const IMPORT_CONFIG = {
  batchSize: 500,
  dataFile: path.join(__dirname, '../../datos_hpe/Anthem_CTC_BicicletasAforo.csv'),
  logInterval: 5000,
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
    batchSize: IMPORT_CONFIG.batchSize,
    atlas: false
  };

  for (const arg of args) {
    if (arg === '--force') {
      options.skipExisting = false;
    } else if (arg === '--atlas') {
      options.atlas = true;
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
    console.error('UNCAUGHT EXCEPTION:', error);
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
    console.error('UNHANDLED REJECTION:', reason);
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

/**
 * Parsear fecha en formato DD/MM/YYYY (puede incluir hora despues de espacio).
 *
 * Antes este parser hacia `new Date(Date.UTC(year, month, day))` directo,
 * que en el caso `29/02/2051` (2051 no es bisiesto) lo rebobinaba
 * silenciosamente a `01/03/2051`. Resultado: la fila del 29-feb se
 * insertaba con fecha falsa 01-mar y, cuando llegaba la fila REAL del
 * 01-mar con la misma hora e identificador, se rechazaba como
 * duplicada en `seenKeysInFile`. Auditoria midio 632 grupos con valores
 * distintos perdiendo hasta 96 bicis/h.
 *
 * Ahora delegamos en `parsearFechaSoloDiaUTC` que coerciona 29/02 → 28/02
 * y devuelve `coercida: true` para que el caller pueda registrar la
 * coercion en el `rejectionTracker`.
 *
 * @param {string} dateStr - Fecha en formato "DD/MM/YYYY H:MM" o "DD/MM/YYYY"
 * @param {Object} [opts] - Opciones
 * @param {Object} [opts.rejectionTracker] - Para registrar coerciones
 * @param {number} [opts.fila] - Indice de fila para la traza
 * @returns {Date} Objeto Date (solo parte de fecha, sin hora)
 * @throws {Error} Si el formato es invalido o la fecha no esta en rango del dataset
 */
function parsearFecha(dateStr, opts = {}) {
  if (!dateStr || typeof dateStr !== 'string') {
    throw new Error(`${REJECTION_REASONS.EMPTY_DATE}: valor='${dateStr}'`);
  }

  // Separar fecha de hora (formato "DD/MM/YYYY H:MM")
  const datePart = dateStr.trim().split(' ')[0];

  const parts = datePart.split('/');
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
    throw new Error(`${REJECTION_REASONS.YEAR_OUT_OF_RANGE}: año=${year}, rango=[${DATASET_YEARS.MIN_YEAR}-${DATASET_YEARS.MAX_YEAR}]`);
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
 * Parsear hora del campo HORA (formato "H:MM" o "HH:MM")
 * @param {string} horaStr - Hora en formato "H:MM"
 * @returns {number} Hora como entero (0-23)
 * @throws {Error} Si la hora no es valida
 */
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

/**
 * Parsear coordenada en formato espanol (coma como separador decimal)
 * @param {string} value - Coordenada en formato espanol (ej: "40,40547173")
 * @returns {number|null} Coordenada como float o null si invalido
 */
function parseSpanishCoordinate(value) {
  if (value === null || value === undefined || value === '') {return null;}

  const normalized = value.toString().replace(',', '.');
  const parsed = parseFloat(normalized);
  return isNaN(parsed) ? null : parsed;
}

/**
 * Determinar franja horaria a partir de la hora
 * @param {number} hora - Hora (0-23)
 * @returns {string} Franja horaria
 */
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

/**
 * Validar y transformar una fila de datos CSV
 * @param {Object} row - Fila del CSV
 * @param {number} rowIndex - Indice de la fila
 * @returns {Object} Datos transformados para el modelo
 * @throws {Error} Si la validacion falla
 */
function validarYTransformarFila(row, rowIndex) {
  // Manejar BOM en primera columna: la primera columna puede tener \uFEFF al inicio
  const fechaKey = Object.keys(row).find(k => k.includes('FECHA')) || 'FECHA';
  const fechaValue = row[fechaKey];

  // Parsear fecha (formato "DD/MM/YYYY H:MM"). Pasamos el tracker para
  // que registre las coerciones 29/02 → 28/02 en el resumen del run.
  const fecha = parsearFecha(fechaValue, { rejectionTracker, fila: rowIndex });

  // Parsear hora
  const hora = parseHour(row.HORA);

  // Validar identificador (normalizado para corregir mojibake)
  const identificador = normalizarTexto(row.IDENTIFICADOR);
  if (!identificador) {
    throw new Error(`${REJECTION_REASONS.MISSING_IDENTIFIER}: fila=${rowIndex}`);
  }

  // Parsear bicicletas
  const bicicletas = parseInt(row.BICICLETAS, 10);
  if (isNaN(bicicletas) || bicicletas < 0) {
    throw new Error(`${REJECTION_REASONS.NEGATIVE_VALUES}: bicicletas=${row.BICICLETAS}`);
  }

  // Parsear coordenadas (formato espanol con coma decimal)
  const latitud = parseSpanishCoordinate(row.LATITUD);
  const longitud = parseSpanishCoordinate(row.LONGITUD);

  // Campos calculados.
  // La fecha viene de parsearFechaSoloDiaUTC (Date.UTC), asi que derivamos
  // anio/mes/diaSemana con getters UTC (igual que el importador gemelo de
  // peatones). Con getFullYear/getMonth/getDay locales habia desfase de un
  // dia en hosts con offset negativo.
  const franjaHoraria = getFranjaHoraria(hora);
  const año = fecha.getUTCFullYear();
  const mes = fecha.getUTCMonth() + 1;
  const diaSemana = fecha.getUTCDay();

  // Derivar geometry GeoJSON WGS84 desde lat/lon directamente.
  // Habilita el endpoint /aforo-bicicletas/mapa y queries `$near`.
  const geometry = construirGeometryDesdeWGS84(longitud, latitud);

  return {
    fecha,
    hora,
    identificador,
    bicicletas,
    ubicacion: {
      numeroDistrito: parseInt(row.NUMERO_DISTRITO || row['N\u00daMERO_DISTRITO'], 10) || null,
      distrito: normalizarTexto(row.DISTRITO) || null,
      nombreVial: normalizarTexto(row.NOMBRE_VIAL) || null,
      numero: normalizarTexto(row.NUMERO || row['N\u00daMERO']) || null,
      codigoPostal: normalizarTexto(row.CODIGO_POSTAL || row['C\u00d3DIGO_POSTAL']) || null,
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
      archivoOrigen: 'Anthem_CTC_BicicletasAforo.csv',
      importadoEn: new Date()
    }
  };
}

/**
 * Procesar lote de registros con insertMany
 * @param {Array<Object>} batch - Lote de registros a insertar
 * @param {Object} options - Opciones de procesamiento
 * @returns {Promise<Object>} Resultado de la operacion
 */
async function procesarLote(batch, options) {
  const result = { inserted: 0, skipped: 0, errors: 0 };

  if (batch.length === 0) {return result;}

  if (options.skipExisting) {
    try {
      const insertResult = await BikeTrafficCount.insertMany(batch, {
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
    // Modo upsert - actualizar si existe
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
      const bulkResult = await BikeTrafficCount.bulkWrite(operations, {
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
        // row.NUMERO_DISTRITO / row['NÚMERO_DISTRITO'] fallan en 100% de
        // las 298k filas y los 3 campos se importan como null.
        //
        // Pipeline (orden importa):
        //  1) Strip BOM al inicio (ï»¿ de leer UTF-8 como latin1, o U+FEFF).
        //     Debe ir PRIMERO porque NFD descompone "ï" en "i + diaeresis"
        //     y dejaria de matchear el patron.
        //  2) normalizarTexto: corrige mojibake (Ã³ -> ó, NÃ\x9A -> NÚ).
        //  3) NFD + strip combining marks: quita acentos (Ú -> U, Ó -> O)
        //     para que los lookups del importador (row.NUMERO_DISTRITO)
        //     funcionen siempre con claves ASCII.
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

        // Clave unica para detectar duplicados en el archivo
        const recordKey = `${transformedData.identificador}_${transformedData.fecha.toISOString()}_${transformedData.hora}`;

        if (seenKeysInFile.has(recordKey)) {
          totalRejected++;
          rejectionTracker.track(REJECTION_REASONS.DUPLICATE_IN_FILE, { fila: totalProcessed, recordKey });
          return;
        }

        seenKeysInFile.add(recordKey);

        // Modo atlas: muestreo estratificado (identificador|mes|hora). Si el estrato lleno
        // su cupo se descarta la fila (se sigue leyendo; el flush final va en 'end').
        if (options.limitador && !options.limitador.aceptar(transformedData)) {
          return;
        }

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

        // Solo loguear las primeras ocurrencias a nivel warn, despues debug
        if (totalRejected <= 20) {
          logger.warn(
            {
              fila: totalProcessed,
              razon: error.message,
              datosOriginales: {
                FECHA: row[Object.keys(row).find(k => k.includes('FECHA'))] || row.FECHA,
                IDENTIFICADOR: row.IDENTIFICADOR,
                BICICLETAS: row.BICICLETAS
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

/**
 * Mostrar estadisticas finales
 * @returns {Promise<void>}
 */
async function mostrarEstadisticas() {
  const durationMs = Date.now() - startTime;

  // Estadisticas de la base de datos
  const [totalInDB, minDateDoc, maxDateDoc, stationCount] = await Promise.all([
    BikeTrafficCount.countDocuments().maxTimeMS(5000),
    BikeTrafficCount.findOne().sort({ fecha: 1 }).select('fecha').lean().maxTimeMS(5000),
    BikeTrafficCount.findOne().sort({ fecha: -1 }).select('fecha').lean().maxTimeMS(5000),
    BikeTrafficCount.distinct('identificador').maxTimeMS(5000)
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
  }, 'Importacion de aforo de bicicletas completada');

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

  // Modo atlas: limitador estratificado por identificador|mes|hora (cubre estaciones,
  // los 12 meses y el patron horario 0-23h). En modo normal es null (sin efecto).
  options.limitador = crearLimitador(
    options.atlas,
    atlasPlan['aforo-bicicletas'],
    (doc) => `${doc.identificador}|${doc.mes}|${doc.hora}`
  );

  logger.info({
    skipExisting: options.skipExisting,
    batchSize: options.batchSize,
    atlas: options.atlas,
    dataFile: IMPORT_CONFIG.dataFile
  }, 'Iniciando importacion de aforo de bicicletas');

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
    const initialCount = await BikeTrafficCount.countDocuments().maxTimeMS(5000);
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
    buildAndWriteSummary('aforo-bicicletas', {
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
  parsearFecha,
  parseHour,
  parseSpanishCoordinate,
  getFranjaHoraria,
  validarYTransformarFila,
  REJECTION_REASONS
};
