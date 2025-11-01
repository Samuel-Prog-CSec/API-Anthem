/**
 * Controlador de Accidentalidad
 *
 * Gestiona las operaciones CRUD y consultas especializadas para datos de accidentes.
 * Proporciona endpoints optimizados para el dashboard de la ciudad inteligente
 * con análisis de seguridad vial, puntos negros y estadísticas de accidentes.
 */

const Accident = require('../models/Accident');
const { createInternalError, createNotFoundError } = require('../utils/errorUtils');
const { createPaginationMeta, parseDateRangeFilter } = require('../utils/paginationHelper');
const { buildFilters, buildSortOptions, buildPaginationOptions } = require('../utils/queryHelper');
const { createResponse } = require('../utils/responseHelper');
const { SORT_FIELDS, PAGINATION } = require('../constants');
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
    const filterConfig = {
      'ubicacion.nombreDistrito': { type: 'regex', source: 'distrito' },
      'circunstancias.tipoAccidente': { type: 'exact', source: 'tipoAccidente', transform: v => v.toUpperCase() },
      'circunstancias.gravedad': { type: 'exact', source: 'gravedad', transform: v => v.toUpperCase() },
      'vehiculo.tipo': { type: 'exact', source: 'tipoVehiculo', transform: v => v.toUpperCase() },
      'personaAfectada.tipoLesion': { type: 'exact', source: 'tipoLesion', transform: v => v.toUpperCase() },
      fecha: { type: 'dateRange', startDate: 'startDate', endDate: 'endDate' }
    };

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
      { fecha: 'fecha', gravedad: 'analisis.puntuacionGravedad', distrito: 'ubicacion.nombreDistrito' },
      Object.keys(SORT_FIELDS.ACCIDENT),
      'fecha',
      'desc'
    );

    const paginationOptions = buildPaginationOptions(
      req.query.page,
      req.query.limit,
      PAGINATION.DEFAULT_LIMIT,
      PAGINATION.MAX_LIMIT
    );

    // Ejecutar consulta principal y estadísticas en paralelo
    const [accidents, totalCount, stats] = await Promise.all([
      Accident.find(filters)
        .sort(sortOptions)
        .skip(paginationOptions.skip)
        .limit(paginationOptions.limit)
        .lean(),
      Accident.countDocuments(filters),
      Accident.aggregate([
        { $match: filters },
        {
          $group: {
            _id: null,
            accidentesGraves: {
              $sum: { $cond: [{ $in: ['$circunstancias.gravedad', ['GRAVE', 'MORTAL']] }, 1, 0] }
            },
            accidentesMortales: {
              $sum: { $cond: [{ $eq: ['$circunstancias.gravedad', 'MORTAL'] }, 1, 0] }
            },
            puntuacionGravedadPromedio: { $avg: '$analisis.puntuacionGravedad' },
            accidentesConAlcohol: {
              $sum: { $cond: [{ $eq: ['$personaAfectada.positivaAlcohol', 'S'] }, 1, 0] }
            }
          }
        }
      ])
    ]);

    const responseData = {
      data: accidents,
      pagination: createPaginationMeta(paginationOptions.page, paginationOptions.limit, totalCount),
      filters: {
        applied: filters,
        available: {
          gravedad: ['LEVE', 'GRAVE', 'MORTAL', 'SIN_LESIONES'],
          tipoAccidente: ['COLISION_DOBLE', 'COLISION_MULTIPLE', 'ALCANCE', 'CHOQUE_OBSTACULO', 'ATROPELLO_PERSONA', 'VUELCO'],
          tipoVehiculo: ['TURISMO', 'MOTOCICLETA', 'BICICLETA', 'AUTOBUS', 'CAMION'],
          tipoLesion: ['LEVE', 'GRAVE', 'FALLECIDO', 'SIN_ASISTENCIA']
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

    res.status(200).json(createResponse(responseData, 'Datos de accidentes obtenidos exitosamente'));

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
const getAccidentByExpediente = async (req, res, next) => {
  try {
    const { numero } = req.params;

    logger.debug({
      expediente: numero,
      endpoint: 'GET /api/accidents/expediente/:numero'
    }, 'Obteniendo accidente por expediente');

    // Buscar todas las personas afectadas en el mismo expediente
    const accidentData = await Accident.find({ numeroExpediente: numero })
      .sort({ 'personaAfectada.tipoPersona': 1 })
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

    const resumen = personasAfectadas.reduce((acc, persona) => {
      if (persona.tipoPersona === 'CONDUCTOR') { acc.conductores++; }
      if (persona.tipoPersona === 'PEATON') { acc.peatones++; }
      if (['GRAVE', 'FALLECIDO'].includes(persona.tipoLesion)) { acc.personasGraves++; }
      if (persona.positivaAlcohol === 'S') { acc.conAlcohol++; }
      return acc;
    }, { totalPersonas: accidentData.length, conductores: 0, peatones: 0, personasGraves: 0, conAlcohol: 0 });

    const accidentInfo = {
      expediente: accidente.numeroExpediente,
      fecha: accidente.fecha,
      hora: accidente.hora,
      ubicacion: accidente.ubicacion,
      circunstancias: accidente.circunstancias,
      vehiculo: accidente.vehiculo,
      analisis: accidente.analisis,
      personasAfectadas,
      resumen
    };

    return res.status(200).json(createResponse({ data: accidentInfo }, 'Accidente obtenido exitosamente'));

  } catch (error) {
    logger.error({
      error: error.message,
      stack: error.stack,
      expediente: req.params.numero,
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
    const { startDate, endDate, distrito } = req.query;

    logger.debug({
      startDate,
      endDate,
      distrito,
      endpoint: 'GET /api/accidents/stats'
    }, 'Obteniendo estadísticas de accidentalidad');

    // Construir filtros usando parseDateRangeFilter
    const dateFilter = parseDateRangeFilter(startDate, endDate, 'fecha');
    const filters = dateFilter || {};

    if (distrito) {filters['ubicacion.nombreDistrito'] = new RegExp(distrito, 'i');}

    // Estadísticas generales
    const generalStats = await Accident.getStatisticsByPeriod(
      filters.fecha?.$gte || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
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

    res.status(200).json(createResponse(responseData, 'Estadísticas completas obtenidas exitosamente'));

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
    const { startDate, endDate, gravedad, limite = 500 } = req.query;

    // Construir filtros usando parseDateRangeFilter
    const dateFilter = parseDateRangeFilter(startDate, endDate, 'fecha');
    const filters = dateFilter || {};

    if (gravedad) {filters['circunstancias.gravedad'] = gravedad.toUpperCase();}

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

    res.status(200).json(createResponse(responseData, 'Mapa de calor generado exitosamente'));

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

    // Construir filtros
    const filterConfig = {
      'ubicacion.nombreDistrito': { type: 'regex', source: 'distrito' },
      fecha: { type: 'dateRange', startDate: 'startDate', endDate: 'endDate' }
    };
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

    res.status(200).json(createResponse(responseData, 'Puntos negros analizados exitosamente'));

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
    const filterConfig = {
      fecha: { type: 'dateRange', startDate: 'startDate', endDate: 'endDate' }
    };
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

    res.status(200).json(createResponse(responseData, 'Comparativa de distritos obtenida exitosamente'));

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
  getAccidentByExpediente,
  getAccidentStats,
  getAccidentHeatmap,
  getSafetyAnalysis,
  getDistrictComparison
};
