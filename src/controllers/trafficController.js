/**
 * Controlador de Tráfico
 *
 * Gestiona las operaciones CRUD y consultas especializadas para datos de tráfico.
 */

const Traffic = require('../models/Traffic');
const Location = require('../models/Location');
const { createInternalError, createNotFoundError } = require('../utils/errorUtils');
const { createPaginationMeta, parseDateRangeFilter } = require('../utils/paginationHelper');
const { buildFilters, buildSortOptions, buildPaginationOptions } = require('../utils/queryHelper');
const { createResponse } = require('../utils/responseHelper');
const { SORT_FIELDS, PAGINATION } = require('../constants');
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
      page = 1,
      limit = 50,
      sortBy = 'fecha',
      sortOrder = 'desc'
    } = req.query;

    // Configurar paginación usando queryHelper
    const paginationOptions = buildPaginationOptions(
      { page, limit },
      { defaultLimit: PAGINATION.DEFAULT_LIMIT, maxLimit: PAGINATION.MAX_LIMIT }
    );

    // Construir filtros usando buildFilters
    const filterConfig = [
      { field: 'fecha', type: 'dateRange', params: ['startDate', 'endDate'] },
      { field: 'puntoMedidaId', type: 'exact', param: 'puntoMedidaId' },
      { field: 'tipoElemento', type: 'exact', param: 'tipoElemento', transform: v => v.toUpperCase() },
      { field: 'analisis.nivelCongestion', type: 'exact', param: 'nivelCongestion', transform: v => v.toUpperCase() },
      { field: 'calidadDatos.calidadGeneral', type: 'exact', param: 'calidad', transform: v => v.toUpperCase() }
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
      'ubicacion.nombre': 1,
      'ubicacion.distrito': 1,
      'ubicacion.tipo': 1,
      'metricas.intensidad': 1,
      'metricas.velocidad': 1,
      'metricas.ocupacion': 1,
      'metricas.carga': 1,
      'calidadDatos.calidadGeneral': 1,
      'calidadDatos.porcentajeValido': 1,
      'analisis.nivelCongestion': 1,
      'analisis.desviacionVelocidad': 1
    };

    // Ejecutar consulta principal
    const [trafficData, totalCount] = await Promise.all([
      Traffic.find(filters, projection)
        .sort(sortOptions)
        .skip(paginationOptions.skip)
        .limit(paginationOptions.limit)
        .lean(),
      Traffic.countDocuments(filters)
    ]);

    // Calcular estadísticas básicas para la respuesta
    const stats = await Traffic.aggregate([
      { $match: filters },
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
              $cond: [{ $in: ['$calidadDatos.calidadGeneral', ['ALTA', 'MEDIA']] }, 1, 0]
            }
          }
        }
      }
    ]);

    const responseData = {
      data: trafficData,
      pagination: createPaginationMeta(paginationOptions.page, paginationOptions.limit, totalCount),
      filters: {
        applied: filters,
        available: {
          tipoElemento: ['URB', 'M-30'],
          nivelCongestion: ['FLUIDO', 'DENSO', 'CONGESTIONADO', 'COLAPSADO'],
          calidad: ['ALTA', 'MEDIA', 'BAJA']
        }
      },
      stats: stats[0] || {
        intensidadPromedio: 0,
        ocupacionPromedio: 0,
        medicionesConfiables: 0
      }
    };

    logger.info({
      totalItems: totalCount,
      page: paginationOptions.page,
      filtersApplied: Object.keys(filters).length,
      endpoint: 'GET /api/traffic'
    }, 'Datos de tráfico obtenidos exitosamente');

    res.status(200).json(createResponse(responseData, 'Datos de tráfico obtenidos exitosamente'));

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
    const { startDate, endDate, limit = 100 } = req.query;

    logger.debug({
      puntoId: id,
      startDate,
      endDate,
      endpoint: 'GET /api/traffic/punto/:id'
    }, 'Obteniendo datos de tráfico por punto');

    const filters = { puntoMedidaId: id };

    // Usar helper para filtro de fechas
    const dateFilter = parseDateRangeFilter(startDate, endDate, 'fecha');
    if (dateFilter) {
      Object.assign(filters, dateFilter);
    }

    // Proyección optimizada para datos de punto específico
    const projection = {
      fecha: 1,
      'metricas.intensidad': 1,
      'metricas.velocidad': 1,
      'metricas.ocupacion': 1,
      'metricas.carga': 1,
      'calidadDatos.calidadGeneral': 1,
      'analisis.nivelCongestion': 1
    };

    const [trafficData, pointInfo] = await Promise.all([
      Traffic.find(filters, projection)
        .sort({ fecha: -1 })
        .limit(parseInt(limit))
        .lean(),
      Location.findOne({
        tipo: 'punto_trafico',
        id_punto: id
      }).lean()
    ]);

    if (!trafficData || trafficData.length === 0) {
      return next(createNotFoundError('Datos de tráfico para el punto de medida', id));
    }

    // Calcular estadísticas del punto
    const stats = await Traffic.aggregate([
      { $match: filters },
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

    res.status(200).json(createResponse(responseData, 'Datos de tráfico por punto obtenidos exitosamente'));

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
    const { startDate, endDate, tipoElemento } = req.query;

    logger.debug({
      startDate,
      endDate,
      tipoElemento,
      endpoint: 'GET /api/traffic/stats'
    }, 'Obteniendo estadísticas de tráfico');

    // Construir filtros
    const filters = {};
    const dateFilter = parseDateRangeFilter(startDate, endDate, 'fecha');
    if (dateFilter) {
      Object.assign(filters, dateFilter);
    }

    if (tipoElemento) {filters.tipoElemento = tipoElemento.toUpperCase();}

    // Llamar al método optimizado del modelo (3 agregaciones en paralelo)
    const estadisticas = await Traffic.getTrafficStatisticsOptimized(filters);

    const responseData = {
      data: estadisticas,
      periodo: {
        inicio: filters.fecha?.$gte,
        fin: filters.fecha?.$lte
      }
    };

    res.status(200).json(createResponse(responseData, 'Estadísticas de tráfico obtenidas exitosamente'));

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
    const { startDate, endDate, groupBy = 'distrito' } = req.query;

    // Construir filtros usando helper
    const filters = {};
    const dateFilter = parseDateRangeFilter(startDate, endDate, 'fecha');
    if (dateFilter) {
      Object.assign(filters, dateFilter);
    }

    // Llamar al método optimizado del modelo
    const analisis = await Traffic.getCongestionAnalysisOptimized(filters, groupBy);

    const responseData = {
      data: {
        analisis,
        agrupacion: groupBy,
        periodo: {
          inicio: filters.fecha?.$gte,
          fin: filters.fecha?.$lte
        },
        total: analisis.length
      }
    };

    res.status(200).json(createResponse(responseData, 'Análisis de congestión obtenido exitosamente'));

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
      startDate,
      endDate,
      aggregation = 'hour', // hour, day, week, month
      puntoMedidaId,
      tipoElemento
    } = req.query;

    const filters = {};

    // Usar helper para filtro de fechas
    const dateFilter = parseDateRangeFilter(startDate, endDate, 'fecha');
    if (dateFilter) {
      Object.assign(filters, dateFilter);
    }

    if (puntoMedidaId) {filters.puntoMedidaId = puntoMedidaId;}
    if (tipoElemento) {filters.tipoElemento = tipoElemento.toUpperCase();}

    // Llamar al método optimizado del modelo
    const historicalData = await Traffic.getHistoricalDataOptimized(filters, aggregation);

    const responseData = {
      data: {
        serie: historicalData,
        configuracion: {
          agregacion: aggregation,
          filtros: filters,
          periodo: {
            inicio: filters.fecha?.$gte,
            fin: filters.fecha?.$lte
          }
        },
        total: historicalData.length
      }
    };

    res.status(200).json(createResponse(responseData, 'Datos históricos obtenidos exitosamente'));

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
