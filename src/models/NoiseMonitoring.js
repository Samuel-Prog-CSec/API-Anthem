/**
 * Modelo de Contaminación Acústica
 *
 * Esquema de Mongoose para almacenar y gestionar datos de contaminación acústica
 * provenientes de las estaciones de monitorización de ruido distribuidas por la ciudad.
 * Incluye niveles de ruido por periodos del día y estadísticas acústicas.
 */

const mongoose = require('mongoose');

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
    required: [true, 'Fecha de medición obligatoria'],
    index: true
  },

  mes: {
    type: Number,
    required: [true, 'Mes obligatorio'],
    min: [1, 'Mes debe estar entre 1 y 12'],
    max: [12, 'Mes debe estar entre 1 y 12'],
    index: true
  },

  año: {
    type: Number,
    required: [true, 'Año obligatorio'],
    min: [2000, 'Año no válido'],
    max: [3000, 'Año no válido'],
    index: true
  },

  // Identificación de la estación
  nmt: {
    type: Number,
    required: [true, 'Número de estación (NMT) obligatorio'],
    min: [1, 'NMT debe ser mayor a 0'],
    index: true
  },

  nombre: {
    type: String,
    required: [true, 'Nombre de la estación obligatorio'],
    trim: true,
    maxlength: [100, 'Nombre no puede exceder 100 caracteres'],
    index: true
  },

  // Niveles de ruido por periodo (en decibelios)
  nivelDiurno: { // Ld: 07:00 - 19:00
    type: Number,
    required: false, // Puede ser null si no hay datos válidos
    min: [0, 'Nivel de ruido no puede ser negativo'],
    max: [150, 'Nivel de ruido excesivo'],
    validate: {
      validator: function(v) {
        return v === null || (v >= 0 && v <= 150);
      },
      message: 'Nivel diurno debe estar entre 0 y 150 dB o ser nulo'
    }
  },

  nivelVespertino: { // Le: 19:00 - 23:00
    type: Number,
    required: false,
    min: [0, 'Nivel de ruido no puede ser negativo'],
    max: [150, 'Nivel de ruido excesivo'],
    validate: {
      validator: function(v) {
        return v === null || (v >= 0 && v <= 150);
      },
      message: 'Nivel vespertino debe estar entre 0 y 150 dB o ser nulo'
    }
  },

  nivelNocturno: { // Ln: 23:00 - 07:00
    type: Number,
    required: false,
    min: [0, 'Nivel de ruido no puede ser negativo'],
    max: [150, 'Nivel de ruido excesivo'],
    validate: {
      validator: function(v) {
        return v === null || (v >= 0 && v <= 150);
      },
      message: 'Nivel nocturno debe estar entre 0 y 150 dB o ser nulo'
    }
  },

  // Nivel equivalente continuo de 24 horas
  laeq24: {
    type: Number,
    required: false,
    min: [0, 'LAeq24 no puede ser negativo'],
    max: [150, 'LAeq24 excesivo'],
    validate: {
      validator: function(v) {
        return v === null || (v >= 0 && v <= 150);
      },
      message: 'LAeq24 debe estar entre 0 y 150 dB o ser nulo'
    }
  },

  // Percentiles estadísticos (LAS01, LAS10, LAS50, LAS90, LAS99)
  percentiles: {
    las01: { // Percentil 1 (superado el 1% del tiempo)
      type: Number,
      required: false,
      min: [0, 'Percentil no puede ser negativo'],
      max: [150, 'Percentil excesivo']
    },
    las10: { // Percentil 10 (superado el 10% del tiempo)
      type: Number,
      required: false,
      min: [0, 'Percentil no puede ser negativo'],
      max: [150, 'Percentil excesivo']
    },
    las50: { // Percentil 50 (mediana)
      type: Number,
      required: false,
      min: [0, 'Percentil no puede ser negativo'],
      max: [150, 'Percentil excesivo']
    },
    las90: { // Percentil 90 (superado el 90% del tiempo)
      type: Number,
      required: false,
      min: [0, 'Percentil no puede ser negativo'],
      max: [150, 'Percentil excesivo']
    },
    las99: { // Percentil 99 (ruido de fondo)
      type: Number,
      required: false,
      min: [0, 'Percentil no puede ser negativo'],
      max: [150, 'Percentil excesivo']
    }
  },

  // Metadatos de calidad y procesamiento
  dataQuality: {
    hasValidData: {
      type: Boolean,
      default: true
    },
    missingFields: [{
      type: String,
      enum: ['nivelDiurno', 'nivelVespertino', 'nivelNocturno', 'laeq24', 'percentiles']
    }],
    qualityScore: {
      type: Number,
      min: 0,
      max: 1,
      default: 1
    }
  },

  // Información de procesamiento
  processingInfo: {
    importedAt: {
      type: Date,
      default: Date.now
    },
    sourceFile: {
      type: String,
      trim: true
    }
  }

}, {
  timestamps: true,
  versionKey: false
});

/**
 * Índices para optimización de consultas
 */
// Índice único para evitar duplicados
noiseMonitoringSchema.index(
  { nmt: 1, año: 1, mes: 1 },
  { unique: true, name: 'unique_station_period' }
);

// Índices para consultas comunes
noiseMonitoringSchema.index({ fecha: -1, nmt: 1 });
noiseMonitoringSchema.index({ nombre: 1, fecha: -1 });
noiseMonitoringSchema.index({ año: 1, mes: 1, nmt: 1 });

// Índice de texto para búsqueda por nombre de estación
noiseMonitoringSchema.index({ nombre: 'text' });

// Índice compuesto estacion (nmt) + fecha (consultas por estación específica)
// Usado en: GET /api/noise-monitoring?nmt=X&fecha=Y, series temporales por estación
noiseMonitoringSchema.index({ nmt: 1, fecha: 1 }, {
  name: 'idx_noise_station_timeline',
  background: true
});

// Índice compuesto fecha + nivelSonoro (identificación de picos de ruido)
// Usado en: alertas de contaminación acústica, búsqueda de niveles extremos
// Usaremos laeq24 como representante del nivel sonoro general
noiseMonitoringSchema.index({ fecha: 1, laeq24: 1 }, {
  name: 'idx_noise_date_level_alerts',
  background: true,
  sparse: true // Solo documentos con laeq24 válido
});

/**
 * Middleware pre-save para procesamiento de calidad de datos
 */
noiseMonitoringSchema.pre('save', function(next) {
  const missingFields = [];
  let validFields = 0;
  const totalFields = 5; // nivelDiurno, nivelVespertino, nivelNocturno, laeq24, percentiles

  // Verificar campos principales
  if (this.nivelDiurno === null || this.nivelDiurno === undefined) {
    missingFields.push('nivelDiurno');
  } else {
    validFields++;
  }

  if (this.nivelVespertino === null || this.nivelVespertino === undefined) {
    missingFields.push('nivelVespertino');
  } else {
    validFields++;
  }

  if (this.nivelNocturno === null || this.nivelNocturno === undefined) {
    missingFields.push('nivelNocturno');
  } else {
    validFields++;
  }

  if (this.laeq24 === null || this.laeq24 === undefined) {
    missingFields.push('laeq24');
  } else {
    validFields++;
  }

  // Verificar percentiles
  const percentileFields = ['las01', 'las10', 'las50', 'las90', 'las99'];
  const validPercentiles = percentileFields.filter(field =>
    this.percentiles[field] !== null && this.percentiles[field] !== undefined
  );

  if (validPercentiles.length === 0) {
    missingFields.push('percentiles');
  } else {
    validFields++;
  }

  // Actualizar metadatos de calidad
  this.dataQuality.missingFields = missingFields;
  this.dataQuality.hasValidData = validFields > 0;
  this.dataQuality.qualityScore = validFields / totalFields;

  next();
});

/**
 * Método para verificar si los niveles cumplen con normativas
 * @returns {Object} Resultado de evaluación normativa
 */
noiseMonitoringSchema.methods.evaluateComplianceRules = function() {
  const compliance = {
    diurno: { value: this.nivelDiurno, compliant: null, limit: 65 },
    vespertino: { value: this.nivelVespertino, compliant: null, limit: 65 },
    nocturno: { value: this.nivelNocturno, compliant: null, limit: 55 },
    global: { compliant: true }
  };

  // Evaluar cumplimiento por periodo (límites ejemplo - ajustar según normativa local)
  if (this.nivelDiurno !== null) {
    compliance.diurno.compliant = this.nivelDiurno <= compliance.diurno.limit;
  }

  if (this.nivelVespertino !== null) {
    compliance.vespertino.compliant = this.nivelVespertino <= compliance.vespertino.limit;
  }

  if (this.nivelNocturno !== null) {
    compliance.nocturno.compliant = this.nivelNocturno <= compliance.nocturno.limit;
  }

  // Evaluar cumplimiento global
  compliance.global.compliant = [
    compliance.diurno.compliant,
    compliance.vespertino.compliant,
    compliance.nocturno.compliant
  ].every(c => c === null || c === true);

  return compliance;
};

/**
 * Método para obtener el nivel más alto del día
 * @returns {Object} Información del nivel máximo
 */
noiseMonitoringSchema.methods.getMaxDailyLevel = function() {
  const levels = [
    { periodo: 'diurno', valor: this.nivelDiurno },
    { periodo: 'vespertino', valor: this.nivelVespertino },
    { periodo: 'nocturno', valor: this.nivelNocturno }
  ].filter(l => l.valor !== null && l.valor !== undefined);

  if (levels.length === 0) {
    return { periodo: null, valor: null };
  }

  return levels.reduce((max, current) =>
    current.valor > max.valor ? current : max
  );
};

/**
 * Método estático para obtener estadísticas por estación
 */
noiseMonitoringSchema.statics.getStationStatistics = function(nmt, startDate, endDate) {
  return this.aggregate([
    {
      $match: {
        nmt: nmt,
        fecha: { $gte: startDate, $lte: endDate }
      }
    },
    {
      $group: {
        _id: '$nmt',
        nombre: { $first: '$nombre' },
        promedioLaeq24: { $avg: '$laeq24' },
        maximoLaeq24: { $max: '$laeq24' },
        minimoLaeq24: { $min: '$laeq24' },
        promedioDiurno: { $avg: '$nivelDiurno' },
        promedioVespertino: { $avg: '$nivelVespertino' },
        promedioNocturno: { $avg: '$nivelNocturno' },
        totalMediciones: { $sum: 1 }
      }
    }
  ]);
};

/**
 * Método estático para buscar estaciones por zona o nombre
 */
noiseMonitoringSchema.statics.searchStations = function(searchTerm) {
  return this.aggregate([
    {
      $match: {
        $text: { $search: searchTerm }
      }
    },
    {
      $group: {
        _id: '$nmt',
        nombre: { $first: '$nombre' },
        ultimaMedicion: { $max: '$fecha' },
        totalMediciones: { $sum: 1 }
      }
    },
    {
      $sort: { ultimaMedicion: -1 }
    }
  ]);
};

// Crear y exportar el modelo
const NoiseMonitoring = mongoose.model('NoiseMonitoring', noiseMonitoringSchema);

module.exports = NoiseMonitoring;
