/**
 * Controlador de Multas
 *
 * Maneja las operaciones CRUD y consultas para datos de multas de tráfico.
 * Incluye filtrado avanzado, agregaciones estadísticas y análisis temporal
 * para el dashboard del frontend.
 */

const { validationResult } = require('express-validator');
const Fine = require('../models/Fine');
const { AppError, createValidationError, createInternalError } = require('../utils/errorUtils');
const { createPaginationMeta, parseDateRangeFilter } = require('../utils/paginationHelper');
const { buildFilters, buildSortOptions, buildPaginationOptions } = require('../utils/queryHelper');
const { createResponse } = require('../utils/responseHelper');
const { SORT_FIELDS, PAGINATION } = require('../constants');
const logger = require('../config/logger');

/**
 * Obtener multas con filtros avanzados
 * GET /api/v1/fines
 */
const getFines = async (req, res, next) => {
  try {
    // Verificar errores de validación
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return next(createValidationError('Parámetros de consulta inválidos', errors.array()));
    }

    // Extraer parámetros de consulta
    const {
      startDate,
      endDate,
      calificacion,
      lugar,
      tipoInfraccion,
      denunciante,
      minImporte,
      maxImporte,
      minPuntos,
      maxPuntos,
      conDescuento,
      esGrave,
      page = 1,
      limit = 50,
      sortBy = 'fecha',
      sortOrder = 'desc',
      includeCoordinates = false
    } = req.query;

    // Configuración de filtros usando buildFilters
    const filterConfig = [
      { field: 'fecha', type: 'dateRange', params: ['startDate', 'endDate'] },
      { field: 'calificacion', type: 'in', param: 'calificacion', transform: v => Array.isArray(v) ? v.map(c => c.toUpperCase()) : [v.toUpperCase()] },
      { field: 'lugar', type: 'regex', param: 'lugar' },
      { field: 'metadatos.tipoInfraccion', type: 'in', param: 'tipoInfraccion' },
      { field: 'denunciante', type: 'regex', param: 'denunciante' },
      { field: 'importeFinal', type: 'range', params: ['minImporte', 'maxImporte'], transform: parseFloat },
      { field: 'puntosDetraídos', type: 'range', params: ['minPuntos', 'maxPuntos'], transform: parseInt }
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

    // Ejecutar consulta
    const [data, totalDocuments] = await Promise.all([
      Fine.find(filters, projection)
        .sort(sortOptions)
        .skip(paginationOptions.skip)
        .limit(paginationOptions.limit)
        .lean(),
      Fine.countDocuments(filters)
    ]);

    // Calcular metadatos de paginación usando helper
    const paginationMeta = createPaginationMeta(paginationOptions.page, paginationOptions.limit, totalDocuments);

    // Obtener estadísticas rápidas del conjunto filtrado
    const estadisticasRapidas = await Fine.aggregate([
      { $match: filters },
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
      message: 'Multas obtenidas exitosamente',
      data,
      pagination: paginationMeta,
      estadisticas: estadisticasRapidas[0] || {
        totalImporte: 0,
        importePromedio: 0,
        totalPuntos: 0,
        multasGraves: 0,
        multasConDescuento: 0
      },
      filtros: {
        aplicados: Object.keys(filters).length > 0 ? filters : null,
        disponibles: {
          calificaciones: ['LEVE', 'GRAVE', 'MUY GRAVE'],
          tiposInfraccion: [
            'VELOCIDAD', 'ESTACIONAMIENTO', 'TELEFONO_MOVIL',
            'SEMAFORO', 'ALCOHOL_DROGAS', 'DOCUMENTACION', 'OTRAS'
          ]
        }
      }
    };

    res.status(200).json(createResponse(responseData, 'Multas obtenidas exitosamente'));

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

    const multa = await Fine.findById(id).lean();

    if (!multa) {
      return next(new AppError('Multa no encontrada', 404));
    }

    // Agregar información calculada adicional
    const impactoEconomico = {
      importeOriginal: multa.importeBoletín,
      importeFinal: multa.importeFinal,
      descuentoAplicado: multa.tieneDescuento ? multa.importeBoletín - multa.importeFinal : 0,
      porcentajeDescuento: multa.tieneDescuento ? 50 : 0
    };

    const responseData = {
      message: 'Detalles de multa obtenidos exitosamente',
      data: {
        ...multa,
        impactoEconomico,
        gravedad: multa.calificacion === 'GRAVE' || multa.calificacion === 'MUY GRAVE' ? 'ALTA' : 'BAJA'
      }
    };

    res.status(200).json(createResponse(responseData, 'Detalles de multa obtenidos exitosamente'));

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
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return next(createValidationError('Parámetros de consulta inválidos', errors.array()));
    }

    const {
      startDate,
      endDate,
      groupBy = 'month',
      limit = 12
    } = req.query;

    // Llamar al método optimizado del modelo
    const resultado = await Fine.getStatisticsOptimized({
      startDate: startDate ? new Date(startDate) : null,
      endDate: endDate ? new Date(endDate) : null,
      groupBy,
      limit: parseInt(limit)
    });

    const responseData = {
      message: 'Estadísticas de multas obtenidas exitosamente',
      data: {
        estadisticas: resultado.estadisticas,
        resumen: resultado.resumen,
        configuracion: {
          agrupacion: groupBy,
          filtros: startDate || endDate ? { startDate, endDate } : null,
          limite: parseInt(limit)
        }
      }
    };

    res.status(200).json(createResponse(responseData, 'Estadísticas de multas obtenidas exitosamente'));

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
      limit = 20,
      tipoInfraccion
    } = req.query;

    // Llamar al método optimizado del modelo
    const ranking = await Fine.getLocationRankingOptimized({
      startDate: startDate ? new Date(startDate) : null,
      endDate: endDate ? new Date(endDate) : null,
      tipoInfraccion,
      limit: parseInt(limit)
    });

    const responseData = {
      message: 'Ranking de ubicaciones obtenido exitosamente',
      data: {
        ranking,
        configuracion: {
          filtros: startDate || endDate || tipoInfraccion ? { startDate, endDate, tipoInfraccion } : null,
          limite: parseInt(limit)
        },
        metadatos: {
          totalUbicaciones: ranking.length,
          fechaConsulta: new Date()
        }
      }
    };

    res.status(200).json(createResponse(responseData, 'Ranking de ubicaciones obtenido exitosamente'));

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
    const resultado = await Fine.getTemporalAnalysisOptimized({
      startDate: startDate ? new Date(startDate) : null,
      endDate: endDate ? new Date(endDate) : null,
      tipoAnalisis
    });

    const responseData = {
      message: 'Análisis temporal obtenido exitosamente',
      data: {
        analisis: resultado.analisis,
        tendencia: resultado.tendencia,
        configuracion: {
          tipoAnalisis,
          filtros: startDate || endDate ? { startDate, endDate } : null
        },
        metadatos: {
          totalPeriodos: resultado.analisis.length,
          fechaConsulta: new Date()
        }
      }
    };

    res.status(200).json(createResponse(responseData, 'Análisis temporal obtenido exitosamente'));

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
        fechaInicio = new Date(ahora.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case '90days':
        fechaInicio = new Date(ahora.getTime() - 90 * 24 * 60 * 60 * 1000);
        break;
      case 'year':
        fechaInicio = new Date(ahora.getFullYear(), 0, 1);
        break;
      case '30days':
      default:
        fechaInicio = new Date(ahora.getTime() - 30 * 24 * 60 * 60 * 1000);
        break;
    }

    // Métricas generales del periodo
    const [metricsGeneral] = await Fine.aggregate([
      {
        $match: {
          fecha: { $gte: fechaInicio, $lte: ahora }
        }
      },
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
    ]);

    // Top 5 tipos de infracciones
    const topInfracciones = await Fine.aggregate([
      {
        $match: {
          fecha: { $gte: fechaInicio, $lte: ahora }
        }
      },
      {
        $group: {
          _id: '$metadatos.tipoInfraccion',
          cantidad: { $sum: 1 },
          importePromedio: { $avg: '$importeFinal' }
        }
      },
      { $sort: { cantidad: -1 } },
      { $limit: 5 }
    ]);

    // Evolución diaria del periodo
    const evolucionDiaria = await Fine.aggregate([
      {
        $match: {
          fecha: { $gte: fechaInicio, $lte: ahora }
        }
      },
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
    ]);

    const responseData = {
      message: 'Métricas del dashboard obtenidas exitosamente',
      data: {
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
      }
    };

    res.status(200).json(createResponse(responseData, 'Métricas del dashboard obtenidas exitosamente'));

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
