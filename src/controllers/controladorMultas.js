/**
 * Controlador de Multas
 *
 * Maneja las operaciones CRUD y consultas para datos de multas de trafico.
 * Incluye filtrado avanzado, agregaciones estadisticas y analisis temporal
 * para el dashboard del frontend.
 */

const Multa = require('../models/Multa');
const { createNotFoundError } = require('../utils/errorUtils');
const { createPaginationMeta } = require('../utils/paginationHelper');
const { buildFilters, buildSortOptions, buildPaginationOptions, TRANSFORMS, parseNumericParams, buildResponseMetadata, executeFacetPagination } = require('../utils/queryHelper');
const { createResponse } = require('../utils/responseHelper');
const { documentosAFeatureCollection } = require('../utils/geoJsonHelper');
const { bboxDeDistrito } = require('../utils/centroidesDistritosMadrid');
const { SORT_FIELDS, PAGINATION, HTTP_STATUS, SEVERITY_LEVELS, INFRACTION_TYPES, DATA_QUALITY_LEVELS, MONGODB_TIMEOUTS, AGGREGATION_LIMITS, TIME_CONSTANTS, FINE_CONSTANTS, DASHBOARD_PERIODS, DEFAULT_SORT_FIELDS, DATASET_YEARS } = require('../constants');
const asyncHandler = require('../utils/asyncHandler');

/**
 * Obtener multas con filtros avanzados
 * GET /api/v1/multas
 */
const obtenerMultas = asyncHandler(async (req, res) => {
  const {
    conDescuento,
    esGrave,
    page = PAGINATION.DEFAULT_PAGE,
    limit = PAGINATION.DEFAULT_LIMIT,
    sortBy = DEFAULT_SORT_FIELDS.FINE,
    sortOrder = DEFAULT_SORT_FIELDS.DEFAULT_ORDER,
    includeCoordinates = false
  } = req.query;

  // Configuracion de filtros usando buildFilters
  const filterConfig = [
    { field: 'fecha', type: 'dateRange', params: ['startDate', 'endDate'] },
    { field: 'calificacion', type: 'in', param: 'calificacion', transform: TRANSFORMS.toUpperCaseArray },
    { field: 'lugar', type: 'regex', param: 'lugar' },
    { field: 'metadatos.tipoInfraccion', type: 'in', param: 'tipoInfraccion' },
    { field: 'denunciante', type: 'regex', param: 'denunciante' },
    { field: 'importeFinal', type: 'numericRange', params: ['minImporte', 'maxImporte'] },
    { field: 'puntosDetraídos', type: 'numericRange', params: ['minPuntos', 'maxPuntos'] }
  ];

  const filters = buildFilters(req.query, filterConfig);

  // Filtros booleanos adicionales
  if (conDescuento !== undefined) {
    filters.tieneDescuento = conDescuento === 'true';
  }

  if (esGrave !== undefined) {
    filters['metadatos.esInfraccionGrave'] = esGrave === 'true';
  }

  // Configurar paginacion usando queryHelper
  const paginationOptions = buildPaginationOptions(
    { page, limit },
    { defaultLimit: PAGINATION.DEFAULT_LIMIT, maxLimit: PAGINATION.MAX_LIMIT }
  );

  // Configurar ordenamiento usando queryHelper
  const sortMapping = {
    fecha: 'fecha',
    importeFinal: 'importeFinal',
    puntosDetraídos: 'puntosDetraídos',
    lugar: 'lugar',
    calificacion: 'calificacion'
  };
  const sortOptions = buildSortOptions(
    { sortBy, sortOrder },
    sortMapping,
    SORT_FIELDS.FINE,
    'fecha',
    'desc'
  );

  // Proyeccion optimizada: seleccionar solo campos necesarios
  const projection = {
    fecha: 1,
    hora: 1,
    lugar: 1,
    calificacion: 1,
    importeBoletín: 1,
    importeFinal: 1,
    puntosDetraídos: 1,
    tieneDescuento: 1,
    denunciante: 1,
    'metadatos.tipoInfraccion': 1,
    'metadatos.esInfraccionGrave': 1,
    'metadatos.esInfraccionVelocidad': 1
  };

  // Incluir coordenadas si se solicita
  if (includeCoordinates) {
    projection.coordenadas = 1;
  }

  // Pipeline de estadisticas: se ejecuta DENTRO del mismo $facet que data+count,
  // ahorrando una pasada completa de la coleccion respecto al patron anterior
  // (executeFacetPagination + aggregate adicional con $group).
  // NO usar $limit antes de $group: corrompe las estadisticas globales.
  const statsPipeline = [
    {
      $group: {
        _id: null,
        totalImporte: { $sum: '$importeFinal' },
        importePromedio: { $avg: '$importeFinal' },
        totalPuntos: { $sum: '$puntosDetraídos' },
        multasGraves: {
          $sum: { $cond: ['$metadatos.esInfraccionGrave', 1, 0] }
        },
        multasConDescuento: {
          $sum: { $cond: ['$tieneDescuento', 1, 0] }
        }
      }
    }
  ];

  // Ejecutar consulta con facet: datos + total + estadisticas en una sola operacion
  const {
    data,
    total: totalDocuments,
    stats: quickStatistics,
    fallback: fineFacetFallback,
    fallbackError: fineFacetError
  } = await executeFacetPagination({
    model: Multa,
    filters,
    sort: sortOptions,
    projection,
    pagination: paginationOptions,
    statsPipeline,
    maxTimeMS: MONGODB_TIMEOUTS.AGGREGATE_TIMEOUT_MS
  });

  const paginationMeta = createPaginationMeta(paginationOptions.page, paginationOptions.limit, totalDocuments);

  const responseData = {
    data,
    pagination: paginationMeta,
    estadisticas: quickStatistics || {
      totalImporte: 0,
      importePromedio: 0,
      totalPuntos: 0,
      multasGraves: 0,
      multasConDescuento: 0
    },
    performance: fineFacetFallback ? {
      facetFallback: true,
      reason: fineFacetError
    } : undefined,
    filtros: {
      aplicados: Object.keys(filters).length > 0 ? filters : null,
      disponibles: {
        calificaciones: Object.values(SEVERITY_LEVELS.FINE),
        tiposInfraccion: Object.values(INFRACTION_TYPES)
      }
    }
  };

  res.status(HTTP_STATUS.OK).json(createResponse(responseData, 'Multas obtenidas exitosamente'));
});

/**
 * Obtener multa por ID con detalles completos
 * GET /api/v1/multas/:id
 */
const obtenerMultaPorId = asyncHandler(async (req, res, next) => {
  const { id } = req.params;

  // Excluir metadatos internos de procesamiento (archivoOrigen, validaciones,
  // fecha de importacion) y timestamps: no aportan al detalle publico de la
  // multa y .lean() no aplica el transform toJSON que los quitaria.
  const multa = await Multa.findById(id)
    .select('-procesamiento -createdAt -updatedAt')
    .maxTimeMS(MONGODB_TIMEOUTS.QUERY_TIMEOUT_MS)
    .lean();

  if (!multa) {
    return next(createNotFoundError('Multa', id));
  }

  // Agregar informacion calculada adicional
  const impactoEconomico = {
    importeOriginal: multa.importeBoletín,
    importeFinal: multa.importeFinal,
    descuentoAplicado: multa.tieneDescuento ? multa.importeBoletín - multa.importeFinal : 0,
    porcentajeDescuento: multa.tieneDescuento ? FINE_CONSTANTS.DISCOUNT_PERCENTAGE : 0
  };

  const responseData = {
    ...multa,
    impactoEconomico,
    gravedad: multa.calificacion === SEVERITY_LEVELS.FINE.GRAVE ||
              multa.calificacion === SEVERITY_LEVELS.FINE.MUY_GRAVE ? DATA_QUALITY_LEVELS.ALTA : DATA_QUALITY_LEVELS.BAJA
  };

  res.status(HTTP_STATUS.OK).json(createResponse(responseData, 'Detalles de multa obtenidos exitosamente'));
});

/**
 * Obtener estadisticas generales de multas
 * GET /api/v1/multas/estadisticas
 */
const obtenerEstadisticasMultas = asyncHandler(async (req, res) => {
  const { startDate, endDate, groupBy = 'month' } = req.query;

  const { limit } = parseNumericParams(
    req.query,
    ['limit'],
    { limit: AGGREGATION_LIMITS.MONTHLY_STATS }
  );

  // Filtros de dominio para que la distribucion (p.ej. groupBy=severity)
  // reaccione a denunciante/descuento/gravedad igual que los KPIs. No se
  // incluye `calificacion`: la distribucion agrupa por ese mismo campo y
  // filtrarla por el la colapsaria a una sola barra.
  const filtrosAdicionales = buildFilters(req.query, [
    { field: 'denunciante', type: 'regex', param: 'denunciante' }
  ]);
  const descuento = req.query.tieneDescuento ?? req.query.conDescuento;
  if (descuento !== undefined) {
    filtrosAdicionales.tieneDescuento = descuento === true || descuento === 'true';
  }
  if (req.query.esGrave !== undefined) {
    filtrosAdicionales['metadatos.esInfraccionGrave'] = req.query.esGrave === true || req.query.esGrave === 'true';
  }

  const result = await Multa.obtenerEstadisticasOptimizadas({
    startDate: startDate ? new Date(startDate) : null,
    endDate: endDate ? new Date(endDate) : null,
    groupBy,
    limit,
    filtrosAdicionales
  });

  const responseData = {
    estadisticas: result.estadisticas,
    resumen: result.resumen,
    configuracion: buildResponseMetadata({
      agrupacion: groupBy,
      filtros: startDate || endDate ? { startDate, endDate } : null,
      limite: limit
    })
  };

  res.status(HTTP_STATUS.OK).json(createResponse(responseData, 'Estadisticas de multas obtenidas exitosamente'));
});

/**
 * Obtener ranking de ubicaciones con mas multas
 * GET /api/v1/multas/ubicaciones/ranking
 */
const obtenerRankingUbicaciones = asyncHandler(async (req, res) => {
  const { startDate, endDate, tipoInfraccion } = req.query;

  const { limit } = parseNumericParams(
    req.query,
    ['limit'],
    { limit: AGGREGATION_LIMITS.TOP_RESULTS }
  );

  // Filtros de dominio (calificacion, denunciante, descuento) para que el
  // ranking responda a los mismos filtros que los KPIs. La fecha y el tipo de
  // infraccion se pasan aparte (ya soportados), por eso se excluyen aqui.
  const filtrosAdicionales = buildFilters(req.query, [
    { field: 'calificacion', type: 'in', param: 'calificacion', transform: TRANSFORMS.toUpperCaseArray },
    { field: 'denunciante', type: 'regex', param: 'denunciante' }
  ]);
  const descuento = req.query.tieneDescuento ?? req.query.conDescuento;
  if (descuento !== undefined) {
    filtrosAdicionales.tieneDescuento = descuento === true || descuento === 'true';
  }
  if (req.query.esGrave !== undefined) {
    filtrosAdicionales['metadatos.esInfraccionGrave'] = req.query.esGrave === true || req.query.esGrave === 'true';
  }

  const ranking = await Multa.obtenerRankingUbicacionesOptimizado({
    startDate: startDate ? new Date(startDate) : null,
    endDate: endDate ? new Date(endDate) : null,
    tipoInfraccion,
    limit,
    filtrosAdicionales
  });

  const responseData = {
    ranking,
    configuracion: buildResponseMetadata({
      filtros: startDate || endDate || tipoInfraccion ? { startDate, endDate, tipoInfraccion } : null,
      limite: limit
    }),
    metadatos: {
      totalUbicaciones: ranking.length,
      fechaConsulta: new Date()
    }
  };

  res.status(HTTP_STATUS.OK).json(createResponse(responseData, 'Ranking de ubicaciones obtenido exitosamente'));
});

/**
 * Obtener analisis temporal de multas
 * GET /api/v1/multas/analisis/temporal
 */
const obtenerAnalisisTemporal = asyncHandler(async (req, res) => {
  const { startDate, endDate, tipoAnalisis = 'monthly' } = req.query;

  const result = await Multa.obtenerAnalisisTemporalOptimizado({
    startDate: startDate ? new Date(startDate) : null,
    endDate: endDate ? new Date(endDate) : null,
    tipoAnalisis
  });

  const responseData = {
    analisis: result.analisis,
    tendencia: result.tendencia,
    configuracion: buildResponseMetadata({
      tipoAnalisis,
      filtros: startDate || endDate ? { startDate, endDate } : null
    }),
    metadatos: {
      totalPeriodos: result.analisis.length,
      fechaConsulta: new Date()
    }
  };

  res.status(HTTP_STATUS.OK).json(createResponse(responseData, 'Analisis temporal obtenido exitosamente'));
});

/**
 * Obtener metricas del dashboard principal
 * GET /api/v1/multas/dashboard
 */
const obtenerMetricasDashboard = asyncHandler(async (req, res) => {
  const { periodo = '30days', startDate, endDate } = req.query;

  // El dataset cubre el anho 2051. Los rangos del panel se calculan con
  // respecto al ULTIMO dia del dataset (31/12/2051), no a `new Date()`.
  // Si usasemos la fecha actual (>=2026) todas las queries devolverian 0
  // documentos porque las multas estan etiquetadas con fechas de 2051.
  // Un rango explicito (startDate/endDate, p.ej. el filtro de mes del
  // frontend) tiene prioridad sobre `periodo`.
  let fechaInicio;
  let fechaFin;

  if (startDate || endDate) {
    fechaInicio = startDate
      ? new Date(startDate)
      : new Date(`${DATASET_YEARS.DEFAULT_START_DATE}T00:00:00.000Z`);
    fechaFin = endDate
      ? new Date(endDate)
      : new Date(`${DATASET_YEARS.DEFAULT_END_DATE}T23:59:59.999Z`);
  } else {
    fechaFin = new Date(`${DATASET_YEARS.DEFAULT_END_DATE}T23:59:59.999Z`);
    switch (periodo) {
      case '7days':
        fechaInicio = new Date(fechaFin.getTime() - DASHBOARD_PERIODS.DAYS_7 * TIME_CONSTANTS.MILLISECONDS_PER_DAY);
        break;
      case '90days':
        fechaInicio = new Date(fechaFin.getTime() - DASHBOARD_PERIODS.DAYS_90 * TIME_CONSTANTS.MILLISECONDS_PER_DAY);
        break;
      case 'year':
        fechaInicio = new Date(`${DATASET_YEARS.DEFAULT_START_DATE}T00:00:00.000Z`);
        break;
      case '30days':
      default:
        fechaInicio = new Date(fechaFin.getTime() - DASHBOARD_PERIODS.DAYS_30 * TIME_CONSTANTS.MILLISECONDS_PER_DAY);
        break;
    }
  }

  // Filtros de dominio para que los KPIs reaccionen a TODOS los filtros del
  // panel (calificacion, denunciante, tipo, descuento), no solo al rango de
  // fechas. La fecha se gestiona aparte, por eso se excluye de este config.
  // Se reutiliza el mismo `buildFilters` que el endpoint de listado.
  const filtrosAdicionales = buildFilters(req.query, [
    { field: 'calificacion', type: 'in', param: 'calificacion', transform: TRANSFORMS.toUpperCaseArray },
    { field: 'denunciante', type: 'regex', param: 'denunciante' },
    { field: 'metadatos.tipoInfraccion', type: 'in', param: 'tipoInfraccion' }
  ]);
  const descuento = req.query.tieneDescuento ?? req.query.conDescuento;
  if (descuento !== undefined) {
    filtrosAdicionales.tieneDescuento = descuento === true || descuento === 'true';
  }
  if (req.query.esGrave !== undefined) {
    filtrosAdicionales['metadatos.esInfraccionGrave'] = req.query.esGrave === true || req.query.esGrave === 'true';
  }

  // Las agregaciones (metricas generales, top infracciones, evolucion diaria)
  // viven en el modelo. El controller solo coordina request -> respuesta
  const {
    metricasGenerales,
    topInfracciones,
    evolucionDiaria
  } = await Multa.obtenerMetricasPanel(fechaInicio, fechaFin, { filtrosAdicionales });

  const metricsGeneral = metricasGenerales;

  const responseData = {
    periodo: {
      descripcion: (startDate || endDate) ? 'rango' : periodo,
      fechaInicio,
      fechaFin
    },
    metricas: {
      general: metricsGeneral || {
        totalMultas: 0,
        importeTotal: 0,
        puntosTotal: 0,
        multasGraves: 0,
        multasConDescuento: 0,
        multasVelocidad: 0
      },
      topInfracciones,
      evolucionDiaria
    },
    resumen: {
      porcentajeGraves: metricsGeneral && metricsGeneral.totalMultas > 0
        ? (metricsGeneral.multasGraves / metricsGeneral.totalMultas * 100).toFixed(2)
        : 0,
      importePromedioPorMulta: metricsGeneral && metricsGeneral.totalMultas > 0
        ? (metricsGeneral.importeTotal / metricsGeneral.totalMultas).toFixed(2)
        : 0,
      puntosPromedioPorMulta: metricsGeneral && metricsGeneral.totalMultas > 0
        ? (metricsGeneral.puntosTotal / metricsGeneral.totalMultas).toFixed(2)
        : 0
    }
  };

  res.status(HTTP_STATUS.OK).json(createResponse(responseData, 'Metricas del dashboard obtenidas exitosamente'));
});

/**
 * Obtener multas como FeatureCollection GeoJSON. Solo se incluyen las
 * multas cuyo CSV trae coordenadas UTM validas (la geometry WGS84 se
 * deriva en el importador).
 *
 * GET /api/v1/multas/mapa
 *
 * Query params soportados:
 *   - startDate, endDate, calificacion, tipoInfraccion: filtros de dominio
 *   - bbox: 'minLng,minLat,maxLng,maxLat' (filtro espacial directo)
 *   - distrito: codigo (1-21) o nombre del distrito. Cuando se proporciona,
 *     y NO hay bbox explicito, se deriva un bbox aproximado a partir del
 *     centroide del distrito (cuadrado de `radioKm` km, default 4 km).
 *   - radioKm: radio en km para el bbox derivado de distrito (1-15, default 4)
 *   - limite: maximo de features (cap interno + validacion en route)
 */
const obtenerMapaMultas = asyncHandler(async (req, res) => {
  const { bbox, limite, distrito: distritoQuery, radioKm: radioKmQuery } = req.query;

  const filterConfig = [
    { field: 'fecha', type: 'dateRange', params: ['startDate', 'endDate'] },
    { field: 'calificacion', type: 'exact', param: 'calificacion', transform: TRANSFORMS.toUpperCase },
    { field: 'metadatos.tipoInfraccion', type: 'exact', param: 'tipoInfraccion', transform: TRANSFORMS.toUpperCase }
  ];
  const filters = buildFilters(req.query, filterConfig);
  // Exigir coordinates validas (no solo geometry != null, porque
  // Mongoose guarda `{type:'Point'}` sin coordinates cuando el
  // subdoc existe pero esta incompleto).
  filters['geometry.coordinates'] = { $exists: true, $ne: null, $type: 'array' };

  // Resolver bbox efectivo: bbox explicito tiene prioridad. Si no, intentar
  // derivar desde el codigo/nombre de distrito.
  let bboxString = bbox;
  let distritoResuelto = null;
  let bboxOrigen = bbox ? 'explicit' : null;

  if (!bbox && distritoQuery) {
    const result = bboxDeDistrito(distritoQuery, radioKmQuery);
    if (result) {
      distritoResuelto = result.distrito;
      bboxString = result.bbox.join(',');
      bboxOrigen = `distrito:${result.distrito.codigo}:radio${result.radioKm}km`;
    }
  }

  if (bboxString) {
    const [minLng, minLat, maxLng, maxLat] = bboxString.split(',').map(Number);
    if ([minLng, minLat, maxLng, maxLat].every(v => Number.isFinite(v))) {
      filters.geometry = {
        $geoWithin: { $box: [[minLng, minLat], [maxLng, maxLat]] }
      };
    }
  }

  // Cap interno alineado con `MAP_LIMITS.DEFAULT_MAX` (la validacion previa
  // en routes/multas.js ya rechaza valores >1000, este cap es defense in
  // depth por si la ruta cambia en el futuro).
  const limit = Math.min(parseInt(limite, 10) || 1000, 1000);

  const docs = await Multa.find(filters, {
    _id: 1,
    fecha: 1,
    lugar: 1,
    calificacion: 1,
    importeBoletín: 1,
    puntosDetraídos: 1,
    geometry: 1,
    'metadatos.tipoInfraccion': 1
  })
    .sort({ fecha: -1 })
    .limit(limit)
    .maxTimeMS(MONGODB_TIMEOUTS.AGGREGATE_TIMEOUT_MS)
    .lean();

  const featureCollection = documentosAFeatureCollection(
    docs,
    (doc) => ({
      id: doc._id?.toString(),
      geometry: doc.geometry,
      properties: {
        fecha: doc.fecha,
        lugar: doc.lugar,
        calificacion: doc.calificacion,
        importe: doc.importeBoletín,
        puntos: doc.puntosDetraídos,
        tipoInfraccion: doc.metadatos?.tipoInfraccion
      }
    }),
    { recurso: 'multas', limite: limit }
  );

  // Anadir metadatos del bbox derivado para que el cliente sepa el origen
  // y pueda mostrarlo en UI ("Mostrando multas de Centro - aproximacion 4km")
  if (bboxOrigen) {
    featureCollection._meta = featureCollection._meta || {};
    featureCollection._meta.bboxOrigen = bboxOrigen;
    if (distritoResuelto) {
      featureCollection._meta.distrito = {
        codigo: distritoResuelto.codigo,
        nombre: distritoResuelto.nombre,
        centroide: distritoResuelto.coordenadas,
        aproximacion: 'bbox-cuadrado-desde-centroide'
      };
    }
  }

  res.status(HTTP_STATUS.OK).json(
    createResponse(featureCollection, 'Mapa de multas generado exitosamente')
  );
});

module.exports = {
  obtenerMultas,
  obtenerMultaPorId,
  obtenerEstadisticasMultas,
  obtenerRankingUbicaciones,
  obtenerAnalisisTemporal,
  obtenerMetricasDashboard,
  obtenerMapaMultas
};
