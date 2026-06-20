/**
 * Modelo de Aforo de Bicicletas
 *
 * Esquema de Mongoose para almacenar y gestionar datos de conteo horario
 * de trafico de bicicletas en estaciones de aforo permanentes.
 * Contiene informacion sobre ubicacion, hora y volumen de bicicletas.
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

/**
 * Esquema de Aforo de Bicicletas
 *
 * Define la estructura de los documentos de conteo horario de bicicletas
 * con indices optimizados para consultas frecuentes.
 */
const bikeTrafficCountSchema = new mongoose.Schema({
  // Fecha de la medicion
  fecha: {
    type: Date,
    required: true,
    index: true,
    validate: {
      validator: validateDatasetDate,
      message: `La fecha debe estar dentro del rango del dataset (${DATASET_YEARS.MIN_YEAR}-${DATASET_YEARS.MAX_YEAR})`
    }
  },

  // Hora de la medicion (0-23)
  hora: {
    type: Number,
    required: true,
    min: [0, 'La hora debe ser entre 0 y 23'],
    max: [23, 'La hora debe ser entre 0 y 23']
  },

  // Identificador de la estacion de aforo
  identificador: {
    type: String,
    required: true,
    trim: true,
    index: true
  },

  // Numero de bicicletas contadas en la hora
  bicicletas: {
    type: Number,
    required: true,
    min: [VALIDATION_LIMITS.QUANTITY_MIN, 'El conteo de bicicletas no puede ser negativo']
  },

  // Informacion de ubicacion
  ubicacion: {
    numeroDistrito: {
      type: Number
    },

    distrito: {
      type: String,
      uppercase: true,
      trim: true,
      index: true
    },

    nombreVial: {
      type: String,
      trim: true
    },

    numero: {
      type: String,
      trim: true
    },

    codigoPostal: {
      type: String,
      trim: true
    },

    observacionesDireccion: {
      type: String,
      trim: true
    },

    coordenadas: {
      latitud: {
        type: Number
      },
      longitud: {
        type: Number
      }
    },

    // Geometria GeoJSON WGS84 para el endpoint /aforo-bicicletas/mapa
    // y para queries geoespaciales `$near`/`$geoWithin`.
    // NO usar `default: 'Point'`: Mongoose crearia subdocumentos vacios
    // que rompen el indice 2dsphere sparse. Se crea solo cuando el
    // importador asigna geometry explicitamente.
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

  // Campos calculados para analisis
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

  // Informacion de procesamiento
  procesamiento: {
    archivoOrigen: {
      type: String,
      trim: true
    },
    importadoEn: {
      type: Date,
      default: Date.now
    }
  }

}, {
  timestamps: true,
  versionKey: false,
  collection: 'bike_traffic_counts'
});

// ========================================
// INDICE UNICO - Prevencion de duplicados
// ========================================
// Garantiza que solo exista un registro por estacion, fecha y hora
// CRITICO: NO ELIMINAR
bikeTrafficCountSchema.index({ identificador: 1, fecha: 1, hora: 1 }, {
  unique: true,
  name: 'idx_bike_traffic_unique_station_date_hour'
});

// ========================================
// INDICES PRINCIPALES - Consultas frecuentes
// ========================================

// Indice para series temporales descendentes
// Usado en: GET /api/bike-traffic?sortOrder=desc
// Soporta: Listados de datos mas recientes primero, dashboards
bikeTrafficCountSchema.index({ fecha: -1 }, {
  name: 'idx_bike_traffic_timeline'
});

// Indice compuesto: estacion + fecha descendente
// Usado en: GET /api/bike-traffic/station/:identificador
// Soporta: Consultas de datos de una estacion especifica
bikeTrafficCountSchema.index({ identificador: 1, fecha: -1 }, {
  name: 'idx_bike_traffic_station_timeline'
});

// Indice compuesto: distrito + fecha descendente
// Usado en: GET /api/bike-traffic?distrito=ARGANZUELA
// Soporta: Estadisticas por distrito, comparativas geograficas
bikeTrafficCountSchema.index({ 'ubicacion.distrito': 1, fecha: -1 }, {
  name: 'idx_bike_traffic_district_timeline'
});

// Indice para consultas por hora
// Usado en: Analisis de patrones horarios
bikeTrafficCountSchema.index({ hora: 1 }, {
  name: 'idx_bike_traffic_hour'
});

// Indice compuesto: franja horaria + fecha descendente
// Usado en: Analisis de patrones por franja del dia
bikeTrafficCountSchema.index({ franjaHoraria: 1, fecha: -1 }, {
  name: 'idx_bike_traffic_period_timeline'
});

// Indice geoespacial 2dsphere sobre ubicacion.geometry (WGS84) para el
// endpoint GET /aforo-bicicletas/mapa. SPARSE: solo indexa documentos
// con geometry derivada desde lat/lon.
bikeTrafficCountSchema.index(
  { 'ubicacion.geometry': '2dsphere' },
  { name: 'idx_aforo_geometry_2dsphere', sparse: true }
);

// ========================================
// METODOS ESTATICOS
// ========================================

/**
 * Obtener estadisticas por rango de fechas
 *
 * @param {Date} startDate - Fecha de inicio
 * @param {Date} endDate - Fecha de fin
 * @returns {Promise<Array>} Estadisticas agregadas
 */
bikeTrafficCountSchema.statics.obtenerEstadisticasPorRangoFechas = function(startDate, endDate, extraMatch = {}) {
  return this.aggregate([
    {
      // `extraMatch` permite acotar por distrito (u otros) ademas del rango de
      // fechas, para que los KPIs reflejen el filtro activo de la pagina.
      $match: {
        fecha: { $gte: startDate, $lte: endDate },
        ...extraMatch
      }
    },
    {
      $group: {
        _id: null,
        totalMediciones: { $sum: 1 },
        totalBicicletas: { $sum: '$bicicletas' },
        promedioPorHora: { $avg: '$bicicletas' },
        maxBicicletasHora: { $max: '$bicicletas' },
        minBicicletasHora: { $min: '$bicicletas' }
      }
    },
    {
      $project: {
        _id: 0,
        totalMediciones: 1,
        totalBicicletas: 1,
        promedioPorHora: { $round: ['$promedioPorHora', 2] },
        maxBicicletasHora: 1,
        minBicicletasHora: 1
      }
    }
  ]).option({ allowDiskUse: true, maxTimeMS: MONGODB_TIMEOUTS.AGGREGATE_TIMEOUT_MS });
};

/**
 * Obtener patrones horarios (promedio de bicicletas por hora 0-23)
 *
 * @param {Object} filters - Filtros de consulta (fecha, distrito, etc.)
 * @returns {Promise<Array>} Distribucion horaria
 */
bikeTrafficCountSchema.statics.obtenerPatronesHorarios = function(filters = {}) {
  const pipeline = [];

  if (Object.keys(filters).length > 0) {
    pipeline.push({ $match: filters });
  }

  pipeline.push(
    {
      $group: {
        _id: '$hora',
        promedioBicicletas: { $avg: '$bicicletas' },
        totalBicicletas: { $sum: '$bicicletas' },
        totalMediciones: { $sum: 1 },
        maxBicicletas: { $max: '$bicicletas' }
      }
    },
    {
      $project: {
        _id: 0,
        hora: '$_id',
        promedioBicicletas: { $round: ['$promedioBicicletas', 2] },
        totalBicicletas: 1,
        totalMediciones: 1,
        maxBicicletas: 1
      }
    },
    { $sort: { hora: 1 } }
  );

  return this.aggregate(pipeline).option({ allowDiskUse: true, maxTimeMS: MONGODB_TIMEOUTS.AGGREGATE_TIMEOUT_MS });
};

/**
 * Obtener ranking de estaciones por trafico total
 *
 * @param {Number} limit - Numero de estaciones a retornar
 * @param {Object} filters - Filtros de consulta
 * @returns {Promise<Array>} Estaciones ordenadas por trafico
 */
bikeTrafficCountSchema.statics.obtenerRankingEstaciones = function(limit = 50, filters = {}) {
  const pipeline = [];

  if (Object.keys(filters).length > 0) {
    pipeline.push({ $match: filters });
  }

  pipeline.push(
    {
      $group: {
        _id: '$identificador',
        totalBicicletas: { $sum: '$bicicletas' },
        promedioPorHora: { $avg: '$bicicletas' },
        totalMediciones: { $sum: 1 },
        maxBicicletasHora: { $max: '$bicicletas' },
        distrito: { $first: '$ubicacion.distrito' },
        nombreVial: { $first: '$ubicacion.nombreVial' }
      }
    },
    {
      $project: {
        _id: 0,
        identificador: '$_id',
        totalBicicletas: 1,
        promedioPorHora: { $round: ['$promedioPorHora', 2] },
        totalMediciones: 1,
        maxBicicletasHora: 1,
        distrito: 1,
        nombreVial: 1
      }
    },
    { $sort: { totalBicicletas: -1 } },
    { $limit: limit }
  );

  return this.aggregate(pipeline).option({ allowDiskUse: true, maxTimeMS: MONGODB_TIMEOUTS.AGGREGATE_TIMEOUT_MS });
};

/**
 * Obtener tendencias diarias (total de bicicletas agrupado por fecha)
 *
 * @param {Object} filters - Filtros de consulta
 * @returns {Promise<Array>} Tendencias diarias
 */
bikeTrafficCountSchema.statics.obtenerTendenciasDiarias = function(filters = {}) {
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
        totalBicicletas: { $sum: '$bicicletas' },
        promedioPorHora: { $avg: '$bicicletas' },
        totalMediciones: { $sum: 1 }
      }
    },
    {
      $project: {
        _id: 0,
        fecha: '$_id',
        totalBicicletas: 1,
        promedioPorHora: { $round: ['$promedioPorHora', 2] },
        totalMediciones: 1
      }
    },
    { $sort: { 'fecha.año': 1, 'fecha.mes': 1, 'fecha.dia': 1 } }
  );

  return this.aggregate(pipeline).option({ allowDiskUse: true, maxTimeMS: MONGODB_TIMEOUTS.AGGREGATE_TIMEOUT_MS });
};

/**
 * Comparar distritos por trafico de bicicletas
 *
 * @param {Object} filters - Filtros de consulta
 * @returns {Promise<Array>} Comparativa de distritos
 */
bikeTrafficCountSchema.statics.obtenerComparativaDistritos = function(filters = {}) {
  const pipeline = [];

  if (Object.keys(filters).length > 0) {
    pipeline.push({ $match: filters });
  }

  pipeline.push(
    {
      $group: {
        _id: '$ubicacion.distrito',
        totalBicicletas: { $sum: '$bicicletas' },
        promedioPorHora: { $avg: '$bicicletas' },
        totalMediciones: { $sum: 1 },
        maxBicicletasHora: { $max: '$bicicletas' },
        estaciones: { $addToSet: '$identificador' }
      }
    },
    {
      $project: {
        _id: 0,
        distrito: '$_id',
        totalBicicletas: 1,
        promedioPorHora: { $round: ['$promedioPorHora', 2] },
        totalMediciones: 1,
        maxBicicletasHora: 1,
        numEstaciones: { $size: '$estaciones' }
      }
    },
    { $sort: { totalBicicletas: -1 } }
  );

  return this.aggregate(pipeline).option({ allowDiskUse: true, maxTimeMS: MONGODB_TIMEOUTS.AGGREGATE_TIMEOUT_MS });
};

/**
 * Registrar (upsert idempotente) un conteo horario de bicicletas enviado por un
 * nodo IoT. Clave unica (identificador, fecha-dia, hora): reenviar la misma
 * lectura ACTUALIZA el documento en lugar de duplicarlo.
 *
 * Deriva franjaHoraria/año/mes/diaSemana y construye la geometria GeoJSON solo
 * cuando llegan coordenadas validas (nunca geometry vacio: rompe el indice
 * 2dsphere sparse).
 *
 * @param {Object} lectura - Lectura del sensor (ver validador de ingesta)
 * @returns {Promise<{estado: 'creado'|'actualizado', creado: boolean, documento: Object}>}
 */
bikeTrafficCountSchema.statics.ingestarConteo = function(lectura) {
  const fechaDia = inicioDiaUTC(lectura.fecha);
  const hora = Number(lectura.hora);

  const set = {
    bicicletas: Number(lectura.bicicletas),
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

// Transformacion de salida para reducir tamano de respuesta
bikeTrafficCountSchema.set('toJSON', {
  transform: (_doc, ret) => {
    delete ret.createdAt;
    delete ret.updatedAt;
    return ret;
  }
});

// Crear y exportar el modelo
const BikeTrafficCount = mongoose.model('BikeTrafficCount', bikeTrafficCountSchema);

module.exports = BikeTrafficCount;
