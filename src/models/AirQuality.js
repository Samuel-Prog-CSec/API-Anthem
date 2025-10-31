/**
 * Modelo de Calidad del Aire
 *
 * Esquema de Mongoose para almacenar y gestionar datos de calidad del aire
 * de los sensores distribuidos por la ciudad. Los datos incluyen mediciones
 * horarias de diferentes magnitudes (partículas, gases, etc.).
 */

const mongoose = require('mongoose');

/**
 * Sub-esquema para mediciones horarias
 * Almacena el valor de la medición y su código de validación
 */
const hourlyMeasurementSchema = new mongoose.Schema({
  value: {
    type: Number,
    required: false, // Puede ser null/undefined si no hay medición válida
    min: 0
  },
  validationCode: {
    type: String,
    enum: ['V', 'N'], // V = válido, N = no válido
    required: true
  }
}, { _id: false }); // No generar _id para subdocumentos

/**
 * Esquema principal de Calidad del Aire
 *
 * Basado en la estructura de los CSV de aire:
 * - PROVINCIA, MUNICIPIO, ESTACION: códigos de identificación geográfica
 * - MAGNITUD: tipo de contaminante medido
 * - PUNTO_MUESTREO: identificador único del punto de medición
 * - H01-H24 con V01-V24: mediciones horarias con validación
 */
const airQualitySchema = new mongoose.Schema({
  // Identificación geográfica y del sensor
  provincia: {
    type: Number,
    required: [true, 'Código de provincia obligatorio'],
    min: [1, 'Código de provincia inválido'],
    max: [99, 'Código de provincia inválido'],
    index: true
  },

  municipio: {
    type: Number,
    required: [true, 'Código de municipio obligatorio'],
    min: [1, 'Código de municipio inválido'],
    index: true
  },

  estacion: {
    type: Number,
    required: [true, 'Código de estación obligatorio'],
    min: [1, 'Código de estación inválido'],
    index: true
  },

  // Tipo de contaminante medido
  magnitud: {
    type: Number,
    required: [true, 'Código de magnitud obligatorio'],
    index: true,
    validate: {
      validator: function(v) {
        // Códigos comunes de magnitudes según normativa y datos reales
        const validMagnitudes = [1, 6, 7, 8, 9, 10, 12, 14, 20, 30, 35, 42, 43, 44];
        return validMagnitudes.includes(v);
      },
      message: 'Código de magnitud no válido'
    }
  },

  // Identificador único del punto de medición
  puntoMuestreo: {
    type: String,
    required: [true, 'Punto de muestreo obligatorio'],
    trim: true,
    index: true
  },

  // Fecha de la medición
  fecha: {
    type: Date,
    required: [true, 'Fecha de medición obligatoria'],
    index: true
  },

  // Mediciones horarias (24 horas del día)
  medicionesHorarias: {
    type: Map,
    of: hourlyMeasurementSchema,
    required: true,
    validate: {
      validator: function(map) {
        // Verificar que existan las 24 mediciones (H01 a H24)
        for (let i = 1; i <= 24; i++) {
          const key = `H${i.toString().padStart(2, '0')}`;
          if (!map.has(key)) {return false;}
        }
        return true;
      },
      message: 'Deben existir las 24 mediciones horarias'
    }
  },

  // Metadatos de calidad y procesamiento
  processingMetadata: {
    importedAt: {
      type: Date,
      default: Date.now
    },
    validMeasurements: {
      type: Number,
      min: 0,
      max: 24
    },
    dataQualityScore: {
      type: Number,
      min: 0,
      max: 1,
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
// Índice único para evitar duplicados
airQualitySchema.index(
  { provincia: 1, municipio: 1, estacion: 1, magnitud: 1, fecha: 1 },
  { unique: true, name: 'unique_measurement' }
);

// Índices para consultas por ubicación y fecha
airQualitySchema.index({ fecha: -1, magnitud: 1 });
airQualitySchema.index({ puntoMuestreo: 1, fecha: -1 });
airQualitySchema.index({ provincia: 1, municipio: 1, fecha: -1 });

// Índices adicionales para optimización de agregaciones y estadísticas
airQualitySchema.index({
  magnitud: 1,
  provincia: 1,
  'processingMetadata.validMeasurements': -1,
  fecha: -1
}, {
  name: 'stats_aggregation_idx'
});

// Índice para búsquedas de rango temporal con filtros geográficos
airQualitySchema.index({
  fecha: 1,
  provincia: 1,
  municipio: 1,
  estacion: 1,
  magnitud: 1
}, {
  name: 'temporal_geographic_idx'
});

// Índice compuesto para consultas de calidad de datos
airQualitySchema.index({
  'processingMetadata.validMeasurements': -1,
  fecha: -1,
  magnitud: 1
}, {
  name: 'quality_temporal_idx'
});

// Índice compuesto estacion + fecha (consultas por estación específica)
// Usado en: GET /api/air-quality?estacion=X&fecha=Y
airQualitySchema.index({ estacion: 1, fecha: 1 }, {
  name: 'idx_airquality_station_timeline',
  background: true
});

// Índice compuesto magnitud + fecha (consultas de contaminante específico)
// Usado en: GET /api/air-quality?magnitud=X (series temporales de PM2.5, NO2, etc.)
airQualitySchema.index({ magnitud: 1, fecha: 1 }, {
  name: 'idx_airquality_pollutant_trends',
  background: true
});

// Índice compuesto triple estacion + magnitud + fecha (consultas filtradas específicas)
// Usado en: estadísticas de contaminante X en estación Y durante período Z
airQualitySchema.index({ estacion: 1, magnitud: 1, fecha: 1 }, {
  name: 'idx_airquality_station_pollutant_date',
  background: true
});

// Índice compuesto magnitud + valor (identificación de picos de contaminación)
// Usado en: alertas de calidad del aire, búsqueda de valores extremos
// NOTA: Este índice usa 'medicionesHorarias' como Map, necesitamos índice auxiliar
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

  // Contar mediciones válidas - iterar sobre Object.entries()
  for (const [key, measurement] of Object.entries(this.medicionesHorarias)) {
    totalMeasurements++;
    if (measurement.validationCode === 'V' &&
        measurement.value !== null &&
        measurement.value !== undefined) {
      validCount++;
    }
  }

  // Calcular métricas de calidad
  this.processingMetadata.validMeasurements = validCount;
  this.processingMetadata.dataQualityScore = totalMeasurements > 0 ?
    validCount / totalMeasurements : 0;

  next();
});

/**
 * Método para obtener datos válidos del día
 * @returns {Array} Array de objetos con hora y valor para mediciones válidas
 */
airQualitySchema.methods.getValidMeasurements = function() {
  const validData = [];

  for (const [key, measurement] of Object.entries(this.medicionesHorarias)) {
    if (measurement.validationCode === 'V' &&
        measurement.value !== null &&
        measurement.value !== undefined) {
      const hour = parseInt(key.substring(1)); // Extraer número de hora de "H01", "H02", etc.
      validData.push({
        hora: hour,
        valor: measurement.value
      });
    }
  }

  return validData.sort((a, b) => a.hora - b.hora);
};

/**
 * Método para calcular estadísticas básicas del día
 * @returns {Object} Objeto con estadísticas (promedio, máximo, mínimo)
 */
airQualitySchema.methods.getDayStatistics = function() {
  const validMeasurements = this.getValidMeasurements();

  if (validMeasurements.length === 0) {
    return {
      promedio: null,
      maximo: null,
      minimo: null,
      medicionesValidas: 0
    };
  }

  const values = validMeasurements.map(m => m.valor);

  return {
    promedio: values.reduce((sum, val) => sum + val, 0) / values.length,
    maximo: Math.max(...values),
    minimo: Math.min(...values),
    medicionesValidas: validMeasurements.length
  };
};

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
 * Método estático para buscar por ubicación y rango de fechas
 */
airQualitySchema.statics.findByLocationAndDateRange = function(
  provincia,
  municipio,
  startDate,
  endDate,
  magnitudes = []
) {
  const query = {
    provincia,
    municipio,
    fecha: {
      $gte: startDate,
      $lte: endDate
    }
  };

  if (magnitudes.length > 0) {
    query.magnitud = { $in: magnitudes };
  }

  return this.find(query)
    .sort({ fecha: 1, magnitud: 1 })
    .lean(); // Para mejor rendimiento en consultas de solo lectura
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
    this.aggregate(pipeline),
    this.aggregate(resumenPipeline)
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
  ]);

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
