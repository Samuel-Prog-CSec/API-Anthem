/**
 * Controlador de Asignacion de Patinetes
 *
 * Maneja las operaciones CRUD y consultas para datos de distribucion de patinetes
 * electricos. Incluye analisis de mercado, concentracion por zonas, estadisticas
 * por proveedor y metricas de optimizacion para el dashboard del frontend.
 */

const AsignacionPatinetes = require('../models/AsignacionPatinetes');
const { createNotFoundError } = require('../utils/errorUtils');
const { createPaginationMeta } = require('../utils/paginationHelper');
const { buildFilters, buildSortOptions, buildPaginationOptions, TRANSFORMS } = require('../utils/queryHelper');
const { createResponse } = require('../utils/responseHelper');
const { construirFeatureCollection, construirFeature } = require('../utils/geoJsonHelper');
const { centroidePorNombre } = require('../utils/centroidesDistritosMadrid');
const { SORT_FIELDS, PAGINATION, HTTP_STATUS, MONGODB_TIMEOUTS, AGGREGATION_LIMITS, BINARY_INDICATORS, NIVELES_DENSIDAD_PATINETES, GEOMETRY_TYPES } = require('../constants');
const asyncHandler = require('../utils/asyncHandler');

/**
 * Obtener datos de asignacion de patinetes con filtros
 * GET /api/v1/patinetes
 */
const obtenerAsignaciones = asyncHandler(async (req, res) => {
  const {
    proveedor,
    soloProveedoresActivos = BINARY_INDICATORS.TRUE,
    includeAnalisis = BINARY_INDICATORS.TRUE
  } = req.query;

  const filterConfig = [
    { field: 'fechaAsignacion', type: 'dateRange', params: ['fecha'] },
    { field: 'distrito.nombre', type: 'regex', param: 'distrito' },
    { field: 'barrio.nombre', type: 'regex', param: 'barrio' },
    { field: 'clasificacionArea.tipoZona', type: 'exact', param: 'tipoZona', transform: TRANSFORMS.toUpperCase },
    { field: 'estadisticas.densidadPatinetes', type: 'exact', param: 'densidad', transform: TRANSFORMS.toUpperCase },
    { field: 'clasificacionArea.demandaEstimada', type: 'exact', param: 'demanda', transform: TRANSFORMS.toUpperCase },
    { field: 'analisisDistribucion.concentracionMercado', type: 'exact', param: 'concentracion', transform: TRANSFORMS.toUpperCase },
    { field: 'estadisticas.totalPatinetes', type: 'numericRange', params: ['minPatinetes', 'maxPatinetes'] }
  ];

  const filters = buildFilters(req.query, filterConfig);

  // Filtro especial por proveedor (array anidado).
  // Los nombres estan normalizados en MAYUSCULAS en BD (ver importarPatinetes.js).
  // Usar match exacto en lugar de RegExp para mejor performance.
  if (proveedor) {
    filters.proveedores = {
      $elemMatch: {
        nombre: proveedor.toUpperCase(),
        activo: soloProveedoresActivos !== false && soloProveedoresActivos !== 'false',
        cantidad: { $gt: 0 }
      }
    };
  }

  const sortMapping = {
    totalPatinetes: 'estadisticas.totalPatinetes',
    distrito: 'distrito.nombre',
    barrio: 'barrio.nombre',
    fecha: 'fechaAsignacion'
  };

  const sortOptions = buildSortOptions(
    req.query,
    sortMapping,
    SORT_FIELDS.SCOOTER_ASSIGNMENT,
    'totalPatinetes',
    'desc'
  );

  const pagination = buildPaginationOptions(req.query, {
    defaultLimit: PAGINATION.DEFAULT_LIMIT,
    maxLimit: PAGINATION.MAX_LIMIT
  });

  // Projection condicional
  const projection = includeAnalisis === 'true' ? {} : {
    'distrito.nombre': 1,
    'barrio.nombre': 1,
    'fechaAsignacion': 1,
    'estadisticas': 1,
    'clasificacionArea': 1,
    'proveedores': 1
  };

  // Obtener datos con metodo optimizado del modelo
  const result = await AsignacionPatinetes.obtenerAsignacionesConFiltros(
    filters,
    sortOptions,
    { skip: pagination.skip, limit: pagination.limit },
    projection
  );

  // Calcular estadisticas de la consulta
  const queryStatistics = await AsignacionPatinetes.aggregate([
    { $match: filters },
    {
      $group: {
        _id: null,
        totalPatinetes: { $sum: '$estadisticas.totalPatinetes' },
        promedioPatinetes: { $avg: '$estadisticas.totalPatinetes' },
        maxPatinetes: { $max: '$estadisticas.totalPatinetes' },
        minPatinetes: { $min: '$estadisticas.totalPatinetes' },
        totalProveedores: { $sum: '$estadisticas.totalProveedores' },
        areasAltaDensidad: {
          $sum: {
            $cond: [
              { $in: ['$estadisticas.densidadPatinetes', [NIVELES_DENSIDAD_PATINETES.ALTA, NIVELES_DENSIDAD_PATINETES.MUY_ALTA]] },
              1,
              0
            ]
          }
        }
      }
    }
  ]).option({ maxTimeMS: MONGODB_TIMEOUTS.AGGREGATE_TIMEOUT_MS });

  const responseData = {
    asignaciones: result.asignaciones,
    pagination: createPaginationMeta(pagination.page, pagination.limit, result.total),
    estadisticas: queryStatistics[0] || {
      totalPatinetes: 0,
      promedioPatinetes: 0,
      maxPatinetes: 0,
      minPatinetes: 0,
      totalProveedores: 0,
      areasAltaDensidad: 0
    },
    filtros: {
      aplicados: Object.keys(filters).length,
      activos: filters
    }
  };

  res.status(HTTP_STATUS.OK).json(createResponse(responseData, 'Datos de asignacion de patinetes obtenidos correctamente'));
});

/**
 * Obtener estadisticas por distrito
 * GET /api/v1/patinetes/estadisticas/distritos
 */
const obtenerEstadisticasDistritos = asyncHandler(async (req, res) => {
  const { fecha } = req.query;

  const statistics = await AsignacionPatinetes.obtenerEstadisticasDistrito(fecha);

  const responseData = {
    estadisticas: statistics,
    fecha: fecha || 'Todas las fechas',
    totalDistritos: statistics.length
  };

  res.status(HTTP_STATUS.OK).json(createResponse(responseData, 'Estadisticas por distrito obtenidas correctamente'));
});

/**
 * Obtener analisis de mercado por proveedor
 * GET /api/v1/patinetes/analisis/proveedores
 */
const obtenerAnalisisMercadoProveedores = asyncHandler(async (req, res) => {
  const { fecha } = req.query;

  const marketAnalysis = await AsignacionPatinetes.obtenerAnalisisMercadoProveedores(fecha);

  // Calcular participacion de mercado
  const totalPatinetes = marketAnalysis.reduce((sum, proveedor) => sum + proveedor.totalPatinetes, 0);

  const analysisWithMarketShare = marketAnalysis.map(proveedor => ({
    ...proveedor,
    participacionMercado: totalPatinetes > 0 ? (proveedor.totalPatinetes / totalPatinetes) * 100 : 0,
    cobertura: proveedor.totalDistritos
  }));

  const responseData = {
    analisis: analysisWithMarketShare,
    resumen: {
      totalPatinetes,
      totalProveedores: marketAnalysis.length,
      fecha: fecha || 'Todas las fechas'
    }
  };

  res.status(HTTP_STATUS.OK).json(createResponse(responseData, 'Analisis de mercado por proveedor obtenido correctamente'));
});

/**
 * Obtener zonas de mayor concentracion
 * GET /api/v1/patinetes/zonas-concentracion
 */
const obtenerZonasConcentracion = asyncHandler(async (req, res) => {
  const { limite = AGGREGATION_LIMITS.TOP_RESULTS, fecha } = req.query;

  const zonas = await AsignacionPatinetes.obtenerZonasMayorConcentracion(parseInt(limite), fecha);

  const responseData = {
    zonas,
    parametros: {
      limite: parseInt(limite),
      fecha: fecha || 'Todas las fechas'
    }
  };

  res.status(HTTP_STATUS.OK).json(createResponse(responseData, 'Zonas de mayor concentracion obtenidas correctamente'));
});

/**
 * Obtener detalles de un area especifica
 * GET /api/v1/patinetes/area/:distrito/:barrio
 */
const obtenerDetallesArea = asyncHandler(async (req, res, next) => {
  const { distrito, barrio } = req.params;
  const { fecha } = req.query;

  const result = await AsignacionPatinetes.obtenerDetallesAreaOptimizado(distrito, barrio, fecha);

  if (!result) {
    return next(createNotFoundError('Area', `${distrito}/${barrio}`));
  }

  const responseData = {
    area: {
      ...result.area,
      resumen: AsignacionPatinetes.obtenerResumenAsignacion(result.area)
    },
    historial: result.historial,
    areasSimilares: result.areasSimilares,
    parametros: {
      distrito,
      barrio,
      fecha: fecha || 'Mas reciente'
    }
  };

  res.status(HTTP_STATUS.OK).json(createResponse(responseData, 'Detalles del area obtenidos correctamente'));
});

/**
 * Obtener mapa de asignacion de patinetes por distrito en formato
 * FeatureCollection GeoJSON. Como el modelo agrupa datos por distrito
 * (no por coordenada exacta), se asigna el centroide de cada distrito
 * de Madrid a cada feature. Permite visualizar densidad y cuota de
 * mercado de proveedores sobre un mapa.
 *
 * GET /api/v1/patinetes/mapa
 * Query params: fecha (opcional), proveedor (opcional)
 */
const obtenerMapaPatinetes = asyncHandler(async (req, res) => {
  const filterConfig = [
    { field: 'fechaAsignacion', type: 'dateRange', params: ['fecha'] },
    { field: 'distrito.nombre', type: 'regex', param: 'distrito' }
  ];
  const filters = buildFilters(req.query, filterConfig);

  // Agregar por distrito: suma total patinetes y desglose por proveedor
  const agregacion = [
    { $match: filters },
    {
      $group: {
        _id: '$distrito.nombre',
        codigoDistrito: { $first: '$distrito.codigo' },
        totalPatinetes: { $sum: '$estadisticas.totalPatinetes' },
        totalRegistros: { $sum: 1 },
        densidades: { $addToSet: '$estadisticas.densidadPatinetes' },
        proveedores: { $push: '$proveedores' }
      }
    },
    { $sort: { totalPatinetes: -1 } }
  ];

  const resultados = await AsignacionPatinetes.aggregate(agregacion)
    .option({ maxTimeMS: MONGODB_TIMEOUTS.AGGREGATE_TIMEOUT_MS });

  const features = [];
  let sinCentroide = 0;

  for (const row of resultados) {
    const centroide = centroidePorNombre(row._id);
    if (!centroide) {
      sinCentroide++;
      continue;
    }
    // Resumir top proveedores: flat() aplana las listas anidadas en una sola
    // pasada y reduce el nivel de anidamiento del bucle
    const contadorProveedores = {};
    for (const p of (row.proveedores || []).flat()) {
      if (!p?.nombre) { continue; }
      contadorProveedores[p.nombre] = (contadorProveedores[p.nombre] || 0) + (p.cantidad || 0);
    }
    const topProveedores = Object.entries(contadorProveedores)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([nombre, cantidad]) => ({ nombre, cantidad }));

    features.push(construirFeature(
      { type: GEOMETRY_TYPES.POINT, coordinates: centroide.coordenadas },
      {
        distrito: row._id,
        codigoDistrito: centroide.codigo,
        totalPatinetes: row.totalPatinetes,
        totalRegistros: row.totalRegistros,
        densidades: row.densidades?.filter(Boolean) || [],
        topProveedores
      },
      centroide.codigo
    ));
  }

  const featureCollection = construirFeatureCollection(features, {
    recurso: 'patinetes',
    distritosSinCentroide: sinCentroide
  });

  res.status(HTTP_STATUS.OK).json(
    createResponse(featureCollection, 'Mapa de patinetes generado exitosamente')
  );
});

module.exports = {
  obtenerAsignaciones,
  obtenerEstadisticasDistritos,
  obtenerAnalisisMercadoProveedores,
  obtenerZonasConcentracion,
  obtenerDetallesArea,
  obtenerMapaPatinetes
};
