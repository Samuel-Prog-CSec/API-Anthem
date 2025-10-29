/**
 * Controlador de Tráfico
 *
 * Gestiona las operaciones CRUD y consultas especializadas para datos de tráfico.
 */

const Traffic = require('../models/Traffic');
const Location = require('../models/Location');
const { validationResult } = require('express-validator');
const { AppError } = require('../utils/errorUtils');
const { parsePaginationParams, createPaginationMeta, parseDateRangeFilter } = require('../utils/paginationHelper');
const { buildSortOptions, buildPaginationOptions } = require('../utils/queryHelper');
const { SORT_FIELDS, PAGINATION } = require('../constants');

/**
 * Obtener todas las mediciones de tráfico con filtros avanzados
 * GET /api/traffic
 */
const getAllTrafficData = async (req, res, next) => {
  try {
    console.log('Obteniendo datos de tráfico con filtros', {
      query: req.query,
      user: req.user?.id
    });
    const {
      page = 1,
      limit = 50,
      startDate,
      endDate,
      puntoMedidaId,
      tipoElemento,
      nivelCongestion,
      calidad,
      sortBy = 'fecha',
      sortOrder = 'desc'
    } = req.query;

    // Configurar paginación usando queryHelper
    const paginationOptions = buildPaginationOptions(
      { page, limit },
      { defaultLimit: PAGINATION.DEFAULT_LIMIT, maxLimit: PAGINATION.MAX_LIMIT }
    );

    // Construir filtros
    const filters = {};

    // Filtros temporales usando helper
    const dateFilter = parseDateRangeFilter(startDate, endDate, 'fecha');
    if (dateFilter) {
      Object.assign(filters, dateFilter);
    }

    // Filtros específicos
    if (puntoMedidaId) filters.puntoMedidaId = puntoMedidaId;
    if (tipoElemento) filters.tipoElemento = tipoElemento.toUpperCase();
    if (nivelCongestion) filters['analisis.nivelCongestion'] = nivelCongestion.toUpperCase();
    if (calidad) filters['calidadDatos.calidadGeneral'] = calidad.toUpperCase();

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

    // Ejecutar consulta principal
    const [trafficData, totalCount] = await Promise.all([
      Traffic.find(filters)
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

    const response = {
      success: true,
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

    console.log('Datos de tráfico obtenidos exitosamente', {
      totalItems: totalCount,
      page: paginationOptions.page,
      filters: Object.keys(filters)
    });

    res.status(200).json(response);

  } catch (error) {
    console.log('Error al obtener datos de tráfico', {
      error: error.message,
      stack: error.stack,
      query: req.query
    });
    next(new AppError('Error al obtener los datos de tráfico', 500));
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

    console.log('Obteniendo datos de tráfico por punto', {
      puntoId: id,
      startDate,
      endDate
    });

    const filters = { puntoMedidaId: id };

    // Usar helper para filtro de fechas
    const dateFilter = parseDateRangeFilter(startDate, endDate, 'fecha');
    if (dateFilter) {
      Object.assign(filters, dateFilter);
    }

    const [trafficData, pointInfo] = await Promise.all([
      Traffic.find(filters)
        .sort({ fecha: -1 })
        .limit(parseInt(limit))
        .lean(),
      Location.findOne({
        tipo: 'punto_trafico',
        id_punto: id
      }).lean()
    ]);

    if (!trafficData || trafficData.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'No se encontraron datos para el punto de medida especificado'
      });
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

    const response = {
      success: true,
      data: {
        punto: pointInfo,
        mediciones: trafficData,
        estadisticas: stats[0] || {}
      }
    };

    res.status(200).json(response);

  } catch (error) {
    console.log('Error al obtener datos de tráfico por punto', {
      error: error.message,
      puntoId: req.params.id
    });
    next(new AppError('Error al obtener datos del punto de medida', 500));
  }
};

/**
 * Obtener estadísticas generales de tráfico
 * GET /api/traffic/stats
 */
const getTrafficStats = async (req, res, next) => {
  try {
    const { startDate, endDate, tipoElemento } = req.query;

    console.log('Obteniendo estadísticas de tráfico', {
      startDate,
      endDate,
      tipoElemento
    });

    // Construir filtros
    const filters = {};
    const dateFilter = parseDateRangeFilter(startDate, endDate, 'fecha');
    if (dateFilter) {
      Object.assign(filters, dateFilter);
    }

    if (tipoElemento) {filters.tipoElemento = tipoElemento.toUpperCase();}

    // Llamar al método optimizado del modelo (3 agregaciones en paralelo)
    const estadisticas = await Traffic.getTrafficStatisticsOptimized(filters);

    res.status(200).json({
      success: true,
      data: estadisticas,
      periodo: {
        inicio: filters.fecha?.$gte,
        fin: filters.fecha?.$lte
      }
    });

  } catch (error) {
    console.error('Error obteniendo estadísticas de tráfico', {
      error: error.message
    });
    next(new AppError('Error al obtener estadísticas de tráfico', 500));
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

    res.status(200).json({
      success: true,
      data: {
        analisis,
        agrupacion: groupBy,
        periodo: {
          inicio: filters.fecha?.$gte,
          fin: filters.fecha?.$lte
        },
        total: analisis.length
      }
    });

  } catch (error) {
    console.error('Error en análisis de congestión', {
      error: error.message
    });
    next(new AppError('Error al analizar la congestión', 500));
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

    res.status(200).json({
      success: true,
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
    });

  } catch (error) {
    console.error('Error al obtener datos históricos', {
      error: error.message,
      query: req.query
    });
    next(new AppError('Error al obtener datos históricos', 500));
  }
};

module.exports = {
  getAllTrafficData,
  getTrafficByPoint,
  getTrafficStats,
  getCongestionAnalysis,
  getHistoricalData
};
