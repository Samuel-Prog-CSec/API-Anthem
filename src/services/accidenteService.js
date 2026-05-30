/**
 * Service de Accidentes
 *
 * Encapsula la logica de agregacion y analisis de accidentes de trafico.
 * Los metodos estaticos del modelo `Accidente` actuan como thin wrappers que
 * delegan en este service.
 */

const {
  TIPOS_ACCIDENTE,
  TIPOS_VEHICULO,
  MAPEO_SEVERIDAD_LESIONES,
  GRAVEDADES_NO_LEVE,
  SEVERITY_LEVELS,
  BINARY_INDICATORS,
  MONGODB_TIMEOUTS
} = require('../constants');

// NOTA: usar MAPEO_SEVERIDAD_LESIONES.GRAVES solo cuando se filtra por
// `personaAfectada.tipoLesion` (codigos individuales tipo FALLECIDO_24_HORAS).
// Para `circunstancias.gravedad` (LEVE/GRAVE/MORTAL del accidente completo)
// usar GRAVEDADES_NO_LEVE para evitar matchear cero documentos.

const ESCALAR_AGG = { allowDiskUse: true, maxTimeMS: MONGODB_TIMEOUTS.AGGREGATE_TIMEOUT_MS };

const obtenerEstadisticasPorPeriodo = function(Model, startDate, endDate) {
  return Model.aggregate([
    { $match: { fecha: { $gte: startDate, $lte: endDate } } },
    {
      $group: {
        _id: null,
        totalAccidentes: { $sum: 1 },
        accidentesGraves: { $sum: { $cond: [{ $in: ['$circunstancias.gravedad', GRAVEDADES_NO_LEVE] }, 1, 0] } },
        accidentesMortales: { $sum: { $cond: [{ $eq: ['$circunstancias.gravedad', SEVERITY_LEVELS.ACCIDENT.MORTAL] }, 1, 0] } },
        atropellos: { $sum: { $cond: [{ $eq: ['$circunstancias.tipoAccidente', TIPOS_ACCIDENTE.ATROPELLO_A_PERSONA] }, 1, 0] } },
        accidentesConAlcohol: { $sum: { $cond: [{ $eq: ['$personaAfectada.positivaAlcohol', BINARY_INDICATORS.YES] }, 1, 0] } }
      }
    }
  ]).option(ESCALAR_AGG);
};

const obtenerPuntosNegros = function(Model, limit = 10, startDate = null, endDate = null) {
  const matchConditions = {};
  if (startDate && endDate) {
    matchConditions.fecha = { $gte: startDate, $lte: endDate };
  }
  return Model.aggregate([
    { $match: matchConditions },
    {
      $group: {
        _id: { calle: '$ubicacion.calle', distrito: '$ubicacion.nombreDistrito' },
        totalAccidentes: { $sum: 1 },
        accidentesGraves: { $sum: { $cond: [{ $in: ['$circunstancias.gravedad', GRAVEDADES_NO_LEVE] }, 1, 0] } },
        tiposAccidente: { $addToSet: '$circunstancias.tipoAccidente' },
        puntuacionGravedadPromedio: { $avg: '$analisis.puntuacionGravedad' }
      }
    },
    { $addFields: { indiceGravedad: { $multiply: ['$puntuacionGravedadPromedio', '$totalAccidentes'] } } },
    { $sort: { indiceGravedad: -1, totalAccidentes: -1 } },
    { $limit: limit }
  ]).option(ESCALAR_AGG);
};

const obtenerAnalisisPorVehiculo = function(Model, startDate = null, endDate = null) {
  const matchConditions = {};
  if (startDate && endDate) {
    matchConditions.fecha = { $gte: startDate, $lte: endDate };
  }
  return Model.aggregate([
    { $match: matchConditions },
    {
      $group: {
        _id: '$vehiculo.tipo',
        totalAccidentes: { $sum: 1 },
        accidentesGraves: { $sum: { $cond: [{ $in: ['$circunstancias.gravedad', GRAVEDADES_NO_LEVE] }, 1, 0] } },
        puntuacionGravedadPromedio: { $avg: '$analisis.puntuacionGravedad' }
      }
    },
    {
      $addFields: {
        porcentajeGravedad: { $multiply: [{ $divide: ['$accidentesGraves', '$totalAccidentes'] }, 100] }
      }
    },
    { $sort: { totalAccidentes: -1 } }
  ]).option(ESCALAR_AGG);
};

const obtenerPatronesTemporales = function(Model, groupBy = 'hora') {
  const groupField = groupBy === 'hora' ? '$franjaHoraria'
    : groupBy === 'diaSemana' ? '$analisis.diaSemana'
      : '$analisis.periodoDia';

  return Model.aggregate([
    {
      $group: {
        _id: groupField,
        totalAccidentes: { $sum: 1 },
        accidentesGraves: { $sum: { $cond: [{ $in: ['$circunstancias.gravedad', GRAVEDADES_NO_LEVE] }, 1, 0] } }
      }
    },
    { $sort: { _id: 1 } }
  ]).option(ESCALAR_AGG);
};

const obtenerComparativaDistritos = function(Model, filters = {}) {
  return Model.aggregate([
    { $match: filters },
    {
      $group: {
        _id: '$ubicacion.nombreDistrito',
        totalAccidentes: { $sum: 1 },
        accidentesGraves: { $sum: { $cond: [{ $in: ['$circunstancias.gravedad', GRAVEDADES_NO_LEVE] }, 1, 0] } },
        accidentesMortales: { $sum: { $cond: [{ $eq: ['$circunstancias.gravedad', SEVERITY_LEVELS.ACCIDENT.MORTAL] }, 1, 0] } },
        atropellos: { $sum: { $cond: [{ $eq: ['$circunstancias.tipoAccidente', TIPOS_ACCIDENTE.ATROPELLO_A_PERSONA] }, 1, 0] } },
        accidentesAlcohol: { $sum: { $cond: [{ $eq: ['$personaAfectada.positivaAlcohol', BINARY_INDICATORS.YES] }, 1, 0] } },
        puntuacionGravedadPromedio: { $avg: '$analisis.puntuacionGravedad' },
        turismos: { $sum: { $cond: [{ $eq: ['$vehiculo.tipo', TIPOS_VEHICULO.TURISMO] }, 1, 0] } },
        motocicletas: { $sum: { $cond: [{ $eq: ['$vehiculo.tipo', TIPOS_VEHICULO.MOTOCICLETA_MAS_125CC] }, 1, 0] } },
        bicicletas: { $sum: { $cond: [{ $eq: ['$vehiculo.tipo', TIPOS_VEHICULO.BICICLETA] }, 1, 0] } }
      }
    },
    {
      $addFields: {
        porcentajeGravedad: { $multiply: [{ $divide: ['$accidentesGraves', '$totalAccidentes'] }, 100] },
        porcentajeAtropellos: { $multiply: [{ $divide: ['$atropellos', '$totalAccidentes'] }, 100] },
        porcentajeAlcohol: { $multiply: [{ $divide: ['$accidentesAlcohol', '$totalAccidentes'] }, 100] },
        indiceRiesgoTotal: {
          $add: [
            '$totalAccidentes',
            { $multiply: ['$accidentesGraves', 2] },
            { $multiply: ['$accidentesMortales', 5] }
          ]
        }
      }
    },
    { $sort: { totalAccidentes: -1 } }
  ]).option(ESCALAR_AGG);
};

const obtenerAnalisisSeguridadCalles = function(Model, filters = {}, limit = 20) {
  return Model.aggregate([
    { $match: filters },
    {
      $group: {
        _id: { calle: '$ubicacion.calle', distrito: '$ubicacion.nombreDistrito' },
        totalAccidentes: { $sum: 1 },
        accidentesGraves: { $sum: { $cond: [{ $in: ['$circunstancias.gravedad', GRAVEDADES_NO_LEVE] }, 1, 0] } },
        atropellos: { $sum: { $cond: [{ $eq: ['$circunstancias.tipoAccidente', TIPOS_ACCIDENTE.ATROPELLO_A_PERSONA] }, 1, 0] } },
        accidentesAlcohol: { $sum: { $cond: [{ $eq: ['$personaAfectada.positivaAlcohol', BINARY_INDICATORS.YES] }, 1, 0] } },
        indiceSeveridad: { $avg: '$analisis.puntuacionGravedad' }
      }
    },
    {
      $addFields: {
        indiceRiesgo: {
          $add: [
            { $multiply: ['$totalAccidentes', 0.3] },
            { $multiply: ['$accidentesGraves', 0.4] },
            { $multiply: ['$atropellos', 0.2] },
            { $multiply: ['$accidentesAlcohol', 0.1] }
          ]
        }
      }
    },
    { $sort: { indiceRiesgo: -1 } },
    { $limit: limit }
  ]).option(ESCALAR_AGG);
};

const obtenerAnalisisTendencias = function(Model, filters = {}) {
  return Model.aggregate([
    { $match: filters },
    {
      $group: {
        _id: { año: '$año', mes: '$mes' },
        totalAccidentes: { $sum: 1 },
        accidentesGraves: { $sum: { $cond: [{ $in: ['$circunstancias.gravedad', GRAVEDADES_NO_LEVE] }, 1, 0] } }
      }
    },
    { $sort: { '_id.año': 1, '_id.mes': 1 } }
  ]).option(ESCALAR_AGG);
};

const obtenerCorrelacionMeteorologica = function(Model, filters = {}) {
  return Model.aggregate([
    { $match: filters },
    {
      $group: {
        _id: '$circunstancias.estadoMeteorologico',
        totalAccidentes: { $sum: 1 },
        accidentesGraves: { $sum: { $cond: [{ $in: ['$circunstancias.gravedad', GRAVEDADES_NO_LEVE] }, 1, 0] } }
      }
    },
    {
      $addFields: {
        porcentajeGravedad: { $multiply: [{ $divide: ['$accidentesGraves', '$totalAccidentes'] }, 100] }
      }
    },
    { $sort: { totalAccidentes: -1 } }
  ]).option(ESCALAR_AGG);
};

const obtenerDistribucionDistritos = function(Model, filters = {}, limit = 15) {
  return Model.aggregate([
    { $match: filters },
    {
      $group: {
        _id: '$ubicacion.nombreDistrito',
        totalAccidentes: { $sum: 1 },
        accidentesGraves: { $sum: { $cond: [{ $in: ['$circunstancias.gravedad', GRAVEDADES_NO_LEVE] }, 1, 0] } },
        puntuacionGravedadPromedio: { $avg: '$analisis.puntuacionGravedad' }
      }
    },
    { $sort: { totalAccidentes: -1 } },
    { $limit: limit }
  ]).option(ESCALAR_AGG);
};

const obtenerAnalisisFactoresRiesgo = function(Model, filters = {}) {
  return Model.aggregate([
    { $match: filters },
    // NO usar $limit antes de $unwind/$group - corrompe las estadisticas
    { $unwind: { path: '$analisis.factoresRiesgo', preserveNullAndEmptyArrays: true } },
    { $group: { _id: '$analisis.factoresRiesgo', cantidad: { $sum: 1 } } },
    { $sort: { cantidad: -1 } }
  ]).option(ESCALAR_AGG);
};

/**
 * Heatmap de accidentes: agrupa puntos cercanos para reducir ruido visual.
 *
 * @param {Number} limite - Maximo de accidentes a procesar
 * @param {Number} precision - Distancia en metros para agrupar puntos (default: 100m)
 */
const obtenerDatosMapaCalor = async function(Model, filters = {}, limite = 500, precision = 100) {
  const queryFilters = {
    ...filters,
    'ubicacion.coordenadas.x': { $exists: true, $ne: null },
    'ubicacion.coordenadas.y': { $exists: true, $ne: null }
  };

  const heatmapData = await Model.find(queryFilters)
    .select({
      'ubicacion.coordenadas': 1,
      'circunstancias.gravedad': 1,
      'analisis.puntuacionGravedad': 1,
      'personaAfectada.tipoLesion': 1,
      fecha: 1
    })
    .limit(parseInt(limite, 10))
    .lean();

  // Agrupar puntos cercanos
  const groupedPoints = {};
  heatmapData.forEach(accident => {
    const x = Math.round(accident.ubicacion.coordenadas.x / precision) * precision;
    const y = Math.round(accident.ubicacion.coordenadas.y / precision) * precision;
    const key = `${x},${y}`;

    if (!groupedPoints[key]) {
      groupedPoints[key] = {
        coordenadas: { x, y },
        accidentes: [],
        totalAccidentes: 0,
        accidentesGraves: 0,
        puntuacionGravedadPromedio: 0
      };
    }

    groupedPoints[key].accidentes.push(accident);
    groupedPoints[key].totalAccidentes++;

    if (GRAVEDADES_NO_LEVE.includes(accident.circunstancias.gravedad)) {
      groupedPoints[key].accidentesGraves++;
    }

    groupedPoints[key].puntuacionGravedadPromedio =
      (groupedPoints[key].puntuacionGravedadPromedio + accident.analisis.puntuacionGravedad) /
      groupedPoints[key].totalAccidentes;
  });

  const heatmapPoints = Object.values(groupedPoints).map(group => ({
    lat: group.coordenadas.y,
    lng: group.coordenadas.x,
    weight: group.totalAccidentes,
    intensity: group.puntuacionGravedadPromedio,
    details: {
      totalAccidentes: group.totalAccidentes,
      accidentesGraves: group.accidentesGraves,
      porcentajeGravedad: (group.accidentesGraves / group.totalAccidentes) * 100
    }
  }));

  return {
    puntos: heatmapPoints,
    estadisticas: {
      totalPuntos: heatmapPoints.length,
      totalAccidentes: heatmapData.length
    }
  };
};

module.exports = {
  obtenerEstadisticasPorPeriodo,
  obtenerPuntosNegros,
  obtenerAnalisisPorVehiculo,
  obtenerPatronesTemporales,
  obtenerComparativaDistritos,
  obtenerAnalisisSeguridadCalles,
  obtenerAnalisisTendencias,
  obtenerCorrelacionMeteorologica,
  obtenerDistribucionDistritos,
  obtenerAnalisisFactoresRiesgo,
  obtenerDatosMapaCalor
};
