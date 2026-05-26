/**
 * Controlador de Calidad de Aire
 *
 * Maneja las operaciones CRUD y consultas para datos de calidad de aire.
 * Incluye filtrado avanzado, agregaciones y analisis estadistico para el dashboard.
 */

const AirQuality = require('../models/CalidadAire');
const { createBadRequestError } = require('../utils/errorUtils');
const { createPaginationMeta } = require('../utils/paginationHelper');
const { buildFilters, buildSortOptions, buildPaginationOptions, validateDateRange, TRANSFORMS, parseNumericParams, executeFacetPagination } = require('../utils/queryHelper');
const { createResponse } = require('../utils/responseHelper');
const { PAGINATION, HTTP_STATUS, MONGODB_TIMEOUTS, SORT_FIELDS, DATE_RANGE_LIMITS } = require('../constants');
const asyncHandler = require('../utils/asyncHandler');

/**
 * Obtener datos de calidad de aire con filtros
 * GET /api/v1/calidad-aire
 */
const obtenerDatosCalidadAire = asyncHandler(async (req, res, next) => {
  // Configuracion de filtros usando queryHelper
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

  // Configurar ordenamiento y paginacion usando queryHelper
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

  // Ejecutar consulta con proyeccion optimizada
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
    'processingMetadata.dataQualityScore': 1,
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
        magnitudes: AirQuality.obtenerMagnitudes()
      }
    },
    performance: airQualityFacetFallback ? {
      facetFallback: true,
      reason: airQualityFacetError
    } : undefined
  };

  res.status(HTTP_STATUS.OK).json(createResponse(responseData, 'Datos de calidad de aire obtenidos exitosamente'));
});

/**
 * Obtener estadisticas agregadas de calidad de aire
 * GET /api/v1/calidad-aire/estadisticas
 */
const obtenerEstadisticasCalidadAire = asyncHandler(async (req, res) => {
  const { groupBy: rawGroupBy = 'day' } = req.query;
  const groupBy = typeof rawGroupBy === 'string' ? rawGroupBy.toLowerCase() : 'day';

  // Construir filtros usando buildFilters de queryHelper
  const filterConfig = [
    { field: 'fecha', type: 'dateRange', params: ['startDate', 'endDate'] },
    { field: 'provincia', type: 'numeric', param: 'provincia' },
    { field: 'municipio', type: 'numeric', param: 'municipio' },
    { field: 'magnitud', type: 'numeric', param: 'magnitud' }
  ];

  const filters = buildFilters(req.query, filterConfig);

  // Llamar al metodo optimizado del modelo
  const result = await AirQuality.obtenerEstadisticasOptimizadas(filters, groupBy);

  const responseData = {
    ...result,
    magnitudes: AirQuality.obtenerMagnitudes()
  };

  res.status(HTTP_STATUS.OK).json(createResponse(responseData, 'Estadisticas de calidad de aire obtenidas exitosamente'));
});

/**
 * Obtener tendencias de calidad de aire
 * GET /api/v1/calidad-aire/tendencias
 */
const obtenerTendenciasCalidadAire = asyncHandler(async (req, res, next) => {
  const { provincia, municipio, magnitud, startDate, endDate } = req.query;

  // Validar que se proporcionen los parametros requeridos
  if (!provincia || !municipio || !magnitud) {
    return next(createBadRequestError('Se requieren provincia, municipio y magnitud para calcular tendencias'));
  }

  // Llamar al metodo optimizado del modelo
  const result = await AirQuality.obtenerTendenciasOptimizadas(
    provincia,
    municipio,
    magnitud,
    startDate,
    endDate
  );

  // Parsear parametros numericos para la respuesta
  const { provincia: provNum, municipio: munNum, magnitud: magNum } = parseNumericParams(
    req.query,
    ['provincia', 'municipio', 'magnitud'],
    {}
  );

  const responseData = {
    ...result,
    filtros: {
      provincia: provNum,
      municipio: munNum,
      magnitud: magNum,
      magnitudDescripcion: AirQuality.obtenerMagnitudes()[magNum]
    }
  };

  res.status(HTTP_STATUS.OK).json(createResponse(responseData, 'Tendencias obtenidas exitosamente'));
});

module.exports = {
  obtenerDatosCalidadAire,
  obtenerEstadisticasCalidadAire,
  obtenerTendenciasCalidadAire
};
