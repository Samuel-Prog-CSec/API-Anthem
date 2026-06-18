/**
 * Service de Multas
 *
 * Encapsula la logica de agregacion para multas. Los metodos estaticos del
 * modelo `Multa` actuan como thin wrappers que delegan en este service.
 *
 * Convencion: cada funcion recibe `Model` (la clase Mongoose) como primer
 * argumento para mantener pureza y testabilidad.
 */

const { MONGODB_TIMEOUTS, AGGREGATION_LIMITS } = require('../constants');

/**
 * Estadisticas optimizadas con paralelizacion via Promise.all.
 */
const obtenerEstadisticasOptimizadas = async function(Model, options) {
  const { startDate = null, endDate = null, groupBy = 'month', limit = 12, filtrosAdicionales = {} } = options;

  // Filtros de dominio (denunciante, descuento, gravedad) para que la
  // distribucion por calificacion reaccione a todos los filtros del panel y
  // no solo al rango de fechas. Se fusionan ANTES de la fecha; `fecha` siempre
  // prevalece (los filtros adicionales nunca la incluyen).
  const matchStage = { ...filtrosAdicionales };
  if (startDate || endDate) {
    matchStage.fecha = {};
    if (startDate) {matchStage.fecha.$gte = new Date(startDate);}
    if (endDate) {matchStage.fecha.$lte = new Date(endDate);}
  }

  let groupByConfig = {};
  let sortStage = {};

  switch (groupBy) {
    case 'day':
      groupByConfig = {
        fecha: {
          $dateFromParts: {
            year: { $year: '$fecha' },
            month: { $month: '$fecha' },
            day: { $dayOfMonth: '$fecha' }
          }
        }
      };
      sortStage = { '_id.fecha': -1 };
      break;
    case 'year':
      groupByConfig = { año: '$año' };
      sortStage = { '_id.año': -1 };
      break;
    case 'type':
      groupByConfig = { tipoInfraccion: '$metadatos.tipoInfraccion' };
      sortStage = { totalMultas: -1 };
      break;
    case 'location':
      groupByConfig = { lugar: '$lugar' };
      sortStage = { totalMultas: -1 };
      break;
    case 'severity':
      groupByConfig = { calificacion: '$calificacion' };
      sortStage = { totalMultas: -1 };
      break;
    case 'month':
    default:
      groupByConfig = { año: '$año', mes: '$mes' };
      sortStage = { '_id.año': -1, '_id.mes': -1 };
      break;
  }

  const [estadisticas, resumenGeneral] = await Promise.all([
    Model.aggregate([
      { $match: matchStage },
      {
        $group: {
          _id: groupByConfig,
          totalMultas: { $sum: 1 },
          importeTotal: { $sum: '$importeFinal' },
          importePromedio: { $avg: '$importeFinal' },
          puntosTotal: { $sum: '$puntosDetraídos' },
          multasGraves: { $sum: { $cond: ['$metadatos.esInfraccionGrave', 1, 0] } },
          multasConDescuento: { $sum: { $cond: ['$tieneDescuento', 1, 0] } },
          multasVelocidad: { $sum: { $cond: ['$metadatos.esInfraccionVelocidad', 1, 0] } }
        }
      },
      {
        $addFields: {
          porcentajeGraves: { $multiply: [{ $divide: ['$multasGraves', '$totalMultas'] }, 100] },
          porcentajeConDescuento: { $multiply: [{ $divide: ['$multasConDescuento', '$totalMultas'] }, 100] }
        }
      },
      { $sort: sortStage },
      { $limit: parseInt(limit, 10) }
    ]).option({ allowDiskUse: true, maxTimeMS: MONGODB_TIMEOUTS.AGGREGATE_TIMEOUT_MS }),

    Model.aggregate([
      { $match: matchStage },
      {
        $group: {
          _id: null,
          totalMultas: { $sum: 1 },
          importeTotal: { $sum: '$importeFinal' },
          puntosTotal: { $sum: '$puntosDetraídos' },
          fechaInicio: { $min: '$fecha' },
          fechaFin: { $max: '$fecha' },
          lugaresUnicos: { $addToSet: '$lugar' },
          tiposInfraccionUnicos: { $addToSet: '$metadatos.tipoInfraccion' },
          denunciantesUnicos: { $addToSet: '$denunciante' }
        }
      },
      // Devolvemos solo los CONTEOS de distintos, no los arrays completos: el
      // cliente solo usa los totales, asi que serializar miles de lugares o
      // denunciantes desperdicia ancho de banda, expone datos innecesarios y
      // arriesga el limite de 16MB del documento de salida en datasets grandes.
      // El $size se calcula sobre el mismo $addToSet, asi que los conteos son
      // identicos a los previos (resumenGeneral[0].<array>.length).
      {
        $project: {
          _id: 0,
          totalMultas: 1,
          importeTotal: 1,
          puntosTotal: 1,
          fechaInicio: 1,
          fechaFin: 1,
          totalLugaresUnicos: { $size: '$lugaresUnicos' },
          totalTiposInfraccion: { $size: '$tiposInfraccionUnicos' },
          totalDenunciantesUnicos: { $size: '$denunciantesUnicos' }
        }
      }
    ]).option({ allowDiskUse: true, maxTimeMS: MONGODB_TIMEOUTS.AGGREGATE_TIMEOUT_MS })
  ]);

  return {
    estadisticas,
    // resumenGeneral[0] ya viene proyectado con los totales y los 3 conteos de
    // distintos; no quedan arrays crudos que limpiar.
    resumen: resumenGeneral[0] || null
  };
};

/**
 * Ranking de ubicaciones con mas multas.
 */
const obtenerRankingUbicacionesOptimizado = async function(Model, options) {
  const { startDate = null, endDate = null, tipoInfraccion = null, limit = 20, filtrosAdicionales = {} } = options;

  // Filtros de dominio (calificacion, denunciante, descuento) para que el
  // ranking reaccione a los mismos filtros que el resto del panel. La fecha y
  // el tipo de infraccion se gestionan aparte (abajo) y prevalecen.
  const matchFilters = { ...filtrosAdicionales };
  if (startDate || endDate) {
    matchFilters.fecha = {};
    if (startDate) {matchFilters.fecha.$gte = new Date(startDate);}
    if (endDate) {matchFilters.fecha.$lte = new Date(endDate);}
  }
  if (tipoInfraccion) {
    matchFilters['metadatos.tipoInfraccion'] = tipoInfraccion;
  }

  return Model.aggregate([
    { $match: matchFilters },
    {
      $group: {
        _id: '$lugar',
        totalMultas: { $sum: 1 },
        importeTotal: { $sum: '$importeFinal' },
        importePromedio: { $avg: '$importeFinal' },
        puntosTotal: { $sum: '$puntosDetraídos' },
        tiposInfraccion: { $addToSet: '$metadatos.tipoInfraccion' },
        calificacionesMasComunes: { $addToSet: '$calificacion' },
        coordenadas: { $first: '$coordenadas' }
      }
    },
    {
      $addFields: {
        diversidadInfracciones: { $size: '$tiposInfraccion' },
        importePromedioPorMulta: { $round: ['$importePromedio', 2] }
      }
    },
    { $sort: { totalMultas: -1 } },
    { $limit: parseInt(limit, 10) }
  ]).option({ allowDiskUse: true, maxTimeMS: MONGODB_TIMEOUTS.AGGREGATE_TIMEOUT_MS });
};

/**
 * Analisis temporal con calculo de tendencia.
 */
const obtenerAnalisisTemporalOptimizado = async function(Model, options) {
  const { startDate = null, endDate = null, tipoAnalisis = 'monthly' } = options;

  const matchFilters = {};
  if (startDate || endDate) {
    matchFilters.fecha = {};
    if (startDate) {matchFilters.fecha.$gte = new Date(startDate);}
    if (endDate) {matchFilters.fecha.$lte = new Date(endDate);}
  }

  let groupByConfig = {};
  let projectConfig = {};
  let sortField = { totalMultas: -1 };

  switch (tipoAnalisis) {
    case 'hourly':
      groupByConfig = { hora: { $substr: ['$hora', 0, 2] } };
      projectConfig = { hora: '$_id.hora' };
      sortField = { hora: 1 };
      break;
    case 'daily':
      groupByConfig = {
        diaSemana: { $dayOfWeek: '$fecha' },
        fecha: {
          $dateFromParts: {
            year: { $year: '$fecha' },
            month: { $month: '$fecha' },
            day: { $dayOfMonth: '$fecha' }
          }
        }
      };
      projectConfig = { diaSemana: '$_id.diaSemana', fecha: '$_id.fecha' };
      break;
    case 'yearly':
      groupByConfig = { año: '$año' };
      projectConfig = { año: '$_id.año' };
      break;
    case 'monthly':
    default:
      groupByConfig = { año: '$año', mes: '$mes' };
      projectConfig = { año: '$_id.año', mes: '$_id.mes' };
      break;
  }

  const analisis = await Model.aggregate([
    { $match: matchFilters },
    {
      $group: {
        _id: groupByConfig,
        totalMultas: { $sum: 1 },
        importeTotal: { $sum: '$importeFinal' },
        importePromedio: { $avg: '$importeFinal' },
        multasGraves: { $sum: { $cond: ['$metadatos.esInfraccionGrave', 1, 0] } },
        tiposInfraccionMasComunes: { $addToSet: '$metadatos.tipoInfraccion' }
      }
    },
    {
      $project: {
        ...projectConfig,
        totalMultas: 1,
        importeTotal: { $round: ['$importeTotal', 2] },
        importePromedio: { $round: ['$importePromedio', 2] },
        multasGraves: 1,
        porcentajeGraves: {
          $round: [{ $multiply: [{ $divide: ['$multasGraves', '$totalMultas'] }, 100] }, 2]
        },
        diversidadTipos: { $size: '$tiposInfraccionMasComunes' }
      }
    },
    { $sort: sortField }
  ]).option({ allowDiskUse: true, maxTimeMS: MONGODB_TIMEOUTS.AGGREGATE_TIMEOUT_MS });

  let tendencia = null;
  if (analisis.length > 1) {
    const valores = analisis.map(item => item.totalMultas);
    const primerValor = valores[0];
    const ultimoValor = valores[valores.length - 1];
    tendencia = {
      direccion: ultimoValor > primerValor ? 'CRECIENTE' : 'DECRECIENTE',
      variacionAbsoluta: ultimoValor - primerValor,
      variacionPorcentual: primerValor > 0
        ? ((ultimoValor - primerValor) / primerValor * 100).toFixed(2)
        : 0
    };
  }

  return { analisis, tendencia };
};

/**
 * Metricas agregadas del dashboard (3 pipelines en paralelo con allSettled).
 */
const obtenerMetricasPanel = async function(Model, fechaInicio, fechaFin, options = {}) {
  const topLimit = options.topInfraccionesLimit ?? AGGREGATION_LIMITS.PREVIEW;
  const maxTimeMS = options.maxTimeMS ?? MONGODB_TIMEOUTS.AGGREGATE_TIMEOUT_MS;
  // Filtros de dominio adicionales (calificacion, denunciante, tipo, descuento)
  // para que los KPIs reaccionen a todos los filtros del panel, no solo al
  // rango de fechas. Se fusionan ANTES de la fecha; `fecha` siempre prevalece
  // (los filtros adicionales nunca incluyen `fecha`, la gestiona el caller).
  const filtrosAdicionales = options.filtrosAdicionales || {};
  const matchPeriodo = { ...filtrosAdicionales, fecha: { $gte: fechaInicio, $lte: fechaFin } };

  const pipelineGenerales = [
    { $match: matchPeriodo },
    {
      $group: {
        _id: null,
        totalMultas: { $sum: 1 },
        importeTotal: { $sum: '$importeFinal' },
        puntosTotal: { $sum: '$puntosDetraídos' },
        multasGraves: { $sum: { $cond: ['$metadatos.esInfraccionGrave', 1, 0] } },
        multasConDescuento: { $sum: { $cond: ['$tieneDescuento', 1, 0] } },
        multasVelocidad: { $sum: { $cond: ['$metadatos.esInfraccionVelocidad', 1, 0] } }
      }
    }
  ];

  const pipelineTopInfracciones = [
    { $match: matchPeriodo },
    {
      $group: {
        _id: '$metadatos.tipoInfraccion',
        cantidad: { $sum: 1 },
        importePromedio: { $avg: '$importeFinal' }
      }
    },
    { $sort: { cantidad: -1 } },
    { $limit: topLimit }
  ];

  const pipelineEvolucionDiaria = [
    { $match: matchPeriodo },
    {
      $group: {
        _id: {
          fecha: {
            $dateFromParts: {
              year: { $year: '$fecha' },
              month: { $month: '$fecha' },
              day: { $dayOfMonth: '$fecha' }
            }
          }
        },
        totalMultas: { $sum: 1 },
        importeTotal: { $sum: '$importeFinal' }
      }
    },
    { $sort: { '_id.fecha': 1 } }
  ];

  // allSettled: una agregacion lenta o fallida no debe descartar el resto del dashboard.
  // Mongoose 9 elimino Aggregate.prototype.maxTimeMS(); ahora se pasa via .option({maxTimeMS}).
  const [resGenerales, resTop, resEvolucion] = await Promise.allSettled([
    Model.aggregate(pipelineGenerales).option({ maxTimeMS }).exec(),
    Model.aggregate(pipelineTopInfracciones).option({ maxTimeMS }).exec(),
    Model.aggregate(pipelineEvolucionDiaria).option({ maxTimeMS }).exec()
  ]);

  return {
    metricasGenerales: resGenerales.status === 'fulfilled' ? (resGenerales.value[0] || null) : null,
    topInfracciones: resTop.status === 'fulfilled' ? resTop.value : [],
    evolucionDiaria: resEvolucion.status === 'fulfilled' ? resEvolucion.value : []
  };
};

module.exports = {
  obtenerEstadisticasOptimizadas,
  obtenerRankingUbicacionesOptimizado,
  obtenerAnalisisTemporalOptimizado,
  obtenerMetricasPanel
};
