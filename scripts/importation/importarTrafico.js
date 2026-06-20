/**
 * Script de Importación de Datos de Tráfico
 *
 * Procesa y carga TODOS los datos de tráfico desde archivos CSV a la base de datos MongoDB.
 * Ejecutar: node scripts/importation/importarTrafico.js
 */

// Configurar modo script para evitar reconexiones infinitas
process.env.SCRIPT_MODE = 'true';

const fs = require('fs').promises;
const path = require('path');
const csv = require('csv-parser');
const mongoose = require('mongoose');

// Importar modelos, configuración y utilidades
const Traffic = require('../../src/models/Trafico');
const { connectDB } = require('../../src/config/database');
const config = require('../../src/config/config');
const { importarTraficoLogger: logger } = require('../../src/config/scriptLogger');
const { handleMongoError } = require('../../src/utils/errorUtils');
const {
  TRAFFIC_ERROR_CODES, TRAFFIC_ELEMENT_TYPES,
  DATA_QUALITY_LEVELS, CONGESTION_LEVELS, TRAFFIC_INTENSITY_LEVELS,
  DAY_PERIODS, WORKDAY_TYPES
} = require('../../src/constants');
const {
  RejectionTracker,
  formatDuration,
  calculateProcessingSpeed,
  buildAndWriteSummary,
  parsearFechaHoraUTC
} = require('./helpers/importHelpers');
const { crearLectorCSV } = require('./helpers/normalizarEncoding');
const atlasPlan = require('./helpers/atlasPlan');

// ============================================================================
// CONFIGURACIÓN
// ============================================================================

const BATCH_SIZE = 10000;
const DATA_DIR = path.join(__dirname, '../../datos_hpe/Trafico');
const MAX_PARALLEL = 3;
const LOG_INTERVAL = 500000;

// Modo de insercion: 'insert' (BD vacia, mas rapido) o 'upsert' (BD con datos o --force)
let modoInsercion = 'upsert';

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
  TIPO_ELEMENTO_INVALIDO: 'Tipo de elemento invalido (esperado: URB o M30)',

  // Errores de procesamiento
  ERROR_TRANSFORMACION: 'Error durante la transformacion de datos',
  ERROR_VALIDACION_MONGOOSE: 'Error de validacion de esquema Mongoose',
  ERROR_INSERCION_BD: 'Error al insertar en base de datos',
  ERROR_LOTE: 'Error procesando lote de registros',

  // Errores de escritura en BD (writeErrors de insertMany ordered:false)
  CLAVE_DUPLICADA_INDICE_UNICO: 'CLAVE_DUPLICADA_INDICE_UNICO',
  VALIDACION_SCHEMA_FALLIDA: 'VALIDACION_SCHEMA_FALLIDA'
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

// Modo atlas (subset para MongoDB M0): filtro determinista que conserva pocos puntos de
// medida con dias contiguos, para que la pagina de trafico tenga ventanas de 7 dias y el
// rollup traffic_daily sea representativo. Ver scripts/importation/helpers/atlasPlan.js.
let atlasMode = false;
const atlasConfigTrafico = atlasPlan.trafico;
let atlasAceptadosTrafico = 0;

// Tracker de rechazos por tipo
const rejectionTracker = new RejectionTracker();

// ============================================================================
// VALIDACIÓN Y TRANSFORMACIÓN
// ============================================================================
// Nota: el distrito y la geometria de cada punto de medida se resuelven en
// tiempo de consulta via $lookup a la coleccion `locations` (ver
// traficoService), por lo que el importador no necesita cargar el CSV de
// puntos: cada medicion solo guarda `puntoMedidaId`.

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
    const razon = REJECTION_REASONS.ID_PUNTO_FALTANTE;
    const nivel = rejectionTracker.shouldLogWarn(razon, { id: row.id }) ? 'warn' : 'debug';
    logger[nivel]({
      fila: rowIndex,
      razon,
      datosOriginales: { id: row.id }
    }, 'Fila rechazada: ID de punto faltante');
    throw new Error(razon);
  }

  if (!/^\d+$/.test(puntoMedidaId)) {
    const razon = REJECTION_REASONS.ID_PUNTO_FORMATO_INVALIDO;
    const nivel = rejectionTracker.shouldLogWarn(razon, { id: row.id }) ? 'warn' : 'debug';
    logger[nivel]({
      fila: rowIndex,
      razon,
      datosOriginales: { id: row.id }
    }, 'Fila rechazada: formato de ID invalido');
    throw new Error(razon);
  }

  // Validar fecha
  const fechaStr = row.fecha?.trim();
  if (!fechaStr) {
    const razon = REJECTION_REASONS.FECHA_FALTANTE;
    const nivel = rejectionTracker.shouldLogWarn(razon, { fecha: row.fecha }) ? 'warn' : 'debug';
    logger[nivel]({
      fila: rowIndex,
      razon,
      datosOriginales: { fecha: row.fecha }
    }, 'Fila rechazada: fecha faltante');
    throw new Error(razon);
  }

  // Parsear fecha en UTC explicito para evitar deriva por TZ del runtime.
  // Las mediciones de trafico son cada 15 min: un shift por DST sacaria la
  // medicion de su bucket horario y romperia las clasificaciones derivadas
  // (periodoDia, tipoJornada).
  const fecha = parsearFechaHoraUTC(fechaStr);
  if (!fecha) {
    const razon = REJECTION_REASONS.FECHA_FORMATO_INVALIDO;
    const nivel = rejectionTracker.shouldLogWarn(razon, { fecha: fechaStr }) ? 'warn' : 'debug';
    logger[nivel]({
      fila: rowIndex,
      razon,
      datosOriginales: { fecha: fechaStr }
    }, 'Fila rechazada: fecha invalida');
    throw new Error(razon);
  }

  // Extraer componentes en UTC (coincide con el bucket original del CSV).
  const año = fecha.getUTCFullYear();
  const mes = fecha.getUTCMonth() + 1;
  const dia = fecha.getUTCDate();
  const hora = fecha.getUTCHours();
  const minutos = fecha.getUTCMinutes();

  // Normalizar tipo de elemento usando constantes
  const tipoElementoRaw = row.tipo_elem?.trim().toUpperCase();
  const tipoElemento = tipoElementoRaw;

  // Validar tipo de elemento usando constantes
  const tiposValidos = Object.values(TRAFFIC_ELEMENT_TYPES);
  if (!tiposValidos.includes(tipoElemento)) {
    const razon = REJECTION_REASONS.TIPO_ELEMENTO_INVALIDO;
    const nivel = rejectionTracker.shouldLogWarn(razon, { tipoElemento: tipoElementoRaw, esperados: tiposValidos }) ? 'warn' : 'debug';
    logger[nivel]({
      fila: rowIndex,
      razon,
      datosOriginales: { tipoElemento: tipoElementoRaw, esperados: tiposValidos }
    }, 'Fila rechazada: tipo de elemento invalido');
    throw new Error(razon);
  }

  // Parsear métricas (valores negativos indican ausencia de datos)
  // Usar isNaN en lugar de || para preservar valores validos de 0
  const rawIntensidad = parseInt(row.intensidad);
  const intensidad = isNaN(rawIntensidad) ? -1 : rawIntensidad;
  const rawOcupacion = parseInt(row.ocupacion);
  const ocupacion = isNaN(rawOcupacion) ? -1 : rawOcupacion;
  const rawCarga = parseInt(row.carga);
  const carga = isNaN(rawCarga) ? -1 : rawCarga;
  // velocidadMedia: solo los puntos M30 miden velocidad. El CSV trae el string
  // "NaN" en M30 sin dato (parseInt("NaN")=NaN se persistia y envenenaba los
  // $avg/$min/$max) y "0" en TODAS las URB (que no miden velocidad y el "0"
  // truthy se guardaba en vez de null). Saneamos: M30 sin valor finito -> -1
  // (centinela "sin dato", coherente con las demas metricas negativas);
  // URB -> null (no mide velocidad).
  const vmedRaw = parseInt(row.vmed, 10);
  const velocidadMedia = tipoElemento === TRAFFIC_ELEMENT_TYPES.M30
    ? (Number.isFinite(vmedRaw) ? vmedRaw : -1)
    : null;

  // Datos de calidad
  const errorCode = (row.error || 'N').trim().toUpperCase();
  const error = [TRAFFIC_ERROR_CODES.NO_ERROR, TRAFFIC_ERROR_CODES.ERROR, TRAFFIC_ERROR_CODES.SIN_DATOS].includes(errorCode)
    ? errorCode
    : TRAFFIC_ERROR_CODES.NO_ERROR;
  const periodoIntegracion = parseInt(row.periodo_integracion) || 0;

  // -----------------------------------------------------------------------
  // CAMPOS DE ANALISIS DERIVADOS (BI)
  // -----------------------------------------------------------------------
  // Los thresholds que vienen a continuacion son **decisiones del equipo**
  // basadas en el rango observado del dataset. NO son normativos (la DGT
  // no define cortes formales para "trafico denso" vs "fluido"). Se
  // documentan aqui para que cualquier conclusion BI ("Centro esta
  // colapsado a las 8:00") pueda interpretarse con la regla aplicada.
  // Si se cambia algun threshold, hay que considerar el impacto en las
  // paginas de correlacion (Aire x Trafico) y en el mapa de congestion.

  // Calidad general basada en error code y periodo de integracion.
  // Heuristica: "ALTA" exige ausencia de error Y agregacion sobre >=3
  // sub-muestras (de las 5 posibles que vienen del agregador del SCT).
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

  // Nivel de congestion basado en ocupacion (% del periodo en que el
  // sensor detecta vehiculo) y carga (0-100, deriva del SCT). Cualquiera
  // de los dos por encima del threshold dispara el siguiente nivel.
  // Cortes elegidos:
  //   FLUIDO         ocupacion <30%  Y  carga <40%
  //   DENSO          ocupacion 30-60% O carga 40-70%
  //   CONGESTIONADO  ocupacion 60-80% O carga 70-90%
  //   COLAPSADO      ocupacion >=80% O carga >=90%
  // Justificacion: 30/60/80 alinea con la "regla de tercios" del trafico
  // urbano estandar; 40/70/90 calibrado contra el percentil 95 observado
  // en M-30 horas pico del dataset 2051.
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

  // Clasificacion por intensidad bruta (vehiculos/hora). Cortes derivados
  // de cuartiles aproximados de la distribucion completa del dataset:
  //   <300       calle residencial muy poco transitada
  //   300-1000   urbano normal
  //   1000-2000  arteria principal
  //   2000-3000  arteria de alta capacidad
  //   >=3000     M-30 / accesos a la ciudad en hora pico
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

  // Periodo del dia. Periodizacion propia de movilidad urbana:
  //   MADRUGADA  00-07  (poco trafico, vehiculos pesados)
  //   MAÑANA     07-12  (pico de entrada al trabajo)
  //   MEDIODIA   12-15  (recta entre comidas)
  //   TARDE      15-21  (pico de salida + ocio)
  //   NOCHE      21-00  (atenuacion progresiva)
  // OJO: NO coincide con la periodizacion de Ruido (D 07-19, E 19-23,
  // N 23-07, T 24h) porque alli el periodo viene fijado por la directiva
  // 2002/49/CE. Para cruces BI Trafico x Ruido hay que normalizar.
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

  // Tipo de jornada basado en dia de la semana (en UTC para coincidir con
  // el resto de componentes ya extraidos)
  const dayOfWeek = fecha.getUTCDay(); // 0=domingo, 6=sabado
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
    if (modoInsercion === 'insert') {
      // Modo insertMany: BD vacia, sin lookup por unique en cada documento
      const result = await Traffic.insertMany(batch, {
        ordered: false,
        lean: true,
        rawResult: true,
        bypassDocumentValidation: true
      });

      const nuevos = result.insertedCount || 0;
      totalInserted += nuevos;
      return { nuevos, actualizados: 0, errores: 0 };
    }

    // Modo upsert: BD con datos previos o --force
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

    const result = await Traffic.bulkWrite(bulkOperations, {
      ordered: false,
      bypassDocumentValidation: true
    });

    const nuevos = result.upsertedCount || 0;
    const actualizados = result.modifiedCount || 0;
    totalInserted += nuevos;
    totalUpdated += actualizados;

    return { nuevos, actualizados, errores: 0 };

  } catch (error) {
    // En modo insertMany, ordered:false hace que algunos errores no aborten;
    // los exitosos quedan reflejados en error.result.insertedCount.
    if (modoInsercion === 'insert' && error.writeErrors) {
      const exitosos = (error.insertedDocs && error.insertedDocs.length) ||
                       (error.result && error.result.nInserted) ||
                       (batch.length - error.writeErrors.length);
      totalInserted += exitosos;
      // Clasificar cada writeError por su codigo MongoDB para no perder
      // trazabilidad. El catch original sumaba el conteo a totalErrors pero
      // no registraba el desglose por codigo (E11000 dup key, 121 validation,
      // etc.), dejando 376k errores como cifra opaca en el JSON.
      //
      // Nota sobre doble conteo intencionado:
      //  - `totalErrors += writeErrors.length` se mantiene; ese contador se
      //    reporta como `errors:` en el summary final.
      //  - `rejectionTracker.track()` ademas incrementa su propio contador
      //    interno y aparece en `rejected:` y en el desglose `rejections[]`.
      //  Por tanto, en el JSON estos writeErrors se cuentan dos veces (una
      //  en `errors:` y otra en `rejected:`). Es deliberado: el desglose por
      //  codigo en `rejections[]` es el valor de observabilidad que se gana.
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
      totalErrors += error.writeErrors.length;
      return { nuevos: exitosos, actualizados: 0, errores: error.writeErrors.length };
    }

    const mongoError = handleMongoError(error);
    logger.error({
      error: mongoError.message,
      tipo: mongoError.type,
      loteSize: batch.length,
      modo: modoInsercion
    }, 'Error procesando lote de trafico');

    // Trackear el fallo de lote completo para que aparezca en el desglose
    // de rejections del summary (sin esto el contador errors:N quedaba opaco).
    // Solo se registra una entrada por lote fallido (no por cada documento).
    rejectionTracker.track(REJECTION_REASONS.ERROR_LOTE, {
      tipo: mongoError.type,
      mensaje: (mongoError.message || '').substring(0, 200),
      loteSize: batch.length,
      modo: modoInsercion
    });
    totalErrors += batch.length;
    return { nuevos: 0, actualizados: 0, errores: batch.length };
  }
}

/**
 * Veredicto de muestreo atlas para una fila de trafico ya transformada.
 *
 * Filtro determinista estratificado por TIPO de elemento: se conservan hasta
 * `maxPuntosPorTipo` puntos URB y `maxPuntosPorTipo` puntos M30, y solo los dias
 * 1..`diaMax` (contiguos, para la ventana de 7 dias del frontend), con un tope global de
 * seguridad. El estado de seleccion (`puntosPorTipo`) es POR ARCHIVO (un mes): los CSV
 * mensuales NO comparten el mismo conjunto ni orden de puntos (enero empieza por M30
 * id 1001, julio por URB id 3396), asi que un set global se llenaria con el tipo del primer
 * archivo y dejaria los demas meses/tipos fuera. Estratificar por tipo garantiza que el
 * subset (y el rollup traffic_daily) tenga tanto URB como M30.
 *
 * @param {Object} doc - Documento de trafico transformado (puntoMedidaId, dia, tipoElemento).
 * @param {{URB: Set, M30: Set}} puntosPorTipo - Puntos ya seleccionados en este archivo, por tipo.
 * @returns {'aceptar'|'descartar'|'parar'} Accion que debe tomar el caller.
 */
function veredictoAtlasTrafico(doc, puntosPorTipo) {
  if (atlasAceptadosTrafico >= atlasConfigTrafico.tope) {
    return 'parar';
  }
  if (doc.dia > atlasConfigTrafico.diaMax) {
    return 'descartar';
  }
  const set = puntosPorTipo[doc.tipoElemento];
  if (!set) {
    return 'descartar';
  }
  if (!set.has(doc.puntoMedidaId)) {
    if (set.size >= atlasConfigTrafico.maxPuntosPorTipo) {
      return 'descartar';
    }
    set.add(doc.puntoMedidaId);
  }
  atlasAceptadosTrafico += 1;
  return 'aceptar';
}

/**
 * Procesar un archivo CSV de tráfico
 * @param {string} filePath - Ruta al archivo
 * @returns {Promise<Object>} - Estadísticas del archivo
 */
async function procesarArchivoTrafico(filePath) {
  return new Promise((resolve, reject) => {
    const batch = [];
    let rowCount = 0;
    let processedCount = 0;
    let errorCount = 0;
    // Estado de seleccion de puntos por tipo, LOCAL a este archivo (mes). Ver veredictoAtlasTrafico.
    const puntosPorTipoAtlas = { URB: new Set(), M30: new Set() };

    currentFile = path.basename(filePath);
    logger.info({ archivo: currentFile }, 'Procesando archivo de trafico');

    const stream = crearLectorCSV(filePath)
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

          // Modo atlas: filtrar la fila por el muestreo determinista de trafico.
          if (atlasMode) {
            const veredicto = veredictoAtlasTrafico(trafficData, puntosPorTipoAtlas);
            if (veredicto === 'parar') {
              // Tope de seguridad alcanzado: flush del lote acumulado, dejar de leer el CSV
              // y resolver la promesa (tras stream.destroy() no se emite el evento 'end').
              stream.pause();
              const loteFinal = batch.splice(0);
              processBatch(loteFinal).finally(() => {
                if (!isShuttingDown) {
                  stream.destroy();
                }
                resolve({
                  file: currentFile,
                  totalRows: rowCount,
                  processed: processedCount,
                  errors: errorCount
                });
              });
              return;
            }
            if (veredicto === 'descartar') {
              return;
            }
          }

          batch.push(trafficData);
          processedCount++;

          // Procesar lote cuando alcance el tamaño configurado
          if (batch.length >= BATCH_SIZE) {
            stream.pause();
            // splice(0) hace snapshot + vaciado atomico en una sola
            // operacion (mas claro que [...batch] + batch.length=0).
            const currentBatch = batch.splice(0);

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
  let csvFiles = files.filter(file =>
    file.endsWith('.csv') &&
    file.includes('Traffic') &&
    !file.includes('sample')
  );

  // Modo atlas: procesar solo los meses del plan (evita leer los 12 CSV / 7.2GB).
  if (atlasMode && atlasConfigTrafico?.archivos) {
    const permitidos = new Set(atlasConfigTrafico.archivos);
    csvFiles = csvFiles.filter(file => permitidos.has(file));
    logger.info({ archivos: csvFiles }, 'Modo Atlas: subset de archivos de trafico');
  }

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

  // Modo atlas: leer la flag antes de descubrir archivos (filtra meses) y forzar
  // procesamiento secuencial (1 archivo a la vez) para que el filtro de puntos y el
  // tope global sean deterministas y sin carreras entre archivos.
  atlasMode = process.argv.includes('--atlas');
  const maxParalelo = atlasMode ? 1 : MAX_PARALLEL;

  logger.info({
    batchSize: BATCH_SIZE,
    directorioDatos: DATA_DIR,
    procesamientoParalelo: maxParalelo,
    atlas: atlasMode
  }, 'Iniciando importacion de datos de trafico');

  try {
    // Conectar a base de datos
    logger.info('Conectando a MongoDB...');
    await connectDB(config.database.uri);
    logger.info('Conexion a MongoDB establecida');

    // Obtener archivos a procesar
    const filesToProcess = await getFilesToProcess();

    if (filesToProcess.length === 0) {
      logger.warn('No hay archivos para procesar');
      return;
    }

    // Detectar modo de insercion automaticamente.
    // estimatedDocumentCount usa metadata del catalogo (instantaneo); countDocuments()
    // haria un full-scan sobre 100M+ docs y superaria el maxTimeMS de 10s.
    const forceMode = process.argv.includes('--force');
    const countActual = await Traffic.estimatedDocumentCount();
    modoInsercion = (countActual === 0 && !forceMode) ? 'insert' : 'upsert';

    logger.info({
      modo: modoInsercion,
      registrosExistentes: countActual.toLocaleString(),
      force: forceMode
    }, `Modo de insercion: ${modoInsercion}`);

    // Reusar countActual para el resumen final
    const countAntes = countActual;

    // Procesar archivos en paralelo
    const fileResults = [];

    for (let i = 0; i < filesToProcess.length; i += maxParalelo) {
      if (isShuttingDown) {
        logger.warn('Importacion interrumpida por senal de terminacion');
        break;
      }

      const batch = filesToProcess.slice(i, i + maxParalelo);

      logger.info({
        lote: Math.floor(i / maxParalelo) + 1,
        totalLotes: Math.ceil(filesToProcess.length / maxParalelo),
        archivos: batch
      }, 'Procesando lote paralelo de archivos');

      const promises = batch.map(async (fileName) => {
        const filePath = path.join(DATA_DIR, fileName);

        try {
          return await procesarArchivoTrafico(filePath);
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
        loteCompletado: Math.floor(i / maxParalelo) + 1,
        progreso: `${Math.min(i + maxParalelo, filesToProcess.length)}/${filesToProcess.length}`
      }, 'Lote paralelo completado');
    }

    // Mostrar resumen final
    const endTime = Date.now();

    // estimatedDocumentCount usa metadata (instantaneo); countDocuments() haria un
    // collection scan que en una BD con 100M+ docs sin indices excede 10s.
    const countDespues = await Traffic.estimatedDocumentCount();

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
    buildAndWriteSummary('trafico', {
      startTime,
      counts: {
        totalProcessed,
        inserted: totalInserted,
        updated: totalUpdated,
        rejected: totalRejected,
        errors: totalErrors
      },
      rejectionTracker
    });

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
  console.error('UNCAUGHT EXCEPTION:', error);
  logger.fatal({ error: error.message, stack: error.stack }, 'Error no capturado');
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('UNHANDLED REJECTION:', reason);
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
  procesarArchivoTrafico,
  validateAndTransformRow,
  REJECTION_REASONS
};
