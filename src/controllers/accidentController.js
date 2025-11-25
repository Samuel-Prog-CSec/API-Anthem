/**
 * Controlador de Accidentalidad
 *
 * Gestiona las operaciones CRUD y consultas especializadas para datos de accidentes.
 * Proporciona endpoints optimizados para el dashboard de la ciudad inteligente
 * con análisis de seguridad vial, puntos negros y estadísticas de accidentes.
 */

const Accident = require('../models/Accident');
const { createInternalError, createNotFoundError } = require('../utils/errorUtils');
const { createPaginationMeta } = require('../utils/paginationHelper');
const { buildFilters, buildSortOptions, buildPaginationOptions } = require('../utils/queryHelper');
const { createResponse } = require('../utils/responseHelper');
const { SORT_FIELDS, PAGINATION, HTTP_STATUS, ACCIDENT_TYPES, VEHICLE_TYPES, INJURY_TYPES, BINARY_INDICATORS, SEVERITY_LEVELS, PERSON_TYPES, MONGODB_TIMEOUTS, TIME_CONSTANTS } = require('../constants');
const logger = require('../config/logger');


/**
 * Obtener todos los accidentes con filtros avanzados
 * GET /api/accidents
 */
const getAllAccidents = async (req, res, next) => {
  try {
    req.log.debug({
      query: req.query,
      userId: req.user?.id
    }, 'Obteniendo datos de accidentes con filtros');

    // Configuración de filtros usando queryHelper
    const filterConfig = [
      { field: 'ubicacion.nombreDistrito', type: 'regex', param: 'distrito' },
      { field: 'circunstancias.tipoAccidente', type: 'exact', param: 'tipoAccidente', transform: v => v.toUpperCase() },
      { field: 'circunstancias.gravedad', type: 'exact', param: 'gravedad', transform: v => v.toUpperCase() },
      { field: 'vehiculo.tipo', type: 'exact', param: 'tipoVehiculo', transform: v => v.toUpperCase() },
      { field: 'personaAfectada.tipoLesion', type: 'exact', param: 'tipoLesion', transform: v => v.toUpperCase() },
      { field: 'fecha', type: 'dateRange', params: ['startDate', 'endDate'] }
    ];

    const filters = buildFilters(req.query, filterConfig);

    // Filtros booleanos especiales
    const { conAlcohol, conDrogas } = req.query;
    if (conAlcohol === 'true') { filters['personaAfectada.positivaAlcohol'] = 'S'; }
    if (conAlcohol === 'false') { filters['personaAfectada.positivaAlcohol'] = 'N'; }
    if (conDrogas === 'true') { filters['personaAfectada.positivaDroga'] = 'S'; }
    if (conDrogas === 'false') { filters['personaAfectada.positivaDroga'] = 'N'; }

    // Configurar ordenamiento y paginación usando queryHelper
    const sortOptions = buildSortOptions(
      req.query,
      { fecha: 'fecha', gravedad: 'analisis.puntuacionGravedad', distrito: 'ubicacion.nombreDistrito', tipoAccidente: 'circunstancias.tipoAccidente', puntuacionGravedad: 'analisis.puntuacionGravedad' },
      Object.keys(SORT_FIELDS.ACCIDENT),
      'fecha',
      'desc'
    );

    const paginationOptions = buildPaginationOptions(
      req.query,
      { defaultLimit: PAGINATION.DEFAULT_LIMIT, maxLimit: PAGINATION.MAX_LIMIT }
    );

    // Proyección optimizada: solo campos necesarios para listado
    // Reduce ~50% tamaño de respuesta y memoria
    const projection = {
      numeroExpediente: 1,
      fecha: 1,
      hora: 1,
      'ubicacion.codigoDistrito': 1,
      'ubicacion.nombreDistrito': 1,
      'ubicacion.localizacion': 1,
      'circunstancias.tipoAccidente': 1,
      'circunstancias.gravedad': 1,
      'circunstancias.estadoMeteorologico': 1,
      'vehiculo.tipo': 1,
      'personaAfectada.tipoPersona': 1,
      'personaAfectada.tipoLesion': 1,
      'personaAfectada.positivaAlcohol': 1,
      'personaAfectada.positivaDroga': 1,
      'personaAfectada.rangoEdad': 1,
      'personaAfectada.sexo': 1,
      'analisis.puntuacionGravedad': 1,
      'analisis.factoresRiesgo': 1
    };

    // Ejecutar consulta principal y estadísticas en paralelo
    const [accidents, totalCount, stats] = await Promise.all([
      Accident.find(filters, projection)
        .sort(sortOptions)
        .skip(paginationOptions.skip)
        .limit(paginationOptions.limit)
        .maxTimeMS(MONGODB_TIMEOUTS.AGGREGATE_TIMEOUT_MS) // Timeout de 10 segundos
        .lean(),
      Accident.countDocuments(filters).maxTimeMS(MONGODB_TIMEOUTS.QUERY_TIMEOUT_MS), // Timeout de 5 segundos para count
      Accident.aggregate([
        { $match: filters },
        // NO usar $limit antes de $group - corrompe las estadísticas globales
        {
          $group: {
            _id: null,
            accidentesGraves: {
              $sum: { $cond: [{ $in: ['$circunstancias.gravedad', [SEVERITY_LEVELS.ACCIDENT.GRAVE, SEVERITY_LEVELS.ACCIDENT.MORTAL]] }, 1, 0] }
            },
            accidentesMortales: {
              $sum: { $cond: [{ $eq: ['$circunstancias.gravedad', SEVERITY_LEVELS.ACCIDENT.MORTAL] }, 1, 0] }
            },
            puntuacionGravedadPromedio: { $avg: '$analisis.puntuacionGravedad' },
            accidentesConAlcohol: {
              $sum: { $cond: [{ $eq: ['$personaAfectada.positivaAlcohol', BINARY_INDICATORS.YES] }, 1, 0] }
            }
          }
        }
      ])
        .maxTimeMS(MONGODB_TIMEOUTS.AGGREGATE_TIMEOUT_MS) // Timeout de 10 segundos
        .exec()
    ]);

    const responseData = {
      data: accidents,
      pagination: createPaginationMeta(paginationOptions.page, paginationOptions.limit, totalCount),
      filters: {
        applied: filters,
        available: {
          gravedad: Object.values(SEVERITY_LEVELS.ACCIDENT),
          tipoAccidente: ACCIDENT_TYPES,
          tipoVehiculo: VEHICLE_TYPES,
          tipoLesion: Object.values(INJURY_TYPES)
        }
      },
      stats: stats[0] || {
        accidentesGraves: 0,
        accidentesMortales: 0,
        puntuacionGravedadPromedio: 0,
        accidentesConAlcohol: 0
      }
    };

    logger.info({
      totalItems: totalCount,
      page: paginationOptions.page,
      filtersApplied: Object.keys(filters).length,
      endpoint: 'GET /api/accidents'
    }, 'Datos de accidentes obtenidos exitosamente');

    res.status(HTTP_STATUS.OK).json(createResponse(responseData, 'Datos de accidentes obtenidos exitosamente'));

  } catch (error) {
    logger.error({
      error: error.message,
      stack: error.stack,
      query: req.query,
      endpoint: 'GET /api/accidents'
    }, 'Error al obtener datos de accidentes');
    next(createInternalError('Error al obtener los datos de accidentes', error));
  }
};

/**
 * Obtener un accidente específico por número de expediente
 * GET /api/accidents/expediente/:numero
 */
const getAccidentByFileNumber = async (req, res, next) => {
  try {
    const { numero } = req.params;

    logger.debug({
      fileNumber: numero,
      endpoint: 'GET /api/accidents/expediente/:numero'
    }, 'Obteniendo accidente por expediente');

    // Buscar todas las personas afectadas en el mismo expediente
    const accidentData = await Accident.find({ numeroExpediente: numero })
      .sort({ 'personaAfectada.tipoPersona': 1 })
      .maxTimeMS(MONGODB_TIMEOUTS.QUERY_TIMEOUT_MS) // Timeout de 5 segundos
      .lean();

    if (!accidentData || accidentData.length === 0) {
      return next(createNotFoundError('Accidente con expediente', numero));
    }

    // Construir resumen sin múltiples filtros repetidos
    const accidente = accidentData[0];
    const personasAfectadas = accidentData.map(acc => ({
      tipoPersona: acc.personaAfectada.tipoPersona,
      rangoEdad: acc.personaAfectada.rangoEdad,
      sexo: acc.personaAfectada.sexo,
      tipoLesion: acc.personaAfectada.tipoLesion,
      positivaAlcohol: acc.personaAfectada.positivaAlcohol,
      positivaDroga: acc.personaAfectada.positivaDroga
    }));

    const summary = personasAfectadas.reduce((acc, persona) => {
      if (persona.tipoPersona === PERSON_TYPES.CONDUCTOR) { acc.conductores++; }
      if (persona.tipoPersona === PERSON_TYPES.PEATON) { acc.peatones++; }
      if ([INJURY_TYPES.GRAVE, INJURY_TYPES.FALLECIDO].includes(persona.tipoLesion)) { acc.personasGraves++; }
      if (persona.positivaAlcohol === BINARY_INDICATORS.YES) { acc.conAlcohol++; }
      return acc;
    }, { totalPersonas: accidentData.length, conductores: 0, peatones: 0, personasGraves: 0, conAlcohol: 0 });

    const accidentInfo = {
      fileNumber: accidente.numeroExpediente,
      fecha: accidente.fecha,
      hora: accidente.hora,
      ubicacion: accidente.ubicacion,
      circunstancias: accidente.circunstancias,
      vehiculo: accidente.vehiculo,
      analisis: accidente.analisis,
      personasAfectadas,
      resumen: summary
    };

    return res.status(HTTP_STATUS.OK).json(createResponse({ data: accidentInfo }, 'Accidente obtenido exitosamente'));

  } catch (error) {
    logger.error({
      error: error.message,
      stack: error.stack,
      fileNumber: req.params.numero,
      endpoint: 'GET /api/accidents/expediente/:numero'
    }, 'Error al obtener accidente por expediente');
    return next(createInternalError('Error al obtener el accidente', error));
  }
};

/**
 * Obtener estadísticas generales de accidentalidad
 * GET /api/accidents/stats
 */
const getAccidentStats = async (req, res, next) => {
  try {
    const { distrito } = req.query;

    logger.debug({
      query: req.query,
      endpoint: 'GET /api/accidents/stats'
    }, 'Obteniendo estadísticas de accidentalidad');

    // Construir filtros usando queryHelper
    const filterConfig = [
      { field: 'fecha', type: 'dateRange', params: ['startDate', 'endDate'] },
      { field: 'ubicacion.nombreDistrito', type: 'regex', param: 'distrito' }
    ];
    const filters = buildFilters(req.query, filterConfig);

    // Estadísticas generales
    const generalStats = await Accident.getStatisticsByPeriod(
      filters.fecha?.$gte || new Date(Date.now() - 30 * TIME_CONSTANTS.MILLISECONDS_PER_DAY),
      filters.fecha?.$lte || new Date()
    );

    // Puntos negros (zonas con más accidentes)
    const blackSpots = await Accident.getAccidentBlackSpots(
      10,
      filters.fecha?.$gte,
      filters.fecha?.$lte
    );

    // Análisis por tipo de vehículo
    const vehicleAnalysis = await Accident.getVehicleTypeAnalysis(
      filters.fecha?.$gte,
      filters.fecha?.$lte
    );

    // Patrones temporales, distribución por distrito y factores de riesgo
    const [hourlyPatterns, weeklyPatterns, districtDistribution, riskFactorsAnalysis] = await Promise.all([
      Accident.getTemporalPatterns('hora'),
      Accident.getTemporalPatterns('diaSemana'),
      Accident.getDistrictDistribution(filters),
      Accident.getRiskFactorsAnalysis(filters)
    ]);

    const responseData = {
      data: {
        resumen: generalStats[0] || {},
        puntosNegros: blackSpots,
        analisisPorVehiculo: vehicleAnalysis,
        patronesHorarios: hourlyPatterns,
        patronesSemanales: weeklyPatterns.map(p => ({
          ...p,
          diaNombre: ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'][p._id]
        })),
        distribucionDistritos: districtDistribution,
        factoresRiesgo: riskFactorsAnalysis,
        periodo: {
          inicio: filters.fecha?.$gte,
          fin: filters.fecha?.$lte,
          distrito: distrito || 'TODOS'
        }
      }
    };

    res.status(HTTP_STATUS.OK).json(createResponse(responseData, 'Estadísticas completas obtenidas exitosamente'));

  } catch (error) {
    logger.error({
      error: error.message,
      stack: error.stack,
      query: req.query,
      endpoint: 'GET /api/accidents/statistics-complete'
    }, 'Error al obtener estadísticas de accidentalidad');
    next(createInternalError('Error al obtener estadísticas de accidentalidad', error));
  }
};

/**
 * Obtener mapa de calor de accidentes (coordenadas geográficas)
 * GET /api/accidents/heatmap
 */
const getAccidentHeatmap = async (req, res, next) => {
  try {
    const { limite = 500 } = req.query;

    // Construir filtros usando queryHelper
    const filterConfig = [
      { field: 'fecha', type: 'dateRange', params: ['startDate', 'endDate'] },
      { field: 'circunstancias.gravedad', type: 'exact', param: 'gravedad', transform: v => v.toUpperCase() }
    ];
    const filters = buildFilters(req.query, filterConfig);

    // Obtener datos del heatmap desde el modelo
    const heatmapResult = await Accident.getHeatmapDataOptimized(filters, limite);

    const responseData = {
      data: {
        ...heatmapResult,
        estadisticas: {
          ...heatmapResult.estadisticas,
          periodo: {
            inicio: filters.fecha?.$gte,
            fin: filters.fecha?.$lte
          }
        }
      }
    };

    res.status(HTTP_STATUS.OK).json(createResponse(responseData, 'Mapa de calor generado exitosamente'));

  } catch (error) {
    logger.error({
      error: error.message,
      stack: error.stack,
      query: req.query,
      endpoint: 'GET /api/accidents/heatmap'
    }, 'Error al generar mapa de calor');
    next(createInternalError('Error al generar el mapa de calor', error));
  }
};

/**
 * Obtener análisis de seguridad vial por zona
 * GET /api/accidents/safety-analysis
 */
const getSafetyAnalysis = async (req, res, next) => {
  try {
    const { distrito } = req.query;

    // Construir filtros usando queryHelper
    const filterConfig = [
      { field: 'ubicacion.nombreDistrito', type: 'regex', param: 'distrito' },
      { field: 'fecha', type: 'dateRange', params: ['startDate', 'endDate'] }
    ];
    const filters = buildFilters(req.query, filterConfig);

    // Ejecutar todos los análisis en paralelo
    const [streetSafety, trendAnalysis, commonRiskFactors, weatherCorrelation] = await Promise.all([
      Accident.getStreetSafetyAnalysis(filters),
      Accident.getTrendAnalysis(filters),
      Accident.getRiskFactorsAnalysis(filters),
      Accident.getWeatherCorrelation(filters)
    ]);

    const responseData = {
      data: {
        seguridadCalles: streetSafety,
        tendencias: trendAnalysis,
        factoresRiesgoComunes: commonRiskFactors,
        correlacionMeteorologica: weatherCorrelation,
        periodo: {
          inicio: filters.fecha?.$gte,
          fin: filters.fecha?.$lte,
          distrito: distrito || 'TODOS'
        }
      }
    };

    res.status(HTTP_STATUS.OK).json(createResponse(responseData, 'Puntos negros analizados exitosamente'));

  } catch (error) {
    logger.error({
      error: error.message,
      stack: error.stack,
      query: req.query,
      endpoint: 'GET /api/accidents/black-spots'
    }, 'Error en análisis de seguridad vial');
    next(createInternalError('Error al realizar el análisis de seguridad vial', error));
  }
};

/**
 * Obtener comparativa entre distritos
 * GET /api/accidents/district-comparison
 */
const getDistrictComparison = async (req, res, next) => {
  try {
    // Construir filtros usando queryHelper
    const filterConfig = [
      { field: 'fecha', type: 'dateRange', params: ['startDate', 'endDate'] }
    ];
    const filters = buildFilters(req.query, filterConfig);

    // Obtener comparativa de distritos desde el modelo
    const districtComparison = await Accident.getDistrictComparisonData(filters);

    // Calcular rankings
    const rankings = {
      masAccidentes: [...districtComparison].sort((a, b) => b.totalAccidentes - a.totalAccidentes).slice(0, 5),
      masGraves: [...districtComparison].sort((a, b) => b.porcentajeGravedad - a.porcentajeGravedad).slice(0, 5),
      masAtropellos: [...districtComparison].sort((a, b) => b.porcentajeAtropellos - a.porcentajeAtropellos).slice(0, 5),
      mayorRiesgo: [...districtComparison].sort((a, b) => b.indiceRiesgoTotal - a.indiceRiesgoTotal).slice(0, 5)
    };

    const responseData = {
      data: {
        comparativa: districtComparison,
        rankings,
        resumen: {
          totalDistritos: districtComparison.length,
          periodo: {
            inicio: filters.fecha?.$gte,
            fin: filters.fecha?.$lte
          }
        }
      }
    };

    res.status(HTTP_STATUS.OK).json(createResponse(responseData, 'Comparativa de distritos obtenida exitosamente'));

  } catch (error) {
    logger.error({
      error: error.message,
      stack: error.stack,
      query: req.query,
      endpoint: 'GET /api/accidents/district-comparison-complete'
    }, 'Error en comparativa de distritos');
    next(createInternalError('Error al comparar distritos', error));
  }
};

module.exports = {
  getAllAccidents,
  getAccidentByFileNumber,
  getAccidentStats,
  getAccidentHeatmap,
  getSafetyAnalysis,
  getDistrictComparison
};

