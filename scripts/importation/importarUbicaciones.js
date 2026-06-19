/**
 * @fileoverview Script de importacion de ubicaciones (CSV y GPX)
 * Importa estaciones acusticas, puntos de trafico y rutas de transporte
 * @module scripts/importation/importarUbicaciones
 */

process.env.SCRIPT_MODE = 'true';

const fs = require('fs').promises;
const fsSync = require('fs');
const csv = require('csv-parser');
const path = require('path');
const mongoose = require('mongoose');
const Location = require('../../src/models/Ubicacion');
const { connectDB } = require('../../src/config/database');
const config = require('../../src/config/config');
const { importarUbicacionesLogger: logger } = require('../../src/config/scriptLogger');
const { handleMongoError } = require('../../src/utils/errorUtils');
const {
  LOCATION_TYPES,
  GEO_LIMITS,
  GEOMETRY_TYPES
} = require('../../src/constants');
const {
  RejectionTracker,
  formatDuration,
  calculateProcessingSpeed,
  buildAndWriteSummary
} = require('./helpers/importHelpers');
const { normalizarTexto, crearLectorCSV } = require('./helpers/normalizarEncoding');
const { extraerCoordenadasModulo } = require('./helpers/coordenadas');

// Parser para archivos GPX
const { DOMParser } = require('@xmldom/xmldom');

/**
 * Codigos de razon de rechazo para trazabilidad
 * @constant {Object}
 */
const REJECTION_REASONS = {
  EMPTY_ROW: 'FILA_VACIA',
  MISSING_UTM_COORDS: 'COORDENADAS_UTM_INVALIDAS',
  INVALID_GEO_COORDS: 'COORDENADAS_GEOGRAFICAS_INVALIDAS',
  INVALID_GPX_COORDS: 'COORDENADAS_GPX_INVALIDAS',
  INSUFFICIENT_TRACK_POINTS: 'PUNTOS_RUTA_INSUFICIENTES',
  DUPLICATE_KEY: 'CLAVE_DUPLICADA',
  VALIDATION_ERROR: 'ERROR_VALIDACION'
};

/**
 * Detectar fila completamente vacia (todos los campos blancos).
 * Comun en CSVs exportados desde Excel/Access que tienen padding al final
 * del archivo. Sin esta deteccion, el script las reporta como
 * COORDENADAS_UTM_INVALIDAS, lo cual es engañoso para diagnostico.
 *
 * @param {Object} row - Fila parseada del CSV
 * @returns {boolean}
 */
function isEmptyRow(row) {
  if (!row || typeof row !== 'object') {
    return true;
  }
  for (const value of Object.values(row)) {
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      return false;
    }
  }
  return true;
}

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
  batchSize: 250,
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
      logger.warn({ filePath }, 'Archivo de estaciones acusticas no encontrado');
      return resolve([]);
    }

    crearLectorCSV(filePath)
      .pipe(csv({ separator: ';' }))
      .on('data', (row) => {
        if (isShuttingDown) {return;}
        rowIndex++;

        try {
          // Filas vacias: padding del export (Excel/Access). Detectarlas antes
          // que UTM=0 para no contaminar el desglose con falsos
          // COORDENADAS_UTM_INVALIDAS.
          if (isEmptyRow(row)) {
            rejectedRows++;
            const razon = REJECTION_REASONS.EMPTY_ROW;
            const nivel = rejectionTracker.shouldLogWarn(razon, { fila: rowIndex }) ? 'warn' : 'debug';
            logger[nivel]({ fila: rowIndex, razon }, 'Fila rechazada: fila vacia');
            return;
          }

          // Coordenadas via framework unificado.
          // Perfil 'ubicaciones_estacion_acustica': UTM ETRS89 (m) +
          // WGS84 directo, prioriza WGS84, requerida=true.
          let coords;
          try {
            coords = extraerCoordenadasModulo(row, 'ubicaciones_estacion_acustica');
          } catch {
            rejectedRows++;
            logger.warn(
              {
                fila: rowIndex,
                razon: REJECTION_REASONS.MISSING_UTM_COORDS,
                datosOriginales: {
                  id: row['Nº'] || row.Nº || row.id,
                  nombre: row.Nombre,
                  X: row.Coordenada_X_ETRS89,
                  Y: row.Coordenada_Y_ETRS89,
                  LON: row.LONGITUD_WGS84,
                  LAT: row.LATITUD_WGS84
                }
              },
              'Fila rechazada - estacion acustica sin coordenadas validas'
            );
            return;
          }

          // El campo NMT puede tener encoding corrupto (N°, Nº, N�)
          const nmtValue = row['Nº'] || row.Nº || row['N°'] || row['N\uFFFD'] || row.id;
          const nmtNormalizado = normalizarTexto(nmtValue);

          const station = {
            tipo: LOCATION_TYPES.ESTACION_ACUSTICA,
            nmt: nmtNormalizado,
            nombre: normalizarTexto(row.Nombre || row.nombre) || `Estacion ${nmtNormalizado}`,
            coordenadas: coords.utm || undefined,
            direccion: normalizarTexto(row['Dirección'] || row.direccion || row['Direcci\uFFFD\n']) || undefined,
            fechaAlta: normalizarTexto(row['Fecha alta'] || row.fechaAlta) || undefined,
            geometry: coords.geometry
          };

          stations.push(station);
        } catch (error) {
          rejectedRows++;
          logger.warn(
            { fila: rowIndex, razon: error.message, row },
            'Fila rechazada - error procesando estacion acustica'
          );
        }
      })
      .on('end', () => {
        logger.info({ count: stations.length, rechazadas: rejectedRows }, 'Estaciones acusticas procesadas');
        resolve(stations);
      })
      .on('error', (error) => {
        logger.error({ error: error.message }, 'Error leyendo archivo de estaciones acusticas');
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
    let resolved = false; // Bandera para evitar resolve multiple

    // Timeout de seguridad: 60 segundos. Si se dispara, abortamos en lugar de
    // resolver con datos parciales. Datos incompletos en Fase 1 corrompen integridad
    // referencial de los importadores de Fase 2 que dependen de estos puntos
    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        const errorMessage = `TIMEOUT procesando puntos de trafico tras 60s. Filas leidas: ${rowIndex}, validas: ${points.length}, rechazadas: ${rejectedRows}. Abortando para evitar datos parciales en BD`;
        logger.error({
          count: points.length,
          rechazadas: rejectedRows,
          fila: rowIndex
        }, errorMessage);
        reject(new Error(errorMessage));
      }
    }, 60000);

    if (!fsSync.existsSync(filePath)) {
      clearTimeout(timeout);
      logger.warn({ filePath }, 'Archivo de puntos de trafico no encontrado');
      return resolve([]);
    }

    crearLectorCSV(filePath)
      // mapHeaders strippea BOM UTF-8 (EF BB BF) que al leerse como latin1
      // se convierte en "ï»¿" pegado al nombre de la primera columna.
      // Sin esto row.tipo_elem === undefined para las 4373 filas (la clave
      // real seria "ï»¿tipo_elem") y se pierde el campo enum URB/M30.
      .pipe(csv({
        separator: ';',
        mapHeaders: ({ header }) => header.replace(/^[\uFEFFï»¿]+/, '')
      }))
      .on('data', (row) => {
        if (isShuttingDown) {return;}
        rowIndex++;

        try {
          // Filas vacias: padding del export. En este CSV concretamente
          // ~92% de las "filas" son padding completamente blanco.
          if (isEmptyRow(row)) {
            rejectedRows++;
            const razon = REJECTION_REASONS.EMPTY_ROW;
            const nivel = rejectionTracker.shouldLogWarn(razon, { fila: rowIndex }) ? 'warn' : 'debug';
            logger[nivel]({ fila: rowIndex, razon }, 'Fila rechazada: fila vacia');
            return;
          }

          // Coordenadas via framework. Perfil 'ubicaciones_punto_trafico':
          // UTM (m) + WGS84 directo, prioriza WGS84, requerida=false
          // (muchos puntos del CSV no tienen coords validas).
          let coords;
          try {
            coords = extraerCoordenadasModulo(row, 'ubicaciones_punto_trafico');
          } catch {
            coords = null;
          }

          if (!coords) {
            rejectedRows++;
            logger.debug(
              {
                fila: rowIndex,
                razon: REJECTION_REASONS.MISSING_UTM_COORDS,
                id: row.id
              },
              'Fila rechazada - punto de trafico sin coordenadas validas'
            );
            return;
          }

          const point = {
            tipo: LOCATION_TYPES.PUNTO_TRAFICO,
            cod_cent: normalizarTexto(row.cod_cent) || undefined,
            id_punto: normalizarTexto(row.id) || undefined,
            nombre: normalizarTexto(row.nombre) || undefined,
            tipo_elem: normalizarTexto(row.tipo_elem) || undefined,
            distrito: parseNumber(row.distrito) || undefined, // Codigo de distrito (1-21)
            coordenadas: coords.utm || undefined,
            geometry: coords.geometry
          };

          points.push(point);
        } catch (error) {
          rejectedRows++;
          logger.warn(
            { fila: rowIndex, razon: error.message, row },
            'Fila rechazada - error procesando punto de trafico'
          );
        }
      })
      .on('end', () => {
        clearTimeout(timeout);
        resolved = true;
        logger.info({ count: points.length, rechazadas: rejectedRows }, 'Puntos de trafico procesados');
        resolve(points);
      })
      .on('error', (error) => {
        clearTimeout(timeout);
        if (!resolved) {
          resolved = true;
          logger.error({ error: error.message }, 'Error leyendo archivo de puntos de trafico');
          reject(error);
        }
      })
      .on('close', () => {
        clearTimeout(timeout);
        // Si el stream se cierra sin 'end' ni 'error', resolver con lo que tenemos
        if (!resolved) {
          resolved = true;
          logger.warn({ count: points.length, rechazadas: rejectedRows }, 'Stream cerrado prematuramente - usando datos parciales');
          resolve(points);
        }
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
      // Convertir lat/lon a UTM para coordenadas
      const utm = latLonToUTM30N(lat, lon);

      routes.push({
        tipo: gpxInfo.tipo,
        nombre: normalizarTexto(name) || `${gpxInfo.nombre} ${i + 1}`,
        coordenadas: {
          x: utm.x, // Coordenadas UTM en metros
          y: utm.y
        },
        // Campo 'ruta' a nivel raiz (para waypoints, es un solo punto)
        ruta: [{ lat, lon }],
        geometry: {
          type: GEOMETRY_TYPES.POINT,
          coordinates: [lon, lat] // GeoJSON usa lon/lat (WGS84)
        }
      });
      stats.processed++;
    } else {
      stats.rejected++;
      logger.warn(
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
 * Convertir coordenadas lat/lon (WGS84) a UTM zona 30N
 * Formula simplificada para España peninsular
 * @param {number} lat - Latitud en grados
 * @param {number} lon - Longitud en grados
 * @returns {{x: number, y: number}} Coordenadas UTM en metros
 */
function latLonToUTM30N(lat, lon) {
  // Constantes WGS84
  const a = 6378137.0; // Semi-eje mayor
  const e = 0.081819191; // Excentricidad
  const e2 = e * e;
  const k0 = 0.9996; // Factor de escala
  const lon0 = -3; // Meridiano central zona 30N
  const x0 = 500000; // False Easting
  const y0 = 0; // False Northing

  // Convertir a radianes
  const latRad = lat * Math.PI / 180;
  const lonRad = lon * Math.PI / 180;
  const lon0Rad = lon0 * Math.PI / 180;

  // Calculos intermedios
  const N = a / Math.sqrt(1 - e2 * Math.sin(latRad) * Math.sin(latRad));
  const T = Math.tan(latRad) * Math.tan(latRad);
  const C = (e2 / (1 - e2)) * Math.cos(latRad) * Math.cos(latRad);
  const A = (lonRad - lon0Rad) * Math.cos(latRad);

  // Meridiano
  const M = a * (
    (1 - e2/4 - 3*e2*e2/64 - 5*e2*e2*e2/256) * latRad -
    (3*e2/8 + 3*e2*e2/32 + 45*e2*e2*e2/1024) * Math.sin(2*latRad) +
    (15*e2*e2/256 + 45*e2*e2*e2/1024) * Math.sin(4*latRad) -
    (35*e2*e2*e2/3072) * Math.sin(6*latRad)
  );

  // Coordenadas UTM
  const x = x0 + k0 * N * (
    A + (1 - T + C) * A*A*A / 6 +
    (5 - 18*T + T*T + 72*C - 58*(e2/(1-e2))) * A*A*A*A*A / 120
  );

  const y = y0 + k0 * (
    M + N * Math.tan(latRad) * (
      A*A / 2 + (5 - T + 9*C + 4*C*C) * A*A*A*A / 24 +
      (61 - 58*T + T*T + 600*C - 330*(e2/(1-e2))) * A*A*A*A*A*A / 720
    )
  );

  return { x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100 };
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
    // Convertir primer punto (lat/lon) a UTM para coordenadas
    const firstLon = coordinates[0][0];
    const firstLat = coordinates[0][1];
    const utm = latLonToUTM30N(firstLat, firstLon);

    routes.push({
      tipo: gpxInfo.tipo,
      nombre: `${gpxInfo.nombre} - Ruta ${trackIndex + 1}-${segmentIndex + 1}`,
      coordenadas: {
        x: utm.x, // Coordenadas UTM en metros
        y: utm.y
      },
      // Campo 'ruta' a nivel raiz con todos los puntos lat/lon
      ruta: rutaPuntos,
      geometry: {
        type: GEOMETRY_TYPES.LINE_STRING,
        coordinates: coordinates // GeoJSON usa lon/lat (WGS84)
      }
    });

    if (invalidPoints > 0) {
      logger.debug(
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

  logger.warn(
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
      logger.warn({ file: gpxInfo.file }, 'Archivo GPX no encontrado');
      continue;
    }

    try {
      const gpxContent = await fs.readFile(filePath, 'latin1');
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(gpxContent, 'text/xml');

      // REALIDAD DEL DATO: los 6 GPX de transporte de Anthem contienen
      // UNICAMENTE waypoints (<wpt>, cada uno es una PARADA, p.ej. "C-1 ATOCHA")
      // y CERO tracks (<trk>/<trkseg>) o rutas (<rte>). Por tanto todas las
      // entradas de transporte se almacenan como geometria Point (paradas), NO
      // como LineString. El parseo de tracks de abajo es codigo FORWARD-
      // COMPATIBLE: solo se ejecuta si una fuente GPX futura trae <trk>; con los
      // datos actuales nunca genera geometria de linea. NO se generan LineStrings
      // sinteticos conectando paradas porque el orden de los <wpt> no garantiza
      // el trazado real de la linea (produciria geometria falsa).
      const waypoints = xmlDoc.getElementsByTagName('wpt');
      const tracks = xmlDoc.getElementsByTagName('trk');

      // Procesar waypoints como puntos individuales (paradas)
      const waypointStats = processGPXWaypoints(waypoints, gpxInfo, routes);

      // Procesar tracks como lineas (forward-compatible; vacio con los GPX actuales)
      const trackStats = processGPXTracks(tracks, gpxInfo, routes);



      logger.info({
        file: gpxInfo.file,
        waypoints: waypointStats.processed,
        waypointsRechazados: waypointStats.rejected,
        tracks: trackStats.processed,
        tracksRechazados: trackStats.rejected
      }, 'Archivo GPX procesado');

    } catch (error) {
      logger.error({ file: gpxInfo.file, error: error.message }, 'Error procesando archivo GPX');
    }
  }

  logger.info({ totalRoutes: routes.length }, 'Rutas GPX procesadas');
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
    logger.debug(
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
    logger.warn(
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

    // Log resultado del bulkWrite (simplificado)
    logger.debug({
      batchSize: batch.length,
      insertedCount: bulkResult.insertedCount,
      ok: bulkResult.ok
    }, 'Lote insertado correctamente');

    // Usar el campo correcto según la respuesta
    result.inserted = bulkResult.insertedCount || bulkResult.nInserted || 0;
  } catch (bulkError) {
    // Log del error completo
    logger.error({
      errorName: bulkError.name,
      errorMessage: bulkError.message,
      writeErrorsCount: bulkError.writeErrors?.length || 0,
      primerosErrores: bulkError.writeErrors?.slice(0, 3).map(e => ({
        index: e.index,
        code: e.code,
        errmsg: e.errmsg
      }))
    }, 'Error en bulkWrite');

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
    logger.error({ error: handledError.message }, 'Error en lote de ubicaciones');
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

  logger.info({
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
    logger.info('Iniciando procesamiento de archivos...');

    const [acousticStations, trafficPoints, transportRoutes] = await Promise.all([
      importAcousticStations(),
      importTrafficPoints(),
      importGPXRoutes()
    ]);

    if (isShuttingDown) {
      logger.warn('Importacion interrumpida por senal de cierre');
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
      logger.warn('No se encontraron datos para importar');
      return stats;
    }

    logger.info({
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

      logger.info({ tipo: locationType.name, total: locationType.data.length }, 'Insertando tipo de ubicacion');

      for (let i = 0; i < locationType.data.length && !isShuttingDown; i += batchSize) {
        const batch = locationType.data.slice(i, i + batchSize);
        const batchNumber = Math.floor(i / batchSize) + 1;
        const totalTypeBatches = Math.ceil(locationType.data.length / batchSize);

        const result = await processBatch(batch, stats, importConfig.skipExisting);

        stats[locationType.statsKey].inserted += result.inserted;
        stats[locationType.statsKey].skipped += result.skipped;
        stats[locationType.statsKey].errors += result.errors;

        logger.debug({
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
    logger.error({ error: handledError.message }, 'Error en importacion de ubicaciones');
    throw error;
  }
}

/**
 * Generar resumen estadistico post-importacion
 * @returns {Promise<void>}
 */
async function generatePostImportSummary() {
  logger.info('Generando resumen estadistico de ubicaciones...');

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
    ], { maxTimeMS: 15000 });

    // Conteo de geometrias
    const geometryStats = await Location.aggregate([
      {
        $group: {
          _id: '$geometry.type',
          total: { $sum: 1 }
        }
      },
      { $sort: { total: -1 } }
    ], { maxTimeMS: 10000 });

    logger.info({
      totalRegistros: totalRecords,
      distribucionPorTipo: typeDistribution.map(t => ({
        tipo: t._id,
        registros: t.totalRegistros
      })),
      geometrias: geometryStats.map(g => ({
        tipo: g._id || 'Sin geometria',
        total: g.total
      }))
    }, 'Resumen estadistico de ubicaciones');

  } catch (error) {
    logger.error({ error: error.message }, 'Error generando resumen estadistico');
  }
}

/**
 * Cerrar conexion de forma segura
 * @returns {Promise<void>}
 */
async function closeConnection() {
  if (mongoose.connection.readyState !== 0) {
    logger.info('Cerrando conexion a MongoDB...');
    try {
      await mongoose.connection.close();
      logger.info('Conexion cerrada correctamente');
    } catch (error) {
      logger.error({ error: error.message }, 'Error cerrando conexion');
    }
  }
}

/**
 * Funcion principal del script
 * @returns {Promise<void>}
 */
async function main() {
  // Marcar que estamos en modo script para evitar reintentos automáticos
  process.env.SCRIPT_MODE = 'true';
  const startTime = Date.now();

  const args = process.argv.slice(2);
  const options = {
    skipExisting: !args.includes('--force'),
    batchSize: parseInt(args.find(arg => arg.startsWith('--batch='))?.split('=')[1], 10) || IMPORT_CONFIG.batchSize,
    generateSummary: !args.includes('--no-summary'),
    clearExisting: args.includes('--clear')
  };

  logger.info({
    options: {
      skipExisting: options.skipExisting,
      batchSize: options.batchSize,
      generateSummary: options.generateSummary,
      clearExisting: options.clearExisting
    }
  }, 'Script de importacion de ubicaciones iniciado');

  // Variable para rastrear si ya se está cerrando
  let isClosing = false;

  // Configurar manejadores de senales para cierre graceful
  const handleSignal = async (signal) => {
    if (isClosing) {
      return;
    }

    isClosing = true;

    logger.warn({ signal }, 'Senal recibida, cerrando conexiones...');
    isShuttingDown = true;
    await closeConnection();
    process.exit(0);
  };

  process.once('SIGINT', () => handleSignal('SIGINT'));
  process.once('SIGTERM', () => handleSignal('SIGTERM'));

  try {
    // Conectar a MongoDB
    logger.info('Conectando a MongoDB...');
    await connectDB(config.database.uri);
    logger.info('Conexion establecida');

    // Verificar estado actual
    const currentCount = await Location.countDocuments().maxTimeMS(10000);
    logger.info({ registrosActuales: currentCount }, 'Estado actual de la base de datos');

    // Limpiar coleccion si se solicita
    if (options.clearExisting) {
      logger.warn('Limpiando coleccion existente...');
      await Location.deleteMany({});
      logger.info('Coleccion limpiada');
    }

    // Ejecutar importacion
    const result = await importAllLocations(options);

    if (isShuttingDown) {
      logger.warn('Importacion interrumpida por senal de cierre');
    } else {
      // Mostrar resultados finales
      const finalCount = await Location.countDocuments().maxTimeMS(10000);

      logger.info({
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
        logger.info({
          totalRechazos: rejectionTracker.totalRejected,
          desglose: rejectionSummary
        }, 'Resumen de rechazos por tipo');
      }

      // Resumen estructurado a logs/import/<importer>-latest.json
      buildAndWriteSummary('ubicaciones', {
        startTime,
        counts: {
          totalProcessed: result.totalInserted + result.totalSkipped + result.totalErrors + rejectionTracker.totalRejected,
          inserted: result.totalInserted,
          rejected: rejectionTracker.totalRejected,
          skipped: result.totalSkipped,
          errors: result.totalErrors
        },
        rejectionTracker,
        extras: {
          desgloseFuentes: {
            estacionesAcusticas: result.acousticStations,
            puntosTrafico: result.trafficPoints,
            rutasTransporte: result.transportRoutes
          },
          totalEnBD: finalCount
        }
      });

      // Generar resumen estadistico adicional
      if (options.generateSummary) {
        await generatePostImportSummary();
      }
    }

  } catch (error) {
    const handledError = handleMongoError(error);
    logger.error({
      error: handledError.message,
      stack: error.stack,
      name: error.name
    }, 'Error durante la importacion');
    process.exitCode = 1;

  } finally {
    await closeConnection();

    // Respetar el exit code establecido por el catch
    logger.info('Script completado');
    if (process.exitCode === 1) {
      process.exit(1);
    } else {
      process.exit(0);
    }
  }
}

// Ejecutar si es llamado directamente
if (require.main === module) {
  main().catch(async (error) => {
    logger.fatal({ error: error.message }, 'Error fatal');
    await closeConnection();
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
