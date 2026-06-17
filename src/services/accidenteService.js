/**
 * Service de Accidentes
 *
 * Encapsula la logica de agregacion y analisis de accidentes de trafico.
 * Los metodos estaticos del modelo `Accidente` actuan como thin wrappers que
 * delegan en este service.
 *
 * UNIDAD DE DATOS: la coleccion `accidents` guarda UN documento por PERSONA
 * AFECTADA, no por accidente. Varios documentos comparten `numeroExpediente`
 * cuando un accidente tiene varias victimas (verificado en BD: 32.429 filas /
 * 14.169 expedientes). Por eso todas las metricas de "accidentes" se calculan
 * sobre un rollup previo por `numeroExpediente` (un registro por accidente) y,
 * en paralelo, se expone `totalAfectados` (conteo de personas) como metrica
 * separada. Los desgloses cuya unidad natural es la persona (factores de
 * riesgo, sexo, lesividad) se mantienen a nivel de afectado y se etiquetan asi.
 */

const {
  TIPOS_ACCIDENTE,
  TIPOS_VEHICULO,
  GRAVEDADES_NO_LEVE,
  SEVERITY_LEVELS,
  BINARY_INDICATORS,
  MONGODB_TIMEOUTS
} = require('../constants');

const ESCALAR_AGG = { allowDiskUse: true, maxTimeMS: MONGODB_TIMEOUTS.AGGREGATE_TIMEOUT_MS };

/**
 * Etapa `$group` que colapsa las filas de afectados en un registro por
 * accidente (`numeroExpediente`). Los campos constantes del accidente se
 * toman con `$first` (todos los afectados de un expediente comparten fecha,
 * distrito, tipo, etc.); la gravedad del accidente es la PEOR de sus victimas
 * (`$max`); las banderas de alcohol/droga son "any" via `$max`; los tipos de
 * vehiculo implicados se acumulan en un set.
 *
 * Se exporta para reutilizarla en pipelines de $facet (donde el $match raiz
 * ya esta aplicado y no debe repetirse).
 */
const ETAPA_GROUP_EXPEDIENTE = {
  $group: {
    _id: '$numeroExpediente',
    afectados: { $sum: 1 },
    distrito: { $first: '$ubicacion.nombreDistrito' },
    calle: { $first: '$ubicacion.calle' },
    tipoAccidente: { $first: '$circunstancias.tipoAccidente' },
    fecha: { $first: '$fecha' },
    anio: { $first: '$año' },
    mes: { $first: '$mes' },
    franjaHoraria: { $first: '$franjaHoraria' },
    periodoDia: { $first: '$analisis.periodoDia' },
    diaSemana: { $first: '$analisis.diaSemana' },
    estadoMeteorologico: { $first: '$circunstancias.estadoMeteorologico' },
    puntuacionGravedad: { $max: '$analisis.puntuacionGravedad' },
    esMortal: { $max: { $cond: [{ $eq: ['$circunstancias.gravedad', SEVERITY_LEVELS.ACCIDENT.MORTAL] }, 1, 0] } },
    esGrave: { $max: { $cond: [{ $in: ['$circunstancias.gravedad', GRAVEDADES_NO_LEVE] }, 1, 0] } },
    conAlcohol: { $max: { $cond: [{ $eq: ['$personaAfectada.positivaAlcohol', BINARY_INDICATORS.YES] }, 1, 0] } },
    tiposVehiculo: { $addToSet: '$vehiculo.tipo' }
  }
};

/**
 * Construye las etapas de rollup [$match, $group-por-expediente].
 *
 * @param {Object} matchStage - Filtros MongoDB a aplicar antes del rollup
 * @returns {Array} Etapas listas para anteponer al resto del pipeline
 */
const construirRollupAccidente = (matchStage = {}) => [
  { $match: matchStage },
  ETAPA_GROUP_EXPEDIENTE
];

/**
 * Estadisticas globales de un periodo: numero de accidentes (expedientes),
 * personas afectadas, accidentes graves/mortales, atropellos y con alcohol.
 */
const obtenerEstadisticasPorPeriodo = function(Model, startDate, endDate, filtrosExtra = {}) {
  // Si no se aporta un rango completo, no se restringe por fecha (evita el
  // bug de "ultimos 30 dias desde hoy", que sobre un dataset de 2051 devolveria
  // cero). El caller decide el rango via filtros de fecha. `filtrosExtra`
  // aporta distrito/gravedad/tipoAccidente para que los KPI respeten los filtros
  // de la pagina (mismo $match pre-rollup que el listado).
  const matchStage = { ...filtrosExtra };
  if (startDate && endDate) { matchStage.fecha = { $gte: startDate, $lte: endDate }; }
  return Model.aggregate([
    ...construirRollupAccidente(matchStage),
    {
      $group: {
        _id: null,
        totalAccidentes: { $sum: 1 },
        totalAfectados: { $sum: '$afectados' },
        accidentesGraves: { $sum: '$esGrave' },
        accidentesMortales: { $sum: '$esMortal' },
        atropellos: { $sum: { $cond: [{ $eq: ['$tipoAccidente', TIPOS_ACCIDENTE.ATROPELLO_A_PERSONA] }, 1, 0] } },
        accidentesConAlcohol: { $sum: '$conAlcohol' }
      }
    },
    { $project: { _id: 0 } }
  ]).option(ESCALAR_AGG);
};

/**
 * Puntos negros: calles/distritos con mas accidentes, ponderados por gravedad.
 */
const obtenerPuntosNegros = function(Model, limit = 10, startDate = null, endDate = null, filtrosExtra = {}) {
  const matchConditions = { ...filtrosExtra };
  if (startDate && endDate) {
    matchConditions.fecha = { $gte: startDate, $lte: endDate };
  }
  return Model.aggregate([
    ...construirRollupAccidente(matchConditions),
    {
      $group: {
        _id: { calle: '$calle', distrito: '$distrito' },
        totalAccidentes: { $sum: 1 },
        totalAfectados: { $sum: '$afectados' },
        accidentesGraves: { $sum: '$esGrave' },
        tiposAccidente: { $addToSet: '$tipoAccidente' },
        puntuacionGravedadPromedio: { $avg: '$puntuacionGravedad' }
      }
    },
    { $addFields: { indiceGravedad: { $multiply: ['$puntuacionGravedadPromedio', '$totalAccidentes'] } } },
    { $sort: { indiceGravedad: -1, totalAccidentes: -1 } },
    { $limit: limit }
  ]).option(ESCALAR_AGG);
};

/**
 * Analisis por tipo de vehiculo implicado. Un accidente puede implicar varios
 * tipos de vehiculo: se cuenta una vez en cada tipo implicado (los buckets
 * pueden solaparse, lo cual es correcto para "accidentes en los que participa
 * un X").
 */
const obtenerAnalisisPorVehiculo = function(Model, startDate = null, endDate = null, filtrosExtra = {}) {
  const matchConditions = { ...filtrosExtra };
  if (startDate && endDate) {
    matchConditions.fecha = { $gte: startDate, $lte: endDate };
  }
  return Model.aggregate([
    ...construirRollupAccidente(matchConditions),
    { $unwind: '$tiposVehiculo' },
    {
      $group: {
        _id: '$tiposVehiculo',
        totalAccidentes: { $sum: 1 },
        accidentesGraves: { $sum: '$esGrave' },
        puntuacionGravedadPromedio: { $avg: '$puntuacionGravedad' }
      }
    },
    {
      $addFields: {
        porcentajeGravedad: {
          $cond: [{ $gt: ['$totalAccidentes', 0] }, { $multiply: [{ $divide: ['$accidentesGraves', '$totalAccidentes'] }, 100] }, 0]
        }
      }
    },
    { $sort: { totalAccidentes: -1 } }
  ]).option(ESCALAR_AGG);
};

/**
 * Patrones temporales por hora, dia de la semana o periodo del dia (todos
 * constantes por accidente, asi que se cuentan expedientes).
 */
const obtenerPatronesTemporales = function(Model, groupBy = 'hora', filters = {}) {
  const groupField = groupBy === 'hora' ? '$franjaHoraria'
    : groupBy === 'diaSemana' ? '$diaSemana'
      : '$periodoDia';

  return Model.aggregate([
    // Aplicar los filtros activos (distrito, gravedad, tipo, rango de fechas)
    // ANTES del rollup por expediente. Antes se pasaba {} y los patrones
    // horarios/semanales mostraban SIEMPRE el agregado global de la coleccion,
    // incoherente con el resto del informe (KPIs, distribuciones) que si filtra.
    ...construirRollupAccidente(filters),
    {
      $group: {
        _id: groupField,
        totalAccidentes: { $sum: 1 },
        totalAfectados: { $sum: '$afectados' },
        accidentesGraves: { $sum: '$esGrave' }
      }
    },
    { $sort: { _id: 1 } }
  ]).option(ESCALAR_AGG);
};

/**
 * Comparativa entre distritos (distrito constante por accidente).
 */
const obtenerComparativaDistritos = function(Model, filters = {}) {
  return Model.aggregate([
    ...construirRollupAccidente(filters),
    {
      $group: {
        _id: '$distrito',
        totalAccidentes: { $sum: 1 },
        totalAfectados: { $sum: '$afectados' },
        accidentesGraves: { $sum: '$esGrave' },
        accidentesMortales: { $sum: '$esMortal' },
        atropellos: { $sum: { $cond: [{ $eq: ['$tipoAccidente', TIPOS_ACCIDENTE.ATROPELLO_A_PERSONA] }, 1, 0] } },
        accidentesAlcohol: { $sum: '$conAlcohol' },
        puntuacionGravedadPromedio: { $avg: '$puntuacionGravedad' },
        turismos: { $sum: { $cond: [{ $in: [TIPOS_VEHICULO.TURISMO, '$tiposVehiculo'] }, 1, 0] } },
        motocicletas: { $sum: { $cond: [{ $in: [TIPOS_VEHICULO.MOTOCICLETA_MAS_125CC, '$tiposVehiculo'] }, 1, 0] } },
        bicicletas: { $sum: { $cond: [{ $in: [TIPOS_VEHICULO.BICICLETA, '$tiposVehiculo'] }, 1, 0] } }
      }
    },
    {
      $addFields: {
        porcentajeGravedad: { $cond: [{ $gt: ['$totalAccidentes', 0] }, { $multiply: [{ $divide: ['$accidentesGraves', '$totalAccidentes'] }, 100] }, 0] },
        porcentajeAtropellos: { $cond: [{ $gt: ['$totalAccidentes', 0] }, { $multiply: [{ $divide: ['$atropellos', '$totalAccidentes'] }, 100] }, 0] },
        porcentajeAlcohol: { $cond: [{ $gt: ['$totalAccidentes', 0] }, { $multiply: [{ $divide: ['$accidentesAlcohol', '$totalAccidentes'] }, 100] }, 0] },
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

/**
 * Seguridad por calle (indice de riesgo ponderado).
 */
const obtenerAnalisisSeguridadCalles = function(Model, filters = {}, limit = 20) {
  return Model.aggregate([
    ...construirRollupAccidente(filters),
    {
      $group: {
        _id: { calle: '$calle', distrito: '$distrito' },
        totalAccidentes: { $sum: 1 },
        totalAfectados: { $sum: '$afectados' },
        accidentesGraves: { $sum: '$esGrave' },
        atropellos: { $sum: { $cond: [{ $eq: ['$tipoAccidente', TIPOS_ACCIDENTE.ATROPELLO_A_PERSONA] }, 1, 0] } },
        accidentesAlcohol: { $sum: '$conAlcohol' },
        indiceSeveridad: { $avg: '$puntuacionGravedad' }
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

/**
 * Tendencia mensual de accidentes.
 */
const obtenerAnalisisTendencias = function(Model, filters = {}) {
  return Model.aggregate([
    ...construirRollupAccidente(filters),
    {
      $group: {
        _id: { año: '$anio', mes: '$mes' },
        totalAccidentes: { $sum: 1 },
        totalAfectados: { $sum: '$afectados' },
        accidentesGraves: { $sum: '$esGrave' }
      }
    },
    { $sort: { '_id.año': 1, '_id.mes': 1 } }
  ]).option(ESCALAR_AGG);
};

/**
 * Correlacion con el estado meteorologico (constante por accidente).
 */
const obtenerCorrelacionMeteorologica = function(Model, filters = {}) {
  return Model.aggregate([
    ...construirRollupAccidente(filters),
    {
      $group: {
        _id: '$estadoMeteorologico',
        totalAccidentes: { $sum: 1 },
        accidentesGraves: { $sum: '$esGrave' }
      }
    },
    {
      $addFields: {
        porcentajeGravedad: { $cond: [{ $gt: ['$totalAccidentes', 0] }, { $multiply: [{ $divide: ['$accidentesGraves', '$totalAccidentes'] }, 100] }, 0] }
      }
    },
    { $sort: { totalAccidentes: -1 } }
  ]).option(ESCALAR_AGG);
};

/**
 * Distribucion de accidentes por distrito (top N).
 */
const obtenerDistribucionDistritos = function(Model, filters = {}, limit = 15) {
  return Model.aggregate([
    ...construirRollupAccidente(filters),
    {
      $group: {
        _id: '$distrito',
        totalAccidentes: { $sum: 1 },
        totalAfectados: { $sum: '$afectados' },
        accidentesGraves: { $sum: '$esGrave' },
        puntuacionGravedadPromedio: { $avg: '$puntuacionGravedad' }
      }
    },
    { $sort: { totalAccidentes: -1 } },
    { $limit: limit }
  ]).option(ESCALAR_AGG);
};

/**
 * Prevalencia de factores de riesgo. Unidad: PERSONA afectada (los factores
 * se registran por victima), por lo que esta metrica es "afectados con factor".
 */
const obtenerAnalisisFactoresRiesgo = function(Model, filters = {}) {
  return Model.aggregate([
    { $match: filters },
    { $unwind: { path: '$analisis.factoresRiesgo', preserveNullAndEmptyArrays: true } },
    { $group: { _id: '$analisis.factoresRiesgo', cantidad: { $sum: 1 } } },
    { $sort: { cantidad: -1 } }
  ]).option(ESCALAR_AGG);
};

/**
 * Heatmap de accidentes: agrupa puntos cercanos en una rejilla geografica
 * (grados WGS84) para reducir ruido visual y devuelve coordenadas lat/lng
 * validas para Leaflet.heat.
 *
 * Usa el campo `ubicacion.geometry` (GeoJSON WGS84 [lon, lat]) en vez de las
 * coordenadas UTM en metros, que antes se emitian erroneamente como lat/lng y
 * dejaban los puntos fuera del mapa.
 *
 * @param {Number} limite - Maximo de registros a procesar
 * @param {Number} precisionGrados - Tamano de celda de la rejilla en grados
 *   (~0.001 grados ≈ 110 m). Acepta tambien el valor en metros heredado y lo
 *   convierte de forma aproximada.
 */
const obtenerDatosMapaCalor = async function(Model, filters = {}, limite = 500, precision = 0.001) {
  // Compatibilidad: si llega una precision "en metros" (heredada, p.ej. 100),
  // la convertimos a grados aproximados (1 grado ~ 111.000 m).
  let precisionGrados = parseFloat(precision);
  if (!Number.isFinite(precisionGrados) || precisionGrados <= 0) { precisionGrados = 0.001; }
  if (precisionGrados >= 1) { precisionGrados = precisionGrados / 111000; }

  const maxCeldas = parseInt(limite, 10) || 500;

  const queryFilters = {
    ...filters,
    'ubicacion.geometry.coordinates': { $exists: true, $ne: [] }
  };

  // Se agregan TODOS los accidentes que cumplen el filtro en celdas de rejilla
  // (no una muestra de `limite` documentos, que sesgaba el heatmap): la rejilla
  // es representativa de toda la serie. `limite` capa ahora el numero de CELDAS
  // devueltas (las mas densas), no los documentos de entrada.
  const lng = { $arrayElemAt: ['$ubicacion.geometry.coordinates', 0] };
  const lat = { $arrayElemAt: ['$ubicacion.geometry.coordinates', 1] };
  const [resultado] = await Model.aggregate([
    { $match: queryFilters },
    {
      $project: {
        cellLng: { $multiply: [{ $round: [{ $divide: [lng, precisionGrados] }, 0] }, precisionGrados] },
        cellLat: { $multiply: [{ $round: [{ $divide: [lat, precisionGrados] }, 0] }, precisionGrados] },
        esNoLeve: { $cond: [{ $in: ['$circunstancias.gravedad', GRAVEDADES_NO_LEVE] }, 1, 0] },
        puntuacion: { $ifNull: ['$analisis.puntuacionGravedad', 0] }
      }
    },
    {
      $group: {
        _id: { lat: '$cellLat', lng: '$cellLng' },
        totalAfectados: { $sum: 1 },
        afectadosGraves: { $sum: '$esNoLeve' },
        sumaPuntuacionGravedad: { $sum: '$puntuacion' }
      }
    },
    { $sort: { totalAfectados: -1 } },
    {
      $facet: {
        celdas: [{ $limit: maxCeldas }],
        resumen: [{ $group: { _id: null, totalCeldas: { $sum: 1 }, totalAfectados: { $sum: '$totalAfectados' } } }]
      }
    }
  ]).option({ allowDiskUse: true, maxTimeMS: MONGODB_TIMEOUTS.AGGREGATE_TIMEOUT_MS });

  const celdas = resultado?.celdas || [];
  const resumen = resultado?.resumen?.[0] || { totalCeldas: 0, totalAfectados: 0 };

  const heatmapPoints = celdas.map(group => ({
    lat: group._id.lat,
    lng: group._id.lng,
    weight: group.totalAfectados,
    intensity: group.totalAfectados > 0 ? group.sumaPuntuacionGravedad / group.totalAfectados : 0,
    details: {
      totalAfectados: group.totalAfectados,
      afectadosGraves: group.afectadosGraves,
      porcentajeGravedad: group.totalAfectados > 0 ? (group.afectadosGraves / group.totalAfectados) * 100 : 0
    }
  }));

  return {
    puntos: heatmapPoints,
    estadisticas: {
      totalPuntos: heatmapPoints.length, // celdas mostradas (top por densidad)
      totalCeldas: resumen.totalCeldas, // celdas totales de toda la serie filtrada
      totalAfectados: resumen.totalAfectados // afectados totales (toda la serie, no la muestra)
    }
  };
};

module.exports = {
  ETAPA_GROUP_EXPEDIENTE,
  construirRollupAccidente,
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
