/**
 * Controlador de Asignación de Patinetes
 *
 * Maneja las operaciones CRUD y consultas para datos de distribución de patinetes
 * eléctricos. Incluye análisis de mercado, concentración por zonas, estadísticas
 * por proveedor y métricas de optimización para el dashboard del frontend.
 */

const { validationResult } = require('express-validator');
const ScooterAssignment = require('../models/ScooterAssignment');
const { AppError, createValidationError } = require('../utils/errorUtils');
const { parsePaginationParams, createPaginationMeta, parseDateRangeFilter } = require('../utils/paginationHelper');
const { buildFilters, buildSortOptions, buildPaginationOptions } = require('../utils/queryHelper');
const { SORT_FIELDS, PAGINATION } = require('../constants');

/**
 * Obtener datos de asignación de patinetes con filtros
 * GET /api/v1/scooter-assignments
 */
const getScooterAssignments = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return next(createValidationError('Parámetros de consulta inválidos', errors.array()));
    }

    const {
      proveedor,
      soloProveedoresActivos = true,
      includeAnalisis = true
    } = req.query;

    // Usar queryHelper para construir filtros
    const filterConfig = {
      fecha: { field: 'fechaAsignacion', type: 'dateRange', singleDayFromFecha: true },
      distrito: { field: 'distrito.nombre', type: 'regex' },
      barrio: { field: 'barrio.nombre', type: 'regex' },
      tipoZona: { field: 'clasificacionArea.tipoZona', type: 'exact', transform: v => v.toUpperCase() },
      densidad: { field: 'estadisticas.densidadPatinetes', type: 'exact', transform: v => v.toUpperCase() },
      demanda: { field: 'clasificacionArea.demandaEstimada', type: 'exact', transform: v => v.toUpperCase() },
      concentracion: { field: 'analisisDistribucion.concentracionMercado', type: 'exact', transform: v => v.toUpperCase() },
      minPatinetes: { field: 'estadisticas.totalPatinetes', type: 'numericRange', rangeType: 'min' },
      maxPatinetes: { field: 'estadisticas.totalPatinetes', type: 'numericRange', rangeType: 'max' }
    };

    const filters = buildFilters(req.query, filterConfig);

    // Filtro especial por proveedor (array anidado)
    if (proveedor) {
      filters['proveedores'] = {
        $elemMatch: {
          nombre: new RegExp(proveedor, 'i'),
          activo: soloProveedoresActivos === 'true',
          cantidad: { $gt: 0 }
        }
      };
    }

    // Usar queryHelper para paginación y ordenación
    const sortMapping = {
      totalPatinetes: 'estadisticas.totalPatinetes',
      distrito: 'distrito.nombre',
      barrio: 'barrio.nombre',
      fecha: 'fechaAsignacion'
    };

    const sortOptions = buildSortOptions(
      req.query.sortBy,
      req.query.sortOrder,
      SORT_FIELDS.SCOOTER_ASSIGNMENT,
      'totalPatinetes',
      sortMapping
    );

    const pagination = buildPaginationOptions(req.query, {
      defaultLimit: PAGINATION.DEFAULT_LIMIT,
      maxLimit: PAGINATION.MAX_LIMIT
    });

    // Projection condicional
    const projection = includeAnalisis === 'true' ? {} : {
      'distrito.nombre': 1,
      'barrio.nombre': 1,
      'fechaAsignacion': 1,
      'estadisticas': 1,
      'clasificacionArea': 1,
      'proveedores': 1
    };

    // Ejecutar consulta principal
    const [assignments, total] = await Promise.all([
      ScooterAssignment.find(filters, projection)
        .sort(sortOptions)
        .skip(pagination.skip)
        .limit(pagination.limitNum)
        .lean(),
      ScooterAssignment.countDocuments(filters)
    ]);

    // Calcular estadísticas de la consulta
    const estadisticasConsulta = await ScooterAssignment.aggregate([
      { $match: filters },
      {
        $group: {
          _id: null,
          totalPatinetes: { $sum: '$estadisticas.totalPatinetes' },
          promedioPatinetes: { $avg: '$estadisticas.totalPatinetes' },
          maxPatinetes: { $max: '$estadisticas.totalPatinetes' },
          minPatinetes: { $min: '$estadisticas.totalPatinetes' },
          totalProveedores: { $sum: '$estadisticas.totalProveedores' },
          areasAltaDensidad: {
            $sum: {
              $cond: [
                { $in: ['$estadisticas.densidadPatinetes', ['ALTA', 'MUY_ALTA']] },
                1,
                0
              ]
            }
          }
        }
      }
    ]);

    // Respuesta
    res.status(200).json({
      success: true,
      message: 'Datos de asignación de patinetes obtenidos correctamente',
      data: {
        assignments,
        pagination: createPaginationMeta(pagination.pageNum, pagination.limitNum, total),
        estadisticas: estadisticasConsulta[0] || {
          totalPatinetes: 0,
          promedioPatinetes: 0,
          maxPatinetes: 0,
          minPatinetes: 0,
          totalProveedores: 0,
          areasAltaDensidad: 0
        },
        filtros: {
          aplicados: Object.keys(filters).length,
          activos: filters
        }
      }
    });

  } catch (error) {
    next(new AppError('Error al obtener datos de asignación de patinetes', 500, null, error.message));
  }
};

/**
 * Obtener estadísticas por distrito
 * GET /api/v1/scooter-assignments/statistics/districts
 */
const getDistrictStatistics = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return next(createValidationError('Parámetros de consulta inválidos', errors.array()));
    }

    const { fecha } = req.query;

    const estadisticas = await ScooterAssignment.getEstadisticasDistrito(fecha);

    res.status(200).json({
      success: true,
      message: 'Estadísticas por distrito obtenidas correctamente',
      data: {
        estadisticas,
        fecha: fecha || 'Todas las fechas',
        totalDistritos: estadisticas.length
      }
    });

  } catch (error) {
    next(new AppError('Error al obtener estadísticas por distrito', 500, null, error.message));
  }
};

/**
 * Obtener análisis de mercado por proveedor
 * GET /api/v1/scooter-assignments/market-analysis/providers
 */
const getProviderMarketAnalysis = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return next(createValidationError('Parámetros de consulta inválidos', errors.array()));
    }

    const { fecha } = req.query;

    const analisisMercado = await ScooterAssignment.getAnalisisMercadoPorProveedor(fecha);

    // Calcular participación de mercado
    const totalPatinetes = analisisMercado.reduce((sum, proveedor) => sum + proveedor.totalPatinetes, 0);

    const analisisConParticipacion = analisisMercado.map(proveedor => ({
      ...proveedor,
      participacionMercado: totalPatinetes > 0 ? (proveedor.totalPatinetes / totalPatinetes) * 100 : 0,
      cobertura: proveedor.totalDistritos
    }));

    res.status(200).json({
      success: true,
      message: 'Análisis de mercado por proveedor obtenido correctamente',
      data: {
        analisis: analisisConParticipacion,
        resumen: {
          totalPatinetes,
          totalProveedores: analisisMercado.length,
          fecha: fecha || 'Todas las fechas'
        }
      }
    });

  } catch (error) {
    next(new AppError('Error al obtener análisis de mercado por proveedor', 500, null, error.message));
  }
};

/**
 * Obtener zonas de mayor concentración
 * GET /api/v1/scooter-assignments/concentration-zones
 */
const getConcentrationZones = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return next(createValidationError('Parámetros de consulta inválidos', errors.array()));
    }

    const { limite = 20, fecha } = req.query;

    const zonas = await ScooterAssignment.getZonasMayorConcentracion(parseInt(limite), fecha);

    res.status(200).json({
      success: true,
      message: 'Zonas de mayor concentración obtenidas correctamente',
      data: {
        zonas,
        parametros: {
          limite: parseInt(limite),
          fecha: fecha || 'Todas las fechas'
        }
      }
    });

  } catch (error) {
    next(new AppError('Error al obtener zonas de concentración', 500, null, error.message));
  }
};

/**
 * Obtener dashboard de distribución
 * GET /api/v1/scooter-assignments/dashboard
 */
const getDistributionDashboard = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return next(createValidationError('Parámetros de consulta inválidos', errors.array()));
    }

    const { fecha } = req.query;

    // Obtener dashboard principal
    const [dashboardData] = await ScooterAssignment.getDashboardDistribucion(fecha);

    // Obtener datos adicionales para métricas
    const [topZonas, analisisProveedores] = await Promise.all([
      ScooterAssignment.getZonasMayorConcentracion(10, fecha),
      ScooterAssignment.getAnalisisMercadoPorProveedor(fecha)
    ]);

    // Procesar datos del dashboard
    const resumenGeneral = dashboardData.resumenGeneral[0] || {
      totalPatinetes: 0,
      totalAreas: 0,
      promedioPatinetesPorArea: 0,
      areasAltaDensidad: 0
    };

    const distribucionTipoZona = dashboardData.distribucionPorTipoZona || [];
    const distribucionDensidad = dashboardData.distribucionPorDensidad || [];
    const concentracionMercado = dashboardData.concentracionMercado || [];

    // Calcular métricas adicionales
    const totalPatinetes = analisisProveedores.reduce((sum, p) => sum + p.totalPatinetes, 0);
    const proveedorLider = analisisProveedores[0] || null;

    res.status(200).json({
      success: true,
      message: 'Dashboard de distribución obtenido correctamente',
      data: {
        resumenGeneral: {
          ...resumenGeneral,
          porcentajeAltaDensidad: resumenGeneral.totalAreas > 0 ?
            (resumenGeneral.areasAltaDensidad / resumenGeneral.totalAreas) * 100 : 0
        },
        distribuciones: {
          porTipoZona: distribucionTipoZona,
          porDensidad: distribucionDensidad,
          concentracionMercado: concentracionMercado
        },
        topZonas,
        mercado: {
          totalPatinetes,
          totalProveedores: analisisProveedores.length,
          proveedorLider: proveedorLider ? {
            nombre: proveedorLider._id,
            patinetes: proveedorLider.totalPatinetes,
            participacion: totalPatinetes > 0 ? (proveedorLider.totalPatinetes / totalPatinetes) * 100 : 0
          } : null
        },
        parametros: {
          fecha: fecha || 'Todas las fechas',
          ultimaActualizacion: new Date().toISOString()
        }
      }
    });

  } catch (error) {
    next(new AppError('Error al obtener dashboard de distribución', 500, null, error.message));
  }
};

/**
 * Obtener detalles de un área específica
 * GET /api/v1/scooter-assignments/area/:distrito/:barrio
 */
const getAreaDetails = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return next(createValidationError('Parámetros de consulta inválidos', errors.array()));
    }

    const { distrito, barrio } = req.params;
    const { fecha } = req.query;

    // Construir filtros
    const filters = {
      'distrito.nombre': new RegExp(distrito, 'i'),
      'barrio.nombre': new RegExp(barrio, 'i')
    };

    if (fecha) {
      const fechaInicio = new Date(fecha);
      const fechaFin = new Date(fechaInicio.getTime() + 24 * 60 * 60 * 1000);
      filters.fechaAsignacion = {
        $gte: fechaInicio,
        $lt: fechaFin
      };
    }

    // Buscar el área
    const area = await ScooterAssignment.findOne(filters).lean();

    if (!area) {
      return next(new AppError('Área no encontrada', 404));
    }

    // Obtener historial si no se especifica fecha
    let historial = [];
    if (!fecha) {
      historial = await ScooterAssignment.find({
        'distrito.nombre': new RegExp(distrito, 'i'),
        'barrio.nombre': new RegExp(barrio, 'i')
      })
      .select('fechaAsignacion estadisticas.totalPatinetes estadisticas.densidadPatinetes')
      .sort({ fechaAsignacion: -1 })
      .limit(10)
      .lean();
    }

    // Obtener comparación con áreas similares
    const areasSimilares = await ScooterAssignment.find({
      'clasificacionArea.tipoZona': area.clasificacionArea.tipoZona,
      'distrito.nombre': { $ne: area.distrito.nombre },
      fechaAsignacion: area.fechaAsignacion
    })
    .select('distrito.nombre barrio.nombre estadisticas.totalPatinetes')
    .sort({ 'estadisticas.totalPatinetes': -1 })
    .limit(5)
    .lean();

    res.status(200).json({
      success: true,
      message: 'Detalles del área obtenidos correctamente',
      data: {
        area: {
          ...area,
          resumen: new ScooterAssignment(area).getResumenAsignacion()
        },
        historial,
        areasSimilares,
        parametros: {
          distrito,
          barrio,
          fecha: fecha || 'Más reciente'
        }
      }
    });

  } catch (error) {
    next(new AppError('Error al obtener detalles del área', 500, null, error.message));
  }
};

/**
 * Obtener análisis de optimización
 * GET /api/v1/scooter-assignments/optimization-analysis
 */
const getOptimizationAnalysis = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return next(createValidationError('Parámetros de consulta inválidos', errors.array()));
    }

    const { fecha } = req.query;

    // Obtener análisis del modelo (lógica movida al modelo - 120+ líneas eliminadas)
    const { analisisDesbalance, recomendaciones } = await ScooterAssignment.getOptimizationAnalysisData(fecha);

    res.status(200).json({
      success: true,
      message: 'Análisis de optimización obtenido correctamente',
      data: {
        analisisDesbalance,
        recomendaciones,
        resumen: {
          totalAnalizado: analisisDesbalance.reduce((sum, item) => sum + item.areas, 0),
          areasAtencion: recomendaciones.length,
          fecha: fecha || 'Todas las fechas'
        }
      }
    });

  } catch (error) {
    next(new AppError('Error al obtener análisis de optimización', 500, null, error.message));
  }
};

/**
 * Obtener comparativa temporal
 * GET /api/v1/scooter-assignments/temporal-comparison
 */
const getTemporalComparison = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return next(createValidationError('Parámetros de consulta inválidos', errors.array()));
    }

    const { fechaInicio, fechaFin, distrito, agrupacion = 'distrito' } = req.query;

    // Validar rango de fechas usando helper
    const dateValidation = validateDateRange(fechaInicio, fechaFin);
    if (!dateValidation.isValid) {
      return next(new AppError(dateValidation.error, 400));
    }

    // Validar que ambas fechas estén presentes
    if (!fechaInicio || !fechaFin) {
      return next(new AppError('Fechas de inicio y fin son obligatorias', 400));
    }

    const matchCondition = {
      fechaAsignacion: {
        $gte: new Date(fechaInicio),
        $lte: new Date(fechaFin)
      }
    };

    if (distrito) {
      matchCondition['distrito.nombre'] = new RegExp(distrito, 'i');
    }

    const groupField = agrupacion === 'barrio' ?
      { distrito: '$distrito.nombre', barrio: '$barrio.nombre' } :
      '$distrito.nombre';

    const comparativa = await ScooterAssignment.aggregate([
      { $match: matchCondition },
      {
        $group: {
          _id: {
            fecha: {
              $dateToString: {
                format: '%Y-%m-%d',
                date: '$fechaAsignacion'
              }
            },
            ubicacion: groupField
          },
          totalPatinetes: { $sum: '$estadisticas.totalPatinetes' },
          totalProveedores: { $avg: '$estadisticas.totalProveedores' },
          densidadPromedio: { $avg: '$estadisticas.promedioPatinetesPorProveedor' }
        }
      },
      {
        $sort: { '_id.fecha': 1, '_id.ubicacion': 1 }
      }
    ]);

    // Procesar datos para el frontend
    const datosProcessados = {};
    comparativa.forEach(item => {
      const fecha = item._id.fecha;
      const ubicacion = typeof item._id.ubicacion === 'object' ?
        `${item._id.ubicacion.distrito} - ${item._id.ubicacion.barrio}` :
        item._id.ubicacion;

      if (!datosProcessados[ubicacion]) {
        datosProcessados[ubicacion] = [];
      }

      datosProcessados[ubicacion].push({
        fecha,
        totalPatinetes: item.totalPatinetes,
        totalProveedores: Math.round(item.totalProveedores),
        densidadPromedio: Math.round(item.densidadPromedio * 100) / 100
      });
    });

    res.status(200).json({
      success: true,
      message: 'Comparativa temporal obtenida correctamente',
      data: {
        comparativa: datosProcessados,
        parametros: {
          fechaInicio,
          fechaFin,
          distrito: distrito || 'Todos',
          agrupacion,
          totalUbicaciones: Object.keys(datosProcessados).length
        }
      }
    });

  } catch (error) {
    next(new AppError('Error al obtener comparativa temporal', 500, null, error.message));
  }
};

module.exports = {
  getScooterAssignments,
  getDistrictStatistics,
  getProviderMarketAnalysis,
  getConcentrationZones,
  getDistributionDashboard,
  getAreaDetails,
  getOptimizationAnalysis,
  getTemporalComparison
};

