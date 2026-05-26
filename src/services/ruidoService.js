/**
 * Service de Ruido
 *
 * Encapsula la logica de agregacion, ranking y analisis normativo de
 * contaminacion acustica. Los metodos estaticos del modelo `Ruido` actuan
 * como thin wrappers que delegan en este service (ver `models/Ruido.js`).
 *
 * Patron arquitectonico:
 *   models/<Dominio>.js → schema + indexes + hooks + statics wrapper (1 linea c/u)
 *   services/<dominio>Service.js → implementacion real de las agregaciones
 *
 * Ventajas:
 *   - Modelo enfocado en definicion de schema y reglas Mongoose
 *   - Service enfocado en logica de negocio compleja
 *   - Controllers siguen llamando `Model.method()` sin cambios
 *
 * Convencion: cada funcion recibe `Model` (la clase del modelo Mongoose)
 * como primer argumento para mantener pureza y testabilidad.
 */

const {
  NOISE_LIMITS,
  AGGREGATION_LIMITS,
  MONGODB_TIMEOUTS
} = require('../constants');

const LIMITES_NORMATIVOS = NOISE_LIMITS;

/**
 * Obtener estadisticas agregadas con cumplimiento normativo.
 *
 * @param {mongoose.Model} Model - Modelo Mongoose `Ruido`.
 * @param {Object} filters - Filtros de fecha y estacion.
 * @param {String} [groupBy='station'] - Agrupacion: 'station', 'month', 'year'.
 * @returns {Promise<{estadisticas:Array, resumen:Object|null}>}
 */
const obtenerEstadisticasOptimizadas = async function(Model, filters, groupBy = 'station') {
  const matchStage = { ...filters, 'dataQuality.hasValidData': true };

  const groupByConfig = {
    station: { nmt: '$nmt', nombre: '$nombre' },
    month: { año: '$año', mes: '$mes' },
    year: { año: '$año' }
  }[groupBy] || { nmt: '$nmt', nombre: '$nombre' };

  const sortStage = {
    station: { '_id.nmt': 1 },
    month: { '_id.año': -1, '_id.mes': -1 },
    year: { '_id.año': -1 }
  }[groupBy] || { '_id.nmt': 1 };

  const { DIURNO, VESPERTINO, NOCTURNO } = LIMITES_NORMATIVOS;

  const [estadisticas, resumenGeneral] = await Promise.all([
    Model.aggregate([
      { $match: matchStage },
      {
        $group: {
          _id: groupByConfig,
          promedioDiurno: { $avg: '$nivelDiurno' },
          promedioVespertino: { $avg: '$nivelVespertino' },
          promedioNocturno: { $avg: '$nivelNocturno' },
          promedioLaeq24: { $avg: '$laeq24' },
          maximoDiurno: { $max: '$nivelDiurno' },
          maximoVespertino: { $max: '$nivelVespertino' },
          maximoNocturno: { $max: '$nivelNocturno' },
          maximoLaeq24: { $max: '$laeq24' },
          minimoDiurno: { $min: '$nivelDiurno' },
          minimoVespertino: { $min: '$nivelVespertino' },
          minimoNocturno: { $min: '$nivelNocturno' },
          minimoLaeq24: { $min: '$laeq24' },
          totalMediciones: { $sum: 1 },
          incumplimientosDiurnos: { $sum: { $cond: [{ $gt: ['$nivelDiurno', DIURNO] }, 1, 0] } },
          incumplimientosVespertinos: { $sum: { $cond: [{ $gt: ['$nivelVespertino', VESPERTINO] }, 1, 0] } },
          incumplimientosNocturnos: { $sum: { $cond: [{ $gt: ['$nivelNocturno', NOCTURNO] }, 1, 0] } }
        }
      },
      {
        $addFields: {
          cumplimientoDiurno: {
            $multiply: [
              { $divide: [{ $subtract: ['$totalMediciones', '$incumplimientosDiurnos'] }, '$totalMediciones'] },
              100
            ]
          },
          cumplimientoVespertino: {
            $multiply: [
              { $divide: [{ $subtract: ['$totalMediciones', '$incumplimientosVespertinos'] }, '$totalMediciones'] },
              100
            ]
          },
          cumplimientoNocturno: {
            $multiply: [
              { $divide: [{ $subtract: ['$totalMediciones', '$incumplimientosNocturnos'] }, '$totalMediciones'] },
              100
            ]
          }
        }
      },
      { $sort: sortStage },
      { $limit: AGGREGATION_LIMITS.SMALL }
    ]).option({ allowDiskUse: true, maxTimeMS: MONGODB_TIMEOUTS.AGGREGATE_TIMEOUT_MS }),

    Model.aggregate([
      { $match: matchStage },
      {
        $group: {
          _id: null,
          totalRegistros: { $sum: 1 },
          estacionesUnicas: { $addToSet: '$nmt' },
          promedioGeneralLaeq24: { $avg: '$laeq24' },
          fechaInicio: { $min: '$fecha' },
          fechaFin: { $max: '$fecha' },
          totalIncumplimientos: {
            $sum: {
              $add: [
                { $cond: [{ $gt: ['$nivelDiurno', DIURNO] }, 1, 0] },
                { $cond: [{ $gt: ['$nivelVespertino', VESPERTINO] }, 1, 0] },
                { $cond: [{ $gt: ['$nivelNocturno', NOCTURNO] }, 1, 0] }
              ]
            }
          }
        }
      }
    ]).option({ allowDiskUse: true, maxTimeMS: MONGODB_TIMEOUTS.AGGREGATE_TIMEOUT_MS })
  ]);

  const resumen = resumenGeneral[0]
    ? {
      ...resumenGeneral[0],
      totalEstaciones: resumenGeneral[0].estacionesUnicas.length,
      porcentajeCumplimientoGeneral: resumenGeneral[0].totalRegistros > 0
        ? ((resumenGeneral[0].totalRegistros * 3 - resumenGeneral[0].totalIncumplimientos) / (resumenGeneral[0].totalRegistros * 3)) * 100
        : 0
    }
    : null;

  return { estadisticas, resumen };
};

/**
 * Obtener ranking de estaciones por nivel de ruido.
 */
const obtenerRankingOptimizado = function(Model, filters, sortBy = 'laeq24', limit = 20) {
  const matchStage = { ...filters, 'dataQuality.hasValidData': true };

  const sortField = {
    laeq24: '$promedioLaeq24',
    diurno: '$promedioDiurno',
    vespertino: '$promedioVespertino',
    nocturno: '$promedioNocturno'
  }[sortBy] || '$promedioLaeq24';

  const pipeline = [
    { $match: matchStage },
    {
      $group: {
        _id: { nmt: '$nmt', nombre: '$nombre' },
        promedioLaeq24: { $avg: '$laeq24' },
        promedioDiurno: { $avg: '$nivelDiurno' },
        promedioVespertino: { $avg: '$nivelVespertino' },
        promedioNocturno: { $avg: '$nivelNocturno' },
        maximoLaeq24: { $max: '$laeq24' },
        totalMediciones: { $sum: 1 },
        fechaInicio: { $min: '$fecha' },
        fechaFin: { $max: '$fecha' }
      }
    },
    { $sort: { [sortField.substring(1)]: -1 } },
    { $limit: limit }
  ];

  return Model.aggregate(pipeline).option({ allowDiskUse: true, maxTimeMS: MONGODB_TIMEOUTS.AGGREGATE_TIMEOUT_MS });
};

/**
 * Calcular cumplimiento normativo para un registro puntual.
 */
const calcularCumplimientoNormativo = function(niveles) {
  const { DIURNO, VESPERTINO, NOCTURNO } = LIMITES_NORMATIVOS;
  return {
    diurno: niveles.nivelDiurno <= DIURNO,
    vespertino: niveles.nivelVespertino <= VESPERTINO,
    nocturno: niveles.nivelNocturno <= NOCTURNO,
    global:
      niveles.nivelDiurno <= DIURNO &&
      niveles.nivelVespertino <= VESPERTINO &&
      niveles.nivelNocturno <= NOCTURNO
  };
};

/**
 * Comparacion entre estaciones de monitorizacion.
 */
const obtenerComparativaEstaciones = function(Model, options) {
  const { stations, startDate, endDate, metric = 'laeq24' } = options;

  if (!stations || !Array.isArray(stations) || stations.length === 0) {
    throw new Error('Se requiere un array de estaciones para comparar');
  }
  if (!startDate || !endDate) {
    throw new Error('Se requieren fechas de inicio y fin');
  }

  const metricField = `$${metric}`;
  const matchStage = {
    nmt: { $in: stations },
    fecha: { $gte: startDate, $lte: endDate },
    [metric]: { $ne: null }
  };

  const pipeline = [
    { $match: matchStage },
    {
      $group: {
        _id: { nmt: '$nmt', nombre: '$nombre' },
        promedioNivel: { $avg: metricField },
        minimoNivel: { $min: metricField },
        maximoNivel: { $max: metricField },
        desviacionEstandar: { $stdDevPop: metricField },
        totalMediciones: { $sum: 1 },
        medicionesValidas: {
          $sum: { $cond: [{ $ne: [metricField, null] }, 1, 0] }
        }
      }
    },
    {
      $project: {
        nmt: '$_id.nmt',
        nombre: '$_id.nombre',
        promedioNivel: { $round: ['$promedioNivel', 2] },
        minimoNivel: { $round: ['$minimoNivel', 2] },
        maximoNivel: { $round: ['$maximoNivel', 2] },
        desviacionEstandar: { $round: ['$desviacionEstandar', 2] },
        totalMediciones: 1,
        medicionesValidas: 1,
        rangoVariacion: { $round: [{ $subtract: ['$maximoNivel', '$minimoNivel'] }, 2] },
        calidadDatos: {
          $round: [
            { $multiply: [{ $divide: ['$medicionesValidas', '$totalMediciones'] }, 100] },
            2
          ]
        },
        _id: 0
      }
    },
    { $sort: { promedioNivel: -1 } }
  ];

  return Model.aggregate(pipeline).option({ allowDiskUse: true, maxTimeMS: MONGODB_TIMEOUTS.AGGREGATE_TIMEOUT_MS });
};

/**
 * Analisis de tendencias temporales de ruido.
 */
const obtenerTendenciasTemporales = function(Model, options) {
  const { nmt, startDate, endDate, groupBy = 'month', metric = 'laeq24' } = options;

  if (!startDate || !endDate) {
    throw new Error('Se requieren fechas de inicio y fin');
  }

  const matchStage = {
    fecha: { $gte: startDate, $lte: endDate },
    [metric]: { $ne: null }
  };
  if (nmt) {
    matchStage.nmt = nmt;
  }

  const metricField = `$${metric}`;

  let groupId;
  let sortField;
  switch (groupBy) {
    case 'day':
      groupId = { año: '$año', mes: '$mes', dia: { $dayOfMonth: '$fecha' } };
      sortField = { 'periodo.año': 1, 'periodo.mes': 1, 'periodo.dia': 1 };
      break;
    case 'year':
      groupId = { año: '$año' };
      sortField = { 'periodo.año': 1 };
      break;
    case 'month':
    default:
      groupId = { año: '$año', mes: '$mes' };
      sortField = { 'periodo.año': 1, 'periodo.mes': 1 };
      break;
  }

  const pipeline = [
    { $match: matchStage },
    {
      $group: {
        _id: groupId,
        promedioNivel: { $avg: metricField },
        minimoNivel: { $min: metricField },
        maximoNivel: { $max: metricField },
        desviacionEstandar: { $stdDevPop: metricField },
        totalMediciones: { $sum: 1 },
        estacionesUnicas: { $addToSet: '$nmt' }
      }
    },
    {
      $project: {
        _id: 0,
        periodo: '$_id',
        promedioNivel: { $round: ['$promedioNivel', 2] },
        minimoNivel: { $round: ['$minimoNivel', 2] },
        maximoNivel: { $round: ['$maximoNivel', 2] },
        desviacionEstandar: { $round: ['$desviacionEstandar', 2] },
        rangoVariacion: { $round: [{ $subtract: ['$maximoNivel', '$minimoNivel'] }, 2] },
        totalMediciones: 1,
        totalEstaciones: { $size: '$estacionesUnicas' }
      }
    },
    { $sort: sortField }
  ];

  return Model.aggregate(pipeline).option({ allowDiskUse: true, maxTimeMS: MONGODB_TIMEOUTS.AGGREGATE_TIMEOUT_MS });
};

/**
 * Analisis de cumplimiento normativo por zona.
 */
const obtenerAnalisisCumplimientoPorZona = async function(Model, options) {
  const { startDate, endDate, stations } = options;

  if (!startDate || !endDate) {
    throw new Error('Se requieren fechas de inicio y fin');
  }

  const { DIURNO, VESPERTINO, NOCTURNO } = LIMITES_NORMATIVOS;
  const matchStage = { fecha: { $gte: startDate, $lte: endDate } };
  if (stations && Array.isArray(stations) && stations.length > 0) {
    matchStage.nmt = { $in: stations };
  }

  const buildComplianceCondition = (field, limit) => ({
    cumple: {
      $sum: { $cond: [{ $and: [{ $ne: [`$${field}`, null] }, { $lte: [`$${field}`, limit] }] }, 1, 0] }
    },
    incumple: {
      $sum: { $cond: [{ $and: [{ $ne: [`$${field}`, null] }, { $gt: [`$${field}`, limit] }] }, 1, 0] }
    },
    promedio: { $avg: `$${field}` },
    maximo: { $max: `$${field}` }
  });

  const estaciones = await Model.aggregate([
    { $match: matchStage },
    {
      $group: {
        _id: { nmt: '$nmt', nombre: '$nombre' },
        totalMediciones: { $sum: 1 },
        ...buildComplianceCondition('nivelDiurno', DIURNO),
        ...buildComplianceCondition('nivelVespertino', VESPERTINO),
        ...buildComplianceCondition('nivelNocturno', NOCTURNO),
        promedioLaeq24: { $avg: '$laeq24' }
      }
    },
    {
      $project: {
        _id: 0,
        nmt: '$_id.nmt',
        nombre: '$_id.nombre',
        totalMediciones: 1,
        cumplimiento: {
          diurno: {
            cumple: '$cumple',
            incumple: '$incumple',
            porcentaje: {
              $round: [{
                $multiply: [{ $divide: ['$cumple', { $add: ['$cumple', '$incumple'] }] }, 100]
              }, 2]
            },
            limite: DIURNO,
            promedio: { $round: ['$promedio', 2] },
            maximo: { $round: ['$maximo', 2] }
          }
        },
        promedioGeneralLaeq24: { $round: ['$promedioLaeq24', 2] }
      }
    }
  ]).option({ allowDiskUse: true, maxTimeMS: MONGODB_TIMEOUTS.AGGREGATE_TIMEOUT_MS });

  const resumenGlobal = {
    totalEstaciones: estaciones.length,
    cumplimientoPromedioGlobal: estaciones.length > 0
      ? Math.round(estaciones.reduce((sum, e) => sum + (e.cumplimiento?.diurno?.porcentaje || 0), 0) / estaciones.length * 100) / 100
      : 0,
    periodo: { inicio: startDate, fin: endDate },
    limites: { diurno: DIURNO, vespertino: VESPERTINO, nocturno: NOCTURNO }
  };

  return { estaciones, resumen: resumenGlobal };
};

module.exports = {
  LIMITES_NORMATIVOS,
  obtenerEstadisticasOptimizadas,
  obtenerRankingOptimizado,
  calcularCumplimientoNormativo,
  obtenerComparativaEstaciones,
  obtenerTendenciasTemporales,
  obtenerAnalisisCumplimientoPorZona
};
