/**
 * Controlador de Disponibilidad de Bicicletas
 *
 * Maneja la lógica de negocio para las operaciones relacionadas
 * con la disponibilidad de bicicletas eléctricas.
 */

const { validationResult } = require('express-validator');
const BikeAvailability = require('../models/BikeAvailability');
const { AppError } = require('../utils/errorUtils');
const { parsePaginationParams, createPaginationMeta } = require('../utils/paginationHelper');
const { buildFilters, buildSortOptions, buildPaginationOptions } = require('../utils/queryHelper');
const { SORT_FIELDS, PAGINATION } = require('../constants');

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
    const sortOptions = buildSortOptions(
      req.query.sortBy || 'dia',
      req.query.sortOrder || 'desc',
      ['dia', 'totalUsos', 'mediaBicicletasDisponibles', 'tasaOcupacion'],
      'dia'
    );

    // Configurar paginación usando queryHelper
    const paginationOptions = buildPaginationOptions(req.query, {
      defaultLimit: 100,
      maxLimit: PAGINATION.MAX_LIMIT
    });

    // Ejecutar consulta con paginación
    const [data, total] = await Promise.all([
      BikeAvailability.find(filters)
        .sort(sortOptions)
        .skip(paginationOptions.skip)
        .limit(paginationOptions.limit)
        .select('-__v')
        .lean(),
      BikeAvailability.countDocuments(filters)
    ]);

    res.status(200).json({
      success: true,
      data,
      pagination: createPaginationMeta(paginationOptions.page, paginationOptions.limit, total)
    });

  } catch (error) {
    console.error('Error al obtener disponibilidad de bicicletas:', error);
    next(error);
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
      return res.status(400).json({
        success: false,
        message: 'Formato de fecha no válido'
      });
    }

    const data = await BikeAvailability.findOne({ dia: targetDate })
      .select('-__v')
      .lean();

    if (!data) {
      return res.status(404).json({
        success: false,
        message: 'No se encontraron datos para la fecha especificada'
      });
    }

    res.status(200).json({
      success: true,
      data
    });

  } catch (error) {
    console.error('Error al obtener disponibilidad por fecha:', error);
    next(error);
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
      return res.status(404).json({
        success: false,
        message: 'No se encontraron datos para el rango de fechas especificado'
      });
    }

    res.status(200).json({
      success: true,
      data: {
        periodo: {
          inicio: start.toISOString().split('T')[0],
          fin: end.toISOString().split('T')[0]
        },
        estadisticas: stats[0]
      }
    });

  } catch (error) {
    console.error('Error al obtener estadísticas de bicicletas:', error);
    next(error);
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
      return res.status(404).json({
        success: false,
        message: `No se encontraron datos para el año ${year}`
      });
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

    res.status(200).json({
      success: true,
      data: {
        year: parseInt(year),
        tendencias: formattedTrends
      }
    });

  } catch (error) {
    console.error('Error al obtener tendencias mensuales:', error);
    next(error);
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

    res.status(200).json({
      success: true,
      data: {
        diasMayorUso: topDays.topDays,
        diasMenorUso: topDays.bottomDays
      }
    });

  } catch (error) {
    console.error('Error al obtener días de mayor uso:', error);
    next(error);
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
      return res.status(404).json({
        success: false,
        message: 'No se encontraron datos para el rango especificado'
      });
    }

    res.status(200).json({
      success: true,
      data: {
        periodo: {
          inicio: start.toISOString().split('T')[0],
          fin: end.toISOString().split('T')[0]
        },
        comparacion: comparison[0]
      }
    });

  } catch (error) {
    console.error('Error al comparar tipos de abonado:', error);
    next(error);
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
    const { startDate, endDate } = req.query;

    const filters = {};
    if (startDate || endDate) {
      filters.dia = {};
      if (startDate) filters.dia.$gte = new Date(startDate);
      if (endDate) filters.dia.$lte = new Date(endDate);
    }

    // Llamar al método optimizado del modelo
    const analysis = await BikeAvailability.getEfficiencyAnalysisOptimized(filters);

    if (!analysis) {
      return res.status(404).json({
        success: false,
        message: 'No se encontraron datos para el análisis'
      });
    }

    res.status(200).json({
      success: true,
      data: analysis
    });

  } catch (error) {
    console.error('Error al analizar eficiencia:', error);
    next(error);
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
    const { startDate, endDate, aggregation = 'day' } = req.query;

    const filters = {};
    if (startDate || endDate) {
      filters.dia = {};
      if (startDate) filters.dia.$gte = new Date(startDate);
      if (endDate) filters.dia.$lte = new Date(endDate);
    }

    // Llamar al método optimizado del modelo
    const historicalData = await BikeAvailability.getHistoricalDataOptimized(filters, aggregation);

    res.status(200).json({
      success: true,
      data: {
        aggregation,
        total: historicalData.length,
        historico: historicalData
      }
    });

  } catch (error) {
    console.error('Error al obtener datos históricos:', error);
    next(error);
  }
};

