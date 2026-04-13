/**
 * Controlador de Censo
 *
 * Maneja las operaciones CRUD y consultas para datos demográficos del censo.
 * Incluye análisis poblacional, distribución geográfica, pirámides poblacionales
 */

const Census = require('../models/Census');
const { createInternalError } = require('../utils/errorUtils');
const { createPaginationMeta, createCursorMeta, buildCursorQuery } = require('../utils/paginationHelper');
const { buildSortOptions, buildPaginationOptions, buildFilters, TRANSFORMS, parseNumericParams, buildResponseMetadata } = require('../utils/queryHelper');
const { createResponse } = require('../utils/responseHelper');
const { SORT_FIELDS, PAGINATION, HTTP_STATUS, AGE_GROUPS, AGGREGATION_LIMITS, MONGODB_TIMEOUTS, DATASET_YEARS, CENSUS_DEFAULTS } = require('../constants');
const logger = require('../config/logger');

/**
 * Obtener datos de censo con filtros
 * GET /api/v1/census
 */
const getCensusData = async (req, res, next) => {
  try {
    const {
      distrito,
      barrio,
      grupoEdad,
      soloProductivos,
      soloTerceraEdad,
      page = PAGINATION.DEFAULT_PAGE,
      limit = PAGINATION.DEFAULT_LIMIT,
      sortBy = SORT_FIELDS.CENSUS.DEFAULT_SORT_BY,
      sortOrder = SORT_FIELDS.DEFAULT_SORT_ORDER,
      includeEstadisticas = true
    } = req.query;

    // Construir filtros base usando queryHelper
    const baseFilters = buildFilters(req.query, [
      { field: 'fechaCenso', type: 'dateRange', params: ['startDate', 'endDate'] }
    ]);

    // Filtros geográficos usando TRANSFORMS
    const filters = { ...baseFilters };
    if (distrito) {
      const distritoValues = TRANSFORMS.toIntArray(distrito);
      filters['distrito.codigo'] = distritoValues.length === 1 ? distritoValues[0] : { $in: distritoValues };
    }

    if (barrio) {
      const barrioValues = TRANSFORMS.toIntArray(barrio);
      filters['barrio.codigo'] = barrioValues.length === 1 ? barrioValues[0] : { $in: barrioValues };
    }

    // Filtros demográficos
    if (grupoEdad) {
      if (Array.isArray(grupoEdad)) {
        filters['clasificacionEdad.grupoEdad'] = { $in: grupoEdad };
      } else {
        filters['clasificacionEdad.grupoEdad'] = grupoEdad;
      }
    }

    // Usar buildFilters para rangos numéricos
    const numericFilters = buildFilters(req.query, [
      { field: 'edad', type: 'numericRange', params: ['minEdad', 'maxEdad'] },
      { field: 'estadisticas.totalPoblacion', type: 'numericRange', params: ['minPoblacion', 'maxPoblacion'] }
    ]);
    Object.assign(filters, numericFilters);

    // Filtros booleanos
    if (soloProductivos === 'true') {
      filters['clasificacionEdad.esGrupoProductivo'] = true;
    }

    if (soloTerceraEdad === 'true') {
      filters['clasificacionEdad.esTerceraEdad'] = true;
    }

    // Configurar paginación usando queryHelper
    const paginationOptions = buildPaginationOptions(
      { page, limit },
      { defaultLimit: PAGINATION.DEFAULT_LIMIT, maxLimit: PAGINATION.MAX_LIMIT }
    );

    // Configurar ordenamiento usando queryHelper
    const sortMapping = {
      'totalPoblacion': 'estadisticas.totalPoblacion',
      'porcentajeExtranjeros': 'estadisticas.porcentajeExtranjeros',
      'edad': 'edad',
      'distrito': 'distrito.descripcion',
      'barrio': 'barrio.descripcion',
      'fechaCenso': 'fechaCenso'
    };
    const sortOptions = buildSortOptions(
      { sortBy, sortOrder },
      sortMapping,
      Object.keys(SORT_FIELDS.CENSUS),
      'fechaCenso',
      'desc'
    );

    // Proyección optimizada: seleccionar solo campos necesarios
    const projection = includeEstadisticas ? {
      fechaCenso: 1,
      edad: 1,
      'distrito.codigo': 1,
      'distrito.descripcion': 1,
      'barrio.codigo': 1,
      'barrio.descripcion': 1,
      'estadisticas.totalPoblacion': 1,
      'estadisticas.totalEspañoles': 1,
      'estadisticas.totalExtranjeros': 1,
      'estadisticas.porcentajeExtranjeros': 1,
      'estadisticas.totalHombres': 1,
      'estadisticas.totalMujeres': 1,
      'clasificacionEdad.grupoEdad': 1,
      'clasificacionEdad.esGrupoProductivo': 1,
      'clasificacionEdad.esTerceraEdad': 1
    } : {
      fechaCenso: 1,
      edad: 1,
      'distrito.codigo': 1,
      'distrito.descripcion': 1,
      'barrio.codigo': 1,
      'barrio.descripcion': 1
    };

    // PATRÓN HÍBRIDO: Usar método del modelo que encapsula query compleja
    // Mantiene todas las optimizaciones (.lean(), Promise.all(), proyección)
    const { cursor } = req.query;

    const { data, total: totalDocuments, stats, cursor: cursorMeta } = await Census.findWithOptions({
      filters,
      sort: sortOptions,
      pagination: paginationOptions,
      projection,
      lean: true,
      includeStats: true,
      cursor
    });

    // Calcular metadatos de paginación usando helper
    const paginationMeta = cursorMeta || createPaginationMeta(paginationOptions.page, paginationOptions.limit, totalDocuments);

    // Usar estadísticas del modelo (ya calculadas en paralelo)
    const summary = stats || {
      totalRegistros: 0,
      poblacionTotal: 0,
      poblacionEspañola: 0,
      poblacionExtranjera: 0,
      poblacionProductiva: 0,
      terceraEdad: 0,
      distritosUnicos: [],
      barriosUnicos: []
    };

    const responseData = {
      message: 'Datos de censo obtenidos exitosamente',
      data,
      pagination: paginationMeta,
      resumen: {
        ...summary,
        totalDistritos: summary.distritosUnicos.length,
        totalBarrios: summary.barriosUnicos.length,
        porcentajeExtranjeros: summary.poblacionTotal > 0 ?
          (summary.poblacionExtranjera / summary.poblacionTotal * 100).toFixed(2) : 0,
        porcentajePoblacionProductiva: summary.poblacionTotal > 0 ?
          (summary.poblacionProductiva / summary.poblacionTotal * 100).toFixed(2) : 0,
        porcentajeTerceraEdad: summary.poblacionTotal > 0 ?
          (summary.terceraEdad / summary.poblacionTotal * 100).toFixed(2) : 0
      },
      filtros: {
        aplicados: Object.keys(filters).length > 0 ? filters : null,
        disponibles: {
          gruposEdad: Object.values(AGE_GROUPS)
        }
      }
    };

    res.status(HTTP_STATUS.OK).json(createResponse(responseData, 'Datos de censo obtenidos exitosamente'));

  } catch (error) {
    logger.error({
      error: error.message,
      stack: error.stack,
      endpoint: 'GET /api/v1/census (otra función)'
    }, 'Error obteniendo datos de censo');
    next(createInternalError('Error al obtener datos de censo', error));
  }
};

/**
 * Obtener pirámide poblacional
 * GET /api/v1/census/pyramid
 */
const getPopulationPyramid = async (req, res, next) => {
  try {
    const {
      incluirExtranjeros = true
    } = req.query;

    // Parsear parámetros numéricos de una vez
    const { año, distrito } = parseNumericParams(
      req.query,
      ['año', 'distrito'],
      { año: DATASET_YEARS.DEFAULT_YEAR }
    );

    // Llamar al método optimizado del modelo
    const result = await Census.getOptimizedPopulationPyramid({
      año,
      distrito,
      incluirExtranjeros: incluirExtranjeros === 'true'
    });

    const responseData = {
      message: 'Pirámide poblacional obtenida exitosamente',
      data: {
        piramideDetallada: result.piramideDetallada,
        piramideSimplificada: result.piramideSimplificada,
        totales: result.totales
      },
      configuracion: buildResponseMetadata({
        distrito,
        año,
        incluirExtranjeros: incluirExtranjeros === 'true'
      }, { nullLabel: CENSUS_DEFAULTS.DISTRICT_LABEL })
    };

    res.status(HTTP_STATUS.OK).json(createResponse(responseData, 'Pirámide poblacional obtenida exitosamente'));

  } catch (error) {
    logger.error({
      error: error.message,
      stack: error.stack,
      query: req.query,
      endpoint: 'GET /api/v1/census/population-pyramid'
    }, 'Error obteniendo pirámide poblacional');
    next(createInternalError('Error al obtener pirámide poblacional', error));
  }
};

/**
 * Obtener estadísticas por distritos
 * GET /api/v1/census/districts/statistics
 */
const getDistrictStatistics = async (req, res, next) => {
  try {
    const { incluirBarrios = false } = req.query;

    // Parsear parámetros numéricos de una vez
    const { año, mes } = parseNumericParams(
      req.query,
      ['año', 'mes'],
      { año: DATASET_YEARS.DEFAULT_YEAR }
    );

    // Usar método estático del modelo para obtener estadísticas
    const { districtStatistics, neighborhoodStatistics } = await Census.getDistrictStatisticsOptimized({
      año,
      mes,
      incluirBarrios: incluirBarrios === 'true'
    });

    // Ranking de distritos por diferentes métricas
    const rankings = {
      masHabitados: districtStatistics.slice(0, AGGREGATION_LIMITS.TOP_RESULTS),
      masDiversos: [...districtStatistics]
        .sort((a, b) => b.porcentajes.extranjeros - a.porcentajes.extranjeros)
        .slice(0, AGGREGATION_LIMITS.TOP_RESULTS),
      masProductivos: [...districtStatistics]
        .sort((a, b) => b.porcentajes.poblacionProductiva - a.porcentajes.poblacionProductiva)
        .slice(0, AGGREGATION_LIMITS.TOP_RESULTS)
    };

    const responseData = {
      message: 'Estadísticas de distritos obtenidas exitosamente',
      data: {
        estadisticasDistritos: districtStatistics,
        estadisticasBarrios: neighborhoodStatistics,
        rankings,
        resumen: {
          totalDistritos: districtStatistics.length,
          poblacionTotal: districtStatistics.reduce((acc, d) => acc + d.poblacion.total, 0),
          promedioHabitantesPorDistrito: districtStatistics.length > 0 ?
            Math.round(districtStatistics.reduce((acc, d) => acc + d.poblacion.total, 0) / districtStatistics.length) : 0
        }
      },
      configuracion: buildResponseMetadata({
        año,
        mes,
        incluirBarrios: incluirBarrios === 'true'
      })
    };

    res.status(HTTP_STATUS.OK).json(createResponse(responseData, 'Estadísticas de distritos obtenidas exitosamente'));

  } catch (error) {
    logger.error({
      error: error.message,
      stack: error.stack,
      query: req.query,
      endpoint: 'GET /api/v1/census/district-statistics'
    }, 'Error obteniendo estadísticas de distritos');
    next(createInternalError('Error al obtener estadísticas de distritos', error));
  }
};

/**
 * Obtener análisis demográfico avanzado
 * GET /api/v1/census/analysis/demographic
 */
/**
 * Obtener análisis demográfico
 * GET /api/v1/census/analysis/demographic
 */
const getDemographicAnalysis = async (req, res, next) => {
  try {
    // Parsear parámetros numéricos de una vez
    const { año, mes, distrito } = parseNumericParams(
      req.query,
      ['año', 'mes', 'distrito'],
      { año: DATASET_YEARS.DEFAULT_YEAR }
    );

    // Llamar al método optimizado del modelo
    const result = await Census.getOptimizedDemographicAnalysis({
      año,
      mes,
      distrito
    });

    const responseData = {
      message: 'Análisis demográfico obtenido exitosamente',
      data: {
        distribuciones: result.distribuciones,
        indicadores: result.indicadores,
        interpretacion: {
          tasaDependencia: 'Relación entre población dependiente (menores + tercera edad) y población productiva',
          porcentajePoblacionProductiva: 'Porcentaje de población en edad laboral (16-65 años)',
          porcentajeTerceraEdad: 'Porcentaje de población mayor de 65 años',
          porcentajeExtranjeros: 'Porcentaje de población extranjera sobre el total',
          ratioGenero: 'Relación hombres/mujeres (valor 1 = equilibrado)'
        }
      },
      metadatos: result.metadatos
    };

    res.status(HTTP_STATUS.OK).json(createResponse(responseData, 'Análisis demográfico obtenido exitosamente'));

  } catch (error) {
    logger.error({
      error: error.message,
      stack: error.stack,
      query: req.query,
      endpoint: 'GET /api/v1/census/demographic-analysis'
    }, 'Error en análisis demográfico');
    next(createInternalError('Error en análisis demográfico', error));
  }
};

/**
 * Obtener evolución demográfica temporal
 * GET /api/v1/census/evolution
 */
const getDemographicEvolution = async (req, res, next) => {
  try {
    const { metrica = 'poblacionTotal' } = req.query; // poblacionTotal, extranjeros, productiva

    // Parsear parámetros numéricos de una vez
    const { distrito, startYear, endYear } = parseNumericParams(
      req.query,
      ['distrito', 'startYear', 'endYear'],
      { startYear: CENSUS_DEFAULTS.START_YEAR, endYear: CENSUS_DEFAULTS.END_YEAR }
    );

    const matchFilters = {
      año: { $gte: startYear, $lte: endYear }
    };

    if (distrito) {
      matchFilters['distrito.codigo'] = distrito;
    }

    // Configurar métricas según el parámetro
    let metricas = {};
    switch (metrica) {
      case 'extranjeros':
        metricas = {
          valor: '$totalExtranjeros',
          porcentaje: {
            $multiply: [
              { $divide: ['$totalExtranjeros', '$totalPoblacion'] },
              100
            ]
          }
        };
        break;
      case 'productiva':
        metricas = {
          valor: '$poblacionProductiva',
          porcentaje: {
            $multiply: [
              { $divide: ['$poblacionProductiva', '$totalPoblacion'] },
              100
            ]
          }
        };
        break;
      case 'poblacionTotal':
      default:
        metricas = {
          valor: '$totalPoblacion',
          porcentaje: 100
        };
        break;
    }

    const evolucion = await Census.aggregate([
      { $match: matchFilters },
      {
        $group: {
          _id: {
            año: '$año',
            mes: '$mes'
          },
          totalPoblacion: { $sum: '$estadisticas.totalPoblacion' },
          totalExtranjeros: { $sum: '$estadisticas.totalExtranjeros' },
          poblacionProductiva: {
            $sum: {
              $cond: ['$clasificacionEdad.esGrupoProductivo', '$estadisticas.totalPoblacion', 0]
            }
          }
        }
      },
      {
        $addFields: metricas
      },
      {
        $project: {
          periodo: {
            año: '$_id.año',
            mes: '$_id.mes'
          },
          valor: { $round: ['$valor', 0] },
          porcentaje: { $round: ['$porcentaje', 2] },
          totalPoblacion: '$totalPoblacion'
        }
      },
      { $sort: { '_id.año': 1, '_id.mes': 1 } }
    ])
      .option({ allowDiskUse: true, maxTimeMS: MONGODB_TIMEOUTS.AGGREGATE_TIMEOUT_MS }); // Timeout de 10 segundos

    // Calcular tendencias
    let tendencia = null;
    if (evolucion.length > 1) {
      const primerValor = evolucion[0].valor;
      const ultimoValor = evolucion[evolucion.length - 1].valor;

      tendencia = {
        direccion: ultimoValor > primerValor ? 'CRECIENTE' : 'DECRECIENTE',
        variacionAbsoluta: ultimoValor - primerValor,
        variacionPorcentual: primerValor > 0 ?
          ((ultimoValor - primerValor) / primerValor * 100).toFixed(2) : 0,
        tasa: evolucion.length > 1 ?
          (Math.pow(ultimoValor / primerValor, 1 / (evolucion.length - 1)) - 1) * 100 : 0
      };
    }

    const responseData = {
      message: 'Evolución demográfica obtenida exitosamente',
      data: {
        evolucion,
        tendencia,
        estadisticasEvolucion: {
          totalPeriodos: evolucion.length,
          valorInicial: evolucion[0]?.valor || 0,
          valorFinal: evolucion[evolucion.length - 1]?.valor || 0,
          valorMaximo: Math.max(...evolucion.map(e => e.valor)),
          valorMinimo: Math.min(...evolucion.map(e => e.valor))
        }
      },
      configuracion: buildResponseMetadata({
        distrito,
        periodoAnalisis: { inicio: startYear, fin: endYear },
        metrica
      }, { nullLabel: CENSUS_DEFAULTS.DISTRICT_LABEL })
    };

    res.status(HTTP_STATUS.OK).json(createResponse(responseData, 'Evolución demográfica obtenida exitosamente'));

  } catch (error) {
    logger.error({
      error: error.message,
      stack: error.stack,
      query: req.query,
      endpoint: 'GET /api/v1/census/demographic-evolution'
    }, 'Error obteniendo evolución demográfica');
    next(createInternalError('Error al obtener evolución demográfica', error));
  }
};

/**
 * Obtener métricas del dashboard demográfico
 * GET /api/v1/census/dashboard
 */
const getDemographicDashboard = async (req, res, next) => {
  try {
    // Parsear parámetros numéricos de una vez
    const { año, distrito } = parseNumericParams(
      req.query,
      ['año', 'distrito'],
      { año: DATASET_YEARS.DEFAULT_YEAR }
    );

    const matchFilters = { año };
    if (distrito) { matchFilters['distrito.codigo'] = distrito; }

    // Métricas principales
    const [metricas] = await Census.aggregate([
      { $match: matchFilters },
      {
        $group: {
          _id: null,
          poblacionTotal: { $sum: '$estadisticas.totalPoblacion' },
          totalHombres: { $sum: '$estadisticas.totalHombres' },
          totalMujeres: { $sum: '$estadisticas.totalMujeres' },
          totalEspañoles: { $sum: '$estadisticas.totalEspañoles' },
          totalExtranjeros: { $sum: '$estadisticas.totalExtranjeros' },
          poblacionProductiva: {
            $sum: {
              $cond: ['$clasificacionEdad.esGrupoProductivo', '$estadisticas.totalPoblacion', 0]
            }
          },
          terceraEdad: {
            $sum: {
              $cond: ['$clasificacionEdad.esTerceraEdad', '$estadisticas.totalPoblacion', 0]
            }
          },
          distritosUnicos: { $addToSet: '$distrito.codigo' },
          barriosUnicos: { $addToSet: '$barrio.codigo' }
        }
      },
      {
        $addFields: {
          ratioGenero: {
            $cond: [
              { $gt: ['$totalMujeres', 0] },
              { $divide: ['$totalHombres', '$totalMujeres'] },
              0
            ]
          },
          porcentajeExtranjeros: {
            $cond: [
              { $gt: ['$poblacionTotal', 0] },
              { $multiply: [{ $divide: ['$totalExtranjeros', '$poblacionTotal'] }, 100] },
              0
            ]
          },
          porcentajePoblacionProductiva: {
            $cond: [
              { $gt: ['$poblacionTotal', 0] },
              { $multiply: [{ $divide: ['$poblacionProductiva', '$poblacionTotal'] }, 100] },
              0
            ]
          }
        }
      }
    ])
      .option({ allowDiskUse: true, maxTimeMS: MONGODB_TIMEOUTS.AGGREGATE_TIMEOUT_MS }); // Timeout de 10 segundos

    // Ejecutar queries en paralelo para mejor rendimiento
    const [topDistritos, distribucionEdad] = await Promise.all([
      // Top distritos por población
      Census.aggregate([
        { $match: matchFilters },
        {
          $group: {
            _id: {
              codigo: '$distrito.codigo',
              nombre: '$distrito.descripcion'
            },
            poblacionTotal: { $sum: '$estadisticas.totalPoblacion' },
            diversidadCultural: { $avg: '$estadisticas.porcentajeExtranjeros' }
          }
        },
        { $sort: { poblacionTotal: -1 } },
        { $limit: AGGREGATION_LIMITS.PREVIEW }
      ])
        .option({ allowDiskUse: true, maxTimeMS: MONGODB_TIMEOUTS.AGGREGATE_TIMEOUT_MS }),

      // Distribución por grupos de edad
      Census.aggregate([
        { $match: matchFilters },
        {
          $group: {
            _id: '$clasificacionEdad.grupoEdad',
            poblacionTotal: { $sum: '$estadisticas.totalPoblacion' }
          }
        },
        { $sort: { poblacionTotal: -1 } }
      ])
        .option({ allowDiskUse: true, maxTimeMS: MONGODB_TIMEOUTS.AGGREGATE_TIMEOUT_MS })
    ]);

    const responseData = {
      message: 'Dashboard demográfico obtenido exitosamente',
      data: {
        resumenGeneral: {
          poblacionTotal: metricas?.poblacionTotal || 0,
          totalDistritos: metricas?.distritosUnicos?.length || 0,
          totalBarrios: metricas?.barriosUnicos?.length || 0,
          ratioGenero: metricas?.ratioGenero || 0,
          porcentajeExtranjeros: metricas?.porcentajeExtranjeros || 0,
          porcentajePoblacionProductiva: metricas?.porcentajePoblacionProductiva || 0
        },
        topDistritos,
        distribucionEdad,
        indicadoresClaves: [
          {
            nombre: 'Población Total',
            valor: metricas?.poblacionTotal || 0,
            icono: 'users',
            tipo: 'absoluto'
          },
          {
            nombre: 'Diversidad Cultural',
            valor: (metricas?.porcentajeExtranjeros || 0).toFixed(1) + '%',
            icono: 'globe',
            tipo: 'porcentaje'
          },
          {
            nombre: 'Población Activa',
            valor: (metricas?.porcentajePoblacionProductiva || 0).toFixed(1) + '%',
            icono: 'briefcase',
            tipo: 'porcentaje'
          },
          {
            nombre: 'Equilibrio de Género',
            valor: (metricas?.ratioGenero || 0).toFixed(2),
            icono: 'users',
            tipo: 'ratio'
          }
        ]
      },
      configuracion: buildResponseMetadata({
        año,
        distrito
      }, { nullLabel: CENSUS_DEFAULTS.DISTRICT_LABEL })
    };

    res.status(HTTP_STATUS.OK).json(createResponse(responseData, 'Dashboard demográfico obtenido exitosamente'));

  } catch (error) {
    logger.error({
      error: error.message,
      stack: error.stack,
      query: req.query,
      endpoint: 'GET /api/v1/census/dashboard'
    }, 'Error obteniendo dashboard demográfico');
    next(createInternalError('Error al obtener dashboard demográfico', error));
  }
};

/**
 * Obtener resumen ligero de distritos con poblacion total
 * GET /api/v1/censo/distritos/resumen
 *
 * Endpoint ligero disenado para ser consumido por otras paginas del frontend
 * que necesitan calcular metricas per capita (ej: multas por habitante).
 * Devuelve solo codigo, nombre y poblacion total por distrito.
 */
const obtenerResumenDistritos = async (req, res, next) => {
  try {
    const { año = DATASET_YEARS.DEFAULT_YEAR, mes } = req.query;

    // Filtro temporal
    const matchFilter = { año: parseInt(año, 10) };
    if (mes) {
      matchFilter.mes = parseInt(mes, 10);
    }

    const resumen = await Census.aggregate([
      { $match: matchFilter },
      {
        $group: {
          _id: '$distrito.codigo',
          nombre: { $first: '$distrito.descripcion' },
          totalPoblacion: { $sum: '$estadisticas.totalPoblacion' }
        }
      },
      { $sort: { _id: 1 } },
      {
        $project: {
          _id: 0,
          codigo: '$_id',
          nombre: 1,
          totalPoblacion: 1
        }
      }
    ]).maxTimeMS(MONGODB_TIMEOUTS.AGGREGATION);

    return createResponse(res, HTTP_STATUS.OK, 'Resumen de distritos obtenido correctamente', {
      data: resumen,
      totalDistritos: resumen.length,
      filtros: { año: parseInt(año, 10), mes: mes ? parseInt(mes, 10) : null }
    });
  } catch (error) {
    logger.error({
      error: error.message,
      stack: error.stack
    }, 'Error obteniendo resumen de distritos');
    next(createInternalError('Error al obtener resumen de distritos', error));
  }
};

module.exports = {
  getCensusData,
  getPopulationPyramid,
  getDistrictStatistics,
  getDemographicAnalysis,
  getDemographicEvolution,
  getDemographicDashboard,
  obtenerResumenDistritos
};

