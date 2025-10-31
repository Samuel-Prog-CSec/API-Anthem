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

    // Filtros booleanos especiales
    const filters = buildFilters(req.query, filterConfig);
    const { conAlcohol, conDrogas } = req.query;
    if (conAlcohol === 'true') {filters['personaAfectada.positivaAlcohol'] = 'S';}
    if (conAlcohol === 'false') {filters['personaAfectada.positivaAlcohol'] = 'N';}
    if (conDrogas === 'true') {filters['personaAfectada.positivaDroga'] = 'S';}
    if (conDrogas === 'false') {filters['personaAfectada.positivaDroga'] = 'N';}

    // Configurar ordenamiento usando queryHelper
    const sortMapping = {
      fecha: 'fecha',
      gravedad: 'analisis.puntuacionGravedad',
      distrito: 'ubicacion.nombreDistrito'
    };
    const sortOptions = buildSortOptions(
      req.query,
      sortMapping,
      Object.keys(SORT_FIELDS.ACCIDENT),
      'fecha',
      'desc'
    );

    // Configurar paginación usando queryHelper
    const paginationOptions = buildPaginationOptions(
      req.query.page,
      req.query.limit,
      PAGINATION.DEFAULT_LIMIT,
      PAGINATION.MAX_LIMIT
    );

    // Ejecutar consulta principal
    const [accidents, totalCount] = await Promise.all([
      Accident.find(filters)
        .sort(sortOptions)
        .skip(paginationOptions.skip)
        .limit(paginationOptions.limit)
        .lean(),
      Accident.countDocuments(filters)
    ]);

    // Calcular estadísticas básicas para la respuesta
    const stats = await Accident.aggregate([
      { $match: filters },
      {
        $group: {
          _id: null,
          accidentesGraves: {
            $sum: {
              $cond: [{ $in: ['$circunstancias.gravedad', ['GRAVE', 'MORTAL']] }, 1, 0]
            }
          },
          accidentesMortales: {
            $sum: {
              $cond: [{ $eq: ['$circunstancias.gravedad', 'MORTAL'] }, 1, 0]
            }
          },
          puntuacionGravedadPromedio: { $avg: '$analisis.puntuacionGravedad' },
          accidentesConAlcohol: {
            $sum: {
              $cond: [{ $eq: ['$personaAfectada.positivaAlcohol', 'S'] }, 1, 0]
            }
          }
        }
      }
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

    console.log('Datos de accidentes obtenidos exitosamente', {
      totalItems: totalCount,
      page: paginationOptions.page,
      filters: Object.keys(filters)
    });

    res.status(200).json(createResponse(responseData, 'Accidentes obtenidos exitosamente'));

  } catch (error) {
    console.log('Error al obtener datos de accidentes', {
      error: error.message,
      stack: error.stack,
      query: req.query
    });
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

    console.log('Obteniendo accidente por expediente', { expediente: numero });

    // Buscar todas las personas afectadas en el mismo expediente
    const accidentData = await Accident.find({ numeroExpediente: numero })
      .sort({ 'personaAfectada.tipoPersona': 1 })
      .lean();

    if (!accidentData || accidentData.length === 0) {
      return next(createNotFoundError('Accidente con expediente', numero));
    }

    // Agrupar información del accidente
    const accidentInfo = {
      expediente: accidentData[0].numeroExpediente,
      fecha: accidentData[0].fecha,
      hora: accidentData[0].hora,
      ubicacion: accidentData[0].ubicacion,
      circunstancias: accidentData[0].circunstancias,
      vehiculo: accidentData[0].vehiculo,
      analisis: accidentData[0].analisis,
      personasAfectadas: accidentData.map(acc => ({
        tipoPersona: acc.personaAfectada.tipoPersona,
        rangoEdad: acc.personaAfectada.rangoEdad,
        sexo: acc.personaAfectada.sexo,
        tipoLesion: acc.personaAfectada.tipoLesion,
        positivaAlcohol: acc.personaAfectada.positivaAlcohol,
        positivaDroga: acc.personaAfectada.positivaDroga
      })),
      resumen: {
        totalPersonas: accidentData.length,
        conductores: accidentData.filter(acc => acc.personaAfectada.tipoPersona === 'CONDUCTOR').length,
        peatones: accidentData.filter(acc => acc.personaAfectada.tipoPersona === 'PEATON').length,
        personasGraves: accidentData.filter(acc => ['GRAVE', 'FALLECIDO'].includes(acc.personaAfectada.tipoLesion)).length,
        conAlcohol: accidentData.filter(acc => acc.personaAfectada.positivaAlcohol === 'S').length
      }
    };

    res.status(200).json(createResponse({ data: accidentInfo }, 'Accidente obtenido exitosamente'));

  } catch (error) {
    console.log('Error al obtener accidente por expediente', {
      error: error.message,
      expediente: req.params.numero
    });
    next(createInternalError('Error al obtener el accidente', error));
  }
};

/**
 * Obtener estadísticas generales de accidentalidad
 * GET /api/accidents/stats
 */
const getAccidentStats = async (req, res, next) => {
  try {
    const { startDate, endDate, distrito } = req.query;

    console.log('Obteniendo estadísticas de accidentalidad', {
      startDate,
      endDate,
      distrito
    });

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
    console.log('Error al obtener estadísticas de accidentalidad', {
      error: error.message,
      query: req.query
    });
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
    console.log('Error al generar mapa de calor', {
      error: error.message
    });
    next(createInternalError('Error al generar el mapa de calor', error));
  }
};

/**
 * Obtener análisis de seguridad vial por zona
 * GET /api/accidents/safety-analysis
 */
const getSafetyAnalysis = async (req, res, next) => {
  try {
    const { distrito, startDate, endDate } = req.query;

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
    console.log('Error en análisis de seguridad vial', {
      error: error.message
    });
    next(createInternalError('Error al realizar el análisis de seguridad vial', error));
  }
};

/**
 * Obtener comparativa entre distritos
 * GET /api/accidents/district-comparison
 */
const getDistrictComparison = async (req, res, next) => {
  try {
    const { startDate, endDate } = req.query;

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
    console.log('Error en comparativa de distritos', {
      error: error.message
    });
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
