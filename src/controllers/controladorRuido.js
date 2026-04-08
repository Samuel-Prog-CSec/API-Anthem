/**
 * Controlador de Contaminación Acústica
 *
 * Maneja las operaciones CRUD y consultas para datos de contaminación acústica.
 * Incluye análisis por períodos del día, cumplimiento normativo y estadísticas.
 */

const NoiseMonitoring = require('../models/Ruido');
const { createInternalError, createNotFoundError, createBadRequestError } = require('../utils/errorUtils');
const { createPaginationMeta, buildCursorQuery, createCursorMeta } = require('../utils/paginationHelper');
const { buildFilters, buildSortOptions, buildPaginationOptions, TRANSFORMS, parseNumericParams, buildResponseMetadata } = require('../utils/queryHelper');
const { createResponse } = require('../utils/responseHelper');
const { PAGINATION, HTTP_STATUS, MONGODB_TIMEOUTS, DATASET_YEARS, AGGREGATION_LIMITS, NOISE_THRESHOLDS, ZONE_TYPES } = require('../constants');
const logger = require('../config/logger');

/**
 * Obtener datos de contaminación acústica con filtros
 * GET /api/v1.0/noise-monitoring
 */
const obtenerDatosRuido = async (req, res, next) => {
  try {
    // Configuración de filtros usando queryHelper
    const filterConfig = [
      { field: 'fecha', type: 'dateRange', params: ['startDate', 'endDate'] },
      { field: 'año', type: 'numeric', param: 'año' },
      { field: 'mes', type: 'numeric', param: 'mes' },
      { field: 'nmt', type: 'in', param: 'nmt', transform: TRANSFORMS.toIntArray },
      { field: 'nombre', type: 'regex', param: 'nombre' }
    ];

    const filters = buildFilters(req.query, filterConfig);

    // Filtro de calidad de datos
    if (req.query.includeInvalid !== 'true') {
      filters['dataQuality.hasValidData'] = true;
    }

    // Configurar ordenamiento usando queryHelper
    const sortMapping = {
      fecha: 'fecha',
      nmt: 'nmt',
      nombre: 'nombre',
      laeq24: 'laeq24',
      año: 'año',
      mes: 'mes'
    };
    const sortOptions = buildSortOptions(
      req.query,
      sortMapping,
      ['fecha', 'nmt', 'nombre', 'laeq24', 'año', 'mes'],
      'fecha',
      'desc'
    );

    // Configurar paginación usando queryHelper
    const paginationOptions = buildPaginationOptions(req.query, {
      defaultLimit: PAGINATION.DEFAULT_LIMIT,
      maxLimit: PAGINATION.MAX_LIMIT
    });

    // Proyección optimizada: seleccionar solo campos necesarios
    const projection = {
      fecha: 1,
      nmt: 1,
      nombre: 1,
      laeq24: 1,
      nivelDiurno: 1,
      nivelVespertino: 1,
      nivelNocturno: 1,
      año: 1,
      mes: 1,
      'dataQuality.hasValidData': 1
    };

    const { cursor } = req.query;
    const useCursor = Boolean(cursor);
    const primarySortField = Object.keys(sortOptions)[0] || 'fecha';
    const sortOrder = sortOptions[primarySortField] === 1 ? 'asc' : 'desc';
    const cursorFilter = useCursor ? buildCursorQuery({ cursor, sortField: primarySortField, sortOrder }) : null;
    const combinedFilters = cursorFilter ? { $and: [filters, cursorFilter] } : filters;
    const sortWithTiebreak = { ...sortOptions, _id: sortOrder === 'asc' ? 1 : -1 };

    const dataPromise = NoiseMonitoring.find(combinedFilters, projection)
      .sort(sortWithTiebreak)
      .limit(paginationOptions.limit)
      .maxTimeMS(MONGODB_TIMEOUTS.AGGREGATE_TIMEOUT_MS)
      .lean();

    const countPromise = useCursor
      ? Promise.resolve(null)
      : NoiseMonitoring.countDocuments(filters).maxTimeMS(MONGODB_TIMEOUTS.QUERY_TIMEOUT_MS);

    const [data, totalDocuments] = await Promise.all([dataPromise, countPromise]);

    // Agregar cumplimiento normativo usando método del modelo
    const dataWithCompliance = data.map(item => ({
      ...item,
      cumplimientoNormativo: NoiseMonitoring.calculateRegulatoryCompliance(item)
    }));

    const responseData = {
      data: dataWithCompliance,
      pagination: useCursor
        ? createCursorMeta({ results: data, limit: paginationOptions.limit, sortField: primarySortField, sortOrder })
        : createPaginationMeta(paginationOptions.page, paginationOptions.limit, totalDocuments),
      filters: {
        applied: Object.keys(filters).length > 0 ? filters : null
      }
    };

    res.status(HTTP_STATUS.OK).json(createResponse(responseData, 'Datos de contaminación acústica obtenidos exitosamente'));

  } catch (error) {
    logger.error({
      error: error.message,
      stack: error.stack,
      query: req.query,
      endpoint: 'GET /api/v1/noise-monitoring'
    }, 'Error obteniendo datos de contaminación acústica');
    next(createInternalError('Error al obtener datos de contaminación acústica', error));
  }
};

/**
 * Obtener estadísticas de contaminación acústica
 * GET /api/v1/noise-monitoring/statistics
 */
const obtenerEstadisticasRuido = async (req, res, next) => {
  try {
    const { groupBy = 'station' } = req.query;

    // Construir filtros usando queryHelper
    const filterConfig = [
      { field: 'fecha', type: 'dateRange', params: ['startDate', 'endDate'] },
      { field: 'nmt', type: 'numeric', param: 'nmt' }
    ];

    const matchStage = buildFilters(req.query, filterConfig);

    // Obtener estadísticas con método optimizado del modelo
    const { estadisticas, resumen } = await NoiseMonitoring.getStatisticsOptimized(matchStage, groupBy);

    const responseData = {
      data: {
        estadisticas,
        resumen,
        configuracion: buildResponseMetadata({
          agrupacion: groupBy,
          filtros: Object.keys(matchStage).length > 0 ? matchStage : null
        }),
        limitesNormativos: {
          diurno: NoiseMonitoring.LIMITES_NORMATIVOS.DIURNO,
          vespertino: NoiseMonitoring.LIMITES_NORMATIVOS.VESPERTINO,
          nocturno: NoiseMonitoring.LIMITES_NORMATIVOS.NOCTURNO,
          descripcion: 'Límites en decibelios (dB) según normativa'
        }
      }
    };

    res.status(HTTP_STATUS.OK).json(createResponse(responseData, 'Estadísticas de contaminación acústica obtenidas exitosamente'));

  } catch (error) {
    logger.error({
      error: error.message,
      stack: error.stack,
      query: req.query,
      endpoint: 'GET /api/v1/noise-monitoring/statistics'
    }, 'Error obteniendo estadísticas de contaminación acústica');
    next(createInternalError('Error al calcular estadísticas', error));
  }
};

/**
 * Obtener ranking de estaciones por nivel de ruido
 * GET /api/v1/noise-monitoring/ranking
 */
const obtenerRankingRuido = async (req, res, next) => {
  try {
    const { orderBy = 'laeq24' } = req.query;

    // Parsear parámetros numéricos
    const { limit } = parseNumericParams(
      req.query,
      ['limit'],
      { limit: AGGREGATION_LIMITS.TOP_RESULTS }
    );

    // Configuración de filtros usando queryHelper
    const filterConfig = [
      { field: 'fecha', type: 'dateRange', params: ['startDate', 'endDate'] }
    ];

    const matchStage = buildFilters(req.query, filterConfig);

    // Obtener ranking con método optimizado del modelo
    const ranking = await NoiseMonitoring.getRankingOptimized(matchStage, orderBy, limit);

    const responseData = {
      data: {
        ranking,
        configuracion: buildResponseMetadata({
          ordenadoPor: orderBy,
          descripcion: {
            laeq24: 'Nivel continuo equivalente 24h',
            diurno: 'Nivel diurno (07:00-19:00)',
            vespertino: 'Nivel vespertino (19:00-23:00)',
            nocturno: 'Nivel nocturno (23:00-07:00)'
          }[orderBy],
          limite: limit
        }),
        interpretacion: {
          orden: 'Descendente (de mayor a menor nivel de ruido)',
          limitesNormativos: NoiseMonitoring.LIMITES_NORMATIVOS
        }
      }
    };

    res.status(HTTP_STATUS.OK).json(createResponse(responseData, 'Ranking de contaminación acústica obtenido exitosamente'));

  } catch (error) {
    logger.error({
      error: error.message,
      stack: error.stack,
      query: req.query,
      endpoint: 'GET /api/v1/noise-monitoring/ranking'
    }, 'Error obteniendo ranking de contaminación acústica');
    next(createInternalError('Error al generar ranking', error));
  }
};

/**
 * Análisis de cumplimiento normativo por zona
 * GET /api/v1/noise-monitoring/compliance/zone
 */
const obtenerCumplimientoPorZona = async (req, res, next) => {
  try {
    const { startDate, endDate, threshold = NOISE_THRESHOLDS.DEFAULT, zoneType = ZONE_TYPES.MIXED } = req.query;

    const compliance = await NoiseMonitoring.getComplianceAnalysisByZone({
      startDate: startDate ? new Date(startDate) : new Date(DATASET_YEARS.DEFAULT_START_DATE),
      endDate: endDate ? new Date(endDate) : new Date(DATASET_YEARS.DEFAULT_END_DATE),
      threshold: Number(threshold),
      zoneType
    });

    if (!compliance || compliance.length === 0) {
      return next(createNotFoundError('Datos de cumplimiento normativo'));
    }

    const responseData = {
      data: {
        umbralNormativo: Number(threshold),
        tipoZona: zoneType,
        periodo: {
          inicio: startDate || DATASET_YEARS.DEFAULT_START_DATE,
          fin: endDate || DATASET_YEARS.DEFAULT_END_DATE
        },
        analisisPorZona: compliance,
        totalZonasAnalizadas: compliance.length
      }
    };

    res.status(HTTP_STATUS.OK).json(createResponse(responseData, 'Análisis de cumplimiento normativo obtenido exitosamente'));

  } catch (error) {
    logger.error({
      error: error.message,
      stack: error.stack,
      query: req.query,
      endpoint: 'GET /api/v1/noise-monitoring/compliance/zone'
    }, 'Error analizando cumplimiento normativo');
    next(createInternalError('Error al analizar cumplimiento normativo', error));
  }
};

/**
 * Obtener tendencias temporales de ruido
 * GET /api/v1/ruido/tendencias/temporal
 */
const obtenerTendenciasTemporales = async (req, res, next) => {
  try {
    const { nmt, startDate, endDate, groupBy = 'month', metric = 'laeq24' } = req.query;

    logger.debug({ query: req.query, endpoint: 'GET /api/v1/ruido/tendencias/temporal' }, 'Obteniendo tendencias temporales');

    if (!startDate || !endDate) {
      return next(createBadRequestError('Se requieren parametros startDate y endDate'));
    }

    const options = {
      startDate: new Date(startDate),
      endDate: new Date(endDate),
      groupBy,
      metric
    };

    if (nmt) {
      options.nmt = parseInt(nmt, 10);
    }

    const trends = await NoiseMonitoring.getTemporalTrends(options);

    const responseData = {
      data: trends,
      total: Array.isArray(trends) ? trends.length : 0,
      parametros: { groupBy, metric, nmt: nmt || 'todas' }
    };

    res.status(HTTP_STATUS.OK).json(createResponse(responseData, 'Tendencias temporales obtenidas exitosamente'));

  } catch (error) {
    logger.error({ error: error.message, endpoint: 'GET /api/v1/ruido/tendencias/temporal' }, 'Error al obtener tendencias temporales');
    next(createInternalError('Error al obtener tendencias temporales', error));
  }
};

module.exports = {
  obtenerDatosRuido,
  obtenerEstadisticasRuido,
  obtenerRankingRuido,
  obtenerCumplimientoPorZona,
  obtenerTendenciasTemporales
};


