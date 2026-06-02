/**
 * Service de Censo
 *
 * Encapsula la logica de agregaciones demograficas, piramide poblacional,
 * analisis y evolucion temporal. Los metodos estaticos del modelo `Censo`
 * actuan como thin wrappers que delegan en este service.
 */

const {
  DATASET_YEARS,
  AGGREGATION_LIMITS,
  MONGODB_TIMEOUTS
} = require('../constants');
const { createCursorMeta, buildCursorQuery } = require('../utils/paginationHelper');

const ESCALAR_AGG = { allowDiskUse: true, maxTimeMS: MONGODB_TIMEOUTS.AGGREGATE_TIMEOUT_MS };

/**
 * Piramide poblacional detallada y simplificada (2 agregaciones en paralelo).
 */
const obtenerPiramidePoblacionalOptimizada = async function(Model, options) {
  const { año = DATASET_YEARS.DEFAULT_YEAR, distrito = null, incluirExtranjeros = true } = options;

  const matchFilters = { año: parseInt(año, 10) };
  if (distrito) {
    matchFilters['distrito.codigo'] = parseInt(distrito, 10);
  }

  const [piramideDetallada, datosGenerales] = await Promise.all([
    Model.aggregate([
      { $match: matchFilters },
      {
        $group: {
          _id: { grupoEdad: '$clasificacionEdad.grupoEdad', edad: '$edad' },
          hombresEsp: { $sum: '$poblacion.españoles.hombres' },
          mujeresEsp: { $sum: '$poblacion.españoles.mujeres' },
          hombresExt: { $sum: '$poblacion.extranjeros.hombres' },
          mujeresExt: { $sum: '$poblacion.extranjeros.mujeres' }
        }
      },
      {
        $project: {
          _id: 0,
          grupoEdad: '$_id.grupoEdad',
          edad: '$_id.edad',
          hombres: incluirExtranjeros ? { $add: ['$hombresEsp', '$hombresExt'] } : '$hombresEsp',
          mujeres: incluirExtranjeros ? { $add: ['$mujeresEsp', '$mujeresExt'] } : '$mujeresEsp',
          totalPoblacion: incluirExtranjeros
            ? { $add: ['$hombresEsp', '$mujeresEsp', '$hombresExt', '$mujeresExt'] }
            : { $add: ['$hombresEsp', '$mujeresEsp'] },
          detalleNacionalidad: {
            españoles: { hombres: '$hombresEsp', mujeres: '$mujeresEsp' },
            extranjeros: { hombres: '$hombresExt', mujeres: '$mujeresExt' }
          }
        }
      },
      { $sort: { edad: 1 } }
    ]).option(ESCALAR_AGG),

    Model.aggregate([
      { $match: matchFilters },
      {
        $group: {
          _id: '$clasificacionEdad.grupoEdad',
          totalHombres: { $sum: '$estadisticas.totalHombres' },
          totalMujeres: { $sum: '$estadisticas.totalMujeres' },
          totalPoblacion: { $sum: '$estadisticas.totalPoblacion' },
          totalEspañoles: { $sum: '$estadisticas.totalEspañoles' },
          totalExtranjeros: { $sum: '$estadisticas.totalExtranjeros' },
          edadMin: { $min: '$edad' },
          edadMax: { $max: '$edad' }
        }
      },
      {
        $project: {
          _id: 0,
          grupoEdad: '$_id',
          poblacion: { hombres: '$totalHombres', mujeres: '$totalMujeres', total: '$totalPoblacion' },
          nacionalidad: { españoles: '$totalEspañoles', extranjeros: '$totalExtranjeros' },
          rangoEdad: { minima: '$edadMin', maxima: '$edadMax' }
        }
      },
      { $sort: { 'rangoEdad.minima': 1 } }
    ]).option(ESCALAR_AGG)
  ]);

  const totales = datosGenerales.reduce(
    (acc, item) => ({
      totalPoblacion: acc.totalPoblacion + item.poblacion.total,
      totalHombres: acc.totalHombres + item.poblacion.hombres,
      totalMujeres: acc.totalMujeres + item.poblacion.mujeres,
      totalEspañoles: acc.totalEspañoles + item.nacionalidad.españoles,
      totalExtranjeros: acc.totalExtranjeros + item.nacionalidad.extranjeros
    }),
    { totalPoblacion: 0, totalHombres: 0, totalMujeres: 0, totalEspañoles: 0, totalExtranjeros: 0 }
  );

  totales.ratioGenero = totales.totalMujeres > 0
    ? Math.round((totales.totalHombres / totales.totalMujeres) * 1000) / 1000
    : 0;
  totales.porcentajeExtranjeros = totales.totalPoblacion > 0
    ? Math.round((totales.totalExtranjeros / totales.totalPoblacion) * 10000) / 100
    : 0;

  return {
    piramideDetallada,
    piramideSimplificada: datosGenerales,
    totales
  };
};

/**
 * Analisis demografico completo con $facet.
 */
const obtenerAnalisisDemograficoOptimizado = async function(Model, options) {
  const { año = DATASET_YEARS.DEFAULT_YEAR, mes = null, distrito = null } = options;

  const matchFilters = { año: parseInt(año, 10) };
  if (mes) {matchFilters.mes = parseInt(mes, 10);}
  if (distrito) {matchFilters['distrito.codigo'] = parseInt(distrito, 10);}

  const results = await Model.aggregate([
    { $match: matchFilters },
    {
      $facet: {
        porGrupoEdad: [
          {
            $group: {
              _id: '$clasificacionEdad.grupoEdad',
              totalPoblacion: { $sum: '$estadisticas.totalPoblacion' },
              totalHombres: { $sum: '$estadisticas.totalHombres' },
              totalMujeres: { $sum: '$estadisticas.totalMujeres' },
              edadMin: { $min: '$edad' },
              edadMax: { $max: '$edad' }
            }
          },
          {
            $project: {
              _id: 0,
              grupoEdad: '$_id',
              poblacion: { total: '$totalPoblacion', hombres: '$totalHombres', mujeres: '$totalMujeres' },
              rangoEdad: { min: '$edadMin', max: '$edadMax' }
            }
          },
          { $sort: { 'rangoEdad.min': 1 } }
        ],
        indicadores: [
          {
            $group: {
              _id: null,
              totalPoblacion: { $sum: '$estadisticas.totalPoblacion' },
              totalEspañoles: { $sum: '$estadisticas.totalEspañoles' },
              totalExtranjeros: { $sum: '$estadisticas.totalExtranjeros' },
              totalHombres: { $sum: '$estadisticas.totalHombres' },
              totalMujeres: { $sum: '$estadisticas.totalMujeres' },
              poblacionProductiva: { $sum: { $cond: ['$clasificacionEdad.esGrupoProductivo', '$estadisticas.totalPoblacion', 0] } },
              terceraEdad: { $sum: { $cond: ['$clasificacionEdad.esTerceraEdad', '$estadisticas.totalPoblacion', 0] } },
              menores: { $sum: { $cond: [{ $lt: ['$edad', 18] }, '$estadisticas.totalPoblacion', 0] } }
            }
          },
          {
            $project: {
              _id: 0,
              totalPoblacion: 1,
              totalEspañoles: 1,
              totalExtranjeros: 1,
              totalHombres: 1,
              totalMujeres: 1,
              // Guardas de division por cero: MongoDB lanza error (no null) al
              // dividir por 0; sin esto, filtrar una seccion sin poblacion
              // productiva / sin mujeres provocaria un 500.
              porcentajeExtranjeros: { $round: [{ $cond: [{ $gt: ['$totalPoblacion', 0] }, { $multiply: [{ $divide: ['$totalExtranjeros', '$totalPoblacion'] }, 100] }, 0] }, 2] },
              ratioGenero: { $round: [{ $cond: [{ $gt: ['$totalMujeres', 0] }, { $divide: ['$totalHombres', '$totalMujeres'] }, 0] }, 3] },
              tasaDependencia: {
                $round: [
                  { $cond: [
                    { $gt: ['$poblacionProductiva', 0] },
                    { $multiply: [{ $divide: [{ $add: ['$menores', '$terceraEdad'] }, '$poblacionProductiva'] }, 100] },
                    0
                  ] },
                  2
                ]
              },
              porcentajePoblacionProductiva: { $round: [{ $cond: [{ $gt: ['$totalPoblacion', 0] }, { $multiply: [{ $divide: ['$poblacionProductiva', '$totalPoblacion'] }, 100] }, 0] }, 2] },
              porcentajeTerceraEdad: { $round: [{ $cond: [{ $gt: ['$totalPoblacion', 0] }, { $multiply: [{ $divide: ['$terceraEdad', '$totalPoblacion'] }, 100] }, 0] }, 2] }
            }
          }
        ]
      }
    }
  ]).option(ESCALAR_AGG);

  return {
    distribuciones: { porGrupoEdad: results[0].porGrupoEdad },
    indicadores: results[0].indicadores[0] || {},
    metadatos: {
      año: parseInt(año, 10),
      mes: mes ? parseInt(mes, 10) : null,
      distrito: distrito ? parseInt(distrito, 10) : null,
      fechaAnalisis: new Date()
    }
  };
};

/**
 * Query builder con cursor support y stats opcionales.
 */
const buscarConOpciones = async function(Model, options) {
  const {
    filters = {},
    sort = { fechaCenso: -1 },
    pagination = { skip: 0, limit: 50 },
    projection = null,
    lean = true,
    includeStats = false,
    cursor = null
  } = options;

  const primarySortField = Object.keys(sort)[0] || 'fechaCenso';
  const sortOrder = sort[primarySortField] === 1 ? 'asc' : 'desc';
  const cursorFilter = cursor ? buildCursorQuery({ cursor, sortField: primarySortField, sortOrder }) : null;
  const combinedFilters = cursorFilter ? { $and: [filters, cursorFilter] } : filters;
  const sortWithTiebreak = { ...sort, _id: sortOrder === 'asc' ? 1 : -1 };

  let query = Model.find(combinedFilters, projection)
    .sort(sortWithTiebreak)
    .limit(pagination.limit)
    .maxTimeMS(MONGODB_TIMEOUTS.AGGREGATE_TIMEOUT_MS);

  if (!cursor) {
    query = query.skip(pagination.skip);
  }
  if (lean) {
    query = query.lean();
  }

  const promises = [
    query.exec(),
    cursor ? Promise.resolve(null) : Model.countDocuments(filters)
  ];

  if (includeStats) {
    promises.push(
      Model.aggregate([
        { $match: filters },
        {
          $group: {
            _id: null,
            totalRegistros: { $sum: 1 },
            poblacionTotal: { $sum: '$estadisticas.totalPoblacion' },
            poblacionEspañola: { $sum: '$estadisticas.totalEspañoles' },
            poblacionExtranjera: { $sum: '$estadisticas.totalExtranjeros' },
            poblacionProductiva: { $sum: { $cond: ['$clasificacionEdad.esGrupoProductivo', '$estadisticas.totalPoblacion', 0] } },
            terceraEdad: { $sum: { $cond: ['$clasificacionEdad.esTerceraEdad', '$estadisticas.totalPoblacion', 0] } },
            distritosUnicos: { $addToSet: '$distrito.codigo' },
            barriosUnicos: { $addToSet: '$barrio.codigo' }
          }
        }
      ]).option(ESCALAR_AGG)
    );
  }

  const results = await Promise.all(promises);

  return {
    data: results[0],
    total: results[1],
    stats: includeStats && results[2] ? results[2][0] : null,
    cursor: cursor
      ? createCursorMeta({
        results: results[0],
        limit: pagination.limit,
        sortField: primarySortField,
        sortOrder
      })
      : null
  };
};

/**
 * Estadisticas por distritos con opcion de incluir barrios.
 */
const obtenerEstadisticasDistritoOptimizadas = async function(Model, options) {
  const { año, mes, incluirBarrios = false } = options;

  const matchCondition = { año: parseInt(año) };
  if (mes) {matchCondition.mes = parseInt(mes);}

  const [districtStatistics, neighborhoodStatistics] = await Promise.all([
    Model.aggregate([
      { $match: matchCondition },
      {
        $group: {
          _id: { distrito: '$distrito.codigo', nombre: '$distrito.descripcion' },
          totalPoblacion: { $sum: '$estadisticas.totalPoblacion' },
          totalEspañoles: { $sum: '$estadisticas.totalEspañoles' },
          totalExtranjeros: { $sum: '$estadisticas.totalExtranjeros' },
          poblacionProductiva: { $sum: { $cond: ['$clasificacionEdad.esGrupoProductivo', '$estadisticas.totalPoblacion', 0] } },
          terceraEdad: { $sum: { $cond: ['$clasificacionEdad.esTerceraEdad', '$estadisticas.totalPoblacion', 0] } },
          totalBarrios: { $addToSet: '$barrio.codigo' }
        }
      },
      {
        $addFields: {
          porcentajePoblacionProductiva: {
            $cond: [{ $gt: ['$totalPoblacion', 0] }, { $multiply: [{ $divide: ['$poblacionProductiva', '$totalPoblacion'] }, 100] }, 0]
          },
          porcentajeTerceraEdad: {
            $cond: [{ $gt: ['$totalPoblacion', 0] }, { $multiply: [{ $divide: ['$terceraEdad', '$totalPoblacion'] }, 100] }, 0]
          },
          porcentajeExtranjeros: {
            $cond: [{ $gt: ['$totalPoblacion', 0] }, { $multiply: [{ $divide: ['$totalExtranjeros', '$totalPoblacion'] }, 100] }, 0]
          },
          numeroBarrios: { $size: '$totalBarrios' }
        }
      },
      {
        $project: {
          distrito: { codigo: '$_id.distrito', nombre: '$_id.nombre' },
          poblacion: {
            total: '$totalPoblacion',
            españoles: '$totalEspañoles',
            extranjeros: '$totalExtranjeros',
            productiva: '$poblacionProductiva',
            terceraEdad: '$terceraEdad'
          },
          porcentajes: {
            extranjeros: { $round: ['$porcentajeExtranjeros', 2] },
            poblacionProductiva: { $round: ['$porcentajePoblacionProductiva', 2] },
            terceraEdad: { $round: ['$porcentajeTerceraEdad', 2] }
          },
          numeroBarrios: '$numeroBarrios',
          densidadPorBarrio: { $round: [{ $divide: ['$totalPoblacion', '$numeroBarrios'] }, 0] }
        }
      },
      { $sort: { 'poblacion.total': -1 } }
    ]).option(ESCALAR_AGG),

    incluirBarrios
      ? Model.aggregate([
        { $match: matchCondition },
        {
          $group: {
            _id: {
              distrito: '$distrito.codigo',
              distritoNombre: '$distrito.descripcion',
              barrio: '$barrio.codigo',
              barrioNombre: '$barrio.descripcion'
            },
            poblacionTotal: { $sum: '$estadisticas.totalPoblacion' },
            poblacionExtranjera: { $sum: '$estadisticas.totalExtranjeros' },
            porcentajeExtranjeros: { $avg: '$estadisticas.porcentajeExtranjeros' }
          }
        },
        {
          $project: {
            distrito: { codigo: '$_id.distrito', nombre: '$_id.distritoNombre' },
            barrio: { codigo: '$_id.barrio', nombre: '$_id.barrioNombre' },
            poblacionTotal: 1,
            poblacionExtranjera: 1,
            porcentajeExtranjeros: { $round: ['$porcentajeExtranjeros', 2] }
          }
        },
        { $sort: { poblacionTotal: -1 } },
        { $limit: AGGREGATION_LIMITS.TOP_RESULTS }
      ]).option(ESCALAR_AGG)
      : Promise.resolve(null)
  ]);

  return { districtStatistics, neighborhoodStatistics };
};

module.exports = {
  obtenerPiramidePoblacionalOptimizada,
  obtenerAnalisisDemograficoOptimizado,
  buscarConOpciones,
  obtenerEstadisticasDistritoOptimizadas
};
