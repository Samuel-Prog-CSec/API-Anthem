/**
 * Modelo de Contaminación Acústica
 *
 * Esquema de Mongoose para almacenar y gestionar datos de contaminación acústica
 * provenientes de las estaciones de monitorización de ruido distribuidas por la ciudad.
 * Incluye niveles de ruido por periodos del día y estadísticas acústicas.
 *
 * La logica de agregaciones, ranking y analisis normativo vive en
 * `services/ruidoService.js`. Este archivo expone solo el schema, los indices,
 * los hooks pre-save y wrappers thin sobre los metodos estaticos.
 */

const mongoose = require('mongoose');
const {
  validateNoiseLevel,
  validateDatasetDate,
  validateMonth,
  validateYear
} = require('./schemas/commonSchemas');
const {
  NOISE_LIMITS,
  NOISE_METRIC_FIELDS,
  DATASET_YEARS,
  VALIDATION_LIMITS
} = require('../constants');
const ruidoService = require('../services/ruidoService');

/**
 * Esquema de Contaminación Acústica
 *
 * Basado en la estructura del CSV de contaminación acústica:
 * - Fecha: periodo de medición (mes-año)
 * - NMT: número de estación de monitorización
 * - Nombre: nombre descriptivo de la ubicación
 * - Ld, Le, Ln: niveles por periodo (diurno, vespertino, nocturno)
 * - LAeq24: nivel equivalente de 24 horas
 * - LAS01-LAS99: percentiles estadísticos
 */
const noiseMonitoringSchema = new mongoose.Schema({
  // Información temporal
  fecha: {
    type: Date,
    required: true,
    validate: {
      validator: validateDatasetDate,
      message: `La fecha debe estar dentro del rango del dataset (${DATASET_YEARS.MIN_YEAR}-${DATASET_YEARS.MAX_YEAR})`
    }
  },

  mes: {
    type: Number,
    required: true,
    validate: {
      validator: validateMonth,
      message: `El mes debe estar entre ${VALIDATION_LIMITS.MONTH_MIN} y ${VALIDATION_LIMITS.MONTH_MAX}`
    }
  },

  año: {
    type: Number,
    required: true,
    validate: {
      validator: validateYear,
      message: `El año debe estar entre ${VALIDATION_LIMITS.YEAR_MIN} y ${VALIDATION_LIMITS.YEAR_MAX}`
    }
  },

  // Identificación de la estación
  nmt: {
    type: Number,
    required: true
  },

  nombre: {
    type: String,
    required: true,
    trim: true
  },

  // Niveles de ruido por periodo (en decibelios)
  nivelDiurno: { // Ld: 07:00 - 19:00
    type: Number,
    required: false,
    validate: {
      validator: validateNoiseLevel,
      message: `El nivel diurno debe estar entre ${VALIDATION_LIMITS.NOISE_MIN} y ${VALIDATION_LIMITS.NOISE_MAX} dB`
    }
  },

  nivelVespertino: { // Le: 19:00 - 23:00
    type: Number,
    required: false,
    validate: {
      validator: validateNoiseLevel,
      message: `El nivel vespertino debe estar entre ${VALIDATION_LIMITS.NOISE_MIN} y ${VALIDATION_LIMITS.NOISE_MAX} dB`
    }
  },

  nivelNocturno: { // Ln: 23:00 - 07:00
    type: Number,
    required: false,
    validate: {
      validator: validateNoiseLevel,
      message: `El nivel nocturno debe estar entre ${VALIDATION_LIMITS.NOISE_MIN} y ${VALIDATION_LIMITS.NOISE_MAX} dB`
    }
  },

  // Nivel equivalente continuo de 24 horas
  laeq24: {
    type: Number,
    required: false,
    validate: {
      validator: validateNoiseLevel,
      message: `El LAeq24 debe estar entre ${VALIDATION_LIMITS.NOISE_MIN} y ${VALIDATION_LIMITS.NOISE_MAX} dB`
    }
  },

  // Percentiles estadísticos (LAS01, LAS10, LAS50, LAS90, LAS99)
  percentiles: {
    type: {
      las01: { // Percentil 1 (superado el 1% del tiempo)
        type: Number,
        required: false,
        validate: {
          validator: validateNoiseLevel,
          message: `El LAS01 debe estar entre ${VALIDATION_LIMITS.NOISE_MIN} y ${VALIDATION_LIMITS.NOISE_MAX} dB`
        }
      },
      las10: { // Percentil 10 (superado el 10% del tiempo)
        type: Number,
        required: false,
        validate: {
          validator: validateNoiseLevel,
          message: `El LAS10 debe estar entre ${VALIDATION_LIMITS.NOISE_MIN} y ${VALIDATION_LIMITS.NOISE_MAX} dB`
        }
      },
      las50: { // Percentil 50 (mediana)
        type: Number,
        required: false,
        validate: {
          validator: validateNoiseLevel,
          message: `El LAS50 debe estar entre ${VALIDATION_LIMITS.NOISE_MIN} y ${VALIDATION_LIMITS.NOISE_MAX} dB`
        }
      },
      las90: { // Percentil 90 (superado el 90% del tiempo)
        type: Number,
        required: false,
        validate: {
          validator: validateNoiseLevel,
          message: `El LAS90 debe estar entre ${VALIDATION_LIMITS.NOISE_MIN} y ${VALIDATION_LIMITS.NOISE_MAX} dB`
        }
      },
      las99: { // Percentil 99 (ruido de fondo)
        type: Number,
        required: false,
        validate: {
          validator: validateNoiseLevel,
          message: `El LAS99 debe estar entre ${VALIDATION_LIMITS.NOISE_MIN} y ${VALIDATION_LIMITS.NOISE_MAX} dB`
        }
      }
    },
    // Tolerancia de 0.5 dB para permitir pequeñas anomalías de sensores
    validate: {
      validator: function(p) {
        const TOLERANCE = 0.5;
        if (p.las01 != null && p.las10 != null && (p.las01 + TOLERANCE) < p.las10) {return false;}
        if (p.las10 != null && p.las50 != null && (p.las10 + TOLERANCE) < p.las50) {return false;}
        if (p.las50 != null && p.las90 != null && (p.las50 + TOLERANCE) < p.las90) {return false;}
        if (p.las90 != null && p.las99 != null && (p.las90 + TOLERANCE) < p.las99) {return false;}
        return true;
      },
      message: 'Los percentiles deben estar aproximadamente en orden decreciente: LAS01 >= LAS10 >= LAS50 >= LAS90 >= LAS99 (tolerancia ±0.5 dB)'
    }
  },

  // Metadatos de calidad y procesamiento
  dataQuality: {
    hasValidData: { type: Boolean, default: true },
    missingFields: [{ type: String, enum: Object.values(NOISE_METRIC_FIELDS) }],
    qualityScore: { type: Number, default: 1 },
    exceedsLegalLimits: { type: Boolean, default: false },
    warnings: [{ type: String }]
  },

  processingInfo: {
    importedAt: { type: Date, default: Date.now },
    sourceFile: { type: String, trim: true }
  }
}, {
  timestamps: true,
  versionKey: false,
  collection: 'noise_monitoring'
});

/**
 * Indices para optimizacion de consultas.
 */

// Indice unico: prevencion de duplicados (estacion + periodo)
noiseMonitoringSchema.index(
  { nmt: 1, año: 1, mes: 1 },
  { unique: true, name: 'unique_station_period' }
);

// Series temporales por estacion
noiseMonitoringSchema.index({ nmt: 1, fecha: 1 }, { name: 'idx_noise_station_timeline' });

// Filtros combinados fecha + nmt + nivel
noiseMonitoringSchema.index({ fecha: -1, nmt: 1, laeq24: -1 }, { name: 'idx_noise_date_station_level', sparse: true });

// Alertas de ruido (picos por fecha)
noiseMonitoringSchema.index({ fecha: 1, laeq24: 1 }, { name: 'idx_noise_date_level_alerts', sparse: true });

// Estaciones mas ruidosas recientes
noiseMonitoringSchema.index({ fecha: -1, laeq24: -1 }, { name: 'idx_noise_recent_levels', sparse: true });

// Busqueda por nombre + series temporales
noiseMonitoringSchema.index({ nombre: 1, fecha: -1 }, { name: 'idx_noise_station_name_timeline' });

// Periodo + nombre
noiseMonitoringSchema.index({ año: 1, mes: 1, nombre: 1 }, { name: 'idx_noise_period_station_name' });

// Analisis de cumplimiento normativo
noiseMonitoringSchema.index({ fecha: 1, nivelDiurno: 1, nivelNocturno: 1 }, { name: 'idx_noise_compliance_analysis', sparse: true });

// Busqueda textual por nombre
noiseMonitoringSchema.index({ nombre: 'text' }, { name: 'idx_noise_text_search' });

/**
 * Middleware pre-save: procesamiento de calidad de datos y alertas legales.
 * Firma async sin `next()` (convencion Mongoose v8+/v9).
 */
noiseMonitoringSchema.pre('save', async function() {
  const missingFields = [];
  let validFields = 0;
  const totalFields = 5;
  const warnings = [];

  if (!this.dataQuality) {
    this.dataQuality = {};
  }

  const { DIURNO, VESPERTINO, NOCTURNO } = NOISE_LIMITS;

  if (this.nivelDiurno === null || this.nivelDiurno === undefined) {
    missingFields.push('nivelDiurno');
  } else {
    validFields++;
    if (this.nivelDiurno > DIURNO) {
      this.dataQuality.exceedsLegalLimits = true;
      warnings.push(`Nivel diurno ${this.nivelDiurno} dB excede limite legal (${DIURNO} dB)`);
    }
  }

  if (this.nivelVespertino === null || this.nivelVespertino === undefined) {
    missingFields.push('nivelVespertino');
  } else {
    validFields++;
    if (this.nivelVespertino > VESPERTINO) {
      this.dataQuality.exceedsLegalLimits = true;
      warnings.push(`Nivel vespertino ${this.nivelVespertino} dB excede limite legal (${VESPERTINO} dB)`);
    }
  }

  if (this.nivelNocturno === null || this.nivelNocturno === undefined) {
    missingFields.push('nivelNocturno');
  } else {
    validFields++;
    if (this.nivelNocturno > NOCTURNO) {
      this.dataQuality.exceedsLegalLimits = true;
      warnings.push(`Nivel nocturno ${this.nivelNocturno} dB excede limite legal (${NOCTURNO} dB)`);
    }
  }

  if (this.laeq24 === null || this.laeq24 === undefined) {
    missingFields.push('laeq24');
  } else {
    validFields++;
  }

  const percentileFields = ['las01', 'las10', 'las50', 'las90', 'las99'];
  const percentilesDoc = this.percentiles || {};
  const validPercentiles = percentileFields.filter(field =>
    percentilesDoc[field] !== null && percentilesDoc[field] !== undefined
  );
  if (validPercentiles.length === 0) {
    missingFields.push('percentiles');
  } else {
    validFields++;
  }

  this.dataQuality.missingFields = missingFields;
  this.dataQuality.hasValidData = validFields > 0;
  this.dataQuality.qualityScore = validFields / totalFields;
  this.dataQuality.warnings = warnings;
});

/**
 * Constantes de limites normativos de ruido (dB).
 */
noiseMonitoringSchema.statics.LIMITES_NORMATIVOS = NOISE_LIMITS;

/**
 * Metodos estaticos delegados a `services/ruidoService.js`.
 *
 * El service contiene la implementacion real de las agregaciones y analisis;
 * el modelo solo expone wrappers para mantener la API publica clasica
 * `Ruido.metodoX(...)`. Asi los controllers no necesitan importar el service
 * directamente y se conserva la convencion de Mongoose.
 */
noiseMonitoringSchema.statics.getStatisticsOptimized = function(filters, groupBy) {
  return ruidoService.getStatisticsOptimized(this, filters, groupBy);
};

noiseMonitoringSchema.statics.getRankingOptimized = function(filters, sortBy, limit) {
  return ruidoService.getRankingOptimized(this, filters, sortBy, limit);
};

noiseMonitoringSchema.statics.calculateRegulatoryCompliance = function(niveles) {
  return ruidoService.calculateRegulatoryCompliance(niveles);
};

noiseMonitoringSchema.statics.getStationComparison = function(options) {
  return ruidoService.getStationComparison(this, options);
};

noiseMonitoringSchema.statics.getTemporalTrends = function(options) {
  return ruidoService.getTemporalTrends(this, options);
};

noiseMonitoringSchema.statics.getComplianceAnalysisByZone = function(options) {
  return ruidoService.getComplianceAnalysisByZone(this, options);
};

// Transformacion JSON: ocultar metadatos internos en respuestas
noiseMonitoringSchema.set('toJSON', {
  transform: (_doc, ret) => {
    delete ret.createdAt;
    delete ret.updatedAt;
    delete ret.__v;
    delete ret.processingInfo;
    return ret;
  }
});

const NoiseMonitoring = mongoose.model('NoiseMonitoring', noiseMonitoringSchema);

module.exports = NoiseMonitoring;
