/**
 * Controlador de Tráfico
 *
 * Gestiona las operaciones CRUD y consultas especializadas para datos de tráfico.
 */

const Traffic = require('../models/Traffic');
const Location = require('../models/Location');
const { createInternalError, createNotFoundError } = require('../utils/errorUtils');
const { createPaginationMeta, buildCursorQuery, createCursorMeta } = require('../utils/paginationHelper');
const { buildFilters, buildSortOptions, buildPaginationOptions, TRANSFORMS, buildResponseMetadata, parseNumericParams, executeFacetPagination } = require('../utils/queryHelper');
const { createResponse } = require('../utils/responseHelper');
const { SORT_FIELDS, PAGINATION, HTTP_STATUS, CONGESTION_LEVELS, DATA_QUALITY_LEVELS, TRAFFIC_ELEMENT_TYPES, MONGODB_TIMEOUTS } = require('../constants');
const logger = require('../config/logger');

/**
 * Obtener todas las mediciones de tráfico con filtros avanzados
 * GET /api/traffic
 */
const getAllTrafficData = async (req, res, next) => {
  try {
    logger.debug({
      query: req.query,
      userId: req.user?.id,
      endpoint: 'GET /api/traffic'
    }, 'Obteniendo datos de tráfico con filtros');

    const {
      page = PAGINATION.DEFAULT_PAGE,
      limit = PAGINATION.DEFAULT_LIMIT,
      sortBy = SORT_FIELDS.TRAFFIC.DEFAULT_SORT_BY,
      sortOrder = SORT_FIELDS.DEFAULT_SORT_ORDER
    } = req.query;

    // Configurar paginación usando queryHelper
    const paginationOptions = buildPaginationOptions(
      { page, limit },
      { defaultLimit: PAGINATION.DEFAULT_LIMIT, maxLimit: PAGINATION.MAX_LIMIT }
    );

    const { cursor } = req.query;
    const useCursor = Boolean(cursor);

    // Construir filtros usando buildFilters
    const filterConfig = [
      { field: 'fecha', type: 'dateRange', params: ['startDate', 'endDate'] },
      { field: 'puntoMedidaId', type: 'exact', param: 'puntoMedidaId' },
      { field: 'tipoElemento', type: 'exact', param: 'tipoElemento', transform: TRANSFORMS.toUpperCase },
      { field: 'analisis.nivelCongestion', type: 'exact', param: 'nivelCongestion', transform: TRANSFORMS.toUpperCase },
      { field: 'calidadDatos.calidadGeneral', type: 'exact', param: 'calidad', transform: TRANSFORMS.toUpperCase }
    ];

    const filters = buildFilters(req.query, filterConfig);

    // Configurar ordenamiento usando queryHelper
    const sortMapping = {
      fecha: 'fecha',
      intensidad: 'metricas.intensidad',
      ocupacion: 'metricas.ocupacion',
      puntoMedidaId: 'puntoMedidaId'
    };
    const sortOptions = buildSortOptions(
      { sortBy, sortOrder },
      sortMapping,
      Object.keys(SORT_FIELDS.TRAFFIC),
      'fecha',
      'desc'
    );

    // Proyección optimizada: solo campos necesarios para listado
    // Reduce ~40% tamaño de respuesta y memoria
    const projection = {
      fecha: 1,
      puntoMedidaId: 1,
      tipoElemento: 1,
      'metricas.intensidad': 1,
      'metricas.velocidadMedia': 1,
      'metricas.ocupacion': 1,
      'metricas.carga': 1,
      'calidadDatos.calidadGeneral': 1,
      'calidadDatos.porcentajeValido': 1,
      'analisis.nivelCongestion': 1,
      'analisis.clasificacionIntensidad': 1
    };

    const primarySortField = Object.keys(sortOptions)[0] || 'fecha';
    const cursorSortOrder = sortOptions[primarySortField] === 1 ? 'asc' : 'desc';
    const cursorFilter = useCursor ? buildCursorQuery({ cursor, sortField: primarySortField, sortOrder: cursorSortOrder }) : null;
    const combinedFilters = cursorFilter ? { $and: [filters, cursorFilter] } : filters;
    const sortWithTiebreak = { ...sortOptions, _id: cursorSortOrder === 'asc' ? 1 : -1 };

    let trafficData = [];
    let totalCount = null;
    let trafficFacetFallback = false;
    let trafficFacetError = null;

    if (useCursor) {
      trafficData = await Traffic.find(combinedFilters, projection)
        .sort(sortWithTiebreak)
        .limit(paginationOptions.limit)
        .maxTimeMS(MONGODB_TIMEOUTS.QUERY_TIMEOUT_MS)
        .lean();
    } else {
      const facetResult = await executeFacetPagination({
        model: Traffic,
        filters,
        sort: sortOptions,
        projection,
        pagination: paginationOptions,
        maxTimeMS: MONGODB_TIMEOUTS.AGGREGATE_TIMEOUT_MS
      });

      trafficData = facetResult.data;
      totalCount = facetResult.total;
      trafficFacetFallback = facetResult.fallback;
      trafficFacetError = facetResult.fallbackError;
    }

    // Calcular estadísticas básicas para la respuesta
    const stats = await Traffic.aggregate([
      { $match: filters },
      // NO usar $limit antes de $group - corrompe las estadísticas globales
      {
        $group: {
          _id: null,
          intensidadPromedio: {
            $avg: {
              $cond: [{ $gte: ['$metricas.intensidad', 0] }, '$metricas.intensidad', null]
            }
          },
          ocupacionPromedio: {
            $avg: {
              $cond: [{ $gte: ['$metricas.ocupacion', 0] }, '$metricas.ocupacion', null]
            }
          },
          medicionesConfiables: {
            $sum: {
              $cond: [{ $in: ['$calidadDatos.calidadGeneral', [DATA_QUALITY_LEVELS.ALTA, DATA_QUALITY_LEVELS.MEDIA]] }, 1, 0]
            }
          }
        }
      }
    ]);

    const responseData = {
      data: trafficData,
      pagination: useCursor
        ? createCursorMeta({ results: trafficData, limit: paginationOptions.limit, sortField: primarySortField, sortOrder: cursorSortOrder })
        : createPaginationMeta(paginationOptions.page, paginationOptions.limit, totalCount),
      filters: {
        applied: filters,
        available: {
          tipoElemento: Object.values(TRAFFIC_ELEMENT_TYPES),
          nivelCongestion: Object.values(CONGESTION_LEVELS),
          calidad: Object.values(DATA_QUALITY_LEVELS)
        }
      },
      stats: stats[0] || {
        intensidadPromedio: 0,
        ocupacionPromedio: 0,
        medicionesConfiables: 0
      },
      performance: useCursor ? {
        cursorPagination: true
      } : trafficFacetFallback ? {
        facetFallback: true,
        reason: trafficFacetError
      } : undefined
    };

    logger.info({
      totalItems: totalCount,
      page: paginationOptions.page,
      filtersApplied: Object.keys(filters).length,
      endpoint: 'GET /api/traffic'
    }, 'Datos de tráfico obtenidos exitosamente');

    res.status(HTTP_STATUS.OK).json(createResponse(responseData, 'Datos de tráfico obtenidos exitosamente'));

  } catch (error) {
    logger.error({
      error: error.message,
      stack: error.stack,
      query: req.query,
      endpoint: 'GET /api/traffic'
    }, 'Error al obtener datos de tráfico');
    next(createInternalError('Error al obtener los datos de tráfico', error));
  }
};

/**
 * Obtener datos de un punto de medida específico
 * GET /api/traffic/punto/:id
 */
const getTrafficByPoint = async (req, res, next) => {
  try {
    const { id } = req.params;

    // Parsear parámetros numéricos con valores por defecto
    const { limit } = parseNumericParams(
      req.query,
      ['limit'],
      { limit: PAGINATION.DEFAULT_LIMIT }
    );

    logger.debug({
      puntoId: id,
      query: req.query,
      endpoint: 'GET /api/traffic/punto/:id'
    }, 'Obteniendo datos de tráfico por punto');

    // Construir filtros usando queryHelper
    const filterConfig = [
      { field: 'puntoMedidaId', type: 'exact', param: 'puntoMedidaId' },
      { field: 'fecha', type: 'dateRange', params: ['startDate', 'endDate'] }
    ];
    const filters = buildFilters({ ...req.query, puntoMedidaId: id }, filterConfig);

    // Proyección optimizada para datos de punto específico
    const projection = {
      fecha: 1,
      'metricas.intensidad': 1,
      'metricas.velocidadMedia': 1,
      'metricas.ocupacion': 1,
      'metricas.carga': 1,
      'calidadDatos.calidadGeneral': 1,
      'analisis.nivelCongestion': 1
    };

    const [trafficData, pointInfo] = await Promise.all([
      Traffic.find(filters, projection)
        .sort({ fecha: -1 })
        .limit(limit)
        .maxTimeMS(MONGODB_TIMEOUTS.AGGREGATE_TIMEOUT_MS) // Timeout de 10 segundos
        .lean(),
      Location.findOne({
        tipo: 'punto_trafico',
        id_punto: id
      })
      .maxTimeMS(MONGODB_TIMEOUTS.QUERY_TIMEOUT_MS) // Timeout de 5 segundos
      .lean()
    ]);

    if (!trafficData || trafficData.length === 0) {
      return next(createNotFoundError('Datos de tráfico para el punto de medida', id));
    }

    // Calcular estadísticas del punto
    const stats = await Traffic.aggregate([
      { $match: filters },
      // NO usar $limit antes de $group - corrompe las estadísticas
      {
        $group: {
          _id: null,
          totalMediciones: { $sum: 1 },
          intensidadPromedio: {
            $avg: { $cond: [{ $gte: ['$metricas.intensidad', 0] }, '$metricas.intensidad', null] }
          },
          intensidadMaxima: {
            $max: { $cond: [{ $gte: ['$metricas.intensidad', 0] }, '$metricas.intensidad', null] }
          },
          ocupacionPromedio: {
            $avg: { $cond: [{ $gte: ['$metricas.ocupacion', 0] }, '$metricas.ocupacion', null] }
          },
          cargaPromedio: {
            $avg: { $cond: [{ $gte: ['$metricas.carga', 0] }, '$metricas.carga', null] }
          },
          velocidadPromedio: {
            $avg: { $cond: [{ $gte: ['$metricas.velocidadMedia', 0] }, '$metricas.velocidadMedia', null] }
          }
        }
      }
    ]);

    const responseData = {
      data: {
        punto: pointInfo,
        mediciones: trafficData,
        estadisticas: stats[0] || {}
      }
    };

    res.status(HTTP_STATUS.OK).json(createResponse(responseData, 'Datos de tráfico por punto obtenidos exitosamente'));

  } catch (error) {
    logger.error({
      error: error.message,
      stack: error.stack,
      puntoId: req.params.id,
      endpoint: 'GET /api/traffic/punto/:id'
    }, 'Error al obtener datos de tráfico por punto');
    next(createInternalError('Error al obtener datos del punto de medida', error));
  }
};

/**
 * Obtener estadísticas generales de tráfico
 * GET /api/traffic/stats
 */
const getTrafficStats = async (req, res, next) => {
  try {
    const { tipoElemento: _tipoElemento } = req.query;

    logger.debug({
      query: req.query,
      endpoint: 'GET /api/traffic/stats'
    }, 'Obteniendo estadísticas de tráfico');

    // Construir filtros usando queryHelper
    const filterConfig = [
      { field: 'fecha', type: 'dateRange', params: ['startDate', 'endDate'] },
      { field: 'tipoElemento', type: 'exact', param: 'tipoElemento', transform: TRANSFORMS.toUpperCase }
    ];
    const filters = buildFilters(req.query, filterConfig);

    // Llamar al método optimizado del modelo (3 agregaciones en paralelo)
    const statistics = await Traffic.getTrafficStatisticsOptimized(filters);

    const responseData = {
      data: statistics,
      periodo: {
        inicio: filters.fecha?.$gte,
        fin: filters.fecha?.$lte
      }
    };

    res.status(HTTP_STATUS.OK).json(createResponse(responseData, 'Estadísticas de tráfico obtenidas exitosamente'));

  } catch (error) {
    logger.error({
      error: error.message,
      stack: error.stack,
      query: req.query,
      endpoint: 'GET /api/traffic/stats'
    }, 'Error obteniendo estadísticas de tráfico');
    next(createInternalError('Error al obtener estadísticas de tráfico', error));
  }
};

/**
 * Obtener análisis de congestión por zonas
 * GET /api/traffic/congestion-analysis
 */
const getCongestionAnalysis = async (req, res, next) => {
  try {
    const { groupBy = 'distrito' } = req.query;

    // Construir filtros usando queryHelper
    const filterConfig = [
      { field: 'fecha', type: 'dateRange', params: ['startDate', 'endDate'] }
    ];
    const filters = buildFilters(req.query, filterConfig);

    // Llamar al método optimizado del modelo
    const analysis = await Traffic.getCongestionAnalysisOptimized(filters, groupBy);

    const responseData = {
      data: {
        analisis: analysis,
        agrupacion: groupBy,
        periodo: {
          inicio: filters.fecha?.$gte,
          fin: filters.fecha?.$lte
        },
        total: analysis.length
      }
    };

    res.status(HTTP_STATUS.OK).json(createResponse(responseData, 'Análisis de congestión obtenido exitosamente'));

  } catch (error) {
    logger.error({
      error: error.message,
      stack: error.stack,
      query: req.query,
      endpoint: 'GET /api/traffic/congestion-analysis'
    }, 'Error en análisis de congestión');
    next(createInternalError('Error al analizar la congestión', error));
  }
};

/**
 * Obtener datos históricos para gráficos (agregados por periodo)
 * GET /api/traffic/historical
 */
const getHistoricalData = async (req, res, next) => {
  try {
    const {
      aggregation = 'hour', // hour, day, week, month
      puntoMedidaId: _puntoMedidaId,
      tipoElemento: _tipoElemento
    } = req.query;

    // Construir filtros usando queryHelper
    const filterConfig = [
      { field: 'fecha', type: 'dateRange', params: ['startDate', 'endDate'] },
      { field: 'puntoMedidaId', type: 'exact', param: 'puntoMedidaId' },
      { field: 'tipoElemento', type: 'exact', param: 'tipoElemento', transform: TRANSFORMS.toUpperCase }
    ];
    const filters = buildFilters(req.query, filterConfig);

    // Llamar al método optimizado del modelo
    const historicalData = await Traffic.getHistoricalDataOptimized(filters, aggregation);

    const responseData = {
      data: {
        serie: historicalData,
        configuracion: buildResponseMetadata({
          agregacion: aggregation,
          filtros: filters,
          periodo: {
            inicio: filters.fecha?.$gte,
            fin: filters.fecha?.$lte
          }
        }),
        total: historicalData.length
      }
    };

    res.status(HTTP_STATUS.OK).json(createResponse(responseData, 'Datos históricos obtenidos exitosamente'));

  } catch (error) {
    logger.error({
      error: error.message,
      stack: error.stack,
      query: req.query,
      endpoint: 'GET /api/traffic/historical'
    }, 'Error al obtener datos históricos');
    next(createInternalError('Error al obtener datos históricos', error));
  }
};

module.exports = {
  getAllTrafficData,
  getTrafficByPoint,
  getTrafficStats,
  getCongestionAnalysis,
  getHistoricalData
};

