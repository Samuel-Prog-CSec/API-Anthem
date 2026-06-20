/**
 * Script de Importacion de Contenedores
 *
 * Procesa y carga datos de contenedores de residuos desde CSV a MongoDB.
 * Optimizado para alto volumen de datos (~50k registros).
 *
 * Uso: node scripts/importation/importarContenedores.js [--force] [--batch=N]
 *
 * Opciones:
 *   --force    Sobrescribir registros existentes (upsert)
 *   --batch=N  Tamano del lote para inserciones (default: 2000)
 *
 * @module scripts/importation/importarContenedores
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
const { importarContenedoresLogger: logger } = require('../../src/config/scriptLogger');
const { handleMongoError } = require('../../src/utils/errorUtils');
const {
  CONTAINER_TYPES,
  CONTAINER_LOTES,
  DEFAULT_VALUES
} = require('../../src/constants');
const {
  RejectionTracker,
  formatDuration,
  calculateProcessingSpeed,
  buildAndWriteSummary
} = require('./helpers/importHelpers');
const { extraerCoordenadasModulo } = require('./helpers/coordenadas');
const { crearLectorCSV } = require('./helpers/normalizarEncoding');

// Modelo
const Contenedor = require('../../src/models/Contenedor');

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
 * Generar clave unica para el contenedor.
 *
 * Antes la clave usaba `coordenadas.x/y` (UTM). Como `extraerCoordenadasModulo`
 * puede devolver `utm: null` cuando el CSV solo trae WGS84 validos (caso
 * habitual en este dataset municipal), tomamos las coordenadas finales
 * GeoJSON (`location.coordinates = [lon, lat]`), que siempre estan
 * presentes tras una validacion exitosa. Asi la deduplicacion sigue
 * funcionando aunque UTM no este.
 */
function generateUniqueKey(data) {
  const coords = data.location?.coordinates;
  if (!coords) {
    // Sin coordenadas: dos contenedores distintos sin geometria podrian
    // deduplicarse erroneamente si comparten codigo y tipo. Se usa [0,0]
    // como fallback conservador pero se avisa para detectar el caso.
    logger.warn({ codigo: data.codigoInternoSituado }, 'Contenedor sin coordenadas en generateUniqueKey — usando [0,0] como clave');
  }
  const [lon, lat] = coords || [0, 0];
  return `${data.codigoInternoSituado}_${data.tipoContenedor}_${lon}_${lat}`;
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

  // Informacion geografica.
  // El CSV de contenedores trae 'CIUDAD-LINEAL' con guion (a diferencia
  // del resto del proyecto que usa 'CIUDAD LINEAL' con espacio). Tambien
  // mete NBSP (\xa0) entre palabras: 'FUENCARRAL-EL\xa0PARDO'. Normalizamos
  // a la forma canonica usada en `centroidesDistritosMadrid.js` y en el
  // censo para que los joins cross-coleccion (ej. correlaciones censo vs
  // contenedores) no pierdan distritos por mismatch textual.
  const distritoRaw = cleanString(row.Distrito);
  // Normalizar: NBSP -> espacio, y "CIUDAD-LINEAL" -> "CIUDAD LINEAL".
  const distrito = distritoRaw
    ? distritoRaw.replace(/\u00a0/g, ' ').replace(/CIUDAD-LINEAL/i, 'CIUDAD LINEAL')
    : '';
  const barrio = cleanString(row.Barrio);

  if (!distrito) {
    throw new Error(`${REJECTION_REASONS.MISSING_DISTRITO}: columna='Distrito' vacia`);
  }

  // El CSV de contenedores trae la columna Barrio vacia en 71 % de filas
  // y un codigo numerico (164, 191) en el resto. Antes el importador caia
  // a 'SIN ESPECIFICAR' como valor literal, generando un campo que parecia
  // dato cuando en realidad indicaba ausencia. Ahora preservamos `null`
  // cuando no hay info y la UI puede mostrar "—" / "No disponible". Si
  // hay codigo numerico se conserva como string (sin convertir a nombre,
  // porque no hay maestro de barrios cargado en este momento -- queda
  // como mejora futura).
  const barrioFinal = barrio || null;

  // Direccion (manejar encoding).
  // toUpperCase para no fragmentar filtros/estadisticas por tipo de via: el CSV
  // mezcla "CALLE"/"Calle", "AVENIDA"/"Avenida"... (mismo criterio que
  // tipoContenedor y distrito, que ya se normalizan a mayusculas).
  const tipoVia = (cleanString(row['Tipo Vía'] || row['Tipo V�a']) || '').toUpperCase();
  const nombreVia = cleanString(row.Nombre);
  const numero = cleanString(row['Número'] || row['N�mero']);

  // Coordenadas via framework unificado.
  // Perfil 'contenedores': UTM en cm (se normaliza a metros automaticamente)
  // + WGS84 directo. fuentePrioritaria='wgs84'. requerida=true.
  let coords;
  try {
    coords = extraerCoordenadasModulo(row, 'contenedores');
  } catch (e) {
    // Mapear los codigos del framework a las razones del tracker local
    const razon = e.code === 'COORDENADAS_FALTANTES'
      ? (row['COORDENADA X'] && row['COORDENADA Y']
          ? REJECTION_REASONS.MISSING_GEO_COORDS
          : REJECTION_REASONS.MISSING_UTM_COORDS)
      : REJECTION_REASONS.COORDS_OUT_OF_RANGE;
    throw new Error(`${razon}: X='${row['COORDENADA X']}', Y='${row['COORDENADA Y']}', LON='${row.LONGITUD}', LAT='${row.LATITUD}'`);
  }

  // Tras el framework, coords.utm.x e y estan en METROS (CSV venia en cm).
  // Generar nombre de via si falta
  const [longitude, latitude] = coords.geometry.coordinates;
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
    // {x, y} en METROS (normalizado desde cm del CSV)
    coordenadas: coords.utm,
    // GeoJSON Point [lon, lat]
    location: coords.geometry
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
      const insertResult = await Contenedor.insertMany(batch, {
        ordered: false,
        lean: true,
        bypassDocumentValidation: true
      });
      result.inserted = insertResult.length;
    } catch (error) {
      if (error.code === 11000) {
        // Duplicados parciales
        const insertedCount = error.insertedDocs?.length ||
          (batch.length - (error.writeErrors?.length || 0));
        result.inserted = Math.max(0, insertedCount);
        result.skipped = batch.length - result.inserted;

        // Loguear cada duplicado y trackearlo en el resumen.
        // Antes solo se llamaba a `logger[nivel]` pero NO a
        // `rejectionTracker.track()`, asi que los duplicados de clave
        // unica de Mongo se contaban como `skipped` sin razon visible en
        // el summary final (verificado: 2 585 docs sin trazabilidad).
        if (error.writeErrors) {
          error.writeErrors.forEach(writeErr => {
            if (writeErr.code === 11000) {
              const duplicateDoc = batch[writeErr.index];
              const sample = {
                codigo: duplicateDoc?.codigoInternoSituado,
                tipo: duplicateDoc?.tipoContenedor,
                coords: duplicateDoc?.coordenadas
              };
              rejectionTracker.track(REJECTION_REASONS.DUPLICATE_KEY, sample);
              const nivel = rejectionTracker.shouldLogWarn(REJECTION_REASONS.DUPLICATE_KEY, sample) ? 'warn' : 'debug';
              logger[nivel]({
                razon: REJECTION_REASONS.DUPLICATE_KEY,
                ...sample,
                detalle: 'Clave unica ya existe en BD'
              }, 'Registro rechazado - duplicado');
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
    // Modo upsert. El filtro debe incluir las coordenadas: un mismo
    // (codigoInternoSituado, tipoContenedor) aparece en varias ubicaciones
    // distintas (1.794 pares en el dataset), asi que filtrar solo por
    // codigo+tipo colapsaria esos contenedores en --force (perdida de datos).
    // Se usa la misma clave que generateUniqueKey: codigo + tipo + coordenadas.
    const operations = batch.map(record => ({
      updateOne: {
        filter: {
          codigoInternoSituado: record.codigoInternoSituado,
          tipoContenedor: record.tipoContenedor,
          'location.coordinates': record.location?.coordinates
        },
        update: { $set: record },
        upsert: true
      }
    }));

    try {
      const bulkResult = await Contenedor.bulkWrite(operations, {
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
async function processCSV(options) {
  logger.info(
    { file: IMPORT_CONFIG.dataFile },
    'Iniciando procesamiento de archivo CSV de contenedores'
  );

  return new Promise((resolve, reject) => {
    const batch = [];
    let isProcessingBatch = false;
    // eslint-disable-next-line prefer-const
    let stream;

    const flushBatch = async () => {
      if (batch.length === 0) {return;}
      isProcessingBatch = true;
      stream.pause();

      try {
        let workingBatch = batch.splice(0, batch.length);

        if (options.skipExisting) {
          const existingContainers = await Contenedor.find({
            codigoInternoSituado: { $in: [...new Set(workingBatch.map(r => r.codigoInternoSituado))] }
          })
            .select('codigoInternoSituado tipoContenedor coordenadas')
            .lean()
            .maxTimeMS(30000);

          const existingKeys = new Set(
            existingContainers.map(c => generateUniqueKey({
              codigoInternoSituado: c.codigoInternoSituado,
              tipoContenedor: c.tipoContenedor,
              coordenadas: c.coordenadas
            }))
          );

          workingBatch = workingBatch.filter(record => {
            const key = generateUniqueKey(record);
            const isDuplicate = existingKeys.has(key);
            if (isDuplicate) {
              stats.totalSkipped++;
              rejectionTracker.track('CLAVE_DUPLICADA_EN_BD', {
                codigo: record.codigoInternoSituado,
                tipo: record.tipoContenedor,
                coords: record.coordenadas
              });
            }
            return !isDuplicate;
          });
        }

        if (workingBatch.length > 0) {
          const result = await processBatch(workingBatch, options);
          stats.totalInserted += result.inserted;
          stats.totalSkipped += result.skipped;
        }
      } catch (error) {
        stats.totalErrors++;
        logger.error({ error: error.message }, 'Error procesando lote');
      } finally {
        isProcessingBatch = false;
        if (!isShuttingDown) {
          stream.resume();
        }
      }
    };

    stream = crearLectorCSV(IMPORT_CONFIG.dataFile)
      .pipe(csv({ separator: IMPORT_CONFIG.csvSeparator }));

    stream.on('data', async (row) => {
      if (isShuttingDown || isProcessingBatch) {
        return;
      }

      stats.totalProcessed++;

      try {
        const transformedData = validateAndTransformRow(row, stats.totalProcessed);
        const uniqueKey = generateUniqueKey(transformedData);

        if (processedKeys.has(uniqueKey)) {
          stats.duplicatesInFile++;
          rejectionTracker.track('DUPLICADO_EN_ARCHIVO', {
            fila: stats.totalProcessed,
            codigo: transformedData.codigoInternoSituado,
            tipo: transformedData.tipoContenedor,
            coords: transformedData.coordenadas
          });
          return;
        }

        processedKeys.add(uniqueKey);
        batch.push(transformedData);

        if (batch.length >= options.batchSize) {
          await flushBatch();
        }

        if (stats.totalProcessed % IMPORT_CONFIG.logInterval === 0) {
          logger.debug({
            processed: stats.totalProcessed,
            buffered: batch.length,
            duplicatesInFile: stats.duplicatesInFile,
            errors: stats.totalErrors
          }, 'Progreso de lectura');
        }
      } catch (error) {
        stats.totalErrors++;
        if (stats.errors.length < 100) {
          stats.errors.push({ row: stats.totalProcessed, error: error.message });
        }
        logger.warn(
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
      logger.info({
        totalProcessed: stats.totalProcessed,
        buffered: batch.length,
        duplicatesInFile: stats.duplicatesInFile,
        errors: stats.totalErrors
      }, 'Lectura de CSV completada');

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
  const durationMs = Date.now() - stats.startTime;

  // Estadisticas de la base de datos
  const totalInDB = await Contenedor.countDocuments().maxTimeMS(10000);

  // Estadisticas por tipo usando agregacion
  const [byType, byDistrict] = await Promise.all([
    Contenedor.aggregate([
      {
        $group: {
          _id: '$tipoContenedor',
          total: { $sum: '$cantidad' },
          ubicaciones: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } },
      { $limit: 10 }
    ], { maxTimeMS: 10000 }),

    Contenedor.aggregate([
      {
        $group: {
          _id: '$distrito',
          total: { $sum: '$cantidad' }
        }
      },
      { $sort: { total: -1 } },
      { $limit: 5 }
    ], { maxTimeMS: 10000 })
  ]);

  logger.info({
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
  stats.startTime = Date.now();

  // Registrar manejadores de senales
  registerSignalHandlers();

  // Parsear argumentos
  const options = parseArguments();

  logger.info({
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
    logger.info('Conectando a MongoDB...');
    await connectDB(config.database.uri);
    logger.info('Conexion a MongoDB establecida');

    // Verificar estado inicial
    const initialCount = await Contenedor.countDocuments().maxTimeMS(10000);
    logger.info({ registrosActuales: initialCount }, 'Estado inicial de la coleccion');

    // Procesar CSV
    await processCSV(options);

    // Mostrar estadisticas finales
    await showStatistics();

    // Aviso operativo: el cache es in-memory por proceso, asi que el script
    // no puede invalidarlo en el servidor API (procesos distintos). Si se
    // ejecuto con --force y el API estaba arriba, los endpoints de
    // contenedores serviran datos antiguos hasta reinicio. Datos estaticos
    // (TTL=infinito) hacen este reinicio obligatorio para reflejar cambios.
    if (!options.skipExisting) {
      logger.warn(
        'Importacion ejecutada con --force. Reinicia el servidor API para invalidar el cache de contenedores (TTL infinito).'
      );
    }

  } catch (error) {
    const handledError = handleMongoError(error);
    logger.error({
      error: handledError.message,
      stack: error.stack
    }, 'Error fatal durante la importacion');
    process.exitCode = 1;
  } finally {
    buildAndWriteSummary('contenedores', {
      startTime: stats.startTime,
      counts: {
        totalProcessed: stats.totalProcessed,
        inserted: stats.totalInserted,
        rejected: rejectionTracker.totalRejected,
        skipped: stats.totalSkipped,
        duplicatesInFile: stats.duplicatesInFile,
        errors: stats.totalErrors
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
  cleanString,
  parseNumber,
  normalizeContainerType,
  validateAndTransformRow,
  REJECTION_REASONS
};
