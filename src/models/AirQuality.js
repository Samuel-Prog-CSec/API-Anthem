/**
 * Modelo de Calidad del Aire
 *
 * Esquema de Mongoose para almacenar y gestionar datos de calidad del aire
 * de los sensores distribuidos por la ciudad. Los datos incluyen mediciones
 * horarias de diferentes magnitudes (partículas, gases, etc.).
 */

const mongoose = require('mongoose');
const { validateFechaNoFutura } = require('./schemas/commonSchemas');

/**
 * Magnitudes oficiales permitidas según normativa de calidad del aire
 * Fuente: Ministerio para la Transición Ecológica (MITECO)
 */
const MAGNITUDES_PERMITIDAS = [
  1, // Dióxido de Azufre (SO2)
  6, // Monóxido de Carbono (CO)
  7, // Monóxido de Nitrógeno (NO)
  8, // Dióxido de Nitrógeno (NO2)
  9, // Partículas < 2.5 μm (PM2.5)
  10, // Partículas < 10 μm (PM10)
  12, // Óxidos de Nitrógeno (NOx)
  14, // Ozono (O3)
  20, // Tolueno
  30, // Benceno
  35, // Etilbenceno
  42, // Hidrocarburos totales (hexano)
  43, // Metano (CH4)
  44 // Hidrocarburos no metánicos
];

/**
 * Sub-esquema para mediciones horarias
 * Almacena el valor de la medición y su código de validación
 */
const hourlyMeasurementSchema = new mongoose.Schema({
  value: {
    type: Number,
    required: false,
    validate: {
      validator: function(v) {
        // Permitir null/undefined, pero si existe debe ser >= 0
        if (v === null || v === undefined) {return true;}
        return v >= 0 && v <= 10000; // Límite razonable para mediciones (μg/m³ o similar)
      },
      message: 'Valor de medición debe estar entre 0 y 10000'
    }
  },
  validationCode: {
    type: String,
    enum: ['V', 'N'],
    required: true,
    uppercase: true
  }
}, { _id: false });

/**
 * Esquema principal de Calidad del Aire
 */
const airQualitySchema = new mongoose.Schema({
  // Identificación geográfica y del sensor
  provincia: {
    type: Number,
    required: true,
    index: true
  },

  municipio: {
    type: Number,
    required: true,
    index: true
  },

  estacion: {
    type: Number,
    required: true,
    index: true
  },

  // Tipo de contaminante medido
  magnitud: {
    type: Number,
    required: true,
    index: true,
    validate: {
      validator: function(v) {
        return MAGNITUDES_PERMITIDAS.includes(v);
      },
      message: 'Magnitud debe ser un código válido oficial (SO2, CO, NO2, PM2.5, PM10, O3, etc.)'
    }
  },

  // Identificador único del punto de medición
  puntoMuestreo: {
    type: String,
    required: true,
    trim: true,
    index: true,
    uppercase: true
  },

  // Fecha de la medición
  fecha: {
    type: Date,
    required: true,
    index: true,
    validate: {
      validator: validateFechaNoFutura,
      message: 'La fecha de medición no puede ser futura'
    }
  },

  // Mediciones horarias (24 horas del día)
  medicionesHorarias: {
    type: Map,
    of: hourlyMeasurementSchema,
    required: true,
    validate: [
      {
        validator: function(v) {
          // Validar que haya exactamente 24 mediciones horarias (H01-H24)
          return v.size === 24;
        },
        message: 'Debe haber exactamente 24 mediciones horarias (H01-H24)'
      },
      {
        validator: function(v) {
          // Validar que haya al menos 1 medición válida (validationCode = 'V')
          const validas = Array.from(v.values()).filter(m => m.validationCode === 'V');
          return validas.length > 0;
        },
        message: 'Debe haber al menos una medición válida (validationCode=V) en el día'
      }
    ]
  },

  // Metadatos de calidad y procesamiento
  processingMetadata: {
    importedAt: {
      type: Date,
      default: Date.now
    },
    validMeasurements: {
      type: Number,
      default: 0
    },
    dataQualityScore: {
      type: Number,
      default: 0
    }
  }

}, {
  timestamps: true,
  versionKey: false
});

/**
 * Índices compuestos para optimizar consultas comunes
 */

// ========================================
// ÍNDICE ÚNICO - Prevención de duplicados
// ========================================
// Garantiza que no haya mediciones duplicadas para la misma combinación
// provincia + municipio + estacion + magnitud + fecha
// CRÍTICO: NO ELIMINAR
airQualitySchema.index(
  { provincia: 1, municipio: 1, estacion: 1, magnitud: 1, fecha: 1 },
  { unique: true, name: 'unique_measurement' }
);

// ========================================
// ÍNDICES PRINCIPALES - Queries frecuentes
// ========================================

// Índice para consultas por magnitud ordenadas por fecha (desc)
// Usado en: airQualityController.js:85 - GET /api/air-quality?magnitud=X
// Sort: fecha desc (línea 56)
// Ejemplo: Obtener series temporales de PM2.5, NO2, O3
airQualitySchema.index({ fecha: -1, magnitud: 1 });

// Índice para consultas por punto de muestreo
// Usado en: airQualityController.js:85 - GET /api/air-quality?puntoMuestreo=X
// Filtro: puntoMuestreo exact match (línea 39)
airQualitySchema.index({ puntoMuestreo: 1, fecha: -1 });

// Índice para consultas geográficas (provincia + municipio)
// Usado en: airQualityController.js:85 - GET /api/air-quality?provincia=X&municipio=Y
// Filtros: provincia (línea 33), municipio (línea 34)
airQualitySchema.index({ provincia: 1, municipio: 1, fecha: -1 });

// ========================================
// ÍNDICES PARA AGREGACIONES Y ESTADÍSTICAS
// ========================================

// Índice para agregaciones de estadísticas por magnitud
// Usado en: Métodos estáticos getStatisticsOptimized(), getTrendsOptimized()
// Soporta: $group por magnitud + provincia, filtro por validMeasurements > 0
airQualitySchema.index({
  magnitud: 1,
  provincia: 1,
  'processingMetadata.validMeasurements': -1,
  fecha: -1
}, {
  name: 'stats_aggregation_idx'
});

// Índice para búsquedas de rango temporal con filtros geográficos
// Usado en: airQualityController.js:85 - Consultas con múltiples filtros
// Soporta: startDate/endDate (línea 30) + filtros geográficos combinados
airQualitySchema.index({
  fecha: 1,
  provincia: 1,
  municipio: 1,
  estacion: 1,
  magnitud: 1
}, {
  name: 'temporal_geographic_idx'
});

// Índice para consultas de calidad de datos
// Usado en: airQualityController.js:43 - Filtro includeInvalid=false (por defecto)
// Filtro: processingMetadata.validMeasurements > 0
airQualitySchema.index({
  'processingMetadata.validMeasurements': -1,
  fecha: -1,
  magnitud: 1
}, {
  name: 'quality_temporal_idx'
});

// ========================================
// ÍNDICES SECUNDARIOS - Consultas específicas
// ========================================

// Índice compuesto estacion + fecha
// Usado en: GET /api/air-quality?estacion=X&startDate=Y&endDate=Z
// Filtro: estacion (línea 35)
airQualitySchema.index({ estacion: 1, fecha: 1 }, {
  name: 'idx_airquality_station_timeline',
  background: true
});

// Índice compuesto magnitud + fecha (orden ascendente para series temporales)
// Usado en: GET /api/air-quality?magnitud=X (series temporales de contaminantes)
// Filtro: magnitud (línea 36-37)
airQualitySchema.index({ magnitud: 1, fecha: 1 }, {
  name: 'idx_airquality_pollutant_trends',
  background: true
});

// Índice compuesto triple estacion + magnitud + fecha
// Usado en: Consultas específicas filtradas (estación + contaminante + período)
// Combina filtros: estacion + magnitud + fecha
airQualitySchema.index({ estacion: 1, magnitud: 1, fecha: 1 }, {
  name: 'idx_airquality_station_pollutant_date',
  background: true
});

// Índice para validación de mediciones por magnitud
// Usado en: Filtro de calidad (validMeasurements > 0) por tipo de contaminante
// Filtro: magnitud + processingMetadata.validMeasurements
airQualitySchema.index({ magnitud: 1, 'processingMetadata.validMeasurements': 1 }, {
  name: 'idx_airquality_pollutant_validation',
  background: true
});

/**
 * Middleware pre-save para calcular metadatos de calidad
 */
airQualitySchema.pre('save', function(next) {
  let validCount = 0;
  let totalMeasurements = 0;

  // Contar mediciones válidas - iterar sobre Map correctamente
  if (this.medicionesHorarias instanceof Map) {
    for (const [_key, measurement] of this.medicionesHorarias.entries()) {
      totalMeasurements++;
      if (measurement.validationCode === 'V' &&
          measurement.value !== null &&
          measurement.value !== undefined) {
        validCount++;
      }
    }
  }

  // Calcular métricas de calidad
  this.processingMetadata.validMeasurements = validCount;
  this.processingMetadata.dataQualityScore = totalMeasurements > 0 ?
    validCount / totalMeasurements : 0;

  next();
});

/**
 * Método estático para obtener magnitudes disponibles
 * @returns {Object} Mapa de códigos de magnitud a descripciones
 */
airQualitySchema.statics.getMagnitudes = function() {
  return {
    1: 'Dióxido de azufre (SO2)',
    6: 'Monóxido de carbono (CO)',
    7: 'Monóxido de nitrógeno (NO)',
    8: 'Dióxido de nitrógeno (NO2)',
    9: 'Partículas < 2.5 μm (PM2.5)',
    10: 'Partículas < 10 μm (PM10)',
    12: 'Óxidos de nitrógeno (NOx)',
    14: 'Ozono (O3)',
    20: 'Tolueno',
    30: 'Benceno',
    35: 'Etilbenceno',
    42: 'Hidrocarburos totales (HCT)',
    43: 'Hidrocarburos no metánicos (HCNM)',
    44: 'Metano (CH4)'
  };
};

/**
 * Obtener estadísticas agregadas de calidad de aire
 * Método optimizado que mueve la lógica de agregación del controller al modelo
 *
 * @param {Object} filters - Filtros base (provincia, municipio, magnitud, fechas)
 * @param {String} groupBy - Tipo de agrupación: 'day', 'month', 'year', 'station'
 * @returns {Promise<Object>} Estadísticas agregadas y resumen general
 */
airQualitySchema.statics.getStatisticsOptimized = async function(filters = {}, groupBy = 'day') {
  // Construir stage de match
  const matchStage = { ...filters };
  matchStage['processingMetadata.validMeasurements'] = { $gt: 0 };

  // Configurar agrupación según parámetro
  let groupByConfig = {};
  let sortStage = {};

  switch (groupBy) {
    case 'month':
      groupByConfig = {
        año: { $year: '$fecha' },
        mes: { $month: '$fecha' },
        magnitud: '$magnitud'
      };
      sortStage = { '_id.año': -1, '_id.mes': -1, '_id.magnitud': 1 };
      break;

    case 'year':
      groupByConfig = {
        año: { $year: '$fecha' },
        magnitud: '$magnitud'
      };
      sortStage = { '_id.año': -1, '_id.magnitud': 1 };
      break;

    case 'station':
      groupByConfig = {
        provincia: '$provincia',
        municipio: '$municipio',
        estacion: '$estacion',
        magnitud: '$magnitud'
      };
      sortStage = { '_id.provincia': 1, '_id.municipio': 1, '_id.estacion': 1 };
      break;

    case 'day':
    default:
      groupByConfig = {
        fecha: {
          $dateFromParts: {
            year: { $year: '$fecha' },
            month: { $month: '$fecha' },
            day: { $dayOfMonth: '$fecha' }
          }
        },
        magnitud: '$magnitud'
      };
      sortStage = { '_id.fecha': -1, '_id.magnitud': 1 };
      break;
  }

  // Pipeline de agregación principal
  const pipeline = [
    { $match: matchStage },
    {
      $addFields: {
        promedioMediciones: {
          $avg: {
            $map: {
              input: { $objectToArray: '$medicionesHorarias' },
              as: 'medicion',
              in: {
                $cond: [
                  {
                    $and: [
                      { $eq: ['$$medicion.v.validationCode', 'V'] },
                      { $ne: ['$$medicion.v.value', null] }
                    ]
                  },
                  '$$medicion.v.value',
                  null
                ]
              }
            }
          }
        }
      }
    },
    {
      $group: {
        _id: groupByConfig,
        promedioGeneral: { $avg: '$promedioMediciones' },
        valorMaximo: { $max: '$promedioMediciones' },
        valorMinimo: { $min: '$promedioMediciones' },
        totalRegistros: { $sum: 1 },
        calidadPromedio: { $avg: '$processingMetadata.dataQualityScore' }
      }
    },
    { $match: { promedioGeneral: { $ne: null } } },
    { $sort: sortStage },
    { $limit: 1000 }
  ];

  // Pipeline para resumen general
  const resumenPipeline = [
    { $match: matchStage },
    {
      $group: {
        _id: null,
        totalRegistros: { $sum: 1 },
        estacionesUnicas: { $addToSet: '$estacion' },
        magnitudesUnicas: { $addToSet: '$magnitud' },
        fechaInicio: { $min: '$fecha' },
        fechaFin: { $max: '$fecha' },
        calidadPromedioGlobal: { $avg: '$processingMetadata.dataQualityScore' }
      }
    }
  ];

  // Ejecutar ambas agregaciones en paralelo
  const [estadisticas, resumenArray] = await Promise.all([
    this.aggregate(pipeline).allowDiskUse(true),
    this.aggregate(resumenPipeline).allowDiskUse(true)
  ]);

  const resumen = resumenArray[0] ? {
    ...resumenArray[0],
    totalEstaciones: resumenArray[0].estacionesUnicas.length,
    totalMagnitudes: resumenArray[0].magnitudesUnicas.length
  } : null;

  return {
    estadisticas,
    resumen,
    configuracion: {
      agrupacion: groupBy,
      filtros: Object.keys(matchStage).length > 1 ? matchStage : null
    }
  };
};

/**
 * Obtener tendencias de calidad de aire optimizado
 * Calcula tendencias diarias con estadísticas y análisis de tendencia
 *
 * @param {Number} provincia - Código de provincia
 * @param {Number} municipio - Código de municipio
 * @param {Number} magnitud - Código de magnitud
 * @param {Date} startDate - Fecha de inicio (opcional)
 * @param {Date} endDate - Fecha de fin (opcional)
 * @returns {Promise<Object>} Tendencias diarias y estadísticas
 */
airQualitySchema.statics.getTrendsOptimized = async function(provincia, municipio, magnitud, startDate, endDate) {
  const matchFilters = {
    provincia: parseInt(provincia),
    municipio: parseInt(municipio),
    magnitud: parseInt(magnitud),
    'processingMetadata.validMeasurements': { $gt: 0 }
  };

  if (startDate || endDate) {
    matchFilters.fecha = {};
    if (startDate) {matchFilters.fecha.$gte = new Date(startDate);}
    if (endDate) {matchFilters.fecha.$lte = new Date(endDate);}
  }

  // Pipeline para tendencia diaria
  const tendenciaDiaria = await this.aggregate([
    { $match: matchFilters },
    {
      $addFields: {
        promedioMediciones: {
          $avg: {
            $map: {
              input: { $objectToArray: '$medicionesHorarias' },
              as: 'medicion',
              in: {
                $cond: [
                  {
                    $and: [
                      { $eq: ['$$medicion.v.validationCode', 'V'] },
                      { $ne: ['$$medicion.v.value', null] }
                    ]
                  },
                  '$$medicion.v.value',
                  null
                ]
              }
            }
          }
        }
      }
    },
    {
      $group: {
        _id: {
          fecha: {
            $dateFromParts: {
              year: { $year: '$fecha' },
              month: { $month: '$fecha' },
              day: { $dayOfMonth: '$fecha' }
            }
          }
        },
        valorPromedio: { $avg: '$promedioMediciones' },
        valorMaximo: { $max: '$promedioMediciones' },
        valorMinimo: { $min: '$promedioMediciones' }
      }
    },
    { $sort: { '_id.fecha': 1 } },
    { $limit: 365 }
  ]).allowDiskUse(true);

  // Calcular estadísticas de la tendencia
  const valores = tendenciaDiaria
    .map(item => item.valorPromedio)
    .filter(val => val !== null);

  const estadisticasTendencia = valores.length > 0 ? {
    promedio: valores.reduce((sum, val) => sum + val, 0) / valores.length,
    maximo: Math.max(...valores),
    minimo: Math.min(...valores),
    desviacionEstandar: Math.sqrt(
      valores.reduce((sum, val) => {
        const mean = valores.reduce((s, v) => s + v, 0) / valores.length;
        return sum + Math.pow(val - mean, 2);
      }, 0) / valores.length
    ),
    tendencia: valores.length > 1 ? (valores[valores.length - 1] - valores[0]) / valores.length : 0
  } : null;

  return {
    tendenciaDiaria,
    estadisticas: estadisticasTendencia,
    periodoAnalisis: {
      fechaInicio: tendenciaDiaria[0]?._id.fecha,
      fechaFin: tendenciaDiaria[tendenciaDiaria.length - 1]?._id.fecha,
      totalPuntos: tendenciaDiaria.length
    }
  };
};

// Crear y exportar el modelo
const AirQuality = mongoose.model('AirQuality', airQualitySchema);

module.exports = AirQuality;
