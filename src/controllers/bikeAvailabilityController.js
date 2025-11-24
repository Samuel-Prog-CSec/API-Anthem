/**
 * Controlador de Disponibilidad de Bicicletas
 *
 * Maneja la lógica de negocio para las operaciones relacionadas
 * con la disponibilidad de bicicletas eléctricas.
 */

const BikeAvailability = require('../models/BikeAvailability');
const { createInternalError, createNotFoundError, createBadRequestError } = require('../utils/errorUtils');
const { createPaginationMeta } = require('../utils/paginationHelper');
const { buildFilters, buildSortOptions, buildPaginationOptions } = require('../utils/queryHelper');
const { createResponse } = require('../utils/responseHelper');
const { PAGINATION, HTTP_STATUS, SPECIAL_PAGINATION_LIMITS, MONGODB_TIMEOUTS } = require('../constants');

/**
 * Obtener todos los registros de disponibilidad con filtros y paginación
 *
 * @route GET /api/bikes
 * @access Private
 */
exports.getAllBikeAvailability = async (req, res, next) => {
  try {
    // Configuración de filtros usando queryHelper
    const filterConfig = [
      { field: 'dia', type: 'dateRange', params: ['startDate', 'endDate'] }
    ];

    const filters = buildFilters(req.query, filterConfig);

    // Configurar ordenamiento usando queryHelper
    const sortMapping = {
      dia: 'dia',
      totalUsos: 'estadisticas.utilizacionTotal',
      mediaBicicletasDisponibles: 'estadisticas.totalBicicletasDisponibles',
      tasaOcupacion: 'estadisticas.tasaOcupacion'
    };
    const sortOptions = buildSortOptions(
      req.query,
      sortMapping,
      ['dia', 'totalUsos', 'mediaBicicletasDisponibles', 'tasaOcupacion'],
      'dia',
      'desc'
    );

    // Configurar paginación usando queryHelper
    const paginationOptions = buildPaginationOptions(req.query, {
      defaultLimit: SPECIAL_PAGINATION_LIMITS.BIKES.DEFAULT,
      maxLimit: PAGINATION.MAX_LIMIT
    });

    // Proyección optimizada: solo campos necesarios para listado
    // Reduce ~35% tamaño de respuesta
    const projection = {
      dia: 1,
      fecha: 1,
      'estadisticas.totalBicicletasDisponibles': 1,
      'estadisticas.totalAnclajes': 1,
      'estadisticas.utilizacionTotal': 1,
      'estadisticas.tasaOcupacion': 1,
      'detalleAbonados.tipo': 1,
      'detalleAbonados.totalUsos': 1,
      'detalleAbonados.totalBases': 1
    };

    // Ejecutar consulta con paginación y timeouts
    const [data, total] = await Promise.all([
      BikeAvailability.find(filters, projection)
        .sort(sortOptions)
        .skip(paginationOptions.skip)
        .limit(paginationOptions.limit)
        .maxTimeMS(MONGODB_TIMEOUTS.AGGREGATE_TIMEOUT_MS) // Timeout de 10 segundos
        .lean(),
      BikeAvailability.countDocuments(filters).maxTimeMS(MONGODB_TIMEOUTS.QUERY_TIMEOUT_MS) // Timeout de 5 segundos para count
    ]);

    const responseData = {
      data,
      pagination: createPaginationMeta(paginationOptions.page, paginationOptions.limit, total)
    };

    return res.status(HTTP_STATUS.OK).json(createResponse(responseData, 'Disponibilidad obtenida exitosamente'));

  } catch (error) {
    next(createInternalError('Error al obtener disponibilidad de bicicletas', error));
  }
};

/**
 * Obtener registro de disponibilidad de una fecha específica
 *
 * @route GET /api/bikes/date/:date
 * @access Private
 */
exports.getBikeAvailabilityByDate = async (req, res, next) => {
  try {
    const { date } = req.params;
    const targetDate = new Date(date);

    // Validar fecha
    if (isNaN(targetDate.getTime())) {
      return next(createBadRequestError('Formato de fecha no válido'));
    }

    const data = await BikeAvailability.findOne({ dia: targetDate })
      .select('-__v')
      .maxTimeMS(MONGODB_TIMEOUTS.QUERY_TIMEOUT_MS) // Timeout de 5 segundos
      .lean();

    if (!data) {
      return next(createNotFoundError('Datos de disponibilidad de bicicletas', date));
    }

    const responseData = {
      data
    };

    return res.status(HTTP_STATUS.OK).json(createResponse(responseData, 'Datos obtenidos exitosamente'));

  } catch (error) {
    next(createInternalError('Error al obtener disponibilidad por fecha', error));
  }
};

/**
 * Obtener estadísticas generales de disponibilidad
 *
 * @route GET /api/bikes/stats
 * @access Private
 */
exports.getBikeStats = async (req, res, next) => {
  try {
    const { startDate, endDate } = req.query;

    // Si no se proporcionan fechas, usar todo el dataset
    const start = startDate ? new Date(startDate) : new Date('2051-01-01');
    const end = endDate ? new Date(endDate) : new Date('2051-12-31');

    const stats = await BikeAvailability.getStatsByDateRange(start, end);

    if (!stats || stats.length === 0) {
      return next(createNotFoundError('Estadísticas de bicicletas', `rango ${start.toISOString().split('T')[0]} - ${end.toISOString().split('T')[0]}`));
    }

    const responseData = {
      data: {
        periodo: {
          inicio: start.toISOString().split('T')[0],
          fin: end.toISOString().split('T')[0]
        },
        estadisticas: stats[0]
      }
    };

    return res.status(HTTP_STATUS.OK).json(createResponse(responseData, 'Estadísticas obtenidas exitosamente'));

  } catch (error) {
    next(createInternalError('Error al obtener estadísticas de bicicletas', error));
  }
};

/**
 * Obtener tendencias mensuales
 *
 * @route GET /api/bikes/trends/monthly
 * @access Private
 */
exports.getMonthlyTrends = async (req, res, next) => {
  try {
    const { year = 2051 } = req.query;

    const trends = await BikeAvailability.getMonthlyTrends(parseInt(year));

    if (!trends || trends.length === 0) {
      return next(createNotFoundError('Tendencias mensuales', `año ${year}`));
    }

    // Mapear números de mes a nombres
    const monthNames = [
      'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
      'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
    ];

    const formattedTrends = trends.map(item => ({
      mes: item.mes,
      nombreMes: monthNames[item.mes - 1],
      totalUsos: item.totalUsos,
      promedioUsosDiarios: Math.round(item.promedioUsosDiarios * 100) / 100,
      promedioBicicletasDisponibles: Math.round(item.promedioBicicletasDisponibles * 100) / 100,
      totalUsosAnual: item.totalUsosAnual,
      totalUsosOcasional: item.totalUsosOcasional,
      porcentajeAnual: Math.round((item.totalUsosAnual / item.totalUsos) * 100 * 100) / 100
    }));

    const responseData = {
      data: {
        year: parseInt(year),
        tendencias: formattedTrends
      }
    };

    return res.status(HTTP_STATUS.OK).json(createResponse(responseData, 'Tendencias mensuales obtenidas exitosamente'));

  } catch (error) {
    next(createInternalError('Error al obtener tendencias mensuales', error));
  }
};

/**
 * Obtener días con mayor y menor uso
 *
 * @route GET /api/bikes/top-usage
 * @access Private
 */
exports.getTopUsageDays = async (req, res, next) => {
  try {
    const { limit = 10 } = req.query;

    const topDays = await BikeAvailability.getTopUsageDays(parseInt(limit));

    const responseData = {
      data: {
        diasMayorUso: topDays.topDays,
        diasMenorUso: topDays.bottomDays
      }
    };

    return res.status(HTTP_STATUS.OK).json(createResponse(responseData, 'Días de uso obtenidos exitosamente'));

  } catch (error) {
    next(createInternalError('Error al obtener días de mayor uso', error));
  }
};

/**
 * Comparar uso por tipo de abonado
 *
 * @route GET /api/bikes/subscription-comparison
 * @access Private
 */
exports.getSubscriptionComparison = async (req, res, next) => {
  try {
    const { startDate, endDate } = req.query;

    // Si no se proporcionan fechas, usar todo el año
    const start = startDate ? new Date(startDate) : new Date('2051-01-01');
    const end = endDate ? new Date(endDate) : new Date('2051-12-31');

    const comparison = await BikeAvailability.compareSubscriptionTypes(start, end);

    if (!comparison || comparison.length === 0) {
      return next(createNotFoundError('Datos de comparación', `rango ${start.toISOString().split('T')[0]} - ${end.toISOString().split('T')[0]}`));
    }

    const responseData = {
      data: {
        periodo: {
          inicio: start.toISOString().split('T')[0],
          fin: end.toISOString().split('T')[0]
        },
        comparacion: comparison[0]
      }
    };

    return res.status(HTTP_STATUS.OK).json(createResponse(responseData, 'Comparación obtenida exitosamente'));

  } catch (error) {
    next(createInternalError('Error al comparar tipos de abonado', error));
  }
};

/**
 * Obtener análisis de eficiencia del servicio
 *
 * @route GET /api/bikes/efficiency
 * @access Private
 */
exports.getEfficiencyAnalysis = async (req, res, next) => {
  try {
    // Construir filtros usando queryHelper
    const filterConfig = [
      { field: 'dia', type: 'dateRange', params: ['startDate', 'endDate'] }
    ];
    const filters = buildFilters(req.query, filterConfig);

    // Llamar al método optimizado del modelo
    const analysis = await BikeAvailability.getEfficiencyAnalysisOptimized(filters);

    if (!analysis) {
      return next(createNotFoundError('Datos de análisis de eficiencia'));
    }

    const responseData = {
      data: analysis
    };

    return res.status(HTTP_STATUS.OK).json(createResponse(responseData, 'Análisis de eficiencia obtenido exitosamente'));

  } catch (error) {
    next(createInternalError('Error al analizar eficiencia', error));
  }
};

/**
 * Obtener datos históricos agregados para gráficos
 *
 * @route GET /api/bikes/historical
 * @access Private
 */
exports.getHistoricalData = async (req, res, next) => {
  try {
    const { aggregation = 'day' } = req.query;

    // Construir filtros usando queryHelper
    const filterConfig = [
      { field: 'dia', type: 'dateRange', params: ['startDate', 'endDate'] }
    ];
    const filters = buildFilters(req.query, filterConfig);

    // Llamar al método optimizado del modelo
    const historicalData = await BikeAvailability.getHistoricalDataOptimized(filters, aggregation);

    const responseData = {
      data: {
        aggregation,
        total: historicalData.length,
        historico: historicalData
      }
    };

    return res.status(HTTP_STATUS.OK).json(createResponse(responseData, 'Datos históricos obtenidos exitosamente'));

  } catch (error) {
    next(createInternalError('Error al obtener datos históricos', error));
  }
};

/**
 * Tendencias de uso de bicicletas con agregación flexible
 *
 * @route GET /api/bikes/trends/usage
 * @access Private
 */
exports.getUsageTrendsAnalysis = async (req, res, next) => {
  try {
    const { startDate, endDate, groupBy = 'month', includeUserTypes = 'true' } = req.query;

    if (!startDate || !endDate) {
      return next(createBadRequestError('Se requieren los parámetros startDate y endDate'));
    }

    const options = {
      startDate: new Date(startDate),
      endDate: new Date(endDate),
      groupBy,
      includeUserTypes: includeUserTypes === 'true'
    };

    const usageTrends = await BikeAvailability.getUsageTrends(options);

    if (!usageTrends || usageTrends.length === 0) {
      return next(createNotFoundError('Tendencias de uso'));
    }

    const responseData = {
      data: {
        periodo: {
          inicio: startDate,
          fin: endDate
        },
        agrupacion: groupBy,
        includeDistribucionUsuarios: options.includeUserTypes,
        tendencias: usageTrends,
        totalPeriodos: usageTrends.length
      }
    };

    return res.status(HTTP_STATUS.OK).json(createResponse(responseData, 'Tendencias de uso obtenidas exitosamente'));

  } catch (error) {
    next(createInternalError('Error al obtener tendencias de uso', error));
  }
};

/**
 * Predicción de demanda basada en patrones históricos
 *
 * @route GET /api/bikes/prediction/demand
 * @access Private
 */
exports.getDemandPredictionAnalysis = async (req, res, next) => {
  try {
    const { startDate, endDate, threshold = '80' } = req.query;

    const options = {
      startDate: startDate ? new Date(startDate) : undefined,
      endDate: endDate ? new Date(endDate) : undefined,
      threshold: Number(threshold)
    };

    const demandPrediction = await BikeAvailability.getDemandPrediction(options);

    if (!demandPrediction) {
      return next(createNotFoundError('Datos de predicción de demanda'));
    }

    const responseData = {
      data: {
        ...(startDate && endDate && {
          periodo: {
            inicio: startDate,
            fin: endDate
          }
        }),
        umbralAltaDemanda: options.threshold,
        prediccion: demandPrediction
      }
    };

    return res.status(HTTP_STATUS.OK).json(createResponse(responseData, 'Predicción de demanda obtenida exitosamente'));

  } catch (error) {
    next(createInternalError('Error al predecir demanda', error));
  }
};



