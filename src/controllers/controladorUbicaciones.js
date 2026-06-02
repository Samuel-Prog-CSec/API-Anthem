const Location = require('../models/Ubicacion');
const { createBadRequestError } = require('../utils/errorUtils');
const { createPaginationMeta } = require('../utils/paginationHelper');
const { buildFilters, buildPaginationOptions } = require('../utils/queryHelper');
const { createResponse } = require('../utils/responseHelper');
const { documentosAFeatureCollection } = require('../utils/geoJsonHelper');
const { SPECIAL_PAGINATION_LIMITS, MONGODB_TIMEOUTS, MEASUREMENT_POINT_TYPES, TRANSPORT_ROUTE_TYPES, LOCATION_TYPES } = require('../constants');
const asyncHandler = require('../utils/asyncHandler');
const logger = require('../config/logger');

/**
 * Obtener todas las ubicaciones con filtros
 * @route GET /api/v1/ubicaciones
 */
const obtenerUbicaciones = asyncHandler(async (req, res, next) => {
  const {
    bbox, // bounding box UTM: "minX,minY,maxX,maxY" (coordenadas UTM en metros)
    near // busqueda por proximidad GeoJSON: "longitude,latitude,radio_metros" (coordenadas WGS84)
  } = req.query;

  // Construir filtros usando buildFilters de queryHelper
  const filterConfig = [
    { field: 'tipo', type: 'in', param: 'type' },
    { field: 'distrito', type: 'exact', param: 'distrito' },
    { field: 'nombre', type: 'regex', param: 'nombre' }
  ];

  const filters = buildFilters(req.query, filterConfig);

  // Filtro por bounding box (coordenadas UTM)
  if (bbox) {
    const [minX, minY, maxX, maxY] = bbox.split(',').map(Number);

    if ([minX, minY, maxX, maxY].some(v => !Number.isFinite(v))) {
      return next(createBadRequestError('Coordenadas de bounding box deben ser numeros validos'));
    }
    if (minX > maxX || minY > maxY) {
      return next(createBadRequestError('Bounding box invalido: las coordenadas minimas deben ser menores que las maximas'));
    }

    filters['coordenadas.x'] = { $gte: minX, $lte: maxX };
    filters['coordenadas.y'] = { $gte: minY, $lte: maxY };
  }

  // Configurar query geoespacial si existe near
  // NOTA: near espera coordenadas GeoJSON (WGS84): longitude,latitude,radio
  let geoQuery = null;
  if (near) {
    const [longitude, latitude, radio] = near.split(',').map(Number);
    geoQuery = {
      coordinates: [longitude, latitude],
      maxDistance: radio
    };
  }

  // Configurar paginacion usando queryHelper
  const paginationOptions = buildPaginationOptions(req.query, {
    defaultLimit: SPECIAL_PAGINATION_LIMITS.LOCATIONS.DEFAULT,
    maxLimit: SPECIAL_PAGINATION_LIMITS.LOCATIONS.MAX
  });

  // Proyeccion optimizada: campos esenciales + distrito + id_punto para
  // poder rellenar las celdas de la tabla de ubicaciones (que renderiza
  // distrito y identificador del punto).
  const projection = {
    tipo: 1,
    nombre: 1,
    'coordenadas.x': 1,
    'coordenadas.y': 1,
    distrito: 1,
    id_punto: 1,
    nmt: 1
  };

  const { data: ubicaciones, total } = await Location.buscarConOpciones({
    filters,
    geoQuery,
    sort: { nombre: 1 },
    pagination: { skip: paginationOptions.skip, limit: paginationOptions.limit },
    projection,
    lean: true,
    includeStats: false
  });

  const responseData = {
    ubicaciones,
    pagination: createPaginationMeta(paginationOptions.page, paginationOptions.limit, total)
  };

  res.json(createResponse(responseData, 'Ubicaciones obtenidas exitosamente'));
});

/**
 * Obtener puntos de medicion por tipo
 * @route GET /api/v1/ubicaciones/puntos-medicion/:measurementType
 */
const obtenerPuntosMedicion = asyncHandler(async (req, res, next) => {
  const { measurementType } = req.params;

  const tiposValidos = {
    [MEASUREMENT_POINT_TYPES.ACUSTICA]: LOCATION_TYPES.ESTACION_ACUSTICA,
    [MEASUREMENT_POINT_TYPES.TRAFICO]: LOCATION_TYPES.PUNTO_TRAFICO
  };

  if (!tiposValidos[measurementType]) {
    return next(createBadRequestError('Tipo de medicion no valido. Use: acustica, trafico'));
  }

  // Incluir distrito (numerico, 1-21 para puntos de trafico) y id_punto
  // para que el frontend pueda mostrarlos en la tabla de detalle. Antes la
  // proyeccion solo traia nombre/coords/nmt/cod_cent y la columna distrito
  // aparecia siempre como "-".
  const puntos = await Location.find({ tipo: tiposValidos[measurementType] })
    .select('nombre coordenadas nmt cod_cent id_punto distrito tipo_elem geometry')
    .maxTimeMS(MONGODB_TIMEOUTS.AGGREGATE_TIMEOUT_MS)
    .lean();

  const responseData = {
    tipoMedicion: measurementType,
    totalPuntos: puntos.length,
    puntos
  };

  res.json(createResponse(responseData, 'Puntos de medicion obtenidos exitosamente'));
});

/**
 * Obtener rutas de transporte publico
 * @route GET /api/v1/ubicaciones/transporte/:transportType
 */
const obtenerRutasTransporte = asyncHandler(async (req, res, next) => {
  const { transportType } = req.params;

  // TRANSPORT_ROUTE_TYPES incluye zona_taxi como valor valido
  const tiposTransporte = Object.values(TRANSPORT_ROUTE_TYPES);

  const filter = {};
  if (transportType !== 'todos') {
    // Para taxi, el tipo en BD es 'zona_taxi', para otros es 'ruta_X'
    const tipoCompleto = transportType === 'taxi'
      ? LOCATION_TYPES.ZONA_TAXI
      : `ruta_${transportType}`;

    if (!tiposTransporte.includes(tipoCompleto)) {
      return next(createBadRequestError('Tipo de transporte no valido'));
    }
    filter.tipo = tipoCompleto;
  } else {
    filter.tipo = { $in: tiposTransporte };
  }

  const rutas = await Location.find(filter)
    .select('tipo nombre coordenadas geometry')
    .maxTimeMS(MONGODB_TIMEOUTS.AGGREGATE_TIMEOUT_MS)
    .lean();

  const responseData = {
    tipoTransporte: transportType,
    totalRutas: rutas.length,
    rutas
  };

  res.json(createResponse(responseData, 'Rutas de transporte obtenidas exitosamente'));
});

/**
 * Obtener ubicaciones en formato FeatureCollection GeoJSON para mapas.
 * Pensado para visualizacion con Leaflet/MapLibre en el frontend.
 *
 * @route GET /api/v1/ubicaciones/mapa
 */
const obtenerMapaUbicaciones = asyncHandler(async (req, res, next) => {
  const { bbox } = req.query;

  const filterConfig = [
    { field: 'tipo', type: 'in', param: 'type' },
    { field: 'distrito', type: 'exact', param: 'distrito' }
  ];
  const filters = buildFilters(req.query, filterConfig);

  // Solo documentos con geometry valida para el mapa
  filters.geometry = { $exists: true, $ne: null };

  // Filtro por bounding box WGS84 (lng/lat)
  if (bbox) {
    const [minLng, minLat, maxLng, maxLat] = bbox.split(',').map(Number);
    if ([minLng, minLat, maxLng, maxLat].some(v => !Number.isFinite(v))) {
      return next(createBadRequestError('bbox debe ser "minLng,minLat,maxLng,maxLat" con numeros validos'));
    }
    filters.geometry = {
      $geoWithin: {
        $box: [[minLng, minLat], [maxLng, maxLat]]
      }
    };
  }

  const proyeccion = {
    _id: 1,
    tipo: 1,
    nombre: 1,
    nmt: 1,
    id_punto: 1,
    tipo_elem: 1,
    distrito: 1,
    geometry: 1
  };

  // Limite de defensa: sin filtro de tipo, locations tiene ~27k documentos
  // (sobre todo rutas de transporte). Evitamos transferir payloads enormes;
  // el cliente debe refinar por `type`/`bbox` o subir `limite` si lo necesita.
  const limite = Math.min(parseInt(req.query.limite, 10) || 8000, 20000);

  const docs = await Location.find(filters, proyeccion)
    .limit(limite)
    .maxTimeMS(MONGODB_TIMEOUTS.AGGREGATE_TIMEOUT_MS)
    .lean();

  if (docs.length === limite) {
    logger.warn({ recurso: 'ubicaciones', limite }, 'Mapa de ubicaciones truncado al limite; refine por type o bbox');
  }

  const featureCollection = documentosAFeatureCollection(
    docs,
    (doc) => ({
      id: doc._id?.toString(),
      geometry: doc.geometry,
      properties: {
        tipo: doc.tipo,
        nombre: doc.nombre,
        nmt: doc.nmt,
        idPunto: doc.id_punto,
        tipoElemento: doc.tipo_elem,
        distrito: doc.distrito
      }
    }),
    { recurso: 'ubicaciones' }
  );

  res.json(createResponse(featureCollection, 'Mapa de ubicaciones generado exitosamente'));
});

module.exports = {
  obtenerUbicaciones,
  obtenerPuntosMedicion,
  obtenerRutasTransporte,
  obtenerMapaUbicaciones
};
