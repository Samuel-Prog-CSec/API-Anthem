/**
 * Script de Importación de Datos de Tráfico
 *
 * Procesa y carga TODOS los datos de tráfico desde archivos CSV a la base de datos MongoDB.
 * Ejecutar: node scripts/importation/importTrafficData.js
 */

const fs = require('fs').promises;
const path = require('path');
const csv = require('csv-parser');
const { createReadStream } = require('fs');
const mongoose = require('mongoose');

// Importar modelos, configuración y utilidades
const Traffic = require('../../src/models/Traffic');
const { connectDB } = require('../../src/config/database');
const { logger } = require('../../src/config/logger');
const { handleMongoError } = require('../../src/utils/errorUtils');
const { TRAFFIC_ERROR_CODES, TRAFFIC_ELEMENT_TYPES } = require('../../src/constants');
const {
  RejectionTracker,
  formatDuration,
  calculateProcessingSpeed
} = require('./helpers/importHelpers');

// Logger específico para importación
const importLogger = logger.child({ component: 'import-traffic' });

// ============================================================================
// CONFIGURACIÓN
// ============================================================================

const BATCH_SIZE = 5000;
const DATA_DIR = path.join(__dirname, '../../datos_hpe/Trafico');
const LOCATIONS_FILE = path.join(__dirname, '../../datos_hpe/Ubicaciones/Anthem_CTC_PuntoMedidaTrafico.csv');
const MAX_PARALLEL = 3;
const LOG_INTERVAL = 100000;

// ============================================================================
// RAZONES DE RECHAZO
// ============================================================================

/**
 * Razones de rechazo para filas que no se insertan en la BD
 * @constant {Object}
 */
const REJECTION_REASONS = {
  // Campos obligatorios
  ID_PUNTO_FALTANTE: 'ID de punto de medida faltante o vacio',
  ID_PUNTO_FORMATO_INVALIDO: 'Formato de ID de punto invalido (debe ser numerico)',
  FECHA_FALTANTE: 'Fecha faltante o vacia',
  FECHA_FORMATO_INVALIDO: 'Formato de fecha invalido',
  FECHA_FUERA_RANGO: 'Fecha fuera de rango valido',

  // Tipo de elemento
  TIPO_ELEMENTO_INVALIDO: 'Tipo de elemento invalido (esperado: URB o M-30)',

  // Errores de procesamiento
  ERROR_TRANSFORMACION: 'Error durante la transformacion de datos',
  ERROR_VALIDACION_MONGOOSE: 'Error de validacion de esquema Mongoose',
  ERROR_INSERCION_BD: 'Error al insertar en base de datos',
  ERROR_LOTE: 'Error procesando lote de registros'
};

// ============================================================================
// CONTADORES GLOBALES
// ============================================================================

let totalProcessed = 0;
let totalInserted = 0;
let totalUpdated = 0;
let totalRejected = 0;
let totalErrors = 0;
let isShuttingDown = false;
let currentFile = '';

// Tracker de rechazos por tipo
const rejectionTracker = new RejectionTracker();

// ============================================================================
// CONEXIÓN Y CARGA DE DATOS AUXILIARES
// ============================================================================

/**
 * Cargar puntos de medida desde el archivo de ubicaciones
 * @returns {Promise<Map>} - Mapa de puntos de medida
 */
async function loadTrafficPoints() {
  importLogger.info({ archivo: LOCATIONS_FILE }, 'Cargando puntos de medida de trafico');

  return new Promise((resolve, reject) => {
    const points = new Map();
    let count = 0;

    createReadStream(LOCATIONS_FILE)
      .pipe(csv({ separator: ';' }))
      .on('data', (row) => {
        try {
          const puntoId = row.id?.toString().trim();

          if (puntoId && /^\d+$/.test(puntoId)) {
            points.set(puntoId, {
              id: puntoId,
              nombre: row.nombre?.trim(),
              distrito: row.distrito?.trim(),
              tipo_elem: row.tipo_elem?.trim(),
              utm_x: parseFloat(row.utm_x),
              utm_y: parseFloat(row.utm_y),
              longitud: parseFloat(row.longitud),
              latitud: parseFloat(row.latitud)
            });
            count++;
          }
        } catch (error) {
          importLogger.warn({
            error: error.message,
            punto: row.id
          }, 'Error procesando punto de medida');
        }
      })
      .on('end', () => {
        importLogger.info({ puntosCardos: count }, 'Puntos de medida de trafico cargados');
        resolve(points);
      })
      .on('error', (error) => {
        importLogger.error({ error: error.message }, 'Error leyendo archivo de puntos');
        reject(error);
      });
  });
}

// ============================================================================
// VALIDACIÓN Y TRANSFORMACIÓN
// ============================================================================

/**
 * Validar y transformar una fila de datos de tráfico
 * @param {Object} row - Fila del CSV
 * @param {number} rowIndex - Índice de fila
 * @returns {Object} - Datos transformados
 * @throws {Error} - Si los datos son inválidos
 */
function validateAndTransformRow(row, rowIndex) {
  // Extraer datos básicos
  const puntoMedidaId = row.id?.toString().trim();

  // Validar ID de punto
  if (!puntoMedidaId) {
    rejectionTracker.track(REJECTION_REASONS.ID_PUNTO_FALTANTE);
    importLogger.warn({
      fila: rowIndex,
      razon: REJECTION_REASONS.ID_PUNTO_FALTANTE,
      datosOriginales: { id: row.id }
    }, 'Fila rechazada: ID de punto faltante');
    throw new Error(REJECTION_REASONS.ID_PUNTO_FALTANTE);
  }

  if (!/^\d+$/.test(puntoMedidaId)) {
    rejectionTracker.track(REJECTION_REASONS.ID_PUNTO_FORMATO_INVALIDO);
    importLogger.warn({
      fila: rowIndex,
      razon: REJECTION_REASONS.ID_PUNTO_FORMATO_INVALIDO,
      datosOriginales: { id: row.id }
    }, 'Fila rechazada: formato de ID invalido');
    throw new Error(REJECTION_REASONS.ID_PUNTO_FORMATO_INVALIDO);
  }

  // Validar fecha
  const fechaStr = row.fecha?.trim();
  if (!fechaStr) {
    rejectionTracker.track(REJECTION_REASONS.FECHA_FALTANTE);
    importLogger.warn({
      fila: rowIndex,
      razon: REJECTION_REASONS.FECHA_FALTANTE,
      datosOriginales: { fecha: row.fecha }
    }, 'Fila rechazada: fecha faltante');
    throw new Error(REJECTION_REASONS.FECHA_FALTANTE);
  }

  const fecha = new Date(fechaStr);
  if (isNaN(fecha.getTime())) {
    rejectionTracker.track(REJECTION_REASONS.FECHA_FORMATO_INVALIDO);
    importLogger.warn({
      fila: rowIndex,
      razon: REJECTION_REASONS.FECHA_FORMATO_INVALIDO,
      datosOriginales: { fecha: fechaStr }
    }, 'Fila rechazada: fecha invalida');
    throw new Error(REJECTION_REASONS.FECHA_FORMATO_INVALIDO);
  }

  // Extraer componentes de fecha
  const año = fecha.getFullYear();
  const mes = fecha.getMonth() + 1;
  const dia = fecha.getDate();
  const hora = fecha.getHours();
  const minutos = fecha.getMinutes();

  // Normalizar tipo de elemento usando constantes
  const tipoElementoRaw = row.tipo_elem?.trim().toUpperCase();
  const tipoElemento = tipoElementoRaw;

  // Validar tipo de elemento usando constantes
  const tiposValidos = Object.values(TRAFFIC_ELEMENT_TYPES);
  if (!tiposValidos.includes(tipoElemento)) {
    rejectionTracker.track(REJECTION_REASONS.TIPO_ELEMENTO_INVALIDO);
    importLogger.warn({
      fila: rowIndex,
      razon: REJECTION_REASONS.TIPO_ELEMENTO_INVALIDO,
      datosOriginales: { tipoElemento: tipoElementoRaw, esperados: tiposValidos }
    }, 'Fila rechazada: tipo de elemento invalido');
    throw new Error(REJECTION_REASONS.TIPO_ELEMENTO_INVALIDO);
  }

  // Parsear métricas (valores negativos indican ausencia de datos)
  const intensidad = parseInt(row.intensidad) || -1;
  const ocupacion = parseInt(row.ocupacion) || -1;
  const carga = parseInt(row.carga) || -1;
  const velocidadMedia = row.vmed ? parseInt(row.vmed) : (tipoElemento === TRAFFIC_ELEMENT_TYPES.M30 ? -1 : null);

  // Datos de calidad
  const errorCode = (row.error || 'N').trim().toUpperCase();
  const error = [TRAFFIC_ERROR_CODES.NO_ERROR, TRAFFIC_ERROR_CODES.ERROR, TRAFFIC_ERROR_CODES.SIN_DATOS].includes(errorCode)
    ? errorCode
    : TRAFFIC_ERROR_CODES.NO_ERROR;
  const periodoIntegracion = parseInt(row.periodo_integracion) || 0;

  // Construir objeto de datos
  return {
    puntoMedidaId,
    fecha,
    año,
    mes,
    dia,
    hora,
    minutos,
    tipoElemento,
    metricas: {
      intensidad,
      ocupacion,
      carga,
      velocidadMedia
    },
    calidadDatos: {
      error,
      periodoIntegracion
    },
    procesamiento: {
      archivoOrigen: currentFile,
      importadoEn: new Date()
    }
  };
}// ============================================================================
// PROCESAMIENTO DE LOTES Y ARCHIVOS
// ============================================================================

/**
 * Procesar un lote de datos de tráfico
 * @param {Array} batch - Lote de registros
 * @returns {Promise<Object>} - Resultados del procesamiento
 */
async function processBatch(batch) {
  if (batch.length === 0) {
    return { nuevos: 0, actualizados: 0, errores: 0 };
  }

  try {
    const bulkOperations = batch.map(record => ({
      updateOne: {
        filter: {
          puntoMedidaId: record.puntoMedidaId,
          fecha: record.fecha
        },
        update: { $set: record },
        upsert: true
      }
    }));

    const result = await Traffic.bulkWrite(bulkOperations, { ordered: false });

    const nuevos = result.upsertedCount || 0;
    const actualizados = result.modifiedCount || 0;

    totalInserted += nuevos;
    totalUpdated += actualizados;

    return { nuevos, actualizados, errores: 0 };

  } catch (error) {
    const mongoError = handleMongoError(error);
    importLogger.error({
      error: mongoError.message,
      tipo: mongoError.type,
      loteSize: batch.length
    }, 'Error procesando lote de trafico');

    totalErrors += batch.length;
    return { nuevos: 0, actualizados: 0, errores: batch.length };
  }
}

/**
 * Procesar un archivo CSV de tráfico
 * @param {string} filePath - Ruta al archivo
 * @returns {Promise<Object>} - Estadísticas del archivo
 */
async function processTrafficFile(filePath) {
  return new Promise((resolve, reject) => {
    const batch = [];
    let rowCount = 0;
    let processedCount = 0;
    let errorCount = 0;

    currentFile = path.basename(filePath);
    importLogger.info({ archivo: currentFile }, 'Procesando archivo de trafico');

    const stream = createReadStream(filePath)
      .pipe(csv({ separator: ';' }))
      .on('data', (row) => {
        if (isShuttingDown) {
          stream.destroy();
          return;
        }

        rowCount++;
        totalProcessed++;

        // Mostrar progreso
        if (rowCount % LOG_INTERVAL === 0) {
          importLogger.info({
            archivo: currentFile,
            procesadas: rowCount.toLocaleString(),
            insertadas: totalInserted,
            errores: errorCount
          }, 'Progreso de importacion');
        }

        try {
          const trafficData = validateAndTransformRow(row, rowCount);
          batch.push(trafficData);
          processedCount++;

          // Procesar lote cuando alcance el tamaño configurado
          if (batch.length >= BATCH_SIZE) {
            stream.pause();
            const currentBatch = [...batch];
            batch.length = 0;

            processBatch(currentBatch)
              .then(() => {
                if (!isShuttingDown) {
                  stream.resume();
                }
              })
              .catch((error) => {
                importLogger.error({ error: error.message }, 'Error en lote');
                if (!isShuttingDown) {
                  stream.resume();
                }
              });
          }

        } catch (_error) {
          errorCount++;
          totalRejected++;
          // El error ya fue loggeado en validateAndTransformRow
        }
      })
      .on('end', async () => {
        try {
          // Procesar lote final
          if (batch.length > 0 && !isShuttingDown) {
            await processBatch(batch);
          }

          importLogger.info({
            archivo: currentFile,
            totalFilas: rowCount.toLocaleString(),
            procesadas: processedCount.toLocaleString(),
            errores: errorCount
          }, 'Archivo de trafico completado');

          resolve({
            file: currentFile,
            totalRows: rowCount,
            processed: processedCount,
            errors: errorCount
          });

        } catch (error) {
          reject(error);
        }
      })
      .on('error', (error) => {
        importLogger.error({ error: error.message, archivo: currentFile }, 'Error leyendo archivo CSV');
        reject(new Error(`Error leyendo archivo ${currentFile}: ${error.message}`));
      });
  });
}

/**
 * Obtener lista de archivos a procesar
 * @returns {Promise<Array>} - Lista de archivos CSV
 */
async function getFilesToProcess() {
  importLogger.info({ directorio: DATA_DIR }, 'Buscando archivos de trafico');

  const files = await fs.readdir(DATA_DIR);
  const csvFiles = files.filter(file =>
    file.endsWith('.csv') &&
    file.includes('Traffic') &&
    !file.includes('sample')
  );

  importLogger.info({
    archivosEncontrados: csvFiles.length,
    archivos: csvFiles
  }, 'Archivos de trafico encontrados');

  return csvFiles.sort();
}

// ============================================================================
// FUNCIÓN PRINCIPAL
// ============================================================================

/**
 * Función principal
 */
async function main() {
  const startTime = Date.now();

  importLogger.info({
    batchSize: BATCH_SIZE,
    directorioDatos: DATA_DIR,
    procesamientoParalelo: MAX_PARALLEL
  }, 'Iniciando importacion de datos de trafico');

  try {
    // Conectar a base de datos
    importLogger.info('Conectando a MongoDB...');
    await connectDB();
    importLogger.info('Conexion a MongoDB establecida');

    // Cargar puntos de medida (para referencia/validación futura)
    await loadTrafficPoints();

    // Obtener archivos a procesar
    const filesToProcess = await getFilesToProcess();

    if (filesToProcess.length === 0) {
      importLogger.warn('No hay archivos para procesar');
      return;
    }

    // Contar registros antes
    const countAntes = await Traffic.countDocuments().maxTimeMS(10000);
    importLogger.info({ registrosExistentes: countAntes.toLocaleString() }, 'Registros actuales de trafico');

    // Procesar archivos en paralelo
    const fileResults = [];

    for (let i = 0; i < filesToProcess.length; i += MAX_PARALLEL) {
      if (isShuttingDown) {
        importLogger.warn('Importacion interrumpida por senal de terminacion');
        break;
      }

      const batch = filesToProcess.slice(i, i + MAX_PARALLEL);

      importLogger.info({
        lote: Math.floor(i / MAX_PARALLEL) + 1,
        totalLotes: Math.ceil(filesToProcess.length / MAX_PARALLEL),
        archivos: batch
      }, 'Procesando lote paralelo de archivos');

      const promises = batch.map(async (fileName) => {
        const filePath = path.join(DATA_DIR, fileName);

        try {
          return await processTrafficFile(filePath);
        } catch (error) {
          importLogger.error({
            archivo: fileName,
            error: error.message
          }, 'Error procesando archivo');

          return {
            file: fileName,
            totalRows: 0,
            processed: 0,
            errors: 1,
            error: error.message
          };
        }
      });

      const batchResults = await Promise.all(promises);
      fileResults.push(...batchResults);

      importLogger.info({
        loteCompletado: Math.floor(i / MAX_PARALLEL) + 1,
        progreso: `${Math.min(i + MAX_PARALLEL, filesToProcess.length)}/${filesToProcess.length}`
      }, 'Lote paralelo completado');
    }

    // Mostrar resumen final
    const endTime = Date.now();

    const countDespues = await Traffic.countDocuments().maxTimeMS(10000);

    importLogger.info({
      resumen: {
        duracion: formatDuration(endTime - startTime),
        velocidad: calculateProcessingSpeed(totalProcessed, endTime - startTime),
        archivosProcesados: fileResults.length,
        registrosProcesados: totalProcessed.toLocaleString(),
        registrosInsertados: totalInserted.toLocaleString(),
        registrosActualizados: totalUpdated.toLocaleString(),
        registrosRechazados: totalRejected.toLocaleString(),
        errores: totalErrors.toLocaleString(),
        tasaExito: totalProcessed > 0 ?
          `${((totalInserted + totalUpdated) / totalProcessed * 100).toFixed(2)}%` : '0%',
        registrosFinales: countDespues.toLocaleString(),
        incremento: (countDespues - countAntes).toLocaleString()
      }
    }, 'Importacion de trafico completada');

    // Resumen de rechazos por tipo
    const rejectionSummary = rejectionTracker.getSortedSummary();
    if (rejectionSummary.length > 0) {
      importLogger.info({
        totalRechazos: rejectionTracker.totalRejected,
        desglose: rejectionSummary
      }, 'Resumen de rechazos por tipo');
    }

  } catch (error) {
    importLogger.error({
      error: error.message,
      stack: error.stack
    }, 'Error critico durante la importacion');
    process.exit(1);

  } finally {
    if (mongoose.connection.readyState === 1) {
      try {
        await mongoose.connection.close();
        importLogger.info('Conexion a MongoDB cerrada');
      } catch (error) {
        importLogger.error({ error: error.message }, 'Error cerrando conexion');
      }
    }
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

  importLogger.warn({ signal }, 'Senal de terminacion recibida, cerrando...');

  if (mongoose.connection.readyState === 1) {
    try {
      await mongoose.connection.close();
      importLogger.info('Conexion cerrada por senal de terminacion');
    } catch (error) {
      importLogger.error({ error: error.message }, 'Error cerrando conexion');
    }
  }

  process.exit(0);
}

process.on('SIGINT', () => handleShutdown('SIGINT'));
process.on('SIGTERM', () => handleShutdown('SIGTERM'));

process.on('uncaughtException', (error) => {
  importLogger.fatal({ error: error.message, stack: error.stack }, 'Error no capturado');
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  importLogger.fatal({ reason, promise }, 'Promesa rechazada no manejada');
  process.exit(1);
});

// ============================================================================
// EJECUCIÓN
// ============================================================================

if (require.main === module) {
  main().catch(error => {
    importLogger.fatal({ error: error.message }, 'Error fatal ejecutando script');
    process.exit(1);
  });
}

module.exports = {
  main,
  processTrafficFile,
  validateAndTransformRow,
  REJECTION_REASONS
};
