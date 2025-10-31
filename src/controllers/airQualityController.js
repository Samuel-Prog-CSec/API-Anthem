/**
 * Controlador de Calidad de Aire
 *
 * Maneja las operaciones CRUD y consultas para datos de calidad de aire.
 * Incluye filtrado avanzado, agregaciones y análisis estadístico para el dashboard.
 */

const { validationResult } = require('express-validator');
const AirQuality = require('../models/AirQuality');
const { AppError, createValidationError, createInternalError } = require('../utils/errorUtils');
const { parsePaginationParams, createPaginationMeta, parseDateRangeFilter } = require('../utils/paginationHelper');
const { buildFilters, buildSortOptions, buildPaginationOptions, validateDateRange } = require('../utils/queryHelper');
const { createResponse } = require('../utils/responseHelper');
const { SORT_FIELDS, PAGINATION } = require('../constants');

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
      return next(new AppError(dateValidation.error, 400));
    }

    // Configurar ordenamiento usando queryHelper
    const sortOptions = buildSortOptions(
      req.query.sortBy || 'fecha',
      req.query.sortOrder || 'desc',
      SORT_FIELDS.AIR_QUALITY,
      'fecha'
    );

    // Configurar paginación usando queryHelper
    const paginationOptions = buildPaginationOptions(req.query, {
      defaultLimit: PAGINATION.DEFAULT_LIMIT,
      maxLimit: PAGINATION.MAX_LIMIT,
      maxPage: PAGINATION.MAX_PAGE
    });

    // Ejecutar consulta con proyección optimizada
    const [data, totalDocuments] = await Promise.all([
      AirQuality.find(filters)
        .sort(sortOptions)
        .skip(paginationOptions.skip)
        .limit(paginationOptions.limit)
        .select({
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
        })
        .lean(),
      AirQuality.countDocuments(filters)
    ]);

    // Calcular metadatos de paginación
    const paginationMeta = createPaginationMeta(paginationOptions.page, paginationOptions.limit, totalDocuments);

    const responseData = {
      message: 'Datos de calidad de aire obtenidos exitosamente',
      data,
      pagination: paginationMeta,
      filters: {
        applied: Object.keys(filters).length > 0 ? filters : null,
        available: {
          magnitudes: AirQuality.getMagnitudes()
        }
      }
    };

    res.status(200).json(createResponse(responseData, 'Datos de calidad de aire obtenidos exitosamente'));

  } catch (error) {
    console.error('Error obteniendo datos de calidad de aire:', error);
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

    const data = await AirQuality.findById(id).lean();

    if (!data) {
      return next(new AppError('Registro de calidad de aire no encontrado', 404));
    }

    // Convertir mediciones horarias para respuesta
    const medicionesArray = [];
    if (data.medicionesHorarias) {
      for (const [hora, medicion] of Object.entries(data.medicionesHorarias)) {
        medicionesArray.push({
          hora: parseInt(hora.substring(1)),
          valor: medicion.value,
          codigoValidacion: medicion.validationCode,
          esValido: medicion.validationCode === 'V'
        });
      }
    }

    // Calcular estadísticas
    const medicionesValidas = medicionesArray.filter(m => m.esValido && m.valor !== null);
    const valores = medicionesValidas.map(m => m.valor);

    const estadisticas = valores.length > 0 ? {
      promedio: valores.reduce((sum, val) => sum + val, 0) / valores.length,
      maximo: Math.max(...valores),
      minimo: Math.min(...valores),
      mediana: valores.sort((a, b) => a - b)[Math.floor(valores.length / 2)],
      medicionesValidas: valores.length,
      totalMediciones: 24,
      porcentajeValidez: (valores.length / 24) * 100
    } : null;

    const responseData = {
      message: 'Detalles de calidad de aire obtenidos exitosamente',
      data: {
        ...data,
        medicionesHorarias: medicionesArray,
        estadisticas,
        magnitudDescripcion: AirQuality.getMagnitudes()[data.magnitud] || 'Desconocida'
      }
    };

    res.status(200).json(createResponse(responseData, 'Detalles de calidad de aire obtenidos exitosamente'));

  } catch (error) {
    console.error('Error obteniendo detalles de calidad de aire:', error);
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

    const { startDate, endDate, provincia, municipio, magnitud, groupBy = 'day' } = req.query;

    // Construir filtros base usando parseDateRangeFilter
    const dateFilter = parseDateRangeFilter(startDate, endDate, 'fecha');
    const filters = dateFilter || {};

    if (provincia) {filters.provincia = parseInt(provincia);}
    if (municipio) {filters.municipio = parseInt(municipio);}
    if (magnitud) {filters.magnitud = parseInt(magnitud);}

    // Llamar al método optimizado del modelo
    const result = await AirQuality.getStatisticsOptimized(filters, groupBy);

    const responseData = {
      message: 'Estadísticas de calidad de aire obtenidas exitosamente',
      data: {
        ...result,
        magnitudes: AirQuality.getMagnitudes()
      }
    };

    res.status(200).json(createResponse(responseData, 'Estadísticas de calidad de aire obtenidas exitosamente'));

  } catch (error) {
    console.error('Error obteniendo estadísticas de calidad de aire:', error);
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

    res.status(200).json(createResponse(responseData, 'Tendencias obtenidas exitosamente'));

  } catch (error) {
    console.error('Error obteniendo tendencias de calidad de aire:', error);
    next(createInternalError('Error al calcular tendencias', error));
  }
};

module.exports = {
  getAirQualityData,
  getAirQualityById,
  getAirQualityStatistics,
  getAirQualityTrends
};
