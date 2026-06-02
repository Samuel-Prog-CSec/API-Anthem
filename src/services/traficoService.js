/**
 * Service de Trafico
 *
 * Encapsula la logica de agregacion sobre la coleccion `traffic_measurements`
 * (~24M-138M docs). Los metodos estaticos del modelo `Traffic` actuan como
 * thin wrappers que delegan en este service.
 */

const {
  CONGESTION_LEVELS,
  DATA_QUALITY_LEVELS,
  TRAFFIC_ELEMENT_TYPES,
  MONGODB_TIMEOUTS
} = require('../constants');

// La velocidad media (vmed) solo es valida para puntos M-30 (ver
// dataset_information): en URB el CSV trae 0 como relleno. Esta expresion
// promedia velocidad considerando unicamente M-30 con valor >= 0, para no
// diluir la media con ceros de trafico urbano.
const PROMEDIO_VELOCIDAD_M30 = {
  $avg: {
    $cond: [
      { $and: [
        { $eq: ['$tipoElemento', TRAFFIC_ELEMENT_TYPES.M30] },
        { $gte: ['$metricas.velocidadMedia', 0] }
      ] },
      '$metricas.velocidadMedia',
      null
    ]
  }
};

/**
 * Analisis de congestion (opcional con lookup a locations para agrupar por distrito).
 */
const obtenerAnalisisCongestionOptimizado = async function(Model, filters = {}, groupBy = 'distrito') {
  const escalar = { allowDiskUse: true, maxTimeMS: MONGODB_TIMEOUTS.AGGREGATE_TIMEOUT_MS };

  // Acumuladores comunes: sumas + conteos para poder calcular medias EXACTAS
  // tras una posible re-agrupacion (promediar promedios seria incorrecto).
  const acumuladores = {
    totalMediciones: { $sum: 1 },
    sumIntensidad: { $sum: { $cond: [{ $gte: ['$metricas.intensidad', 0] }, '$metricas.intensidad', 0] } },
    cntIntensidad: { $sum: { $cond: [{ $gte: ['$metricas.intensidad', 0] }, 1, 0] } },
    sumOcupacion: { $sum: { $cond: [{ $gte: ['$metricas.ocupacion', 0] }, '$metricas.ocupacion', 0] } },
    cntOcupacion: { $sum: { $cond: [{ $gte: ['$metricas.ocupacion', 0] }, 1, 0] } },
    medicionesFluidas: { $sum: { $cond: [{ $eq: ['$analisis.nivelCongestion', CONGESTION_LEVELS.FLUIDO] }, 1, 0] } },
    medicionesDensas: { $sum: { $cond: [{ $eq: ['$analisis.nivelCongestion', CONGESTION_LEVELS.DENSO] }, 1, 0] } },
    medicionesCongestionadas: { $sum: { $cond: [{ $eq: ['$analisis.nivelCongestion', CONGESTION_LEVELS.CONGESTIONADO] }, 1, 0] } },
    medicionesColapsadas: { $sum: { $cond: [{ $eq: ['$analisis.nivelCongestion', CONGESTION_LEVELS.COLAPSADO] }, 1, 0] } }
  };

  // Etapas finales compartidas: calculan medias y porcentajes, proyectan y ordenan.
  const etapasFinales = [
    {
      $addFields: {
        zona: '$_id',
        intensidadPromedio: { $cond: [{ $gt: ['$cntIntensidad', 0] }, { $divide: ['$sumIntensidad', '$cntIntensidad'] }, null] },
        ocupacionPromedio: { $cond: [{ $gt: ['$cntOcupacion', 0] }, { $divide: ['$sumOcupacion', '$cntOcupacion'] }, null] },
        porcentajeCongestion: {
          $cond: [
            { $gt: ['$totalMediciones', 0] },
            { $multiply: [{ $divide: [{ $add: ['$medicionesCongestionadas', '$medicionesColapsadas'] }, '$totalMediciones'] }, 100] },
            0
          ]
        },
        porcentajeFluido: {
          $cond: [
            { $gt: ['$totalMediciones', 0] },
            { $multiply: [{ $divide: ['$medicionesFluidas', '$totalMediciones'] }, 100] },
            0
          ]
        }
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

  // Modo tipoElemento: agrupacion directa (solo 2 cubos, sin lookup).
  if (groupBy !== 'distrito') {
    return Model.aggregate([
      { $match: filters },
      { $group: { _id: '$tipoElemento', ...acumuladores } },
      ...etapasFinales
    ]).option(escalar);
  }

  // Modo distrito: PRIMERO se reduce a nivel de punto (~miles de docs) y SOLO
  // entonces se hace el $lookup a locations, en vez de un join por cada una de
  // las millones de mediciones (antipatron previo). Despues se re-agrupa por
  // distrito sumando los acumuladores de cada punto.
  const sumarAcumuladores = Object.fromEntries(
    Object.keys(acumuladores).map(clave => [clave, { $sum: `$${clave}` }])
  );

  return Model.aggregate([
    { $match: filters },
    { $group: { _id: '$puntoMedidaId', ...acumuladores } },
    {
      // $lookup indexado por `id_punto` (campo sparse: solo lo tienen los
      // puntos de trafico), mucho mas rapido que un $expr correlacionado que
      // ignora el indice y hace collscan de locations por cada punto.
      $lookup: {
        from: 'locations',
        localField: '_id',
        foreignField: 'id_punto',
        as: 'ubicacion',
        pipeline: [{ $project: { distrito: 1, _id: 0 } }]
      }
    },
    { $addFields: { distrito: { $arrayElemAt: ['$ubicacion.distrito', 0] } } },
    { $group: { _id: '$distrito', ...sumarAcumuladores } },
    ...etapasFinales
  ]).option(escalar);
};

/**
 * Datos historicos con agregacion por periodo (hour/day/week/month).
 */
const obtenerDatosHistoricosOptimizado = async function(Model, filters = {}, aggregation = 'hour') {
  let dateGrouping;
  let sortFields;

  switch (aggregation) {
    case 'hour':
      dateGrouping = { año: '$año', mes: '$mes', dia: '$dia', hora: '$hora' };
      sortFields = { 'periodo.año': 1, 'periodo.mes': 1, 'periodo.dia': 1, 'periodo.hora': 1 };
      break;
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
      dateGrouping = { hora: '$hora' };
      sortFields = { 'periodo.hora': 1 };
  }

  const pipeline = [
    { $match: filters },
    {
      $group: {
        _id: dateGrouping,
        totalMediciones: { $sum: 1 },
        intensidadPromedio: { $avg: { $cond: [{ $gte: ['$metricas.intensidad', 0] }, '$metricas.intensidad', null] } },
        intensidadMaxima: { $max: { $cond: [{ $gte: ['$metricas.intensidad', 0] }, '$metricas.intensidad', null] } },
        intensidadMinima: { $min: { $cond: [{ $gte: ['$metricas.intensidad', 0] }, '$metricas.intensidad', null] } },
        ocupacionPromedio: { $avg: { $cond: [{ $gte: ['$metricas.ocupacion', 0] }, '$metricas.ocupacion', null] } },
        ocupacionMaxima: { $max: { $cond: [{ $gte: ['$metricas.ocupacion', 0] }, '$metricas.ocupacion', null] } },
        cargaPromedio: { $avg: { $cond: [{ $gte: ['$metricas.carga', 0] }, '$metricas.carga', null] } },
        velocidadPromedio: PROMEDIO_VELOCIDAD_M30,
        medicionesCongestionadas: {
          $sum: { $cond: [{ $in: ['$analisis.nivelCongestion', [CONGESTION_LEVELS.CONGESTIONADO, CONGESTION_LEVELS.COLAPSADO]] }, 1, 0] }
        },
        medicionesConfiables: {
          $sum: { $cond: [{ $in: ['$calidadDatos.calidadGeneral', [DATA_QUALITY_LEVELS.ALTA, DATA_QUALITY_LEVELS.MEDIA]] }, 1, 0] }
        }
      }
    },
    {
      $addFields: {
        periodo: '$_id',
        porcentajeCongestion: {
          $cond: [
            { $gt: ['$totalMediciones', 0] },
            { $multiply: [{ $divide: ['$medicionesCongestionadas', '$totalMediciones'] }, 100] },
            0
          ]
        },
        confiabilidad: {
          $cond: [
            { $gt: ['$totalMediciones', 0] },
            { $multiply: [{ $divide: ['$medicionesConfiables', '$totalMediciones'] }, 100] },
            0
          ]
        }
      }
    },
    {
      $project: {
        _id: 0,
        periodo: 1,
        totalMediciones: 1,
        metricas: {
          intensidad: {
            promedio: { $round: ['$intensidadPromedio', 2] },
            maxima: { $round: ['$intensidadMaxima', 2] },
            minima: { $round: ['$intensidadMinima', 2] }
          },
          ocupacion: {
            promedio: { $round: ['$ocupacionPromedio', 2] },
            maxima: { $round: ['$ocupacionMaxima', 2] }
          },
          carga: { $round: ['$cargaPromedio', 2] },
          velocidad: { $round: ['$velocidadPromedio', 2] }
        },
        porcentajeCongestion: { $round: ['$porcentajeCongestion', 2] },
        confiabilidad: { $round: ['$confiabilidad', 2] }
      }
    },
    { $sort: sortFields }
  ];

  return Model.aggregate(pipeline).option({ allowDiskUse: true, maxTimeMS: MONGODB_TIMEOUTS.AGGREGATE_TIMEOUT_MS });
};

/**
 * Estadisticas generales paralelizadas (Promise.all con 3 pipelines).
 *
 * allowDiskUse:true porque el filtro tipico abarca varios dias sobre 138M
 * documentos: el sort/group puede exceder 100MB en memoria.
 */
const obtenerEstadisticasTraficoOptimizadas = async function(Model, filters = {}) {
  const [estadisticasGenerales, distribucionTipos, distribucionHoraria] = await Promise.all([
    Model.aggregate([
      { $match: filters },
      {
        $group: {
          _id: null,
          totalMediciones: { $sum: 1 },
          intensidadPromedio: { $avg: { $cond: [{ $gte: ['$metricas.intensidad', 0] }, '$metricas.intensidad', null] } },
          intensidadMaxima: { $max: { $cond: [{ $gte: ['$metricas.intensidad', 0] }, '$metricas.intensidad', null] } },
          ocupacionPromedio: { $avg: { $cond: [{ $gte: ['$metricas.ocupacion', 0] }, '$metricas.ocupacion', null] } },
          cargaPromedio: { $avg: { $cond: [{ $gte: ['$metricas.carga', 0] }, '$metricas.carga', null] } },
          velocidadPromedio: PROMEDIO_VELOCIDAD_M30,
          medicionesConfiables: {
            $sum: { $cond: [{ $in: ['$calidadDatos.calidadGeneral', [DATA_QUALITY_LEVELS.ALTA, DATA_QUALITY_LEVELS.MEDIA]] }, 1, 0] }
          },
          medicionesCongestionadas: {
            $sum: { $cond: [{ $in: ['$analisis.nivelCongestion', [CONGESTION_LEVELS.CONGESTIONADO, CONGESTION_LEVELS.COLAPSADO]] }, 1, 0] }
          }
        }
      },
      {
        $project: {
          _id: 0,
          totalMediciones: 1,
          intensidadPromedio: { $round: ['$intensidadPromedio', 2] },
          intensidadMaxima: { $round: ['$intensidadMaxima', 2] },
          ocupacionPromedio: { $round: ['$ocupacionPromedio', 2] },
          cargaPromedio: { $round: ['$cargaPromedio', 2] },
          velocidadPromedio: { $round: ['$velocidadPromedio', 2] },
          porcentajeConfiabilidad: {
            $round: [{ $multiply: [{ $divide: ['$medicionesConfiables', '$totalMediciones'] }, 100] }, 2]
          },
          porcentajeCongestion: {
            $round: [{ $multiply: [{ $divide: ['$medicionesCongestionadas', '$totalMediciones'] }, 100] }, 2]
          }
        }
      }
    ]).option({ allowDiskUse: true, maxTimeMS: MONGODB_TIMEOUTS.AGGREGATE_TIMEOUT_MS }),

    Model.aggregate([
      { $match: filters },
      {
        $group: {
          _id: '$tipoElemento',
          cantidad: { $sum: 1 },
          intensidadPromedio: { $avg: { $cond: [{ $gte: ['$metricas.intensidad', 0] }, '$metricas.intensidad', null] } }
        }
      },
      {
        $project: {
          _id: 0,
          tipo: '$_id',
          cantidad: 1,
          intensidadPromedio: { $round: ['$intensidadPromedio', 2] }
        }
      },
      { $sort: { cantidad: -1 } }
    ]).option({ allowDiskUse: true, maxTimeMS: MONGODB_TIMEOUTS.AGGREGATE_TIMEOUT_MS }),

    Model.aggregate([
      { $match: filters },
      {
        $group: {
          _id: '$analisis.periodoDia',
          cantidad: { $sum: 1 },
          intensidadPromedio: { $avg: { $cond: [{ $gte: ['$metricas.intensidad', 0] }, '$metricas.intensidad', null] } },
          congestionPromedio: {
            $avg: {
              $cond: [
                { $in: ['$analisis.nivelCongestion', [CONGESTION_LEVELS.CONGESTIONADO, CONGESTION_LEVELS.COLAPSADO]] },
                100,
                0
              ]
            }
          }
        }
      },
      {
        $project: {
          _id: 0,
          periodo: '$_id',
          cantidad: 1,
          intensidadPromedio: { $round: ['$intensidadPromedio', 2] },
          nivelCongestion: { $round: ['$congestionPromedio', 2] }
        }
      },
      { $sort: { periodo: 1 } }
    ]).option({ allowDiskUse: true, maxTimeMS: MONGODB_TIMEOUTS.AGGREGATE_TIMEOUT_MS })
  ]);

  return {
    resumen: estadisticasGenerales[0] || {},
    porTipoElemento: distribucionTipos,
    porPeriodoDia: distribucionHoraria
  };
};

/**
 * Mapa de trafico como FeatureCollection GeoJSON RFC 7946.
 *
 * Patron paralelo a /ubicaciones/mapa, /ruido/mapa, etc. Adaptado al volumen
 * masivo de trafico (138M docs):
 *   - Filtros de fecha OBLIGATORIOS y limitados a 7 dias (validacion en ruta).
 *   - Agrupa por puntoMedidaId, calcula medias por punto.
 *   - $lookup a locations (PUNTO_TRAFICO) para extraer geometry.
 *   - allowDiskUse:true por seguridad ante rangos amplios.
 */
const obtenerAgregadoParaMapa = async function(Model, filtros = {}) {
  const pipeline = [
    { $match: filtros },
    {
      $group: {
        _id: '$puntoMedidaId',
        tipoElemento: { $first: '$tipoElemento' },
        intensidadMedia: { $avg: { $cond: [{ $gte: ['$metricas.intensidad', 0] }, '$metricas.intensidad', null] } },
        ocupacionMedia: { $avg: { $cond: [{ $gte: ['$metricas.ocupacion', 0] }, '$metricas.ocupacion', null] } },
        cargaMedia: { $avg: { $cond: [{ $gte: ['$metricas.carga', 0] }, '$metricas.carga', null] } },
        velocidadMedia: PROMEDIO_VELOCIDAD_M30,
        medicionesCongestionadas: {
          $sum: { $cond: [{ $in: ['$analisis.nivelCongestion', [CONGESTION_LEVELS.CONGESTIONADO, CONGESTION_LEVELS.COLAPSADO]] }, 1, 0] }
        },
        totalMediciones: { $sum: 1 }
      }
    },
    {
      // $lookup indexado por `id_punto` (sparse), evita el collscan del
      // $expr correlacionado. Ver nota en obtenerAnalisisCongestionOptimizado.
      $lookup: {
        from: 'locations',
        localField: '_id',
        foreignField: 'id_punto',
        as: 'ubicacion',
        pipeline: [{ $project: { geometry: 1, distrito: 1, nombre: 1, _id: 0 } }]
      }
    },
    {
      $addFields: {
        ubicacion: { $arrayElemAt: ['$ubicacion', 0] }
      }
    },
    // Solo conservar puntos con geometry conocida
    { $match: { 'ubicacion.geometry': { $exists: true } } },
    {
      $project: {
        _id: 0,
        puntoMedidaId: '$_id',
        tipoElemento: 1,
        nombre: '$ubicacion.nombre',
        distrito: '$ubicacion.distrito',
        geometry: '$ubicacion.geometry',
        intensidadMedia: { $round: ['$intensidadMedia', 2] },
        ocupacionMedia: { $round: ['$ocupacionMedia', 2] },
        cargaMedia: { $round: ['$cargaMedia', 2] },
        velocidadMedia: { $round: ['$velocidadMedia', 2] },
        porcentajeCongestion: {
          $cond: [
            { $gt: ['$totalMediciones', 0] },
            { $round: [{ $multiply: [{ $divide: ['$medicionesCongestionadas', '$totalMediciones'] }, 100] }, 2] },
            0
          ]
        },
        totalMediciones: 1
      }
    }
  ];

  return Model.aggregate(pipeline).option({ allowDiskUse: true, maxTimeMS: MONGODB_TIMEOUTS.AGGREGATE_TIMEOUT_MS });
};

module.exports = {
  obtenerAnalisisCongestionOptimizado,
  obtenerDatosHistoricosOptimizado,
  obtenerEstadisticasTraficoOptimizadas,
  obtenerAgregadoParaMapa
};
