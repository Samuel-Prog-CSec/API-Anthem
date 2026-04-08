/**
 * Controlador de Aforo de Bicicletas
 *
 * Maneja la logica de negocio para las operaciones relacionadas
 * con el conteo de trafico de bicicletas en estaciones de aforo.
 */

const BikeTrafficCount = require('../models/AforoBicicletas');
const { createInternalError, createNotFoundError } = require('../utils/errorUtils');
const { createPaginationMeta } = require('../utils/paginationHelper');
const { buildFilters, buildSortOptions, buildPaginationOptions, TRANSFORMS } = require('../utils/queryHelper');
const { createResponse } = require('../utils/responseHelper');
const { SORT_FIELDS, PAGINATION, HTTP_STATUS, MONGODB_TIMEOUTS, DATASET_YEARS, AGGREGATION_LIMITS } = require('../constants');
const logger = require('../config/logger');

/**
 * Obtener todos los registros de aforo con filtros y paginacion
 *
 * @route GET /api/bike-traffic
 * @access Private
 */
exports.obtenerConteos = async (req, res, next) => {
  try {
    // Configuracion de filtros usando queryHelper
    const filterConfig = [
      { field: 'fecha', type: 'dateRange', params: ['startDate', 'endDate'] },
      { field: 'identificador', type: 'exact', param: 'identificador' },
      { field: 'ubicacion.distrito', type: 'exact', param: 'distrito', transform: TRANSFORMS.toUpperCase },
      { field: 'hora', type: 'numeric', param: 'hora' }
    ];

    const filters = buildFilters(req.query, filterConfig);

    // Configurar ordenamiento
    const sortOptions = buildSortOptions(
      req.query.sortBy || 'fecha',
      req.query.sortOrder || 'desc',
      ['fecha', 'hora', 'bicicletas', 'identificador'],
      'fecha',
      'desc'
    );

    // Configurar paginacion
    const paginationOptions = buildPaginationOptions(req.query, {
      defaultLimit: PAGINATION.DEFAULT_LIMIT,
      maxLimit: PAGINATION.MAX_LIMIT
    });

    // Proyeccion optimizada: solo campos necesarios para listado
    const projection = {
      fecha: 1,
      hora: 1,
      identificador: 1,
      bicicletas: 1,
      franjaHoraria: 1,
      'ubicacion.distrito': 1,
      'ubicacion.nombreVial': 1,
      'ubicacion.coordenadas': 1
    };

    // Consultas paralelas: datos + conteo
    const [data, total] = await Promise.all([
      BikeTrafficCount.find(filters, projection)
        .sort(sortOptions)
        .skip((paginationOptions.page - 1) * paginationOptions.limit)
        .limit(paginationOptions.limit)
        .maxTimeMS(MONGODB_TIMEOUTS.AGGREGATE_TIMEOUT_MS)
        .lean(),

      BikeTrafficCount.countDocuments(filters)
        .maxTimeMS(MONGODB_TIMEOUTS.QUERY_TIMEOUT_MS)
    ]);

    const responseData = {
      data,
      pagination: createPaginationMeta(paginationOptions.page, paginationOptions.limit, total),
      filtrosAplicados: {
        ...(req.query.startDate && { fechaInicio: req.query.startDate }),
        ...(req.query.endDate && { fechaFin: req.query.endDate }),
        ...(req.query.identificador && { estacion: req.query.identificador }),
        ...(req.query.distrito && { distrito: req.query.distrito }),
        ...(req.query.hora !== undefined && { hora: req.query.hora })
      }
    };

    return res.status(HTTP_STATUS.OK).json(createResponse(responseData, 'Datos de aforo de bicicletas obtenidos exitosamente'));

  } catch (error) {
    next(createInternalError('Error al obtener datos de aforo de bicicletas', error));
  }
};

/**
 * Obtener datos de una estacion especifica
 *
 * @route GET /api/bike-traffic/station/:identificador
 * @access Private
 */
exports.obtenerDatosEstacion = async (req, res, next) => {
  try {
    const { identificador } = req.params;
    const { startDate, endDate } = req.query;

    // Construir filtros
    const filters = { identificador };
    if (startDate || endDate) {
      filters.fecha = {};
      if (startDate) {filters.fecha.$gte = new Date(startDate);}
      if (endDate) {filters.fecha.$lte = new Date(endDate);}
    }

    // Consultas paralelas: datos recientes + resumen
    const [recentData, summary] = await Promise.all([
      BikeTrafficCount.find(filters)
        .sort({ fecha: -1, hora: -1 })
        .limit(PAGINATION.MAX_LIMIT)
        .select('fecha hora bicicletas franjaHoraria ubicacion.distrito ubicacion.nombreVial')
        .maxTimeMS(MONGODB_TIMEOUTS.AGGREGATE_TIMEOUT_MS)
        .lean(),

      BikeTrafficCount.aggregate([
        { $match: filters },
        {
          $group: {
            _id: null,
            totalMediciones: { $sum: 1 },
            totalBicicletas: { $sum: '$bicicletas' },
            promedioPorHora: { $avg: '$bicicletas' },
            maxBicicletasHora: { $max: '$bicicletas' },
            minBicicletasHora: { $min: '$bicicletas' },
            distrito: { $first: '$ubicacion.distrito' },
            nombreVial: { $first: '$ubicacion.nombreVial' },
            coordenadas: { $first: '$ubicacion.coordenadas' }
          }
        },
        {
          $project: {
            _id: 0,
            totalMediciones: 1,
            totalBicicletas: 1,
            promedioPorHora: { $round: ['$promedioPorHora', 2] },
            maxBicicletasHora: 1,
            minBicicletasHora: 1,
            distrito: 1,
            nombreVial: 1,
            coordenadas: 1
          }
        }
      ]).option({ allowDiskUse: true, maxTimeMS: MONGODB_TIMEOUTS.AGGREGATE_TIMEOUT_MS })
    ]);

    if (!recentData || recentData.length === 0) {
      return next(createNotFoundError('Datos de estacion de aforo', identificador));
    }

    const responseData = {
      data: {
        identificador,
        resumen: summary[0] || null,
        registros: recentData,
        totalRegistros: recentData.length
      }
    };

    return res.status(HTTP_STATUS.OK).json(createResponse(responseData, 'Datos de estacion obtenidos exitosamente'));

  } catch (error) {
    next(createInternalError('Error al obtener datos de estacion de aforo', error));
  }
};

/**
 * Obtener estadisticas generales de aforo
 *
 * @route GET /api/bike-traffic/stats
 * @access Private
 */
exports.obtenerEstadisticas = async (req, res, next) => {
  try {
    const { startDate, endDate } = req.query;

    // Si no se proporcionan fechas, usar todo el dataset
    const start = startDate ? new Date(startDate) : new Date(DATASET_YEARS.DEFAULT_START_DATE);
    const end = endDate ? new Date(endDate) : new Date(DATASET_YEARS.DEFAULT_END_DATE);

    // Consultas paralelas: estadisticas generales + estacion top
    const [stats, stationTop] = await Promise.all([
      BikeTrafficCount.obtenerEstadisticasPorRangoFechas(start, end),

      BikeTrafficCount.aggregate([
        {
          $match: {
            fecha: { $gte: start, $lte: end }
          }
        },
        {
          $group: {
            _id: '$identificador',
            totalBicicletas: { $sum: '$bicicletas' },
            distrito: { $first: '$ubicacion.distrito' },
            nombreVial: { $first: '$ubicacion.nombreVial' }
          }
        },
        { $sort: { totalBicicletas: -1 } },
        { $limit: 1 },
        {
          $project: {
            _id: 0,
            identificador: '$_id',
            totalBicicletas: 1,
            distrito: 1,
            nombreVial: 1
          }
        }
      ]).option({ allowDiskUse: true, maxTimeMS: MONGODB_TIMEOUTS.AGGREGATE_TIMEOUT_MS })
    ]);

    if (!stats || stats.length === 0) {
      return next(createNotFoundError('Estadisticas de aforo', `rango ${start.toISOString().split('T')[0]} - ${end.toISOString().split('T')[0]}`));
    }

    const responseData = {
      data: {
        periodo: {
          inicio: start.toISOString().split('T')[0],
          fin: end.toISOString().split('T')[0]
        },
        estadisticas: {
          ...stats[0],
          estacionTop: stationTop[0] || null
        }
      }
    };

    return res.status(HTTP_STATUS.OK).json(createResponse(responseData, 'Estadisticas de aforo obtenidas exitosamente'));

  } catch (error) {
    next(createInternalError('Error al obtener estadisticas de aforo de bicicletas', error));
  }
};

/**
 * Obtener distribucion horaria de trafico
 *
 * @route GET /api/bike-traffic/hourly
 * @access Private
 */
exports.obtenerDistribucionHoraria = async (req, res, next) => {
  try {
    // Construir filtros opcionales
    const filterConfig = [
      { field: 'fecha', type: 'dateRange', params: ['startDate', 'endDate'] },
      { field: 'identificador', type: 'exact', param: 'identificador' },
      { field: 'ubicacion.distrito', type: 'exact', param: 'distrito', transform: TRANSFORMS.toUpperCase }
    ];

    const filters = buildFilters(req.query, filterConfig);

    const hourlyData = await BikeTrafficCount.obtenerPatronesHorarios(filters);

    if (!hourlyData || hourlyData.length === 0) {
      return next(createNotFoundError('Datos de distribucion horaria'));
    }

    const responseData = {
      data: {
        distribucionHoraria: hourlyData,
        totalHoras: hourlyData.length
      }
    };

    return res.status(HTTP_STATUS.OK).json(createResponse(responseData, 'Distribucion horaria obtenida exitosamente'));

  } catch (error) {
    next(createInternalError('Error al obtener distribucion horaria', error));
  }
};

/**
 * Obtener ranking de estaciones por trafico
 *
 * @route GET /api/bike-traffic/stations
 * @access Private
 */
exports.obtenerComparativaEstaciones = async (req, res, next) => {
  try {
    const limit = parseInt(req.query.limit, 10) || AGGREGATION_LIMITS.TOP_RESULTS;

    // Construir filtros opcionales
    const filterConfig = [
      { field: 'fecha', type: 'dateRange', params: ['startDate', 'endDate'] },
      { field: 'ubicacion.distrito', type: 'exact', param: 'distrito', transform: TRANSFORMS.toUpperCase }
    ];

    const filters = buildFilters(req.query, filterConfig);

    const stations = await BikeTrafficCount.obtenerRankingEstaciones(limit, filters);

    if (!stations || stations.length === 0) {
      return next(createNotFoundError('Datos de ranking de estaciones'));
    }

    const responseData = {
      data: {
        estaciones: stations,
        totalEstaciones: stations.length,
        limite: limit
      }
    };

    return res.status(HTTP_STATUS.OK).json(createResponse(responseData, 'Ranking de estaciones obtenido exitosamente'));

  } catch (error) {
    next(createInternalError('Error al obtener ranking de estaciones', error));
  }
};

/**
 * Obtener tendencias diarias de trafico
 *
 * @route GET /api/bike-traffic/trends/daily
 * @access Private
 */
exports.obtenerTendenciasDiarias = async (req, res, next) => {
  try {
    // Construir filtros
    const filterConfig = [
      { field: 'fecha', type: 'dateRange', params: ['startDate', 'endDate'] },
      { field: 'identificador', type: 'exact', param: 'identificador' },
      { field: 'ubicacion.distrito', type: 'exact', param: 'distrito', transform: TRANSFORMS.toUpperCase }
    ];

    const filters = buildFilters(req.query, filterConfig);

    const trends = await BikeTrafficCount.obtenerTendenciasDiarias(filters);

    if (!trends || trends.length === 0) {
      return next(createNotFoundError('Datos de tendencias diarias'));
    }

    const responseData = {
      data: {
        tendencias: trends,
        totalDias: trends.length
      }
    };

    return res.status(HTTP_STATUS.OK).json(createResponse(responseData, 'Tendencias diarias obtenidas exitosamente'));

  } catch (error) {
    next(createInternalError('Error al obtener tendencias diarias', error));
  }
};
