const Location = require('../models/Location');
const { createInternalError, createBadRequestError } = require('../utils/errorUtils');
const { createPaginationMeta } = require('../utils/paginationHelper');
const { buildFilters, buildPaginationOptions } = require('../utils/queryHelper');
const { createResponse } = require('../utils/responseHelper');
const { SPECIAL_PAGINATION_LIMITS, AGGREGATION_LIMITS, MONGODB_TIMEOUTS, MEASUREMENT_POINT_TYPES, GEO_LIMITS, TRANSPORT_ROUTE_TYPES, LOCATION_TYPES } = require('../constants');

/**
 * Obtener todas las ubicaciones con filtros
 * @route GET /api/v1/locations
 * @param {Object} req.query - Parametros de consulta
 * @param {string} [req.query.type] - Tipo de ubicacion (estacion_acustica, punto_trafico, etc.)
 * @param {number} [req.query.distrito] - Codigo de distrito (1-21, solo para puntos de trafico)
 * @param {string} [req.query.bbox] - Bounding box UTM: "minX,minY,maxX,maxY"
 * @param {string} [req.query.near] - Busqueda por proximidad GeoJSON: "longitude,latitude,radio_metros"
 * @param {number} [req.query.page] - Numero de pagina
 * @param {number} [req.query.limit] - Limite de resultados por pagina
 */
const getLocations = async (req, res, next) => {
  try {
    const {
      bbox, // bounding box UTM: "minX,minY,maxX,maxY" (coordenadas UTM en metros)
      near // busqueda por proximidad GeoJSON: "longitude,latitude,radio_metros" (coordenadas WGS84)
    } = req.query;

    // Construir filtros usando buildFilters de queryHelper
    const filterConfig = [
      { field: 'tipo', type: 'in', param: 'type' },
      { field: 'distrito', type: 'exact', param: 'distrito' }
    ];

    // Usamos exclusivamente el query param `type` (no alias `tipo` en la query)
    const filters = buildFilters(req.query, filterConfig);

    // Filtro por bounding box (coordenadas UTM)
    if (bbox) {
      const [minX, minY, maxX, maxY] = bbox.split(',').map(Number);
      filters['coordenadas.x'] = { $gte: minX, $lte: maxX };
      filters['coordenadas.y'] = { $gte: minY, $lte: maxY };
    }

    // Configurar query geoespacial si existe near
    // NOTA: near espera coordenadas GeoJSON (WGS84): longitude,latitude,radio
    let geoQuery = null;
    if (near) {
      const [longitude, latitude, radio] = near.split(',').map(Number);
      geoQuery = {
        coordinates: [longitude, latitude], // GeoJSON: [longitude, latitude]
        maxDistance: radio
      };
    }

    // Configurar paginación usando queryHelper
    const paginationOptions = buildPaginationOptions(req.query, {
      defaultLimit: SPECIAL_PAGINATION_LIMITS.LOCATIONS.DEFAULT,
      maxLimit: SPECIAL_PAGINATION_LIMITS.LOCATIONS.MAX
    });

    // Proyección optimizada: solo campos esenciales
    const projection = {
      tipo: 1,
      nombre: 1,
      'coordenadas.x': 1,
      'coordenadas.y': 1
    };

    // PATRÓN HÍBRIDO: Usar método del modelo para query compleja
    const { data: ubicaciones, total } = await Location.findWithOptions({
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

  } catch (error) {
    next(createInternalError('Error al obtener ubicaciones', error));
  }
};

/**
 * Obtener puntos de medicion por tipo
 * @route GET /api/v1/locations/measurement-points/:measurementType
 * @param {string} req.params.measurementType - Tipo de medicion: 'acustica' | 'trafico'
 */
const getMeasurementPoints = async (req, res, next) => {
  try {
    const { measurementType } = req.params;

    const tiposValidos = {
      [MEASUREMENT_POINT_TYPES.ACUSTICA]: LOCATION_TYPES.ESTACION_ACUSTICA,
      [MEASUREMENT_POINT_TYPES.TRAFICO]: LOCATION_TYPES.PUNTO_TRAFICO
    };

    if (!tiposValidos[measurementType]) {
      return next(createBadRequestError('Tipo de medición no válido. Use: acustica, trafico'));
    }

    const puntos = await Location.find({
      tipo: tiposValidos[measurementType]
    })
    .select('nombre coordenadas nmt cod_cent geometry')
    .maxTimeMS(MONGODB_TIMEOUTS.AGGREGATE_TIMEOUT_MS) // Timeout de 10 segundos
    .lean();

    const responseData = {
      measurementType,
      total_puntos: puntos.length,
      puntos
    };

    res.json(createResponse(responseData, 'Puntos de medición obtenidos exitosamente'));

  } catch (error) {
    next(createInternalError(`Error al obtener puntos de medición de ${req.params.measurementType}`, error));
  }
};

/**
 * Obtener rutas de transporte publico
 * @route GET /api/v1/locations/transport/:transportType
 * @param {string} req.params.transportType - Tipo de transporte: 'todos' | 'cercanias' | 'autobus' | 'interurbano' | 'metro' | 'metro_ligero' | 'taxi'
 */
const getTransportRoutes = async (req, res, next) => {
  try {
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
        return next(createBadRequestError('Tipo de transporte no válido'));
      }
      filter.tipo = tipoCompleto;
    } else {
      filter.tipo = { $in: tiposTransporte };
    }

    const rutas = await Location.find(filter)
      .select('tipo nombre coordenadas geometry')
      .maxTimeMS(MONGODB_TIMEOUTS.AGGREGATE_TIMEOUT_MS) // Timeout de 10 segundos
      .lean();

    const responseData = {
      transportType,
      total_rutas: rutas.length,
      rutas
    };

    res.json(createResponse(responseData, 'Rutas de transporte obtenidas exitosamente'));

  } catch (error) {
    next(createInternalError('Error al obtener rutas de transporte', error));
  }
};

/**
 * Analisis de proximidad entre puntos
 * @route GET /api/v1/locations/proximity
 * @param {number} req.query.lon - Longitud (GeoJSON WGS84, rango: -180 a 180)
 * @param {number} req.query.lat - Latitud (GeoJSON WGS84, rango: -90 a 90)
 * @param {number} [req.query.radius] - Radio de busqueda en metros (default: 1000)
 */
const getProximityAnalysis = async (req, res, next) => {
  try {
    const { lon, lat, radius = GEO_LIMITS.DEFAULT_DISTANCE_METERS } = req.query;

    if (!lon || !lat) {
      return next(createBadRequestError('Coordenadas lon (longitud) y lat (latitud) son requeridas'));
    }

    // GeoJSON usa [longitude, latitude]
    const puntoCentral = [parseFloat(lon), parseFloat(lat)];

    const ubicacionesCercanas = await Location.aggregate([
      {
        $geoNear: {
          near: {
            type: 'Point',
            coordinates: puntoCentral
          },
          distanceField: 'distancia',
          maxDistance: parseInt(radius),
          spherical: true,
          key: 'geometry' // Especificar el campo con índice geoespacial
        }
      },
      // NO usar $limit antes de $group - limitar después si es necesario
      {
        $group: {
          _id: '$tipo',
          count: { $sum: 1 },
          ubicaciones: {
            $push: {
              nombre: '$nombre',
              coordenadas: '$coordenadas',
              distancia: '$distancia',
              nmt: '$nmt',
              cod_cent: '$cod_cent'
            }
          }
        }
      },
      {
        $project: {
          tipo: '$_id',
          total: '$count',
          ubicaciones: { $slice: ['$ubicaciones', AGGREGATION_LIMITS.TOP_RESULTS] } // Limitar a 50 por tipo
        }
      }
    ])
      .option({ maxTimeMS: MONGODB_TIMEOUTS.AGGREGATE_TIMEOUT_MS }) // Timeout de 10 segundos
      .exec();

    const responseData = {
      punto_referencia: {
        lon: parseFloat(lon),
        lat: parseFloat(lat)
      },
      radio_metros: parseInt(radius),
      analisis_proximidad: ubicacionesCercanas
    };

    res.json(createResponse(responseData, 'Análisis de proximidad obtenido exitosamente'));

  } catch (error) {
    next(createInternalError('Error en análisis de proximidad', error));
  }
};

module.exports = {
  getLocations,
  getMeasurementPoints,
  getTransportRoutes,
  getProximityAnalysis
};

