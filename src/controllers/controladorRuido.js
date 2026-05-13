/**
 * Controlador de Contaminacion Acustica
 *
 * Maneja las operaciones CRUD y consultas para datos de contaminacion acustica.
 * Incluye analisis por periodos del dia, cumplimiento normativo y estadisticas.
 */

const NoiseMonitoring = require('../models/Ruido');
const Location = require('../models/Ubicacion');
const { createNotFoundError, createBadRequestError } = require('../utils/errorUtils');
const { createPaginationMeta, buildCursorQuery, createCursorMeta } = require('../utils/paginationHelper');
const { buildFilters, buildSortOptions, buildPaginationOptions, TRANSFORMS, parseNumericParams, buildResponseMetadata } = require('../utils/queryHelper');
const { createResponse } = require('../utils/responseHelper');
const { documentosAFeatureCollection } = require('../utils/geoJsonHelper');
const { PAGINATION, HTTP_STATUS, MONGODB_TIMEOUTS, DATASET_YEARS, AGGREGATION_LIMITS, NOISE_THRESHOLDS, ZONE_TYPES, LOCATION_TYPES } = require('../constants');
const asyncHandler = require('../utils/asyncHandler');

/**
 * Obtener datos de contaminacion acustica con filtros
 * GET /api/v1/ruido
 */
const obtenerDatosRuido = asyncHandler(async (req, res) => {
  const filterConfig = [
    { field: 'fecha', type: 'dateRange', params: ['startDate', 'endDate'] },
    { field: 'año', type: 'numeric', param: 'año' },
    { field: 'mes', type: 'numeric', param: 'mes' },
    { field: 'nmt', type: 'in', param: 'nmt', transform: TRANSFORMS.toIntArray },
    { field: 'nombre', type: 'regex', param: 'nombre' }
  ];

  const filters = buildFilters(req.query, filterConfig);

  // Filtro de calidad de datos
  if (req.query.includeInvalid !== 'true') {
    filters['dataQuality.hasValidData'] = true;
  }

  const sortMapping = {
    fecha: 'fecha',
    nmt: 'nmt',
    nombre: 'nombre',
    laeq24: 'laeq24',
    año: 'año',
    mes: 'mes'
  };
  const sortOptions = buildSortOptions(
    req.query,
    sortMapping,
    ['fecha', 'nmt', 'nombre', 'laeq24', 'año', 'mes'],
    'fecha',
    'desc'
  );

  const paginationOptions = buildPaginationOptions(req.query, {
    defaultLimit: PAGINATION.DEFAULT_LIMIT,
    maxLimit: PAGINATION.MAX_LIMIT
  });

  // Proyeccion optimizada: seleccionar solo campos necesarios
  const projection = {
    fecha: 1,
    nmt: 1,
    nombre: 1,
    laeq24: 1,
    nivelDiurno: 1,
    nivelVespertino: 1,
    nivelNocturno: 1,
    año: 1,
    mes: 1,
    'dataQuality.hasValidData': 1
  };

  const { cursor } = req.query;
  const useCursor = Boolean(cursor);
  const primarySortField = Object.keys(sortOptions)[0] || 'fecha';
  const sortOrder = sortOptions[primarySortField] === 1 ? 'asc' : 'desc';
  const cursorFilter = useCursor ? buildCursorQuery({ cursor, sortField: primarySortField, sortOrder }) : null;
  const combinedFilters = cursorFilter ? { $and: [filters, cursorFilter] } : filters;
  const sortWithTiebreak = { ...sortOptions, _id: sortOrder === 'asc' ? 1 : -1 };

  const dataPromise = NoiseMonitoring.find(combinedFilters, projection)
    .sort(sortWithTiebreak)
    .limit(paginationOptions.limit)
    .maxTimeMS(MONGODB_TIMEOUTS.AGGREGATE_TIMEOUT_MS)
    .lean();

  const countPromise = useCursor
    ? Promise.resolve(null)
    : NoiseMonitoring.countDocuments(filters).maxTimeMS(MONGODB_TIMEOUTS.QUERY_TIMEOUT_MS);

  const [data, totalDocuments] = await Promise.all([dataPromise, countPromise]);

  // Agregar cumplimiento normativo usando metodo del modelo
  const dataWithCompliance = data.map(item => ({
    ...item,
    cumplimientoNormativo: NoiseMonitoring.calculateRegulatoryCompliance(item)
  }));

  const responseData = {
    data: dataWithCompliance,
    pagination: useCursor
      ? createCursorMeta({ results: data, limit: paginationOptions.limit, sortField: primarySortField, sortOrder })
      : createPaginationMeta(paginationOptions.page, paginationOptions.limit, totalDocuments),
    filters: {
      applied: Object.keys(filters).length > 0 ? filters : null
    }
  };

  res.status(HTTP_STATUS.OK).json(createResponse(responseData, 'Datos de contaminacion acustica obtenidos exitosamente'));
});

/**
 * Obtener estadisticas de contaminacion acustica
 * GET /api/v1/ruido/estadisticas
 */
const obtenerEstadisticasRuido = asyncHandler(async (req, res) => {
  const { groupBy = 'station' } = req.query;

  const filterConfig = [
    { field: 'fecha', type: 'dateRange', params: ['startDate', 'endDate'] },
    { field: 'nmt', type: 'numeric', param: 'nmt' }
  ];

  const matchStage = buildFilters(req.query, filterConfig);

  const { estadisticas, resumen } = await NoiseMonitoring.getStatisticsOptimized(matchStage, groupBy);

  const responseData = {
    estadisticas,
    resumen,
    configuracion: buildResponseMetadata({
      agrupacion: groupBy,
      filtros: Object.keys(matchStage).length > 0 ? matchStage : null
    }),
    limitesNormativos: {
      diurno: NoiseMonitoring.LIMITES_NORMATIVOS.DIURNO,
      vespertino: NoiseMonitoring.LIMITES_NORMATIVOS.VESPERTINO,
      nocturno: NoiseMonitoring.LIMITES_NORMATIVOS.NOCTURNO,
      descripcion: 'Limites en decibelios (dB) segun normativa'
    }
  };

  res.status(HTTP_STATUS.OK).json(createResponse(responseData, 'Estadisticas de contaminacion acustica obtenidas exitosamente'));
});

/**
 * Obtener ranking de estaciones por nivel de ruido
 * GET /api/v1/ruido/ranking
 */
const obtenerRankingRuido = asyncHandler(async (req, res) => {
  const { orderBy = 'laeq24' } = req.query;

  const { limit } = parseNumericParams(
    req.query,
    ['limit'],
    { limit: AGGREGATION_LIMITS.TOP_RESULTS }
  );

  const filterConfig = [
    { field: 'fecha', type: 'dateRange', params: ['startDate', 'endDate'] }
  ];

  const matchStage = buildFilters(req.query, filterConfig);

  const ranking = await NoiseMonitoring.getRankingOptimized(matchStage, orderBy, limit);

  const responseData = {
    ranking,
    configuracion: buildResponseMetadata({
      ordenadoPor: orderBy,
      descripcion: {
        laeq24: 'Nivel continuo equivalente 24h',
        diurno: 'Nivel diurno (07:00-19:00)',
        vespertino: 'Nivel vespertino (19:00-23:00)',
        nocturno: 'Nivel nocturno (23:00-07:00)'
      }[orderBy],
      limite: limit
    }),
    interpretacion: {
      orden: 'Descendente (de mayor a menor nivel de ruido)',
      limitesNormativos: NoiseMonitoring.LIMITES_NORMATIVOS
    }
  };

  res.status(HTTP_STATUS.OK).json(createResponse(responseData, 'Ranking de contaminacion acustica obtenido exitosamente'));
});

/**
 * Analisis de cumplimiento normativo por zona
 * GET /api/v1/ruido/cumplimiento/zona
 */
const obtenerCumplimientoPorZona = asyncHandler(async (req, res, next) => {
  const { startDate, endDate, threshold = NOISE_THRESHOLDS.DEFAULT, zoneType = ZONE_TYPES.MIXED } = req.query;

  const compliance = await NoiseMonitoring.getComplianceAnalysisByZone({
    startDate: startDate ? new Date(startDate) : new Date(DATASET_YEARS.DEFAULT_START_DATE),
    endDate: endDate ? new Date(endDate) : new Date(DATASET_YEARS.DEFAULT_END_DATE),
    threshold: Number(threshold),
    zoneType
  });

  if (!compliance || compliance.length === 0) {
    return next(createNotFoundError('Datos de cumplimiento normativo'));
  }

  const responseData = {
    umbralNormativo: Number(threshold),
    tipoZona: zoneType,
    periodo: {
      inicio: startDate || DATASET_YEARS.DEFAULT_START_DATE,
      fin: endDate || DATASET_YEARS.DEFAULT_END_DATE
    },
    analisisPorZona: compliance,
    totalZonasAnalizadas: compliance.length
  };

  res.status(HTTP_STATUS.OK).json(createResponse(responseData, 'Analisis de cumplimiento normativo obtenido exitosamente'));
});

/**
 * Obtener tendencias temporales de ruido
 * GET /api/v1/ruido/tendencias/temporal
 */
const obtenerTendenciasTemporales = asyncHandler(async (req, res, next) => {
  const { nmt, startDate, endDate, groupBy = 'month', metric = 'laeq24' } = req.query;

  if (!startDate || !endDate) {
    return next(createBadRequestError('Se requieren parametros startDate y endDate'));
  }

  const options = {
    startDate: new Date(startDate),
    endDate: new Date(endDate),
    groupBy,
    metric
  };

  if (nmt) {
    options.nmt = parseInt(nmt, 10);
  }

  const trends = await NoiseMonitoring.getTemporalTrends(options);

  const responseData = {
    data: trends,
    total: Array.isArray(trends) ? trends.length : 0,
    parametros: { groupBy, metric, nmt: nmt || 'todas' }
  };

  res.status(HTTP_STATUS.OK).json(createResponse(responseData, 'Tendencias temporales obtenidas exitosamente'));
});

/**
 * Obtener mapa de ruido como FeatureCollection GeoJSON.
 *
 * El modelo de Ruido no guarda coordenadas propias: las estaciones NMT
 * se referencian a traves de la coleccion Ubicacion (tipo
 * ESTACION_ACUSTICA). Este handler hace un $lookup para enriquecer
 * cada estacion con su geometry y devolver el promedio de LAeq24 en
 * el rango de fechas filtrado.
 *
 * GET /api/v1/ruido/mapa
 * Query params: startDate, endDate, nmt (csv)
 */
const obtenerMapaRuido = asyncHandler(async (req, res) => {
  const filterConfig = [
    { field: 'fecha', type: 'dateRange', params: ['startDate', 'endDate'] },
    { field: 'año', type: 'numeric', param: 'año' },
    { field: 'nmt', type: 'in', param: 'nmt', transform: TRANSFORMS.toIntArray }
  ];
  const filters = buildFilters(req.query, filterConfig);

  // Agregar por estacion NMT: promedio de niveles diurno, vespertino,
  // nocturno y LAeq24, mas maximos y cumplimiento.
  const agregacion = await NoiseMonitoring.aggregate([
    { $match: filters },
    {
      $group: {
        _id: '$nmt',
        nombre: { $first: '$nombre' },
        promedioDiurno: { $avg: '$nivelDiurno' },
        promedioVespertino: { $avg: '$nivelVespertino' },
        promedioNocturno: { $avg: '$nivelNocturno' },
        promedioLaeq24: { $avg: '$laeq24' },
        maxLaeq24: { $max: '$laeq24' },
        mediciones: { $sum: 1 }
      }
    }
  ]).option({ maxTimeMS: MONGODB_TIMEOUTS.AGGREGATE_TIMEOUT_MS });

  if (!agregacion.length) {
    return res.status(HTTP_STATUS.OK).json(
      createResponse({ type: 'FeatureCollection', features: [], metadata: { total: 0, recurso: 'ruido' } },
        'Mapa de ruido vacio para los filtros indicados')
    );
  }

  // Lookup de coordenadas desde Ubicacion (tipo ESTACION_ACUSTICA)
  const nmts = agregacion.map(g => String(g._id));
  const ubicaciones = await Location.find(
    { tipo: LOCATION_TYPES.ESTACION_ACUSTICA, nmt: { $in: nmts } },
    { nmt: 1, geometry: 1, nombre: 1 }
  ).lean();

  const geometriaPorNmt = {};
  for (const u of ubicaciones) {
    if (u.nmt && u.geometry) {geometriaPorNmt[String(u.nmt)] = u.geometry;}
  }

  const featureCollection = documentosAFeatureCollection(
    agregacion,
    (doc) => ({
      id: doc._id,
      geometry: geometriaPorNmt[String(doc._id)],
      properties: {
        nmt: doc._id,
        nombre: doc.nombre,
        promedioDiurno: doc.promedioDiurno ? Number(doc.promedioDiurno.toFixed(2)) : null,
        promedioVespertino: doc.promedioVespertino ? Number(doc.promedioVespertino.toFixed(2)) : null,
        promedioNocturno: doc.promedioNocturno ? Number(doc.promedioNocturno.toFixed(2)) : null,
        promedioLaeq24: doc.promedioLaeq24 ? Number(doc.promedioLaeq24.toFixed(2)) : null,
        maxLaeq24: doc.maxLaeq24,
        mediciones: doc.mediciones,
        excedeDiurno: doc.promedioDiurno > NOISE_THRESHOLDS.DIURNO,
        excedeVespertino: doc.promedioVespertino > NOISE_THRESHOLDS.VESPERTINO,
        excedeNocturno: doc.promedioNocturno > NOISE_THRESHOLDS.NOCTURNO
      }
    }),
    { recurso: 'ruido', estacionesSinUbicacion: agregacion.length - Object.keys(geometriaPorNmt).length }
  );

  res.status(HTTP_STATUS.OK).json(
    createResponse(featureCollection, 'Mapa de ruido generado exitosamente')
  );
});

module.exports = {
  obtenerDatosRuido,
  obtenerEstadisticasRuido,
  obtenerRankingRuido,
  obtenerCumplimientoPorZona,
  obtenerTendenciasTemporales,
  obtenerMapaRuido
};
