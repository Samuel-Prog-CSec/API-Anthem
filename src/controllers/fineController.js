/**
 * Controlador de Multas
 *
 * Maneja las operaciones CRUD y consultas para datos de multas de tráfico.
 * Incluye filtrado avanzado, agregaciones estadísticas y análisis temporal
 * para el dashboard del frontend.
 */

const { validationResult } = require('express-validator');
const Fine = require('../models/Fine');
const { AppError, createValidationError } = require('../utils/errorUtils');
const { parsePaginationParams, createPaginationMeta, parseDateRangeFilter } = require('../utils/paginationHelper');
const { buildSortOptions, buildPaginationOptions } = require('../utils/queryHelper');
const { SORT_FIELDS, PAGINATION } = require('../constants');

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

    // Construir filtros de consulta
    const filters = {};

    // Filtros de fecha usando helper
    const dateFilter = parseDateRangeFilter(startDate, endDate, 'fecha');
    if (dateFilter) {
      Object.assign(filters, dateFilter);
    }

    // Filtros básicos
    if (calificacion) {
      if (Array.isArray(calificacion)) {
        filters.calificacion = { $in: calificacion.map(c => c.toUpperCase()) };
      } else {
        filters.calificacion = calificacion.toUpperCase();
      }
    }

    if (lugar) {
      filters.lugar = { $regex: lugar, $options: 'i' };
    }

    if (tipoInfraccion) {
      if (Array.isArray(tipoInfraccion)) {
        filters['metadatos.tipoInfraccion'] = { $in: tipoInfraccion };
      } else {
        filters['metadatos.tipoInfraccion'] = tipoInfraccion;
      }
    }

    if (denunciante) {
      filters.denunciante = { $regex: denunciante, $options: 'i' };
    }

    // Filtros numéricos
    if (minImporte || maxImporte) {
      filters.importeFinal = {};
      if (minImporte) {filters.importeFinal.$gte = parseFloat(minImporte);}
      if (maxImporte) {filters.importeFinal.$lte = parseFloat(maxImporte);}
    }

    if (minPuntos || maxPuntos) {
      filters.puntosDetraídos = {};
      if (minPuntos) {filters.puntosDetraídos.$gte = parseInt(minPuntos);}
      if (maxPuntos) {filters.puntosDetraídos.$lte = parseInt(maxPuntos);}
    }

    // Filtros booleanos
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

    // Configurar campos de respuesta
    let selectFields = '-descripcionInfraccion -procesamiento -__v';
    if (!includeCoordinates) {
      selectFields += ' -coordenadas';
    }

    // Ejecutar consulta
    const [data, totalDocuments] = await Promise.all([
      Fine.find(filters)
        .sort(sortOptions)
        .skip(paginationOptions.skip)
        .limit(paginationOptions.limit)
        .select(selectFields)
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

    res.status(200).json({
      success: true,
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
    });

  } catch (error) {
    console.error('Error obteniendo multas:', error);
    next(new AppError('Error interno del servidor al obtener multas', 500));
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

    res.status(200).json({
      success: true,
      message: 'Detalles de multa obtenidos exitosamente',
      data: {
        ...multa,
        impactoEconomico,
        gravedad: multa.calificacion === 'GRAVE' || multa.calificacion === 'MUY GRAVE' ? 'ALTA' : 'BAJA'
      }
    });

  } catch (error) {
    console.error('Error obteniendo detalles de multa:', error);
    next(new AppError('Error interno del servidor', 500));
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

    res.status(200).json({
      success: true,
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
    });

  } catch (error) {
    console.error('Error obteniendo estadísticas de multas:', error);
    next(new AppError('Error interno del servidor al calcular estadísticas', 500));
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

    res.status(200).json({
      success: true,
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
    });

  } catch (error) {
    console.error('Error obteniendo ranking de ubicaciones:', error);
    next(new AppError('Error interno del servidor al obtener ranking', 500));
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

    res.status(200).json({
      success: true,
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
    });

  } catch (error) {
    console.error('Error en análisis temporal de multas:', error);
    next(new AppError('Error interno del servidor en análisis temporal', 500));
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

    res.status(200).json({
      success: true,
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
    });

  } catch (error) {
    console.error('Error obteniendo métricas del dashboard:', error);
    next(new AppError('Error interno del servidor al obtener métricas', 500));
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
