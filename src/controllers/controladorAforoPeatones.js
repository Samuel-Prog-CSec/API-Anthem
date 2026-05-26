/**
 * Controlador de Aforo de Peatones
 *
 * Equivalente a `controladorAforoBicicletas` para conteo horario de
 * trafico peatonal. Coordina HTTP -> Model (`AforoPeatones`).
 */

const PedestrianTrafficCount = require('../models/AforoPeatones');
const { createNotFoundError } = require('../utils/errorUtils');
const { createPaginationMeta } = require('../utils/paginationHelper');
const { buildFilters, buildSortOptions, buildPaginationOptions, TRANSFORMS } = require('../utils/queryHelper');
const { createResponse } = require('../utils/responseHelper');
const { documentosAFeatureCollection } = require('../utils/geoJsonHelper');
const { PAGINATION, HTTP_STATUS, MONGODB_TIMEOUTS, DATASET_YEARS, AGGREGATION_LIMITS } = require('../constants');
const asyncHandler = require('../utils/asyncHandler');

/**
 * Listado paginado con filtros (fecha, identificador, distrito, hora).
 * @route GET /api/v1/aforo-peatones
 */
exports.obtenerConteos = asyncHandler(async (req, res) => {
  const filterConfig = [
    { field: 'fecha', type: 'dateRange', params: ['startDate', 'endDate'] },
    { field: 'identificador', type: 'exact', param: 'identificador' },
    // Distrito en BD en case mixto: usar regex case-insensitive para
    // que el filtro funcione (antes exact+toUpperCase nunca matcheaba).
    { field: 'ubicacion.distrito', type: 'regex', param: 'distrito' },
    { field: 'hora', type: 'numeric', param: 'hora' }
  ];

  const filters = buildFilters(req.query, filterConfig);

  const sortOptions = buildSortOptions(
    req.query.sortBy || 'fecha',
    req.query.sortOrder || 'desc',
    ['fecha', 'hora', 'peatones', 'identificador'],
    'fecha',
    'desc'
  );

  const paginationOptions = buildPaginationOptions(req.query, {
    defaultLimit: PAGINATION.DEFAULT_LIMIT,
    maxLimit: PAGINATION.MAX_LIMIT
  });

  const projection = {
    fecha: 1,
    hora: 1,
    identificador: 1,
    peatones: 1,
    franjaHoraria: 1,
    'ubicacion.distrito': 1,
    'ubicacion.nombreVial': 1,
    'ubicacion.coordenadas': 1
  };

  const [data, total] = await Promise.all([
    PedestrianTrafficCount.find(filters, projection)
      .sort(sortOptions)
      .skip((paginationOptions.page - 1) * paginationOptions.limit)
      .limit(paginationOptions.limit)
      .maxTimeMS(MONGODB_TIMEOUTS.AGGREGATE_TIMEOUT_MS)
      .lean(),
    PedestrianTrafficCount.countDocuments(filters)
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

  return res.status(HTTP_STATUS.OK).json(
    createResponse(responseData, 'Datos de aforo de peatones obtenidos exitosamente')
  );
});

/**
 * Datos completos de una estacion concreta.
 * @route GET /api/v1/aforo-peatones/estacion/:identificador
 */
exports.obtenerDatosEstacion = asyncHandler(async (req, res, next) => {
  const { identificador } = req.params;
  const { startDate, endDate } = req.query;

  const filters = { identificador };
  if (startDate || endDate) {
    filters.fecha = {};
    if (startDate) { filters.fecha.$gte = new Date(startDate); }
    if (endDate) { filters.fecha.$lte = new Date(endDate); }
  }

  const [recentData, summary] = await Promise.all([
    PedestrianTrafficCount.find(filters)
      .sort({ fecha: -1, hora: -1 })
      .limit(PAGINATION.MAX_LIMIT)
      .select('fecha hora peatones franjaHoraria ubicacion.distrito ubicacion.nombreVial')
      .maxTimeMS(MONGODB_TIMEOUTS.AGGREGATE_TIMEOUT_MS)
      .lean(),

    PedestrianTrafficCount.aggregate([
      { $match: filters },
      {
        $group: {
          _id: null,
          totalMediciones: { $sum: 1 },
          totalPeatones: { $sum: '$peatones' },
          promedioPorHora: { $avg: '$peatones' },
          maxPeatonesHora: { $max: '$peatones' },
          minPeatonesHora: { $min: '$peatones' },
          distrito: { $first: '$ubicacion.distrito' },
          nombreVial: { $first: '$ubicacion.nombreVial' },
          coordenadas: { $first: '$ubicacion.coordenadas' }
        }
      },
      {
        $project: {
          _id: 0,
          totalMediciones: 1,
          totalPeatones: 1,
          promedioPorHora: { $round: ['$promedioPorHora', 2] },
          maxPeatonesHora: 1,
          minPeatonesHora: 1,
          distrito: 1,
          nombreVial: 1,
          coordenadas: 1
        }
      }
    ]).option({ allowDiskUse: true, maxTimeMS: MONGODB_TIMEOUTS.AGGREGATE_TIMEOUT_MS })
  ]);

  if (!recentData || recentData.length === 0) {
    return next(createNotFoundError('Datos de estacion de aforo peatonal', identificador));
  }

  const responseData = {
    identificador,
    resumen: summary[0] || null,
    registros: recentData,
    totalRegistros: recentData.length
  };

  return res.status(HTTP_STATUS.OK).json(
    createResponse(responseData, 'Datos de estacion peatonal obtenidos exitosamente')
  );
});

/**
 * Estadisticas generales del periodo.
 * @route GET /api/v1/aforo-peatones/estadisticas
 */
exports.obtenerEstadisticas = asyncHandler(async (req, res, next) => {
  const { startDate, endDate } = req.query;

  const start = startDate ? new Date(startDate) : new Date(DATASET_YEARS.DEFAULT_START_DATE);
  const end = endDate ? new Date(endDate) : new Date(DATASET_YEARS.DEFAULT_END_DATE);

  const [stats, stationTop] = await Promise.all([
    PedestrianTrafficCount.obtenerEstadisticasPorRangoFechas(start, end),
    PedestrianTrafficCount.aggregate([
      { $match: { fecha: { $gte: start, $lte: end } } },
      {
        $group: {
          _id: '$identificador',
          totalPeatones: { $sum: '$peatones' },
          distrito: { $first: '$ubicacion.distrito' },
          nombreVial: { $first: '$ubicacion.nombreVial' }
        }
      },
      { $sort: { totalPeatones: -1 } },
      { $limit: 1 },
      {
        $project: {
          _id: 0,
          identificador: '$_id',
          totalPeatones: 1,
          distrito: 1,
          nombreVial: 1
        }
      }
    ]).option({ allowDiskUse: true, maxTimeMS: MONGODB_TIMEOUTS.AGGREGATE_TIMEOUT_MS })
  ]);

  if (!stats || stats.length === 0) {
    return next(createNotFoundError(
      'Estadisticas de aforo peatonal',
      `rango ${start.toISOString().split('T')[0]} - ${end.toISOString().split('T')[0]}`
    ));
  }

  const responseData = {
    periodo: {
      inicio: start.toISOString().split('T')[0],
      fin: end.toISOString().split('T')[0]
    },
    estadisticas: {
      ...stats[0],
      estacionTop: stationTop[0] || null
    }
  };

  return res.status(HTTP_STATUS.OK).json(
    createResponse(responseData, 'Estadisticas de aforo peatonal obtenidas exitosamente')
  );
});

/**
 * Distribucion horaria (promedio por hora 0-23).
 * @route GET /api/v1/aforo-peatones/horaria
 */
exports.obtenerDistribucionHoraria = asyncHandler(async (req, res, next) => {
  const filterConfig = [
    { field: 'fecha', type: 'dateRange', params: ['startDate', 'endDate'] },
    { field: 'identificador', type: 'exact', param: 'identificador' },
    // Distrito en BD en case mixto: usar regex case-insensitive para
    // que el filtro funcione (antes exact+toUpperCase nunca matcheaba).
    { field: 'ubicacion.distrito', type: 'regex', param: 'distrito' }
  ];

  const filters = buildFilters(req.query, filterConfig);

  const hourlyData = await PedestrianTrafficCount.obtenerPatronesHorarios(filters);

  if (!hourlyData || hourlyData.length === 0) {
    return next(createNotFoundError('Datos de distribucion horaria peatonal'));
  }

  const responseData = {
    distribucionHoraria: hourlyData,
    totalHoras: hourlyData.length
  };

  return res.status(HTTP_STATUS.OK).json(
    createResponse(responseData, 'Distribucion horaria peatonal obtenida exitosamente')
  );
});

/**
 * Ranking de estaciones por volumen peatonal.
 * @route GET /api/v1/aforo-peatones/estaciones
 */
exports.obtenerComparativaEstaciones = asyncHandler(async (req, res, next) => {
  const limit = parseInt(req.query.limit, 10) || AGGREGATION_LIMITS.TOP_RESULTS;

  const filterConfig = [
    { field: 'fecha', type: 'dateRange', params: ['startDate', 'endDate'] },
    // Distrito en BD en case mixto: usar regex case-insensitive para
    // que el filtro funcione (antes exact+toUpperCase nunca matcheaba).
    { field: 'ubicacion.distrito', type: 'regex', param: 'distrito' }
  ];

  const filters = buildFilters(req.query, filterConfig);

  const stations = await PedestrianTrafficCount.obtenerRankingEstaciones(limit, filters);

  if (!stations || stations.length === 0) {
    return next(createNotFoundError('Datos de ranking de estaciones peatonales'));
  }

  const responseData = {
    estaciones: stations,
    totalEstaciones: stations.length,
    limite: limit
  };

  return res.status(HTTP_STATUS.OK).json(
    createResponse(responseData, 'Ranking de estaciones peatonales obtenido exitosamente')
  );
});

/**
 * Tendencias diarias agregadas por dia.
 * @route GET /api/v1/aforo-peatones/tendencias-diarias
 */
exports.obtenerTendenciasDiarias = asyncHandler(async (req, res, next) => {
  const filterConfig = [
    { field: 'fecha', type: 'dateRange', params: ['startDate', 'endDate'] },
    { field: 'identificador', type: 'exact', param: 'identificador' },
    // Distrito en BD en case mixto: usar regex case-insensitive para
    // que el filtro funcione (antes exact+toUpperCase nunca matcheaba).
    { field: 'ubicacion.distrito', type: 'regex', param: 'distrito' }
  ];

  const filters = buildFilters(req.query, filterConfig);

  const trends = await PedestrianTrafficCount.obtenerTendenciasDiarias(filters);

  if (!trends || trends.length === 0) {
    return next(createNotFoundError('Datos de tendencias diarias peatonales'));
  }

  const responseData = {
    tendencias: trends,
    totalDias: trends.length
  };

  return res.status(HTTP_STATUS.OK).json(
    createResponse(responseData, 'Tendencias diarias peatonales obtenidas exitosamente')
  );
});

/**
 * Mapa GeoJSON FeatureCollection agregando aforo por estacion.
 *
 * Estrategia en 2 pasos para 1M+ registros:
 *  1) Aggregate liviano (sin geometry) para sumatorios por estacion.
 *  2) Lookup paralelo de ubicacion representativa por estacion.
 *
 * @route GET /api/v1/aforo-peatones/mapa
 */
exports.obtenerMapaAforo = asyncHandler(async (req, res) => {
  const filterConfig = [
    { field: 'fecha', type: 'dateRange', params: ['startDate', 'endDate'] },
    // Distrito en BD en case mixto: usar regex case-insensitive para
    // que el filtro funcione (antes exact+toUpperCase nunca matcheaba).
    { field: 'ubicacion.distrito', type: 'regex', param: 'distrito' }
  ];
  const filters = buildFilters(req.query, filterConfig);

  const sumatorios = await PedestrianTrafficCount.aggregate([
    { $match: filters },
    {
      $group: {
        _id: '$identificador',
        totalPeatones: { $sum: '$peatones' },
        registros: { $sum: 1 }
      }
    },
    { $sort: { totalPeatones: -1 } }
  ]).option({ allowDiskUse: true, maxTimeMS: 15000 });

  const identificadores = sumatorios.map(s => s._id);
  const ubicacionesPorId = new Map();
  const docsUbicacion = await PedestrianTrafficCount.aggregate([
    {
      $match: {
        identificador: { $in: identificadores },
        'ubicacion.geometry.coordinates': { $exists: true, $ne: null, $type: 'array' }
      }
    },
    { $sort: { fecha: -1 } },
    {
      $group: {
        _id: '$identificador',
        ubicacion: { $first: '$ubicacion' }
      }
    }
  ]).option({ allowDiskUse: true, maxTimeMS: 15000 });

  for (const u of docsUbicacion) {
    ubicacionesPorId.set(u._id, u.ubicacion);
  }

  const agregacion = sumatorios
    .map(s => ({
      _id: s._id,
      totalPeatones: s.totalPeatones,
      registros: s.registros,
      ultimaUbicacion: ubicacionesPorId.get(s._id) || null
    }))
    .filter(s => s.ultimaUbicacion);

  const featureCollection = documentosAFeatureCollection(
    agregacion,
    (doc) => ({
      id: doc._id,
      geometry: doc.ultimaUbicacion?.geometry,
      properties: {
        identificador: doc._id,
        totalPeatones: doc.totalPeatones,
        registros: doc.registros,
        distrito: doc.ultimaUbicacion?.distrito,
        nombreVial: doc.ultimaUbicacion?.nombreVial
      }
    }),
    { recurso: 'aforo-peatones' }
  );

  return res.status(HTTP_STATUS.OK).json(
    createResponse(featureCollection, 'Mapa de aforo de peatones generado exitosamente')
  );
});
