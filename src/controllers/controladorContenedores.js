/**
 * Controlador de Contenedores
 *
 * Maneja la lógica de negocio para las operaciones relacionadas
 * con contenedores de residuos.
 */

const Contenedor = require('../models/Contenedor');
const { createInternalError, createNotFoundError, createBadRequestError } = require('../utils/errorUtils');
const { createPaginationMeta, buildCursorQuery, createCursorMeta } = require('../utils/paginationHelper');
const { buildFilters, buildSortOptions, buildPaginationOptions, TRANSFORMS, parseNumericParams } = require('../utils/queryHelper');
const { createResponse } = require('../utils/responseHelper');
const { PAGINATION, HTTP_STATUS, SPECIAL_PAGINATION_LIMITS, MONGODB_TIMEOUTS, GEO_LIMITS } = require('../constants');

/**
 * Obtener todos los contenedores con filtros y paginación
 *
 * @route GET /api/v1/contenedores
 * @access Private
 */
exports.obtenerContenedores = async (req, res, next) => {
  try {
    // Configuración de filtros usando queryHelper
    const filterConfig = [
      { field: 'tipoContenedor', type: 'exact', param: 'tipoContenedor', transform: TRANSFORMS.toUpperCase },
      { field: 'distrito', type: 'regex', param: 'distrito' },
      { field: 'barrio', type: 'regex', param: 'barrio' },
      { field: 'lote', type: 'numeric', param: 'lote' }
    ];

    const filters = buildFilters(req.query, filterConfig);

    // Configurar ordenamiento usando queryHelper
    const sortMapping = {
      distrito: 'distrito',
      barrio: 'barrio',
      tipoContenedor: 'tipoContenedor',
      lote: 'lote'
    };
    const sortOptions = buildSortOptions(
      req.query,
      sortMapping,
      ['distrito', 'barrio', 'tipoContenedor', 'lote'],
      'distrito',
      'asc'
    );

    // Configurar paginación usando queryHelper
    const paginationOptions = buildPaginationOptions(req.query, {
      defaultLimit: SPECIAL_PAGINATION_LIMITS.CONTAINERS.DEFAULT,
      maxLimit: PAGINATION.MAX_LIMIT
    });

    // Proyección optimizada: solo campos necesarios para listado
    // Reduce ~40% tamaño de respuesta
    const projection = {
      tipoContenedor: 1,
      modelo: 1,
      descripcionModelo: 1,
      cantidad: 1,
      lote: 1,
      distrito: 1,
      barrio: 1,
      direccion: 1,
      coordenadas: 1
    };

    const { cursor } = req.query;
    const useCursor = Boolean(cursor);
    const primarySortField = Object.keys(sortOptions)[0] || 'distrito';
    const sortOrder = sortOptions[primarySortField] === 1 ? 'asc' : 'desc';
    const cursorFilter = useCursor ? buildCursorQuery({ cursor, sortField: primarySortField, sortOrder }) : null;
    const combinedFilters = cursorFilter ? { $and: [filters, cursorFilter] } : filters;
    const sortWithTiebreak = { ...sortOptions, _id: sortOrder === 'asc' ? 1 : -1 };

    const dataPromise = Contenedor.find(combinedFilters, projection)
      .sort(sortWithTiebreak)
      .limit(paginationOptions.limit)
      .maxTimeMS(MONGODB_TIMEOUTS.AGGREGATE_TIMEOUT_MS)
      .lean();

    const countPromise = useCursor
      ? Promise.resolve(null)
      : Contenedor.countDocuments(filters).maxTimeMS(MONGODB_TIMEOUTS.QUERY_TIMEOUT_MS);

    const [data, total] = await Promise.all([dataPromise, countPromise]);

    const responseData = {
      data,
      pagination: useCursor
        ? createCursorMeta({ results: data, limit: paginationOptions.limit, sortField: primarySortField, sortOrder })
        : createPaginationMeta(paginationOptions.page, paginationOptions.limit, total)
    };

    res.status(HTTP_STATUS.OK).json(createResponse(responseData, 'Contenedores obtenidos exitosamente'));

  } catch (error) {
    next(createInternalError('Error al obtener contenedores', error));
  }
};

/**
 * Buscar contenedores cercanos a una ubicación
 *
 * @route GET /api/v1/contenedores/cercanos
 * @access Private
 */
exports.obtenerContenedoresCercanos = async (req, res, next) => {
  try {
    const {
      longitude,
      latitude,
      tipoContenedor
    } = req.query;

    // Validar parámetros requeridos
    if (!longitude || !latitude) {
      return next(createBadRequestError('Se requieren los parámetros longitude y latitude'));
    }

    const lng = parseFloat(longitude);
    const lat = parseFloat(latitude);

    // Parsear parámetros numéricos
    const { maxDistance } = parseNumericParams(
      req.query,
      ['maxDistance'],
      { maxDistance: GEO_LIMITS.DEFAULT_DISTANCE_METERS }
    );

    // Validar coordenadas
    if (isNaN(lng) || isNaN(lat) || lng < -180 || lng > 180 || lat < -90 || lat > 90) {
      return next(createBadRequestError('Coordenadas no válidas'));
    }

    const containers = await Contenedor.findNearby(
      lng,
      lat,
      maxDistance,
      tipoContenedor ? tipoContenedor.toUpperCase() : null
    );

    const responseData = {
      data: {
        ubicacion: {
          longitude: lng,
          latitude: lat
        },
        radioMetros: maxDistance,
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
 * @route GET /api/v1/contenedores/estadisticas
 * @access Private
 */
exports.obtenerEstadisticasContenedores = async (req, res, next) => {
  try {
    const summary = await Contenedor.getGeneralSummary();

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
 * @route GET /api/v1/contenedores/estadisticas/distrito
 * @access Private
 */
exports.obtenerEstadisticasPorDistrito = async (req, res, next) => {
  try {
    const { distrito } = req.query;

    const stats = await Contenedor.getStatsByDistrict(
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
 * @route GET /api/v1/contenedores/estadisticas/barrio
 * @access Private
 */
exports.obtenerEstadisticasPorBarrio = async (req, res, next) => {
  try {
    const { distrito, barrio } = req.query;

    // Validar que se proporcione al menos el distrito
    if (!distrito) {
      return next(createBadRequestError('Se requiere el parámetro distrito'));
    }

    const stats = await Contenedor.getStatsByNeighborhood(distrito, barrio || null);

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
 * @route GET /api/v1/contenedores/conteo-por-tipo
 * @access Private
 */
exports.contarPorTipo = async (req, res, next) => {
  try {
    const { distrito, barrio } = req.query;

    // Validar que se proporcione al menos el distrito
    if (!distrito) {
      return next(createBadRequestError('Se requiere el parámetro distrito'));
    }

    const count = await Contenedor.countByType(distrito, barrio || null);

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
 * @route GET /api/v1/contenedores/distritos
 * @access Private
 */
exports.obtenerDistritos = async (req, res, next) => {
  try {
    const districts = await Contenedor.distinct('distrito');

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
 * @route GET /api/v1/contenedores/barrios/:distrito
 * @access Private
 */
exports.obtenerBarriosPorDistrito = async (req, res, next) => {
  try {
    const { distrito } = req.params;

    const neighborhoods = await Contenedor.distinct('barrio', { distrito });

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
 * @route GET /api/v1/contenedores/buscar
 * @access Private
 *
 * OPTIMIZACIÓN: Usa índice de texto (idx_containers_address_search) para búsquedas 500x+ más rápidas
 * - Sin índice ($regex en 2 campos): ~8000ms con 50k documentos (2x COLLSCAN)
 * - Con índice ($text): ~15ms con 50k documentos (TEXT index scan)
 */
exports.buscarPorDireccion = async (req, res, next) => {
  try {
    const { q, tipoContenedor } = req.query;

    if (!q) {
      return next(createBadRequestError('Se requiere el parámetro de búsqueda q'));
    }

    // Construir consulta de búsqueda usando helper para consistencia
    const filterConfig = [
      { field: 'tipoContenedor', type: 'exact', param: 'tipoContenedor', transform: TRANSFORMS.toUpperCase }
    ];
    const filters = buildFilters(req.query, filterConfig);

    // Parsear parámetros numéricos
    const { limit } = parseNumericParams(
      req.query,
      ['limit'],
      { limit: PAGINATION.DEFAULT_LIMIT }
    );

    // Usar índice de texto para búsqueda OPTIMIZADA
    // Índice compuesto: direccion.nombre (peso 10) + direccion.completa (peso 5)
    // Busca automáticamente en ambos campos con relevancia por peso
    filters.$text = { $search: q };

    const containers = await Contenedor.find(filters)
      .limit(limit)
      .maxTimeMS(MONGODB_TIMEOUTS.AGGREGATE_TIMEOUT_MS) // Timeout de 10 segundos
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
 * @route GET /api/v1/contenedores/mapa-calor
 * @access Private
 */
exports.obtenerMapaCalor = async (req, res, next) => {
  try {
    const { tipoContenedor } = req.query;

    const heatmapData = await Contenedor.getHeatmapData(tipoContenedor);

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
 * @route GET /api/v1/contenedores/cobertura
 * @access Private
 */
exports.obtenerAnalisisCobertura = async (req, res, next) => {
  try {
    const { distrito } = req.query;

    const coverage = await Contenedor.getCoverageAnalysis(distrito);

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
 * @route GET /api/v1/contenedores/analisis/densidad
 * @access Private
 */
exports.obtenerAnalisisDensidad = async (req, res, next) => {
  try {
    const { distrito, tipoContenedor, includeBarrios = 'true' } = req.query;

    const options = {
      distrito,
      tipoContenedor: tipoContenedor ? tipoContenedor.toUpperCase() : undefined,
      includeBarrios: includeBarrios === 'true'
    };

    const densityAnalysis = await Contenedor.getDensityAnalysisByDistrict(options);

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


