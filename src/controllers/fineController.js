/**
 * Controlador de Multas
 *
 * Maneja las operaciones CRUD y consultas para datos de multas de tráfico.
 * Incluye filtrado avanzado, agregaciones estadísticas y análisis temporal
 * para el dashboard del frontend.
 */

const Fine = require('../models/Fine');
const { createInternalError, createNotFoundError } = require('../utils/errorUtils');
const { createPaginationMeta } = require('../utils/paginationHelper');
const { buildFilters, buildSortOptions, buildPaginationOptions, TRANSFORMS, parseNumericParams, buildResponseMetadata } = require('../utils/queryHelper');
const { createResponse } = require('../utils/responseHelper');
const { SORT_FIELDS, PAGINATION, HTTP_STATUS, SEVERITY_LEVELS, INFRACTION_TYPES, DATA_QUALITY_LEVELS, MONGODB_TIMEOUTS, AGGREGATION_LIMITS, TIME_CONSTANTS, FINE_CONSTANTS, DASHBOARD_PERIODS, DEFAULT_SORT_FIELDS } = require('../constants');
const logger = require('../config/logger');

/**
 * Obtener multas con filtros avanzados
 * GET /api/v1/fines
 */
const getFines = async (req, res, next) => {
  try {
    // Extraer parámetros de consulta
    const {
      conDescuento,
      esGrave,
      page = PAGINATION.DEFAULT_PAGE,
      limit = PAGINATION.DEFAULT_LIMIT,
      sortBy = DEFAULT_SORT_FIELDS.FINE,
      sortOrder = DEFAULT_SORT_FIELDS.DEFAULT_ORDER,
      includeCoordinates = false
    } = req.query;

    // Configuración de filtros usando buildFilters
    const filterConfig = [
      { field: 'fecha', type: 'dateRange', params: ['startDate', 'endDate'] },
      { field: 'calificacion', type: 'in', param: 'calificacion', transform: TRANSFORMS.toUpperCaseArray },
      { field: 'lugar', type: 'regex', param: 'lugar' },
      { field: 'metadatos.tipoInfraccion', type: 'in', param: 'tipoInfraccion' },
      { field: 'denunciante', type: 'regex', param: 'denunciante' },
      { field: 'importeFinal', type: 'numericRange', params: ['minImporte', 'maxImporte'] },
      { field: 'puntosDetraídos', type: 'numericRange', params: ['minPuntos', 'maxPuntos'] }
    ];

    const filters = buildFilters(req.query, filterConfig);

    // Filtros booleanos adicionales
    if (conDescuento !== undefined) {
      filters.tieneDescuento = conDescuento === 'true';
    }

    if (esGrave !== undefined) {
      filters['metadatos.esInfraccionGrave'] = esGrave === 'true';
    }

    // Configurar paginación usando queryHelper
    const paginationOptions = buildPaginationOptions(
      { page, limit },
      { defaultLimit: PAGINATION.DEFAULT_LIMIT, maxLimit: PAGINATION.MAX_LIMIT }
    );

    // Configurar ordenamiento usando queryHelper
    const sortMapping = {
      fecha: 'fecha',
      importeFinal: 'importeFinal',
      puntosDetraídos: 'puntosDetraídos',
      lugar: 'lugar',
      calificacion: 'calificacion'
    };
    const sortOptions = buildSortOptions(
      { sortBy, sortOrder },
      sortMapping,
      Object.keys(SORT_FIELDS.FINE),
      'fecha',
      'desc'
    );

    // Proyección optimizada: seleccionar solo campos necesarios
    const projection = {
      numeroExpediente: 1,
      fecha: 1,
      hora: 1,
      tipoInfraccion: 1,
      calificacion: 1,
      importeInicial: 1,
      importeFinal: 1,
      puntosDetraídos: 1,
      tieneDescuento: 1,
      'ubicacion.distrito': 1,
      'ubicacion.nombreVia': 1,
      'metadatos.esInfraccionGrave': 1
    };

    // Incluir coordenadas si se solicita
    if (includeCoordinates) {
      projection.coordenadas = 1;
    }

    // Ejecutar consulta con timeouts
    const [data, totalDocuments] = await Promise.all([
      Fine.find(filters, projection)
        .sort(sortOptions)
        .skip(paginationOptions.skip)
        .limit(paginationOptions.limit)
        .maxTimeMS(MONGODB_TIMEOUTS.AGGREGATE_TIMEOUT_MS) // Timeout de 10 segundos
        .lean(),
      Fine.countDocuments(filters).maxTimeMS(MONGODB_TIMEOUTS.QUERY_TIMEOUT_MS) // Timeout de 5 segundos para count
    ]);

    // Calcular metadatos de paginación usando helper
    const paginationMeta = createPaginationMeta(paginationOptions.page, paginationOptions.limit, totalDocuments);

    // Obtener estadísticas rápidas del conjunto filtrado
    const quickStatistics = await Fine.aggregate([
      { $match: filters },
      // NO usar $limit antes de $group - corrompe las estadísticas globales
      {
        $group: {
          _id: null,
          totalImporte: { $sum: '$importeFinal' },
          importePromedio: { $avg: '$importeFinal' },
          totalPuntos: { $sum: '$puntosDetraídos' },
          multasGraves: {
            $sum: { $cond: ['$metadatos.esInfraccionGrave', 1, 0] }
          },
          multasConDescuento: {
            $sum: { $cond: ['$tieneDescuento', 1, 0] }
          }
        }
      }
    ]);

    const responseData = {
      data,
      pagination: paginationMeta,
      estadisticas: quickStatistics[0] || {
        totalImporte: 0,
        importePromedio: 0,
        totalPuntos: 0,
        multasGraves: 0,
        multasConDescuento: 0
      },
      filtros: {
        aplicados: Object.keys(filters).length > 0 ? filters : null,
        disponibles: {
          calificaciones: Object.values(SEVERITY_LEVELS.FINE),
          tiposInfraccion: Object.values(INFRACTION_TYPES)
        }
      }
    };

    res.status(HTTP_STATUS.OK).json(createResponse(responseData, 'Multas obtenidas exitosamente'));

  } catch (error) {
    logger.error({
      error: error.message,
      stack: error.stack,
      query: req.query,
      endpoint: 'GET /api/v1/fines'
    }, 'Error obteniendo multas');
    next(createInternalError('Error al obtener multas', error));
  }
};

/**
 * Obtener multa por ID con detalles completos
 * GET /api/v1/fines/:id
 */
const getFineById = async (req, res, next) => {
  try {
    const { id } = req.params;

    const multa = await Fine.findById(id)
      .maxTimeMS(MONGODB_TIMEOUTS.QUERY_TIMEOUT_MS) // Timeout de 5 segundos
      .lean();

    if (!multa) {
      return next(createNotFoundError('Multa', id));
    }

    // Agregar información calculada adicional
    const impactoEconomico = {
      importeOriginal: multa.importeBoletín,
      importeFinal: multa.importeFinal,
      descuentoAplicado: multa.tieneDescuento ? multa.importeBoletín - multa.importeFinal : 0,
      porcentajeDescuento: multa.tieneDescuento ? FINE_CONSTANTS.DISCOUNT_PERCENTAGE : 0
    };

    const responseData = {
      ...multa,
      impactoEconomico,
      gravedad: multa.calificacion === SEVERITY_LEVELS.FINE.GRAVE ||
                multa.calificacion === SEVERITY_LEVELS.FINE.MUY_GRAVE ? DATA_QUALITY_LEVELS.ALTA : DATA_QUALITY_LEVELS.BAJA
    };

    res.status(HTTP_STATUS.OK).json(createResponse(responseData, 'Detalles de multa obtenidos exitosamente'));

  } catch (error) {
    logger.error({
      error: error.message,
      stack: error.stack,
      fineId: req.params.id,
      endpoint: 'GET /api/v1/fines/:id'
    }, 'Error obteniendo detalles de multa');
    next(createInternalError('Error al obtener multa por ID', error));
  }
};

/**
 * Obtener estadísticas generales de multas
 * GET /api/v1/fines/statistics
 */
const getFinesStatistics = async (req, res, next) => {
  try {
    const {
      startDate,
      endDate,
      groupBy = 'month'
    } = req.query;

    // Parsear parámetros numéricos
    const { limit } = parseNumericParams(
      req.query,
      ['limit'],
      { limit: AGGREGATION_LIMITS.MONTHLY_STATS }
    );

    // Llamar al método optimizado del modelo
    const result = await Fine.getStatisticsOptimized({
      startDate: startDate ? new Date(startDate) : null,
      endDate: endDate ? new Date(endDate) : null,
      groupBy,
      limit
    });

    const responseData = {
      estadisticas: result.estadisticas,
      resumen: result.resumen,
      configuracion: buildResponseMetadata({
        agrupacion: groupBy,
        filtros: startDate || endDate ? { startDate, endDate } : null,
        limite: limit
      })
    };

    res.status(HTTP_STATUS.OK).json(createResponse(responseData, 'Estadísticas de multas obtenidas exitosamente'));

  } catch (error) {
    logger.error({
      error: error.message,
      stack: error.stack,
      query: req.query,
      endpoint: 'GET /api/v1/fines/statistics'
    }, 'Error obteniendo estadísticas de multas');
    next(createInternalError('Error al calcular estadísticas', error));
  }
};

/**
 * Obtener ranking de ubicaciones con más multas
 * GET /api/v1/fines/locations/ranking
 */
const getLocationsRanking = async (req, res, next) => {
  try {
    const {
      startDate,
      endDate,
      tipoInfraccion
    } = req.query;

    // Parsear parámetros numéricos
    const { limit } = parseNumericParams(
      req.query,
      ['limit'],
      { limit: AGGREGATION_LIMITS.TOP_RESULTS }
    );

    // Llamar al método optimizado del modelo
    const ranking = await Fine.getLocationRankingOptimized({
      startDate: startDate ? new Date(startDate) : null,
      endDate: endDate ? new Date(endDate) : null,
      tipoInfraccion,
      limit
    });

    const responseData = {
      ranking,
      configuracion: buildResponseMetadata({
        filtros: startDate || endDate || tipoInfraccion ? { startDate, endDate, tipoInfraccion } : null,
        limite: limit
      }),
      metadatos: {
        totalUbicaciones: ranking.length,
        fechaConsulta: new Date()
      }
    };

    res.status(HTTP_STATUS.OK).json(createResponse(responseData, 'Ranking de ubicaciones obtenido exitosamente'));

  } catch (error) {
    logger.error({
      error: error.message,
      stack: error.stack,
      query: req.query,
      endpoint: 'GET /api/v1/fines/ranking/locations'
    }, 'Error obteniendo ranking de ubicaciones');
    next(createInternalError('Error al obtener ranking', error));
  }
};

/**
 * Obtener análisis temporal de multas
 * GET /api/v1/fines/analysis/temporal
 */
const getTemporalAnalysis = async (req, res, next) => {
  try {
    const {
      startDate,
      endDate,
      tipoAnalisis = 'monthly'
    } = req.query;

    // Llamar al método optimizado del modelo
    const result = await Fine.getTemporalAnalysisOptimized({
      startDate: startDate ? new Date(startDate) : null,
      endDate: endDate ? new Date(endDate) : null,
      tipoAnalisis
    });

    const responseData = {
      analisis: result.analisis,
      tendencia: result.tendencia,
      configuracion: buildResponseMetadata({
        tipoAnalisis,
        filtros: startDate || endDate ? { startDate, endDate } : null
      }),
      metadatos: {
        totalPeriodos: result.analisis.length,
        fechaConsulta: new Date()
      }
    };

    res.status(HTTP_STATUS.OK).json(createResponse(responseData, 'Análisis temporal obtenido exitosamente'));

  } catch (error) {
    logger.error({
      error: error.message,
      stack: error.stack,
      query: req.query,
      endpoint: 'GET /api/v1/fines/temporal-analysis'
    }, 'Error en análisis temporal de multas');
    next(createInternalError('Error en análisis temporal', error));
  }
};

/**
 * Obtener métricas del dashboard principal
 * GET /api/v1/fines/dashboard
 */
const getDashboardMetrics = async (req, res, next) => {
  try {
    const {
      periodo = '30days' // 7days, 30days, 90days, year
    } = req.query;

    // Calcular fechas según el periodo
    const ahora = new Date();
    let fechaInicio;

    switch (periodo) {
      case '7days':
        fechaInicio = new Date(ahora.getTime() - DASHBOARD_PERIODS.DAYS_7 * TIME_CONSTANTS.MILLISECONDS_PER_DAY);
        break;
      case '90days':
        fechaInicio = new Date(ahora.getTime() - DASHBOARD_PERIODS.DAYS_90 * TIME_CONSTANTS.MILLISECONDS_PER_DAY);
        break;
      case 'year':
        fechaInicio = new Date(ahora.getFullYear(), 0, 1);
        break;
      case '30days':
      default:
        fechaInicio = new Date(ahora.getTime() - DASHBOARD_PERIODS.DAYS_30 * TIME_CONSTANTS.MILLISECONDS_PER_DAY);
        break;
    }

    // Métricas generales del periodo
    const [metricsGeneral] = await Fine.aggregate([
      {
        $match: {
          fecha: { $gte: fechaInicio, $lte: ahora }
        }
      },
      // NO usar $limit antes de $group - corrompe las estadísticas globales
      {
        $group: {
          _id: null,
          totalMultas: { $sum: 1 },
          importeTotal: { $sum: '$importeFinal' },
          puntosTotal: { $sum: '$puntosDetraídos' },
          multasGraves: {
            $sum: { $cond: ['$metadatos.esInfraccionGrave', 1, 0] }
          },
          multasConDescuento: {
            $sum: { $cond: ['$tieneDescuento', 1, 0] }
          },
          multasVelocidad: {
            $sum: { $cond: ['$metadatos.esInfraccionVelocidad', 1, 0] }
          }
        }
      }
    ])
      .maxTimeMS(MONGODB_TIMEOUTS.AGGREGATE_TIMEOUT_MS) // Timeout de 10 segundos
      .exec();

    // Top 5 tipos de infracciones
    const topInfracciones = await Fine.aggregate([
      {
        $match: {
          fecha: { $gte: fechaInicio, $lte: ahora }
        }
      },
      // NO usar $limit antes de $group - corrompe las estadísticas
      {
        $group: {
          _id: '$metadatos.tipoInfraccion',
          cantidad: { $sum: 1 },
          importePromedio: { $avg: '$importeFinal' }
        }
      },
      { $sort: { cantidad: -1 } },
      { $limit: AGGREGATION_LIMITS.PREVIEW } // Limitar DESPUÉS de agrupar para obtener top 5 real
    ])
      .maxTimeMS(MONGODB_TIMEOUTS.AGGREGATE_TIMEOUT_MS) // Timeout de 10 segundos
      .exec();

    // Evolución diaria del periodo
    const evolucionDiaria = await Fine.aggregate([
      {
        $match: {
          fecha: { $gte: fechaInicio, $lte: ahora }
        }
      },
      // NO usar $limit antes de $group - corrompe las estadísticas
      {
        $group: {
          _id: {
            fecha: {
              $dateFromParts: {
                year: { $year: '$fecha' },
                month: { $month: '$fecha' },
                day: { $dayOfMonth: '$fecha' }
              }
            }
          },
          totalMultas: { $sum: 1 },
          importeTotal: { $sum: '$importeFinal' }
        }
      },
      { $sort: { '_id.fecha': 1 } }
    ])
      .maxTimeMS(MONGODB_TIMEOUTS.AGGREGATE_TIMEOUT_MS) // Timeout de 10 segundos
      .exec();

    const responseData = {
      periodo: {
        descripcion: periodo,
        fechaInicio,
        fechaFin: ahora
      },
      metricas: {
        general: metricsGeneral || {
          totalMultas: 0,
          importeTotal: 0,
          puntosTotal: 0,
          multasGraves: 0,
          multasConDescuento: 0,
          multasVelocidad: 0
        },
        topInfracciones,
        evolucionDiaria
      },
      resumen: {
        porcentajeGraves: metricsGeneral ?
          (metricsGeneral.multasGraves / metricsGeneral.totalMultas * 100).toFixed(2) : 0,
        importePromedioPorMulta: metricsGeneral ?
          (metricsGeneral.importeTotal / metricsGeneral.totalMultas).toFixed(2) : 0,
        puntosPromedioPorMulta: metricsGeneral ?
          (metricsGeneral.puntosTotal / metricsGeneral.totalMultas).toFixed(2) : 0
      }
    };

    res.status(HTTP_STATUS.OK).json(createResponse(responseData, 'Métricas del dashboard obtenidas exitosamente'));

  } catch (error) {
    logger.error({
      error: error.message,
      stack: error.stack,
      query: req.query,
      endpoint: 'GET /api/v1/fines/dashboard-metrics'
    }, 'Error obteniendo métricas del dashboard');
    next(createInternalError('Error al obtener métricas', error));
  }
};

module.exports = {
  getFines,
  getFineById,
  getFinesStatistics,
  getLocationsRanking,
  getTemporalAnalysis,
  getDashboardMetrics
};

