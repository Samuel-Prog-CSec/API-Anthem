/**
 * Controlador de Contenedores
 *
 * Maneja la lógica de negocio para las operaciones relacionadas
 * con contenedores de residuos.
 */

const Container = require('../models/Container');
const { createInternalError, createNotFoundError, createBadRequestError } = require('../utils/errorUtils');
const { createPaginationMeta } = require('../utils/paginationHelper');
const { buildFilters, buildSortOptions, buildPaginationOptions } = require('../utils/queryHelper');
const { createResponse } = require('../utils/responseHelper');
const { PAGINATION, HTTP_STATUS } = require('../constants');

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

    // Proyección optimizada: solo campos necesarios para listado
    // Reduce ~40% tamaño de respuesta
    const projection = {
      tipo: 1,
      modelo: 1,
      capacidad: 1,
      ubicacion: 1,
      'direccion.via': 1,
      'direccion.numero': 1,
      'direccion.distrito': 1,
      'direccion.barrio': 1,
      'direccion.codigoPostal': 1,
      estado: 1
    };

    // Ejecutar consulta con paginación y timeouts
    const [data, total] = await Promise.all([
      Container.find(filters, projection)
        .sort(sortOptions)
        .skip(paginationOptions.skip)
        .limit(paginationOptions.limit)
        .maxTimeMS(10000) // Timeout de 10 segundos
        .lean(),
      Container.countDocuments(filters).maxTimeMS(5000) // Timeout de 5 segundos para count
    ]);

    const responseData = {
      data,
      pagination: createPaginationMeta(paginationOptions.page, paginationOptions.limit, total)
    };

    res.status(HTTP_STATUS.OK).json(createResponse(responseData, 'Contenedores obtenidos exitosamente'));

  } catch (error) {
    next(createInternalError('Error al obtener contenedores', error));
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
      return next(createBadRequestError('Se requieren los parámetros longitude y latitude'));
    }

    const lng = parseFloat(longitude);
    const lat = parseFloat(latitude);
    const distance = parseInt(maxDistance);

    // Validar coordenadas
    if (isNaN(lng) || isNaN(lat) || lng < -180 || lng > 180 || lat < -90 || lat > 90) {
      return next(createBadRequestError('Coordenadas no válidas'));
    }

    const containers = await Container.findNearby(
      lng,
      lat,
      distance,
      tipoContenedor ? tipoContenedor.toUpperCase() : null
    );

    const responseData = {
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
    };

    res.status(HTTP_STATUS.OK).json(createResponse(responseData, 'Contenedores cercanos obtenidos exitosamente'));

  } catch (error) {
    next(createInternalError('Error al buscar contenedores cercanos', error));
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
      return next(createNotFoundError('Datos de contenedores'));
    }

    const responseData = {
      data: summary[0]
    };

    res.status(HTTP_STATUS.OK).json(createResponse(responseData, 'Estadísticas obtenidas exitosamente'));

  } catch (error) {
    next(createInternalError('Error al obtener estadísticas de contenedores', error));
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
      return next(createNotFoundError('Contenedores', distrito ? `distrito ${distrito}` : null));
    }

    const responseData = {
      data: {
        ...(distrito && { distrito }),
        total: stats.length,
        estadisticas: stats
      }
    };

    res.status(HTTP_STATUS.OK).json(createResponse(responseData, 'Estadísticas por distrito obtenidas exitosamente'));

  } catch (error) {
    next(createInternalError('Error al obtener estadísticas por distrito', error));
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
      return next(createBadRequestError('Se requiere el parámetro distrito'));
    }

    const stats = await Container.getStatsByNeighborhood(distrito, barrio || null);

    if (!stats || stats.length === 0) {
      return next(createNotFoundError('Contenedores', barrio ? `barrio ${barrio} del distrito ${distrito}` : `distrito ${distrito}`));
    }

    const responseData = {
      data: {
        distrito,
        ...(barrio && { barrio }),
        total: stats.length,
        estadisticas: stats
      }
    };

    res.status(HTTP_STATUS.OK).json(createResponse(responseData, 'Estadísticas por barrio obtenidas exitosamente'));

  } catch (error) {
    next(createInternalError('Error al obtener estadísticas por barrio', error));
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
      return next(createBadRequestError('Se requiere el parámetro distrito'));
    }

    const count = await Container.countByType(distrito, barrio || null);

    const responseData = {
      data: count
    };

    res.status(HTTP_STATUS.OK).json(createResponse(responseData, 'Conteo por tipo obtenido exitosamente'));

  } catch (error) {
    next(createInternalError('Error al contar contenedores por tipo', error));
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

    const responseData = {
      data: {
        total: districts.length,
        distritos: districts.sort()
      }
    };

    res.status(HTTP_STATUS.OK).json(createResponse(responseData, 'Distritos obtenidos exitosamente'));

  } catch (error) {
    next(createInternalError('Error al obtener distritos', error));
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
      return next(createNotFoundError('Barrios', `distrito ${distrito}`));
    }

    const responseData = {
      data: {
        distrito,
        total: neighborhoods.length,
        barrios: neighborhoods.sort()
      }
    };

    res.status(HTTP_STATUS.OK).json(createResponse(responseData, 'Barrios obtenidos exitosamente'));

  } catch (error) {
    next(createInternalError('Error al obtener barrios', error));
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
      return next(createBadRequestError('Se requiere el parámetro de búsqueda q'));
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
      .maxTimeMS(10000) // Timeout de 10 segundos
      .select('-__v')
      .lean();

    const responseData = {
      data: {
        busqueda: q,
        ...(tipoContenedor && { tipoContenedor: tipoContenedor.toUpperCase() }),
        total: containers.length,
        contenedores: containers
      }
    };

    res.status(HTTP_STATUS.OK).json(createResponse(responseData, 'Búsqueda completada exitosamente'));

  } catch (error) {
    next(createInternalError('Error al buscar contenedores por dirección', error));
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

    const heatmapData = await Container.getHeatmapData(tipoContenedor);

    const responseData = {
      data: {
        ...(tipoContenedor && { tipoContenedor: tipoContenedor.toUpperCase() }),
        total: heatmapData.length,
        puntos: heatmapData
      }
    };

    res.status(HTTP_STATUS.OK).json(createResponse(responseData, 'Datos de mapa de calor obtenidos exitosamente'));

  } catch (error) {
    next(createInternalError('Error al obtener datos de mapa de calor', error));
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

    const coverage = await Container.getCoverageAnalysis(distrito);

    const responseData = {
      data: {
        ...(distrito && { distrito }),
        analisisCobertura: coverage
      }
    };

    res.status(HTTP_STATUS.OK).json(createResponse(responseData, 'Análisis de cobertura obtenido exitosamente'));

  } catch (error) {
    next(createInternalError('Error al analizar cobertura', error));
  }
};

/**
 * Análisis de densidad de contenedores por distrito
 *
 * @route GET /api/containers/analysis/density
 * @access Private
 */
exports.getDensityAnalysis = async (req, res, next) => {
  try {
    const { distrito, tipoContenedor, includeBarrios = 'true' } = req.query;

    const options = {
      distrito,
      tipoContenedor: tipoContenedor ? tipoContenedor.toUpperCase() : undefined,
      includeBarrios: includeBarrios === 'true'
    };

    const densityAnalysis = await Container.getDensityAnalysisByDistrict(options);

    if (!densityAnalysis || densityAnalysis.length === 0) {
      return next(createNotFoundError('Análisis de densidad', distrito ? `distrito ${distrito}` : null));
    }

    const responseData = {
      data: {
        ...(distrito && { distrito }),
        ...(tipoContenedor && { tipoContenedor: tipoContenedor.toUpperCase() }),
        includeBarrios: options.includeBarrios,
        analisisDensidad: densityAnalysis,
        totalZonasAnalizadas: densityAnalysis.length
      }
    };

    res.status(HTTP_STATUS.OK).json(createResponse(responseData, 'Análisis de densidad obtenido exitosamente'));

  } catch (error) {
    next(createInternalError('Error al analizar densidad', error));
  }
};


