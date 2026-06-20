/**
 * Controlador de Aforo de Bicicletas
 *
 * Maneja la logica de negocio para las operaciones relacionadas
 * con el conteo de trafico de bicicletas en estaciones de aforo.
 */

const BikeTrafficCount = require('../models/AforoBicicletas');
const { createNotFoundError } = require('../utils/errorUtils');
const { createPaginationMeta } = require('../utils/paginationHelper');
const { buildFilters, buildSortOptions, buildPaginationOptions, escapeRegex, primerValorEscalar } = require('../utils/queryHelper');
const { createResponse } = require('../utils/responseHelper');
const { documentosAFeatureCollection } = require('../utils/geoJsonHelper');
const { PAGINATION, HTTP_STATUS, MONGODB_TIMEOUTS, DATASET_YEARS, AGGREGATION_LIMITS } = require('../constants');
const asyncHandler = require('../utils/asyncHandler');
const { invalidarCacheAforoBicicletas } = require('../utils/cacheInvalidator');
const { resumirLote } = require('../utils/ingestaHelper');

/**
 * Obtener todos los registros de aforo con filtros y paginacion
 *
 * @route GET /api/v1/aforo-bicicletas
 * @access Private
 */
exports.obtenerConteos = asyncHandler(async (req, res) => {
  const filterConfig = [
    { field: 'fecha', type: 'dateRange', params: ['startDate', 'endDate'] },
    { field: 'identificador', type: 'exact', param: 'identificador' },
    // Los nombres de distrito en BD estan en case mixto ("Arganzuela", "Latina").
    // Usar regex case-insensitive en lugar de exact+toUpperCase, que nunca
    // matcheaba y dejaba la pagina vacia al filtrar por distrito.
    { field: 'ubicacion.distrito', type: 'regex', param: 'distrito' },
    { field: 'hora', type: 'numeric', param: 'hora' },
    // Franja horaria: la UI envia horaMin/horaMax (derivados de MADRUGADA/MANANA/
    // MEDIODIA/TARDE/NOCHE). Rango inclusivo sobre el campo numerico `hora`.
    { field: 'hora', type: 'numericRange', params: ['horaMin', 'horaMax'] }
  ];

  const filters = buildFilters(req.query, filterConfig);

  const sortOptions = buildSortOptions(
    req.query.sortBy || 'fecha',
    req.query.sortOrder || 'desc',
    ['fecha', 'hora', 'bicicletas', 'identificador'],
    'fecha',
    'desc'
  );

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
});

/**
 * Obtener datos de una estacion especifica
 *
 * @route GET /api/v1/aforo-bicicletas/estacion/:identificador
 * @access Private
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
  // Franja horaria (horaMin/horaMax de la UI) sobre el campo numerico `hora`.
  const { hora: rangoHora } = buildFilters(req.query, [{ field: 'hora', type: 'numericRange', params: ['horaMin', 'horaMax'] }]);
  if (rangoHora) { filters.hora = rangoHora; }

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
    identificador,
    resumen: summary[0] || null,
    registros: recentData,
    totalRegistros: recentData.length
  };

  return res.status(HTTP_STATUS.OK).json(createResponse(responseData, 'Datos de estacion obtenidos exitosamente'));
});

/**
 * Obtener estadisticas generales de aforo
 *
 * @route GET /api/v1/aforo-bicicletas/estadisticas
 * @access Private
 */
exports.obtenerEstadisticas = asyncHandler(async (req, res, next) => {
  const { startDate, endDate } = req.query;

  const start = startDate ? new Date(startDate) : new Date(DATASET_YEARS.DEFAULT_START_DATE);
  const end = endDate ? new Date(endDate) : new Date(DATASET_YEARS.DEFAULT_END_DATE);

  // Coherencia con tabla/mapa: si llega `distrito`, acotar tambien los KPIs y la
  // estacion top. Antes los KPIs ignoraban el distrito y mostraban la ciudad
  // entera (293k mediciones con o sin distrito activo).
  const extraMatch = {};
  if (req.query.distrito) {
    extraMatch['ubicacion.distrito'] = new RegExp(escapeRegex(primerValorEscalar(req.query.distrito)), 'i');
  }
  // Franja horaria: acotar KPIs y estacion top al rango de horas seleccionado.
  const { hora: rangoHora } = buildFilters(req.query, [{ field: 'hora', type: 'numericRange', params: ['horaMin', 'horaMax'] }]);
  if (rangoHora) { extraMatch.hora = rangoHora; }

  const [stats, stationTop] = await Promise.all([
    BikeTrafficCount.obtenerEstadisticasPorRangoFechas(start, end, extraMatch),
    BikeTrafficCount.aggregate([
      { $match: { fecha: { $gte: start, $lte: end }, ...extraMatch } },
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
    periodo: {
      inicio: start.toISOString().split('T')[0],
      fin: end.toISOString().split('T')[0]
    },
    estadisticas: {
      ...stats[0],
      estacionTop: stationTop[0] || null
    }
  };

  return res.status(HTTP_STATUS.OK).json(createResponse(responseData, 'Estadisticas de aforo obtenidas exitosamente'));
});

/**
 * Obtener distribucion horaria de trafico
 *
 * @route GET /api/v1/aforo-bicicletas/horaria
 * @access Private
 */
exports.obtenerDistribucionHoraria = asyncHandler(async (req, res, next) => {
  const filterConfig = [
    { field: 'fecha', type: 'dateRange', params: ['startDate', 'endDate'] },
    { field: 'identificador', type: 'exact', param: 'identificador' },
    // Los nombres de distrito en BD estan en case mixto ("Arganzuela", "Latina").
    // Usar regex case-insensitive en lugar de exact+toUpperCase, que nunca
    // matcheaba y dejaba la pagina vacia al filtrar por distrito.
    { field: 'ubicacion.distrito', type: 'regex', param: 'distrito' },
    { field: 'hora', type: 'numericRange', params: ['horaMin', 'horaMax'] }
  ];

  const filters = buildFilters(req.query, filterConfig);

  const hourlyData = await BikeTrafficCount.obtenerPatronesHorarios(filters);

  if (!hourlyData || hourlyData.length === 0) {
    return next(createNotFoundError('Datos de distribucion horaria'));
  }

  const responseData = {
    distribucionHoraria: hourlyData,
    totalHoras: hourlyData.length
  };

  return res.status(HTTP_STATUS.OK).json(createResponse(responseData, 'Distribucion horaria obtenida exitosamente'));
});

/**
 * Obtener ranking de estaciones por trafico
 *
 * @route GET /api/v1/aforo-bicicletas/estaciones
 * @access Private
 */
exports.obtenerComparativaEstaciones = asyncHandler(async (req, res, next) => {
  const limit = parseInt(req.query.limit, 10) || AGGREGATION_LIMITS.TOP_RESULTS;

  const filterConfig = [
    { field: 'fecha', type: 'dateRange', params: ['startDate', 'endDate'] },
    // Los nombres de distrito en BD estan en case mixto ("Arganzuela", "Latina").
    // Usar regex case-insensitive en lugar de exact+toUpperCase, que nunca
    // matcheaba y dejaba la pagina vacia al filtrar por distrito.
    { field: 'ubicacion.distrito', type: 'regex', param: 'distrito' },
    { field: 'hora', type: 'numericRange', params: ['horaMin', 'horaMax'] }
  ];

  const filters = buildFilters(req.query, filterConfig);

  // `totalEstaciones` debe ser el conteo REAL de estaciones distintas con el
  // filtro activo, NO `stations.length` (que esta acotado por `limit` y dejaba
  // el KPI "Estaciones activas" topado en el valor de limit, p.ej. 10). Se
  // calcula con un distinct en paralelo al ranking.
  const [stations, identificadoresUnicos] = await Promise.all([
    BikeTrafficCount.obtenerRankingEstaciones(limit, filters),
    BikeTrafficCount.distinct('identificador', filters).maxTimeMS(MONGODB_TIMEOUTS.QUERY_TIMEOUT_MS)
  ]);

  if (!stations || stations.length === 0) {
    return next(createNotFoundError('Datos de ranking de estaciones'));
  }

  const responseData = {
    estaciones: stations,
    totalEstaciones: identificadoresUnicos.length,
    limite: limit
  };

  return res.status(HTTP_STATUS.OK).json(createResponse(responseData, 'Ranking de estaciones obtenido exitosamente'));
});

/**
 * Obtener tendencias diarias de trafico
 *
 * @route GET /api/v1/aforo-bicicletas/tendencias-diarias
 * @access Private
 */
exports.obtenerTendenciasDiarias = asyncHandler(async (req, res, next) => {
  const filterConfig = [
    { field: 'fecha', type: 'dateRange', params: ['startDate', 'endDate'] },
    { field: 'identificador', type: 'exact', param: 'identificador' },
    // Los nombres de distrito en BD estan en case mixto ("Arganzuela", "Latina").
    // Usar regex case-insensitive en lugar de exact+toUpperCase, que nunca
    // matcheaba y dejaba la pagina vacia al filtrar por distrito.
    { field: 'ubicacion.distrito', type: 'regex', param: 'distrito' },
    { field: 'hora', type: 'numericRange', params: ['horaMin', 'horaMax'] }
  ];

  const filters = buildFilters(req.query, filterConfig);

  const trends = await BikeTrafficCount.obtenerTendenciasDiarias(filters);

  if (!trends || trends.length === 0) {
    return next(createNotFoundError('Datos de tendencias diarias'));
  }

  const responseData = {
    tendencias: trends,
    totalDias: trends.length
  };

  return res.status(HTTP_STATUS.OK).json(createResponse(responseData, 'Tendencias diarias obtenidas exitosamente'));
});

/**
 * Obtener mapa de estaciones de aforo de bicicletas como FeatureCollection.
 * Agrega por identificador (estacion) y suma aforo total en el rango
 * de fechas filtrado. Cada feature es un Point con las coordenadas de
 * la estacion.
 *
 * @route GET /api/v1/aforo-bicicletas/mapa
 * @access Private
 */
exports.obtenerMapaAforo = asyncHandler(async (req, res) => {
  const filterConfig = [
    { field: 'fecha', type: 'dateRange', params: ['startDate', 'endDate'] },
    // Los nombres de distrito en BD estan en case mixto ("Arganzuela", "Latina").
    // Usar regex case-insensitive en lugar de exact+toUpperCase, que nunca
    // matcheaba y dejaba la pagina vacia al filtrar por distrito.
    { field: 'ubicacion.distrito', type: 'regex', param: 'distrito' },
    { field: 'hora', type: 'numericRange', params: ['horaMin', 'horaMax'] }
  ];
  const filters = buildFilters(req.query, filterConfig);

  // Estrategia en dos pasos para 300k+ registros:
  // 1) Aggregate liviano (sin geometry) para sumatorios por estacion.
  // 2) Un findOne por estacion para obtener la ubicacion representativa
  //    (35 estaciones, queries muy rapidas con indice por identificador).
  const sumatorios = await BikeTrafficCount.aggregate([
    { $match: filters },
    {
      $group: {
        _id: '$identificador',
        totalBicicletas: { $sum: '$bicicletas' },
        registros: { $sum: 1 }
      }
    },
    { $sort: { totalBicicletas: -1 } }
  ]).option({ allowDiskUse: true, maxTimeMS: 15000 });

  // Lookup paralelo de ubicaciones representativas por estacion
  const identificadores = sumatorios.map(s => s._id);
  const ubicacionesPorId = new Map();
  const docsUbicacion = await BikeTrafficCount.aggregate([
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

  // Componer resultado final
  const agregacion = sumatorios
    .map(s => ({
      _id: s._id,
      totalBicicletas: s.totalBicicletas,
      registros: s.registros,
      ultimaUbicacion: ubicacionesPorId.get(s._id) || null
    }))
    .filter(s => s.ultimaUbicacion); // Solo estaciones con ubicacion conocida

  const featureCollection = documentosAFeatureCollection(
    agregacion,
    (doc) => ({
      id: doc._id,
      geometry: doc.ultimaUbicacion?.geometry,
      properties: {
        identificador: doc._id,
        totalBicicletas: doc.totalBicicletas,
        registros: doc.registros,
        distrito: doc.ultimaUbicacion?.distrito,
        nombreVial: doc.ultimaUbicacion?.nombreVial
      }
    }),
    { recurso: 'aforo-bicicletas' }
  );

  return res.status(HTTP_STATUS.OK).json(
    createResponse(featureCollection, 'Mapa de aforo de bicicletas generado exitosamente')
  );
});

/**
 * Registrar una lectura horaria de aforo de bicicletas (ingesta de nodo IoT).
 * Upsert idempotente por (identificador, fecha, hora).
 *
 * @route POST /api/v1/aforo-bicicletas/ingesta
 * @access Private (JWT)
 */
exports.ingestarConteo = asyncHandler(async (req, res) => {
  const resultado = await BikeTrafficCount.ingestarConteo(req.body);
  invalidarCacheAforoBicicletas(resultado.documento?._id, 'ingesta');

  const codigo = resultado.creado ? HTTP_STATUS.CREATED : HTTP_STATUS.OK;
  return res.status(codigo).json(createResponse({
    estado: resultado.estado,
    identificador: resultado.documento.identificador,
    fecha: resultado.documento.fecha,
    hora: resultado.documento.hora,
    bicicletas: resultado.documento.bicicletas,
    franjaHoraria: resultado.documento.franjaHoraria
  }, `Conteo de aforo de bicicletas ${resultado.estado}`));
});

/**
 * Registrar un lote de lecturas de aforo de bicicletas (ingesta IoT).
 * Cada elemento se procesa como upsert idempotente independiente.
 *
 * @route POST /api/v1/aforo-bicicletas/ingesta/lote
 * @access Private (JWT)
 */
exports.ingestarLote = asyncHandler(async (req, res) => {
  const { lecturas } = req.body;
  const resultados = await Promise.allSettled(
    lecturas.map((lectura) => BikeTrafficCount.ingestarConteo(lectura))
  );
  const resumen = resumirLote(resultados);
  invalidarCacheAforoBicicletas(null, 'ingesta-lote');

  return res.status(HTTP_STATUS.CREATED).json(createResponse(
    resumen,
    `Lote procesado: ${resumen.creados} creados, ${resumen.actualizados} actualizados, ${resumen.fallidos} fallidos`
  ));
});
