/**
 * @fileoverview Script de importacion de ubicaciones (CSV y GPX)
 * Importa estaciones acusticas, puntos de trafico y rutas de transporte
 * @module scripts/importation/importLocations
 */

const fs = require('fs').promises;
const fsSync = require('fs');
const csv = require('csv-parser');
const path = require('path');
const mongoose = require('mongoose');
const Location = require('../../src/models/Location');
const { connectDB } = require('../../src/config/database');
const { logger } = require('../../src/config/logger');
const { handleMongoError } = require('../../src/utils/errorUtils');
const {
  LOCATION_TYPES,
  GEO_LIMITS
} = require('../../src/constants');
const {
  RejectionTracker,
  formatDuration,
  calculateProcessingSpeed
} = require('./helpers/importHelpers');

// Logger especifico para importacion
const importLogger = logger.child({ component: 'import-locations' });

// Parser para archivos GPX
const { DOMParser } = require('@xmldom/xmldom');

/**
 * Codigos de razon de rechazo para trazabilidad
 * @constant {Object}
 */
const REJECTION_REASONS = {
  MISSING_UTM_COORDS: 'COORDENADAS_UTM_INVALIDAS',
  INVALID_GEO_COORDS: 'COORDENADAS_GEOGRAFICAS_INVALIDAS',
  INVALID_GPX_COORDS: 'COORDENADAS_GPX_INVALIDAS',
  INSUFFICIENT_TRACK_POINTS: 'PUNTOS_RUTA_INSUFICIENTES',
  DUPLICATE_KEY: 'CLAVE_DUPLICADA',
  VALIDATION_ERROR: 'ERROR_VALIDACION'
};

/**
 * Bandera para indicar cierre graceful
 * @type {boolean}
 */
let isShuttingDown = false;

// Tracker de rechazos por tipo
const rejectionTracker = new RejectionTracker();

/**
 * Configuracion de importacion
 * @constant {Object}
 */
const IMPORT_CONFIG = {
  dataDirectory: path.join(__dirname, '../../datos_hpe/Ubicaciones'),
  batchSize: 500,
  maxRetries: 3,
  retryDelay: 2000,
  skipExisting: true,
  gpxFiles: [
    { file: 'Anthem_CTC_Cercanias.gpx', tipo: LOCATION_TYPES.RUTA_CERCANIAS, nombre: 'Cercanias' },
    { file: 'Anthem_CTC_Autobus.gpx', tipo: LOCATION_TYPES.RUTA_AUTOBUS, nombre: 'Autobus' },
    { file: 'Anthem_CTC_Interurbano.gpx', tipo: LOCATION_TYPES.RUTA_INTERURBANO, nombre: 'Interurbano' },
    { file: 'Anthem_CTC_Metro.gpx', tipo: LOCATION_TYPES.RUTA_METRO, nombre: 'Metro' },
    { file: 'Anthem_CTC_MetroLigero.gpx', tipo: LOCATION_TYPES.RUTA_METRO_LIGERO, nombre: 'Metro Ligero' },
    { file: 'Anthem_CTC_Taxi.gpx', tipo: LOCATION_TYPES.ZONA_TAXI, nombre: 'Zona Taxi' }
  ]
};

/**
 * Validar coordenadas geograficas
 * @param {number} lon - Longitud
 * @param {number} lat - Latitud
 * @returns {boolean} True si las coordenadas son validas
 */
function isValidCoordinate(lon, lat) {
  return (
    typeof lon === 'number' && !isNaN(lon) &&
    typeof lat === 'number' && !isNaN(lat) &&
    lon >= GEO_LIMITS.LONGITUDE_MIN && lon <= GEO_LIMITS.LONGITUDE_MAX &&
    lat >= GEO_LIMITS.LATITUDE_MIN && lat <= GEO_LIMITS.LATITUDE_MAX
  );
}

/**
 * Parsear numero de forma segura
 * @param {string|number} value - Valor a parsear
 * @param {number} defaultValue - Valor por defecto
 * @returns {number} Numero parseado o valor por defecto
 */
function parseNumber(value, defaultValue = 0) {
  if (value === null || value === undefined || value === '') {
    return defaultValue;
  }
  const num = parseFloat(String(value).replace(',', '.'));
  return isNaN(num) ? defaultValue : num;
}

/**
 * Limpiar string de forma segura
 * @param {string} value - Valor a limpiar
 * @returns {string|undefined} String limpio o undefined
 */
function cleanString(value) {
  if (value === null || value === undefined) {
    return undefined;
  }
  const cleaned = String(value).trim();
  return cleaned === '' ? undefined : cleaned;
}

/**
 * Importar estaciones de medida acustica
 * @returns {Promise<Array>} Array de estaciones procesadas
 */
async function importAcousticStations() {
  const filePath = path.join(IMPORT_CONFIG.dataDirectory, 'Anthem_CTC_EstacionesMedidaControlAcustico.csv');
  const stations = [];
  let rowIndex = 0;
  let rejectedRows = 0;

  return new Promise((resolve, reject) => {
    if (!fsSync.existsSync(filePath)) {
      importLogger.warn({ filePath }, 'Archivo de estaciones acusticas no encontrado');
      return resolve([]);
    }

    fsSync.createReadStream(filePath)
      .pipe(csv({ separator: ';' }))
      .on('data', (row) => {
        if (isShuttingDown) {return;}
        rowIndex++;

        try {
          const x = parseNumber(row.Coordenada_X_ETRS89 || row.COORDENADA_X_ETRS89 || row.X);
          const y = parseNumber(row.Coordenada_Y_ETRS89 || row.COORDENADA_Y_ETRS89 || row.Y);
          const lon = parseNumber(row.LONGITUD_WGS84 || row.longitud || row.Coordenada_X_ETRS89);
          const lat = parseNumber(row.LATITUD_WGS84 || row.latitud || row.Coordenada_Y_ETRS89);

          // Validar que tiene coordenadas UTM validas
          if (x === 0 && y === 0) {
            rejectedRows++;
            importLogger.warn(
              {
                fila: rowIndex,
                razon: REJECTION_REASONS.MISSING_UTM_COORDS,
                datosOriginales: {
                  id: row['Nº'] || row.Nº || row.id,
                  nombre: row.Nombre,
                  X: row.Coordenada_X_ETRS89,
                  Y: row.Coordenada_Y_ETRS89
                }
              },
              'Fila rechazada - estacion acustica sin coordenadas UTM'
            );
            return;
          }

          const station = {
            tipo: LOCATION_TYPES.ESTACION_ACUSTICA,
            nmt: cleanString(row['Nº'] || row.Nº || row.id),
            nombre: cleanString(row.Nombre || row.nombre) || `Estacion ${row['Nº'] || row.Nº || row.id}`,
            coordenadas: { x, y },
            distrito: cleanString(row.DISTRITO || row.distrito),
            barrio: cleanString(row.BARRIO || row.barrio),
            direccion: cleanString(row['Dirección'] || row.direccion),
            fechaAlta: cleanString(row['Fecha alta'] || row.fechaAlta),
            geometry: isValidCoordinate(lon, lat) ? {
              type: 'Point',
              coordinates: [lon, lat]
            } : undefined
          };

          // Log si no tiene geometry valido (warning informativo)
          if (!station.geometry) {
            importLogger.debug(
              {
                fila: rowIndex,
                nmt: station.nmt,
                lon,
                lat,
                detalle: 'Se insertara sin geometry GeoJSON'
              },
              'Estacion con coordenadas geograficas invalidas'
            );
          }

          stations.push(station);
        } catch (error) {
          rejectedRows++;
          importLogger.warn(
            { fila: rowIndex, razon: error.message, row },
            'Fila rechazada - error procesando estacion acustica'
          );
        }
      })
      .on('end', () => {
        importLogger.info({ count: stations.length, rechazadas: rejectedRows }, 'Estaciones acusticas procesadas');
        resolve(stations);
      })
      .on('error', (error) => {
        importLogger.error({ error: error.message }, 'Error leyendo archivo de estaciones acusticas');
        reject(error);
      });
  });
}

/**
 * Importar puntos de medida de trafico
 * @returns {Promise<Array>} Array de puntos procesados
 */
async function importTrafficPoints() {
  const filePath = path.join(IMPORT_CONFIG.dataDirectory, 'Anthem_CTC_PuntoMedidaTrafico.csv');
  const points = [];
  let rowIndex = 0;
  let rejectedRows = 0;

  return new Promise((resolve, reject) => {
    if (!fsSync.existsSync(filePath)) {
      importLogger.warn({ filePath }, 'Archivo de puntos de trafico no encontrado');
      return resolve([]);
    }

    fsSync.createReadStream(filePath)
      .pipe(csv({ separator: ';' }))
      .on('data', (row) => {
        if (isShuttingDown) {return;}
        rowIndex++;

        try {
          const utmX = parseNumber(row.utm_x);
          const utmY = parseNumber(row.utm_y);
          const lon = parseNumber(row.longitud);
          const lat = parseNumber(row.latitud);

          // Validar que tiene coordenadas UTM validas
          if (utmX === 0 && utmY === 0) {
            rejectedRows++;
            importLogger.warn(
              {
                fila: rowIndex,
                razon: REJECTION_REASONS.MISSING_UTM_COORDS,
                datosOriginales: {
                  id: row.id,
                  nombre: row.nombre,
                  utm_x: row.utm_x,
                  utm_y: row.utm_y
                }
              },
              'Fila rechazada - punto de trafico sin coordenadas UTM'
            );
            return;
          }

          const point = {
            tipo: LOCATION_TYPES.PUNTO_TRAFICO,
            cod_cent: cleanString(row.cod_cent),
            id_punto: cleanString(row.id),
            nombre: cleanString(row.nombre),
            tipo_elem: cleanString(row.tipo_elem),
            distrito: cleanString(row.distrito),
            coordenadas: { x: utmX, y: utmY },
            geometry: isValidCoordinate(lon, lat) ? {
              type: 'Point',
              coordinates: [lon, lat]
            } : undefined
          };

          // Log si no tiene geometry valido
          if (!point.geometry) {
            importLogger.debug(
              {
                fila: rowIndex,
                id: point.id_punto,
                lon,
                lat,
                detalle: 'Se insertara sin geometry GeoJSON'
              },
              'Punto de trafico con coordenadas geograficas invalidas'
            );
          }

          points.push(point);
        } catch (error) {
          rejectedRows++;
          importLogger.warn(
            { fila: rowIndex, razon: error.message, row },
            'Fila rechazada - error procesando punto de trafico'
          );
        }
      })
      .on('end', () => {
        importLogger.info({ count: points.length, rechazadas: rejectedRows }, 'Puntos de trafico procesados');
        resolve(points);
      })
      .on('error', (error) => {
        importLogger.error({ error: error.message }, 'Error leyendo archivo de puntos de trafico');
        reject(error);
      });
  });
}

/**
 * Procesar waypoints de un archivo GPX
 * @param {NodeList} waypoints - Lista de waypoints del GPX
 * @param {Object} gpxInfo - Informacion del archivo GPX
 * @param {Array} routes - Array de rutas donde agregar los resultados
 * @returns {Object} Estadisticas de procesamiento
 */
function processGPXWaypoints(waypoints, gpxInfo, routes) {
  const stats = { processed: 0, rejected: 0 };

  for (let i = 0; i < waypoints.length; i++) {
    const wp = waypoints[i];
    const lat = parseNumber(wp.getAttribute('lat'));
    const lon = parseNumber(wp.getAttribute('lon'));
    const nameElement = wp.getElementsByTagName('name')[0];
    const name = nameElement?.textContent || `${gpxInfo.nombre} ${i + 1}`;

    if (isValidCoordinate(lon, lat)) {
      routes.push({
        tipo: gpxInfo.tipo,
        nombre: cleanString(name),
        coordenadas: {
          x: lon,
          y: lat,
          ruta: [{ lat, lon }]
        },
        geometry: {
          type: 'Point',
          coordinates: [lon, lat]
        }
      });
      stats.processed++;
    } else {
      stats.rejected++;
      importLogger.warn(
        {
          archivo: gpxInfo.file,
          waypoint: i + 1,
          razon: REJECTION_REASONS.INVALID_GPX_COORDS,
          lon,
          lat,
          nombre: name
        },
        'Waypoint rechazado - coordenadas invalidas'
      );
    }
  }

  return stats;
}

/**
 * Procesar puntos de un segmento de track
 * @param {NodeList} trkpts - Lista de puntos del segmento
 * @returns {Object} Puntos validos y conteo de invalidos
 */
function processTrackSegmentPoints(trkpts) {
  const rutaPuntos = [];
  const coordinates = [];
  let invalidPoints = 0;

  for (let k = 0; k < trkpts.length; k++) {
    const pt = trkpts[k];
    const lat = parseNumber(pt.getAttribute('lat'));
    const lon = parseNumber(pt.getAttribute('lon'));

    if (isValidCoordinate(lon, lat)) {
      rutaPuntos.push({ lat, lon });
      coordinates.push([lon, lat]);
    } else {
      invalidPoints++;
    }
  }

  return { rutaPuntos, coordinates, invalidPoints };
}

/**
 * Procesar un segmento de track
 * @param {Object} segmentData - Datos del segmento procesado
 * @param {Object} gpxInfo - Informacion del archivo GPX
 * @param {number} trackIndex - Indice del track
 * @param {number} segmentIndex - Indice del segmento
 * @param {Array} routes - Array de rutas donde agregar los resultados
 * @returns {boolean} True si se proceso correctamente, false si se rechazo
 */
function processTrackSegment(segmentData, gpxInfo, trackIndex, segmentIndex, routes) {
  const { rutaPuntos, coordinates, invalidPoints } = segmentData;

  if (coordinates.length > 1) {
    routes.push({
      tipo: gpxInfo.tipo,
      nombre: `${gpxInfo.nombre} - Ruta ${trackIndex + 1}-${segmentIndex + 1}`,
      coordenadas: {
        x: coordinates[0][0],
        y: coordinates[0][1],
        ruta: rutaPuntos
      },
      geometry: {
        type: 'LineString',
        coordinates: coordinates
      }
    });

    if (invalidPoints > 0) {
      importLogger.debug(
        {
          archivo: gpxInfo.file,
          track: `${trackIndex + 1}-${segmentIndex + 1}`,
          puntosInvalidos: invalidPoints,
          puntosValidos: coordinates.length
        },
        'Track con algunos puntos invalidos omitidos'
      );
    }
    return true;
  }

  importLogger.warn(
    {
      archivo: gpxInfo.file,
      track: `${trackIndex + 1}-${segmentIndex + 1}`,
      razon: REJECTION_REASONS.INSUFFICIENT_TRACK_POINTS,
      puntosValidos: coordinates.length,
      puntosInvalidos: invalidPoints
    },
    'Track rechazado - puntos insuficientes para LineString'
  );
  return false;
}

/**
 * Procesar tracks de un archivo GPX
 * @param {NodeList} tracks - Lista de tracks del GPX
 * @param {Object} gpxInfo - Informacion del archivo GPX
 * @param {Array} routes - Array de rutas donde agregar los resultados
 * @returns {Object} Estadisticas de procesamiento
 */
function processGPXTracks(tracks, gpxInfo, routes) {
  const stats = { processed: 0, rejected: 0 };

  for (let i = 0; i < tracks.length; i++) {
    const trk = tracks[i];
    const trksegs = trk.getElementsByTagName('trkseg');

    for (let j = 0; j < trksegs.length; j++) {
      const trkpts = trksegs[j].getElementsByTagName('trkpt');
      const segmentData = processTrackSegmentPoints(trkpts);
      const success = processTrackSegment(segmentData, gpxInfo, i, j, routes);

      if (success) {
        stats.processed++;
      } else {
        stats.rejected++;
      }
    }
  }

  return stats;
}

/**
 * Importar archivos GPX (rutas de transporte)
 * @returns {Promise<Array>} Array de rutas procesadas
 */
async function importGPXRoutes() {
  const routes = [];

  for (const gpxInfo of IMPORT_CONFIG.gpxFiles) {
    if (isShuttingDown) {break;}

    const filePath = path.join(IMPORT_CONFIG.dataDirectory, gpxInfo.file);

    if (!fsSync.existsSync(filePath)) {
      importLogger.warn({ file: gpxInfo.file }, 'Archivo GPX no encontrado');
      continue;
    }

    try {
      const gpxContent = await fs.readFile(filePath, 'utf8');
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(gpxContent, 'text/xml');

      // Extraer waypoints y tracks
      const waypoints = xmlDoc.getElementsByTagName('wpt');
      const tracks = xmlDoc.getElementsByTagName('trk');

      // Procesar waypoints como puntos individuales
      const waypointStats = processGPXWaypoints(waypoints, gpxInfo, routes);

      // Procesar tracks como lineas
      const trackStats = processGPXTracks(tracks, gpxInfo, routes);

      importLogger.info({
        file: gpxInfo.file,
        waypoints: waypointStats.processed,
        waypointsRechazados: waypointStats.rejected,
        tracks: trackStats.processed,
        tracksRechazados: trackStats.rejected
      }, 'Archivo GPX procesado');

    } catch (error) {
      importLogger.error({ file: gpxInfo.file, error: error.message }, 'Error procesando archivo GPX');
    }
  }

  importLogger.info({ totalRoutes: routes.length }, 'Rutas GPX procesadas');
  return routes;
}

/**
 * Procesar un error individual de escritura de bulk
 * @param {Object} writeError - Error de escritura
 * @param {Object} failedDoc - Documento que fallo
 * @param {Object} result - Objeto de resultado para actualizar
 */
function handleWriteError(writeError, failedDoc, result) {
  const errorCode = writeError.err?.code || writeError.code;

  if (errorCode === 11000) {
    result.skipped++;
    importLogger.debug(
      {
        razon: REJECTION_REASONS.DUPLICATE_KEY,
        tipo: failedDoc?.tipo,
        nombre: failedDoc?.nombre,
        detalle: 'Combinacion tipo+nombre+coordenadas ya existe'
      },
      'Registro omitido - duplicado'
    );
  } else {
    result.errors++;
    importLogger.warn(
      {
        razon: REJECTION_REASONS.VALIDATION_ERROR,
        error: writeError.errmsg || writeError.err?.errmsg
      },
      'Registro rechazado - error de insercion'
    );
  }
}

/**
 * Procesar errores de bulk write
 * @param {Object} bulkError - Error de bulk write
 * @param {Array} batch - Lote de documentos
 * @param {Object} result - Objeto de resultado para actualizar
 */
function processBulkWriteErrors(bulkError, batch, result) {
  if (!bulkError.writeErrors) {
    return;
  }

  for (const writeError of bulkError.writeErrors) {
    const operationIndex = writeError.index;
    const failedDoc = batch[operationIndex];
    handleWriteError(writeError, failedDoc, result);
  }
}

/**
 * Procesar lote con insercion (skip existing)
 * @param {Array} batch - Lote de documentos
 * @param {Object} result - Objeto de resultado
 * @returns {Promise<Object>}
 */
async function processBatchInsert(batch, result) {
  const operations = batch.map(location => ({
    insertOne: { document: location }
  }));

  try {
    const bulkResult = await Location.bulkWrite(operations, {
      ordered: false,
      bypassDocumentValidation: false
    });
    result.inserted = bulkResult.insertedCount || 0;
  } catch (bulkError) {
    if (!bulkError.writeErrors) {
      throw bulkError;
    }
    processBulkWriteErrors(bulkError, batch, result);

    // Calcular inserciones exitosas
    result.inserted = batch.length - result.skipped - result.errors;
  }

  return result;
}

/**
 * Procesar lote con upsert (force mode)
 * @param {Array} batch - Lote de documentos
 * @param {Object} result - Objeto de resultado
 * @returns {Promise<Object>}
 */
async function processBatchUpsert(batch, result) {
  const operations = batch.map(location => ({
    updateOne: {
      filter: {
        tipo: location.tipo,
        nombre: location.nombre,
        'coordenadas.x': location.coordenadas.x,
        'coordenadas.y': location.coordenadas.y
      },
      update: { $set: location },
      upsert: true
    }
  }));

  const bulkResult = await Location.bulkWrite(operations, {
    ordered: false,
    bypassDocumentValidation: false
  });

  result.inserted = (bulkResult.upsertedCount || 0) + (bulkResult.modifiedCount || 0);
  result.skipped = (bulkResult.matchedCount || 0) - (bulkResult.modifiedCount || 0);

  return result;
}

/**
 * Procesar lote de ubicaciones con bulkWrite optimizado
 * @param {Array} batch - Lote de ubicaciones
 * @param {Object} stats - Estadisticas de procesamiento
 * @param {boolean} skipExisting - Si true, omite registros existentes
 * @returns {Promise<Object>} Resultado de la operacion
 */
async function processBatch(batch, stats, skipExisting) {
  const result = { inserted: 0, skipped: 0, errors: 0 };

  try {
    if (skipExisting) {
      await processBatchInsert(batch, result);
    } else {
      await processBatchUpsert(batch, result);
    }

    return result;
  } catch (error) {
    const handledError = handleMongoError(error);
    importLogger.error({ error: handledError.message }, 'Error en lote de ubicaciones');
    result.errors = batch.length;
    return result;
  }
}

/**
 * Funcion principal de importacion
 * @param {Object} options - Opciones de importacion
 * @returns {Promise<Object>} Estadisticas finales
 */
async function importAllLocations(options = {}) {
  const importConfig = { ...IMPORT_CONFIG, ...options };

  importLogger.info({
    dataDirectory: importConfig.dataDirectory,
    batchSize: importConfig.batchSize,
    skipExisting: importConfig.skipExisting
  }, 'Iniciando importacion de ubicaciones');

  const stats = {
    startTime: Date.now(),
    acousticStations: { total: 0, inserted: 0, skipped: 0, errors: 0 },
    trafficPoints: { total: 0, inserted: 0, skipped: 0, errors: 0 },
    transportRoutes: { total: 0, inserted: 0, skipped: 0, errors: 0 },
    totalInserted: 0,
    totalSkipped: 0,
    totalErrors: 0
  };

  try {
    // Importar datos en paralelo
    importLogger.info('Iniciando procesamiento de archivos...');

    const [acousticStations, trafficPoints, transportRoutes] = await Promise.all([
      importAcousticStations(),
      importTrafficPoints(),
      importGPXRoutes()
    ]);

    if (isShuttingDown) {
      importLogger.warn('Importacion interrumpida por senal de cierre');
      return stats;
    }

    stats.acousticStations.total = acousticStations.length;
    stats.trafficPoints.total = trafficPoints.length;
    stats.transportRoutes.total = transportRoutes.length;

    // Combinar todos los datos
    const allLocations = [
      ...acousticStations,
      ...trafficPoints,
      ...transportRoutes
    ];

    if (allLocations.length === 0) {
      importLogger.warn('No se encontraron datos para importar');
      return stats;
    }

    importLogger.info({
      acousticStations: acousticStations.length,
      trafficPoints: trafficPoints.length,
      transportRoutes: transportRoutes.length,
      total: allLocations.length
    }, 'Datos preparados para insercion');

    // Insertar en lotes
    const batchSize = importConfig.batchSize;

    // Procesar por tipo para mejor seguimiento
    const locationsByType = [
      { name: 'estaciones acusticas', data: acousticStations, statsKey: 'acousticStations' },
      { name: 'puntos de trafico', data: trafficPoints, statsKey: 'trafficPoints' },
      { name: 'rutas de transporte', data: transportRoutes, statsKey: 'transportRoutes' }
    ];

    for (const locationType of locationsByType) {
      if (isShuttingDown || locationType.data.length === 0) {continue;}

      importLogger.info({ tipo: locationType.name, total: locationType.data.length }, 'Insertando tipo de ubicacion');

      for (let i = 0; i < locationType.data.length && !isShuttingDown; i += batchSize) {
        const batch = locationType.data.slice(i, i + batchSize);
        const batchNumber = Math.floor(i / batchSize) + 1;
        const totalTypeBatches = Math.ceil(locationType.data.length / batchSize);

        const result = await processBatch(batch, stats, importConfig.skipExisting);

        stats[locationType.statsKey].inserted += result.inserted;
        stats[locationType.statsKey].skipped += result.skipped;
        stats[locationType.statsKey].errors += result.errors;

        importLogger.debug({
          tipo: locationType.name,
          lote: `${batchNumber}/${totalTypeBatches}`,
          inserted: result.inserted,
          skipped: result.skipped
        }, 'Lote procesado');
      }
    }

    // Calcular totales
    stats.totalInserted = stats.acousticStations.inserted + stats.trafficPoints.inserted + stats.transportRoutes.inserted;
    stats.totalSkipped = stats.acousticStations.skipped + stats.trafficPoints.skipped + stats.transportRoutes.skipped;
    stats.totalErrors = stats.acousticStations.errors + stats.trafficPoints.errors + stats.transportRoutes.errors;

    stats.endTime = Date.now();
    stats.duration = stats.endTime - stats.startTime;

    return stats;

  } catch (error) {
    const handledError = handleMongoError(error);
    importLogger.error({ error: handledError.message }, 'Error en importacion de ubicaciones');
    throw error;
  }
}

/**
 * Generar resumen estadistico post-importacion
 * @returns {Promise<void>}
 */
async function generatePostImportSummary() {
  importLogger.info('Generando resumen estadistico de ubicaciones...');

  try {
    const totalRecords = await Location.countDocuments().maxTimeMS(10000);

    // Distribucion por tipo
    const typeDistribution = await Location.aggregate([
      {
        $group: {
          _id: '$tipo',
          totalRegistros: { $sum: 1 }
        }
      },
      { $sort: { totalRegistros: -1 } }
    ]).maxTimeMS(15000);

    // Distribucion por distrito (solo para los que tienen)
    const districtDistribution = await Location.aggregate([
      { $match: { distrito: { $exists: true, $ne: null } } },
      {
        $group: {
          _id: '$distrito',
          totalRegistros: { $sum: 1 },
          tipos: { $addToSet: '$tipo' }
        }
      },
      { $sort: { totalRegistros: -1 } },
      { $limit: 10 }
    ]).maxTimeMS(15000);

    // Conteo de geometrias
    const geometryStats = await Location.aggregate([
      {
        $group: {
          _id: '$geometry.type',
          total: { $sum: 1 }
        }
      },
      { $sort: { total: -1 } }
    ]).maxTimeMS(10000);

    importLogger.info({
      totalRegistros: totalRecords,
      distribucionPorTipo: typeDistribution.map(t => ({
        tipo: t._id,
        registros: t.totalRegistros
      })),
      distribucionPorDistrito: districtDistribution.map(d => ({
        distrito: d._id,
        registros: d.totalRegistros,
        tipos: d.tipos.length
      })),
      geometrias: geometryStats.map(g => ({
        tipo: g._id || 'Sin geometria',
        total: g.total
      }))
    }, 'Resumen estadistico de ubicaciones');

  } catch (error) {
    importLogger.error({ error: error.message }, 'Error generando resumen estadistico');
  }
}

/**
 * Cerrar conexion de forma segura
 * @returns {Promise<void>}
 */
async function closeConnection() {
  if (mongoose.connection.readyState !== 0) {
    importLogger.info('Cerrando conexion a MongoDB...');
    try {
      await mongoose.connection.close();
      importLogger.info('Conexion cerrada correctamente');
    } catch (error) {
      importLogger.error({ error: error.message }, 'Error cerrando conexion');
    }
  }
}

/**
 * Funcion principal del script
 * @returns {Promise<void>}
 */
async function main() {
  const args = process.argv.slice(2);
  const options = {
    skipExisting: !args.includes('--force'),
    batchSize: parseInt(args.find(arg => arg.startsWith('--batch='))?.split('=')[1], 10) || IMPORT_CONFIG.batchSize,
    generateSummary: !args.includes('--no-summary'),
    clearExisting: args.includes('--clear')
  };

  importLogger.info({
    options: {
      skipExisting: options.skipExisting,
      batchSize: options.batchSize,
      generateSummary: options.generateSummary,
      clearExisting: options.clearExisting
    }
  }, 'Script de importacion de ubicaciones iniciado');

  // Configurar manejadores de senales para cierre graceful
  const handleSignal = async (signal) => {
    importLogger.warn({ signal }, 'Senal recibida, cerrando conexiones...');
    isShuttingDown = true;
    await closeConnection();
    process.exit(0);
  };

  process.on('SIGINT', () => handleSignal('SIGINT'));
  process.on('SIGTERM', () => handleSignal('SIGTERM'));

  try {
    // Conectar a MongoDB
    importLogger.info('Conectando a MongoDB...');
    await connectDB();
    importLogger.info('Conexion establecida');

    // Verificar estado actual
    const currentCount = await Location.countDocuments().maxTimeMS(10000);
    importLogger.info({ registrosActuales: currentCount }, 'Estado actual de la base de datos');

    // Limpiar coleccion si se solicita
    if (options.clearExisting) {
      importLogger.warn('Limpiando coleccion existente...');
      await Location.deleteMany({});
      importLogger.info('Coleccion limpiada');
    }

    // Ejecutar importacion
    const result = await importAllLocations(options);

    if (isShuttingDown) {
      importLogger.warn('Importacion interrumpida por senal de cierre');
    } else {
      // Mostrar resultados finales
      const finalCount = await Location.countDocuments().maxTimeMS(10000);

      importLogger.info({
        duracion: formatDuration(result.duration),
        velocidad: calculateProcessingSpeed(result.totalInserted + result.totalSkipped, result.duration),
        estacionesAcusticas: {
          total: result.acousticStations.total,
          insertadas: result.acousticStations.inserted,
          omitidas: result.acousticStations.skipped,
          errores: result.acousticStations.errors
        },
        puntosTrafico: {
          total: result.trafficPoints.total,
          insertados: result.trafficPoints.inserted,
          omitidos: result.trafficPoints.skipped,
          errores: result.trafficPoints.errors
        },
        rutasTransporte: {
          total: result.transportRoutes.total,
          insertadas: result.transportRoutes.inserted,
          omitidas: result.transportRoutes.skipped,
          errores: result.transportRoutes.errors
        },
        totales: {
          insertados: result.totalInserted,
          omitidos: result.totalSkipped,
          errores: result.totalErrors
        },
        totalEnBD: finalCount
      }, 'Importacion de ubicaciones completada');

      // Resumen de rechazos por tipo
      const rejectionSummary = rejectionTracker.getSortedSummary();
      if (rejectionSummary.length > 0) {
        importLogger.info({
          totalRechazos: rejectionTracker.totalRejected,
          desglose: rejectionSummary
        }, 'Resumen de rechazos por tipo');
      }

      // Generar resumen estadistico adicional
      if (options.generateSummary) {
        await generatePostImportSummary();
      }
    }

  } catch (error) {
    const handledError = handleMongoError(error);
    importLogger.error({
      error: handledError.message,
      stack: error.stack
    }, 'Error durante la importacion');
    process.exitCode = 1;

  } finally {
    await closeConnection();
  }

  importLogger.info('Script completado');
}

/**
 * Manejador de cierre graceful
 * @param {string} signal - Senal recibida
 */
function handleShutdown(signal) {
  importLogger.warn({ signal }, 'Senal recibida, iniciando cierre...');
  isShuttingDown = true;
  closeConnection().then(() => process.exit(0));
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

// Ejecutar si es llamado directamente
if (require.main === module) {
  main().catch(error => {
    importLogger.fatal({ error: error.message }, 'Error fatal');
    process.exit(1);
  });
}

module.exports = {
  importAllLocations,
  importAcousticStations,
  importTrafficPoints,
  importGPXRoutes,
  REJECTION_REASONS
};
