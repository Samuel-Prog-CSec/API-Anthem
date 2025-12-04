/**
 * Script de Importacion de Contenedores
 *
 * Procesa y carga datos de contenedores de residuos desde CSV a MongoDB.
 * Optimizado para alto volumen de datos (~50k registros).
 *
 * Uso: node scripts/importation/importContainers.js [--force] [--batch=N]
 *
 * Opciones:
 *   --force    Sobrescribir registros existentes (upsert)
 *   --batch=N  Tamano del lote para inserciones (default: 2000)
 *
 * @module scripts/importation/importContainers
 */

const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const mongoose = require('mongoose');

// Configuracion y utilidades
const { connectDB } = require('../../src/config/database');
const { logger } = require('../../src/config/logger');
const { handleMongoError } = require('../../src/utils/errorUtils');
const {
  CONTAINER_TYPES,
  CONTAINER_LOTES,
  VALIDATION_LIMITS,
  DEFAULT_VALUES
} = require('../../src/constants');
const {
  RejectionTracker,
  formatDuration,
  calculateProcessingSpeed
} = require('./helpers/importHelpers');

// Logger especifico para importacion
const importLogger = logger.child({ component: 'import-containers' });

// Modelo
const Container = require('../../src/models/Container');

/**
 * Codigos de razon de rechazo para trazabilidad
 * @constant {Object}
 */
const REJECTION_REASONS = {
  MISSING_CODIGO: 'CODIGO_INTERNO_FALTANTE',
  INVALID_CONTAINER_TYPE: 'TIPO_CONTENEDOR_INVALIDO',
  INVALID_LOTE: 'LOTE_INVALIDO',
  MISSING_DISTRITO: 'DISTRITO_FALTANTE',
  MISSING_UTM_COORDS: 'COORDENADAS_UTM_FALTANTES',
  MISSING_GEO_COORDS: 'COORDENADAS_GEOGRAFICAS_FALTANTES',
  COORDS_OUT_OF_RANGE: 'COORDENADAS_FUERA_RANGO',
  DUPLICATE_IN_FILE: 'DUPLICADO_EN_ARCHIVO',
  DUPLICATE_IN_DB: 'DUPLICADO_EN_BD',
  DUPLICATE_KEY: 'CLAVE_DUPLICADA',
  VALIDATION_ERROR: 'ERROR_VALIDACION'
};

/**
 * Configuracion del importador
 * @constant {Object}
 */
const IMPORT_CONFIG = {
  batchSize: 2000,
  dataFile: path.join(__dirname, '../../datos_hpe/Anthem_CTC_Contenedores_Ubicacion.csv'),
  logInterval: 5000,
  csvSeparator: ';',
  maxPoolSize: 50,
  minPoolSize: 10
};

/**
 * Estadisticas de importacion
 * @type {Object}
 */
const stats = {
  totalProcessed: 0,
  totalInserted: 0,
  totalSkipped: 0,
  totalErrors: 0,
  duplicatesInFile: 0,
  startTime: null,
  errors: []
};

// Tracker de rechazos por tipo
const rejectionTracker = new RejectionTracker();

/** Cache de claves unicas para deteccion de duplicados en memoria */
const processedKeys = new Set();

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

      importLogger.warn({ signal }, 'Senal de terminacion recibida, cerrando conexiones...');

      try {
        if (mongoose.connection.readyState === 1) {
          await mongoose.connection.close();
          importLogger.info('Conexion a MongoDB cerrada correctamente');
        }
      } catch (error) {
        importLogger.error({ error: error.message }, 'Error al cerrar conexion');
      }

      process.exit(0);
    });
  });

  process.on('uncaughtException', async (error) => {
    importLogger.fatal({ error: error.message, stack: error.stack }, 'Excepcion no capturada');

    try {
      if (mongoose.connection.readyState === 1) {
        await mongoose.connection.close();
      }
    } catch (closeError) {
      importLogger.error({ error: closeError.message }, 'Error al cerrar conexion tras excepcion');
    }

    process.exit(1);
  });

  process.on('unhandledRejection', async (reason) => {
    importLogger.fatal({ reason: String(reason) }, 'Promesa rechazada no manejada');

    try {
      if (mongoose.connection.readyState === 1) {
        await mongoose.connection.close();
      }
    } catch (closeError) {
      importLogger.error({ error: closeError.message }, 'Error al cerrar conexion tras rechazo');
    }

    process.exit(1);
  });
}

/**
 * Limpiar y normalizar string
 * @param {string} str - String a limpiar
 * @returns {string} String limpio
 */
function cleanString(str) {
  if (!str) {return '';}
  return str.toString().trim().replace(/\s+/g, ' ');
}

/**
 * Parsear numero
 * @param {string|number} value - Valor a parsear
 * @returns {number|null} Valor numerico o null si invalido
 */
function parseNumber(value) {
  if (value === null || value === undefined || value === '') {return null;}
  const normalized = value.toString().replace(/,/g, '.');
  const parsed = parseFloat(normalized);
  return isNaN(parsed) ? null : parsed;
}

/**
 * Normalizar tipo de contenedor usando constantes
 * @param {string} tipo - Tipo de contenedor del CSV
 * @returns {string|null} Tipo normalizado o null si invalido
 */
function normalizeContainerType(tipo) {
  if (!tipo) {return null;}

  const normalized = tipo.toString().trim().toUpperCase();

  // Mapeo de variaciones a tipos validos del enum
  const typeMap = {
    'ORGANICA': CONTAINER_TYPES.ORGANICA,
    'ORGÁNICA': CONTAINER_TYPES.ORGANICA,
    'RESTO': CONTAINER_TYPES.RESTO,
    'ENVASES': CONTAINER_TYPES.ENVASES,
    'ENVASE': CONTAINER_TYPES.ENVASES,
    'VIDRIO': CONTAINER_TYPES.VIDRIO,
    'PAPEL-CARTON': CONTAINER_TYPES.PAPEL_CARTON,
    'PAPEL-CARTÓN': CONTAINER_TYPES.PAPEL_CARTON,
    'PAPELCARTON': CONTAINER_TYPES.PAPEL_CARTON,
    'PAPEL': CONTAINER_TYPES.PAPEL_CARTON
  };

  return typeMap[normalized] || null;
}

/**
 * Generar clave unica para el contenedor
 * @param {Object} data - Datos del contenedor
 * @returns {string} Clave unica
 */
function generateUniqueKey(data) {
  return `${data.codigoInternoSituado}_${data.tipoContenedor}_${data.coordenadas.x}_${data.coordenadas.y}`;
}

/**
 * Validar y transformar una fila de datos CSV
 * @param {Object} row - Fila del CSV
 * @param {number} rowIndex - Indice de la fila
 * @returns {Object} Datos transformados para el modelo
 * @throws {Error} Si la validacion falla
 */
function validateAndTransformRow(row, _rowIndex) {
  // Extraer y limpiar datos basicos (manejar encoding de columnas)
  const codigoInternoSituado = cleanString(row['Código Interno del Situad'] || row['C�digo Interno del Situad']);
  const tipoContenedor = normalizeContainerType(row['Tipo Contenedor']);

  // Validaciones basicas
  if (!codigoInternoSituado) {
    throw new Error(`${REJECTION_REASONS.MISSING_CODIGO}: columna='Codigo Interno del Situad'`);
  }

  if (!tipoContenedor) {
    throw new Error(`${REJECTION_REASONS.INVALID_CONTAINER_TYPE}: valor='${row['Tipo Contenedor']}', permitidos=[${Object.values(CONTAINER_TYPES).join(', ')}]`);
  }

  // Datos del contenedor
  const modelo = cleanString(row.Modelo);
  const descripcionModelo = cleanString(row['Descripcion Modelo']);
  const cantidad = parseInt(row.Cantidad, 10) || 1;
  const lote = parseInt(row.Lote, 10);

  // Validar lote usando constantes
  if (!lote || !CONTAINER_LOTES.includes(lote)) {
    throw new Error(`${REJECTION_REASONS.INVALID_LOTE}: valor='${row.Lote}', permitidos=[${CONTAINER_LOTES.join(', ')}]`);
  }

  // Informacion geografica
  const distrito = cleanString(row.Distrito);
  const barrio = cleanString(row.Barrio);

  if (!distrito) {
    throw new Error(`${REJECTION_REASONS.MISSING_DISTRITO}: columna='Distrito' vacia`);
  }

  // El barrio puede estar vacio, usar valor por defecto
  const barrioFinal = barrio || DEFAULT_VALUES.UNSPECIFIED;

  // Direccion (manejar encoding)
  const tipoVia = cleanString(row['Tipo Vía'] || row['Tipo V�a']);
  const nombreVia = cleanString(row.Nombre);
  const numero = cleanString(row['Número'] || row['N�mero']);

  // Coordenadas UTM
  const coordX = parseNumber(row['COORDENADA X']);
  const coordY = parseNumber(row['COORDENADA Y']);

  if (coordX === null || coordY === null) {
    throw new Error(`${REJECTION_REASONS.MISSING_UTM_COORDS}: X='${row['COORDENADA X']}', Y='${row['COORDENADA Y']}'`);
  }

  // Coordenadas geograficas (longitud, latitud)
  const longitude = parseNumber(row.LONGITUD);
  const latitude = parseNumber(row.LATITUD);

  if (longitude === null || latitude === null) {
    throw new Error(`${REJECTION_REASONS.MISSING_GEO_COORDS}: longitud='${row.LONGITUD}', latitud='${row.LATITUD}'`);
  }

  // Validar rango de coordenadas usando constantes
  if (longitude < VALIDATION_LIMITS.LONGITUDE_MIN || longitude > VALIDATION_LIMITS.LONGITUDE_MAX ||
      latitude < VALIDATION_LIMITS.LATITUDE_MIN || latitude > VALIDATION_LIMITS.LATITUDE_MAX) {
    throw new Error(`${REJECTION_REASONS.COORDS_OUT_OF_RANGE}: lon=${longitude}, lat=${latitude}, rango=[${VALIDATION_LIMITS.LONGITUDE_MIN}-${VALIDATION_LIMITS.LONGITUDE_MAX}, ${VALIDATION_LIMITS.LATITUDE_MIN}-${VALIDATION_LIMITS.LATITUDE_MAX}]`);
  }

  // Generar nombre de via si falta
  const nombreViaFinal = nombreVia || `Ubicacion Geo ${latitude.toFixed(5)}N, ${Math.abs(longitude).toFixed(5)}W`;

  return {
    codigoInternoSituado,
    tipoContenedor,
    modelo,
    descripcionModelo,
    cantidad,
    lote,
    distrito,
    barrio: barrioFinal,
    direccion: {
      tipoVia: tipoVia || DEFAULT_VALUES.UNSPECIFIED,
      nombre: nombreViaFinal,
      numero: numero || 'S/N'
    },
    coordenadas: {
      x: coordX,
      y: coordY
    },
    location: {
      type: 'Point',
      coordinates: [longitude, latitude]
    }
  };
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
    try {
      const insertResult = await Container.insertMany(batch, {
        ordered: false,
        lean: true
      });
      result.inserted = insertResult.length;
    } catch (error) {
      if (error.code === 11000) {
        // Duplicados parciales
        const insertedCount = error.insertedDocs?.length ||
          (batch.length - (error.writeErrors?.length || 0));
        result.inserted = Math.max(0, insertedCount);
        result.skipped = batch.length - result.inserted;

        // Loguear cada duplicado individual
        if (error.writeErrors) {
          error.writeErrors.forEach(writeErr => {
            if (writeErr.code === 11000) {
              const duplicateDoc = batch[writeErr.index];
              importLogger.warn(
                {
                  razon: REJECTION_REASONS.DUPLICATE_KEY,
                  codigo: duplicateDoc?.codigoInternoSituado,
                  tipo: duplicateDoc?.tipoContenedor,
                  detalle: 'Clave unica ya existe en BD'
                },
                'Registro rechazado - duplicado'
              );
            }
          });
        }
      } else {
        const handledError = handleMongoError(error);
        importLogger.error({ error: handledError.message }, 'Error en insercion de lote');
        result.errors = batch.length;
        throw error;
      }
    }
  } else {
    // Modo upsert
    const operations = batch.map(record => ({
      updateOne: {
        filter: {
          codigoInternoSituado: record.codigoInternoSituado,
          tipoContenedor: record.tipoContenedor
        },
        update: { $set: record },
        upsert: true
      }
    }));

    try {
      const bulkResult = await Container.bulkWrite(operations, { ordered: false });
      result.inserted = (bulkResult.upsertedCount || 0) + (bulkResult.modifiedCount || 0);
      result.skipped = (bulkResult.matchedCount || 0) - (bulkResult.modifiedCount || 0);
    } catch (error) {
      const handledError = handleMongoError(error);
      importLogger.error({ error: handledError.message }, 'Error en bulkWrite');
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
  importLogger.info(
    { file: IMPORT_CONFIG.dataFile },
    'Iniciando procesamiento de archivo CSV de contenedores'
  );

  return new Promise((resolve, reject) => {
    const records = [];
    const stream = fs.createReadStream(IMPORT_CONFIG.dataFile, { encoding: 'utf8' })
      .pipe(csv({ separator: IMPORT_CONFIG.csvSeparator }));

    stream.on('data', (row) => {
      if (isShuttingDown) {
        stream.destroy();
        return;
      }

      stats.totalProcessed++;

      try {
        const transformedData = validateAndTransformRow(row, stats.totalProcessed);

        // Verificar duplicados en memoria
        const uniqueKey = generateUniqueKey(transformedData);

        if (processedKeys.has(uniqueKey)) {
          stats.duplicatesInFile++;
          importLogger.debug(
            {
              fila: stats.totalProcessed,
              razon: REJECTION_REASONS.DUPLICATE_IN_FILE,
              codigo: transformedData.codigoInternoSituado,
              tipo: transformedData.tipoContenedor
            },
            'Fila rechazada - duplicado en archivo CSV'
          );
        } else {
          processedKeys.add(uniqueKey);
          records.push(transformedData);
        }

        if (stats.totalProcessed % IMPORT_CONFIG.logInterval === 0) {
          importLogger.debug({
            processed: stats.totalProcessed,
            valid: records.length,
            duplicatesInFile: stats.duplicatesInFile,
            errors: stats.totalErrors
          }, 'Progreso de lectura');
        }
      } catch (error) {
        stats.totalErrors++;
        if (stats.errors.length < 100) {
          stats.errors.push({ row: stats.totalProcessed, error: error.message });
        }
        importLogger.warn(
          {
            fila: stats.totalProcessed,
            razon: error.message,
            datosOriginales: {
              codigo: row['Código Interno del Situad'] || row['C�digo Interno del Situad'],
              tipo: row['Tipo Contenedor'],
              distrito: row.Distrito,
              lote: row.Lote
            }
          },
          'Fila rechazada - no insertada en BD'
        );
      }
    });

    stream.on('end', async () => {
      importLogger.info({
        totalProcessed: stats.totalProcessed,
        validRecords: records.length,
        duplicatesInFile: stats.duplicatesInFile,
        errors: stats.totalErrors
      }, 'Lectura de CSV completada');

      if (records.length === 0) {
        importLogger.warn('No hay registros validos para insertar');
        return resolve();
      }

      // Verificar duplicados en base de datos si skipExisting
      let recordsToInsert = records;

      if (options.skipExisting) {
        importLogger.info('Verificando duplicados en base de datos...');

        const codigos = [...new Set(records.map(r => r.codigoInternoSituado))];
        const existingContainers = await Container.find({
          codigoInternoSituado: { $in: codigos }
        })
          .select('codigoInternoSituado tipoContenedor coordenadas')
          .lean()
          .maxTimeMS(30000);

        const existingKeys = new Set(
          existingContainers.map(c =>
            `${c.codigoInternoSituado}_${c.tipoContenedor}_${c.coordenadas.x}_${c.coordenadas.y}`
          )
        );

        recordsToInsert = records.filter(record => {
          const key = generateUniqueKey(record);
          const isDuplicate = existingKeys.has(key);
          if (isDuplicate) {
            stats.totalSkipped++;
            importLogger.debug(
              {
                razon: REJECTION_REASONS.DUPLICATE_IN_DB,
                codigo: record.codigoInternoSituado,
                tipo: record.tipoContenedor
              },
              'Registro omitido - duplicado en BD'
            );
          }
          return !isDuplicate;
        });

        importLogger.info(
          { newRecords: recordsToInsert.length, duplicatesInDB: stats.totalSkipped },
          'Verificacion de duplicados completada'
        );
      }

      if (recordsToInsert.length === 0) {
        importLogger.info('Todos los registros ya existen en la base de datos');
        return resolve();
      }

      // Insertar en lotes
      importLogger.info(
        { totalRecords: recordsToInsert.length, batchSize: options.batchSize },
        'Iniciando insercion en base de datos'
      );

      try {
        for (let i = 0; i < recordsToInsert.length && !isShuttingDown; i += options.batchSize) {
          const batch = recordsToInsert.slice(i, i + options.batchSize);
          const result = await processBatch(batch, options);

          stats.totalInserted += result.inserted;
          stats.totalSkipped += result.skipped;

          const progress = Math.round(((i + batch.length) / recordsToInsert.length) * 100);
          importLogger.debug(
            { inserted: stats.totalInserted, progress: `${progress}%` },
            'Progreso de insercion'
          );
        }

        resolve();
      } catch (error) {
        importLogger.error({ error: error.message }, 'Error durante insercion');
        resolve(); // Continuar para mostrar estadisticas
      }
    });

    stream.on('error', (error) => {
      importLogger.error({ error: error.message }, 'Error leyendo archivo CSV');
      reject(error);
    });
  });
}

/**
 * Mostrar estadisticas finales
 * @returns {Promise<void>}
 */
async function showStatistics() {
  const durationMs = Date.now() - stats.startTime;

  // Estadisticas de la base de datos
  const totalInDB = await Container.countDocuments().maxTimeMS(10000);

  // Estadisticas por tipo usando agregacion
  const [byType, byDistrict] = await Promise.all([
    Container.aggregate([
      {
        $group: {
          _id: '$tipoContenedor',
          total: { $sum: '$cantidad' },
          ubicaciones: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } },
      { $limit: 10 }
    ]).maxTimeMS(10000),

    Container.aggregate([
      {
        $group: {
          _id: '$distrito',
          total: { $sum: '$cantidad' }
        }
      },
      { $sort: { total: -1 } },
      { $limit: 5 }
    ]).maxTimeMS(10000)
  ]);

  importLogger.info({
    duracion: formatDuration(durationMs),
    velocidad: calculateProcessingSpeed(stats.totalProcessed, durationMs),
    filasProcesadas: stats.totalProcessed,
    registrosInsertados: stats.totalInserted,
    registrosOmitidos: stats.totalSkipped,
    duplicadosEnArchivo: stats.duplicatesInFile,
    errores: stats.totalErrors,
    totalEnBD: totalInDB,
    distribucionPorTipo: byType.map(t => ({
      tipo: t._id,
      total: t.total,
      ubicaciones: t.ubicaciones
    })),
    topDistritos: byDistrict.map(d => ({
      distrito: d._id,
      total: d.total
    }))
  }, 'Importacion de contenedores completada');

  // Resumen de rechazos por tipo
  const rejectionSummary = rejectionTracker.getSortedSummary();
  if (rejectionSummary.length > 0) {
    importLogger.info({
      totalRechazos: rejectionTracker.totalRejected,
      desglose: rejectionSummary
    }, 'Resumen de rechazos por tipo');
  }
}

/**
 * Funcion principal
 */
async function main() {
  stats.startTime = Date.now();

  // Registrar manejadores de senales
  registerSignalHandlers();

  // Parsear argumentos
  const options = parseArguments();

  importLogger.info({
    skipExisting: options.skipExisting,
    batchSize: options.batchSize,
    dataFile: IMPORT_CONFIG.dataFile
  }, 'Iniciando importacion de contenedores');

  try {
    // Verificar que el archivo existe
    if (!fs.existsSync(IMPORT_CONFIG.dataFile)) {
      throw new Error(`Archivo no encontrado: ${IMPORT_CONFIG.dataFile}`);
    }

    // Conectar a la base de datos
    importLogger.info('Conectando a MongoDB...');
    await connectDB();
    importLogger.info('Conexion a MongoDB establecida');

    // Verificar estado inicial
    const initialCount = await Container.countDocuments().maxTimeMS(10000);
    importLogger.info({ registrosActuales: initialCount }, 'Estado inicial de la coleccion');

    // Procesar CSV
    await processCSV(options);

    // Mostrar estadisticas finales
    await showStatistics();

  } catch (error) {
    const handledError = handleMongoError(error);
    importLogger.error({
      error: handledError.message,
      stack: error.stack
    }, 'Error fatal durante la importacion');
    process.exitCode = 1;
  } finally {
    // Cerrar conexion
    if (mongoose.connection.readyState === 1) {
      importLogger.info('Cerrando conexion a MongoDB...');
      try {
        await mongoose.connection.close();
        importLogger.info('Conexion cerrada correctamente');
      } catch (error) {
        importLogger.error({ error: error.message }, 'Error al cerrar conexion');
      }
    }
  }
}

// Ejecutar si es llamado directamente
if (require.main === module) {
  main().catch(error => {
    importLogger.error({ error: error.message }, 'Error fatal en script de importacion');
    process.exit(1);
  });
}

module.exports = {
  cleanString,
  parseNumber,
  normalizeContainerType,
  validateAndTransformRow,
  REJECTION_REASONS
};
