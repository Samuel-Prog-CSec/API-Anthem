/**
 * Controlador de Calidad de Aire
 *
 * Maneja las operaciones CRUD y consultas para datos de calidad de aire.
 * Incluye filtrado avanzado, agregaciones y análisis estadístico para el dashboard.
 */

const { validationResult } = require('express-validator');
const AirQuality = require('../models/AirQuality');
const { AppError, createValidationError, createInternalError, createNotFoundError } = require('../utils/errorUtils');
const { createPaginationMeta } = require('../utils/paginationHelper');
const { buildFilters, buildSortOptions, buildPaginationOptions, validateDateRange } = require('../utils/queryHelper');
const { createResponse } = require('../utils/responseHelper');
const { SORT_FIELDS, PAGINATION, HTTP_STATUS, VALIDATION_CODES, MONGODB_TIMEOUTS } = require('../constants');
const logger = require('../config/logger');

/**
 * Obtener datos de calidad de aire con filtros
 * GET /api/v1/air-quality
 */
const getAirQualityData = async (req, res, next) => {
  try {
    // Verificar errores de validación
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return next(createValidationError('Parámetros de consulta inválidos', errors.array()));
    }

    // Configuración de filtros usando queryHelper
    const filterConfig = [
      { field: 'fecha', type: 'dateRange', params: ['startDate', 'endDate'] },
      { field: 'provincia', type: 'numeric', param: 'provincia' },
      { field: 'municipio', type: 'numeric', param: 'municipio' },
      { field: 'estacion', type: 'numeric', param: 'estacion' },
      { field: 'magnitud', type: 'in', param: 'magnitud', transform: v => Array.isArray(v) ? v.map(m => parseInt(m)) : [parseInt(v)] },
      { field: 'puntoMuestreo', type: 'exact', param: 'puntoMuestreo' }
    ];

    const filters = buildFilters(req.query, filterConfig);

    // Filtro de calidad de datos
    if (req.query.includeInvalid !== 'true') {
      filters['processingMetadata.validMeasurements'] = { $gt: 0 };
    }

    // Validar rango de fechas usando queryHelper
    const { startDate, endDate } = req.query;
    const dateValidation = validateDateRange(startDate, endDate, 730);
    if (!dateValidation.isValid) {
      return next(new AppError(dateValidation.error, HTTP_STATUS.BAD_REQUEST));
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
      'processingMetadata.validMeasurements': 1,
      'processingMetadata.averageValue': 1,
      'processingMetadata.maxValue': 1,
      'processingMetadata.minValue': 1,
      createdAt: 1
    };

    const [data, totalDocuments] = await Promise.all([
      AirQuality.find(filters, projection)
        .sort(sortOptions)
        .skip(paginationOptions.skip)
        .limit(paginationOptions.limit)
        .maxTimeMS(MONGODB_TIMEOUTS.AGGREGATE_TIMEOUT_MS) // Timeout de 10 segundos
        .lean(),
      AirQuality.countDocuments(filters).maxTimeMS(MONGODB_TIMEOUTS.QUERY_TIMEOUT_MS) // Timeout de 5 segundos para count
    ]);

    const responseData = {
      data,
      pagination: createPaginationMeta(paginationOptions.page, paginationOptions.limit, totalDocuments),
      filters: {
        applied: Object.keys(filters).length > 0 ? filters : null,
        available: {
          magnitudes: AirQuality.getMagnitudes()
        }
      }
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
 * Obtener datos detallados de calidad de aire por ID
 * GET /api/v1/air-quality/:id
 */
const getAirQualityById = async (req, res, next) => {
  try {
    const { id } = req.params;

    const data = await AirQuality.findById(id)
      .maxTimeMS(MONGODB_TIMEOUTS.QUERY_TIMEOUT_MS) // Timeout de 5 segundos
      .lean();

    if (!data) {
      return next(createNotFoundError('Registro de calidad de aire', id));
    }

    // Convertir mediciones horarias para respuesta
    const medicionesArray = [];
    const valores = [];

    if (data.medicionesHorarias) {
      for (const [hora, medicion] of Object.entries(data.medicionesHorarias)) {
        const horaNum = parseInt(hora.substring(1));
        const esValido = medicion.validationCode === VALIDATION_CODES.VALID;
        medicionesArray.push({
          hora: horaNum,
          valor: medicion.value,
          codigoValidacion: medicion.validationCode,
          esValido
        });
        if (esValido && medicion.value !== null) {
          valores.push(medicion.value);
        }
      }
    }

    // Calcular estadísticas
    const statistics = valores.length > 0 ? {
      promedio: valores.reduce((sum, val) => sum + val, 0) / valores.length,
      maximo: Math.max(...valores),
      minimo: Math.min(...valores),
      mediana: valores.sort((a, b) => a - b)[Math.floor(valores.length / 2)],
      medicionesValidas: valores.length,
      totalMediciones: 24,
      porcentajeValidez: (valores.length / 24) * 100
    } : null;

    const responseData = {
      ...data,
      medicionesHorarias: medicionesArray,
      estadisticas: statistics,
      magnitudDescripcion: AirQuality.getMagnitudes()[data.magnitud] || 'Desconocida'
    };

    res.status(HTTP_STATUS.OK).json(createResponse(responseData, 'Detalles de calidad de aire obtenidos exitosamente'));

  } catch (error) {
    logger.error({
      error: error.message,
      stack: error.stack,
      airQualityId: req.params.id,
      endpoint: 'GET /api/v1/air-quality/:id'
    }, 'Error obteniendo detalles de calidad de aire');
    next(createInternalError('Error al obtener registro por ID', error));
  }
};

/**
 * Obtener estadísticas agregadas de calidad de aire
 * GET /api/v1/air-quality/statistics
 */
const getAirQualityStatistics = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return next(createValidationError('Parámetros de consulta inválidos', errors.array()));
    }

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
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return next(createValidationError('Parámetros de consulta inválidos', errors.array()));
    }

    const {
      startDate,
      endDate,
      provincia = 28, // Madrid por defecto
      municipio = 79, // Madrid ciudad por defecto
      magnitud = 10 // PM10 por defecto
    } = req.query;

    // Llamar al método optimizado del modelo
    const result = await AirQuality.getTrendsOptimized(
      provincia,
      municipio,
      magnitud,
      startDate,
      endDate
    );

    const responseData = {
      message: 'Tendencias de calidad de aire obtenidas exitosamente',
      data: {
        ...result,
        parametros: {
          provincia: parseInt(provincia),
          municipio: parseInt(municipio),
          magnitud: parseInt(magnitud),
          magnitudDescripcion: AirQuality.getMagnitudes()[parseInt(magnitud)]
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
  getAirQualityById,
  getAirQualityStatistics,
  getAirQualityTrends
};

