/**
 * Modelo de Trafico
 *
 * Esquema de Mongoose para almacenar y gestionar datos de intensidad del trafico
 * provenientes de los sensores distribuidos por la ciudad.
 *
 * La logica de agregaciones, analisis de congestion y mapa vive en
 * `services/traficoService.js`. Este archivo expone schema + indices + metodos
 * de instancia + hooks + wrappers thin sobre los statics.
 */

const mongoose = require('mongoose');
const {
  validateSpeed,
  validatePercentage,
  validateDatasetDate,
  validateMonth,
  validateYear
} = require('./schemas/commonSchemas');
const {
  CONGESTION_LEVELS,
  DATA_QUALITY_LEVELS,
  TRAFFIC_ELEMENT_TYPES,
  TRAFFIC_INTENSITY_LEVELS,
  TRAFFIC_ERROR_CODES,
  DAY_PERIODS,
  WORKDAY_TYPES,
  VALIDATION_LIMITS,
  TRAFFIC_THRESHOLDS,
  BINARY_INDICATORS,
  DATASET_YEARS
} = require('../constants');
const traficoService = require('../services/traficoService');

const trafficSchema = new mongoose.Schema({
  puntoMedidaId: { type: String, required: true, index: true, trim: true },

  fecha: {
    type: Date,
    required: true,
    index: true,
    validate: {
      validator: validateDatasetDate,
      message: `La fecha de medición debe estar dentro del rango del dataset (${DATASET_YEARS.MIN_YEAR}-${DATASET_YEARS.MAX_YEAR})`
    }
  },

  año: {
    type: Number,
    required: true,
    index: true,
    validate: {
      validator: validateYear,
      message: `Año debe estar entre ${VALIDATION_LIMITS.YEAR_MIN} y ${VALIDATION_LIMITS.YEAR_MAX}`
    }
  },

  mes: {
    type: Number,
    required: true,
    index: true,
    validate: { validator: validateMonth, message: 'Mes debe estar entre 1 y 12' }
  },

  dia: {
    type: Number,
    required: true,
    min: [VALIDATION_LIMITS.DAY_MIN, `Día debe estar entre ${VALIDATION_LIMITS.DAY_MIN} y ${VALIDATION_LIMITS.DAY_MAX}`],
    max: [VALIDATION_LIMITS.DAY_MAX, `Día debe estar entre ${VALIDATION_LIMITS.DAY_MIN} y ${VALIDATION_LIMITS.DAY_MAX}`]
  },

  hora: {
    type: Number,
    required: true,
    index: true,
    min: [VALIDATION_LIMITS.HOUR_MIN, `Hora debe estar entre ${VALIDATION_LIMITS.HOUR_MIN} y ${VALIDATION_LIMITS.HOUR_MAX}`],
    max: [VALIDATION_LIMITS.HOUR_MAX, `Hora debe estar entre ${VALIDATION_LIMITS.HOUR_MIN} y ${VALIDATION_LIMITS.HOUR_MAX}`]
  },

  minutos: {
    type: Number,
    required: true,
    min: [VALIDATION_LIMITS.MINUTE_MIN, `Minutos deben estar entre ${VALIDATION_LIMITS.MINUTE_MIN} y ${VALIDATION_LIMITS.MINUTE_MAX}`],
    max: [VALIDATION_LIMITS.MINUTE_MAX, `Minutos deben estar entre ${VALIDATION_LIMITS.MINUTE_MIN} y ${VALIDATION_LIMITS.MINUTE_MAX}`]
  },

  tipoElemento: {
    type: String,
    required: true,
    enum: Object.values(TRAFFIC_ELEMENT_TYPES),
    index: true,
    uppercase: true
  },

  metricas: {
    intensidad: {
      type: Number,
      required: true,
      index: true,
      validate: {
        validator: function(v) {
          return v >= VALIDATION_LIMITS.TRAFFIC_INTENSITY_MIN && v <= VALIDATION_LIMITS.TRAFFIC_INTENSITY_MAX;
        },
        message: `Intensidad debe estar entre ${VALIDATION_LIMITS.TRAFFIC_INTENSITY_MIN} y ${VALIDATION_LIMITS.TRAFFIC_INTENSITY_MAX} veh/h (límite físico razonable)`
      }
    },
    ocupacion: {
      type: Number,
      required: false,
      default: null,
      validate: {
        validator: function(v) {
          if (v === null || v === undefined) {return true;}
          return validatePercentage(v);
        },
        message: 'Ocupación debe estar entre 0 y 100% o ser null'
      }
    },
    carga: {
      type: Number,
      required: false,
      default: null,
      validate: {
        validator: function(v) {
          if (v === null || v === undefined) {return true;}
          return v >= 0 && v <= 100;
        },
        message: 'Carga debe estar entre 0 y 100 o ser null'
      }
    },
    velocidadMedia: {
      type: Number,
      required: false,
      default: null,
      validate: {
        validator: function(v) {
          if (v === null || v === undefined) {return true;}
          return validateSpeed(v);
        },
        message: `Velocidad media debe estar entre ${VALIDATION_LIMITS.SPEED_MIN} y ${VALIDATION_LIMITS.SPEED_MAX} km/h o ser null`
      }
    }
  },

  calidadDatos: {
    error: {
      type: String,
      required: true,
      enum: TRAFFIC_ERROR_CODES,
      default: BINARY_INDICATORS.NO
    },
    periodoIntegracion: { type: Number, required: true },
    calidadGeneral: {
      type: String,
      enum: Object.values(DATA_QUALITY_LEVELS),
      default: 'SIN_DATOS'
    }
  },

  analisis: {
    nivelCongestion: {
      type: String,
      enum: Object.values(CONGESTION_LEVELS),
      default: 'SIN_DATOS',
      index: true
    },
    clasificacionIntensidad: {
      type: String,
      enum: TRAFFIC_INTENSITY_LEVELS,
      default: 'SIN_DATOS',
      index: true
    },
    periodoDia: {
      type: String,
      enum: Object.values(DAY_PERIODS),
      default: DAY_PERIODS.MAÑANA,
      index: true
    },
    tipoJornada: {
      type: String,
      enum: Object.values(WORKDAY_TYPES),
      default: 'LABORABLE',
      index: true
    }
  },

  procesamiento: {
    importadoEn: { type: Date, default: Date.now },
    archivoOrigen: { type: String, trim: true },
    validacionesPasadas: [{
      validacion: String,
      resultado: Boolean,
      fecha: { type: Date, default: Date.now }
    }]
  }
}, {
  timestamps: true,
  versionKey: false,
  collection: 'traffic_measurements'
});

/**
 * Indices para optimizacion de consultas.
 */

// Unico: prevencion duplicados (puntoMedidaId + fecha)
trafficSchema.index(
  { puntoMedidaId: 1, fecha: 1 },
  { unique: true, name: 'traffic_unique_measurement' }
);

// Sort fecha + filtro punto + ordenacion por intensidad (multipropsito leftmost prefix)
trafficSchema.index(
  { fecha: -1, puntoMedidaId: 1, 'metricas.intensidad': -1 },
  { name: 'idx_traffic_date_point_intensity' }
);

// Componentes temporales para analisis por periodos
trafficSchema.index({ año: 1, mes: 1, dia: 1, hora: 1 }, { name: 'idx_traffic_temporal_components' });

// Filtro tipoElemento + fecha
trafficSchema.index({ tipoElemento: 1, fecha: -1 }, { name: 'idx_traffic_type_timeline' });

// Velocidad M30 (partial: solo M30 con velocidad numerica - ahorra ~40-50% de espacio)
trafficSchema.index({ 'metricas.velocidadMedia': -1, fecha: -1 }, {
  name: 'idx_traffic_speed_m30',
  partialFilterExpression: {
    'metricas.velocidadMedia': { $type: 'number' },
    tipoElemento: TRAFFIC_ELEMENT_TYPES.M30
  }
});

// Filtro nivel congestion
trafficSchema.index({ 'analisis.nivelCongestion': 1, fecha: -1 }, { name: 'idx_traffic_congestion_timeline' });

// Patrones por periodo del dia + tipo de via
trafficSchema.index({ 'analisis.periodoDia': 1, tipoElemento: 1 }, { name: 'idx_traffic_period_type' });

// Patrones de trafico (group por tipo + periodo + jornada)
trafficSchema.index({
  tipoElemento: 1,
  'analisis.periodoDia': 1,
  'analisis.tipoJornada': 1,
  fecha: -1
}, { name: 'idx_traffic_pattern_analysis' });

// Historico de congestion por punto
trafficSchema.index({
  puntoMedidaId: 1,
  'analisis.nivelCongestion': 1,
  fecha: -1
}, { name: 'idx_traffic_point_congestion_history' });

// Cobertura para listados (evita fetch completo)
trafficSchema.index({
  fecha: -1,
  puntoMedidaId: 1,
  'metricas.intensidad': 1,
  'metricas.ocupacion': 1,
  'metricas.carga': 1,
  'analisis.nivelCongestion': 1
}, { name: 'idx_traffic_list_cover' });

// Transformacion JSON: reducir payload
trafficSchema.set('toJSON', {
  transform: (_doc, ret) => {
    delete ret.createdAt;
    delete ret.updatedAt;
    delete ret.procesamiento;
    return ret;
  }
});

/**
 * Metodos de instancia (clasificacion y calidad)
 */
trafficSchema.methods.calculateCongestionLevel = function() {
  const ocupacion = this.metricas.ocupacion || 0;
  const carga = this.metricas.carga || 0;

  if (this.calidadDatos.error !== TRAFFIC_ERROR_CODES.NO_ERROR) {
    this.analisis.nivelCongestion = CONGESTION_LEVELS.SIN_DATOS;
    return;
  }

  if (ocupacion >= TRAFFIC_THRESHOLDS.CONGESTION_CRITICAL_OCCUPANCY || carga >= TRAFFIC_THRESHOLDS.CONGESTION_CRITICAL_LOAD) {
    this.analisis.nivelCongestion = CONGESTION_LEVELS.COLAPSADO;
  } else if (ocupacion >= TRAFFIC_THRESHOLDS.CONGESTION_HIGH_OCCUPANCY || carga >= TRAFFIC_THRESHOLDS.CONGESTION_HIGH_LOAD) {
    this.analisis.nivelCongestion = CONGESTION_LEVELS.CONGESTIONADO;
  } else if (ocupacion >= TRAFFIC_THRESHOLDS.CONGESTION_MEDIUM_OCCUPANCY || carga >= TRAFFIC_THRESHOLDS.CONGESTION_MEDIUM_LOAD) {
    this.analisis.nivelCongestion = CONGESTION_LEVELS.DENSO;
  } else {
    this.analisis.nivelCongestion = CONGESTION_LEVELS.FLUIDO;
  }
};

trafficSchema.methods.calculateIntensityClassification = function() {
  const intensidad = this.metricas.intensidad || 0;

  if (this.calidadDatos.error !== TRAFFIC_ERROR_CODES.NO_ERROR) {
    this.analisis.clasificacionIntensidad = TRAFFIC_INTENSITY_LEVELS.SIN_DATOS;
    return;
  }

  if (intensidad >= TRAFFIC_THRESHOLDS.INTENSITY_VERY_HIGH) {
    this.analisis.clasificacionIntensidad = TRAFFIC_INTENSITY_LEVELS.MUY_ALTA;
  } else if (intensidad >= TRAFFIC_THRESHOLDS.INTENSITY_HIGH) {
    this.analisis.clasificacionIntensidad = TRAFFIC_INTENSITY_LEVELS.ALTA;
  } else if (intensidad >= TRAFFIC_THRESHOLDS.INTENSITY_MEDIUM) {
    this.analisis.clasificacionIntensidad = TRAFFIC_INTENSITY_LEVELS.MEDIA;
  } else if (intensidad >= TRAFFIC_THRESHOLDS.INTENSITY_LOW) {
    this.analisis.clasificacionIntensidad = TRAFFIC_INTENSITY_LEVELS.BAJA;
  } else {
    this.analisis.clasificacionIntensidad = TRAFFIC_INTENSITY_LEVELS.MUY_BAJA;
  }
};

trafficSchema.methods.calculateOverallQuality = function() {
  const error = this.calidadDatos.error;
  const periodoIntegracion = this.calidadDatos.periodoIntegracion || 0;

  if (error === TRAFFIC_ERROR_CODES.NO_ERROR && periodoIntegracion >= TRAFFIC_THRESHOLDS.DATA_QUALITY_EXCELLENT_PERIOD) {
    this.calidadDatos.calidadGeneral = DATA_QUALITY_LEVELS.ALTA;
  } else if (error === TRAFFIC_ERROR_CODES.SIN_DATOS && periodoIntegracion >= TRAFFIC_THRESHOLDS.DATA_QUALITY_GOOD_PERIOD) {
    this.calidadDatos.calidadGeneral = DATA_QUALITY_LEVELS.MEDIA;
  } else if (periodoIntegracion >= TRAFFIC_THRESHOLDS.DATA_QUALITY_ACCEPTABLE_PERIOD) {
    this.calidadDatos.calidadGeneral = DATA_QUALITY_LEVELS.BAJA;
  } else {
    this.calidadDatos.calidadGeneral = DATA_QUALITY_LEVELS.SIN_DATOS;
  }
};

/**
 * Middleware pre-save: extrae componentes de fecha y aplica clasificaciones.
 */
trafficSchema.pre('save', function(next) {
  if (this.fecha) {
    this.año = this.fecha.getFullYear();
    this.mes = this.fecha.getMonth() + 1;
    this.dia = this.fecha.getDate();
    this.hora = this.fecha.getHours();
    this.minutos = this.fecha.getMinutes();
  }

  if (!this.analisis) {this.analisis = {};}
  if (!this.analisis.nivelCongestion) {this.calculateCongestionLevel();}
  if (!this.analisis.clasificacionIntensidad) {this.calculateIntensityClassification();}
  if (!this.calidadDatos) {this.calidadDatos = {};}
  if (!this.calidadDatos.calidadGeneral) {this.calculateOverallQuality();}

  next();
});

/**
 * Metodos estaticos delegados a `services/traficoService.js`.
 */
trafficSchema.statics.obtenerAnalisisCongestionOptimizado = function(filters, groupBy) {
  return traficoService.obtenerAnalisisCongestionOptimizado(this, filters, groupBy);
};

trafficSchema.statics.obtenerDatosHistoricosOptimizado = function(filters, aggregation) {
  return traficoService.obtenerDatosHistoricosOptimizado(this, filters, aggregation);
};

trafficSchema.statics.getTrafficStatisticsOptimized = function(filters) {
  return traficoService.getTrafficStatisticsOptimized(this, filters);
};

trafficSchema.statics.obtenerAgregadoParaMapa = function(filtros) {
  return traficoService.obtenerAgregadoParaMapa(this, filtros);
};

const Traffic = mongoose.model('Traffic', trafficSchema);

module.exports = Traffic;
