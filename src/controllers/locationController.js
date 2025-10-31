const Location = require('../models/Location');
const { validationResult } = require('express-validator');
const { createValidationError, createInternalError, createBadRequestError } = require('../utils/errorUtils');
const { parsePaginationParams, createPaginationMeta } = require('../utils/paginationHelper');
const { createResponse } = require('../utils/responseHelper');

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
      tipo,
      distrito,
      barrio,
      bbox, // bounding box: "minX,minY,maxX,maxY"
      cerca_de, // "x,y,radio_metros"
      limit = 100,
      page = 1
    } = req.query;

    // Construir filtro base
    const filter = {};

    if (tipo) {
      if (Array.isArray(tipo)) {
        filter.tipo = { $in: tipo };
      } else {
        filter.tipo = tipo;
      }
    }

    if (distrito) {filter.distrito = new RegExp(distrito, 'i');}
    if (barrio) {filter.barrio = new RegExp(barrio, 'i');}

    // Filtro por bounding box (para mapas)
    if (bbox) {
      const [minX, minY, maxX, maxY] = bbox.split(',').map(Number);
      filter['coordenadas.x'] = { $gte: minX, $lte: maxX };
      filter['coordenadas.y'] = { $gte: minY, $lte: maxY };
    }

    // Filtro de proximidad
    if (cerca_de) {
      const [x, y, radio] = cerca_de.split(',').map(Number);
      filter.geometry = {
        $near: {
          $geometry: {
            type: 'Point',
            coordinates: [x, y] // longitude, latitude
          },
          $maxDistance: radio
        }
      };
    }

    // Procesar parámetros de paginación
    const pagination = parsePaginationParams(page, limit);

    const [ubicaciones, total] = await Promise.all([
      Location.find(filter)
        .select('tipo nombre coordenadas nmt cod_cent tipo_elem distrito barrio geometry')
        .limit(pagination.limitNum)
        .skip(pagination.skip)
        .lean(),
      Location.countDocuments(filter)
    ]);

    const responseData = {
      data: {
        ubicaciones,
        pagination: createPaginationMeta(pagination.pageNum, pagination.limitNum, total)
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
    ]);

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
