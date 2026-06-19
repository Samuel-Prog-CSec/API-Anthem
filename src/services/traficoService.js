/**
 * Service de Trafico
 *
 * Encapsula la logica de agregacion sobre trafico. La coleccion cruda
 * `traffic_measurements` tiene ~131M docs (mediciones cada ~15 min por punto),
 * por lo que agregarla en cada peticion superaba el maxTimeMS con rangos de mas
 * de unos pocos dias.
 *
 * SOLUCION: las agregaciones de estadisticas/congestion/mapa/historico
 * (dia/semana/mes) leen del ROLLUP DIARIO `traffic_daily` (~1.5M docs,
 * 1 doc por punto y dia, ver `scripts/buildTrafficDaily.js`). El rollup guarda
 * SUMAS y CONTEOS, de modo que las medias se recalculan EXACTAS para cualquier
 * rango/dimension (promediar promedios seria incorrecto). El historico HORARIO
 * sigue leyendo de la coleccion cruda (el rollup es diario) con rango acotado.
 *
 * Los metodos estaticos del modelo `Traffic` actuan como thin wrappers.
 */

const mongoose = require('mongoose');
const {
  CONGESTION_LEVELS,
  DATA_QUALITY_LEVELS,
  MONGODB_TIMEOUTS
} = require('../constants');

const COLECCION_DAILY = 'traffic_daily';
const ESCALAR = { allowDiskUse: true, maxTimeMS: MONGODB_TIMEOUTS.AGGREGATE_TIMEOUT_MS };

/**
 * Devuelve la coleccion nativa del rollup diario.
 * @param {mongoose.Model} Model - Modelo Traffic (para acceder a su conexion)
 */
const coleccionDaily = (Model) => {
  const conn = (Model && Model.db) || mongoose.connection;
  return conn.db.collection(COLECCION_DAILY);
};

/**
 * Acumuladores base sobre el rollup diario (suman las sumas/conteos del dia).
 * Permiten recalcular medias exactas tras re-agrupar por cualquier dimension.
 */
const acumuladoresDaily = {
  totalMediciones: { $sum: '$total' },
  sumIntensidad: { $sum: '$sumI' },
  cntIntensidad: { $sum: '$cntI' },
  intensidadMaxima: { $max: '$maxI' },
  intensidadMinima: { $min: '$minI' },
  sumOcupacion: { $sum: '$sumO' },
  cntOcupacion: { $sum: '$cntO' },
  sumCarga: { $sum: '$sumC' },
  cntCarga: { $sum: '$cntC' },
  sumVelM30: { $sum: '$sumVelM30' },
  cntVelM30: { $sum: '$cntVelM30' },
  medicionesFluidas: { $sum: '$fluidas' },
  medicionesDensas: { $sum: '$densas' },
  medicionesCongestionadas: { $sum: '$congestionadas' },
  medicionesColapsadas: { $sum: '$colapsadas' },
  medicionesConfiables: { $sum: '$confiables' }
};

const mediaExacta = (suma, conteo) => ({ $cond: [{ $gt: [conteo, 0] }, { $divide: [suma, conteo] }, null] });
const porcentaje = (parte, total) => ({
  $cond: [{ $gt: [total, 0] }, { $multiply: [{ $divide: [parte, total] }, 100] }, 0]
});

/**
 * Analisis de congestion por distrito o tipoElemento (lee del rollup diario).
 */
const obtenerAnalisisCongestionOptimizado = async function (Model, filters = {}, groupBy = 'distrito') {
  const daily = coleccionDaily(Model);

  const etapasFinales = [
    {
      $addFields: {
        zona: '$_id',
        intensidadPromedio: mediaExacta('$sumIntensidad', '$cntIntensidad'),
        ocupacionPromedio: mediaExacta('$sumOcupacion', '$cntOcupacion'),
        porcentajeCongestion: porcentaje({ $add: ['$medicionesCongestionadas', '$medicionesColapsadas'] }, '$totalMediciones'),
        porcentajeFluido: porcentaje('$medicionesFluidas', '$totalMediciones')
      }
    },
    {
      $project: {
        _id: 0,
        zona: 1,
        totalMediciones: 1,
        intensidadPromedio: { $round: ['$intensidadPromedio', 2] },
        ocupacionPromedio: { $round: ['$ocupacionPromedio', 2] },
        distribucion: {
          fluidas: '$medicionesFluidas',
          densas: '$medicionesDensas',
          congestionadas: '$medicionesCongestionadas',
          colapsadas: '$medicionesColapsadas'
        },
        porcentajeCongestion: { $round: ['$porcentajeCongestion', 2] },
        porcentajeFluido: { $round: ['$porcentajeFluido', 2] }
      }
    },
    { $sort: { porcentajeCongestion: -1 } }
  ];

  if (groupBy !== 'distrito') {
    return daily.aggregate([
      { $match: filters },
      { $group: { _id: '$tipoElemento', ...acumuladoresDaily } },
      ...etapasFinales
    ], ESCALAR).toArray();
  }

  // Modo distrito: reducir a nivel de punto, lookup indexado a locations y
  // re-agrupar por distrito (igual patron que antes, pero sobre el rollup).
  const sumarAcumuladores = Object.fromEntries(
    Object.keys(acumuladoresDaily).map((clave) => [clave, { $sum: `$${clave}` }])
  );

  return daily.aggregate([
    { $match: filters },
    { $group: { _id: '$puntoMedidaId', ...acumuladoresDaily } },
    {
      $lookup: {
        from: 'locations',
        localField: '_id',
        foreignField: 'id_punto',
        as: 'ubicacion',
        pipeline: [{ $project: { distrito: 1, _id: 0 } }]
      }
    },
    { $addFields: { distrito: { $arrayElemAt: ['$ubicacion.distrito', 0] } } },
    // Descartar los puntos de medida sin ubicacion en locations (id_punto sin
    // match en el $lookup): sin este filtro caian en un grupo _id:null que el
    // endpoint emitia (y que ademas salia con la intensidad media mas alta),
    // obligando al cliente a filtrarlo. Asi el contrato es correcto por si solo.
    { $match: { distrito: { $ne: null } } },
    { $group: { _id: '$distrito', ...sumarAcumuladores } },
    ...etapasFinales
  ], ESCALAR).toArray();
};

/**
 * Historico horario sobre datos CRUDOS (el rollup es diario). Rango acotado
 * por el controlador. Mantiene fidelidad maxima a nivel hora.
 */
const historicoHorarioRaw = function (Model, filters) {
  return Model.aggregate([
    { $match: filters },
    {
      $group: {
        _id: { año: '$año', mes: '$mes', dia: '$dia', hora: '$hora' },
        totalMediciones: { $sum: 1 },
        intensidadPromedio: { $avg: { $cond: [{ $gte: ['$metricas.intensidad', 0] }, '$metricas.intensidad', null] } },
        intensidadMaxima: { $max: { $cond: [{ $gte: ['$metricas.intensidad', 0] }, '$metricas.intensidad', null] } },
        intensidadMinima: { $min: { $cond: [{ $gte: ['$metricas.intensidad', 0] }, '$metricas.intensidad', null] } },
        ocupacionPromedio: { $avg: { $cond: [{ $gte: ['$metricas.ocupacion', 0] }, '$metricas.ocupacion', null] } },
        ocupacionMaxima: { $max: { $cond: [{ $gte: ['$metricas.ocupacion', 0] }, '$metricas.ocupacion', null] } },
        cargaPromedio: { $avg: { $cond: [{ $gte: ['$metricas.carga', 0] }, '$metricas.carga', null] } },
        // Solo los puntos M30 miden velocidad; los URB no la miden y el dataset
        // (y parte de la data viva) la trae como 0. Incluir esos 0 deprimia el
        // promedio. Se restringe el $avg a M30 (igual que buildTrafficDaily),
        // robusto aunque algun URB traiga 0 en vez de null.
        velocidadPromedio: { $avg: { $cond: [{ $and: [{ $eq: ['$tipoElemento', 'M30'] }, { $gte: ['$metricas.velocidadMedia', 0] }] }, '$metricas.velocidadMedia', null] } },
        medicionesCongestionadas: { $sum: { $cond: [{ $in: ['$analisis.nivelCongestion', [CONGESTION_LEVELS.CONGESTIONADO, CONGESTION_LEVELS.COLAPSADO]] }, 1, 0] } },
        medicionesConfiables: { $sum: { $cond: [{ $in: ['$calidadDatos.calidadGeneral', [DATA_QUALITY_LEVELS.ALTA, DATA_QUALITY_LEVELS.MEDIA]] }, 1, 0] } }
      }
    },
    { $addFields: { periodo: '$_id' } },
    {
      $project: {
        _id: 0,
        periodo: 1,
        totalMediciones: 1,
        metricas: {
          intensidad: { promedio: { $round: ['$intensidadPromedio', 2] }, maxima: { $round: ['$intensidadMaxima', 2] }, minima: { $round: ['$intensidadMinima', 2] } },
          ocupacion: { promedio: { $round: ['$ocupacionPromedio', 2] }, maxima: { $round: ['$ocupacionMaxima', 2] } },
          carga: { $round: ['$cargaPromedio', 2] },
          velocidad: { $round: ['$velocidadPromedio', 2] }
        },
        porcentajeCongestion: { $round: [porcentaje('$medicionesCongestionadas', '$totalMediciones'), 2] },
        confiabilidad: { $round: [porcentaje('$medicionesConfiables', '$totalMediciones'), 2] }
      }
    },
    { $sort: { 'periodo.año': 1, 'periodo.mes': 1, 'periodo.dia': 1, 'periodo.hora': 1 } }
  ]).option(ESCALAR);
};

/**
 * Datos historicos agregados por periodo. hour -> crudo; day/week/month -> rollup.
 */
const obtenerDatosHistoricosOptimizado = async function (Model, filters = {}, aggregation = 'hour') {
  if (aggregation === 'hour') {
    return historicoHorarioRaw(Model, filters);
  }

  const daily = coleccionDaily(Model);
  let dateGrouping;
  let sortFields;
  switch (aggregation) {
    case 'day':
      dateGrouping = { año: '$año', mes: '$mes', dia: '$dia' };
      sortFields = { 'periodo.año': 1, 'periodo.mes': 1, 'periodo.dia': 1 };
      break;
    case 'week':
      dateGrouping = { año: '$año', semana: { $week: '$fecha' } };
      sortFields = { 'periodo.año': 1, 'periodo.semana': 1 };
      break;
    case 'month':
      dateGrouping = { año: '$año', mes: '$mes' };
      sortFields = { 'periodo.año': 1, 'periodo.mes': 1 };
      break;
    default:
      dateGrouping = { año: '$año', mes: '$mes', dia: '$dia' };
      sortFields = { 'periodo.año': 1, 'periodo.mes': 1, 'periodo.dia': 1 };
  }

  return daily.aggregate([
    { $match: filters },
    { $group: { _id: dateGrouping, ...acumuladoresDaily } },
    {
      $addFields: {
        periodo: '$_id',
        intensidadPromedio: mediaExacta('$sumIntensidad', '$cntIntensidad'),
        ocupacionPromedio: mediaExacta('$sumOcupacion', '$cntOcupacion'),
        cargaPromedio: mediaExacta('$sumCarga', '$cntCarga'),
        velocidadPromedio: mediaExacta('$sumVelM30', '$cntVelM30'),
        pctCongestion: porcentaje({ $add: ['$medicionesCongestionadas', '$medicionesColapsadas'] }, '$totalMediciones'),
        pctConfiable: porcentaje('$medicionesConfiables', '$totalMediciones')
      }
    },
    {
      $project: {
        _id: 0,
        periodo: 1,
        totalMediciones: 1,
        metricas: {
          intensidad: { promedio: { $round: ['$intensidadPromedio', 2] }, maxima: { $round: ['$intensidadMaxima', 2] }, minima: { $round: ['$intensidadMinima', 2] } },
          // El rollup diario no guarda el maximo de ocupacion (solo suma/conteo
          // para la media exacta); el maximo solo esta disponible en el
          // historico 'hour'. Se omite a nivel dia/semana/mes.
          ocupacion: { promedio: { $round: ['$ocupacionPromedio', 2] }, maxima: null },
          carga: { $round: ['$cargaPromedio', 2] },
          velocidad: { $round: ['$velocidadPromedio', 2] }
        },
        porcentajeCongestion: { $round: ['$pctCongestion', 2] },
        confiabilidad: { $round: ['$pctConfiable', 2] }
      }
    },
    { $sort: sortFields }
  ], ESCALAR).toArray();
};

/**
 * Estadisticas generales paralelizadas con $facet sobre el rollup diario.
 * Mantiene la MISMA forma de salida que la version cruda anterior.
 */
const obtenerEstadisticasTraficoOptimizadas = async function (Model, filters = {}) {
  const daily = coleccionDaily(Model);

  const facetGeneral = [
    { $group: { _id: null, ...acumuladoresDaily } },
    {
      $project: {
        _id: 0,
        totalMediciones: 1,
        intensidadPromedio: { $round: [mediaExacta('$sumIntensidad', '$cntIntensidad'), 2] },
        intensidadMaxima: { $round: ['$intensidadMaxima', 2] },
        ocupacionPromedio: { $round: [mediaExacta('$sumOcupacion', '$cntOcupacion'), 2] },
        cargaPromedio: { $round: [mediaExacta('$sumCarga', '$cntCarga'), 2] },
        velocidadPromedio: { $round: [mediaExacta('$sumVelM30', '$cntVelM30'), 2] },
        porcentajeConfiabilidad: { $round: [porcentaje('$medicionesConfiables', '$totalMediciones'), 2] },
        porcentajeCongestion: { $round: [porcentaje({ $add: ['$medicionesCongestionadas', '$medicionesColapsadas'] }, '$totalMediciones'), 2] }
      }
    }
  ];

  const facetTipos = [
    { $group: { _id: '$tipoElemento', cantidad: { $sum: '$total' }, sumI: { $sum: '$sumI' }, cntI: { $sum: '$cntI' } } },
    { $project: { _id: 0, tipo: '$_id', cantidad: 1, intensidadPromedio: { $round: [mediaExacta('$sumI', '$cntI'), 2] } } },
    { $sort: { cantidad: -1 } }
  ];

  const facetPeriodoDia = [
    { $unwind: '$porPeriodo' },
    {
      $group: {
        _id: '$porPeriodo.periodo',
        cantidad: { $sum: '$porPeriodo.total' },
        sumI: { $sum: '$porPeriodo.sumI' },
        cntI: { $sum: '$porPeriodo.cntI' },
        congest: { $sum: { $add: ['$porPeriodo.congestionadas', '$porPeriodo.colapsadas'] } }
      }
    },
    {
      $project: {
        _id: 0,
        periodo: '$_id',
        cantidad: 1,
        intensidadPromedio: { $round: [mediaExacta('$sumI', '$cntI'), 2] },
        nivelCongestion: { $round: [porcentaje('$congest', '$cantidad'), 2] }
      }
    },
    { $sort: { periodo: 1 } }
  ];

  const facetDia = [
    { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$fecha' } }, sumI: { $sum: '$sumI' }, cntI: { $sum: '$cntI' } } },
    { $project: { _id: 0, dia: '$_id', intensidadPromedio: { $round: [mediaExacta('$sumI', '$cntI'), 2] } } },
    { $sort: { dia: 1 } }
  ];

  const [resultado] = await daily.aggregate([
    { $match: filters },
    { $facet: { general: facetGeneral, porTipoElemento: facetTipos, porPeriodoDia: facetPeriodoDia, porDia: facetDia } }
  ], { allowDiskUse: true, maxTimeMS: MONGODB_TIMEOUTS.AGGREGATE_TIMEOUT_HEAVY_MS }).toArray();

  return {
    resumen: resultado?.general?.[0] || {},
    porTipoElemento: resultado?.porTipoElemento || [],
    porPeriodoDia: resultado?.porPeriodoDia || [],
    porDia: resultado?.porDia || []
  };
};

/**
 * Estadisticas ligeras (total + medias) para el listado paginado. Lee del
 * rollup en una sola pasada barata, evitando el $group sobre la coleccion cruda.
 */
const obtenerResumenListado = async function (Model, filters = {}) {
  const daily = coleccionDaily(Model);
  const [r] = await daily.aggregate([
    { $match: filters },
    { $group: { _id: null, totalMediciones: { $sum: '$total' }, sumI: { $sum: '$sumI' }, cntI: { $sum: '$cntI' }, sumO: { $sum: '$sumO' }, cntO: { $sum: '$cntO' }, confiables: { $sum: '$confiables' } } },
    {
      $project: {
        _id: 0,
        totalMediciones: 1,
        intensidadPromedio: { $round: [mediaExacta('$sumI', '$cntI'), 2] },
        ocupacionPromedio: { $round: [mediaExacta('$sumO', '$cntO'), 2] },
        medicionesConfiables: '$confiables'
      }
    }
  ], ESCALAR).toArray();
  return r || { totalMediciones: 0, intensidadPromedio: 0, ocupacionPromedio: 0, medicionesConfiables: 0 };
};

/**
 * Mapa de trafico: agregado por punto sobre el rollup diario + lookup geo.
 */
const obtenerAgregadoParaMapa = async function (Model, filtros = {}) {
  const daily = coleccionDaily(Model);
  return daily.aggregate([
    { $match: filtros },
    {
      $group: {
        _id: '$puntoMedidaId',
        tipoElemento: { $first: '$tipoElemento' },
        sumI: { $sum: '$sumI' }, cntI: { $sum: '$cntI' },
        sumO: { $sum: '$sumO' }, cntO: { $sum: '$cntO' },
        sumC: { $sum: '$sumC' }, cntC: { $sum: '$cntC' },
        sumVelM30: { $sum: '$sumVelM30' }, cntVelM30: { $sum: '$cntVelM30' },
        congestionadas: { $sum: '$congestionadas' }, colapsadas: { $sum: '$colapsadas' },
        totalMediciones: { $sum: '$total' }
      }
    },
    {
      $lookup: {
        from: 'locations',
        localField: '_id',
        foreignField: 'id_punto',
        as: 'ubicacion',
        pipeline: [{ $project: { geometry: 1, distrito: 1, nombre: 1, _id: 0 } }]
      }
    },
    { $addFields: { ubicacion: { $arrayElemAt: ['$ubicacion', 0] } } },
    { $match: { 'ubicacion.geometry': { $exists: true } } },
    {
      $project: {
        _id: 0,
        puntoMedidaId: '$_id',
        tipoElemento: 1,
        nombre: '$ubicacion.nombre',
        distrito: '$ubicacion.distrito',
        geometry: '$ubicacion.geometry',
        intensidadMedia: { $round: [mediaExacta('$sumI', '$cntI'), 2] },
        ocupacionMedia: { $round: [mediaExacta('$sumO', '$cntO'), 2] },
        cargaMedia: { $round: [mediaExacta('$sumC', '$cntC'), 2] },
        velocidadMedia: { $round: [mediaExacta('$sumVelM30', '$cntVelM30'), 2] },
        porcentajeCongestion: { $round: [porcentaje({ $add: ['$congestionadas', '$colapsadas'] }, '$totalMediciones'), 2] },
        totalMediciones: 1
      }
    }
  ], ESCALAR).toArray();
};

module.exports = {
  obtenerAnalisisCongestionOptimizado,
  obtenerDatosHistoricosOptimizado,
  obtenerEstadisticasTraficoOptimizadas,
  obtenerResumenListado,
  obtenerAgregadoParaMapa
};
