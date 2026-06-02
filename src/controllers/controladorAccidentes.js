/**
 * Controlador de Accidentalidad
 *
 * Gestiona las operaciones CRUD y consultas especializadas para datos de accidentes.
 * Proporciona endpoints optimizados para el dashboard de la ciudad inteligente
 * con analisis de seguridad vial, puntos negros y estadisticas de accidentes.
 */

const Accidente = require('../models/Accidente');
const { ETAPA_GROUP_EXPEDIENTE } = require('../services/accidenteService');
const { createNotFoundError } = require('../utils/errorUtils');
const { createPaginationMeta, buildCursorQuery, createCursorMeta } = require('../utils/paginationHelper');
const { buildFilters, buildSortOptions, buildPaginationOptions, TRANSFORMS, executeFacetPagination } = require('../utils/queryHelper');
const { createResponse } = require('../utils/responseHelper');
const { documentosAFeatureCollection } = require('../utils/geoJsonHelper');
const { SORT_FIELDS, PAGINATION, HTTP_STATUS, TIPOS_ACCIDENTE, TIPOS_VEHICULO, TIPOS_LESION, MAPEO_SEVERIDAD_LESIONES, BINARY_INDICATORS, SEVERITY_LEVELS, TIPOS_PERSONA, MONGODB_TIMEOUTS, DAYS_OF_WEEK } = require('../constants');
const logger = require('../config/logger');
const asyncHandler = require('../utils/asyncHandler');


/**
 * Obtener todos los accidentes con filtros avanzados
 * GET /api/v1/accidentes
 */
const obtenerAccidentes = asyncHandler(async (req, res) => {
  // Configuracion de filtros usando queryHelper
  const filterConfig = [
    { field: 'ubicacion.nombreDistrito', type: 'regex', param: 'distrito' },
    { field: 'circunstancias.tipoAccidente', type: 'exact', param: 'tipoAccidente', transform: TRANSFORMS.toUpperCase },
    { field: 'circunstancias.gravedad', type: 'exact', param: 'gravedad', transform: TRANSFORMS.toUpperCase },
    { field: 'vehiculo.tipo', type: 'exact', param: 'tipoVehiculo', transform: TRANSFORMS.toUpperCase },
    { field: 'personaAfectada.tipoLesion', type: 'exact', param: 'tipoLesion', transform: TRANSFORMS.toUpperCase },
    { field: 'fecha', type: 'dateRange', params: ['startDate', 'endDate'] }
  ];

  const filters = buildFilters(req.query, filterConfig);

  // Filtros booleanos especiales
  const { conAlcohol, conDrogas } = req.query;
  if (conAlcohol === 'true') { filters['personaAfectada.positivaAlcohol'] = BINARY_INDICATORS.YES; }
  if (conAlcohol === 'false') { filters['personaAfectada.positivaAlcohol'] = BINARY_INDICATORS.NO; }
  if (conDrogas === 'true') { filters['personaAfectada.positivaDroga'] = BINARY_INDICATORS.NUMERIC_TRUE; }
  if (conDrogas === 'false') { filters['personaAfectada.positivaDroga'] = BINARY_INDICATORS.NUMERIC_FALSE; }

  // Configurar ordenamiento y paginacion usando queryHelper
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

  const { cursor } = req.query;
  const useCursor = Boolean(cursor);
  const primarySortField = Object.keys(sortOptions)[0] || 'fecha';
  const sortOrder = sortOptions[primarySortField] === 1 ? 'asc' : 'desc';
  const cursorFilter = useCursor ? buildCursorQuery({ cursor, sortField: primarySortField, sortOrder }) : null;
  const combinedFilters = cursorFilter ? { $and: [filters, cursorFilter] } : filters;
  // Cuando ordenamos por fecha (campo solo-dia, sin hora), todos los
  // accidentes del mismo dia colisionan y el tiebreak natural por _id
  // los devuelve en orden de insercion (que no es cronologico). Si la
  // hora ya esta en el documento ("HH:MM" zero-padded, sort lexicografico
  // == sort cronologico), la usamos como tiebreak antes del _id.
  const sortWithTiebreak = primarySortField === 'fecha'
    ? { fecha: sortOptions.fecha, hora: sortOptions.fecha, _id: sortOrder === 'asc' ? 1 : -1 }
    : { ...sortOptions, _id: sortOrder === 'asc' ? 1 : -1 };

  // Proyeccion optimizada: solo campos necesarios para listado
  const projection = {
    numeroExpediente: 1,
    fecha: 1,
    hora: 1,
    'ubicacion.codigoDistrito': 1,
    'ubicacion.nombreDistrito': 1,
    'ubicacion.calle': 1,
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

  // Pipeline de estadisticas agregadas: se ejecuta dentro del mismo $facet
  // que data + count cuando se usa modo offset, ahorrando una pasada completa.
  // En modo cursor se calcula por separado (sin doble pasada porque no hace
  // facet pagination).
  // NO usar $limit antes de $group: corrompe las estadisticas globales.
  //
  // Cada fila de `accidents` es una persona afectada; para que las cifras
  // representen ACCIDENTES (no afectados) primero se colapsa por expediente
  // (ETAPA_GROUP_EXPEDIENTE) y luego se agrega. Se expone tambien
  // `totalAfectados` (numero de personas) como metrica separada.
  const statsPipeline = [
    ETAPA_GROUP_EXPEDIENTE,
    {
      $group: {
        _id: null,
        totalAccidentes: { $sum: 1 },
        totalAfectados: { $sum: '$afectados' },
        accidentesGraves: { $sum: '$esGrave' },
        accidentesMortales: { $sum: '$esMortal' },
        puntuacionGravedadPromedio: { $avg: '$puntuacionGravedad' },
        accidentesConAlcohol: { $sum: '$conAlcohol' }
      }
    },
    { $project: { _id: 0 } }
  ];

  let accidentes = [];
  let totalCount = null;
  let facetFallback = false;
  let facetError = null;
  let statsObj = null;

  if (useCursor) {
    [accidentes, statsObj] = await Promise.all([
      Accidente.find(combinedFilters, projection)
        .sort(sortWithTiebreak)
        .limit(paginationOptions.limit)
        .maxTimeMS(MONGODB_TIMEOUTS.QUERY_TIMEOUT_MS)
        .lean(),
      Accidente.aggregate([{ $match: filters }, ...statsPipeline])
        .option({ allowDiskUse: true, maxTimeMS: MONGODB_TIMEOUTS.AGGREGATE_TIMEOUT_MS })
        .exec()
        .then(arr => arr?.[0] || null)
        .catch(() => null)
    ]);
  } else {
    const facetResult = await executeFacetPagination({
      model: Accidente,
      filters,
      sort: sortWithTiebreak,
      projection,
      pagination: paginationOptions,
      statsPipeline,
      maxTimeMS: MONGODB_TIMEOUTS.AGGREGATE_TIMEOUT_MS
    });

    accidentes = facetResult.data;
    totalCount = facetResult.total;
    statsObj = facetResult.stats;
    facetFallback = facetResult.fallback;
    facetError = facetResult.fallbackError;
  }

  const responseData = {
    data: accidentes,
    pagination: useCursor
      ? createCursorMeta({ results: accidentes, limit: paginationOptions.limit, sortField: primarySortField, sortOrder })
      : createPaginationMeta(paginationOptions.page, paginationOptions.limit, totalCount),
    filters: {
      applied: filters,
      available: {
        gravedad: Object.values(SEVERITY_LEVELS.ACCIDENT),
        tipoAccidente: Object.values(TIPOS_ACCIDENTE),
        tipoVehiculo: Object.values(TIPOS_VEHICULO),
        tipoLesion: Object.values(TIPOS_LESION)
      }
    },
    stats: statsObj || {
      totalAccidentes: 0,
      totalAfectados: 0,
      accidentesGraves: 0,
      accidentesMortales: 0,
      puntuacionGravedadPromedio: 0,
      accidentesConAlcohol: 0
    },
    performance: useCursor
      ? { cursorPagination: true }
      : facetFallback
        ? { facetFallback: true, reason: facetError }
        : undefined
  };

  res.status(HTTP_STATUS.OK).json(createResponse(responseData, 'Datos de accidentes obtenidos exitosamente'));
});

/**
 * Obtener un accidente especifico por numero de expediente
 * GET /api/v1/accidentes/expediente/:numero
 */
const obtenerAccidentePorExpediente = asyncHandler(async (req, res, next) => {
  const { numero } = req.params;

  // Buscar todas las personas afectadas en el mismo expediente
  const accidentData = await Accidente.find({ numeroExpediente: numero })
    .sort({ 'personaAfectada.tipoPersona': 1 })
    .maxTimeMS(MONGODB_TIMEOUTS.QUERY_TIMEOUT_MS)
    .lean();

  if (!accidentData || accidentData.length === 0) {
    return next(createNotFoundError('Accidente con expediente', numero));
  }

  // Construir resumen sin multiples filtros repetidos
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
    if (persona.tipoPersona === TIPOS_PERSONA.CONDUCTOR) { acc.conductores++; }
    if (persona.tipoPersona === TIPOS_PERSONA.PEATÓN) { acc.peatones++; }
    if (MAPEO_SEVERIDAD_LESIONES.GRAVES.includes(persona.tipoLesion)) { acc.personasGraves++; }
    if (persona.positivaAlcohol === BINARY_INDICATORS.YES) { acc.conAlcohol++; }
    return acc;
  }, { totalPersonas: accidentData.length, conductores: 0, peatones: 0, personasGraves: 0, conAlcohol: 0 });

  const accidentInfo = {
    numeroExpediente: accidente.numeroExpediente,
    fecha: accidente.fecha,
    hora: accidente.hora,
    ubicacion: accidente.ubicacion,
    circunstancias: accidente.circunstancias,
    vehiculo: accidente.vehiculo,
    analisis: accidente.analisis,
    personasAfectadas,
    resumen: summary
  };

  return res.status(HTTP_STATUS.OK).json(createResponse(accidentInfo, 'Accidente obtenido exitosamente'));
});

/**
 * Obtener estadisticas generales de accidentalidad
 * GET /api/v1/accidentes/estadisticas
 */
const obtenerEstadisticasAccidentes = asyncHandler(async (req, res) => {
  const { distrito } = req.query;

  // Construir filtros usando queryHelper
  const filterConfig = [
    { field: 'fecha', type: 'dateRange', params: ['startDate', 'endDate'] },
    { field: 'ubicacion.nombreDistrito', type: 'regex', param: 'distrito' }
  ];
  const filters = buildFilters(req.query, filterConfig);

  // Estadisticas generales. Si no llega rango de fechas, no se restringe por
  // fecha (el dataset es de 2051; un default "hoy - 30 dias" devolveria cero).
  const generalStats = await Accidente.obtenerEstadisticasPorPeriodo(
    filters.fecha?.$gte || null,
    filters.fecha?.$lte || null
  );

  // Puntos negros (zonas con mas accidentes)
  const blackSpots = await Accidente.obtenerPuntosNegros(
    10,
    filters.fecha?.$gte,
    filters.fecha?.$lte
  );

  // Analisis por tipo de vehiculo
  const vehicleAnalysis = await Accidente.obtenerAnalisisPorVehiculo(
    filters.fecha?.$gte,
    filters.fecha?.$lte
  );

  // Patrones temporales, distribucion por distrito, tipo y factores de riesgo
  // allSettled: una agregacion lenta o fallida no debe descartar el resto del informe
  const [
    hourlyPatternsResult,
    weeklyPatternsResult,
    districtDistributionResult,
    typeDistributionResult,
    riskFactorsAnalysisResult
  ] = await Promise.allSettled([
    Accidente.obtenerPatronesTemporales('hora'),
    Accidente.obtenerPatronesTemporales('diaSemana'),
    Accidente.obtenerDistribucionDistritos(filters),
    Accidente.obtenerDistribucionTipos(filters),
    Accidente.obtenerAnalisisFactoresRiesgo(filters)
  ]);

  const extraerValor = (result, fallback) => {
    if (result.status === 'fulfilled') {
      return result.value;
    }
    logger.warn({ error: result.reason?.message }, 'Agregacion parcial fallida en estadisticas de accidentes');
    return fallback;
  };

  const hourlyPatterns = extraerValor(hourlyPatternsResult, []);
  const weeklyPatterns = extraerValor(weeklyPatternsResult, []);
  const districtDistribution = extraerValor(districtDistributionResult, []);
  const typeDistribution = extraerValor(typeDistributionResult, []);
  const riskFactorsAnalysis = extraerValor(riskFactorsAnalysisResult, []);

  const responseData = {
    resumen: generalStats[0] || {},
    puntosNegros: blackSpots,
    analisisPorVehiculo: vehicleAnalysis,
    patronesHorarios: hourlyPatterns,
    patronesSemanales: weeklyPatterns.map(p => ({
      ...p,
      diaNombre: DAYS_OF_WEEK[p._id]
    })),
    distribucionDistritos: districtDistribution,
    distribucionTipos: typeDistribution,
    factoresRiesgo: riskFactorsAnalysis,
    periodo: {
      inicio: filters.fecha?.$gte,
      fin: filters.fecha?.$lte,
      distrito: distrito || 'TODOS'
    }
  };

  res.status(HTTP_STATUS.OK).json(createResponse(responseData, 'Estadisticas completas obtenidas exitosamente'));
});

/**
 * Obtener comparativa entre distritos
 * GET /api/v1/accidentes/comparativa-distritos
 */
const obtenerComparativaDistritos = asyncHandler(async (req, res) => {
  // Construir filtros usando queryHelper
  const filterConfig = [
    { field: 'fecha', type: 'dateRange', params: ['startDate', 'endDate'] }
  ];
  const filters = buildFilters(req.query, filterConfig);

  // Obtener comparativa de distritos desde el modelo
  const districtComparison = await Accidente.obtenerComparativaDistritos(filters);

  // Calcular rankings
  const rankings = {
    masAccidentes: [...districtComparison].sort((a, b) => b.totalAccidentes - a.totalAccidentes).slice(0, 5),
    masGraves: [...districtComparison].sort((a, b) => b.porcentajeGravedad - a.porcentajeGravedad).slice(0, 5),
    masAtropellos: [...districtComparison].sort((a, b) => b.porcentajeAtropellos - a.porcentajeAtropellos).slice(0, 5),
    mayorRiesgo: [...districtComparison].sort((a, b) => b.indiceRiesgoTotal - a.indiceRiesgoTotal).slice(0, 5)
  };

  const responseData = {
    comparativa: districtComparison,
    rankings,
    resumen: {
      totalDistritos: districtComparison.length,
      periodo: {
        inicio: filters.fecha?.$gte,
        fin: filters.fecha?.$lte
      }
    }
  };

  res.status(HTTP_STATUS.OK).json(createResponse(responseData, 'Comparativa de distritos obtenida exitosamente'));
});

/**
 * Obtener datos para mapa de calor de accidentes
 * GET /api/v1/accidentes/mapa-calor
 */
const obtenerMapaCalorAccidentes = asyncHandler(async (req, res) => {
  // precision en grados WGS84 para la rejilla del heatmap (~0.001 ≈ 110 m)
  const { limite = 500, precision = 0.001 } = req.query;

  const filterConfig = [
    { field: 'fecha', type: 'dateRange', params: ['startDate', 'endDate'] },
    { field: 'ubicacion.nombreDistrito', type: 'regex', param: 'distrito' },
    { field: 'circunstancias.gravedad', type: 'exact', param: 'gravedad' }
  ];
  const filters = buildFilters(req.query, filterConfig);

  const heatmapData = await Accidente.obtenerDatosMapaCalor(filters, limite, precision);

  const responseData = {
    data: heatmapData,
    total: Array.isArray(heatmapData) ? heatmapData.length : 0
  };

  res.status(HTTP_STATUS.OK).json(createResponse(responseData, 'Datos de mapa de calor obtenidos exitosamente'));
});

/**
 * Obtener accidentes en formato FeatureCollection GeoJSON para mapas.
 * Alimenta la visualizacion con Leaflet (marcadores o heatmap) desde
 * el frontend. El heatmap "custom" pre-existente se mantiene en el
 * endpoint /mapa-calor para compatibilidad.
 *
 * GET /api/v1/accidentes/mapa
 * Query params: startDate, endDate, distrito, gravedad, tipoAccidente,
 *               tipoVehiculo, bbox ("minLng,minLat,maxLng,maxLat")
 */
const obtenerMapaAccidentes = asyncHandler(async (req, res) => {
  const { bbox, limite } = req.query;

  const filterConfig = [
    { field: 'fecha', type: 'dateRange', params: ['startDate', 'endDate'] },
    { field: 'ubicacion.nombreDistrito', type: 'regex', param: 'distrito' },
    { field: 'circunstancias.gravedad', type: 'exact', param: 'gravedad', transform: TRANSFORMS.toUpperCase },
    { field: 'circunstancias.tipoAccidente', type: 'exact', param: 'tipoAccidente', transform: TRANSFORMS.toUpperCase },
    { field: 'vehiculo.tipo', type: 'exact', param: 'tipoVehiculo', transform: TRANSFORMS.toUpperCase }
  ];
  const filters = buildFilters(req.query, filterConfig);

  // Solo accidentes con geometry GeoJSON (derivada desde UTM)
  filters['ubicacion.geometry'] = { $exists: true, $ne: null };

  // Filtro por bounding box WGS84 opcional
  if (bbox) {
    const [minLng, minLat, maxLng, maxLat] = bbox.split(',').map(Number);
    if ([minLng, minLat, maxLng, maxLat].every(v => Number.isFinite(v))) {
      filters['ubicacion.geometry'] = {
        $geoWithin: { $box: [[minLng, minLat], [maxLng, maxLat]] }
      };
    }
  }

  const limit = Math.min(parseInt(limite, 10) || 5000, 10000);

  const docs = await Accidente.find(filters, {
    _id: 1,
    numeroExpediente: 1,
    fecha: 1,
    'ubicacion.calle': 1,
    'ubicacion.nombreDistrito': 1,
    'ubicacion.geometry': 1,
    'circunstancias.tipoAccidente': 1,
    'circunstancias.gravedad': 1,
    'vehiculo.tipo': 1
  })
    .sort({ fecha: -1 })
    .limit(limit)
    .maxTimeMS(MONGODB_TIMEOUTS.AGGREGATE_TIMEOUT_MS)
    .lean();

  const featureCollection = documentosAFeatureCollection(
    docs,
    (doc) => ({
      id: doc._id?.toString(),
      geometry: doc.ubicacion?.geometry,
      properties: {
        numeroExpediente: doc.numeroExpediente,
        fecha: doc.fecha,
        calle: doc.ubicacion?.calle,
        distrito: doc.ubicacion?.nombreDistrito,
        tipoAccidente: doc.circunstancias?.tipoAccidente,
        gravedad: doc.circunstancias?.gravedad,
        tipoVehiculo: doc.vehiculo?.tipo
      }
    }),
    { recurso: 'accidentes', limite: limit }
  );

  res.status(HTTP_STATUS.OK).json(
    createResponse(featureCollection, 'Mapa de accidentes generado exitosamente')
  );
});

module.exports = {
  obtenerAccidentes,
  obtenerAccidentePorExpediente,
  obtenerEstadisticasAccidentes,
  obtenerComparativaDistritos,
  obtenerMapaCalorAccidentes,
  obtenerMapaAccidentes
};
