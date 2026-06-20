/**
 * Modelo de Aforo de Peatones
 *
 * Esquema de Mongoose para almacenar y gestionar datos de conteo horario
 * de trafico peatonal en estaciones de aforo permanentes (Smart City 2051).
 * Estructura paralela a `AforoBicicletas` (CSV `Anthem_CTC_PeatonesAforo.csv`).
 */

const mongoose = require('mongoose');
const { validateDatasetDate } = require('./schemas/commonSchemas');
const {
  DAY_PERIODS,
  DATASET_YEARS,
  VALIDATION_LIMITS,
  MONGODB_TIMEOUTS,
  GEOMETRY_TYPES
} = require('../constants');
const { obtenerFranjaHoraria, inicioDiaUTC } = require('../utils/temporalHelper');
const { construirUbicacionAforo } = require('../utils/ubicacionHelper');
const { upsertConReintento } = require('../utils/ingestaHelper');

const pedestrianTrafficCountSchema = new mongoose.Schema({
  fecha: {
    type: Date,
    required: true,
    index: true,
    validate: {
      validator: validateDatasetDate,
      message: `La fecha debe estar dentro del rango del dataset (${DATASET_YEARS.MIN_YEAR}-${DATASET_YEARS.MAX_YEAR})`
    }
  },

  hora: {
    type: Number,
    required: true,
    min: [0, 'La hora debe ser entre 0 y 23'],
    max: [23, 'La hora debe ser entre 0 y 23']
  },

  identificador: {
    type: String,
    required: true,
    trim: true,
    index: true
  },

  // Numero de peatones contados en la hora
  peatones: {
    type: Number,
    required: true,
    min: [VALIDATION_LIMITS.QUANTITY_MIN, 'El conteo de peatones no puede ser negativo']
  },

  ubicacion: {
    numeroDistrito: { type: Number },
    distrito: { type: String, uppercase: true, trim: true, index: true },
    nombreVial: { type: String, trim: true },
    numero: { type: String, trim: true },
    codigoPostal: { type: String, trim: true },
    observacionesDireccion: { type: String, trim: true },

    coordenadas: {
      latitud: { type: Number },
      longitud: { type: Number }
    },

    // Geometria GeoJSON WGS84 para el endpoint /aforo-peatones/mapa
    // y para queries geoespaciales `$near`/`$geoWithin`.
    // NO usar `default: 'Point'`: Mongoose crearia subdocumentos vacios
    // `{ type: 'Point' }` sin coordinates que rompen el indice 2dsphere
    // (`Can't extract geo keys`) y matan el batch completo. El subdoc se
    // crea solo cuando el importador lo asigna explicito con coordinates.
    geometry: {
      type: {
        type: String,
        enum: [GEOMETRY_TYPES.POINT]
      },
      coordinates: {
        type: [Number],
        required: false,
        validate: {
          validator: function(coords) {
            if (!coords || coords.length === 0) {return true;}
            if (coords.length !== 2) {return false;}
            const [lng, lat] = coords;
            return (
              typeof lng === 'number' &&
              typeof lat === 'number' &&
              lng >= VALIDATION_LIMITS.LONGITUDE_MIN && lng <= VALIDATION_LIMITS.LONGITUDE_MAX &&
              lat >= VALIDATION_LIMITS.LATITUDE_MIN && lat <= VALIDATION_LIMITS.LATITUDE_MAX
            );
          },
          message: 'geometry.coordinates debe ser [lng, lat] dentro de rangos validos'
        }
      }
    }
  },

  franjaHoraria: {
    type: String,
    enum: Object.values(DAY_PERIODS),
    index: true
  },

  año: {
    type: Number,
    min: [DATASET_YEARS.VALIDATION_MIN, `Año debe ser ${DATASET_YEARS.VALIDATION_MIN} o posterior`],
    validate: {
      validator: function(value) {
        return value >= DATASET_YEARS.VALIDATION_MIN && value <= DATASET_YEARS.VALIDATION_MAX;
      },
      message: `Año debe estar entre ${DATASET_YEARS.VALIDATION_MIN} y ${DATASET_YEARS.VALIDATION_MAX}`
    }
  },

  mes: {
    type: Number,
    min: [VALIDATION_LIMITS.MONTH_MIN, `Mes debe estar entre ${VALIDATION_LIMITS.MONTH_MIN} y ${VALIDATION_LIMITS.MONTH_MAX}`],
    max: [VALIDATION_LIMITS.MONTH_MAX, `Mes debe estar entre ${VALIDATION_LIMITS.MONTH_MIN} y ${VALIDATION_LIMITS.MONTH_MAX}`]
  },

  diaSemana: {
    type: Number,
    min: [0, 'Dia de la semana debe estar entre 0 y 6'],
    max: [6, 'Dia de la semana debe estar entre 0 y 6']
  },

  procesamiento: {
    archivoOrigen: { type: String, trim: true },
    importadoEn: { type: Date, default: Date.now }
  }

}, {
  timestamps: true,
  versionKey: false,
  collection: 'pedestrian_traffic_counts'
});

// Indice unico: previene duplicados (estacion, fecha, hora). CRITICO.
pedestrianTrafficCountSchema.index({ identificador: 1, fecha: 1, hora: 1 }, {
  unique: true,
  name: 'idx_ped_traffic_unique_station_date_hour'
});

// Series temporales descendentes (listados por fecha, dashboards).
pedestrianTrafficCountSchema.index({ fecha: -1 }, {
  name: 'idx_ped_traffic_timeline'
});

// Estacion + fecha desc (datos de una estacion concreta).
pedestrianTrafficCountSchema.index({ identificador: 1, fecha: -1 }, {
  name: 'idx_ped_traffic_station_timeline'
});

// Distrito + fecha desc (estadisticas por distrito, comparativas).
pedestrianTrafficCountSchema.index({ 'ubicacion.distrito': 1, fecha: -1 }, {
  name: 'idx_ped_traffic_district_timeline'
});

// Hora (analisis de patrones horarios).
pedestrianTrafficCountSchema.index({ hora: 1 }, {
  name: 'idx_ped_traffic_hour'
});

// Franja horaria + fecha desc.
pedestrianTrafficCountSchema.index({ franjaHoraria: 1, fecha: -1 }, {
  name: 'idx_ped_traffic_period_timeline'
});

// Geoespacial 2dsphere para el endpoint /aforo-peatones/mapa.
// SPARSE: solo indexa documentos con geometry derivada desde lat/lon.
pedestrianTrafficCountSchema.index(
  { 'ubicacion.geometry': '2dsphere' },
  { name: 'idx_ped_geometry_2dsphere', sparse: true }
);

// ========================================
// METODOS ESTATICOS
// ========================================

const AGG_OPTIONS = { allowDiskUse: true, maxTimeMS: MONGODB_TIMEOUTS.AGGREGATE_TIMEOUT_MS };

/**
 * Estadisticas agregadas por rango de fechas.
 */
pedestrianTrafficCountSchema.statics.obtenerEstadisticasPorRangoFechas = function(startDate, endDate, extraMatch = {}) {
  return this.aggregate([
    // `extraMatch` permite acotar por distrito ademas del rango de fechas, para
    // que los KPIs reflejen el filtro activo de la pagina (no la ciudad entera).
    { $match: { fecha: { $gte: startDate, $lte: endDate }, ...extraMatch } },
    {
      $group: {
        _id: null,
        totalMediciones: { $sum: 1 },
        totalPeatones: { $sum: '$peatones' },
        promedioPorHora: { $avg: '$peatones' },
        maxPeatonesHora: { $max: '$peatones' },
        minPeatonesHora: { $min: '$peatones' }
      }
    },
    {
      $project: {
        _id: 0,
        totalMediciones: 1,
        totalPeatones: 1,
        promedioPorHora: { $round: ['$promedioPorHora', 2] },
        maxPeatonesHora: 1,
        minPeatonesHora: 1
      }
    }
  ]).option(AGG_OPTIONS);
};

/**
 * Patrones horarios (promedio por hora 0-23) con filtros opcionales.
 */
pedestrianTrafficCountSchema.statics.obtenerPatronesHorarios = function(filters = {}) {
  const pipeline = [];
  if (Object.keys(filters).length > 0) {
    pipeline.push({ $match: filters });
  }
  pipeline.push(
    {
      $group: {
        _id: '$hora',
        promedioPeatones: { $avg: '$peatones' },
        totalPeatones: { $sum: '$peatones' },
        totalMediciones: { $sum: 1 },
        maxPeatones: { $max: '$peatones' }
      }
    },
    {
      $project: {
        _id: 0,
        hora: '$_id',
        promedioPeatones: { $round: ['$promedioPeatones', 2] },
        totalPeatones: 1,
        totalMediciones: 1,
        maxPeatones: 1
      }
    },
    { $sort: { hora: 1 } }
  );
  return this.aggregate(pipeline).option(AGG_OPTIONS);
};

/**
 * Ranking de estaciones por trafico peatonal total.
 */
pedestrianTrafficCountSchema.statics.obtenerRankingEstaciones = function(limit = 50, filters = {}) {
  const pipeline = [];
  if (Object.keys(filters).length > 0) {
    pipeline.push({ $match: filters });
  }
  pipeline.push(
    {
      $group: {
        _id: '$identificador',
        totalPeatones: { $sum: '$peatones' },
        promedioPorHora: { $avg: '$peatones' },
        totalMediciones: { $sum: 1 },
        maxPeatonesHora: { $max: '$peatones' },
        distrito: { $first: '$ubicacion.distrito' },
        nombreVial: { $first: '$ubicacion.nombreVial' }
      }
    },
    {
      $project: {
        _id: 0,
        identificador: '$_id',
        totalPeatones: 1,
        promedioPorHora: { $round: ['$promedioPorHora', 2] },
        totalMediciones: 1,
        maxPeatonesHora: 1,
        distrito: 1,
        nombreVial: 1
      }
    },
    { $sort: { totalPeatones: -1 } },
    { $limit: limit }
  );
  return this.aggregate(pipeline).option(AGG_OPTIONS);
};

/**
 * Tendencias diarias (agrupacion por fecha).
 */
pedestrianTrafficCountSchema.statics.obtenerTendenciasDiarias = function(filters = {}) {
  const pipeline = [];
  if (Object.keys(filters).length > 0) {
    pipeline.push({ $match: filters });
  }
  pipeline.push(
    {
      $group: {
        _id: {
          año: { $year: '$fecha' },
          mes: { $month: '$fecha' },
          dia: { $dayOfMonth: '$fecha' }
        },
        totalPeatones: { $sum: '$peatones' },
        promedioPorHora: { $avg: '$peatones' },
        totalMediciones: { $sum: 1 }
      }
    },
    {
      $project: {
        _id: 0,
        fecha: '$_id',
        totalPeatones: 1,
        promedioPorHora: { $round: ['$promedioPorHora', 2] },
        totalMediciones: 1
      }
    },
    { $sort: { 'fecha.año': 1, 'fecha.mes': 1, 'fecha.dia': 1 } }
  );
  return this.aggregate(pipeline).option(AGG_OPTIONS);
};

/**
 * Comparativa de distritos por trafico peatonal.
 */
pedestrianTrafficCountSchema.statics.obtenerComparativaDistritos = function(filters = {}) {
  const pipeline = [];
  if (Object.keys(filters).length > 0) {
    pipeline.push({ $match: filters });
  }
  pipeline.push(
    {
      $group: {
        _id: '$ubicacion.distrito',
        totalPeatones: { $sum: '$peatones' },
        promedioPorHora: { $avg: '$peatones' },
        totalMediciones: { $sum: 1 },
        maxPeatonesHora: { $max: '$peatones' },
        estaciones: { $addToSet: '$identificador' }
      }
    },
    {
      $project: {
        _id: 0,
        distrito: '$_id',
        totalPeatones: 1,
        promedioPorHora: { $round: ['$promedioPorHora', 2] },
        totalMediciones: 1,
        maxPeatonesHora: 1,
        numEstaciones: { $size: '$estaciones' }
      }
    },
    { $sort: { totalPeatones: -1 } }
  );
  return this.aggregate(pipeline).option(AGG_OPTIONS);
};

/**
 * Registrar (upsert idempotente) un conteo horario de peatones enviado por un
 * nodo IoT. Clave unica (identificador, fecha-dia, hora): reenviar la misma
 * lectura ACTUALIZA el documento en lugar de duplicarlo.
 *
 * @param {Object} lectura - Lectura del sensor (ver validador de ingesta)
 * @returns {Promise<{estado: 'creado'|'actualizado', creado: boolean, documento: Object}>}
 */
pedestrianTrafficCountSchema.statics.ingestarConteo = function(lectura) {
  const fechaDia = inicioDiaUTC(lectura.fecha);
  const hora = Number(lectura.hora);

  const set = {
    peatones: Number(lectura.peatones),
    franjaHoraria: obtenerFranjaHoraria(hora),
    'año': fechaDia.getUTCFullYear(),
    mes: fechaDia.getUTCMonth() + 1,
    diaSemana: fechaDia.getUTCDay(),
    'procesamiento.archivoOrigen': lectura.origen || 'simulador-iot',
    'procesamiento.importadoEn': new Date()
  };

  if (lectura.ubicacion) {
    set.ubicacion = construirUbicacionAforo(lectura.ubicacion);
  }

  return upsertConReintento(
    this,
    { identificador: String(lectura.identificador).trim(), fecha: fechaDia, hora },
    set
  );
};

// Transformacion de salida para reducir tamano de respuesta.
pedestrianTrafficCountSchema.set('toJSON', {
  transform: (_doc, ret) => {
    delete ret.createdAt;
    delete ret.updatedAt;
    return ret;
  }
});

const PedestrianTrafficCount = mongoose.model('PedestrianTrafficCount', pedestrianTrafficCountSchema);

module.exports = PedestrianTrafficCount;
