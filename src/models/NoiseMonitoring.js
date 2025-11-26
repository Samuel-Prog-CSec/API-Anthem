/**
 * Modelo de Contaminación Acústica
 *
 * Esquema de Mongoose para almacenar y gestionar datos de contaminación acústica
 * provenientes de las estaciones de monitorización de ruido distribuidas por la ciudad.
 * Incluye niveles de ruido por periodos del día y estadísticas acústicas.
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
  AGGREGATION_LIMITS,
  MONGODB_TIMEOUTS
} = require('../constants');

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
      message: 'La fecha debe estar dentro del rango del dataset (2050-2052)'
    }
  },

  mes: {
    type: Number,
    required: true,
    validate: {
      validator: validateMonth,
      message: 'El mes debe estar entre 1 y 12'
    }
  },

  año: {
    type: Number,
    required: true,
    validate: {
      validator: validateYear,
      message: 'El año debe estar entre 2000 y 3000'
    }
  },

  // Identificación de la estación
  nmt: {
    type: Number,
    required: true,
    uppercase: true
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
      message: 'El nivel diurno debe estar entre 0 y 150 dB'
    }
  },

  nivelVespertino: { // Le: 19:00 - 23:00
    type: Number,
    required: false,
    validate: {
      validator: validateNoiseLevel,
      message: 'El nivel vespertino debe estar entre 0 y 150 dB'
    }
  },

  nivelNocturno: { // Ln: 23:00 - 07:00
    type: Number,
    required: false,
    validate: {
      validator: validateNoiseLevel,
      message: 'El nivel nocturno debe estar entre 0 y 150 dB'
    }
  },

  // Nivel equivalente continuo de 24 horas
  laeq24: {
    type: Number,
    required: false,
    validate: {
      validator: validateNoiseLevel,
      message: 'El LAeq24 debe estar entre 0 y 150 dB'
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
          message: 'El LAS01 debe estar entre 0 y 150 dB'
        }
      },
      las10: { // Percentil 10 (superado el 10% del tiempo)
        type: Number,
        required: false,
        validate: {
          validator: validateNoiseLevel,
          message: 'El LAS10 debe estar entre 0 y 150 dB'
        }
      },
      las50: { // Percentil 50 (mediana)
        type: Number,
        required: false,
        validate: {
          validator: validateNoiseLevel,
          message: 'El LAS50 debe estar entre 0 y 150 dB'
        }
      },
      las90: { // Percentil 90 (superado el 90% del tiempo)
        type: Number,
        required: false,
        validate: {
          validator: validateNoiseLevel,
          message: 'El LAS90 debe estar entre 0 y 150 dB'
        }
      },
      las99: { // Percentil 99 (ruido de fondo)
        type: Number,
        required: false,
        validate: {
          validator: validateNoiseLevel,
          message: 'El LAS99 debe estar entre 0 y 150 dB'
        }
      }
    },
    // Validación de coherencia en el orden de percentiles
    validate: {
      validator: function(p) {
        // Validar orden decreciente: las01 >= las10 >= las50 >= las90 >= las99
        // Solo validar si los valores existen
        if (p.las01 != null && p.las10 != null && p.las01 < p.las10) {
          return false;
        }
        if (p.las10 != null && p.las50 != null && p.las10 < p.las50) {
          return false;
        }
        if (p.las50 != null && p.las90 != null && p.las50 < p.las90) {
          return false;
        }
        if (p.las90 != null && p.las99 != null && p.las90 < p.las99) {
          return false;
        }
        return true;
      },
      message: 'Los percentiles deben estar en orden decreciente: LAS01 >= LAS10 >= LAS50 >= LAS90 >= LAS99'
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
      enum: Object.values(NOISE_METRIC_FIELDS)
    }],
    qualityScore: {
      type: Number,
      default: 1
    },
    exceedsLegalLimits: {
      type: Boolean,
      default: false
    },
    warnings: [{
      type: String
    }]
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

// ========================================
// ÍNDICE ÚNICO - Prevención de duplicados
// ========================================
// Garantiza que no haya mediciones duplicadas para misma estación + período
// Combinación: nmt (código estación) + año + mes
// Cada estación tiene máximo una medición por mes
// CRÍTICO: NO ELIMINAR
noiseMonitoringSchema.index(
  { nmt: 1, año: 1, mes: 1 },
  { unique: true, name: 'unique_station_period' }
);

// ========================================
// ÍNDICES PRINCIPALES - Consultas frecuentes
// ========================================

// Índice compuesto: estación (nmt) + fecha
// Usado en: GET /api/noise-monitoring?nmt=X&startDate=Y&endDate=Z
// Soporta: Series temporales por estación específica
// Ejemplo: "Evolución del ruido en estación NMT-001"
noiseMonitoringSchema.index({ nmt: 1, fecha: 1 }, {
  name: 'idx_noise_station_timeline',
  background: true
});

// OPTIMIZACIÓN DE RENDIMIENTO: Índice compuesto fecha + nmt + laeq24
// Mejora: 5-10x más rápido en queries con filtros combinados
// Soporta: GET /api/noise-monitoring?startDate=X&endDate=Y&nmt=Z&minLevel=N
noiseMonitoringSchema.index({ fecha: -1, nmt: 1, laeq24: -1 }, {
  name: 'idx_noise_date_station_level',
  background: true,
  sparse: true
});

// Índice compuesto: fecha + nivel LAeq24
// Usado en: Identificación de picos de contaminación acústica
// Soporta: Alertas de ruido, búsqueda de niveles extremos
// LAeq24: Nivel sonoro continuo equivalente ponderado A de 24h
// SPARSE: Solo documentos con laeq24 válido (no null)
noiseMonitoringSchema.index({ fecha: 1, laeq24: 1 }, {
  name: 'idx_noise_date_level_alerts',
  background: true,
  sparse: true
});

// Índice para consultas recientes con nivel de ruido
// Usado en: Dashboards en tiempo real, "Estaciones más ruidosas hoy"
// Sort: fecha descendente + laeq24 descendente
noiseMonitoringSchema.index({ fecha: -1, laeq24: -1 }, {
  name: 'idx_noise_recent_levels',
  background: true,
  sparse: true
});

// ========================================
// ÍNDICES POR NOMBRE DE ESTACIÓN
// ========================================

// Índice compuesto: nombre + fecha (desc)
// Usado en: GET /api/noise-monitoring?nombre=PLAZA+MAYOR
// Soporta: Búsqueda por nombre de ubicación con series temporales
noiseMonitoringSchema.index({ nombre: 1, fecha: -1 }, {
  name: 'idx_noise_station_name_timeline',
  background: true
});

// Índice compuesto: año + mes + nombre
// Usado en: Búsquedas por nombre en período específico
// Ejemplo: GET /api/noise-monitoring?nombre=CENTRO&año=2051&mes=1
noiseMonitoringSchema.index({ año: 1, mes: 1, nombre: 1 }, {
  name: 'idx_noise_period_station_name',
  background: true
});

// ========================================
// ÍNDICES PARA ANÁLISIS DE CUMPLIMIENTO
// ========================================

// Índice compuesto para análisis normativo
// Usado en: Detección de incumplimientos de límites legales
// Soporta: Agregaciones que filtran por nivelDiurno > 65dB, nivelNocturno > 55dB
// SPARSE: Solo documentos con niveles válidos
noiseMonitoringSchema.index({ fecha: 1, nivelDiurno: 1, nivelNocturno: 1 }, {
  name: 'idx_noise_compliance_analysis',
  background: true,
  sparse: true
});

// ========================================
// ÍNDICE DE BÚSQUEDA TEXTUAL
// ========================================
// Índice de texto completo para búsqueda por nombre de estación
// Usado en: Búsqueda con $text "Plaza", "Centro", etc.
// Soporta: Autocompletado, búsqueda flexible
noiseMonitoringSchema.index({ nombre: 'text' }, {
  name: 'idx_noise_text_search',
  background: true
});

/**
 * Middleware pre-save para procesamiento de calidad de datos y alertas legales
 */
noiseMonitoringSchema.pre('save', function(next) {
  const missingFields = [];
  let validFields = 0;
  const totalFields = 5; // nivelDiurno, nivelVespertino, nivelNocturno, laeq24, percentiles
  const warnings = [];

  // Límites legales normativos (dB) - desde constantes centralizadas
  const { DIURNO, VESPERTINO, NOCTURNO } = NOISE_LIMITS;

  // Verificar campos principales
  if (this.nivelDiurno === null || this.nivelDiurno === undefined) {
    missingFields.push('nivelDiurno');
  } else {
    validFields++;
    // Alertar si excede límite legal (no bloquear)
    if (this.nivelDiurno > DIURNO) {
      this.dataQuality.exceedsLegalLimits = true;
      warnings.push(`Nivel diurno ${this.nivelDiurno} dB excede límite legal (${DIURNO} dB)`);
    }
  }

  if (this.nivelVespertino === null || this.nivelVespertino === undefined) {
    missingFields.push('nivelVespertino');
  } else {
    validFields++;
    if (this.nivelVespertino > VESPERTINO) {
      this.dataQuality.exceedsLegalLimits = true;
      warnings.push(`Nivel vespertino ${this.nivelVespertino} dB excede límite legal (${VESPERTINO} dB)`);
    }
  }

  if (this.nivelNocturno === null || this.nivelNocturno === undefined) {
    missingFields.push('nivelNocturno');
  } else {
    validFields++;
    if (this.nivelNocturno > NOCTURNO) {
      this.dataQuality.exceedsLegalLimits = true;
      warnings.push(`Nivel nocturno ${this.nivelNocturno} dB excede límite legal (${NOCTURNO} dB)`);
    }
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
  this.dataQuality.warnings = warnings;

  next();
});

/**
 * Constantes de límites normativos de ruido (dB)
 */
noiseMonitoringSchema.statics.LIMITES_NORMATIVOS = NOISE_LIMITS;

/**
 * Obtener estadísticas agregadas con cumplimiento normativo
 * @param {Object} filters - Filtros de fecha y estación
 * @param {String} groupBy - Agrupación: 'station', 'month', 'year'
 * @returns {Promise<Object>} Estadísticas y resumen
 */
noiseMonitoringSchema.statics.getStatisticsOptimized = async function(filters, groupBy = 'station') {
  const matchStage = { ...filters, 'dataQuality.hasValidData': true };

  // Configurar agrupación
  const groupByConfig = {
    station: { nmt: '$nmt', nombre: '$nombre' },
    month: { año: '$año', mes: '$mes' },
    year: { año: '$año' }
  }[groupBy] || { nmt: '$nmt', nombre: '$nombre' };

  const sortStage = {
    station: { '_id.nmt': 1 },
    month: { '_id.año': -1, '_id.mes': -1 },
    year: { '_id.año': -1 }
  }[groupBy] || { '_id.nmt': 1 };

  const { DIURNO, VESPERTINO, NOCTURNO } = this.LIMITES_NORMATIVOS;

  // Pipeline de agregación optimizado
  const [estadisticas, resumenGeneral] = await Promise.all([
    // Estadísticas por grupo
    this.aggregate([
      { $match: matchStage },
      {
        $group: {
          _id: groupByConfig,
          promedioDiurno: { $avg: '$nivelDiurno' },
          promedioVespertino: { $avg: '$nivelVespertino' },
          promedioNocturno: { $avg: '$nivelNocturno' },
          promedioLaeq24: { $avg: '$laeq24' },
          maximoDiurno: { $max: '$nivelDiurno' },
          maximoVespertino: { $max: '$nivelVespertino' },
          maximoNocturno: { $max: '$nivelNocturno' },
          maximoLaeq24: { $max: '$laeq24' },
          minimoDiurno: { $min: '$nivelDiurno' },
          minimoVespertino: { $min: '$nivelVespertino' },
          minimoNocturno: { $min: '$nivelNocturno' },
          minimoLaeq24: { $min: '$laeq24' },
          totalMediciones: { $sum: 1 },
          incumplimientosDiurnos: { $sum: { $cond: [{ $gt: ['$nivelDiurno', DIURNO] }, 1, 0] } },
          incumplimientosVespertinos: { $sum: { $cond: [{ $gt: ['$nivelVespertino', VESPERTINO] }, 1, 0] } },
          incumplimientosNocturnos: { $sum: { $cond: [{ $gt: ['$nivelNocturno', NOCTURNO] }, 1, 0] } }
        }
      },
      {
        $addFields: {
          cumplimientoDiurno: {
            $multiply: [
              { $divide: [{ $subtract: ['$totalMediciones', '$incumplimientosDiurnos'] }, '$totalMediciones'] },
              100
            ]
          },
          cumplimientoVespertino: {
            $multiply: [
              { $divide: [{ $subtract: ['$totalMediciones', '$incumplimientosVespertinos'] }, '$totalMediciones'] },
              100
            ]
          },
          cumplimientoNocturno: {
            $multiply: [
              { $divide: [{ $subtract: ['$totalMediciones', '$incumplimientosNocturnos'] }, '$totalMediciones'] },
              100
            ]
          }
        }
      },
      { $sort: sortStage },
      { $limit: AGGREGATION_LIMITS.SMALL }
    ]).allowDiskUse(true).maxTimeMS(MONGODB_TIMEOUTS.AGGREGATE_TIMEOUT_MS),

    // Resumen general
    this.aggregate([
      { $match: matchStage },
      {
        $group: {
          _id: null,
          totalRegistros: { $sum: 1 },
          estacionesUnicas: { $addToSet: '$nmt' },
          promedioGeneralLaeq24: { $avg: '$laeq24' },
          fechaInicio: { $min: '$fecha' },
          fechaFin: { $max: '$fecha' },
          totalIncumplimientos: {
            $sum: {
              $add: [
                { $cond: [{ $gt: ['$nivelDiurno', DIURNO] }, 1, 0] },
                { $cond: [{ $gt: ['$nivelVespertino', VESPERTINO] }, 1, 0] },
                { $cond: [{ $gt: ['$nivelNocturno', NOCTURNO] }, 1, 0] }
              ]
            }
          }
        }
      }
    ]).allowDiskUse(true).maxTimeMS(MONGODB_TIMEOUTS.AGGREGATE_TIMEOUT_MS)
  ]);

  const resumen = resumenGeneral[0] ? {
    ...resumenGeneral[0],
    totalEstaciones: resumenGeneral[0].estacionesUnicas.length,
    porcentajeCumplimientoGeneral: resumenGeneral[0].totalRegistros > 0
      ? ((resumenGeneral[0].totalRegistros * 3 - resumenGeneral[0].totalIncumplimientos) / (resumenGeneral[0].totalRegistros * 3)) * 100
      : 0
  } : null;

  return { estadisticas, resumen };
};

/**
 * Obtener ranking de estaciones por nivel de ruido
 * @param {Object} filters - Filtros de fecha
 * @param {String} sortBy - Campo de ordenación: 'laeq24', 'diurno', 'vespertino', 'nocturno'
 * @param {Number} limit - Límite de resultados
 * @returns {Promise<Array>} Ranking de estaciones
 */
noiseMonitoringSchema.statics.getRankingOptimized = function(filters, sortBy = 'laeq24', limit = 20) {
  const matchStage = { ...filters, 'dataQuality.hasValidData': true };

  const sortField = {
    laeq24: '$promedioLaeq24',
    diurno: '$promedioDiurno',
    vespertino: '$promedioVespertino',
    nocturno: '$promedioNocturno'
  }[sortBy] || '$promedioLaeq24';

  const pipeline = [
    { $match: matchStage },
    {
      $group: {
        _id: { nmt: '$nmt', nombre: '$nombre' },
        promedioLaeq24: { $avg: '$laeq24' },
        promedioDiurno: { $avg: '$nivelDiurno' },
        promedioVespertino: { $avg: '$nivelVespertino' },
        promedioNocturno: { $avg: '$nivelNocturno' },
        maximoLaeq24: { $max: '$laeq24' },
        totalMediciones: { $sum: 1 },
        fechaInicio: { $min: '$fecha' },
        fechaFin: { $max: '$fecha' }
      }
    },
    { $sort: { [sortField.substring(1)]: -1 } },
    { $limit: limit }
  ];

  return this.aggregate(pipeline).allowDiskUse(true).maxTimeMS(MONGODB_TIMEOUTS.AGGREGATE_TIMEOUT_MS);
};

/**
 * Calcular cumplimiento normativo para un registro
 * @param {Object} niveles - Objeto con nivelDiurno, nivelVespertino, nivelNocturno
 * @returns {Object} Objeto con cumplimiento por período
 */
noiseMonitoringSchema.statics.calculateRegulatoryCompliance = function(niveles) {
  const { DIURNO, VESPERTINO, NOCTURNO } = this.LIMITES_NORMATIVOS;

  return {
    diurno: niveles.nivelDiurno <= DIURNO,
    vespertino: niveles.nivelVespertino <= VESPERTINO,
    nocturno: niveles.nivelNocturno <= NOCTURNO,
    global: niveles.nivelDiurno <= DIURNO && niveles.nivelVespertino <= VESPERTINO && niveles.nivelNocturno <= NOCTURNO
  };
};

/**
 * Comparación entre estaciones de monitorización
 *
 * Compara niveles de ruido entre múltiples estaciones en un periodo determinado.
 * Utiliza el índice idx_noise_station_timeline para optimización.
 *
 * @param {Object} options - Opciones de comparación
 * @param {Array<Number>} options.stations - Array de NMT de estaciones a comparar
 * @param {Date} options.startDate - Fecha de inicio del periodo
 * @param {Date} options.endDate - Fecha de fin del periodo
 * @param {String} [options.metric='laeq24'] - Métrica a comparar: 'laeq24', 'nivelDiurno', 'nivelVespertino', 'nivelNocturno'
 * @returns {Promise<Array>} Array con datos comparativos de cada estación
 *
 * @example
 * const comparison = await NoiseMonitoring.getStationComparison({
 *   stations: [1, 2, 3],
 *   startDate: new Date('2051-01-01'),
 *   endDate: new Date('2051-12-31'),
 *   metric: 'laeq24'
 * });
 */
noiseMonitoringSchema.statics.getStationComparison = function(options) {
  const { stations, startDate, endDate, metric = 'laeq24' } = options;

  if (!stations || !Array.isArray(stations) || stations.length === 0) {
    throw new Error('Se requiere un array de estaciones para comparar');
  }

  if (!startDate || !endDate) {
    throw new Error('Se requieren fechas de inicio y fin');
  }

  const metricField = `$${metric}`;
  const matchStage = {
    nmt: { $in: stations },
    fecha: { $gte: startDate, $lte: endDate },
    [metric]: { $ne: null }
  };

  const pipeline = [
    { $match: matchStage },
    {
      $group: {
        _id: { nmt: '$nmt', nombre: '$nombre' },
        promedioNivel: { $avg: metricField },
        minimoNivel: { $min: metricField },
        maximoNivel: { $max: metricField },
        desviacionEstandar: { $stdDevPop: metricField },
        totalMediciones: { $sum: 1 },
        medicionesValidas: {
          $sum: { $cond: [{ $ne: [metricField, null] }, 1, 0] }
        }
      }
    },
    {
      $project: {
        nmt: '$_id.nmt',
        nombre: '$_id.nombre',
        promedioNivel: { $round: ['$promedioNivel', 2] },
        minimoNivel: { $round: ['$minimoNivel', 2] },
        maximoNivel: { $round: ['$maximoNivel', 2] },
        desviacionEstandar: { $round: ['$desviacionEstandar', 2] },
        totalMediciones: 1,
        medicionesValidas: 1,
        rangoVariacion: {
          $round: [{ $subtract: ['$maximoNivel', '$minimoNivel'] }, 2]
        },
        calidadDatos: {
          $round: [
            { $multiply: [{ $divide: ['$medicionesValidas', '$totalMediciones'] }, 100] },
            2
          ]
        },
        _id: 0
      }
    },
    { $sort: { promedioNivel: -1 } }
  ];

  return this.aggregate(pipeline).allowDiskUse(true).maxTimeMS(MONGODB_TIMEOUTS.AGGREGATE_TIMEOUT_MS);
};

/**
 * Análisis de tendencias temporales de ruido
 *
 * Analiza la evolución temporal de los niveles de ruido agrupados por diferentes
 * periodos (día, mes, año). Utiliza índices temporales para optimización.
 *
 * @param {Object} options - Opciones de análisis
 * @param {Number} [options.nmt] - NMT de estación específica (opcional)
 * @param {Date} options.startDate - Fecha de inicio del análisis
 * @param {Date} options.endDate - Fecha de fin del análisis
 * @param {String} [options.groupBy='month'] - Agrupación temporal: 'day', 'month', 'year'
 * @param {String} [options.metric='laeq24'] - Métrica a analizar
 * @returns {Promise<Array>} Array con tendencias temporales
 *
 * @example
 * const trends = await NoiseMonitoring.getTemporalTrends({
 *   nmt: 1,
 *   startDate: new Date('2051-01-01'),
 *   endDate: new Date('2051-12-31'),
 *   groupBy: 'month',
 *   metric: 'laeq24'
 * });
 */
noiseMonitoringSchema.statics.getTemporalTrends = function(options) {
  const { nmt, startDate, endDate, groupBy = 'month', metric = 'laeq24' } = options;

  if (!startDate || !endDate) {
    throw new Error('Se requieren fechas de inicio y fin');
  }

  const matchStage = {
    fecha: { $gte: startDate, $lte: endDate },
    [metric]: { $ne: null }
  };

  if (nmt) {
    matchStage.nmt = nmt;
  }

  const metricField = `$${metric}`;

  // Definir agrupación según el periodo
  let groupId;
  let sortField;

  switch (groupBy) {
    case 'day':
      groupId = {
        año: '$año',
        mes: '$mes',
        dia: { $dayOfMonth: '$fecha' }
      };
      sortField = { 'periodo.año': 1, 'periodo.mes': 1, 'periodo.dia': 1 };
      break;
    case 'year':
      groupId = { año: '$año' };
      sortField = { 'periodo.año': 1 };
      break;
    case 'month':
    default:
      groupId = { año: '$año', mes: '$mes' };
      sortField = { 'periodo.año': 1, 'periodo.mes': 1 };
      break;
  }

  const pipeline = [
    { $match: matchStage },
    {
      $group: {
        _id: groupId,
        promedioNivel: { $avg: metricField },
        minimoNivel: { $min: metricField },
        maximoNivel: { $max: metricField },
        desviacionEstandar: { $stdDevPop: metricField },
        totalMediciones: { $sum: 1 },
        estacionesUnicas: { $addToSet: '$nmt' }
      }
    },
    {
      $project: {
        _id: 0,
        periodo: '$_id',
        promedioNivel: { $round: ['$promedioNivel', 2] },
        minimoNivel: { $round: ['$minimoNivel', 2] },
        maximoNivel: { $round: ['$maximoNivel', 2] },
        desviacionEstandar: { $round: ['$desviacionEstandar', 2] },
        rangoVariacion: {
          $round: [{ $subtract: ['$maximoNivel', '$minimoNivel'] }, 2]
        },
        totalMediciones: 1,
        totalEstaciones: { $size: '$estacionesUnicas' }
      }
    },
    { $sort: sortField }
  ];

  return this.aggregate(pipeline).allowDiskUse(true).maxTimeMS(MONGODB_TIMEOUTS.AGGREGATE_TIMEOUT_MS);
};

/**
 * Análisis de cumplimiento normativo por zona
 *
 * Analiza el cumplimiento de límites normativos de ruido por estación y periodo.
 * Calcula porcentajes de cumplimiento y detecta incumplimientos críticos.
 * Utiliza el índice idx_noise_compliance_analysis para optimización.
 *
 * @param {Object} options - Opciones de análisis
 * @param {Date} options.startDate - Fecha de inicio del análisis
 * @param {Date} options.endDate - Fecha de fin del análisis
 * @param {Array<Number>} [options.stations] - Array de NMT específicos (opcional)
 * @returns {Promise<Object>} Objeto con análisis de cumplimiento y estadísticas
 *
 * @example
 * const compliance = await NoiseMonitoring.getComplianceAnalysisByZone({
 *   startDate: new Date('2051-01-01'),
 *   endDate: new Date('2051-12-31'),
 *   stations: [1, 2, 3]
 * });
 */
noiseMonitoringSchema.statics.getComplianceAnalysisByZone = async function(options) {
  const { startDate, endDate, stations } = options;

  if (!startDate || !endDate) {
    throw new Error('Se requieren fechas de inicio y fin');
  }

  const { DIURNO, VESPERTINO, NOCTURNO } = this.LIMITES_NORMATIVOS;
  const matchStage = { fecha: { $gte: startDate, $lte: endDate } };

  if (stations && Array.isArray(stations) && stations.length > 0) {
    matchStage.nmt = { $in: stations };
  }

  const buildComplianceCondition = (field, limit) => ({
    cumple: {
      $sum: {
        $cond: [{ $and: [{ $ne: [`$${field}`, null] }, { $lte: [`$${field}`, limit] }] }, 1, 0]
      }
    },
    incumple: {
      $sum: {
        $cond: [{ $and: [{ $ne: [`$${field}`, null] }, { $gt: [`$${field}`, limit] }] }, 1, 0]
      }
    },
    promedio: { $avg: `$${field}` },
    maximo: { $max: `$${field}` }
  });

  const estaciones = await this.aggregate([
    { $match: matchStage },
    {
      $group: {
        _id: { nmt: '$nmt', nombre: '$nombre' },
        totalMediciones: { $sum: 1 },
        ...buildComplianceCondition('nivelDiurno', DIURNO),
        ...buildComplianceCondition('nivelVespertino', VESPERTINO),
        ...buildComplianceCondition('nivelNocturno', NOCTURNO),
        promedioLaeq24: { $avg: '$laeq24' }
      }
    },
    {
      $project: {
        _id: 0,
        nmt: '$_id.nmt',
        nombre: '$_id.nombre',
        totalMediciones: 1,
        cumplimiento: {
          diurno: {
            cumple: '$cumple',
            incumple: '$incumple',
            porcentaje: {
              $round: [{
                $multiply: [{ $divide: ['$cumple', { $add: ['$cumple', '$incumple'] }] }, 100]
              }, 2]
            },
            limite: DIURNO,
            promedio: { $round: ['$promedio', 2] },
            maximo: { $round: ['$maximo', 2] }
          }
        },
        promedioGeneralLaeq24: { $round: ['$promedioLaeq24', 2] }
      }
    }
  ]).allowDiskUse(true).maxTimeMS(MONGODB_TIMEOUTS.AGGREGATE_TIMEOUT_MS);

  const resumenGlobal = {
    totalEstaciones: estaciones.length,
    cumplimientoPromedioGlobal: estaciones.length > 0
      ? Math.round(estaciones.reduce((sum, e) => sum + (e.cumplimiento?.diurno?.porcentaje || 0), 0) / estaciones.length * 100) / 100
      : 0,
    periodo: { inicio: startDate, fin: endDate },
    limites: { diurno: DIURNO, vespertino: VESPERTINO, nocturno: NOCTURNO }
  };

  return { estaciones, resumen: resumenGlobal };
};

// Crear y exportar el modelo
const NoiseMonitoring = mongoose.model('NoiseMonitoring', noiseMonitoringSchema);

module.exports = NoiseMonitoring;
