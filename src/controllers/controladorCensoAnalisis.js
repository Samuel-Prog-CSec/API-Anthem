/**
 * Controlador de Censo - Analisis
 *
 * Endpoints analiticos con agregaciones pesadas: estadisticas por
 * distrito, analisis demografico avanzado, evolucion temporal y
 * dashboard. La parte basica de consulta (listados, piramide) vive en
 * controladorCensoDemografia.js.
 */

const Censo = require('../models/Censo');
const {
  parseNumericParams,
  buildResponseMetadata
} = require('../utils/queryHelper');
const { createResponse } = require('../utils/responseHelper');
const {
  HTTP_STATUS,
  AGGREGATION_LIMITS,
  MONGODB_TIMEOUTS,
  DATASET_YEARS,
  CENSUS_DEFAULTS
} = require('../constants');
const asyncHandler = require('../utils/asyncHandler');

/**
 * Devuelve el ultimo mes que tiene documentos para el año indicado.
 * Util para tomar la "foto" mas reciente de poblacion sin duplicar por
 * los 12 snapshots mensuales que trae el dataset Anthem.
 *
 * @param {number} year
 * @returns {Promise<number>} mes 1-12; cae a 12 si no hay datos.
 */
async function obtenerUltimoMesConDatos(year) {
  const [doc] = await Censo.aggregate([
    { $match: { año: year } },
    { $group: { _id: '$mes' } },
    { $sort: { _id: -1 } },
    { $limit: 1 }
  ]).option({ maxTimeMS: MONGODB_TIMEOUTS.AGGREGATE_TIMEOUT_MS });
  return doc?._id || 12;
}

/**
 * Obtener estadisticas por distritos
 * GET /api/v1/censo/distritos/estadisticas
 */
const obtenerEstadisticasDistritos = asyncHandler(async (req, res) => {
  const { incluirBarrios = false } = req.query;

  const { año, mes } = parseNumericParams(
    req.query,
    ['año', 'mes'],
    { año: DATASET_YEARS.DEFAULT_YEAR }
  );

  // Sin mes explicito tomamos el ultimo snapshot: el censo trae 12 fotos
  // mensuales y sumarlas inflaria la poblacion x12 (mismo criterio que el
  // dashboard demografico).
  const mesElegido = mes || await obtenerUltimoMesConDatos(año);

  const { districtStatistics, neighborhoodStatistics } = await Censo.obtenerEstadisticasDistritoOptimizadas({
    año,
    mes: mesElegido,
    incluirBarrios: incluirBarrios === true || incluirBarrios === 'true'
  });

  const rankings = {
    masHabitados: districtStatistics.slice(0, AGGREGATION_LIMITS.TOP_RESULTS),
    masDiversos: [...districtStatistics]
      .sort((a, b) => b.porcentajes.extranjeros - a.porcentajes.extranjeros)
      .slice(0, AGGREGATION_LIMITS.TOP_RESULTS),
    masProductivos: [...districtStatistics]
      .sort((a, b) => b.porcentajes.poblacionProductiva - a.porcentajes.poblacionProductiva)
      .slice(0, AGGREGATION_LIMITS.TOP_RESULTS)
  };

  const responseData = {
    estadisticasDistritos: districtStatistics,
    estadisticasBarrios: neighborhoodStatistics,
    rankings,
    resumen: {
      totalDistritos: districtStatistics.length,
      poblacionTotal: districtStatistics.reduce((acc, d) => acc + d.poblacion.total, 0),
      promedioHabitantesPorDistrito: districtStatistics.length > 0
        ? Math.round(districtStatistics.reduce((acc, d) => acc + d.poblacion.total, 0) / districtStatistics.length)
        : 0
    },
    configuracion: buildResponseMetadata({
      año,
      mes: mesElegido,
      incluirBarrios: incluirBarrios === true || incluirBarrios === 'true'
    })
  };

  res.status(HTTP_STATUS.OK).json(createResponse(responseData, 'Estadisticas de distritos obtenidas exitosamente'));
});

/**
 * Obtener analisis demografico avanzado
 * GET /api/v1/censo/analisis/demografico
 */
const obtenerAnalisisDemografico = asyncHandler(async (req, res) => {
  const { año, mes, distrito } = parseNumericParams(
    req.query,
    ['año', 'mes', 'distrito'],
    { año: DATASET_YEARS.DEFAULT_YEAR }
  );

  // Sin mes explicito tomamos el ultimo snapshot mensual (evita sumar los 12
  // meses, que inflaria la poblacion x12, y ademas acota el escaneo a ~1/12
  // de la coleccion, eliminando el timeout del analisis anual completo).
  const mesElegido = mes || await obtenerUltimoMesConDatos(año);

  const result = await Censo.obtenerAnalisisDemograficoOptimizado({ año, mes: mesElegido, distrito });

  const responseData = {
    distribuciones: result.distribuciones,
    indicadores: result.indicadores,
    interpretacion: {
      tasaDependencia: 'Relacion entre poblacion dependiente (menores + tercera edad) y poblacion productiva',
      porcentajePoblacionProductiva: 'Porcentaje de poblacion en edad laboral (16-65 anos)',
      porcentajeTerceraEdad: 'Porcentaje de poblacion mayor de 65 anos',
      porcentajeExtranjeros: 'Porcentaje de poblacion extranjera sobre el total',
      ratioGenero: 'Relacion hombres/mujeres (valor 1 = equilibrado)'
    },
    metadatos: result.metadatos
  };

  res.status(HTTP_STATUS.OK).json(createResponse(responseData, 'Analisis demografico obtenido exitosamente'));
});

/**
 * Obtener evolucion demografica temporal
 * GET /api/v1/censo/evolucion
 */
const obtenerEvolucionDemografica = asyncHandler(async (req, res) => {
  const { metrica = 'poblacionTotal' } = req.query; // poblacionTotal, extranjeros, productiva

  const { distrito, startYear, endYear } = parseNumericParams(
    req.query,
    ['distrito', 'startYear', 'endYear'],
    { startYear: CENSUS_DEFAULTS.START_YEAR, endYear: CENSUS_DEFAULTS.END_YEAR }
  );

  const matchFilters = {
    año: { $gte: startYear, $lte: endYear }
  };

  if (distrito) {
    matchFilters['distrito.codigo'] = distrito;
  }

  // Metricas segun el parametro seleccionado
  let metricas = {};
  switch (metrica) {
    case 'extranjeros':
      metricas = {
        valor: '$totalExtranjeros',
        porcentaje: {
          $multiply: [
            { $divide: ['$totalExtranjeros', '$totalPoblacion'] },
            100
          ]
        }
      };
      break;
    case 'productiva':
      metricas = {
        valor: '$poblacionProductiva',
        porcentaje: {
          $multiply: [
            { $divide: ['$poblacionProductiva', '$totalPoblacion'] },
            100
          ]
        }
      };
      break;
    case 'poblacionTotal':
    default:
      metricas = {
        valor: '$totalPoblacion',
        porcentaje: 100
      };
      break;
  }

  const evolucion = await Censo.aggregate([
    { $match: matchFilters },
    {
      $group: {
        _id: { año: '$año', mes: '$mes' },
        totalPoblacion: { $sum: '$estadisticas.totalPoblacion' },
        totalExtranjeros: { $sum: '$estadisticas.totalExtranjeros' },
        poblacionProductiva: {
          $sum: {
            $cond: ['$clasificacionEdad.esGrupoProductivo', '$estadisticas.totalPoblacion', 0]
          }
        }
      }
    },
    { $addFields: metricas },
    {
      $project: {
        periodo: { año: '$_id.año', mes: '$_id.mes' },
        valor: { $round: ['$valor', 0] },
        porcentaje: { $round: ['$porcentaje', 2] },
        totalPoblacion: '$totalPoblacion'
      }
    },
    { $sort: { '_id.año': 1, '_id.mes': 1 } }
  ]).option({ allowDiskUse: true, maxTimeMS: MONGODB_TIMEOUTS.AGGREGATE_TIMEOUT_MS });

  let tendencia = null;
  if (evolucion.length > 1) {
    const primerValor = evolucion[0].valor;
    const ultimoValor = evolucion[evolucion.length - 1].valor;

    tendencia = {
      direccion: ultimoValor > primerValor ? 'CRECIENTE' : 'DECRECIENTE',
      variacionAbsoluta: ultimoValor - primerValor,
      variacionPorcentual: primerValor > 0
        ? ((ultimoValor - primerValor) / primerValor * 100).toFixed(2)
        : 0,
      tasa: evolucion.length > 1 && primerValor > 0
        ? (Math.pow(ultimoValor / primerValor, 1 / (evolucion.length - 1)) - 1) * 100
        : 0
    };
  }

  const responseData = {
    evolucion,
    tendencia,
    estadisticasEvolucion: {
      totalPeriodos: evolucion.length,
      valorInicial: evolucion[0]?.valor || 0,
      valorFinal: evolucion[evolucion.length - 1]?.valor || 0,
      valorMaximo: evolucion.length > 0 ? Math.max(...evolucion.map(e => e.valor)) : 0,
      valorMinimo: evolucion.length > 0 ? Math.min(...evolucion.map(e => e.valor)) : 0
    },
    configuracion: buildResponseMetadata({
      distrito,
      periodoAnalisis: { inicio: startYear, fin: endYear },
      metrica
    }, { nullLabel: CENSUS_DEFAULTS.DISTRICT_LABEL })
  };

  res.status(HTTP_STATUS.OK).json(createResponse(responseData, 'Evolucion demografica obtenida exitosamente'));
});

/**
 * Obtener metricas del dashboard demografico
 * GET /api/v1/censo/dashboard
 */
const obtenerDashboardDemografico = asyncHandler(async (req, res) => {
  const { año, distrito, mes } = parseNumericParams(
    req.query,
    ['año', 'distrito', 'mes'],
    { año: DATASET_YEARS.DEFAULT_YEAR }
  );

  // El censo Anthem tiene 12 snapshots mensuales por (edad x seccion). Sumar
  // los 12 meses inflaba la `poblacionTotal` x12 (mostraba 25-39 M en lugar
  // de ~3.3 M). Para una foto poblacional honesta usamos el ultimo mes
  // disponible por defecto (snapshot mas reciente). Si el usuario pasa un
  // `mes` explicito, se respeta para vistas temporales.
  const mesElegido = mes || await obtenerUltimoMesConDatos(año);
  const matchFilters = { año, mes: mesElegido };
  if (distrito) { matchFilters['distrito.codigo'] = distrito; }

  // Coherencia con la tabla: barrio y grupoEdad tambien acotan los KPIs (no solo
  // distrito/mes). barrio se filtra por codigo (entero) y grupoEdad por la
  // clasificacion de edad, con el mismo mapeo que el endpoint de listado.
  const { barrio, grupoEdad } = req.query;
  if (barrio !== undefined && barrio !== '') {
    const barrioCod = parseInt(barrio, 10);
    if (!Number.isNaN(barrioCod)) { matchFilters['barrio.codigo'] = barrioCod; }
  }
  if (grupoEdad !== undefined && grupoEdad !== '') {
    matchFilters['clasificacionEdad.grupoEdad'] = Array.isArray(grupoEdad) ? { $in: grupoEdad } : grupoEdad;
  }

  // Metricas principales agregadas
  const [metricas] = await Censo.aggregate([
    { $match: matchFilters },
    {
      $group: {
        _id: null,
        poblacionTotal: { $sum: '$estadisticas.totalPoblacion' },
        totalHombres: { $sum: '$estadisticas.totalHombres' },
        totalMujeres: { $sum: '$estadisticas.totalMujeres' },
        totalEspañoles: { $sum: '$estadisticas.totalEspañoles' },
        totalExtranjeros: { $sum: '$estadisticas.totalExtranjeros' },
        poblacionProductiva: {
          $sum: {
            $cond: ['$clasificacionEdad.esGrupoProductivo', '$estadisticas.totalPoblacion', 0]
          }
        },
        terceraEdad: {
          $sum: {
            $cond: ['$clasificacionEdad.esTerceraEdad', '$estadisticas.totalPoblacion', 0]
          }
        },
        distritosUnicos: { $addToSet: '$distrito.codigo' },
        barriosUnicos: { $addToSet: '$barrio.codigo' }
      }
    },
    {
      $addFields: {
        ratioGenero: {
          $cond: [
            { $gt: ['$totalMujeres', 0] },
            { $divide: ['$totalHombres', '$totalMujeres'] },
            0
          ]
        },
        porcentajeExtranjeros: {
          $cond: [
            { $gt: ['$poblacionTotal', 0] },
            { $multiply: [{ $divide: ['$totalExtranjeros', '$poblacionTotal'] }, 100] },
            0
          ]
        },
        porcentajePoblacionProductiva: {
          $cond: [
            { $gt: ['$poblacionTotal', 0] },
            { $multiply: [{ $divide: ['$poblacionProductiva', '$poblacionTotal'] }, 100] },
            0
          ]
        }
      }
    }
  ]).option({ allowDiskUse: true, maxTimeMS: MONGODB_TIMEOUTS.AGGREGATE_TIMEOUT_MS });

  // Queries en paralelo para mejor rendimiento
  const [topDistritos, distribucionEdad] = await Promise.all([
    Censo.aggregate([
      { $match: matchFilters },
      {
        $group: {
          _id: {
            codigo: '$distrito.codigo',
            nombre: '$distrito.descripcion'
          },
          poblacionTotal: { $sum: '$estadisticas.totalPoblacion' },
          diversidadCultural: { $avg: '$estadisticas.porcentajeExtranjeros' }
        }
      },
      { $sort: { poblacionTotal: -1 } },
      { $limit: AGGREGATION_LIMITS.PREVIEW }
    ]).option({ allowDiskUse: true, maxTimeMS: MONGODB_TIMEOUTS.AGGREGATE_TIMEOUT_MS }),

    Censo.aggregate([
      { $match: matchFilters },
      {
        $group: {
          _id: '$clasificacionEdad.grupoEdad',
          poblacionTotal: { $sum: '$estadisticas.totalPoblacion' }
        }
      },
      { $sort: { poblacionTotal: -1 } }
    ]).option({ allowDiskUse: true, maxTimeMS: MONGODB_TIMEOUTS.AGGREGATE_TIMEOUT_MS })
  ]);

  const responseData = {
    resumenGeneral: {
      poblacionTotal: metricas?.poblacionTotal || 0,
      totalDistritos: metricas?.distritosUnicos?.length || 0,
      totalBarrios: metricas?.barriosUnicos?.length || 0,
      ratioGenero: metricas?.ratioGenero || 0,
      porcentajeExtranjeros: metricas?.porcentajeExtranjeros || 0,
      porcentajePoblacionProductiva: metricas?.porcentajePoblacionProductiva || 0
    },
    topDistritos,
    distribucionEdad,
    indicadoresClaves: [
      {
        nombre: 'Poblacion Total',
        valor: metricas?.poblacionTotal || 0,
        icono: 'users',
        tipo: 'absoluto'
      },
      {
        nombre: 'Diversidad Cultural',
        valor: (metricas?.porcentajeExtranjeros || 0).toFixed(1) + '%',
        icono: 'globe',
        tipo: 'porcentaje'
      },
      {
        nombre: 'Poblacion Activa',
        valor: (metricas?.porcentajePoblacionProductiva || 0).toFixed(1) + '%',
        icono: 'briefcase',
        tipo: 'porcentaje'
      },
      {
        nombre: 'Equilibrio de Genero',
        valor: (metricas?.ratioGenero || 0).toFixed(2),
        icono: 'users',
        tipo: 'ratio'
      }
    ],
    configuracion: buildResponseMetadata({ año, distrito }, { nullLabel: CENSUS_DEFAULTS.DISTRICT_LABEL })
  };

  res.status(HTTP_STATUS.OK).json(createResponse(responseData, 'Dashboard demografico obtenido exitosamente'));
});

module.exports = {
  obtenerEstadisticasDistritos,
  obtenerAnalisisDemografico,
  obtenerEvolucionDemografica,
  obtenerDashboardDemografico
};
