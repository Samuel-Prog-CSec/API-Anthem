/**
 * Modelo de Multas
 *
 * Esquema de Mongoose para almacenar y gestionar datos de multas de trafico
 * provenientes del sistema municipal. Incluye informacion sobre infracciones,
 * ubicacion, importes y datos del vehiculo infractor.
 *
 * La logica de agregaciones y analisis vive en `services/multaService.js`.
 * Este archivo expone schema + indices + hooks + wrappers thin.
 */

const mongoose = require('mongoose');
const {
  coordinatesUTMSchema,
  validateTimeFormat,
  validateDatasetDate,
  validateAmount,
  validateSpeed,
  validateLicensePoints,
  validateMonth,
  validateYear
} = require('./schemas/commonSchemas');
const {
  SEVERITY_LEVELS,
  INFRACTION_TYPES,
  FINE_CONFIG,
  VALIDATION_LIMITS,
  DATASET_YEARS,
  GEOMETRY_TYPES
} = require('../constants');
const multaService = require('../services/multaService');

const multaSchema = new mongoose.Schema({
  fecha: {
    type: Date,
    required: true,
    index: true,
    validate: {
      validator: validateDatasetDate,
      message: `La fecha de la multa debe estar dentro del rango del dataset (${DATASET_YEARS.MIN_YEAR}-${DATASET_YEARS.MAX_YEAR})`
    }
  },

  mes: {
    type: Number,
    required: true,
    index: true,
    validate: { validator: validateMonth, message: 'Mes debe estar entre 1 y 12' }
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

  hora: {
    type: String,
    required: true,
    trim: true,
    index: true,
    validate: { validator: validateTimeFormat, message: 'Hora debe tener formato válido HH:MM o HH.MM' }
  },

  calificacion: {
    type: String,
    required: true,
    trim: true,
    enum: Object.values(SEVERITY_LEVELS.FINE),
    uppercase: true,
    index: true
  },

  lugar: { type: String, required: true, trim: true, index: true },

  coordenadas: { type: coordinatesUTMSchema, required: false },

  // Geometria GeoJSON WGS84 derivada desde UTM en el importador. Necesaria
  // para queries `$near`/`$geoWithin` y el endpoint GET /multas/mapa.
  // OJO: NO usar `default: 'Point'` en `geometry.type`. Si lo usaras,
  // Mongoose creara automaticamente `geometry: { type: 'Point' }` sin
  // `coordinates` en cualquier doc que no lo provea, y el indice
  // 2dsphere fallaria silenciosamente (`Can't extract geo keys`)
  // rompiendo todo el bulkWrite. Sin default, el subdocumento solo se
  // crea cuando el importador lo asigna explicitamente con coordinates.
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
            typeof lng === 'number' && typeof lat === 'number' &&
            lng >= VALIDATION_LIMITS.LONGITUDE_MIN && lng <= VALIDATION_LIMITS.LONGITUDE_MAX &&
            lat >= VALIDATION_LIMITS.LATITUDE_MIN && lat <= VALIDATION_LIMITS.LATITUDE_MAX
          );
        },
        message: 'geometry.coordinates debe ser [lng, lat] dentro de rangos validos'
      }
    }
  },

  importeBoletín: {
    type: Number,
    required: true,
    index: true,
    min: [VALIDATION_LIMITS.QUANTITY_MIN, 'Importe del boletín no puede ser negativo'],
    validate: {
      validator: validateAmount,
      message: 'Importe del boletín debe ser válido (máximo 2 decimales, no negativo)'
    }
  },

  tieneDescuento: { type: Boolean, required: true, default: false, index: true },

  importeFinal: {
    type: Number,
    required: false,
    min: [VALIDATION_LIMITS.QUANTITY_MIN, 'Importe final no puede ser negativo'],
    validate: [
      {
        validator: validateAmount,
        message: 'Importe final debe ser válido (máximo 2 decimales, no negativo)'
      },
      {
        validator: function(v) {
          if (v === null || v === undefined) {return true;}
          return v <= this.importeBoletín;
        },
        message: 'Importe final no puede ser mayor que el importe del boletín'
      }
    ]
  },

  puntosDetraídos: {
    type: Number,
    required: true,
    index: true,
    validate: {
      validator: validateLicensePoints,
      message: `Puntos detraídos deben estar entre ${VALIDATION_LIMITS.DRIVER_POINTS_MIN} y ${VALIDATION_LIMITS.DRIVER_POINTS_MAX}`
    }
  },

  denunciante: { type: String, required: true, trim: true, index: true },
  descripcionInfraccion: { type: String, required: true, trim: true },

  datosVelocidad: {
    velocidadLimite: {
      type: Number,
      required: false,
      min: [VALIDATION_LIMITS.SPEED_MIN, 'Velocidad límite no puede ser negativa'],
      validate: {
        validator: validateSpeed,
        message: `Velocidad límite debe estar entre ${VALIDATION_LIMITS.SPEED_MIN} y ${VALIDATION_LIMITS.SPEED_MAX} km/h`
      }
    },
    velocidadCirculacion: {
      type: Number,
      required: false,
      min: [VALIDATION_LIMITS.SPEED_MIN, 'Velocidad de circulación no puede ser negativa'],
      validate: {
        validator: validateSpeed,
        message: `Velocidad de circulación debe estar entre ${VALIDATION_LIMITS.SPEED_MIN} y ${VALIDATION_LIMITS.SPEED_MAX} km/h`
      }
    },
    exceso: {
      type: Number,
      required: false,
      min: [VALIDATION_LIMITS.SPEED_MIN, 'Exceso de velocidad no puede ser negativo'],
      validate: {
        validator: function(v) {
          if (v === null || v === undefined) {return true;}
          if (!this.datosVelocidad.velocidadLimite || !this.datosVelocidad.velocidadCirculacion) {
            return true;
          }
          const excesoCalculado = this.datosVelocidad.velocidadCirculacion - this.datosVelocidad.velocidadLimite;
          return Math.abs(v - excesoCalculado) < 1; // Tolerancia 1 km/h por redondeos
        },
        message: 'Exceso de velocidad debe ser coherente con velocidadCirculacion - velocidadLimite'
      }
    }
  },

  metadatos: {
    tipoInfraccion: {
      type: String,
      enum: Object.values(INFRACTION_TYPES),
      default: INFRACTION_TYPES.OTRAS
    },
    esInfraccionGrave: {
      type: Boolean,
      default: function() {
        return this.calificacion === SEVERITY_LEVELS.FINE.GRAVE ||
               this.calificacion === SEVERITY_LEVELS.FINE.MUY_GRAVE;
      }
    },
    esInfraccionVelocidad: {
      type: Boolean,
      default: function() {
        return this.datosVelocidad.velocidadLimite !== null;
      }
    },
    zonaUrbana: { type: Boolean, default: true },
    // Marca true cuando la calificacion vino vacia o invalida en el CSV
    // y se asigno LEVE por defecto. Permite distinguir LEVE real de LEVE
    // inferido en analisis BI sin perder esa diferencia.
    calificacionInferida: { type: Boolean, default: false }
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
  collection: 'fines',
  toJSON: {
    transform: (_doc, ret) => {
      delete ret.createdAt;
      delete ret.updatedAt;
      return ret;
    }
  }
});

/**
 * Indices para optimizacion de consultas.
 */

// Identificacion de multas (lugar + fecha + hora + importe)
multaSchema.index(
  { lugar: 1, fecha: 1, hora: 1, importeBoletín: 1 },
  { unique: false, name: 'fine_identification' }
);

// Multas recientes por gravedad
multaSchema.index({ fecha: -1, calificacion: 1 });

// Agregaciones mensuales por gravedad
multaSchema.index({ año: 1, mes: 1, calificacion: 1 });

// Multas por ubicacion
multaSchema.index({ lugar: 1, fecha: -1 });

// Multas por denunciante (Policia Municipal, Radar, etc.)
multaSchema.index({ denunciante: 1, fecha: -1 });

// Ranking por importe
multaSchema.index({ importeBoletín: -1, fecha: -1 });

// Ranking por puntos detraidos
multaSchema.index({ puntosDetraídos: -1, fecha: -1 });

// Coordenadas UTM (sparse, opcionales)
multaSchema.index({ 'coordenadas.x': 1, 'coordenadas.y': 1 }, { sparse: true });

// Geoespacial 2dsphere para /multas/mapa
multaSchema.index(
  { geometry: '2dsphere' },
  { name: 'idx_multas_geometry_2dsphere', sparse: true }
);

// Filtros por tipo de infraccion
multaSchema.index({ 'metadatos.tipoInfraccion': 1, fecha: -1 });

// Filtros por gravedad
multaSchema.index({ 'metadatos.esInfraccionGrave': 1, fecha: -1 });

// Filtros por descuento
multaSchema.index({ tieneDescuento: 1, fecha: -1 });

// Estadisticas por ubicacion
multaSchema.index({ fecha: -1, lugar: 1, calificacion: 1 }, { name: 'idx_fines_statistics' });

// Series temporales por lugar
multaSchema.index({ año: 1, mes: 1, lugar: 1 }, { name: 'idx_fines_temporal' });

// Indice de texto completo (lugar/descripcion/denunciante)
multaSchema.index({ lugar: 'text', descripcionInfraccion: 'text', denunciante: 'text' });

// Indice cubierto para listados (evita fetch de documento completo)
multaSchema.index({
  fecha: -1,
  calificacion: 1,
  importeFinal: -1,
  lugar: 1
}, { name: 'idx_multas_listado_cobertura' });

/**
 * Middleware pre-save para procesamiento automatico.
 */
multaSchema.pre('save', function(next) {
  if (!this.fecha && this.mes && this.año) {
    this.fecha = new Date(this.año, this.mes - 1, 1);
  }

  if (this.tieneDescuento && this.importeBoletín) {
    this.importeFinal = this.importeBoletín * FINE_CONFIG.DISCOUNT_RATE;
  } else {
    this.importeFinal = this.importeBoletín;
  }

  if (this.datosVelocidad.velocidadLimite && this.datosVelocidad.velocidadCirculacion) {
    this.datosVelocidad.exceso = Math.max(
      0,
      this.datosVelocidad.velocidadCirculacion - this.datosVelocidad.velocidadLimite
    );
    this.metadatos.esInfraccionVelocidad = true;
    this.metadatos.tipoInfraccion = INFRACTION_TYPES.VELOCIDAD;
  }

  next();
});

/**
 * Metodos estaticos delegados a `services/multaService.js`.
 */
multaSchema.statics.obtenerEstadisticasOptimizadas = function(options) {
  return multaService.obtenerEstadisticasOptimizadas(this, options);
};

multaSchema.statics.obtenerRankingUbicacionesOptimizado = function(options) {
  return multaService.obtenerRankingUbicacionesOptimizado(this, options);
};

multaSchema.statics.obtenerAnalisisTemporalOptimizado = function(options) {
  return multaService.obtenerAnalisisTemporalOptimizado(this, options);
};

multaSchema.statics.obtenerMetricasPanel = function(fechaInicio, fechaFin, options) {
  return multaService.obtenerMetricasPanel(this, fechaInicio, fechaFin, options);
};

const Multa = mongoose.model('Multa', multaSchema);

module.exports = Multa;
