/**
 * Service de Asignaciones de Patinetes
 *
 * Encapsula la logica de agregacion, analisis de distribucion y optimizacion
 * de patinetes electricos. Los metodos estaticos del modelo
 * `AsignacionPatinetes` actuan como thin wrappers que delegan en este service.
 */

const {
  TIME_CONSTANTS,
  NIVELES_DENSIDAD_PATINETES,
  NIVELES_DEMANDA_PATINETES,
  CONCENTRACION_MERCADO_PATINETES,
  AGGREGATION_LIMITS,
  MONGODB_TIMEOUTS
} = require('../constants');

const ESCALAR_AGG = { allowDiskUse: true, maxTimeMS: MONGODB_TIMEOUTS.AGGREGATE_TIMEOUT_MS };

const matchPorFecha = (fecha) => {
  if (!fecha) {return {};}
  return {
    fechaAsignacion: {
      $gte: new Date(fecha),
      $lt: new Date(new Date(fecha).getTime() + TIME_CONSTANTS.MILLISECONDS_PER_DAY)
    }
  };
};

/**
 * Resumen de una asignacion desde un documento (lean o instancia).
 * No requiere Model, opera puramente sobre el doc.
 */
const obtenerResumenAsignacion = function(doc) {
  return {
    ubicacion: {
      distrito: doc.distrito?.nombre || doc.distrito,
      barrio: doc.barrio?.nombre || doc.barrio
    },
    estadisticas: {
      totalPatinetes: doc.estadisticas?.totalPatinetes || 0,
      totalProveedores: doc.estadisticas?.totalProveedores || 0,
      proveedoresActivos: doc.estadisticas?.proveedoresActivos || 0,
      densidad: doc.estadisticas?.densidadPatinetes || 'N/A'
    },
    distribucion: {
      proveedorDominante: doc.analisisDistribucion?.proveedorDominante || 'N/A',
      concentracion: doc.analisisDistribucion?.concentracionMercado || 'N/A',
      indiceHHI: doc.analisisDistribucion?.indiceHerfindahl || 0
    },
    clasificacion: {
      tipoZona: doc.clasificacionArea?.tipoZona || 'N/A',
      prioridad: doc.clasificacionArea?.prioridadServicio || 'N/A',
      demanda: doc.clasificacionArea?.demandaEstimada || 'N/A'
    },
    proveedores: (doc.proveedores || []).filter(p => p.activo && p.cantidad > 0).map(p => ({
      nombre: p.nombre,
      cantidad: p.cantidad,
      porcentaje: (doc.estadisticas?.totalPatinetes || 0) > 0
        ? (p.cantidad / doc.estadisticas.totalPatinetes) * 100
        : 0
    }))
  };
};

const obtenerEstadisticasDistrito = function(Model, fecha = null) {
  return Model.aggregate([
    { $match: matchPorFecha(fecha) },
    {
      $group: {
        _id: '$distrito.nombre',
        totalPatinetes: { $sum: '$estadisticas.totalPatinetes' },
        totalBarrios: { $sum: 1 },
        promedioPatinetesPorBarrio: { $avg: '$estadisticas.totalPatinetes' },
        densidadPromedio: { $avg: '$estadisticas.promedioPatinetesPorProveedor' },
        zonasMayorDemanda: {
          $sum: { $cond: [{ $eq: ['$clasificacionArea.demandaEstimada', NIVELES_DEMANDA_PATINETES.MUY_ALTA] }, 1, 0] }
        }
      }
    },
    { $sort: { totalPatinetes: -1 } }
  ]).option(ESCALAR_AGG);
};

const obtenerAnalisisMercadoProveedores = function(Model, fecha = null) {
  return Model.aggregate([
    { $match: matchPorFecha(fecha) },
    { $unwind: { path: '$proveedores', preserveNullAndEmptyArrays: true } },
    { $match: { 'proveedores.activo': true, 'proveedores.cantidad': { $gt: 0 } } },
    {
      $group: {
        _id: '$proveedores.nombre',
        totalPatinetes: { $sum: '$proveedores.cantidad' },
        areasOperacion: { $sum: 1 },
        promedioPatinetesPorArea: { $avg: '$proveedores.cantidad' },
        distritos: { $addToSet: '$distrito.nombre' },
        zonasAlta: {
          $sum: { $cond: [{ $eq: ['$clasificacionArea.demandaEstimada', NIVELES_DEMANDA_PATINETES.MUY_ALTA] }, 1, 0] }
        }
      }
    },
    { $addFields: { totalDistritos: { $size: '$distritos' } } },
    { $sort: { totalPatinetes: -1 } }
  ]).option(ESCALAR_AGG);
};

const obtenerZonasMayorConcentracion = function(Model, limite = 20, fecha = null) {
  return Model.aggregate([
    { $match: matchPorFecha(fecha) },
    {
      $project: {
        distrito: '$distrito.nombre',
        barrio: '$barrio.nombre',
        totalPatinetes: '$estadisticas.totalPatinetes',
        densidad: '$estadisticas.densidadPatinetes',
        tipoZona: '$clasificacionArea.tipoZona',
        demanda: '$clasificacionArea.demandaEstimada',
        concentracion: '$analisisDistribucion.concentracionMercado',
        proveedorDominante: '$analisisDistribucion.proveedorDominante'
      }
    },
    { $sort: { totalPatinetes: -1 } },
    { $limit: limite }
  ]).option(ESCALAR_AGG);
};

const obtenerPanelDistribucion = function(Model, fecha = null) {
  return Model.aggregate([
    { $match: matchPorFecha(fecha) },
    {
      $facet: {
        resumenGeneral: [
          {
            $group: {
              _id: null,
              totalPatinetes: { $sum: '$estadisticas.totalPatinetes' },
              totalAreas: { $sum: 1 },
              promedioPatinetesPorArea: { $avg: '$estadisticas.totalPatinetes' },
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
        ],
        distribucionPorTipoZona: [
          {
            $group: {
              _id: '$clasificacionArea.tipoZona',
              totalPatinetes: { $sum: '$estadisticas.totalPatinetes' },
              areas: { $sum: 1 },
              promedio: { $avg: '$estadisticas.totalPatinetes' }
            }
          },
          { $sort: { totalPatinetes: -1 } }
        ],
        distribucionPorDensidad: [
          {
            $group: {
              _id: '$estadisticas.densidadPatinetes',
              areas: { $sum: 1 },
              totalPatinetes: { $sum: '$estadisticas.totalPatinetes' }
            }
          }
        ],
        concentracionMercado: [
          {
            $group: {
              _id: '$analisisDistribucion.concentracionMercado',
              areas: { $sum: 1 },
              hhiPromedio: { $avg: '$analisisDistribucion.indiceHerfindahl' }
            }
          }
        ]
      }
    }
  ]).option(ESCALAR_AGG);
};

/**
 * Analisis de optimizacion de distribucion: areas sobreabastecidas vs subabastecidas.
 */
const obtenerDatosAnalisisOptimizacion = function(Model, fecha = null) {
  const matchCondition = matchPorFecha(fecha);

  return Promise.all([
    Model.aggregate([
      { $match: matchCondition },
      {
        $addFields: {
          demandaNumerica: {
            $switch: {
              branches: [
                { case: { $eq: ['$clasificacionArea.demandaEstimada', NIVELES_DEMANDA_PATINETES.BAJA] }, then: 1 },
                { case: { $eq: ['$clasificacionArea.demandaEstimada', NIVELES_DEMANDA_PATINETES.MEDIA] }, then: 2 },
                { case: { $eq: ['$clasificacionArea.demandaEstimada', NIVELES_DEMANDA_PATINETES.ALTA] }, then: 3 },
                { case: { $eq: ['$clasificacionArea.demandaEstimada', NIVELES_DEMANDA_PATINETES.MUY_ALTA] }, then: 4 }
              ],
              default: 2
            }
          },
          ofertaNumerica: {
            $switch: {
              branches: [
                { case: { $eq: ['$estadisticas.densidadPatinetes', NIVELES_DENSIDAD_PATINETES.BAJA] }, then: 1 },
                { case: { $eq: ['$estadisticas.densidadPatinetes', NIVELES_DENSIDAD_PATINETES.MEDIA] }, then: 2 },
                { case: { $eq: ['$estadisticas.densidadPatinetes', NIVELES_DENSIDAD_PATINETES.ALTA] }, then: 3 },
                { case: { $eq: ['$estadisticas.densidadPatinetes', NIVELES_DENSIDAD_PATINETES.MUY_ALTA] }, then: 4 }
              ],
              default: 2
            }
          }
        }
      },
      {
        $addFields: {
          balanceOfertaDemanda: { $subtract: ['$ofertaNumerica', '$demandaNumerica'] },
          tipoDesbalance: {
            $switch: {
              branches: [
                { case: { $gt: ['$balanceOfertaDemanda', 1] }, then: 'SOBREABASTECIDO' },
                { case: { $lt: ['$balanceOfertaDemanda', -1] }, then: 'SUBABASTECIDO' },
                { case: { $eq: ['$balanceOfertaDemanda', 0] }, then: 'EQUILIBRADO' }
              ],
              default: 'LIGERAMENTE_DESBALANCEADO'
            }
          }
        }
      },
      {
        $group: {
          _id: '$tipoDesbalance',
          areas: { $sum: 1 },
          totalPatinetes: { $sum: '$estadisticas.totalPatinetes' },
          ejemplos: {
            $push: {
              distrito: '$distrito.nombre',
              barrio: '$barrio.nombre',
              patinetes: '$estadisticas.totalPatinetes',
              demanda: '$clasificacionArea.demandaEstimada',
              densidad: '$estadisticas.densidadPatinetes',
              balance: '$balanceOfertaDemanda'
            }
          }
        }
      },
      { $addFields: { ejemplos: { $slice: ['$ejemplos', 5] } } }
    ]),

    Model.aggregate([
      { $match: matchCondition },
      {
        $project: {
          distrito: '$distrito.nombre',
          barrio: '$barrio.nombre',
          patinetes: '$estadisticas.totalPatinetes',
          demanda: '$clasificacionArea.demandaEstimada',
          densidad: '$estadisticas.densidadPatinetes',
          prioridad: '$clasificacionArea.prioridadServicio',
          tipoZona: '$clasificacionArea.tipoZona',
          concentracion: '$analisisDistribucion.concentracionMercado'
        }
      },
      {
        $addFields: {
          necesitaAtencion: {
            $or: [
              { $and: [{ $in: ['$demanda', [NIVELES_DEMANDA_PATINETES.ALTA, NIVELES_DEMANDA_PATINETES.MUY_ALTA]] }, { $eq: ['$densidad', NIVELES_DENSIDAD_PATINETES.BAJA] }] },
              { $and: [{ $eq: ['$demanda', NIVELES_DEMANDA_PATINETES.BAJA] }, { $in: ['$densidad', [NIVELES_DENSIDAD_PATINETES.ALTA, NIVELES_DENSIDAD_PATINETES.MUY_ALTA]] }] },
              { $eq: ['$concentracion', CONCENTRACION_MERCADO_PATINETES.ALTA_CONCENTRACION] }
            ]
          }
        }
      },
      { $match: { necesitaAtencion: true } },
      { $sort: { patinetes: -1 } },
      { $limit: AGGREGATION_LIMITS.PREVIEW }
    ])
  ]).then(([analisisDesbalance, recomendaciones]) => ({ analisisDesbalance, recomendaciones }));
};

const obtenerAsignacionesConFiltros = async function(Model, filters, sortOptions, pagination, projection = {}) {
  const { skip, limit } = pagination;

  const query = Model.find(filters, projection)
    .sort(sortOptions)
    .skip(skip)
    .limit(limit)
    .lean();

  const total = await Model.countDocuments(filters);
  const asignaciones = await query;

  return {
    asignaciones,
    total,
    page: Math.floor(skip / limit) + 1,
    totalPages: Math.ceil(total / limit),
    hasNextPage: skip + limit < total,
    hasPrevPage: skip > 0
  };
};

const obtenerDetallesAreaOptimizado = async function(Model, distrito, barrio, fecha = null) {
  const baseFilter = { 'distrito.nombre': distrito, 'barrio.nombre': barrio };

  const areaFilter = { ...baseFilter };
  if (fecha) {
    const fechaInicio = new Date(fecha);
    const fechaFin = new Date(fechaInicio.getTime() + TIME_CONSTANTS.MILLISECONDS_PER_DAY);
    areaFilter.fechaAsignacion = { $gte: fechaInicio, $lt: fechaFin };
  } else {
    const ultimoRegistro = await Model.findOne(baseFilter).sort({ fechaAsignacion: -1 }).lean();
    if (!ultimoRegistro) {
      return null;
    }
    const fechaInicio = new Date(ultimoRegistro.fechaAsignacion);
    const fechaFin = new Date(fechaInicio.getTime() + TIME_CONSTANTS.MILLISECONDS_PER_DAY);
    areaFilter.fechaAsignacion = { $gte: fechaInicio, $lt: fechaFin };
  }

  const [area, historial, areasSimilares] = await Promise.all([
    Model.findOne(areaFilter).lean(),
    fecha
      ? Promise.resolve([])
      : Model.find(baseFilter)
        .select('fechaAsignacion estadisticas.totalPatinetes estadisticas.densidadPatinetes')
        .sort({ fechaAsignacion: -1 })
        .limit(10)
        .lean(),
    (async () => {
      const areaTemp = await Model.findOne(areaFilter).lean();
      if (!areaTemp) {
        return [];
      }
      return Model.find({
        'clasificacionArea.tipoZona': areaTemp.clasificacionArea.tipoZona,
        'distrito.nombre': { $ne: areaTemp.distrito.nombre },
        fechaAsignacion: areaTemp.fechaAsignacion
      })
        .select('distrito.nombre barrio.nombre estadisticas.totalPatinetes')
        .sort({ 'estadisticas.totalPatinetes': -1 })
        .limit(5)
        .lean();
    })()
  ]);

  if (!area) {
    return null;
  }

  return { area, historial, areasSimilares };
};

const obtenerDatosComparativaTemporal = async function(Model, fechaInicio, fechaFin, distrito = null, agrupacion = 'distrito') {
  const matchCondition = {
    fechaAsignacion: { $gte: new Date(fechaInicio), $lte: new Date(fechaFin) }
  };

  if (distrito) {
    matchCondition['distrito.nombre'] = distrito;
  }

  const groupField = agrupacion === 'barrio'
    ? { distrito: '$distrito.nombre', barrio: '$barrio.nombre' }
    : '$distrito.nombre';

  const comparativa = await Model.aggregate([
    { $match: matchCondition },
    {
      $group: {
        _id: {
          fecha: { $dateToString: { format: '%Y-%m-%d', date: '$fechaAsignacion' } },
          ubicacion: groupField
        },
        totalPatinetes: { $sum: '$estadisticas.totalPatinetes' },
        totalProveedores: { $avg: '$estadisticas.totalProveedores' },
        densidadPromedio: { $avg: '$estadisticas.promedioPatinetesPorProveedor' }
      }
    },
    { $sort: { '_id.fecha': 1, '_id.ubicacion': 1 } }
  ]);

  const processedData = {};
  comparativa.forEach(item => {
    const fecha = item._id.fecha;
    const ubicacion = typeof item._id.ubicacion === 'object'
      ? `${item._id.ubicacion.distrito} - ${item._id.ubicacion.barrio}`
      : item._id.ubicacion;

    if (!processedData[ubicacion]) {
      processedData[ubicacion] = [];
    }

    processedData[ubicacion].push({
      fecha,
      totalPatinetes: item.totalPatinetes,
      totalProveedores: Math.round(item.totalProveedores),
      densidadPromedio: Math.round(item.densidadPromedio * 100) / 100
    });
  });

  return { comparativa: processedData, totalUbicaciones: Object.keys(processedData).length };
};

module.exports = {
  obtenerResumenAsignacion,
  obtenerEstadisticasDistrito,
  obtenerAnalisisMercadoProveedores,
  obtenerZonasMayorConcentracion,
  obtenerPanelDistribucion,
  obtenerDatosAnalisisOptimizacion,
  obtenerAsignacionesConFiltros,
  obtenerDetallesAreaOptimizado,
  obtenerDatosComparativaTemporal
};
