/**
 * Controlador de Disponibilidad de Bicicletas
 *
 * Maneja la lógica de negocio para las operaciones relacionadas
 * con la disponibilidad de bicicletas eléctricas.
 */

const BikeAvailability = require('../models/DisponibilidadBicicletas');
const { createInternalError, createNotFoundError } = require('../utils/errorUtils');
const { createPaginationMeta, buildCursorQuery, createCursorMeta } = require('../utils/paginationHelper');
const { buildFilters, buildSortOptions, buildPaginationOptions, parseNumericParams } = require('../utils/queryHelper');
const { createResponse } = require('../utils/responseHelper');
const { PAGINATION, HTTP_STATUS, SPECIAL_PAGINATION_LIMITS, MONGODB_TIMEOUTS, DATASET_YEARS, MONTH_NAMES, AGGREGATION_LIMITS } = require('../constants');

/**
 * Obtener todos los registros de disponibilidad con filtros y paginación
 *
 * @route GET /api/bikes
 * @access Private
 */
exports.obtenerDisponibilidad = async (req, res, next) => {
  try {
    // Configuración de filtros usando queryHelper
    const filterConfig = [
      { field: 'dia', type: 'dateRange', params: ['startDate', 'endDate'] }
    ];

    const filters = buildFilters(req.query, filterConfig);

    // Configurar ordenamiento usando queryHelper
    const sortMapping = {
      dia: 'dia',
      totalUsos: 'totalUsos',
      mediaBicicletasDisponibles: 'mediaBicicletasDisponibles',
      tasaOcupacion: 'tasaOcupacion'
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

    // Proyeccion optimizada: solo campos necesarios para listado
    const projection = {
      dia: 1,
      mediaBicicletasDisponibles: 1,
      totalUsos: 1,
      usosAbonadoAnual: 1,
      usosAbonadoOcasional: 1,
      tasaOcupacion: 1,
      promedioUsosPorBicicleta: 1
    };

    const { cursor } = req.query;
    const useCursor = Boolean(cursor);
    const primarySortField = Object.keys(sortOptions)[0] || 'dia';
    const sortOrder = sortOptions[primarySortField] === 1 ? 'asc' : 'desc';
    const cursorFilter = useCursor ? buildCursorQuery({ cursor, sortField: primarySortField, sortOrder }) : null;
    const combinedFilters = cursorFilter ? { $and: [filters, cursorFilter] } : filters;
    const sortWithTiebreak = { ...sortOptions, _id: sortOrder === 'asc' ? 1 : -1 };

    const dataPromise = BikeAvailability.find(combinedFilters, projection)
      .sort(sortWithTiebreak)
      .limit(paginationOptions.limit)
      .maxTimeMS(MONGODB_TIMEOUTS.AGGREGATE_TIMEOUT_MS)
      .lean();

    const countPromise = useCursor
      ? Promise.resolve(null)
      : BikeAvailability.countDocuments(filters).maxTimeMS(MONGODB_TIMEOUTS.QUERY_TIMEOUT_MS);

    const [data, total] = await Promise.all([dataPromise, countPromise]);

    const responseData = {
      data,
      pagination: useCursor
        ? createCursorMeta({ results: data, limit: paginationOptions.limit, sortField: primarySortField, sortOrder })
        : createPaginationMeta(paginationOptions.page, paginationOptions.limit, total)
    };

    return res.status(HTTP_STATUS.OK).json(createResponse(responseData, 'Disponibilidad obtenida exitosamente'));

  } catch (error) {
    next(createInternalError('Error al obtener disponibilidad de bicicletas', error));
  }
};

/**
 * Obtener estadísticas generales de disponibilidad
 *
 * @route GET /api/bikes/stats
 * @access Private
 */
exports.obtenerEstadisticas = async (req, res, next) => {
  try {
    const { startDate, endDate } = req.query;

    // Si no se proporcionan fechas, usar todo el dataset
    const start = startDate ? new Date(startDate) : new Date(DATASET_YEARS.DEFAULT_START_DATE);
    const end = endDate ? new Date(endDate) : new Date(DATASET_YEARS.DEFAULT_END_DATE);

    const stats = await BikeAvailability.obtenerEstadisticasPorRangoFechas(start, end);

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
exports.obtenerTendenciasMensuales = async (req, res, next) => {
  try {
    // Parsear parámetros numéricos
    const { year } = parseNumericParams(
      req.query,
      ['year'],
      { year: DATASET_YEARS.DEFAULT_YEAR }
    );

    const trends = await BikeAvailability.obtenerTendenciasMensuales(year);

    if (!trends || trends.length === 0) {
      return next(createNotFoundError('Tendencias mensuales', `año ${year}`));
    }

    const formattedTrends = trends.map(item => ({
      mes: item.mes,
      nombreMes: MONTH_NAMES[item.mes - 1],
      totalUsos: item.totalUsos,
      promedioUsosDiarios: Math.round(item.promedioUsosDiarios * 100) / 100,
      promedioBicicletasDisponibles: Math.round(item.promedioBicicletasDisponibles * 100) / 100,
      totalUsosAnual: item.totalUsosAnual,
      totalUsosOcasional: item.totalUsosOcasional,
      porcentajeAnual: Math.round((item.totalUsosAnual / item.totalUsos) * 100 * 100) / 100
    }));

    const responseData = {
      data: {
        year,
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
exports.obtenerDiasMayorUso = async (req, res, next) => {
  try {
    // Parsear parámetros numéricos
    const { limit } = parseNumericParams(
      req.query,
      ['limit'],
      { limit: AGGREGATION_LIMITS.TOP_RESULTS }
    );

    const topDays = await BikeAvailability.obtenerDiasMayorUso(limit);

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
exports.obtenerComparativaSuscripciones = async (req, res, next) => {
  try {
    const { startDate, endDate } = req.query;

    // Si no se proporcionan fechas, usar todo el año
    const start = startDate ? new Date(startDate) : new Date(DATASET_YEARS.DEFAULT_START_DATE);
    const end = endDate ? new Date(endDate) : new Date(DATASET_YEARS.DEFAULT_END_DATE);

    const comparison = await BikeAvailability.compararTiposSuscripcion(start, end);

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



