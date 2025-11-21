/**
 * Controlador de Asignación de Patinetes
 *
 * Maneja las operaciones CRUD y consultas para datos de distribución de patinetes
 * eléctricos. Incluye análisis de mercado, concentración por zonas, estadísticas
 * por proveedor y métricas de optimización para el dashboard del frontend.
 */

const { validationResult } = require('express-validator');
const ScooterAssignment = require('../models/ScooterAssignment');
const { createValidationError, createInternalError, createNotFoundError, createBadRequestError } = require('../utils/errorUtils');
const { createPaginationMeta } = require('../utils/paginationHelper');
const { buildFilters, buildSortOptions, buildPaginationOptions } = require('../utils/queryHelper');
const { createResponse } = require('../utils/responseHelper');
const { SORT_FIELDS, PAGINATION, HTTP_STATUS } = require('../constants');

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
    const result = await ScooterAssignment.getAssignmentsWithFilters(
      filters,
      sortOptions,
      { skip: pagination.skip, limit: pagination.limitNum },
      projection
    );

    // Calcular estadísticas de la consulta
    const queryStatistics = await ScooterAssignment.aggregate([
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
        assignments: result.asignaciones,
        pagination: createPaginationMeta(pagination.pageNum, pagination.limitNum, result.total),
        estadisticas: queryStatistics[0] || {
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

    res.status(HTTP_STATUS.OK).json(createResponse(responseData, 'Asignaciones obtenidas exitosamente'));

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

    const statistics = await ScooterAssignment.getDistrictStatistics(fecha);

    const responseData = {
      message: 'Estadísticas por distrito obtenidas correctamente',
      data: {
        estadisticas: statistics,
        fecha: fecha || 'Todas las fechas',
        totalDistritos: statistics.length
      }
    };

    res.status(HTTP_STATUS.OK).json(createResponse(responseData, 'Estadísticas por distrito obtenidas exitosamente'));

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

    const marketAnalysis = await ScooterAssignment.getProviderMarketAnalysis(fecha);

    // Calcular participación de mercado
    const totalPatinetes = marketAnalysis.reduce((sum, proveedor) => sum + proveedor.totalPatinetes, 0);

    const analysisWithMarketShare = marketAnalysis.map(proveedor => ({
      ...proveedor,
      participacionMercado: totalPatinetes > 0 ? (proveedor.totalPatinetes / totalPatinetes) * 100 : 0,
      cobertura: proveedor.totalDistritos
    }));

    const responseData = {
      message: 'Análisis de mercado por proveedor obtenido correctamente',
      data: {
        analisis: analysisWithMarketShare,
        resumen: {
          totalPatinetes,
          totalProveedores: marketAnalysis.length,
          fecha: fecha || 'Todas las fechas'
        }
      }
    };

    res.status(HTTP_STATUS.OK).json(createResponse(responseData, 'Análisis de mercado obtenido exitosamente'));

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

    const zonas = await ScooterAssignment.getHighestConcentrationZones(parseInt(limite), fecha);

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

    res.status(HTTP_STATUS.OK).json(createResponse(responseData, 'Zonas de concentración obtenidas exitosamente'));

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
    const [dashboardData] = await ScooterAssignment.getDistributionDashboard(fecha);

    // Obtener datos adicionales para métricas
    const [topZonas, analisisProveedores] = await Promise.all([
      ScooterAssignment.getHighestConcentrationZones(10, fecha),
      ScooterAssignment.getProviderMarketAnalysis(fecha)
    ]);

    // Procesar datos del dashboard
    const generalSummary = dashboardData.resumenGeneral[0] || {
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
          ...generalSummary,
          porcentajeAltaDensidad: generalSummary.totalAreas > 0 ?
            (generalSummary.areasAltaDensidad / generalSummary.totalAreas) * 100 : 0
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

    res.status(HTTP_STATUS.OK).json(createResponse(responseData, 'Dashboard obtenido exitosamente'));

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
    const result = await ScooterAssignment.getAreaDetailsOptimized(distrito, barrio, fecha);

    if (!result) {
      return next(createNotFoundError('Área', `${distrito}/${barrio}`));
    }

    const responseData = {
      message: 'Detalles del área obtenidos correctamente',
      data: {
        area: {
          ...result.area,
          resumen: new ScooterAssignment(result.area).getAssignmentSummary()
        },
        historial: result.historial,
        areasSimilares: result.areasSimilares,
        parametros: {
          distrito,
          barrio,
          fecha: fecha || 'Más reciente'
        }
      }
    };

    res.status(HTTP_STATUS.OK).json(createResponse(responseData, 'Detalles del área obtenidos exitosamente'));

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

    res.status(HTTP_STATUS.OK).json(createResponse(responseData, 'Análisis de optimización obtenido exitosamente'));

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
      return next(createBadRequestError('Fechas de inicio y fin son obligatorias'));
    }

    // Obtener datos con método optimizado del modelo
    const result = await ScooterAssignment.getTemporalComparisonData(
      fechaInicio,
      fechaFin,
      distrito,
      agrupacion
    );

    const responseData = {
      message: 'Comparativa temporal obtenida correctamente',
      data: {
        comparativa: result.comparativa,
        parametros: {
          fechaInicio,
          fechaFin,
          distrito: distrito || 'Todos',
          agrupacion,
          totalUbicaciones: result.totalUbicaciones
        }
      }
    };

    res.status(HTTP_STATUS.OK).json(createResponse(responseData, 'Comparativa temporal obtenida exitosamente'));

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



