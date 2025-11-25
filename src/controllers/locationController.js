const Location = require('../models/Location');
const { validationResult } = require('express-validator');
const { createValidationError, createInternalError, createBadRequestError } = require('../utils/errorUtils');
const { createPaginationMeta } = require('../utils/paginationHelper');
const { buildFilters, buildPaginationOptions } = require('../utils/queryHelper');
const { createResponse } = require('../utils/responseHelper');
const { SPECIAL_PAGINATION_LIMITS, AGGREGATION_LIMITS, MONGODB_TIMEOUTS } = require('../constants');

/**
 * Obtener todas las ubicaciones con filtros
 */
const getLocations = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return next(createValidationError('Errores de validación en los parámetros', errors.array()));
    }

    const {
      bbox, // bounding box: "minX,minY,maxX,maxY"
      cerca_de // "x,y,radio_metros"
    } = req.query;

    // Construir filtros usando buildFilters de queryHelper
    const filterConfig = [
      { field: 'tipo', type: 'in', param: 'tipo' },
      { field: 'distrito', type: 'regex', param: 'distrito' },
      { field: 'barrio', type: 'regex', param: 'barrio' }
    ];

    const filters = buildFilters(req.query, filterConfig);

    // Filtro por bounding box (coordenadas UTM)
    if (bbox) {
      const [minX, minY, maxX, maxY] = bbox.split(',').map(Number);
      filters['coordenadas.x'] = { $gte: minX, $lte: maxX };
      filters['coordenadas.y'] = { $gte: minY, $lte: maxY };
    }

    // Configurar query geoespacial si existe cerca_de
    let geoQuery = null;
    if (cerca_de) {
      const [x, y, radio] = cerca_de.split(',').map(Number);
      geoQuery = {
        coordinates: [x, y], // [longitude, latitude]
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
      'coordenadas.y': 1,
      distrito: 1,
      barrio: 1
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
      data: {
        ubicaciones,
        pagination: createPaginationMeta(paginationOptions.page, paginationOptions.limit, total)
      }
    };

    res.json(createResponse(responseData, 'Ubicaciones obtenidas exitosamente'));

  } catch (error) {
    next(createInternalError('Error al obtener ubicaciones', error));
  }
};

/**
 * Obtener puntos de medición por tipo
 */
const getMeasurementPoints = async (req, res, next) => {
  try {
    const { tipo_medicion } = req.params;

    const tiposValidos = {
      'acustica': 'estacion_acustica',
      'trafico': 'punto_trafico'
    };

    if (!tiposValidos[tipo_medicion]) {
      return next(createBadRequestError('Tipo de medición no válido. Use: acustica, trafico'));
    }

    const puntos = await Location.find({
      tipo: tiposValidos[tipo_medicion]
    })
    .select('nombre coordenadas nmt cod_cent geometry')
    .maxTimeMS(MONGODB_TIMEOUTS.AGGREGATE_TIMEOUT_MS) // Timeout de 10 segundos
    .lean();

    const responseData = {
      data: {
        tipo_medicion,
        total_puntos: puntos.length,
        puntos
      }
    };

    res.json(createResponse(responseData, 'Puntos de medición obtenidos exitosamente'));

  } catch (error) {
    next(createInternalError(`Error al obtener puntos de medición de ${req.params.tipo_medicion}`, error));
  }
};

/**
 * Obtener rutas de transporte público
 */
const getTransportRoutes = async (req, res, next) => {
  try {
    const { tipo_transporte } = req.params;

    const tiposTransporte = [
      'ruta_cercanias',
      'ruta_autobus',
      'ruta_interurbano',
      'ruta_metro',
      'ruta_metro_ligero',
      'zona_taxi'
    ];

    const filter = {};
    if (tipo_transporte !== 'todos') {
      const tipoCompleto = `ruta_${tipo_transporte}`;
      if (!tiposTransporte.includes(tipoCompleto) && tipo_transporte !== 'zona_taxi') {
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
      data: {
        tipo_transporte,
        total_rutas: rutas.length,
        rutas
      }
    };

    res.json(createResponse(responseData, 'Rutas de transporte obtenidas exitosamente'));

  } catch (error) {
    next(createInternalError('Error al obtener rutas de transporte', error));
  }
};

/**
 * Análisis de proximidad entre puntos
 */
const getProximityAnalysis = async (req, res, next) => {
  try {
    const { x, y, radio = 1000 } = req.query;

    if (!x || !y) {
      return next(createBadRequestError('Coordenadas x e y son requeridas'));
    }

    // GeoJSON usa [longitude, latitude], por lo que x es longitude y y es latitude
    const puntoCentral = [parseFloat(x), parseFloat(y)];

    const ubicacionesCercanas = await Location.aggregate([
      {
        $geoNear: {
          near: {
            type: 'Point',
            coordinates: puntoCentral
          },
          distanceField: 'distancia',
          maxDistance: parseInt(radio),
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
          ubicaciones: { $slice: ['$ubicaciones', 10] } // Limitar a 10 por tipo
        }
      }
    ])
      .maxTimeMS(MONGODB_TIMEOUTS.AGGREGATE_TIMEOUT_MS) // Timeout de 10 segundos
      .exec();

    const responseData = {
      data: {
        punto_referencia: { x: parseFloat(x), y: parseFloat(y) },
        radio_metros: parseInt(radio),
        analisis_proximidad: ubicacionesCercanas
      }
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

