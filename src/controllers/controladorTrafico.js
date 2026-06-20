/**
 * Controlador de Trafico
 *
 * Gestiona las operaciones CRUD y consultas especializadas para datos de trafico.
 */

const Traffic = require('../models/Trafico');
const Location = require('../models/Ubicacion');
const { createNotFoundError, createBadRequestError } = require('../utils/errorUtils');
const { createPaginationMeta, buildCursorQuery, createCursorMeta } = require('../utils/paginationHelper');
const { buildFilters, buildSortOptions, buildPaginationOptions, TRANSFORMS, buildResponseMetadata, parseNumericParams, executeFacetPagination } = require('../utils/queryHelper');
const { createResponse } = require('../utils/responseHelper');
const { documentosAFeatureCollection } = require('../utils/geoJsonHelper');
const { SORT_FIELDS, PAGINATION, HTTP_STATUS, CONGESTION_LEVELS, DATA_QUALITY_LEVELS, TRAFFIC_ELEMENT_TYPES, MONGODB_TIMEOUTS } = require('../constants');
const asyncHandler = require('../utils/asyncHandler');
const { invalidarCacheTrafico } = require('../utils/cacheInvalidator');
const { resumirLote } = require('../utils/ingestaHelper');

// Maximo absoluto de dias para el endpoint /mapa. La coleccion de trafico
// tiene ~138M docs; un rango mayor a 7 dias hace lookup masivo a locations.
const TRAFICO_MAPA_MAX_DIAS = 7;

/**
 * Obtener todas las mediciones de trafico con filtros avanzados
 * GET /api/v1/trafico
 */
const obtenerDatosTrafico = asyncHandler(async (req, res, next) => {
  const {
    page = PAGINATION.DEFAULT_PAGE,
    limit = PAGINATION.DEFAULT_LIMIT,
    sortBy = 'fecha',
    sortOrder = 'desc'
  } = req.query;

  const paginationOptions = buildPaginationOptions(
    { page, limit },
    { defaultLimit: PAGINATION.DEFAULT_LIMIT, maxLimit: PAGINATION.MAX_LIMIT }
  );

  const { cursor } = req.query;
  const useCursor = Boolean(cursor);

  const filterConfig = [
    { field: 'fecha', type: 'dateRange', params: ['startDate', 'endDate'] },
    { field: 'puntoMedidaId', type: 'exact', param: 'puntoMedidaId' },
    { field: 'tipoElemento', type: 'exact', param: 'tipoElemento', transform: TRANSFORMS.toUpperCase },
    { field: 'analisis.nivelCongestion', type: 'exact', param: 'nivelCongestion', transform: TRANSFORMS.toUpperCase },
    { field: 'calidadDatos.calidadGeneral', type: 'exact', param: 'calidad', transform: TRANSFORMS.toUpperCase }
  ];

  const filters = buildFilters(req.query, filterConfig);

  // Defensa de rendimiento: `traffic_measurements` es la coleccion mas masiva
  // (~132M docs). Un listado sin filtro selectivo forzaria un $count exacto
  // sobre toda la coleccion en cada request (varios segundos, presion de
  // WiredTiger). Se exige un rango de fechas o un puntoMedidaId, alineado con
  // el contrato del frontend (que siempre envia un rango) y con la intencion ya
  // documentada de la ruta (paginar por trimestres / filtrar por punto).
  if (!filters.fecha && !filters.puntoMedidaId) {
    return next(createBadRequestError(
      'Para listar mediciones de trafico se requiere un rango de fechas (startDate y endDate) o un puntoMedidaId'
    ));
  }

  const sortMapping = {
    fecha: 'fecha',
    intensidad: 'metricas.intensidad',
    ocupacion: 'metricas.ocupacion',
    carga: 'metricas.carga',
    puntoMedidaId: 'puntoMedidaId'
  };
  // SORT_FIELDS.TRAFFIC es un ARRAY de nombres de campo validos; pasarlo
  // directamente (NO Object.keys, que devolveria indices y hacia que el sort
  // colapsara siempre a _id ignorando el campo pedido por el usuario).
  const sortOptions = buildSortOptions(
    { sortBy, sortOrder },
    sortMapping,
    SORT_FIELDS.TRAFFIC,
    'fecha',
    'desc'
  );

  // Proyeccion optimizada: solo campos necesarios para listado
  const projection = {
    fecha: 1,
    puntoMedidaId: 1,
    tipoElemento: 1,
    'metricas.intensidad': 1,
    'metricas.velocidadMedia': 1,
    'metricas.ocupacion': 1,
    'metricas.carga': 1,
    'calidadDatos.calidadGeneral': 1,
    'analisis.nivelCongestion': 1,
    'analisis.clasificacionIntensidad': 1
  };

  const primarySortField = Object.keys(sortOptions)[0] || 'fecha';
  const cursorSortOrder = sortOptions[primarySortField] === 1 ? 'asc' : 'desc';
  const cursorFilter = useCursor ? buildCursorQuery({ cursor, sortField: primarySortField, sortOrder: cursorSortOrder }) : null;
  const combinedFilters = cursorFilter ? { $and: [filters, cursorFilter] } : filters;
  const sortWithTiebreak = { ...sortOptions, _id: cursorSortOrder === 'asc' ? 1 : -1 };

  // Pipeline de estadisticas: se ejecuta DENTRO del $facet en modo offset
  // (ahorra una pasada completa de la coleccion de ~138M docs); en modo cursor
  // se ejecuta en paralelo a la consulta de datos.
  // NO usar $limit antes de $group: corrompe las estadisticas globales.
  const statsPipeline = [
    {
      $group: {
        _id: null,
        intensidadPromedio: {
          $avg: {
            $cond: [{ $gte: ['$metricas.intensidad', 0] }, '$metricas.intensidad', null]
          }
        },
        ocupacionPromedio: {
          $avg: {
            $cond: [{ $gte: ['$metricas.ocupacion', 0] }, '$metricas.ocupacion', null]
          }
        },
        medicionesConfiables: {
          $sum: {
            $cond: [{ $in: ['$calidadDatos.calidadGeneral', [DATA_QUALITY_LEVELS.ALTA, DATA_QUALITY_LEVELS.MEDIA]] }, 1, 0]
          }
        }
      }
    }
  ];

  let trafficData = [];
  let totalCount = null;
  let trafficFacetFallback = false;
  let trafficFacetError = null;
  let statsObj = null;

  if (useCursor) {
    [trafficData, statsObj] = await Promise.all([
      Traffic.find(combinedFilters, projection)
        .sort(sortWithTiebreak)
        .limit(paginationOptions.limit)
        .maxTimeMS(MONGODB_TIMEOUTS.QUERY_TIMEOUT_MS)
        .lean(),
      Traffic.aggregate([{ $match: filters }, ...statsPipeline])
        .option({ allowDiskUse: true, maxTimeMS: MONGODB_TIMEOUTS.AGGREGATE_TIMEOUT_MS })
        .exec()
        .then(arr => arr?.[0] || null)
        .catch(() => null)
    ]);
  } else {
    const facetResult = await executeFacetPagination({
      model: Traffic,
      filters,
      sort: sortOptions,
      projection,
      pagination: paginationOptions,
      statsPipeline,
      maxTimeMS: MONGODB_TIMEOUTS.AGGREGATE_TIMEOUT_MS
    });

    trafficData = facetResult.data;
    totalCount = facetResult.total;
    statsObj = facetResult.stats;
    trafficFacetFallback = facetResult.fallback;
    trafficFacetError = facetResult.fallbackError;
  }

  const responseData = {
    data: trafficData,
    pagination: useCursor
      ? createCursorMeta({ results: trafficData, limit: paginationOptions.limit, sortField: primarySortField, sortOrder: cursorSortOrder })
      : createPaginationMeta(paginationOptions.page, paginationOptions.limit, totalCount),
    filters: {
      applied: filters,
      available: {
        tipoElemento: Object.values(TRAFFIC_ELEMENT_TYPES),
        nivelCongestion: Object.values(CONGESTION_LEVELS),
        calidad: Object.values(DATA_QUALITY_LEVELS)
      }
    },
    stats: statsObj || {
      intensidadPromedio: 0,
      ocupacionPromedio: 0,
      medicionesConfiables: 0
    },
    performance: useCursor
      ? { cursorPagination: true }
      : trafficFacetFallback
        ? { facetFallback: true, reason: trafficFacetError }
        : undefined
  };

  res.status(HTTP_STATUS.OK).json(createResponse(responseData, 'Datos de trafico obtenidos exitosamente'));
});

/**
 * Obtener datos de un punto de medida especifico
 * GET /api/v1/trafico/punto/:id
 */
const obtenerTraficoPorPunto = asyncHandler(async (req, res, next) => {
  const { id } = req.params;

  const { limit } = parseNumericParams(
    req.query,
    ['limit'],
    { limit: PAGINATION.DEFAULT_LIMIT }
  );

  const filterConfig = [
    { field: 'puntoMedidaId', type: 'exact', param: 'puntoMedidaId' },
    { field: 'fecha', type: 'dateRange', params: ['startDate', 'endDate'] }
  ];
  const filters = buildFilters({ ...req.query, puntoMedidaId: id }, filterConfig);

  // Proyeccion optimizada para datos de punto especifico
  const projection = {
    fecha: 1,
    'metricas.intensidad': 1,
    'metricas.velocidadMedia': 1,
    'metricas.ocupacion': 1,
    'metricas.carga': 1,
    'calidadDatos.calidadGeneral': 1,
    'analisis.nivelCongestion': 1
  };

  const [trafficData, pointInfo] = await Promise.all([
    Traffic.find(filters, projection)
      .sort({ fecha: -1 })
      .limit(limit)
      .maxTimeMS(MONGODB_TIMEOUTS.AGGREGATE_TIMEOUT_MS)
      .lean(),
    Location.findOne({ tipo: 'punto_trafico', id_punto: id })
      .maxTimeMS(MONGODB_TIMEOUTS.QUERY_TIMEOUT_MS)
      .lean()
  ]);

  if (!trafficData || trafficData.length === 0) {
    return next(createNotFoundError('Datos de trafico para el punto de medida', id));
  }

  // Calcular estadisticas del punto (NO usar $limit antes de $group)
  const stats = await Traffic.aggregate([
    { $match: filters },
    {
      $group: {
        _id: null,
        totalMediciones: { $sum: 1 },
        intensidadPromedio: {
          $avg: { $cond: [{ $gte: ['$metricas.intensidad', 0] }, '$metricas.intensidad', null] }
        },
        intensidadMaxima: {
          $max: { $cond: [{ $gte: ['$metricas.intensidad', 0] }, '$metricas.intensidad', null] }
        },
        ocupacionPromedio: {
          $avg: { $cond: [{ $gte: ['$metricas.ocupacion', 0] }, '$metricas.ocupacion', null] }
        },
        cargaPromedio: {
          $avg: { $cond: [{ $gte: ['$metricas.carga', 0] }, '$metricas.carga', null] }
        },
        velocidadPromedio: {
          // Solo M30 mide velocidad; el 0 es centinela "sin lectura" (no velocidad
          // real). Se filtra a M30 con valor > 0 para no sesgar el promedio a la baja.
          $avg: { $cond: [{ $and: [{ $eq: ['$tipoElemento', 'M30'] }, { $gt: ['$metricas.velocidadMedia', 0] }] }, '$metricas.velocidadMedia', null] }
        }
      }
    }
  ]);

  const responseData = {
    punto: pointInfo,
    mediciones: trafficData,
    estadisticas: stats[0] || {}
  };

  res.status(HTTP_STATUS.OK).json(createResponse(responseData, 'Datos de trafico por punto obtenidos exitosamente'));
});

/**
 * Obtener estadisticas generales de trafico
 * GET /api/v1/trafico/estadisticas
 */
const obtenerEstadisticasTrafico = asyncHandler(async (req, res, next) => {
  const filterConfig = [
    { field: 'fecha', type: 'dateRange', params: ['startDate', 'endDate'] },
    { field: 'tipoElemento', type: 'exact', param: 'tipoElemento', transform: TRANSFORMS.toUpperCase }
  ];
  const filters = buildFilters(req.query, filterConfig);

  // Defensa: aunque ahora se lee del rollup diario (~1.5M docs, no 132M), se
  // exige rango de fechas para no escanear el rollup entero por error y para
  // mantener el contrato del frontend (que siempre envia startDate/endDate).
  if (!filters.fecha) {
    return next(createBadRequestError(
      'Las estadisticas de trafico requieren un rango de fechas (startDate y endDate)'
    ));
  }

  // Estadisticas agregadas leidas del rollup diario via $facet (1 pasada)
  const statistics = await Traffic.obtenerEstadisticasTraficoOptimizadas(filters);

  // Se aplana `statistics` (resumen, porTipoElemento, porPeriodoDia) al nivel
  // de `data` en vez de anidarlo bajo `data.data`: asi el frontend lee
  // `data.resumen`/`data.porPeriodoDia` (patron consistente con el resto de
  // endpoints). Antes el doble anidado dejaba las tarjetas resumen en 0.
  const responseData = {
    ...statistics,
    periodo: {
      inicio: filters.fecha?.$gte,
      fin: filters.fecha?.$lte
    }
  };

  res.status(HTTP_STATUS.OK).json(createResponse(responseData, 'Estadisticas de trafico obtenidas exitosamente'));
});

/**
 * Obtener analisis de congestion por zonas
 * GET /api/v1/trafico/congestion
 */
const obtenerAnalisisCongestion = asyncHandler(async (req, res, next) => {
  const { groupBy = 'distrito' } = req.query;

  // El rollup traffic_daily conserva `tipoElemento` (URB/M30) por documento e
  // indice idx_daily_tipo_fecha, asi que el filtro se aplica de forma exacta y
  // deja de ser un placebo en la grafica "Top zonas".
  const filterConfig = [
    { field: 'fecha', type: 'dateRange', params: ['startDate', 'endDate'] },
    { field: 'tipoElemento', type: 'exact', param: 'tipoElemento', transform: TRANSFORMS.toUpperCase }
  ];
  const filters = buildFilters(req.query, filterConfig);

  // Defensa de rendimiento: exigir rango de fechas (lee del rollup diario).
  if (!filters.fecha) {
    return next(createBadRequestError(
      'El analisis de congestion requiere un rango de fechas (startDate y endDate)'
    ));
  }

  const analisis = await Traffic.obtenerAnalisisCongestionOptimizado(filters, groupBy);

  const responseData = {
    analisis,
    agrupacion: groupBy,
    periodo: {
      inicio: filters.fecha?.$gte,
      fin: filters.fecha?.$lte
    },
    total: analisis.length
  };

  res.status(HTTP_STATUS.OK).json(createResponse(responseData, 'Analisis de congestion obtenido exitosamente'));
});

/**
 * Obtener datos historicos para graficos (agregados por periodo)
 * GET /api/v1/trafico/historico
 */
const obtenerDatosHistoricos = asyncHandler(async (req, res, next) => {
  const {
    aggregation = 'hour' // hour, day, week, month
  } = req.query;

  const filterConfig = [
    { field: 'fecha', type: 'dateRange', params: ['startDate', 'endDate'] },
    { field: 'puntoMedidaId', type: 'exact', param: 'puntoMedidaId' },
    { field: 'tipoElemento', type: 'exact', param: 'tipoElemento', transform: TRANSFORMS.toUpperCase }
  ];
  const filters = buildFilters(req.query, filterConfig);

  // El historico HORARIO ('hour') lee de la coleccion CRUDA (~132M docs);
  // day/week/month leen del rollup diario. En ambos casos se exige un rango de
  // fechas (o punto) para no escanear toda la coleccion.
  if (!filters.fecha && !filters.puntoMedidaId) {
    return next(createBadRequestError(
      'El historico de trafico requiere un rango de fechas (startDate y endDate) o un puntoMedidaId'
    ));
  }

  // Para 'hour' sobre datos crudos, acotar el rango a un maximo defensivo de
  // dias (la sparkline horaria solo necesita 1-2 dias; rangos mayores deben
  // usar aggregation=day, que lee del rollup).
  const HISTORICO_HORA_MAX_DIAS = 2;
  if (aggregation === 'hour' && filters.fecha?.$gte && filters.fecha?.$lte) {
    const dias = (filters.fecha.$lte - filters.fecha.$gte) / (1000 * 60 * 60 * 24);
    if (dias > HISTORICO_HORA_MAX_DIAS) {
      return next(createBadRequestError(
        `El historico por hora se limita a ${HISTORICO_HORA_MAX_DIAS} dias; usa aggregation=day para rangos mayores`
      ));
    }
  }

  const historicalData = await Traffic.obtenerDatosHistoricosOptimizado(filters, aggregation);

  const responseData = {
    serie: historicalData,
    configuracion: buildResponseMetadata({
      agregacion: aggregation,
      filtros: filters,
      periodo: {
        inicio: filters.fecha?.$gte,
        fin: filters.fecha?.$lte
      }
    }),
    total: historicalData.length
  };

  res.status(HTTP_STATUS.OK).json(createResponse(responseData, 'Datos historicos obtenidos exitosamente'));
});

/**
 * Obtener mapa de trafico como FeatureCollection GeoJSON RFC 7946.
 *
 * Fuerza filtros de fecha y limite de 7 dias para no colapsar el backend
 * con un $lookup masivo. Agrupa por puntoMedidaId con metricas medias en
 * el periodo elegido.
 *
 * GET /api/v1/trafico/mapa
 * Query params: startDate (req), endDate (req), tipoElemento, bbox
 */
const obtenerMapaTrafico = asyncHandler(async (req, res, next) => {
  const { startDate, endDate, tipoElemento, bbox } = req.query;

  if (!startDate || !endDate) {
    return next(createBadRequestError(
      'Se requieren los parametros startDate y endDate (formato YYYY-MM-DD)'
    ));
  }

  const desde = new Date(startDate);
  const hasta = new Date(endDate);
  if (isNaN(desde.getTime()) || isNaN(hasta.getTime())) {
    return next(createBadRequestError('startDate o endDate no son fechas validas'));
  }
  if (desde > hasta) {
    return next(createBadRequestError('startDate debe ser anterior o igual a endDate'));
  }

  const diffDias = Math.ceil((hasta - desde) / (24 * 60 * 60 * 1000));
  if (diffDias > TRAFICO_MAPA_MAX_DIAS) {
    return next(createBadRequestError(
      `El rango maximo para el mapa de trafico es ${TRAFICO_MAPA_MAX_DIAS} dias (solicitado: ${diffDias})`
    ));
  }

  // Construir filtros base
  const filtros = {
    fecha: { $gte: desde, $lte: hasta }
  };
  if (tipoElemento) {
    filtros.tipoElemento = String(tipoElemento).toUpperCase();
  }

  // Agregacion principal con lookup geo
  const docs = await Traffic.obtenerAgregadoParaMapa(filtros);

  // Filtro bbox post-lookup
  let docsFiltrados = docs;
  if (bbox) {
    const partes = String(bbox).split(',').map(Number);
    if (partes.length === 4 && partes.every(Number.isFinite)) {
      const [minLng, minLat, maxLng, maxLat] = partes;
      docsFiltrados = docs.filter(d => {
        const coords = d.geometry?.coordinates;
        if (!Array.isArray(coords) || coords.length < 2) { return false; }
        const [lng, lat] = coords;
        return lng >= minLng && lng <= maxLng && lat >= minLat && lat <= maxLat;
      });
    }
  }

  const featureCollection = documentosAFeatureCollection(
    docsFiltrados,
    (doc) => ({
      id: doc.puntoMedidaId,
      geometry: doc.geometry,
      properties: {
        puntoMedidaId: doc.puntoMedidaId,
        nombre: doc.nombre || null,
        distrito: doc.distrito || null,
        tipoElemento: doc.tipoElemento,
        intensidadMedia: doc.intensidadMedia,
        ocupacionMedia: doc.ocupacionMedia,
        cargaMedia: doc.cargaMedia,
        velocidadMedia: doc.velocidadMedia,
        porcentajeCongestion: doc.porcentajeCongestion,
        totalMediciones: doc.totalMediciones
      }
    }),
    {
      recurso: 'trafico',
      rango: { startDate, endDate, diasAnalizados: diffDias },
      ...(tipoElemento && { tipoElemento: String(tipoElemento).toUpperCase() })
    }
  );

  res.status(HTTP_STATUS.OK).json(
    createResponse(featureCollection, 'Mapa de trafico generado exitosamente')
  );
});

/**
 * Registrar una medicion de trafico (ingesta de nodo IoT). Upsert idempotente
 * por (puntoMedidaId, fecha) + actualizacion incremental del rollup diario.
 *
 * @route POST /api/v1/trafico/ingesta
 * @access Private (JWT)
 */
const ingestarMedicionTrafico = asyncHandler(async (req, res) => {
  const resultado = await Traffic.ingestarMedicion(req.body);
  invalidarCacheTrafico(resultado.documento?.puntoMedidaId, 'ingesta');

  const codigo = resultado.creado ? HTTP_STATUS.CREATED : HTTP_STATUS.OK;
  return res.status(codigo).json(createResponse({
    estado: resultado.estado,
    puntoMedidaId: resultado.documento.puntoMedidaId,
    fecha: resultado.documento.fecha,
    tipoElemento: resultado.documento.tipoElemento,
    nivelCongestion: resultado.documento.analisis.nivelCongestion,
    periodoDia: resultado.documento.analisis.periodoDia
  }, `Medicion de trafico ${resultado.estado}`));
});

/**
 * Registrar un lote de mediciones de trafico (ingesta IoT). Cada medicion se
 * procesa como upsert idempotente + rollup incremental independiente.
 *
 * @route POST /api/v1/trafico/ingesta/lote
 * @access Private (JWT)
 */
const ingestarLoteTrafico = asyncHandler(async (req, res) => {
  const { lecturas } = req.body;
  const resultados = await Promise.allSettled(
    lecturas.map((lectura) => Traffic.ingestarMedicion(lectura))
  );
  const resumen = resumirLote(resultados);
  invalidarCacheTrafico(null, 'ingesta-lote');

  return res.status(HTTP_STATUS.CREATED).json(createResponse(
    resumen,
    `Lote procesado: ${resumen.creados} creados, ${resumen.actualizados} actualizados, ${resumen.fallidos} fallidos`
  ));
});

module.exports = {
  obtenerDatosTrafico,
  obtenerTraficoPorPunto,
  obtenerEstadisticasTrafico,
  obtenerAnalisisCongestion,
  obtenerDatosHistoricos,
  obtenerMapaTrafico,
  ingestarMedicionTrafico,
  ingestarLoteTrafico
};
