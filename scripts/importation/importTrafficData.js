/**
 * Script de Importación de Datos de Tráfico
 *
 * Procesa y carga TODOS los datos de tráfico desde archivos CSV a la base de datos MongoDB.
 * Ejecutar: node scripts/importation/importTrafficData.js
 */

// Configurar modo script para evitar reconexiones infinitas
process.env.SCRIPT_MODE = 'true';

const fs = require('fs').promises;
const path = require('path');
const csv = require('csv-parser');
const { createReadStream } = require('fs');
const mongoose = require('mongoose');

// Importar modelos, configuración y utilidades
const Traffic = require('../../src/models/Trafico');
const { connectDB } = require('../../src/config/database');
const config = require('../../src/config/config');
const { importTrafficLogger: logger } = require('../../src/config/scriptLogger');
const { handleMongoError } = require('../../src/utils/errorUtils');
const {
  TRAFFIC_ERROR_CODES, TRAFFIC_ELEMENT_TYPES,
  DATA_QUALITY_LEVELS, CONGESTION_LEVELS, TRAFFIC_INTENSITY_LEVELS,
  DAY_PERIODS, WORKDAY_TYPES
} = require('../../src/constants');
const {
  RejectionTracker,
  formatDuration,
  calculateProcessingSpeed
} = require('./helpers/importHelpers');

// ============================================================================
// CONFIGURACIÓN
// ============================================================================

const BATCH_SIZE = 10000;
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
  logger.info({ archivo: LOCATIONS_FILE }, 'Cargando puntos de medida de trafico');

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
          logger.warn({
            error: error.message,
            punto: row.id
          }, 'Error procesando punto de medida');
        }
      })
      .on('end', () => {
        logger.info({ puntosCardos: count }, 'Puntos de medida de trafico cargados');
        resolve(points);
      })
      .on('error', (error) => {
        logger.error({ error: error.message }, 'Error leyendo archivo de puntos');
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
    logger.warn({
      fila: rowIndex,
      razon: REJECTION_REASONS.ID_PUNTO_FALTANTE,
      datosOriginales: { id: row.id }
    }, 'Fila rechazada: ID de punto faltante');
    throw new Error(REJECTION_REASONS.ID_PUNTO_FALTANTE);
  }

  if (!/^\d+$/.test(puntoMedidaId)) {
    rejectionTracker.track(REJECTION_REASONS.ID_PUNTO_FORMATO_INVALIDO);
    logger.warn({
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
    logger.warn({
      fila: rowIndex,
      razon: REJECTION_REASONS.FECHA_FALTANTE,
      datosOriginales: { fecha: row.fecha }
    }, 'Fila rechazada: fecha faltante');
    throw new Error(REJECTION_REASONS.FECHA_FALTANTE);
  }

  const fecha = new Date(fechaStr);
  if (isNaN(fecha.getTime())) {
    rejectionTracker.track(REJECTION_REASONS.FECHA_FORMATO_INVALIDO);
    logger.warn({
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
    logger.warn({
      fila: rowIndex,
      razon: REJECTION_REASONS.TIPO_ELEMENTO_INVALIDO,
      datosOriginales: { tipoElemento: tipoElementoRaw, esperados: tiposValidos }
    }, 'Fila rechazada: tipo de elemento invalido');
    throw new Error(REJECTION_REASONS.TIPO_ELEMENTO_INVALIDO);
  }

  // Parsear métricas (valores negativos indican ausencia de datos)
  // Usar isNaN en lugar de || para preservar valores validos de 0
  const rawIntensidad = parseInt(row.intensidad);
  const intensidad = isNaN(rawIntensidad) ? -1 : rawIntensidad;
  const rawOcupacion = parseInt(row.ocupacion);
  const ocupacion = isNaN(rawOcupacion) ? -1 : rawOcupacion;
  const rawCarga = parseInt(row.carga);
  const carga = isNaN(rawCarga) ? -1 : rawCarga;
  const velocidadMedia = row.vmed ? parseInt(row.vmed) : (tipoElemento === TRAFFIC_ELEMENT_TYPES.M30 ? -1 : null);

  // Datos de calidad
  const errorCode = (row.error || 'N').trim().toUpperCase();
  const error = [TRAFFIC_ERROR_CODES.NO_ERROR, TRAFFIC_ERROR_CODES.ERROR, TRAFFIC_ERROR_CODES.SIN_DATOS].includes(errorCode)
    ? errorCode
    : TRAFFIC_ERROR_CODES.NO_ERROR;
  const periodoIntegracion = parseInt(row.periodo_integracion) || 0;

  // Calcular campos de analisis derivados
  // Calidad general basada en error code y periodo de integracion
  let calidadGeneral;
  if (error === TRAFFIC_ERROR_CODES.NO_ERROR && periodoIntegracion >= 3) {
    calidadGeneral = DATA_QUALITY_LEVELS.ALTA;
  } else if (error === TRAFFIC_ERROR_CODES.NO_ERROR) {
    calidadGeneral = DATA_QUALITY_LEVELS.MEDIA;
  } else if (error === TRAFFIC_ERROR_CODES.SIN_DATOS) {
    calidadGeneral = DATA_QUALITY_LEVELS.SIN_DATOS;
  } else {
    calidadGeneral = DATA_QUALITY_LEVELS.BAJA;
  }

  // Nivel de congestion basado en ocupacion
  let nivelCongestion;
  if (ocupacion < 0 || carga < 0) {
    nivelCongestion = CONGESTION_LEVELS.SIN_DATOS;
  } else if (ocupacion >= 80 || carga >= 90) {
    nivelCongestion = CONGESTION_LEVELS.COLAPSADO;
  } else if (ocupacion >= 60 || carga >= 70) {
    nivelCongestion = CONGESTION_LEVELS.CONGESTIONADO;
  } else if (ocupacion >= 30 || carga >= 40) {
    nivelCongestion = CONGESTION_LEVELS.DENSO;
  } else {
    nivelCongestion = CONGESTION_LEVELS.FLUIDO;
  }

  // Clasificacion por intensidad
  let clasificacionIntensidad;
  if (intensidad < 0) {
    clasificacionIntensidad = TRAFFIC_INTENSITY_LEVELS.SIN_DATOS;
  } else if (intensidad >= 3000) {
    clasificacionIntensidad = TRAFFIC_INTENSITY_LEVELS.MUY_ALTA;
  } else if (intensidad >= 2000) {
    clasificacionIntensidad = TRAFFIC_INTENSITY_LEVELS.ALTA;
  } else if (intensidad >= 1000) {
    clasificacionIntensidad = TRAFFIC_INTENSITY_LEVELS.MEDIA;
  } else if (intensidad >= 300) {
    clasificacionIntensidad = TRAFFIC_INTENSITY_LEVELS.BAJA;
  } else {
    clasificacionIntensidad = TRAFFIC_INTENSITY_LEVELS.MUY_BAJA;
  }

  // Periodo del dia basado en hora
  let periodoDia;
  if (hora >= 0 && hora < 7) {
    periodoDia = DAY_PERIODS.MADRUGADA;
  } else if (hora >= 7 && hora < 12) {
    periodoDia = DAY_PERIODS.MAÑANA;
  } else if (hora >= 12 && hora < 15) {
    periodoDia = DAY_PERIODS.MEDIODIA;
  } else if (hora >= 15 && hora < 21) {
    periodoDia = DAY_PERIODS.TARDE;
  } else {
    periodoDia = DAY_PERIODS.NOCHE;
  }

  // Tipo de jornada basado en dia de la semana
  const dayOfWeek = fecha.getDay(); // 0=domingo, 6=sabado
  let tipoJornada;
  if (dayOfWeek === 0) {
    tipoJornada = WORKDAY_TYPES.DOMINGO_FESTIVO;
  } else if (dayOfWeek === 6) {
    tipoJornada = WORKDAY_TYPES.SABADO;
  } else {
    tipoJornada = WORKDAY_TYPES.LABORABLE;
  }

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
      periodoIntegracion,
      calidadGeneral
    },
    analisis: {
      nivelCongestion,
      clasificacionIntensidad,
      periodoDia,
      tipoJornada
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
    logger.error({
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
    logger.info({ archivo: currentFile }, 'Procesando archivo de trafico');

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
          logger.info({
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
                logger.error({ error: error.message }, 'Error en lote');
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

          logger.info({
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
        logger.error({ error: error.message, archivo: currentFile }, 'Error leyendo archivo CSV');
        reject(new Error(`Error leyendo archivo ${currentFile}: ${error.message}`));
      });
  });
}

/**
 * Obtener lista de archivos a procesar
 * @returns {Promise<Array>} - Lista de archivos CSV
 */
async function getFilesToProcess() {
  logger.info({ directorio: DATA_DIR }, 'Buscando archivos de trafico');

  const files = await fs.readdir(DATA_DIR);
  const csvFiles = files.filter(file =>
    file.endsWith('.csv') &&
    file.includes('Traffic') &&
    !file.includes('sample')
  );

  logger.info({
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

  logger.info({
    batchSize: BATCH_SIZE,
    directorioDatos: DATA_DIR,
    procesamientoParalelo: MAX_PARALLEL
  }, 'Iniciando importacion de datos de trafico');

  try {
    // Conectar a base de datos
    logger.info('Conectando a MongoDB...');
    await connectDB(config.database.uri);
    logger.info('Conexion a MongoDB establecida');

    // Cargar puntos de medida (para referencia/validación futura)
    await loadTrafficPoints();

    // Obtener archivos a procesar
    const filesToProcess = await getFilesToProcess();

    if (filesToProcess.length === 0) {
      logger.warn('No hay archivos para procesar');
      return;
    }

    // Contar registros antes
    const countAntes = await Traffic.countDocuments().maxTimeMS(10000);
    logger.info({ registrosExistentes: countAntes.toLocaleString() }, 'Registros actuales de trafico');

    // Procesar archivos en paralelo
    const fileResults = [];

    for (let i = 0; i < filesToProcess.length; i += MAX_PARALLEL) {
      if (isShuttingDown) {
        logger.warn('Importacion interrumpida por senal de terminacion');
        break;
      }

      const batch = filesToProcess.slice(i, i + MAX_PARALLEL);

      logger.info({
        lote: Math.floor(i / MAX_PARALLEL) + 1,
        totalLotes: Math.ceil(filesToProcess.length / MAX_PARALLEL),
        archivos: batch
      }, 'Procesando lote paralelo de archivos');

      const promises = batch.map(async (fileName) => {
        const filePath = path.join(DATA_DIR, fileName);

        try {
          return await processTrafficFile(filePath);
        } catch (error) {
          logger.error({
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

      logger.info({
        loteCompletado: Math.floor(i / MAX_PARALLEL) + 1,
        progreso: `${Math.min(i + MAX_PARALLEL, filesToProcess.length)}/${filesToProcess.length}`
      }, 'Lote paralelo completado');
    }

    // Mostrar resumen final
    const endTime = Date.now();

    const countDespues = await Traffic.countDocuments().maxTimeMS(10000);

    logger.info({
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
      logger.info({
        totalRechazos: rejectionTracker.totalRejected,
        desglose: rejectionSummary
      }, 'Resumen de rechazos por tipo');
    }

  } catch (error) {
    logger.error({
      error: error.message,
      stack: error.stack
    }, 'Error critico durante la importacion');
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
  main,
  processTrafficFile,
  validateAndTransformRow,
  REJECTION_REASONS
};
