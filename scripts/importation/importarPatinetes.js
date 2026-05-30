/**
 * Script de Importacion de Asignacion de Patinetes
 *
 * Script especializado para importar datos CSV de asignacion de patinetes
 * electricos a la base de datos MongoDB. Procesa el archivo de asignacion
 * del directorio datos_hpe/
 *
 * Uso: node scripts/importation/importarPatinetes.js [opciones]
 *
 * Opciones:
 *   --force         Sobrescribir datos existentes (upsert)
 *   --batch=N       Tamano del lote (default: 50)
 *   --help          Mostrar ayuda
 *
 * @module scripts/importation/importarPatinetes
 */

// Configurar modo script para evitar reconexiones infinitas
process.env.SCRIPT_MODE = 'true';

const fs = require('fs').promises;
const path = require('path');
const csv = require('csv-parser');
const mongoose = require('mongoose');

// Configuracion y utilidades
const { connectDB } = require('../../src/config/database');
const config = require('../../src/config/config');
const { importarPatinetesLogger: logger } = require('../../src/config/scriptLogger');
const { handleMongoError } = require('../../src/utils/errorUtils');
const AsignacionPatinetes = require('../../src/models/AsignacionPatinetes');
const {
  RejectionTracker,
  formatDuration,
  calculateProcessingSpeed,
  cleanString,
  buildAndWriteSummary
} = require('./helpers/importHelpers');
const { crearLectorCSV } = require('./helpers/normalizarEncoding');
const {
  PROVEEDORES_PATINETES,
  DATASET_YEARS,
  UMBRALES_DENSIDAD_PATINETES,
  NIVELES_DENSIDAD_PATINETES,
  UMBRALES_DEMANDA_PATINETES,
  NIVELES_DEMANDA_PATINETES,
  DOMINANCIA_PROVEEDORES_PATINETES,
  CONCENTRACION_MERCADO_PATINETES,
  UMBRALES_CONCENTRACION_MERCADO,
  TIPOS_ZONA_PATINETES,
  NIVELES_PRIORIDAD_PATINETES,
  AREAS_CLAVE_PATINETES
} = require('../../src/constants');

// ============================================================================
// CONFIGURACION
// ============================================================================

const IMPORT_CONFIG = {
  dataFile: path.join(__dirname, '..', '..', 'datos_hpe', 'Anthem_CTC_AsignaciónPatinetes.csv'),
  batchSize: 50,
  skipExisting: true,
  logInterval: 50,
  csvSeparator: ';'
};

// ============================================================================
// RAZONES DE RECHAZO
// ============================================================================

/**
 * Razones de rechazo para filas que no se insertan en la BD
 * @constant {Object}
 */
const REJECTION_REASONS = {
  // Campos obligatorios faltantes
  DISTRITO_FALTANTE: 'Distrito faltante o vacio',
  BARRIO_FALTANTE: 'Barrio faltante o vacio',
  FILA_TOTAL: 'Fila de totales (no es dato real)',
  SIN_PROVEEDORES: 'Sin proveedores validos',

  // Errores de procesamiento
  ERROR_PROCESAMIENTO_FILA: 'Error durante el procesamiento de la fila',
  ERROR_VALIDACION_MONGOOSE: 'Error de validacion de esquema Mongoose',
  ERROR_INSERCION_BD: 'Error al insertar en base de datos',
  ERROR_DUPLICADO: 'Registro duplicado en base de datos'
};

// ============================================================================
// MAPEOS Y CONSTANTES
// ============================================================================

/**
 * Mapeo de nombres de proveedores para normalizacion
 * Mapea desde nombres en CSV a valores de constantes PROVEEDORES_PATINETES
 * @constant {Object}
 */
const PROVIDER_NAME_MAPPING = {
  'ACCIONA': PROVEEDORES_PATINETES.ACCIONA,
  'Taxify': PROVEEDORES_PATINETES.TAXIFY,
  'KOKO': PROVEEDORES_PATINETES.KOKO,
  'UFO': PROVEEDORES_PATINETES.UFO,
  'RIDECONGA': PROVEEDORES_PATINETES.RIDECONGA,
  'FLASH': PROVEEDORES_PATINETES.FLASH,
  'LIME': PROVEEDORES_PATINETES.LIME,
  'WIND ': PROVEEDORES_PATINETES.WIND,
  'WIND': PROVEEDORES_PATINETES.WIND,
  'BIRD': PROVEEDORES_PATINETES.BIRD,
  'REBY RIDES': PROVEEDORES_PATINETES.REBY_RIDES,
  'MOVO': PROVEEDORES_PATINETES.MOVO,
  'MYGO': PROVEEDORES_PATINETES.MYGO,
  'JUMP UBER': PROVEEDORES_PATINETES.JUMP_UBER,
  'SJV CONSULTING': PROVEEDORES_PATINETES.SJV_CONSULTING
};

/**
 * Campos que deben ignorarse (no son proveedores)
 * @constant {Array}
 */
const IGNORED_FIELDS = [
  'DISTRITO',
  'BARRIO',
  'TOTAL',
  '',
  ' ',
  'Total'
];

// ============================================================================
// CONTADORES GLOBALES
// ============================================================================

let totalProcessed = 0;
let totalInserted = 0;
let totalUpdated = 0;
let totalSkipped = 0;
let totalRejected = 0;
let totalErrors = 0;
let isShuttingDown = false;

// Tracker de rechazos por tipo
const rejectionTracker = new RejectionTracker();

// ============================================================================
// FUNCIONES DE PARSEO
// ============================================================================

/**
 * Parsear numero de forma segura
 * @param {string|number} value - Valor a parsear
 * @param {number} defaultValue - Valor por defecto
 * @returns {number}
 */
function parsearNumero(value, defaultValue = 0) {
  if (!value || value.toString().trim() === '') {
    return defaultValue;
  }
  const cleaned = value.toString().replace(/['"]/g, '').trim();
  const parsed = parseInt(cleaned, 10);
  return isNaN(parsed) ? defaultValue : Math.max(0, parsed);
}

/**
 * Calcular campos computados para una asignacion de patinetes.
 * Replica la logica del pre-save hook del modelo (calcularEstadisticas,
 * analizarDistribucion, clasificarArea, validarDatos) para que los documentos
 * insertados via bulkWrite contengan todos los campos derivados.
 *
 * @param {Object} data - Objeto de datos de asignacion (se muta in-place)
 */
function calcularCamposPatinetes(data) {
  // ------------------------------------------------------------------
  // 1. Estadisticas (calcularEstadisticas)
  // ------------------------------------------------------------------
  data.estadisticas.totalProveedores = data.proveedores.length;
  data.estadisticas.proveedoresActivos = data.proveedores.filter(
    p => p.activo && p.cantidad > 0
  ).length;
  data.estadisticas.promedioPatinetesPorProveedor =
    data.estadisticas.proveedoresActivos > 0
      ? data.estadisticas.totalPatinetes / data.estadisticas.proveedoresActivos
      : 0;

  // Clasificar densidad basada en total de patinetes
  if (data.estadisticas.totalPatinetes >= UMBRALES_DENSIDAD_PATINETES.MUY_ALTA) {
    data.estadisticas.densidadPatinetes = NIVELES_DENSIDAD_PATINETES.MUY_ALTA;
  } else if (data.estadisticas.totalPatinetes >= UMBRALES_DENSIDAD_PATINETES.ALTA) {
    data.estadisticas.densidadPatinetes = NIVELES_DENSIDAD_PATINETES.ALTA;
  } else if (data.estadisticas.totalPatinetes >= UMBRALES_DENSIDAD_PATINETES.MEDIA) {
    data.estadisticas.densidadPatinetes = NIVELES_DENSIDAD_PATINETES.MEDIA;
  } else {
    data.estadisticas.densidadPatinetes = NIVELES_DENSIDAD_PATINETES.BAJA;
  }

  // ------------------------------------------------------------------
  // 2. Analisis de distribucion (analizarDistribucion)
  // ------------------------------------------------------------------
  const proveedoresActivos = data.proveedores.filter(p => p.activo && p.cantidad > 0);

  if (!data.analisisDistribucion) {
    data.analisisDistribucion = {};
  }

  if (proveedoresActivos.length > 0) {
    // Ordenar por cantidad descendente
    const sorted = [...proveedoresActivos].sort((a, b) => b.cantidad - a.cantidad);

    // Proveedor dominante
    data.analisisDistribucion.proveedorDominante = {
      nombre: sorted[0].nombre,
      cantidad: sorted[0].cantidad,
      porcentaje: (sorted[0].cantidad / data.estadisticas.totalPatinetes) * 100
    };

    // Proveedor secundario (si hay 2+ proveedores activos)
    if (sorted.length > 1) {
      data.analisisDistribucion.proveedorSecundario = {
        nombre: sorted[1].nombre,
        cantidad: sorted[1].cantidad,
        porcentaje: (sorted[1].cantidad / data.estadisticas.totalPatinetes) * 100
      };
    }

    // Indice Herfindahl-Hirschman (HHI)
    const hhi = proveedoresActivos.reduce((sum, p) => {
      const share = (p.cantidad / data.estadisticas.totalPatinetes) * 100;
      return sum + (share * share);
    }, 0);
    data.analisisDistribucion.indiceHerfindahl = Math.round(hhi);

    // Clasificar concentracion del mercado
    if (hhi >= UMBRALES_CONCENTRACION_MERCADO.HIGH) {
      data.analisisDistribucion.concentracionMercado = CONCENTRACION_MERCADO_PATINETES.ALTA_CONCENTRACION;
      data.estadisticas.dominanciaProveedores = DOMINANCIA_PROVEEDORES_PATINETES.MONOPOLIO;
    } else if (hhi >= UMBRALES_CONCENTRACION_MERCADO.MODERATE) {
      data.analisisDistribucion.concentracionMercado = CONCENTRACION_MERCADO_PATINETES.CONCENTRADA;
      data.estadisticas.dominanciaProveedores = proveedoresActivos.length === 2
        ? DOMINANCIA_PROVEEDORES_PATINETES.DUOPOLIO
        : DOMINANCIA_PROVEEDORES_PATINETES.OLIGOPOLIO;
    } else if (hhi >= UMBRALES_CONCENTRACION_MERCADO.LOW) {
      data.analisisDistribucion.concentracionMercado = CONCENTRACION_MERCADO_PATINETES.MODERADA;
      data.estadisticas.dominanciaProveedores = DOMINANCIA_PROVEEDORES_PATINETES.OLIGOPOLIO;
    } else {
      data.analisisDistribucion.concentracionMercado = CONCENTRACION_MERCADO_PATINETES.COMPETITIVA;
      data.estadisticas.dominanciaProveedores = DOMINANCIA_PROVEEDORES_PATINETES.EQUILIBRADA;
    }
  }

  // ------------------------------------------------------------------
  // 3. Clasificacion de area (clasificarArea)
  // ------------------------------------------------------------------
  const distrito = data.distrito.nombre.toUpperCase();
  const barrio = data.barrio.nombre.toUpperCase();
  const totalPatinetes = data.estadisticas.totalPatinetes;

  if (!data.clasificacionArea) {
    data.clasificacionArea = {};
  }

  // Clasificar tipo de zona basado en distrito/barrio
  if (AREAS_CLAVE_PATINETES.CENTRAL.some(loc => distrito.includes(loc) || barrio.includes(loc))) {
    data.clasificacionArea.tipoZona = TIPOS_ZONA_PATINETES.CENTRO_URBANO;
    data.clasificacionArea.prioridadServicio = NIVELES_PRIORIDAD_PATINETES.CRITICA;
  } else if (AREAS_CLAVE_PATINETES.UNIVERSITY.some(loc => barrio.includes(loc))) {
    data.clasificacionArea.tipoZona = TIPOS_ZONA_PATINETES.ZONA_UNIVERSITARIA;
    data.clasificacionArea.prioridadServicio = NIVELES_PRIORIDAD_PATINETES.ALTA;
  } else if (AREAS_CLAVE_PATINETES.TRANSPORT.some(loc => distrito.includes(loc) || barrio.includes(loc))) {
    // Buscar TAMBIEN en distrito: estaciones importantes (Chamartin)
    // estan declaradas como nombre de DISTRITO, no de barrio. Antes solo se
    // buscaba en barrio y las 6 entradas de CHAMARTIN caian a ZONA_RESIDENCIAL.
    data.clasificacionArea.tipoZona = TIPOS_ZONA_PATINETES.ZONA_TRANSPORTE;
    data.clasificacionArea.prioridadServicio = NIVELES_PRIORIDAD_PATINETES.ALTA;
  } else if (AREAS_CLAVE_PATINETES.COMMERCIAL.some(loc => distrito.includes(loc))) {
    data.clasificacionArea.tipoZona = TIPOS_ZONA_PATINETES.ZONA_COMERCIAL;
    data.clasificacionArea.prioridadServicio = NIVELES_PRIORIDAD_PATINETES.ALTA;
  } else {
    data.clasificacionArea.tipoZona = TIPOS_ZONA_PATINETES.ZONA_RESIDENCIAL;
    data.clasificacionArea.prioridadServicio = NIVELES_PRIORIDAD_PATINETES.MEDIA;
  }

  // Estimar demanda basada en densidad de patinetes
  if (totalPatinetes >= UMBRALES_DEMANDA_PATINETES.MUY_ALTA) {
    data.clasificacionArea.demandaEstimada = NIVELES_DEMANDA_PATINETES.MUY_ALTA;
  } else if (totalPatinetes >= UMBRALES_DEMANDA_PATINETES.ALTA) {
    data.clasificacionArea.demandaEstimada = NIVELES_DEMANDA_PATINETES.ALTA;
  } else if (totalPatinetes >= UMBRALES_DEMANDA_PATINETES.MEDIA) {
    data.clasificacionArea.demandaEstimada = NIVELES_DEMANDA_PATINETES.MEDIA;
  } else {
    data.clasificacionArea.demandaEstimada = NIVELES_DEMANDA_PATINETES.BAJA;
  }

  // ------------------------------------------------------------------
  // 4. Validacion de datos (validarDatos)
  // ------------------------------------------------------------------
  const sumaProveedores = data.proveedores.reduce((sum, p) => sum + p.cantidad, 0);
  const nombresProveedores = data.proveedores.map(p => p.nombre);

  data.metadatos = {
    calidadDatos: {
      esCompleto: true,
      camposFaltantes: [],
      puntuacionCalidad: 1
    },
    validacionDatos: {
      sumaCorrecta: sumaProveedores === data.estadisticas.totalPatinetes,
      proveedoresDuplicados: nombresProveedores.length !== new Set(nombresProveedores).size,
      datosConsistentes: true
    }
  };

  // Recalcular consistencia despues de establecer los campos anteriores
  data.metadatos.validacionDatos.datosConsistentes =
    data.metadatos.validacionDatos.sumaCorrecta &&
    !data.metadatos.validacionDatos.proveedoresDuplicados &&
    data.proveedores.every(p => p.cantidad >= 0);
}

/**
 * Parsear datos de una fila CSV de asignacion de patinetes
 * @param {Object} row - Fila del CSV
 * @param {string} sourceFile - Archivo origen
 * @param {number} rowIndex - Indice de fila para logging
 * @returns {Object|null} - Datos procesados o null si se rechaza
 */
function parsearFilaAsignacion(row, sourceFile, rowIndex) {
  // Limpiar y validar campos basicos
  const distrito = cleanString(row.DISTRITO, '').toUpperCase();
  const barrio = cleanString(row.BARRIO, '');

  // Validar campos obligatorios
  if (!distrito) {
    const razon = REJECTION_REASONS.DISTRITO_FALTANTE;
    const nivel = rejectionTracker.shouldLogWarn(razon, { distrito: row.DISTRITO, barrio: row.BARRIO }) ? 'warn' : 'debug';
    logger[nivel]({
      fila: rowIndex,
      razon,
      datosOriginales: { distrito: row.DISTRITO, barrio: row.BARRIO }
    }, 'Fila rechazada: distrito faltante');
    return null;
  }

  if (!barrio) {
    const razon = REJECTION_REASONS.BARRIO_FALTANTE;
    const nivel = rejectionTracker.shouldLogWarn(razon, { distrito: row.DISTRITO, barrio: row.BARRIO }) ? 'warn' : 'debug';
    logger[nivel]({
      fila: rowIndex,
      razon,
      datosOriginales: { distrito: row.DISTRITO, barrio: row.BARRIO }
    }, 'Fila rechazada: barrio faltante');
    return null;
  }

  // Ignorar filas de totales
  if (distrito.includes('TOTAL') || barrio.toLowerCase().includes('total')) {
    rejectionTracker.track(REJECTION_REASONS.FILA_TOTAL);
    logger.debug({
      fila: rowIndex,
      razon: REJECTION_REASONS.FILA_TOTAL,
      datosOriginales: { distrito, barrio }
    }, 'Fila ignorada: fila de totales');
    return null;
  }

  // Procesar proveedores
  const proveedores = [];
  let totalCalculado = 0;

  Object.keys(row).forEach(columnName => {
    const cleanColumnName = cleanString(columnName, '');

    // Ignorar campos que no son proveedores
    if (IGNORED_FIELDS.includes(cleanColumnName) ||
        IGNORED_FIELDS.includes(columnName)) {
      return;
    }

    // Mapear nombre del proveedor
    const proveedorNombre = PROVIDER_NAME_MAPPING[cleanColumnName] ||
                           PROVIDER_NAME_MAPPING[columnName] ||
                           cleanColumnName;

    if (proveedorNombre && proveedorNombre.length > 0) {
      const cantidad = parsearNumero(row[columnName]);

      if (cantidad >= 0) {
        proveedores.push({
          nombre: proveedorNombre,
          cantidad: cantidad,
          activo: cantidad > 0
        });
        totalCalculado += cantidad;
      }
    }
  });

  // Validar que hay al menos un proveedor
  if (proveedores.length === 0) {
    const razon = REJECTION_REASONS.SIN_PROVEEDORES;
    const nivel = rejectionTracker.shouldLogWarn(razon, { distrito, barrio }) ? 'warn' : 'debug';
    logger[nivel]({
      fila: rowIndex,
      razon,
      datosOriginales: { distrito, barrio }
    }, 'Fila rechazada: sin proveedores validos');
    return null;
  }

  // Verificar discrepancia en total
  const totalCSV = parsearNumero(row.TOTAL);
  if (totalCSV > 0 && totalCalculado !== totalCSV) {
    logger.warn({
      fila: rowIndex,
      distrito,
      barrio,
      totalCalculado,
      totalCSV,
      diferencia: Math.abs(totalCalculado - totalCSV)
    }, 'Discrepancia en total de patinetes: suma proveedores != TOTAL CSV. Usando valor calculado');
  }

  const data = {
    fechaAsignacion: new Date(DATASET_YEARS.DEFAULT_START_DATE),
    distrito: {
      nombre: distrito
    },
    barrio: {
      nombre: barrio
    },
    proveedores,
    estadisticas: {
      totalPatinetes: totalCalculado
    },
    procesamiento: {
      archivoOrigen: path.basename(sourceFile),
      importadoEn: new Date(),
      versionDatos: '1.0'
    }
  };

  // Calcular campos derivados (replica pre-save hook, necesario para bulkWrite)
  calcularCamposPatinetes(data);

  return data;
}

// ============================================================================
// PROCESAMIENTO DE ARCHIVOS
// ============================================================================

/**
 * Procesar el archivo CSV de asignacion de patinetes
 * @param {string} filePath - Ruta al archivo CSV
 * @param {Object} options - Opciones de procesamiento
 * @returns {Promise<Object>} - Estadisticas de procesamiento
 */
async function procesarArchivoPatinetes(filePath, options = {}) {
  const fileName = path.basename(filePath);
  logger.info({ archivo: fileName }, 'Procesando archivo de asignacion de patinetes');

  return new Promise((resolve, reject) => {
    const stats = {
      fileName,
      totalRows: 0,
      processedRows: 0,
      errorRows: 0,
      rejectedRows: 0,
      insertedRecords: 0,
      updatedRecords: 0,
      skippedRecords: 0,
      errors: []
    };

    const batch = [];
    let rowIndex = 0;

    const stream = crearLectorCSV(filePath)
      .pipe(csv({ separator: options.csvSeparator || IMPORT_CONFIG.csvSeparator }))
      .on('data', async (row) => {
        if (isShuttingDown) {
          stream.destroy();
          return;
        }

        stats.totalRows++;
        rowIndex++;

        try {
          const assignmentData = parsearFilaAsignacion(row, fileName, rowIndex);

          if (assignmentData) {
            batch.push(assignmentData);
            stats.processedRows++;

            // Procesar lote cuando alcance el tamano configurado
            if (batch.length >= options.batchSize) {
              stream.pause();
              const batchResult = await procesarLote(batch, options);
              stats.insertedRecords += batchResult.inserted;
              stats.updatedRecords += batchResult.updated;
              stats.skippedRecords += batchResult.skipped;
              stats.errorRows += batchResult.errors;
              batch.length = 0;
              stream.resume();
            }
          } else {
            stats.rejectedRows++;
          }

          // Log de progreso
          if (stats.totalRows % (options.logInterval || IMPORT_CONFIG.logInterval) === 0) {
            logger.info({
              archivo: fileName,
              filasProcesadas: stats.totalRows,
              insertadas: stats.insertedRecords,
              rechazadas: stats.rejectedRows
            }, 'Progreso de procesamiento');
          }

        } catch (error) {
          stats.errorRows++;
          totalErrors++;
          rejectionTracker.track(REJECTION_REASONS.ERROR_PROCESAMIENTO_FILA);
          logger.error({
            fila: rowIndex,
            archivo: fileName,
            razon: REJECTION_REASONS.ERROR_PROCESAMIENTO_FILA,
            error: error.message
          }, 'Error procesando fila');

          if (stats.errors.length < 100) {
            stats.errors.push({
              row: rowIndex,
              error: error.message
            });
          }
        }
      })
      .on('end', async () => {
        try {
          // Procesar lote restante
          if (batch.length > 0 && !isShuttingDown) {
            const batchResult = await procesarLote(batch, options);
            stats.insertedRecords += batchResult.inserted;
            stats.updatedRecords += batchResult.updated;
            stats.skippedRecords += batchResult.skipped;
            stats.errorRows += batchResult.errors;
          }

          // Actualizar contadores globales
          totalProcessed += stats.totalRows;
          totalInserted += stats.insertedRecords;
          totalUpdated += stats.updatedRecords;
          totalSkipped += stats.skippedRecords;
          totalRejected += stats.rejectedRows;

          logger.info({
            archivo: fileName,
            totalFilas: stats.totalRows,
            procesadas: stats.processedRows,
            insertadas: stats.insertedRecords,
            actualizadas: stats.updatedRecords,
            omitidas: stats.skippedRecords,
            rechazadas: stats.rejectedRows,
            errores: stats.errorRows
          }, 'Archivo completado');

          resolve(stats);
        } catch (error) {
          reject(error);
        }
      })
      .on('error', (error) => {
        logger.error({
          archivo: fileName,
          error: error.message
        }, 'Error leyendo archivo CSV');
        reject(error);
      });
  });
}

// ============================================================================
// PROCESAMIENTO DE LOTES
// ============================================================================

/**
 * Procesar un error individual de escritura de bulk
 * @param {Object} writeError - Error de escritura
 * @param {Object} failedDoc - Documento que fallo
 * @param {Object} result - Objeto de resultado para actualizar
 */
function manejarErrorEscritura(writeError, failedDoc, result) {
  const errorCode = writeError.err?.code || writeError.code;

  if (errorCode === 11000) {
    result.skipped++;
    logger.debug({
      razon: REJECTION_REASONS.ERROR_DUPLICADO,
      distrito: failedDoc?.distrito?.nombre,
      barrio: failedDoc?.barrio?.nombre
    }, 'Registro omitido - duplicado');
  } else {
    result.errors++;
    const errorInfo = handleMongoError(writeError.err || writeError);
    logger.warn({
      razon: REJECTION_REASONS.ERROR_INSERCION_BD,
      datosOriginales: {
        distrito: failedDoc?.distrito?.nombre,
        barrio: failedDoc?.barrio?.nombre
      },
      errorMongo: errorInfo
    }, 'Error en insercion de asignacion');
  }
}

/**
 * Procesar errores de bulk write
 * @param {Object} bulkError - Error de bulk write
 * @param {Array} batch - Lote de documentos
 * @param {Object} result - Objeto de resultado para actualizar
 */
function procesarErroresBulkWrite(bulkError, batch, result) {
  if (!bulkError.writeErrors) {
    return;
  }

  for (const writeError of bulkError.writeErrors) {
    const operationIndex = writeError.index;
    const failedDoc = batch[operationIndex];
    manejarErrorEscritura(writeError, failedDoc, result);
  }
}

/**
 * Procesar un lote de asignaciones con manejo de errores detallado
 * @param {Array} batch - Lote de datos de asignaciones
 * @param {Object} options - Opciones de procesamiento
 * @returns {Promise<Object>} - Resultado del procesamiento
 */
async function procesarLote(batch, options) {
  const result = { inserted: 0, updated: 0, skipped: 0, errors: 0 };

  if (batch.length === 0) {
    return result;
  }

  if (options.skipExisting) {
    return procesarLoteInsercion(batch, result);
  }

  return procesarLoteUpsert(batch, result);
}

/**
 * Procesar lote con insercion (skip existing)
 * @param {Array} batch - Lote de documentos
 * @param {Object} result - Objeto de resultado
 * @returns {Promise<Object>}
 */
async function procesarLoteInsercion(batch, result) {
  const operations = batch.map(assignmentData => ({
    insertOne: { document: assignmentData }
  }));

  try {
    const bulkResult = await AsignacionPatinetes.bulkWrite(operations, {
      ordered: false,
      bypassDocumentValidation: true
    });
    result.inserted = bulkResult.insertedCount || 0;
  } catch (bulkError) {
    procesarErroresBulkWrite(bulkError, batch, result);

    // Contar inserciones exitosas del bulkWrite
    if (bulkError.result) {
      result.inserted += bulkError.result.nInserted || 0;
    }
  }

  return result;
}

/**
 * Procesar lote con upsert (force mode)
 * @param {Array} batch - Lote de documentos
 * @param {Object} result - Objeto de resultado
 * @returns {Promise<Object>}
 */
async function procesarLoteUpsert(batch, result) {
  const operations = batch.map(assignmentData => ({
    updateOne: {
      filter: {
        'distrito.nombre': assignmentData.distrito.nombre,
        'barrio.nombre': assignmentData.barrio.nombre
      },
      update: { $set: assignmentData },
      upsert: true
    }
  }));

  try {
    const bulkResult = await AsignacionPatinetes.bulkWrite(operations, {
      ordered: false,
      bypassDocumentValidation: true
    });
    result.inserted = bulkResult.upsertedCount || 0;
    result.updated = bulkResult.modifiedCount || 0;
    result.skipped = (bulkResult.matchedCount || 0) - (bulkResult.modifiedCount || 0);
  } catch (bulkError) {
    const errorInfo = handleMongoError(bulkError);
    logger.error({
      razon: REJECTION_REASONS.ERROR_INSERCION_BD,
      errorMongo: errorInfo
    }, 'Error en operacion upsert de lote');

    // Contar resultados parciales
    if (bulkError.result) {
      result.inserted += bulkError.result.nUpserted || 0;
      result.updated += bulkError.result.nModified || 0;
    }
  }

  return result;
}

// ============================================================================
// FUNCION DE IMPORTACION PRINCIPAL
// ============================================================================

/**
 * Importar datos de asignacion de patinetes
 * @param {Object} options - Opciones de importacion
 * @returns {Promise<Object>} - Estadisticas finales
 */
async function importarDatosPatinetes(options = {}) {
  const importConfig = { ...IMPORT_CONFIG, ...options };

  logger.info({
    archivo: importConfig.dataFile,
    batchSize: importConfig.batchSize,
    skipExisting: importConfig.skipExisting
  }, 'Iniciando importacion de datos de asignacion de patinetes');

  try {
    // Verificar que existe el archivo
    try {
      await fs.access(importConfig.dataFile);
    } catch {
      throw new Error(`Archivo no encontrado: ${importConfig.dataFile}`);
    }

    const globalStats = {
      startTime: Date.now(),
      totalRows: 0,
      processedRows: 0,
      errorRows: 0,
      rejectedRows: 0,
      insertedRecords: 0,
      updatedRecords: 0,
      skippedRecords: 0
    };

    // Procesar archivo
    const fileStats = await procesarArchivoPatinetes(importConfig.dataFile, importConfig);

    // Acumular estadisticas
    globalStats.totalRows = fileStats.totalRows;
    globalStats.processedRows = fileStats.processedRows;
    globalStats.errorRows = fileStats.errorRows;
    globalStats.rejectedRows = fileStats.rejectedRows;
    globalStats.insertedRecords = fileStats.insertedRecords;
    globalStats.updatedRecords = fileStats.updatedRecords;
    globalStats.skippedRecords = fileStats.skippedRecords;

    globalStats.endTime = Date.now();
    globalStats.duration = globalStats.endTime - globalStats.startTime;

    return globalStats;

  } catch (error) {
    logger.error({ error: error.message }, 'Error en importacion de asignacion de patinetes');
    throw error;
  }
}

// ============================================================================
// MANEJO DE SENALES DE TERMINACION
// ============================================================================

/**
 * Manejador de cierre graceful
 * @param {string} signal - Senal recibida
 */
async function manejarCierre(signal) {
  if (isShuttingDown) {
    return;
  }
  isShuttingDown = true;

  logger.warn({ signal }, 'Senal de terminacion recibida, cerrando gracefully...');

  // Resumen parcial
  logger.info({
    procesadas: totalProcessed,
    insertadas: totalInserted,
    actualizadas: totalUpdated,
    omitidas: totalSkipped,
    rechazadas: totalRejected,
    errores: totalErrors
  }, 'Resumen parcial de importacion (interrumpida)');

  try {
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.close();
      logger.info('Conexion a MongoDB cerrada correctamente');
    }
  } catch (error) {
    logger.error({ error: error.message }, 'Error cerrando conexion a MongoDB');
  }

  process.exit(0);
}

// Registrar manejadores de senales
process.on('SIGINT', () => manejarCierre('SIGINT'));
process.on('SIGTERM', () => manejarCierre('SIGTERM'));

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
// FUNCION PRINCIPAL
// ============================================================================

/**
 * Funcion principal del script
 */
async function main() {
  const args = process.argv.slice(2);

  // Mostrar ayuda
  if (args.includes('--help') || args.includes('-h')) {
    logger.info(`
Script de Importacion de Asignacion de Patinetes

Uso: node scripts/importation/importarPatinetes.js [opciones]

Opciones:
  --force         Sobrescribir datos existentes (upsert)
  --batch=N       Tamano del lote (default: ${IMPORT_CONFIG.batchSize})
  --help, -h      Mostrar esta ayuda

Ejemplos:
  node scripts/importation/importarPatinetes.js
  node scripts/importation/importarPatinetes.js --force
  node scripts/importation/importarPatinetes.js --batch=50
    `);
    return;
  }

  const options = {
    skipExisting: !args.includes('--force'),
    batchSize: parseInt(args.find(arg => arg.startsWith('--batch='))?.split('=')[1], 10) || IMPORT_CONFIG.batchSize
  };

  logger.info({
    omitirExistentes: options.skipExisting,
    tamanoLote: options.batchSize
  }, 'Iniciando script de importacion de asignacion de patinetes');

  const startTime = Date.now();
  let result;

  try {
    // Conectar a MongoDB
    logger.info('Conectando a MongoDB...');
    await connectDB(config.database.uri);
    logger.info('Conexion establecida con MongoDB');

    // Verificar modelo
    const assignmentsCount = await AsignacionPatinetes.countDocuments().maxTimeMS(10000);
    logger.info({ registrosActuales: assignmentsCount }, 'Estado actual de la coleccion de asignaciones');

    // Ejecutar importacion
    result = await importarDatosPatinetes(options);

    // Mostrar resultados finales
    logger.info({
      duracion: formatDuration(result.duration),
      velocidad: calculateProcessingSpeed(result.totalRows, result.duration),
      filasTotales: result.totalRows,
      registrosInsertados: result.insertedRecords,
      registrosActualizados: result.updatedRecords,
      registrosOmitidos: result.skippedRecords,
      registrosRechazados: result.rejectedRows,
      errores: result.errorRows
    }, 'Importacion de asignacion de patinetes completada');

    // Estadisticas finales de la base de datos
    const finalCount = await AsignacionPatinetes.countDocuments().maxTimeMS(10000);
    logger.info({ totalAsignacionesBD: finalCount }, 'Total de asignaciones en la base de datos');

    // Resumen de rechazos por tipo
    const rejectionSummary = rejectionTracker.getSortedSummary();
    if (rejectionSummary.length > 0) {
      logger.info({
        totalRechazos: rejectionTracker.totalRejected,
        desglose: rejectionSummary
      }, 'Resumen de rechazos por tipo');
    }

    // Estadisticas adicionales
    const totalPatinetes = await AsignacionPatinetes.aggregate([
      {
        $group: {
          _id: null,
          total: { $sum: '$estadisticas.totalPatinetes' }
        }
      }
    ], { maxTimeMS: 10000 });

    if (totalPatinetes.length > 0) {
      logger.info({
        totalPatinetes: totalPatinetes[0].total
      }, 'Total de patinetes registrados');
    }

  } catch (error) {
    const errorInfo = handleMongoError(error);
    logger.error({
      mensaje: error.message,
      errorInfo
    }, 'Error durante la importacion');
    process.exit(1);

  } finally {
    buildAndWriteSummary('patinetes', {
      startTime,
      counts: {
        totalProcessed: result?.totalRows || 0,
        inserted: result?.insertedRecords || 0,
        updated: result?.updatedRecords || 0,
        rejected: rejectionTracker.totalRejected,
        skipped: result?.skippedRecords || 0,
        errors: result?.errorRows || 0
      },
      rejectionTracker
    });

    if (!isShuttingDown && mongoose.connection.readyState === 1) {
      logger.info('Cerrando conexion a MongoDB...');
      try {
        await mongoose.connection.close();
        logger.info('Conexion cerrada correctamente');
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

// Ejecutar si es llamado directamente
if (require.main === module) {
  main().catch(error => {
    logger.error({ error: error.message }, 'Error fatal en script de importacion');
    process.exit(1);
  });
}

module.exports = {
  importarDatosPatinetes,
  parsearFilaAsignacion,
  REJECTION_REASONS
};
