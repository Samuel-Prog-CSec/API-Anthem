/**
 * Controlador de Censo - Demografia
 *
 * Endpoints orientados a consulta directa y metadatos basicos
 * demograficos (listados, piramide poblacional, resumen por distrito).
 * La parte analitica pesada (dashboard, evolucion temporal, analisis
 * avanzado) vive en controladorCensoAnalisis.js.
 *
 * Division realizada como parte del cierre de calidad: el controlador
 * original tenia 726 lineas, superando el maximo de 400-600 marcado
 * en CLAUDE.md. Se separo por responsabilidad: consulta vs analisis.
 */

const Censo = require('../models/Censo');
const { createPaginationMeta } = require('../utils/paginationHelper');
const {
  buildSortOptions,
  buildPaginationOptions,
  buildFilters,
  TRANSFORMS,
  parseNumericParams,
  buildResponseMetadata
} = require('../utils/queryHelper');
const { createResponse } = require('../utils/responseHelper');
const {
  SORT_FIELDS,
  PAGINATION,
  HTTP_STATUS,
  AGE_GROUPS,
  MONGODB_TIMEOUTS,
  DATASET_YEARS,
  CENSUS_DEFAULTS
} = require('../constants');
const asyncHandler = require('../utils/asyncHandler');

/**
 * Obtener datos de censo con filtros
 * GET /api/v1/censo
 */
const obtenerDatosCenso = asyncHandler(async (req, res) => {
  const {
      distrito,
      barrio,
      grupoEdad,
      soloProductivos,
      soloTerceraEdad,
      page = PAGINATION.DEFAULT_PAGE,
      limit = PAGINATION.DEFAULT_LIMIT,
      sortBy = 'fechaCenso',
      sortOrder = 'desc',
      includeEstadisticas = true
    } = req.query;

    // Construir filtros base usando queryHelper
    const baseFilters = buildFilters(req.query, [
      { field: 'fechaCenso', type: 'dateRange', params: ['startDate', 'endDate'] }
    ]);

    // Filtros geograficos usando TRANSFORMS
    const filters = { ...baseFilters };
    if (distrito) {
      const distritoValues = TRANSFORMS.toIntArray(distrito);
      filters['distrito.codigo'] = distritoValues.length === 1 ? distritoValues[0] : { $in: distritoValues };
    }

    if (barrio) {
      const barrioValues = TRANSFORMS.toIntArray(barrio);
      filters['barrio.codigo'] = barrioValues.length === 1 ? barrioValues[0] : { $in: barrioValues };
    }

    // Filtros demograficos
    if (grupoEdad) {
      if (Array.isArray(grupoEdad)) {
        filters['clasificacionEdad.grupoEdad'] = { $in: grupoEdad };
      } else {
        filters['clasificacionEdad.grupoEdad'] = grupoEdad;
      }
    }

    // Usar buildFilters para rangos numericos
    const numericFilters = buildFilters(req.query, [
      { field: 'edad', type: 'numericRange', params: ['minEdad', 'maxEdad'] },
      { field: 'estadisticas.totalPoblacion', type: 'numericRange', params: ['minPoblacion', 'maxPoblacion'] }
    ]);
    Object.assign(filters, numericFilters);

    // Filtros booleanos
    if (soloProductivos === 'true') {
      filters['clasificacionEdad.esGrupoProductivo'] = true;
    }

    if (soloTerceraEdad === 'true') {
      filters['clasificacionEdad.esTerceraEdad'] = true;
    }

    // Configurar paginacion usando queryHelper
    const paginationOptions = buildPaginationOptions(
      { page, limit },
      { defaultLimit: PAGINATION.DEFAULT_LIMIT, maxLimit: PAGINATION.MAX_LIMIT }
    );

    // Configurar ordenamiento usando queryHelper
    const sortMapping = {
      'totalPoblacion': 'estadisticas.totalPoblacion',
      'porcentajeExtranjeros': 'estadisticas.porcentajeExtranjeros',
      'edad': 'edad',
      'distrito': 'distrito.descripcion',
      'barrio': 'barrio.descripcion',
      'fechaCenso': 'fechaCenso'
    };
    const sortOptions = buildSortOptions(
      { sortBy, sortOrder },
      sortMapping,
      SORT_FIELDS.CENSUS,
      'fechaCenso',
      'desc'
    );

    // Proyeccion optimizada: seleccionar solo campos necesarios
    const projection = includeEstadisticas ? {
      fechaCenso: 1,
      edad: 1,
      'distrito.codigo': 1,
      'distrito.descripcion': 1,
      'barrio.codigo': 1,
      'barrio.descripcion': 1,
      'estadisticas.totalPoblacion': 1,
      'estadisticas.totalEspañoles': 1,
      'estadisticas.totalExtranjeros': 1,
      'estadisticas.porcentajeExtranjeros': 1,
      'estadisticas.totalHombres': 1,
      'estadisticas.totalMujeres': 1,
      'clasificacionEdad.grupoEdad': 1,
      'clasificacionEdad.esGrupoProductivo': 1,
      'clasificacionEdad.esTerceraEdad': 1
    } : {
      fechaCenso: 1,
      edad: 1,
      'distrito.codigo': 1,
      'distrito.descripcion': 1,
      'barrio.codigo': 1,
      'barrio.descripcion': 1
    };

    const { cursor } = req.query;

    const { data, total: totalDocuments, stats, cursor: cursorMeta } = await Censo.buscarConOpciones({
      filters,
      sort: sortOptions,
      pagination: paginationOptions,
      projection,
      lean: true,
      includeStats: true,
      cursor
    });

    const paginationMeta = cursorMeta || createPaginationMeta(paginationOptions.page, paginationOptions.limit, totalDocuments);

    const summary = stats || {
      totalRegistros: 0,
      poblacionTotal: 0,
      poblacionEspañola: 0,
      poblacionExtranjera: 0,
      poblacionProductiva: 0,
      terceraEdad: 0,
      distritosUnicos: [],
      barriosUnicos: []
    };

    const responseData = {
      message: 'Datos de censo obtenidos exitosamente',
      data,
      pagination: paginationMeta,
      resumen: {
        ...summary,
        totalDistritos: summary.distritosUnicos.length,
        totalBarrios: summary.barriosUnicos.length,
        porcentajeExtranjeros: summary.poblacionTotal > 0 ?
          (summary.poblacionExtranjera / summary.poblacionTotal * 100).toFixed(2) : 0,
        porcentajePoblacionProductiva: summary.poblacionTotal > 0 ?
          (summary.poblacionProductiva / summary.poblacionTotal * 100).toFixed(2) : 0,
        porcentajeTerceraEdad: summary.poblacionTotal > 0 ?
          (summary.terceraEdad / summary.poblacionTotal * 100).toFixed(2) : 0
      },
      filtros: {
        aplicados: Object.keys(filters).length > 0 ? filters : null,
        disponibles: {
          gruposEdad: Object.values(AGE_GROUPS)
        }
      }
    };

  res.status(HTTP_STATUS.OK).json(createResponse(responseData, 'Datos de censo obtenidos exitosamente'));
});

/**
 * Obtener piramide poblacional
 * GET /api/v1/censo/piramide
 */
const obtenerPiramidePoblacional = asyncHandler(async (req, res) => {
  const { incluirExtranjeros = true } = req.query;

  const { año, mes, distrito } = parseNumericParams(
    req.query,
    ['año', 'mes', 'distrito'],
    { año: DATASET_YEARS.DEFAULT_YEAR }
  );

  const result = await Censo.obtenerPiramidePoblacionalOptimizada({
    año,
    mes,
    distrito,
    incluirExtranjeros: incluirExtranjeros === 'true'
  });

  const responseData = {
    piramideDetallada: result.piramideDetallada,
    piramideSimplificada: result.piramideSimplificada,
    totales: result.totales,
    configuracion: buildResponseMetadata({
      distrito,
      año,
      // mes real usado por el service (el ultimo con datos si no se indico uno),
      // para que la UI no muestre "TODOS" cuando en realidad es una foto mensual.
      mes: result.mesUtilizado != null ? result.mesUtilizado : mes,
      incluirExtranjeros: incluirExtranjeros === 'true'
    }, { nullLabel: CENSUS_DEFAULTS.DISTRICT_LABEL })
  };

  res.status(HTTP_STATUS.OK).json(createResponse(responseData, 'Piramide poblacional obtenida exitosamente'));
});

/**
 * Obtener resumen ligero de distritos con poblacion total
 * GET /api/v1/censo/distritos/resumen
 *
 * Endpoint ligero disenado para ser consumido por otras paginas del
 * frontend que necesitan calcular metricas per capita (p.ej. multas
 * por habitante). Devuelve solo codigo, nombre y poblacion total.
 */
const obtenerResumenDistritos = asyncHandler(async (req, res) => {
  const { año = DATASET_YEARS.DEFAULT_YEAR, mes } = req.query;
  const añoNum = parseInt(año, 10);

  // BUG fix poblacion x12: el dataset Anthem tiene 12 snapshots mensuales
  // del censo (un doc por edad/seccion/mes). Sin filtrar por mes la suma
  // de `totalPoblacion` multiplicaba por 12 (CENTRO salia 1.69 M en lugar
  // de ~141 K). Cuando el cliente no especifica mes tomamos el ULTIMO
  // mes con datos como "foto" mas reciente, identico patron al de
  // `obtenerDashboardDemografico` en controladorCensoAnalisis.
  let mesElegido = mes ? parseInt(mes, 10) : null;
  if (!mesElegido) {
    const [doc] = await Censo.aggregate([
      { $match: { año: añoNum } },
      { $group: { _id: '$mes' } },
      { $sort: { _id: -1 } },
      { $limit: 1 }
    ]).option({ maxTimeMS: MONGODB_TIMEOUTS.AGGREGATE_TIMEOUT_MS });
    mesElegido = doc?._id || 12;
  }
  const matchFilter = { año: añoNum, mes: mesElegido };

  // Mongoose 9 elimino Aggregate.prototype.maxTimeMS(); se usa .option({maxTimeMS}).
  const resumen = await Censo.aggregate([
    { $match: matchFilter },
    {
      $group: {
        _id: '$distrito.codigo',
        nombre: { $first: '$distrito.descripcion' },
        totalPoblacion: { $sum: '$estadisticas.totalPoblacion' }
      }
    },
    { $sort: { _id: 1 } },
    {
      $project: {
        _id: 0,
        codigo: '$_id',
        nombre: 1,
        totalPoblacion: 1
      }
    }
  ]).option({ maxTimeMS: MONGODB_TIMEOUTS.AGGREGATE_TIMEOUT_MS });

  return res.status(HTTP_STATUS.OK).json(
    createResponse({
      data: resumen,
      totalDistritos: resumen.length,
      filtros: { año: añoNum, mes: mesElegido }
    }, 'Resumen de distritos obtenido correctamente')
  );
});

module.exports = {
  obtenerDatosCenso,
  obtenerPiramidePoblacional,
  obtenerResumenDistritos
};
