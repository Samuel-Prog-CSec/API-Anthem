/**
 * Controlador de Contaminación Acústica
 *
 * Maneja las operaciones CRUD y consultas para datos de contaminación acústica.
 * Incluye análisis por períodos del día, cumplimiento normativo y estadísticas.
 */

const { validationResult } = require('express-validator');
const NoiseMonitoring = require('../models/NoiseMonitoring');
const { createValidationError, createInternalError, createNotFoundError, createBadRequestError } = require('../utils/errorUtils');
const { createPaginationMeta } = require('../utils/paginationHelper');
const { buildFilters, buildSortOptions, buildPaginationOptions } = require('../utils/queryHelper');
const { createResponse } = require('../utils/responseHelper');
const { PAGINATION, HTTP_STATUS } = require('../constants');
const logger = require('../config/logger');

/**
 * Obtener datos de contaminación acústica con filtros
 * GET /api/v1.0/noise-monitoring
 */
const getNoiseMonitoringData = async (req, res, next) => {
  try {
    // Verificar errores de validación
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return next(createValidationError('Parámetros de consulta inválidos', errors.array()));
    }

    // Configuración de filtros usando queryHelper
    const filterConfig = [
      { field: 'fecha', type: 'dateRange', params: ['startDate', 'endDate'] },
      { field: 'año', type: 'numeric', param: 'año' },
      { field: 'mes', type: 'numeric', param: 'mes' },
      { field: 'nmt', type: 'in', param: 'nmt', transform: v => Array.isArray(v) ? v.map(n => parseInt(n)) : [parseInt(v)] },
      { field: 'nombre', type: 'regex', param: 'nombre' }
    ];

    const filters = buildFilters(req.query, filterConfig);

    // Filtro de calidad de datos
    if (req.query.includeInvalid !== 'true') {
      filters['dataQuality.hasValidData'] = true;
    }

    // Configurar ordenamiento usando queryHelper
    const sortOptions = buildSortOptions(
      req.query.sortBy || 'fecha',
      req.query.sortOrder || 'desc',
      ['fecha', 'nmt', 'nombre', 'laeq24', 'año', 'mes'],
      'fecha'
    );

    // Configurar paginación usando queryHelper
    const paginationOptions = buildPaginationOptions(req.query, {
      defaultLimit: PAGINATION.DEFAULT_LIMIT,
      maxLimit: PAGINATION.MAX_LIMIT
    });

    // Proyección optimizada: seleccionar solo campos necesarios
    const projection = {
      fecha: 1,
      estacion: 1,
      lden: 1,
      ld: 1,
      le: 1,
      ln: 1,
      'ubicacion.distrito': 1,
      'ubicacion.coordenadas': 1,
      'mediciones.tipo': 1,
      'mediciones.valor': 1
    };

    // Ejecutar consulta con timeouts
    const [data, totalDocuments] = await Promise.all([
      NoiseMonitoring.find(filters, projection)
        .sort(sortOptions)
        .skip(paginationOptions.skip)
        .limit(paginationOptions.limit)
        .maxTimeMS(10000) // Timeout de 10 segundos
        .lean(),
      NoiseMonitoring.countDocuments(filters).maxTimeMS(5000) // Timeout de 5 segundos para count
    ]);

    // Agregar cumplimiento normativo usando método del modelo
    const dataWithCompliance = data.map(item => ({
      ...item,
      cumplimientoNormativo: NoiseMonitoring.calculateRegulatoryCompliance(item)
    }));

    const responseData = {
      message: 'Datos de contaminación acústica obtenidos exitosamente',
      data: dataWithCompliance,
      pagination: createPaginationMeta(paginationOptions.page, paginationOptions.limit, totalDocuments),
      filters: {
        applied: Object.keys(filters).length > 0 ? filters : null
      }
    };

    res.status(HTTP_STATUS.OK).json(createResponse(responseData, 'Datos obtenidos exitosamente'));

  } catch (error) {
    logger.error({
      error: error.message,
      stack: error.stack,
      query: req.query,
      endpoint: 'GET /api/v1/noise-monitoring'
    }, 'Error obteniendo datos de contaminación acústica');
    next(createInternalError('Error al obtener datos de contaminación acústica', error));
  }
};

/**
 * Obtener datos detallados de contaminación acústica por ID
 * GET /api/v1/noise-monitoring/:id
 */
const getNoiseMonitoringById = async (req, res, next) => {
  try {
    const { id } = req.params;

    const data = await NoiseMonitoring.findById(id)
      .maxTimeMS(5000) // Timeout de 5 segundos
      .lean();

    if (!data) {
      return next(createNotFoundError('Registro de contaminación acústica', id));
    }

    const { LIMITES_NORMATIVOS } = NoiseMonitoring;

    // Calcular análisis de cumplimiento normativo detallado
    const regulatoryAnalysis = {
      limites: {
        diurno: { valor: LIMITES_NORMATIVOS.DIURNO, descripcion: 'Límite diurno (07:00-19:00)' },
        vespertino: { valor: LIMITES_NORMATIVOS.VESPERTINO, descripcion: 'Límite vespertino (19:00-23:00)' },
        nocturno: { valor: LIMITES_NORMATIVOS.NOCTURNO, descripcion: 'Límite nocturno (23:00-07:00)' }
      },
      cumplimiento: {
        diurno: {
          cumple: data.nivelDiurno ? data.nivelDiurno <= LIMITES_NORMATIVOS.DIURNO : null,
          exceso: data.nivelDiurno ? Math.max(0, data.nivelDiurno - LIMITES_NORMATIVOS.DIURNO) : 0
        },
        vespertino: {
          cumple: data.nivelVespertino ? data.nivelVespertino <= LIMITES_NORMATIVOS.VESPERTINO : null,
          exceso: data.nivelVespertino ? Math.max(0, data.nivelVespertino - LIMITES_NORMATIVOS.VESPERTINO) : 0
        },
        nocturno: {
          cumple: data.nivelNocturno ? data.nivelNocturno <= LIMITES_NORMATIVOS.NOCTURNO : null,
          exceso: data.nivelNocturno ? Math.max(0, data.nivelNocturno - LIMITES_NORMATIVOS.NOCTURNO) : 0
        }
      }
    };

    // Determinar período más problemático
    const niveles = [
      { periodo: 'diurno', valor: data.nivelDiurno, limite: LIMITES_NORMATIVOS.DIURNO },
      { periodo: 'vespertino', valor: data.nivelVespertino, limite: LIMITES_NORMATIVOS.VESPERTINO },
      { periodo: 'nocturno', valor: data.nivelNocturno, limite: LIMITES_NORMATIVOS.NOCTURNO }
    ].filter(n => n.valor !== null);

    const periodoMasProblematico = niveles.length > 0
      ? niveles.reduce((max, current) => {
          const excesoActual = Math.max(0, current.valor - current.limite);
          const excesoMax = Math.max(0, max.valor - max.limite);
          return excesoActual > excesoMax ? current : max;
        })
      : null;

    const responseData = {
      message: 'Detalles de contaminación acústica obtenidos exitosamente',
      data: {
        ...data,
        analisisNormativo: regulatoryAnalysis,
        periodoMasProblematico,
        interpretacion: {
          laeq24: data.laeq24 ? `Nivel continuo equivalente de ${data.laeq24.toFixed(1)} dB durante 24h` : null,
          tendencia: data.percentiles ? {
            ruidoFondo: data.percentiles.las99, // Nivel superado el 99% del tiempo
            ruidoHabitual: data.percentiles.las50, // Mediana (50%)
            picos: data.percentiles.las01 // Nivel superado solo el 1% del tiempo
          } : null
        }
      }
    };

    res.status(HTTP_STATUS.OK).json(createResponse(responseData, 'Detalles obtenidos exitosamente'));

  } catch (error) {
    logger.error({
      error: error.message,
      stack: error.stack,
      noiseId: req.params.id,
      endpoint: 'GET /api/v1/noise-monitoring/:id'
    }, 'Error obteniendo detalles de contaminación acústica');
    next(createInternalError('Error al obtener registro por ID', error));
  }
};

/**
 * Obtener estadísticas de contaminación acústica
 * GET /api/v1/noise-monitoring/statistics
 */
const getNoiseStatistics = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return next(createValidationError('Parámetros de consulta inválidos', errors.array()));
    }

    const { groupBy = 'station' } = req.query;

    // Construir filtros usando queryHelper
    const filterConfig = [
      { field: 'fecha', type: 'dateRange', params: ['startDate', 'endDate'] },
      { field: 'nmt', type: 'numeric', param: 'nmt' }
    ];

    const matchStage = buildFilters(req.query, filterConfig);

    // Obtener estadísticas con método optimizado del modelo
    const { estadisticas, resumen } = await NoiseMonitoring.getStatisticsOptimized(matchStage, groupBy);

    const responseData = {
      message: 'Estadísticas de contaminación acústica obtenidas exitosamente',
      data: {
        estadisticas,
        resumen,
        configuracion: {
          agrupacion: groupBy,
          filtros: Object.keys(matchStage).length > 0 ? matchStage : null
        },
        limitesNormativos: {
          diurno: NoiseMonitoring.LIMITES_NORMATIVOS.DIURNO,
          vespertino: NoiseMonitoring.LIMITES_NORMATIVOS.VESPERTINO,
          nocturno: NoiseMonitoring.LIMITES_NORMATIVOS.NOCTURNO,
          descripcion: 'Límites en decibelios (dB) según normativa'
        }
      }
    };

    res.status(HTTP_STATUS.OK).json(createResponse(responseData, 'Estadísticas obtenidas exitosamente'));

  } catch (error) {
    logger.error({
      error: error.message,
      stack: error.stack,
      query: req.query,
      endpoint: 'GET /api/v1/noise-monitoring/statistics'
    }, 'Error obteniendo estadísticas de contaminación acústica');
    next(createInternalError('Error al calcular estadísticas', error));
  }
};

/**
 * Obtener ranking de estaciones por nivel de ruido
 * GET /api/v1/noise-monitoring/ranking
 */
const getNoiseRanking = async (req, res, next) => {
  try {
    const {
      orderBy = 'laeq24',
      limit = 20
    } = req.query;

    // Configuración de filtros usando queryHelper
    const filterConfig = [
      { field: 'fecha', type: 'dateRange', params: ['startDate', 'endDate'] }
    ];

    const matchStage = buildFilters(req.query, filterConfig);

    // Obtener ranking con método optimizado del modelo
    const ranking = await NoiseMonitoring.getRankingOptimized(matchStage, orderBy, parseInt(limit));

    const responseData = {
      message: 'Ranking de contaminación acústica obtenido exitosamente',
      data: {
        ranking,
        configuracion: {
          ordenadoPor: orderBy,
          descripcion: {
            laeq24: 'Nivel continuo equivalente 24h',
            diurno: 'Nivel diurno (07:00-19:00)',
            vespertino: 'Nivel vespertino (19:00-23:00)',
            nocturno: 'Nivel nocturno (23:00-07:00)'
          }[orderBy],
          limite: parseInt(limit)
        },
        interpretacion: {
          orden: 'Descendente (de mayor a menor nivel de ruido)',
          limitesNormativos: NoiseMonitoring.LIMITES_NORMATIVOS
        }
      }
    };

    res.status(HTTP_STATUS.OK).json(createResponse(responseData, 'Ranking obtenido exitosamente'));

  } catch (error) {
    logger.error({
      error: error.message,
      stack: error.stack,
      query: req.query,
      endpoint: 'GET /api/v1/noise-monitoring/ranking'
    }, 'Error obteniendo ranking de contaminación acústica');
    next(createInternalError('Error al generar ranking', error));
  }
};

/**
 * Buscar estaciones de monitoreo
 * GET /api/v1/noise-monitoring/stations/search
 */
const searchStations = async (req, res, next) => {
  try {
    const { q: searchTerm, limit = 20 } = req.query;

    if (!searchTerm || searchTerm.trim().length < 2) {
      return next(createBadRequestError('Término de búsqueda debe tener al menos 2 caracteres'));
    }

    const pipeline = [
      {
        $match: {
          $or: [
            { nombre: { $regex: searchTerm.trim(), $options: 'i' } },
            { nmt: isNaN(parseInt(searchTerm)) ? null : parseInt(searchTerm) }
          ].filter(Boolean)
        }
      },
      {
        $group: {
          _id: { nmt: '$nmt', nombre: '$nombre' },
          ultimaMedicion: { $max: '$fecha' },
          totalMediciones: { $sum: 1 },
          promedioLaeq24: { $avg: '$laeq24' }
        }
      },
      {
        $sort: { ultimaMedicion: -1 }
      },
      {
        $limit: parseInt(limit)
      }
    ];

    const estaciones = await NoiseMonitoring.aggregate(pipeline)
      .maxTimeMS(10000) // Timeout de 10 segundos para agregación
      .exec();

    const responseData = {
      message: `Encontradas ${estaciones.length} estaciones`,
      data: estaciones,
      busqueda: {
        termino: searchTerm,
        resultados: estaciones.length,
        limite: parseInt(limit)
      }
    };

    res.status(HTTP_STATUS.OK).json(createResponse(responseData, 'Búsqueda completada exitosamente'));

  } catch (error) {
    logger.error({
      error: error.message,
      stack: error.stack,
      query: req.query,
      endpoint: 'GET /api/v1/noise-monitoring/search-stations'
    }, 'Error buscando estaciones');
    next(createInternalError('Error en la búsqueda', error));
  }
};

/**
 * Comparación entre estaciones de monitoreo
 * GET /api/v1/noise-monitoring/stations/compare
 */
const compareStations = async (req, res, next) => {
  try {
    const { stations, startDate, endDate, metric = 'laeq24' } = req.query;

    if (!stations) {
      return next(createBadRequestError('Se requiere el parámetro "stations"'));
    }

    const stationArray = Array.isArray(stations) ? stations.map(Number) : [Number(stations)];

    if (stationArray.length < 2) {
      return next(createBadRequestError('Se requieren al menos 2 estaciones para comparar'));
    }

    const comparison = await NoiseMonitoring.getStationComparison({
      stations: stationArray,
      startDate: startDate ? new Date(startDate) : new Date('2051-01-01'),
      endDate: endDate ? new Date(endDate) : new Date('2051-12-31'),
      metric
    });

    if (!comparison || comparison.length === 0) {
      return next(createNotFoundError('Datos de comparación', `estaciones ${stationArray.join(', ')}`));
    }

    const responseData = {
      message: `Comparación de ${comparison.length} estaciones`,
      data: {
        metrica: metric,
        periodo: {
          inicio: startDate || '2051-01-01',
          fin: endDate || '2051-12-31'
        },
        estaciones: comparison,
        totalEstaciones: comparison.length
      }
    };

    res.status(HTTP_STATUS.OK).json(createResponse(responseData, 'Comparación de estaciones obtenida exitosamente'));

  } catch (error) {
    logger.error({
      error: error.message,
      stack: error.stack,
      query: req.query,
      endpoint: 'GET /api/v1/noise-monitoring/stations/compare'
    }, 'Error comparando estaciones');
    next(createInternalError('Error al comparar estaciones', error));
  }
};

/**
 * Tendencias temporales de ruido
 * GET /api/v1/noise-monitoring/trends/temporal
 */
const getTemporalTrends = async (req, res, next) => {
  try {
    const { nmt, startDate, endDate, groupBy = 'month', metric = 'laeq24' } = req.query;

    const trends = await NoiseMonitoring.getTemporalTrends({
      nmt: nmt ? Number(nmt) : undefined,
      startDate: startDate ? new Date(startDate) : new Date('2051-01-01'),
      endDate: endDate ? new Date(endDate) : new Date('2051-12-31'),
      groupBy,
      metric
    });

    if (!trends || trends.length === 0) {
      return next(createNotFoundError('Tendencias temporales', nmt ? `estación NMT ${nmt}` : 'todas las estaciones'));
    }

    const responseData = {
      data: {
        metrica: metric,
        agrupacion: groupBy,
        periodo: {
          inicio: startDate || '2051-01-01',
          fin: endDate || '2051-12-31'
        },
        ...(nmt && { estacion: Number(nmt) }),
        tendencias: trends,
        totalPeriodos: trends.length
      }
    };

    res.status(HTTP_STATUS.OK).json(createResponse(responseData, 'Tendencias temporales obtenidas exitosamente'));

  } catch (error) {
    logger.error({
      error: error.message,
      stack: error.stack,
      query: req.query,
      endpoint: 'GET /api/v1/noise-monitoring/trends/temporal'
    }, 'Error obteniendo tendencias temporales');
    next(createInternalError('Error al obtener tendencias temporales', error));
  }
};

/**
 * Análisis de cumplimiento normativo por zona
 * GET /api/v1/noise-monitoring/compliance/zone
 */
const getComplianceByZone = async (req, res, next) => {
  try {
    const { startDate, endDate, threshold = 65, zoneType = 'mixed' } = req.query;

    const compliance = await NoiseMonitoring.getComplianceAnalysisByZone({
      startDate: startDate ? new Date(startDate) : new Date('2051-01-01'),
      endDate: endDate ? new Date(endDate) : new Date('2051-12-31'),
      threshold: Number(threshold),
      zoneType
    });

    if (!compliance || compliance.length === 0) {
      return next(createNotFoundError('Datos de cumplimiento normativo'));
    }

    const responseData = {
      data: {
        umbralNormativo: Number(threshold),
        tipoZona: zoneType,
        periodo: {
          inicio: startDate || '2051-01-01',
          fin: endDate || '2051-12-31'
        },
        analisisPorZona: compliance,
        totalZonasAnalizadas: compliance.length
      }
    };

    res.status(HTTP_STATUS.OK).json(createResponse(responseData, 'Análisis de cumplimiento normativo obtenido exitosamente'));

  } catch (error) {
    logger.error({
      error: error.message,
      stack: error.stack,
      query: req.query,
      endpoint: 'GET /api/v1/noise-monitoring/compliance/zone'
    }, 'Error analizando cumplimiento normativo');
    next(createInternalError('Error al analizar cumplimiento normativo', error));
  }
};

module.exports = {
  getNoiseMonitoringData,
  getNoiseMonitoringById,
  getNoiseStatistics,
  getNoiseRanking,
  searchStations,
  compareStations,
  getTemporalTrends,
  getComplianceByZone
};


