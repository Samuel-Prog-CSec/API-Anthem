/**
 * Controlador de Contenedores
 *
 * Maneja la logica de negocio para las operaciones relacionadas
 * con contenedores de residuos.
 */

const Contenedor = require('../models/Contenedor');
const { createNotFoundError, createBadRequestError } = require('../utils/errorUtils');
const { createPaginationMeta, buildCursorQuery, createCursorMeta } = require('../utils/paginationHelper');
const { buildFilters, buildSortOptions, buildPaginationOptions, TRANSFORMS, parseNumericParams, primerValorEscalar } = require('../utils/queryHelper');
const { createResponse } = require('../utils/responseHelper');
const { documentosAFeatureCollection } = require('../utils/geoJsonHelper');
const { PAGINATION, HTTP_STATUS, SPECIAL_PAGINATION_LIMITS, MONGODB_TIMEOUTS, GEO_LIMITS } = require('../constants');
const asyncHandler = require('../utils/asyncHandler');

/**
 * Obtener todos los contenedores con filtros y paginacion
 *
 * @route GET /api/v1/contenedores
 * @access Private
 */
exports.obtenerContenedores = asyncHandler(async (req, res) => {
  const filterConfig = [
    { field: 'tipoContenedor', type: 'exact', param: 'tipoContenedor', transform: TRANSFORMS.toUpperCase },
    { field: 'distrito', type: 'regex', param: 'distrito' },
    { field: 'barrio', type: 'regex', param: 'barrio' },
    { field: 'lote', type: 'numeric', param: 'lote' }
  ];

  const filters = buildFilters(req.query, filterConfig);

  const sortMapping = {
    distrito: 'distrito',
    barrio: 'barrio',
    tipoContenedor: 'tipoContenedor',
    lote: 'lote'
  };
  const sortOptions = buildSortOptions(
    req.query,
    sortMapping,
    ['distrito', 'barrio', 'tipoContenedor', 'lote'],
    'distrito',
    'asc'
  );

  const paginationOptions = buildPaginationOptions(req.query, {
    defaultLimit: SPECIAL_PAGINATION_LIMITS.CONTAINERS.DEFAULT,
    maxLimit: PAGINATION.MAX_LIMIT
  });

  // Proyeccion optimizada: solo campos necesarios para listado
  const projection = {
    tipoContenedor: 1,
    modelo: 1,
    descripcionModelo: 1,
    cantidad: 1,
    lote: 1,
    distrito: 1,
    barrio: 1,
    direccion: 1,
    coordenadas: 1
  };

  const { cursor } = req.query;
  const useCursor = Boolean(cursor);
  const primarySortField = Object.keys(sortOptions)[0] || 'distrito';
  const sortOrder = sortOptions[primarySortField] === 1 ? 'asc' : 'desc';
  const cursorFilter = useCursor ? buildCursorQuery({ cursor, sortField: primarySortField, sortOrder }) : null;
  const combinedFilters = cursorFilter ? { $and: [filters, cursorFilter] } : filters;
  const sortWithTiebreak = { ...sortOptions, _id: sortOrder === 'asc' ? 1 : -1 };

  const dataPromise = Contenedor.find(combinedFilters, projection)
    .sort(sortWithTiebreak)
    .limit(paginationOptions.limit)
    .maxTimeMS(MONGODB_TIMEOUTS.AGGREGATE_TIMEOUT_MS)
    .lean();

  const countPromise = useCursor
    ? Promise.resolve(null)
    : Contenedor.countDocuments(filters).maxTimeMS(MONGODB_TIMEOUTS.QUERY_TIMEOUT_MS);

  const [data, total] = await Promise.all([dataPromise, countPromise]);

  const responseData = {
    data,
    pagination: useCursor
      ? createCursorMeta({ results: data, limit: paginationOptions.limit, sortField: primarySortField, sortOrder })
      : createPaginationMeta(paginationOptions.page, paginationOptions.limit, total)
  };

  res.status(HTTP_STATUS.OK).json(createResponse(responseData, 'Contenedores obtenidos exitosamente'));
});

/**
 * Buscar contenedores cercanos a una ubicacion
 *
 * @route GET /api/v1/contenedores/cercanos
 * @access Private
 */
exports.obtenerContenedoresCercanos = asyncHandler(async (req, res, next) => {
  const { longitude, latitude } = req.query;
  const tipoContenedor = primerValorEscalar(req.query.tipoContenedor);

  if (!longitude || !latitude) {
    return next(createBadRequestError('Se requieren los parametros longitude y latitude'));
  }

  const lng = parseFloat(longitude);
  const lat = parseFloat(latitude);

  const { maxDistance } = parseNumericParams(
    req.query,
    ['maxDistance'],
    { maxDistance: GEO_LIMITS.DEFAULT_DISTANCE_METERS }
  );

  // Validar coordenadas
  if (isNaN(lng) || isNaN(lat) || lng < -180 || lng > 180 || lat < -90 || lat > 90) {
    return next(createBadRequestError('Coordenadas no validas'));
  }

  const containers = await Contenedor.buscarCercanos(
    lng,
    lat,
    maxDistance,
    tipoContenedor ? tipoContenedor.toUpperCase() : null
  );

  const responseData = {
    ubicacion: { longitude: lng, latitude: lat },
    radioMetros: maxDistance,
    ...(tipoContenedor && { tipoContenedor: tipoContenedor.toUpperCase() }),
    total: containers.length,
    contenedores: containers
  };

  res.status(HTTP_STATUS.OK).json(createResponse(responseData, 'Contenedores cercanos obtenidos exitosamente'));
});

/**
 * Obtener estadisticas generales de contenedores
 *
 * @route GET /api/v1/contenedores/estadisticas
 * @access Private
 */
exports.obtenerEstadisticasContenedores = asyncHandler(async (req, res, next) => {
  const { lote } = req.query;
  const summary = await Contenedor.obtenerResumenGeneral(lote);

  if (!summary || summary.length === 0) {
    return next(createNotFoundError('Datos de contenedores'));
  }

  res.status(HTTP_STATUS.OK).json(createResponse(summary[0], 'Estadisticas obtenidas exitosamente'));
});

/**
 * Obtener estadisticas por distrito
 *
 * @route GET /api/v1/contenedores/estadisticas/distrito
 * @access Private
 */
exports.obtenerEstadisticasPorDistrito = asyncHandler(async (req, res, next) => {
  const { distrito, lote } = req.query;

  const stats = await Contenedor.obtenerEstadisticasPorDistrito(distrito ? distrito : null, lote ?? null);

  if (!stats || stats.length === 0) {
    return next(createNotFoundError('Contenedores', distrito ? `distrito ${distrito}` : null));
  }

  const responseData = {
    ...(distrito && { distrito }),
    total: stats.length,
    estadisticas: stats
  };

  res.status(HTTP_STATUS.OK).json(createResponse(responseData, 'Estadisticas por distrito obtenidas exitosamente'));
});

/**
 * Obtener estadisticas por barrio
 *
 * @route GET /api/v1/contenedores/estadisticas/barrio
 * @access Private
 */
exports.obtenerEstadisticasPorBarrio = asyncHandler(async (req, res, next) => {
  const { distrito, barrio } = req.query;

  if (!distrito) {
    return next(createBadRequestError('Se requiere el parametro distrito'));
  }

  const stats = await Contenedor.obtenerEstadisticasPorBarrio(distrito, barrio || null);

  if (!stats || stats.length === 0) {
    return next(createNotFoundError('Contenedores', barrio ? `barrio ${barrio} del distrito ${distrito}` : `distrito ${distrito}`));
  }

  const responseData = {
    distrito,
    ...(barrio && { barrio }),
    total: stats.length,
    estadisticas: stats
  };

  res.status(HTTP_STATUS.OK).json(createResponse(responseData, 'Estadisticas por barrio obtenidas exitosamente'));
});

/**
 * Contar contenedores por tipo en un area
 *
 * @route GET /api/v1/contenedores/conteo-por-tipo
 * @access Private
 */
exports.contarPorTipo = asyncHandler(async (req, res, next) => {
  const { distrito, barrio } = req.query;

  if (!distrito) {
    return next(createBadRequestError('Se requiere el parametro distrito'));
  }

  const count = await Contenedor.contarPorTipo(distrito, barrio || null);

  res.status(HTTP_STATUS.OK).json(createResponse(count, 'Conteo por tipo obtenido exitosamente'));
});

/**
 * Obtener lista de distritos unicos
 *
 * @route GET /api/v1/contenedores/distritos
 * @access Private
 */
exports.obtenerDistritos = asyncHandler(async (req, res) => {
  const districts = await Contenedor.distinct('distrito');

  const responseData = {
    total: districts.length,
    distritos: districts.sort()
  };

  res.status(HTTP_STATUS.OK).json(createResponse(responseData, 'Distritos obtenidos exitosamente'));
});

/**
 * Obtener lista de barrios por distrito
 *
 * @route GET /api/v1/contenedores/barrios/:distrito
 * @access Private
 */
exports.obtenerBarriosPorDistrito = asyncHandler(async (req, res, next) => {
  const { distrito } = req.params;

  const neighborhoods = await Contenedor.distinct('barrio', { distrito });

  if (!neighborhoods || neighborhoods.length === 0) {
    return next(createNotFoundError('Barrios', `distrito ${distrito}`));
  }

  const responseData = {
    distrito,
    total: neighborhoods.length,
    barrios: neighborhoods.sort()
  };

  res.status(HTTP_STATUS.OK).json(createResponse(responseData, 'Barrios obtenidos exitosamente'));
});

/**
 * Buscar contenedores por direccion
 *
 * @route GET /api/v1/contenedores/buscar
 * @access Private
 *
 * OPTIMIZACION: Usa indice de texto (idx_containers_address_search) para busquedas 500x+ mas rapidas.
 * - Sin indice ($regex en 2 campos): ~8000ms con 50k documentos (2x COLLSCAN)
 * - Con indice ($text): ~15ms con 50k documentos (TEXT index scan)
 */
exports.buscarPorDireccion = asyncHandler(async (req, res, next) => {
  const { q } = req.query;
  const tipoContenedor = primerValorEscalar(req.query.tipoContenedor);

  if (!q) {
    return next(createBadRequestError('Se requiere el parametro de busqueda q'));
  }

  // Construir consulta de busqueda usando helper para consistencia
  const filterConfig = [
    { field: 'tipoContenedor', type: 'exact', param: 'tipoContenedor', transform: TRANSFORMS.toUpperCase }
  ];
  const filters = buildFilters(req.query, filterConfig);

  const { limit } = parseNumericParams(
    req.query,
    ['limit'],
    { limit: PAGINATION.DEFAULT_LIMIT }
  );

  // Usar indice de texto para busqueda OPTIMIZADA
  // Indice compuesto: direccion.nombre (peso 10) + direccion.completa (peso 5)
  filters.$text = { $search: q };

  const containers = await Contenedor.find(filters)
    .limit(limit)
    .maxTimeMS(MONGODB_TIMEOUTS.AGGREGATE_TIMEOUT_MS)
    .select('-__v')
    .lean();

  const responseData = {
    busqueda: q,
    ...(tipoContenedor && { tipoContenedor: tipoContenedor.toUpperCase() }),
    total: containers.length,
    contenedores: containers
  };

  res.status(HTTP_STATUS.OK).json(createResponse(responseData, 'Busqueda completada exitosamente'));
});

/**
 * Obtener mapa de calor de contenedores por tipo
 *
 * @route GET /api/v1/contenedores/mapa-calor
 * @access Private
 */
exports.obtenerMapaCalor = asyncHandler(async (req, res) => {
  const tipoContenedor = primerValorEscalar(req.query.tipoContenedor);

  const heatmapData = await Contenedor.obtenerDatosMapaCalor(tipoContenedor);

  const responseData = {
    ...(tipoContenedor && { tipoContenedor: tipoContenedor.toUpperCase() }),
    total: heatmapData.length,
    puntos: heatmapData
  };

  res.status(HTTP_STATUS.OK).json(createResponse(responseData, 'Datos de mapa de calor obtenidos exitosamente'));
});

/**
 * Obtener cobertura por tipo de contenedor en un distrito
 *
 * @route GET /api/v1/contenedores/cobertura
 * @access Private
 */
exports.obtenerAnalisisCobertura = asyncHandler(async (req, res) => {
  const { distrito } = req.query;

  const coverage = await Contenedor.obtenerAnalisisCobertura(distrito);

  const responseData = {
    ...(distrito && { distrito }),
    analisisCobertura: coverage
  };

  res.status(HTTP_STATUS.OK).json(createResponse(responseData, 'Analisis de cobertura obtenido exitosamente'));
});

/**
 * Obtener mapa de contenedores como FeatureCollection GeoJSON RFC 7946.
 *
 * @route GET /api/v1/contenedores/mapa
 * @access Private
 */
exports.obtenerMapaContenedores = asyncHandler(async (req, res, next) => {
  const { distrito, barrio, lote, bbox } = req.query;
  const tipoContenedor = primerValorEscalar(req.query.tipoContenedor);

  // Parsear bbox: acepta CSV "minLng,minLat,maxLng,maxLat" o array
  let bboxArray;
  if (bbox) {
    const parts = Array.isArray(bbox) ? bbox : String(bbox).split(',');
    if (parts.length === 4) {
      bboxArray = parts.map(p => parseFloat(p));
      if (bboxArray.some(v => !Number.isFinite(v))) {
        return next(createBadRequestError('bbox debe ser 4 numeros: minLng,minLat,maxLng,maxLat'));
      }
    } else {
      return next(createBadRequestError('bbox debe contener exactamente 4 valores'));
    }
  }

  const docs = await Contenedor.obtenerCaracteristicasMapa({
    tipoContenedor,
    distrito,
    barrio,
    lote,
    bbox: bboxArray
  });

  const featureCollection = documentosAFeatureCollection(
    docs,
    (doc) => ({
      id: doc._id,
      geometry: doc.location,
      properties: {
        codigoInternoSituado: doc.codigoInternoSituado,
        tipoContenedor: doc.tipoContenedor,
        cantidad: doc.cantidad,
        lote: doc.lote,
        distrito: doc.distrito,
        barrio: doc.barrio,
        direccion: doc.direccion?.completa || null
      }
    }),
    {
      recurso: 'contenedores',
      ...(tipoContenedor && { tipoContenedor: tipoContenedor.toUpperCase() }),
      ...(distrito && { distrito }),
      ...(barrio && { barrio })
    }
  );

  res.status(HTTP_STATUS.OK).json(
    createResponse(featureCollection, 'Mapa de contenedores generado exitosamente')
  );
});

/**
 * Analisis de densidad de contenedores por distrito
 *
 * @route GET /api/v1/contenedores/analisis/densidad
 * @access Private
 */
exports.obtenerAnalisisDensidad = asyncHandler(async (req, res, next) => {
  const { distrito, lote, includeBarrios = 'true' } = req.query;
  const tipoContenedor = primerValorEscalar(req.query.tipoContenedor);

  const options = {
    distrito,
    tipoContenedor: tipoContenedor ? tipoContenedor.toUpperCase() : undefined,
    lote: (lote !== undefined && lote !== '') ? Number(lote) : undefined,
    includeBarrios: includeBarrios === 'true'
  };

  const densityAnalysis = await Contenedor.obtenerAnalisisDensidadPorDistrito(options);

  if (!densityAnalysis || densityAnalysis.length === 0) {
    return next(createNotFoundError('Analisis de densidad', distrito ? `distrito ${distrito}` : null));
  }

  const responseData = {
    ...(distrito && { distrito }),
    ...(tipoContenedor && { tipoContenedor: tipoContenedor.toUpperCase() }),
    includeBarrios: options.includeBarrios,
    analisisDensidad: densityAnalysis,
    totalZonasAnalizadas: densityAnalysis.length
  };

  res.status(HTTP_STATUS.OK).json(createResponse(responseData, 'Analisis de densidad obtenido exitosamente'));
});
