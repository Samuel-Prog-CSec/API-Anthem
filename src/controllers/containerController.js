/**
 * Controlador de Contenedores
 *
 * Maneja la lógica de negocio para las operaciones relacionadas
 * con contenedores de residuos.
 */

const Container = require('../models/Container');
const { parsePaginationParams, createPaginationMeta } = require('../utils/paginationHelper');
const { buildFilters, buildSortOptions, buildPaginationOptions } = require('../utils/queryHelper');
const { SORT_FIELDS, PAGINATION } = require('../constants');

/**
 * Obtener todos los contenedores con filtros y paginación
 *
 * @route GET /api/containers
 * @access Private
 */
exports.getAllContainers = async (req, res, next) => {
  try {
    // Configuración de filtros usando queryHelper
    const filterConfig = [
      { field: 'tipoContenedor', type: 'exact', param: 'tipoContenedor', transform: v => v.toUpperCase() },
      { field: 'distrito', type: 'regex', param: 'distrito' },
      { field: 'barrio', type: 'regex', param: 'barrio' },
      { field: 'lote', type: 'numeric', param: 'lote' }
    ];

    const filters = buildFilters(req.query, filterConfig);

    // Configurar ordenamiento usando queryHelper
    const sortOptions = buildSortOptions(
      req.query.sortBy || 'distrito',
      req.query.sortOrder || 'asc',
      ['distrito', 'barrio', 'tipoContenedor', 'lote'],
      'distrito'
    );

    // Configurar paginación usando queryHelper
    const paginationOptions = buildPaginationOptions(req.query, {
      defaultLimit: 100,
      maxLimit: PAGINATION.MAX_LIMIT
    });

    // Ejecutar consulta con paginación
    const [data, total] = await Promise.all([
      Container.find(filters)
        .sort(sortOptions)
        .skip(paginationOptions.skip)
        .limit(paginationOptions.limit)
        .select('-__v')
        .lean(),
      Container.countDocuments(filters)
    ]);

    res.status(200).json({
      success: true,
      data,
      pagination: createPaginationMeta(paginationOptions.page, paginationOptions.limit, total)
    });

  } catch (error) {
    console.error('Error al obtener contenedores:', error);
    next(error);
  }
};

/**
 * Buscar contenedores cercanos a una ubicación
 *
 * @route GET /api/containers/nearby
 * @access Private
 */
exports.getNearbyContainers = async (req, res, next) => {
  try {
    const {
      longitude,
      latitude,
      maxDistance = 500,
      tipoContenedor
    } = req.query;

    // Validar parámetros requeridos
    if (!longitude || !latitude) {
      return res.status(400).json({
        success: false,
        message: 'Se requieren los parámetros longitude y latitude'
      });
    }

    const lng = parseFloat(longitude);
    const lat = parseFloat(latitude);
    const distance = parseInt(maxDistance);

    // Validar coordenadas
    if (isNaN(lng) || isNaN(lat) || lng < -180 || lng > 180 || lat < -90 || lat > 90) {
      return res.status(400).json({
        success: false,
        message: 'Coordenadas no válidas'
      });
    }

    const containers = await Container.findNearby(
      lng,
      lat,
      distance,
      tipoContenedor ? tipoContenedor.toUpperCase() : null
    );

    res.status(200).json({
      success: true,
      data: {
        ubicacion: {
          longitude: lng,
          latitude: lat
        },
        radioMetros: distance,
        ...(tipoContenedor && { tipoContenedor: tipoContenedor.toUpperCase() }),
        total: containers.length,
        contenedores: containers
      }
    });

  } catch (error) {
    console.error('Error al buscar contenedores cercanos:', error);
    next(error);
  }
};

/**
 * Obtener estadísticas generales de contenedores
 *
 * @route GET /api/containers/stats
 * @access Private
 */
exports.getContainerStats = async (req, res, next) => {
  try {
    const summary = await Container.getGeneralSummary();

    if (!summary || summary.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'No se encontraron datos de contenedores'
      });
    }

    res.status(200).json({
      success: true,
      data: summary[0]
    });

  } catch (error) {
    console.error('Error al obtener estadísticas de contenedores:', error);
    next(error);
  }
};

/**
 * Obtener estadísticas por distrito
 *
 * @route GET /api/containers/stats/district
 * @access Private
 */
exports.getStatsByDistrict = async (req, res, next) => {
  try {
    const { distrito } = req.query;

    const stats = await Container.getStatsByDistrict(
      distrito ? distrito : null
    );

    if (!stats || stats.length === 0) {
      return res.status(404).json({
        success: false,
        message: distrito
          ? `No se encontraron contenedores en el distrito ${distrito}`
          : 'No se encontraron datos de contenedores'
      });
    }

    res.status(200).json({
      success: true,
      data: {
        ...(distrito && { distrito }),
        total: stats.length,
        estadisticas: stats
      }
    });

  } catch (error) {
    console.error('Error al obtener estadísticas por distrito:', error);
    next(error);
  }
};

/**
 * Obtener estadísticas por barrio
 *
 * @route GET /api/containers/stats/neighborhood
 * @access Private
 */
exports.getStatsByNeighborhood = async (req, res, next) => {
  try {
    const { distrito, barrio } = req.query;

    // Validar que se proporcione al menos el distrito
    if (!distrito) {
      return res.status(400).json({
        success: false,
        message: 'Se requiere el parámetro distrito'
      });
    }

    const stats = await Container.getStatsByBarrio(distrito, barrio || null);

    if (!stats || stats.length === 0) {
      return res.status(404).json({
        success: false,
        message: `No se encontraron contenedores en ${barrio ? `el barrio ${barrio} del ` : ''}distrito ${distrito}`
      });
    }

    res.status(200).json({
      success: true,
      data: {
        distrito,
        ...(barrio && { barrio }),
        total: stats.length,
        estadisticas: stats
      }
    });

  } catch (error) {
    console.error('Error al obtener estadísticas por barrio:', error);
    next(error);
  }
};

/**
 * Contar contenedores por tipo en un área
 *
 * @route GET /api/containers/count-by-type
 * @access Private
 */
exports.countByType = async (req, res, next) => {
  try {
    const { distrito, barrio } = req.query;

    // Validar que se proporcione al menos el distrito
    if (!distrito) {
      return res.status(400).json({
        success: false,
        message: 'Se requiere el parámetro distrito'
      });
    }

    const count = await Container.countByType(distrito, barrio || null);

    res.status(200).json({
      success: true,
      data: count
    });

  } catch (error) {
    console.error('Error al contar contenedores por tipo:', error);
    next(error);
  }
};

/**
 * Obtener lista de distritos únicos
 *
 * @route GET /api/containers/districts
 * @access Private
 */
exports.getDistricts = async (req, res, next) => {
  try {
    const districts = await Container.distinct('distrito');

    res.status(200).json({
      success: true,
      data: {
        total: districts.length,
        distritos: districts.sort()
      }
    });

  } catch (error) {
    console.error('Error al obtener distritos:', error);
    next(error);
  }
};

/**
 * Obtener lista de barrios por distrito
 *
 * @route GET /api/containers/neighborhoods/:distrito
 * @access Private
 */
exports.getNeighborhoodsByDistrict = async (req, res, next) => {
  try {
    const { distrito } = req.params;

    const neighborhoods = await Container.distinct('barrio', { distrito });

    if (!neighborhoods || neighborhoods.length === 0) {
      return res.status(404).json({
        success: false,
        message: `No se encontraron barrios en el distrito ${distrito}`
      });
    }

    res.status(200).json({
      success: true,
      data: {
        distrito,
        total: neighborhoods.length,
        barrios: neighborhoods.sort()
      }
    });

  } catch (error) {
    console.error('Error al obtener barrios:', error);
    next(error);
  }
};

/**
 * Buscar contenedores por dirección
 *
 * @route GET /api/containers/search
 * @access Private
 */
exports.searchByAddress = async (req, res, next) => {
  try {
    const { q, tipoContenedor, limit = 50 } = req.query;

    if (!q) {
      return res.status(400).json({
        success: false,
        message: 'Se requiere el parámetro de búsqueda q'
      });
    }

    // Construir consulta de búsqueda
    const filter = {
      $or: [
        { 'direccion.nombre': new RegExp(q, 'i') },
        { 'direccion.completa': new RegExp(q, 'i') }
      ]
    };

    if (tipoContenedor) {
      filter.tipoContenedor = tipoContenedor.toUpperCase();
    }

    const containers = await Container.find(filter)
      .limit(parseInt(limit))
      .select('-__v')
      .lean();

    res.status(200).json({
      success: true,
      data: {
        busqueda: q,
        ...(tipoContenedor && { tipoContenedor: tipoContenedor.toUpperCase() }),
        total: containers.length,
        contenedores: containers
      }
    });

  } catch (error) {
    console.error('Error al buscar contenedores por dirección:', error);
    next(error);
  }
};

/**
 * Obtener mapa de calor de contenedores por tipo
 *
 * @route GET /api/containers/heatmap
 * @access Private
 */
exports.getHeatmapData = async (req, res, next) => {
  try {
    const { tipoContenedor } = req.query;

    const filter = tipoContenedor ? { tipoContenedor: tipoContenedor.toUpperCase() } : {};

    const heatmapData = await Container.aggregate([
      { $match: filter },
      {
        $project: {
          latitude: { $arrayElemAt: ['$location.coordinates', 1] },
          longitude: { $arrayElemAt: ['$location.coordinates', 0] },
          cantidad: 1,
          tipoContenedor: 1
        }
      },
      { $limit: 5000 } // Limitar para no sobrecargar el frontend
    ]);

    res.status(200).json({
      success: true,
      data: {
        ...(tipoContenedor && { tipoContenedor: tipoContenedor.toUpperCase() }),
        total: heatmapData.length,
        puntos: heatmapData
      }
    });

  } catch (error) {
    console.error('Error al obtener datos de mapa de calor:', error);
    next(error);
  }
};

/**
 * Obtener cobertura por tipo de contenedor en un distrito
 *
 * @route GET /api/containers/coverage
 * @access Private
 */
exports.getCoverageAnalysis = async (req, res, next) => {
  try {
    const { distrito } = req.query;

    const matchStage = distrito ? { $match: { distrito } } : { $match: {} };

    const coverage = await Container.aggregate([
      matchStage,
      {
        $group: {
          _id: {
            distrito: '$distrito',
            tipoContenedor: '$tipoContenedor'
          },
          totalContenedores: { $sum: '$cantidad' },
          totalUbicaciones: { $sum: 1 },
          puntos: {
            $push: {
              lng: { $arrayElemAt: ['$location.coordinates', 0] },
              lat: { $arrayElemAt: ['$location.coordinates', 1] }
            }
          }
        }
      },
      {
        $group: {
          _id: '$_id.distrito',
          distrito: { $first: '$_id.distrito' },
          tipos: {
            $push: {
              tipo: '$_id.tipoContenedor',
              total: '$totalContenedores',
              ubicaciones: '$totalUbicaciones'
            }
          },
          totalGeneral: { $sum: '$totalContenedores' }
        }
      },
      { $sort: { distrito: 1 } }
    ]);

    res.status(200).json({
      success: true,
      data: {
        ...(distrito && { distrito }),
        analisisCobertura: coverage
      }
    });

  } catch (error) {
    console.error('Error al analizar cobertura:', error);
    next(error);
  }
};
