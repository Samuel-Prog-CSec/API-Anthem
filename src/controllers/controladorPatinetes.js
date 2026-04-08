/**
 * Controlador de Asignación de Patinetes
 *
 * Maneja las operaciones CRUD y consultas para datos de distribución de patinetes
 * eléctricos. Incluye análisis de mercado, concentración por zonas, estadísticas
 * por proveedor y métricas de optimización para el dashboard del frontend.
 */

const AsignacionPatinetes = require('../models/AsignacionPatinetes');
const { createInternalError, createNotFoundError } = require('../utils/errorUtils');
const { createPaginationMeta } = require('../utils/paginationHelper');
const { buildFilters, buildSortOptions, buildPaginationOptions, TRANSFORMS } = require('../utils/queryHelper');
const { createResponse } = require('../utils/responseHelper');
const { SORT_FIELDS, PAGINATION, HTTP_STATUS, MONGODB_TIMEOUTS, AGGREGATION_LIMITS, BINARY_INDICATORS, NIVELES_DENSIDAD_PATINETES } = require('../constants');

/**
 * Obtener datos de asignación de patinetes con filtros
 * GET /api/v1/scooter-assignments
 */
const obtenerAsignaciones = async (req, res, next) => {
  try {
    const {
      proveedor,
      soloProveedoresActivos = BINARY_INDICATORS.TRUE,
      includeAnalisis = BINARY_INDICATORS.TRUE
    } = req.query;

    // Usar queryHelper para construir filtros
    const filterConfig = [
      { field: 'fechaAsignacion', type: 'dateRange', params: ['fecha'] },
      { field: 'distrito.nombre', type: 'regex', param: 'distrito' },
      { field: 'barrio.nombre', type: 'regex', param: 'barrio' },
      { field: 'clasificacionArea.tipoZona', type: 'exact', param: 'tipoZona', transform: TRANSFORMS.toUpperCase },
      { field: 'estadisticas.densidadPatinetes', type: 'exact', param: 'densidad', transform: TRANSFORMS.toUpperCase },
      { field: 'clasificacionArea.demandaEstimada', type: 'exact', param: 'demanda', transform: TRANSFORMS.toUpperCase },
      { field: 'analisisDistribucion.concentracionMercado', type: 'exact', param: 'concentracion', transform: TRANSFORMS.toUpperCase },
      { field: 'estadisticas.totalPatinetes', type: 'numericRange', params: ['minPatinetes', 'maxPatinetes'] }
    ];

    const filters = buildFilters(req.query, filterConfig);

    // Filtro especial por proveedor (array anidado)
    // Los nombres están normalizados en MAYÚSCULAS en BD (ver importarPatinetes.js)
    // Usar match exacto en lugar de RegExp para mejor performance
    if (proveedor) {
      filters.proveedores = {
        $elemMatch: {
          nombre: proveedor.toUpperCase(), // Normalizar a mayusculas
          activo: soloProveedoresActivos !== false && soloProveedoresActivos !== 'false',
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
      req.query,
      sortMapping,
      SORT_FIELDS.SCOOTER_ASSIGNMENT,
      'totalPatinetes',
      'desc'
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
    const result = await AsignacionPatinetes.obtenerAsignacionesConFiltros(
      filters,
      sortOptions,
      { skip: pagination.skip, limit: pagination.limitNum },
      projection
    );

    // Calcular estadísticas de la consulta
    const queryStatistics = await AsignacionPatinetes.aggregate([
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
                { $in: ['$estadisticas.densidadPatinetes', [NIVELES_DENSIDAD_PATINETES.ALTA, NIVELES_DENSIDAD_PATINETES.MUY_ALTA]] },
                1,
                0
              ]
            }
          }
        }
      }
    ])
      .option({ maxTimeMS: MONGODB_TIMEOUTS.AGGREGATE_TIMEOUT_MS }); // Timeout de 10 segundos

    // Respuesta
    const responseData = {
      data: {
        asignaciones: result.asignaciones,
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

    res.status(HTTP_STATUS.OK).json(createResponse(responseData, 'Datos de asignación de patinetes obtenidos correctamente'));

  } catch (error) {
    next(createInternalError('Error al obtener datos de asignación de patinetes', error));
  }
};

/**
 * Obtener estadísticas por distrito
 * GET /api/v1/scooter-assignments/statistics/districts
 */
const obtenerEstadisticasDistritos = async (req, res, next) => {
  try {
    const { fecha } = req.query;

    const statistics = await AsignacionPatinetes.obtenerEstadisticasDistrito(fecha);

    const responseData = {
      data: {
        estadisticas: statistics,
        fecha: fecha || 'Todas las fechas',
        totalDistritos: statistics.length
      }
    };

    res.status(HTTP_STATUS.OK).json(createResponse(responseData, 'Estadísticas por distrito obtenidas correctamente'));

  } catch (error) {
    next(createInternalError('Error al obtener estadísticas por distrito', error));
  }
};

/**
 * Obtener análisis de mercado por proveedor
 * GET /api/v1/scooter-assignments/market-analysis/providers
 */
const obtenerAnalisisMercadoProveedores = async (req, res, next) => {
  try {
    const { fecha } = req.query;

    const marketAnalysis = await AsignacionPatinetes.obtenerAnalisisMercadoProveedores(fecha);

    // Calcular participación de mercado
    const totalPatinetes = marketAnalysis.reduce((sum, proveedor) => sum + proveedor.totalPatinetes, 0);

    const analysisWithMarketShare = marketAnalysis.map(proveedor => ({
      ...proveedor,
      participacionMercado: totalPatinetes > 0 ? (proveedor.totalPatinetes / totalPatinetes) * 100 : 0,
      cobertura: proveedor.totalDistritos
    }));

    const responseData = {
      data: {
        analisis: analysisWithMarketShare,
        resumen: {
          totalPatinetes,
          totalProveedores: marketAnalysis.length,
          fecha: fecha || 'Todas las fechas'
        }
      }
    };

    res.status(HTTP_STATUS.OK).json(createResponse(responseData, 'Análisis de mercado por proveedor obtenido correctamente'));

  } catch (error) {
    next(createInternalError('Error al obtener análisis de mercado por proveedor', error));
  }
};

/**
 * Obtener zonas de mayor concentración
 * GET /api/v1/scooter-assignments/concentration-zones
 */
const obtenerZonasConcentracion = async (req, res, next) => {
  try {
    const { limite = AGGREGATION_LIMITS.TOP_RESULTS, fecha } = req.query;

    const zonas = await AsignacionPatinetes.obtenerZonasMayorConcentracion(parseInt(limite), fecha);

    const responseData = {
      data: {
        zonas,
        parametros: {
          limite: parseInt(limite),
          fecha: fecha || 'Todas las fechas'
        }
      }
    };

    res.status(HTTP_STATUS.OK).json(createResponse(responseData, 'Zonas de mayor concentración obtenidas correctamente'));

  } catch (error) {
    next(createInternalError('Error al obtener zonas de concentración', error));
  }
};

/**
 * Obtener detalles de un área específica
 * GET /api/v1/scooter-assignments/area/:distrito/:barrio
 */
const obtenerDetallesArea = async (req, res, next) => {
  try {
    const { distrito, barrio } = req.params;
    const { fecha } = req.query;

    // Obtener datos optimizados del modelo
    const result = await AsignacionPatinetes.obtenerDetallesAreaOptimizado(distrito, barrio, fecha);

    if (!result) {
      return next(createNotFoundError('Área', `${distrito}/${barrio}`));
    }

    const responseData = {
      data: {
        area: {
          ...result.area,
          resumen: AsignacionPatinetes.obtenerResumenAsignacion(result.area)
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

    res.status(HTTP_STATUS.OK).json(createResponse(responseData, 'Detalles del área obtenidos correctamente'));

  } catch (error) {
    next(createInternalError('Error al obtener detalles del área', error));
  }
};

module.exports = {
  obtenerAsignaciones,
  obtenerEstadisticasDistritos,
  obtenerAnalisisMercadoProveedores,
  obtenerZonasConcentracion,
  obtenerDetallesArea
};



