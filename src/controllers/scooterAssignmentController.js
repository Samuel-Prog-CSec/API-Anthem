/**
 * Controlador de Asignación de Patinetes
 *
 * Maneja las operaciones CRUD y consultas para datos de distribución de patinetes
 * eléctricos. Incluye análisis de mercado, concentración por zonas, estadísticas
 * por proveedor y métricas de optimización para el dashboard del frontend.
 */

const { validationResult } = require('express-validator');
const ScooterAssignment = require('../models/ScooterAssignment');
const { AppError, createValidationError, createInternalError } = require('../utils/errorUtils');
const { parsePaginationParams, createPaginationMeta, parseDateRangeFilter } = require('../utils/paginationHelper');
const { buildFilters, buildSortOptions, buildPaginationOptions } = require('../utils/queryHelper');
const { createResponse } = require('../utils/responseHelper');
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
      filters.proveedores = {
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

    // Obtener datos con método optimizado del modelo
    const resultado = await ScooterAssignment.getAssignmentsWithFilters(
      filters,
      sortOptions,
      { skip: pagination.skip, limit: pagination.limitNum },
      projection
    );

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
    const responseData = {
      message: 'Datos de asignación de patinetes obtenidos correctamente',
      data: {
        assignments: resultado.asignaciones,
        pagination: createPaginationMeta(pagination.pageNum, pagination.limitNum, resultado.total),
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
    };

    res.status(200).json(createResponse(responseData, 'Asignaciones obtenidas exitosamente'));

  } catch (error) {
    next(createInternalError('Error al obtener datos de asignación de patinetes', error));
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

    const responseData = {
      message: 'Estadísticas por distrito obtenidas correctamente',
      data: {
        estadisticas,
        fecha: fecha || 'Todas las fechas',
        totalDistritos: estadisticas.length
      }
    };

    res.status(200).json(createResponse(responseData, 'Estadísticas por distrito obtenidas exitosamente'));

  } catch (error) {
    next(createInternalError('Error al obtener estadísticas por distrito', error));
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

    const responseData = {
      message: 'Análisis de mercado por proveedor obtenido correctamente',
      data: {
        analisis: analisisConParticipacion,
        resumen: {
          totalPatinetes,
          totalProveedores: analisisMercado.length,
          fecha: fecha || 'Todas las fechas'
        }
      }
    };

    res.status(200).json(createResponse(responseData, 'Análisis de mercado obtenido exitosamente'));

  } catch (error) {
    next(createInternalError('Error al obtener análisis de mercado por proveedor', error));
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

    const responseData = {
      message: 'Zonas de mayor concentración obtenidas correctamente',
      data: {
        zonas,
        parametros: {
          limite: parseInt(limite),
          fecha: fecha || 'Todas las fechas'
        }
      }
    };

    res.status(200).json(createResponse(responseData, 'Zonas de concentración obtenidas exitosamente'));

  } catch (error) {
    next(createInternalError('Error al obtener zonas de concentración', error));
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

    const responseData = {
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
    };

    res.status(200).json(createResponse(responseData, 'Dashboard obtenido exitosamente'));

  } catch (error) {
    next(createInternalError('Error al obtener dashboard de distribución', error));
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

    // Obtener datos optimizados del modelo
    const resultado = await ScooterAssignment.getAreaDetailsOptimized(distrito, barrio, fecha);

    if (!resultado) {
      return next(new AppError('Área no encontrada', 404));
    }

    const responseData = {
      message: 'Detalles del área obtenidos correctamente',
      data: {
        area: {
          ...resultado.area,
          resumen: new ScooterAssignment(resultado.area).getResumenAsignacion()
        },
        historial: resultado.historial,
        areasSimilares: resultado.areasSimilares,
        parametros: {
          distrito,
          barrio,
          fecha: fecha || 'Más reciente'
        }
      }
    };

    res.status(200).json(createResponse(responseData, 'Detalles del área obtenidos exitosamente'));

  } catch (error) {
    next(createInternalError('Error al obtener detalles del área', error));
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

    const responseData = {
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
    };

    res.status(200).json(createResponse(responseData, 'Análisis de optimización obtenido exitosamente'));

  } catch (error) {
    next(createInternalError('Error al obtener análisis de optimización', error));
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

    // Validar que ambas fechas estén presentes
    if (!fechaInicio || !fechaFin) {
      return next(new AppError('Fechas de inicio y fin son obligatorias', 400));
    }

    // Obtener datos con método optimizado del modelo
    const resultado = await ScooterAssignment.getTemporalComparisonData(
      fechaInicio,
      fechaFin,
      distrito,
      agrupacion
    );

    const responseData = {
      message: 'Comparativa temporal obtenida correctamente',
      data: {
        comparativa: resultado.comparativa,
        parametros: {
          fechaInicio,
          fechaFin,
          distrito: distrito || 'Todos',
          agrupacion,
          totalUbicaciones: resultado.totalUbicaciones
        }
      }
    };

    res.status(200).json(createResponse(responseData, 'Comparativa temporal obtenida exitosamente'));

  } catch (error) {
    next(createInternalError('Error al obtener comparativa temporal', error));
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

