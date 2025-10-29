/**
 * Controlador de Censo
 *
 * Maneja las operaciones CRUD y consultas para datos demográficos del censo.
 * Incluye análisis poblacional, distribución geográfica, pirámides poblacionales
 * y métricas demográficas avanzadas para el dashboard del frontend.
 */

const { validationResult } = require('express-validator');
const Census = require('../models/Census');
const { AppError, createValidationError } = require('../utils/errorUtils');
const { parsePaginationParams, createPaginationMeta, parseDateRangeFilter } = require('../utils/paginationHelper');
const { buildFilters, buildSortOptions, buildPaginationOptions } = require('../utils/queryHelper');
const { SORT_FIELDS, PAGINATION } = require('../constants');

/**
 * Obtener datos de censo con filtros
 * GET /api/v1/census
 */
const getCensusData = async (req, res, next) => {
  try {
    // Verificar errores de validación
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return next(createValidationError('Parámetros de consulta inválidos', errors.array()));
    }

    const {
      startDate,
      endDate,
      distrito,
      barrio,
      grupoEdad,
      minEdad,
      maxEdad,
      minPoblacion,
      maxPoblacion,
      soloProductivos,
      soloTerceraEdad,
      page = 1,
      limit = 50,
      sortBy = 'totalPoblacion',
      sortOrder = 'desc',
      includeEstadisticas = true
    } = req.query;

    // Construir filtros
    const filters = {};

    // Filtros de fecha usando helper
    const dateFilter = parseDateRangeFilter(startDate, endDate, 'fechaCenso');
    if (dateFilter) {
      Object.assign(filters, dateFilter);
    }

    // Filtros geográficos
    if (distrito) {
      if (Array.isArray(distrito)) {
        filters['distrito.codigo'] = { $in: distrito.map(d => parseInt(d)) };
      } else {
        filters['distrito.codigo'] = parseInt(distrito);
      }
    }

    if (barrio) {
      if (Array.isArray(barrio)) {
        filters['barrio.codigo'] = { $in: barrio.map(b => parseInt(b)) };
      } else {
        filters['barrio.codigo'] = parseInt(barrio);
      }
    }

    // Filtros demográficos
    if (grupoEdad) {
      if (Array.isArray(grupoEdad)) {
        filters['clasificacionEdad.grupoEdad'] = { $in: grupoEdad };
      } else {
        filters['clasificacionEdad.grupoEdad'] = grupoEdad;
      }
    }

    if (minEdad || maxEdad) {
      filters.edad = {};
      if (minEdad) {filters.edad.$gte = parseInt(minEdad);}
      if (maxEdad) {filters.edad.$lte = parseInt(maxEdad);}
    }

    if (minPoblacion || maxPoblacion) {
      filters['estadisticas.totalPoblacion'] = {};
      if (minPoblacion) {filters['estadisticas.totalPoblacion'].$gte = parseInt(minPoblacion);}
      if (maxPoblacion) {filters['estadisticas.totalPoblacion'].$lte = parseInt(maxPoblacion);}
    }

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

    // Configurar campos de respuesta
    let selectFields = '-procesamiento -__v';
    if (!includeEstadisticas) {
      selectFields += ' -estadisticas -metadatos';
    }

    // Ejecutar consulta
    const [data, totalDocuments] = await Promise.all([
      Census.find(filters)
        .sort(sortOptions)
        .skip(paginationOptions.skip)
        .limit(paginationOptions.limit)
        .select(selectFields)
        .lean(),
      Census.countDocuments(filters)
    ]);

    // Calcular metadatos de paginación usando helper
    const paginationMeta = createPaginationMeta(paginationOptions.page, paginationOptions.limit, totalDocuments);

    // Obtener resumen estadístico del conjunto filtrado
    const resumenEstadistico = await Census.aggregate([
      { $match: filters },
      {
        $group: {
          _id: null,
          totalRegistros: { $sum: 1 },
          poblacionTotal: { $sum: '$estadisticas.totalPoblacion' },
          poblacionEspañola: { $sum: '$estadisticas.totalEspañoles' },
          poblacionExtranjera: { $sum: '$estadisticas.totalExtranjeros' },
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
      }
    ]);

    const resumen = resumenEstadistico[0] || {
      totalRegistros: 0,
      poblacionTotal: 0,
      poblacionEspañola: 0,
      poblacionExtranjera: 0,
      poblacionProductiva: 0,
      terceraEdad: 0,
      distritosUnicos: [],
      barriosUnicos: []
    };

    res.status(200).json({
      success: true,
      message: 'Datos de censo obtenidos exitosamente',
      data,
      pagination: paginationMeta,
      resumen: {
        ...resumen,
        totalDistritos: resumen.distritosUnicos.length,
        totalBarrios: resumen.barriosUnicos.length,
        porcentajeExtranjeros: resumen.poblacionTotal > 0 ?
          (resumen.poblacionExtranjera / resumen.poblacionTotal * 100).toFixed(2) : 0,
        porcentajePoblacionProductiva: resumen.poblacionTotal > 0 ?
          (resumen.poblacionProductiva / resumen.poblacionTotal * 100).toFixed(2) : 0,
        porcentajeTerceraEdad: resumen.poblacionTotal > 0 ?
          (resumen.terceraEdad / resumen.poblacionTotal * 100).toFixed(2) : 0
      },
      filtros: {
        aplicados: Object.keys(filters).length > 0 ? filters : null,
        disponibles: {
          gruposEdad: ['INFANTIL', 'JUVENIL', 'ADULTO_JOVEN', 'ADULTO', 'MAYOR', 'ANCIANO']
        }
      }
    });

  } catch (error) {
    console.error('Error obteniendo datos de censo:', error);
    next(new AppError('Error interno del servidor al obtener datos de censo', 500));
  }
};

/**
 * Obtener pirámide poblacional
 * GET /api/v1/census/pyramid
 */
const getPopulationPyramid = async (req, res, next) => {
  try {
    const {
      distrito,
      año = 2051,
      incluirExtranjeros = true
    } = req.query;

    // Llamar al método optimizado del modelo
    const resultado = await Census.getPiramidePoblacionalOptimizada({
      año: parseInt(año),
      distrito: distrito ? parseInt(distrito) : null,
      incluirExtranjeros: incluirExtranjeros === 'true'
    });

    res.status(200).json({
      success: true,
      message: 'Pirámide poblacional obtenida exitosamente',
      data: {
        piramideDetallada: resultado.piramideDetallada,
        piramideSimplificada: resultado.piramideSimplificada,
        totales: resultado.totales
      },
      configuracion: {
        distrito: distrito ? parseInt(distrito) : 'TODOS',
        año: parseInt(año),
        incluirExtranjeros: incluirExtranjeros === 'true'
      }
    });

  } catch (error) {
    console.error('Error obteniendo pirámide poblacional:', error);
    next(new AppError('Error interno del servidor al obtener pirámide poblacional', 500));
  }
};

/**
 * Obtener estadísticas por distritos
 * GET /api/v1/census/districts/statistics
 */
const getDistrictStatistics = async (req, res, next) => {
  try {
    const {
      año = 2051,
      mes,
      incluirBarrios = false
    } = req.query;

    const matchCondition = { año: parseInt(año) };
    if (mes) {matchCondition.mes = parseInt(mes);}

    // Estadísticas por distrito
    const estadisticasDistritos = await Census.aggregate([
      { $match: matchCondition },
      {
        $group: {
          _id: {
            distrito: '$distrito.codigo',
            nombre: '$distrito.descripcion'
          },
          totalPoblacion: { $sum: '$estadisticas.totalPoblacion' },
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
          totalBarrios: { $addToSet: '$barrio.codigo' }
        }
      },
      {
        $addFields: {
          porcentajePoblacionProductiva: {
            $cond: [
              { $gt: ['$totalPoblacion', 0] },
              { $multiply: [{ $divide: ['$poblacionProductiva', '$totalPoblacion'] }, 100] },
              0
            ]
          },
          porcentajeTerceraEdad: {
            $cond: [
              { $gt: ['$totalPoblacion', 0] },
              { $multiply: [{ $divide: ['$terceraEdad', '$totalPoblacion'] }, 100] },
              0
            ]
          },
          porcentajeExtranjeros: {
            $cond: [
              { $gt: ['$totalPoblacion', 0] },
              { $multiply: [{ $divide: ['$totalExtranjeros', '$totalPoblacion'] }, 100] },
              0
            ]
          },
          numeroBarrios: { $size: '$totalBarrios' }
        }
      },
      {
        $project: {
          distrito: {
            codigo: '$_id.distrito',
            nombre: '$_id.nombre'
          },
          poblacion: {
            total: '$totalPoblacion',
            españoles: '$totalEspañoles',
            extranjeros: '$totalExtranjeros',
            productiva: '$poblacionProductiva',
            terceraEdad: '$terceraEdad'
          },
          porcentajes: {
            extranjeros: { $round: ['$porcentajeExtranjeros', 2] },
            poblacionProductiva: { $round: ['$porcentajePoblacionProductiva', 2] },
            terceraEdad: { $round: ['$porcentajeTerceraEdad', 2] }
          },
          numeroBarrios: '$numeroBarrios',
          densidadPorBarrio: {
            $round: [{ $divide: ['$totalPoblacion', '$numeroBarrios'] }, 0]
          }
        }
      },
      { $sort: { 'poblacion.total': -1 } }
    ]);

    let estadisticasBarrios = null;

    // Si se solicita información de barrios, obtenerla
    if (incluirBarrios === 'true') {
      estadisticasBarrios = await Census.aggregate([
        { $match: matchCondition },
        {
          $group: {
            _id: {
              distrito: '$distrito.descripcion',
              barrio: '$barrio.descripcion',
              codigoBarrio: '$barrio.codigo'
            },
            totalPoblacion: { $sum: '$estadisticas.totalPoblacion' },
            diversidadCultural: { $avg: '$estadisticas.porcentajeExtranjeros' },
            poblacionProductiva: {
              $sum: {
                $cond: ['$clasificacionEdad.esGrupoProductivo', '$estadisticas.totalPoblacion', 0]
              }
            }
          }
        },
        {
          $project: {
            distrito: '$_id.distrito',
            barrio: {
              nombre: '$_id.barrio',
              codigo: '$_id.codigoBarrio'
            },
            poblacionTotal: '$totalPoblacion',
            diversidadCultural: { $round: ['$diversidadCultural', 2] },
            poblacionProductiva: '$poblacionProductiva'
          }
        },
        { $sort: { poblacionTotal: -1 } },
        { $limit: 50 } // Top 50 barrios
      ]);
    }

    // Ranking de distritos por diferentes métricas
    const rankings = {
      masHabitados: estadisticasDistritos.slice(0, 10),
      masDiversos: [...estadisticasDistritos]
        .sort((a, b) => b.porcentajes.extranjeros - a.porcentajes.extranjeros)
        .slice(0, 10),
      masProductivos: [...estadisticasDistritos]
        .sort((a, b) => b.porcentajes.poblacionProductiva - a.porcentajes.poblacionProductiva)
        .slice(0, 10)
    };

    res.status(200).json({
      success: true,
      message: 'Estadísticas de distritos obtenidas exitosamente',
      data: {
        estadisticasDistritos,
        estadisticasBarrios,
        rankings,
        resumen: {
          totalDistritos: estadisticasDistritos.length,
          poblacionTotal: estadisticasDistritos.reduce((acc, d) => acc + d.poblacion.total, 0),
          promedioHabitantesPorDistrito: estadisticasDistritos.length > 0 ?
            Math.round(estadisticasDistritos.reduce((acc, d) => acc + d.poblacion.total, 0) / estadisticasDistritos.length) : 0
        }
      },
      configuracion: {
        año: parseInt(año),
        mes: mes ? parseInt(mes) : null,
        incluirBarrios: incluirBarrios === 'true'
      }
    });

  } catch (error) {
    console.error('Error obteniendo estadísticas de distritos:', error);
    next(new AppError('Error interno del servidor al obtener estadísticas', 500));
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
    const {
      distrito,
      año = 2051,
      mes
    } = req.query;

    // Llamar al método optimizado del modelo
    const resultado = await Census.getAnalisisDemograficoOptimizado({
      año: parseInt(año),
      mes: mes ? parseInt(mes) : null,
      distrito: distrito ? parseInt(distrito) : null
    });

    res.status(200).json({
      success: true,
      message: 'Análisis demográfico obtenido exitosamente',
      data: {
        distribuciones: resultado.distribuciones,
        indicadores: resultado.indicadores,
        interpretacion: {
          tasaDependencia: 'Relación entre población dependiente (menores + tercera edad) y población productiva',
          porcentajePoblacionProductiva: 'Porcentaje de población en edad laboral (16-65 años)',
          porcentajeTerceraEdad: 'Porcentaje de población mayor de 65 años',
          porcentajeExtranjeros: 'Porcentaje de población extranjera sobre el total',
          ratioGenero: 'Relación hombres/mujeres (valor 1 = equilibrado)'
        }
      },
      metadatos: resultado.metadatos
    });

  } catch (error) {
    console.error('Error en análisis demográfico:', error);
    next(new AppError('Error interno del servidor en análisis demográfico', 500));
  }
};

/**
 * Obtener evolución demográfica temporal
 * GET /api/v1/census/evolution
 */
const getDemographicEvolution = async (req, res, next) => {
  try {
    const {
      distrito,
      startYear = 2051,
      endYear = 2051,
      metrica = 'poblacionTotal' // poblacionTotal, extranjeros, productiva
    } = req.query;

    const matchFilters = {
      año: { $gte: parseInt(startYear), $lte: parseInt(endYear) }
    };

    if (distrito) {
      matchFilters['distrito.codigo'] = parseInt(distrito);
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
    ]);

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

    res.status(200).json({
      success: true,
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
      configuracion: {
        distrito: distrito ? parseInt(distrito) : 'TODOS',
        periodoAnalisis: {
          inicio: parseInt(startYear),
          fin: parseInt(endYear)
        },
        metrica
      }
    });

  } catch (error) {
    console.error('Error obteniendo evolución demográfica:', error);
    next(new AppError('Error interno del servidor al obtener evolución', 500));
  }
};

/**
 * Obtener métricas del dashboard demográfico
 * GET /api/v1/census/dashboard
 */
const getDemographicDashboard = async (req, res, next) => {
  try {
    const {
      año = 2051,
      distrito
    } = req.query;

    const matchFilters = { año: parseInt(año) };
    if (distrito) {matchFilters['distrito.codigo'] = parseInt(distrito);}

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
    ]);

    // Top distritos por población
    const topDistritos = await Census.aggregate([
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
      { $limit: 5 }
    ]);

    // Distribución por grupos de edad
    const distribucionEdad = await Census.aggregate([
      { $match: matchFilters },
      {
        $group: {
          _id: '$clasificacionEdad.grupoEdad',
          poblacionTotal: { $sum: '$estadisticas.totalPoblacion' }
        }
      },
      { $sort: { poblacionTotal: -1 } }
    ]);

    res.status(200).json({
      success: true,
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
      configuracion: {
        año: parseInt(año),
        distrito: distrito ? parseInt(distrito) : 'TODOS'
      }
    });

  } catch (error) {
    console.error('Error obteniendo dashboard demográfico:', error);
    next(new AppError('Error interno del servidor al obtener dashboard', 500));
  }
};

module.exports = {
  getCensusData,
  getPopulationPyramid,
  getDistrictStatistics,
  getDemographicAnalysis,
  getDemographicEvolution,
  getDemographicDashboard
};
