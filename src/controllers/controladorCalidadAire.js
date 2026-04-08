/**
 * Controlador de Calidad de Aire
 *
 * Maneja las operaciones CRUD y consultas para datos de calidad de aire.
 * Incluye filtrado avanzado, agregaciones y análisis estadístico para el dashboard.
 */

const AirQuality = require('../models/CalidadAire');
const { createInternalError, createBadRequestError } = require('../utils/errorUtils');
const { createPaginationMeta } = require('../utils/paginationHelper');
const { buildFilters, buildSortOptions, buildPaginationOptions, validateDateRange, TRANSFORMS, parseNumericParams, executeFacetPagination } = require('../utils/queryHelper');
const { createResponse } = require('../utils/responseHelper');
const { PAGINATION, HTTP_STATUS, MONGODB_TIMEOUTS, SORT_FIELDS, DATE_RANGE_LIMITS } = require('../constants');
const logger = require('../config/logger');

/**
 * Obtener datos de calidad de aire con filtros
 * GET /api/v1/air-quality
 */
const getAirQualityData = async (req, res, next) => {
  try {
    // Configuración de filtros usando queryHelper
    const filterConfig = [
      { field: 'fecha', type: 'dateRange', params: ['startDate', 'endDate'] },
      { field: 'provincia', type: 'numeric', param: 'provincia' },
      { field: 'municipio', type: 'numeric', param: 'municipio' },
      { field: 'estacion', type: 'numeric', param: 'estacion' },
      { field: 'magnitud', type: 'in', param: 'magnitud', transform: TRANSFORMS.toIntArray },
      { field: 'puntoMuestreo', type: 'exact', param: 'puntoMuestreo' }
    ];

    const filters = buildFilters(req.query, filterConfig);

    // Filtro de calidad de datos
    if (req.query.includeInvalid !== 'true') {
      filters['processingMetadata.validMeasurements'] = { $gt: 0 };
    }

    // Validar rango de fechas usando queryHelper
    const { startDate, endDate } = req.query;
    const dateValidation = validateDateRange(startDate, endDate, DATE_RANGE_LIMITS.AIR_QUALITY_MAX_DAYS);
    if (!dateValidation.isValid) {
      return next(createBadRequestError(dateValidation.error));
    }

    // Configurar ordenamiento y paginación usando queryHelper
    const sortMapping = {
      fecha: 'fecha',
      año: 'año',
      mes: 'mes',
      estacion: 'estacion',
      magnitud: 'magnitud'
    };
    const sortOptions = buildSortOptions(
      req.query,
      sortMapping,
      SORT_FIELDS.AIR_QUALITY,
      'fecha',
      'desc'
    );

    const paginationOptions = buildPaginationOptions(req.query, {
      defaultLimit: PAGINATION.DEFAULT_LIMIT,
      maxLimit: PAGINATION.MAX_LIMIT,
      maxPage: PAGINATION.MAX_PAGE
    });

    // Ejecutar consulta con proyección optimizada
    const projection = {
      fecha: 1,
      año: 1,
      mes: 1,
      provincia: 1,
      municipio: 1,
      estacion: 1,
      magnitud: 1,
      puntoMuestreo: 1,
      medicionesHorarias: 1,
      'processingMetadata.validMeasurements': 1,
      'processingMetadata.averageValue': 1,
      'processingMetadata.maxValue': 1,
      'processingMetadata.minValue': 1,
      createdAt: 1
    };

    const {
      data,
      total: totalDocuments,
      fallback: airQualityFacetFallback,
      fallbackError: airQualityFacetError
    } = await executeFacetPagination({
      model: AirQuality,
      filters,
      sort: sortOptions,
      projection,
      pagination: paginationOptions,
      maxTimeMS: MONGODB_TIMEOUTS.AGGREGATE_TIMEOUT_MS
    });

    const responseData = {
      data,
      pagination: createPaginationMeta(paginationOptions.page, paginationOptions.limit, totalDocuments),
      filters: {
        applied: Object.keys(filters).length > 0 ? filters : null,
        available: {
          magnitudes: AirQuality.getMagnitudes()
        }
      },
      performance: airQualityFacetFallback ? {
        facetFallback: true,
        reason: airQualityFacetError
      } : undefined
    };

    res.status(HTTP_STATUS.OK).json(createResponse(responseData, 'Datos de calidad de aire obtenidos exitosamente'));

  } catch (error) {
    logger.error({
      error: error.message,
      stack: error.stack,
      query: req.query,
      endpoint: 'GET /api/v1/air-quality'
    }, 'Error obteniendo datos de calidad de aire');
    next(createInternalError('Error al obtener datos de calidad de aire', error));
  }
};

/**
 * Obtener estadísticas agregadas de calidad de aire
 * GET /api/v1/air-quality/statistics
 */
const getAirQualityStatistics = async (req, res, next) => {
  try {
    const { groupBy = 'day' } = req.query;

    // Construir filtros usando buildFilters de queryHelper
    const filterConfig = [
      { field: 'fecha', type: 'dateRange', params: ['startDate', 'endDate'] },
      { field: 'provincia', type: 'numeric', param: 'provincia' },
      { field: 'municipio', type: 'numeric', param: 'municipio' },
      { field: 'magnitud', type: 'numeric', param: 'magnitud' }
    ];

    const filters = buildFilters(req.query, filterConfig);

    // Llamar al método optimizado del modelo
    const result = await AirQuality.getStatisticsOptimized(filters, groupBy);

    const responseData = {
      message: 'Estadísticas de calidad de aire obtenidas exitosamente',
      data: {
        ...result,
        magnitudes: AirQuality.getMagnitudes()
      }
    };

    res.status(HTTP_STATUS.OK).json(createResponse(responseData, 'Estadísticas de calidad de aire obtenidas exitosamente'));

  } catch (error) {
    logger.error({
      error: error.message,
      stack: error.stack,
      query: req.query,
      endpoint: 'GET /api/v1/air-quality/statistics'
    }, 'Error obteniendo estadísticas de calidad de aire');
    next(createInternalError('Error al calcular estadísticas', error));
  }
};

/**
 * Obtener tendencias de calidad de aire
 * GET /api/v1/air-quality/trends
 */
const getAirQualityTrends = async (req, res, next) => {
  try {
    const { provincia, municipio, magnitud, startDate, endDate } = req.query;

    // Validar que se proporcionen los parámetros requeridos
    if (!provincia || !municipio || !magnitud) {
      return next(createBadRequestError('Se requieren provincia, municipio y magnitud para calcular tendencias'));
    }

    // Llamar al método optimizado del modelo
    const result = await AirQuality.getTrendsOptimized(
      provincia,
      municipio,
      magnitud,
      startDate,
      endDate
    );

    // Parsear parámetros numéricos para la respuesta
    const { provincia: provNum, municipio: munNum, magnitud: magNum } = parseNumericParams(
      req.query,
      ['provincia', 'municipio', 'magnitud'],
      {}
    );

    const responseData = {
      data: {
        ...result,
        filtros: {
          provincia: provNum,
          municipio: munNum,
          magnitud: magNum,
          magnitudDescripcion: AirQuality.getMagnitudes()[magNum]
        }
      }
    };

    res.status(HTTP_STATUS.OK).json(createResponse(responseData, 'Tendencias obtenidas exitosamente'));

  } catch (error) {
    logger.error({
      error: error.message,
      stack: error.stack,
      query: req.query,
      endpoint: 'GET /api/v1/air-quality/trends'
    }, 'Error obteniendo tendencias de calidad de aire');
    next(createInternalError('Error al calcular tendencias', error));
  }
};

module.exports = {
  getAirQualityData,
  getAirQualityStatistics,
  getAirQualityTrends
};