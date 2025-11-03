/**
 * Modelo de Disponibilidad de Bicicletas Eléctricas
 *
 * Esquema de Mongoose para la gestión de datos de disponibilidad de bicicletas eléctricas.
 * Contiene información diaria sobre uso, disponibilidad y estadísticas de bicicletas.
 */

const mongoose = require('mongoose');

/**
 * Esquema de Disponibilidad de Bicicletas
 *
 * Define la estructura de los documentos de disponibilidad diaria de bicicletas
 * con índices optimizados para consultas frecuentes.
 */
const bikeAvailabilitySchema = new mongoose.Schema({
  // Fecha del registro
  dia: {
    type: Date,
    required: true
  },

  // Horas totales que los usuarios han utilizado bicicletas
  horasTotalesUsosBicicletas: {
    type: Number,
    required: true
  },

  // Horas totales que ha habido bicicletas disponibles en anclajes
  horasTotalesDisponibilidadBicicletasEnAnclajes: {
    type: Number,
    required: true
  },

  // Sumatorio de horas de uso y disponibilidad
  totalHorasServicioBicicletas: {
    type: Number,
    required: true
  },

  // Media de bicicletas disponibles (total horas servicio / 24)
  mediaBicicletasDisponibles: {
    type: Number,
    required: true
  },

  // Número de viajes de usuarios con abono anual
  usosAbonadoAnual: {
    type: Number,
    required: true,
    default: 0
  },

  // Número de viajes de usuarios con abono ocasional
  usosAbonadoOcasional: {
    type: Number,
    required: true,
    default: 0
  },

  // Total de viajes del día
  totalUsos: {
    type: Number,
    required: true
  },

  // Campos calculados para análisis
  tasaOcupacion: {
    type: Number
  },

  promedioUsosPorBicicleta: {
    type: Number
  }

}, {
  timestamps: true,
  versionKey: false,
  collection: 'bike_availability'
});

/**
 * Middleware pre-save para cálculos automáticos
 */
bikeAvailabilitySchema.pre('save', function(next) {
  // Calcular tasa de ocupación (% de tiempo que las bicicletas están en uso)
  if (this.totalHorasServicioBicicletas > 0) {
    this.tasaOcupacion = Number(
      ((this.horasTotalesUsosBicicletas / this.totalHorasServicioBicicletas) * 100).toFixed(2)
    );
  }

  // Calcular promedio de usos por bicicleta disponible
  if (this.mediaBicicletasDisponibles > 0) {
    this.promedioUsosPorBicicleta = Number(
      (this.totalUsos / this.mediaBicicletasDisponibles).toFixed(2)
    );
  }

  next();
});

/**
 * Índices para optimización de consultas
 */

// Índice único en fecha para evitar duplicados
bikeAvailabilitySchema.index({ dia: 1 }, {
  unique: true,
  name: 'idx_bikes_unique_date',
  background: true
});

// Índice compuesto para series temporales descendentes (más reciente primero)
// Usado en: listados de datos recientes, dashboards en tiempo real
bikeAvailabilitySchema.index({ dia: -1 }, {
  name: 'idx_bikes_timeline',
  background: true
});

// Índice compuesto para análisis de uso: fecha + tasa de ocupación
// Usado en: análisis de eficiencia, identificación de picos de demanda
bikeAvailabilitySchema.index({
  dia: 1,
  tasaOcupacion: 1
}, {
  name: 'idx_bikes_usage_analysis',
  background: true
});

// Índice compuesto para comparación de tipos de abonado
// Usado en: análisis de distribución de usuarios, estadísticas por tipo
bikeAvailabilitySchema.index({
  dia: 1,
  usosAbonadoAnual: 1,
  usosAbonadoOcasional: 1
}, {
  name: 'idx_bikes_subscriber_comparison',
  background: true
});

// Índice compuesto para tendencias de disponibilidad con filtro parcial
// Usado en: análisis de capacidad del servicio, predicción de demanda
bikeAvailabilitySchema.index({
  dia: 1,
  mediaBicicletasDisponibles: 1
}, {
  name: 'idx_bikes_availability_trends',
  background: true,
  partialFilterExpression: {
    mediaBicicletasDisponibles: { $gte: 0 }
  }
});

// Índice para búsquedas por total de usos (identificar días populares)
// Usado en: análisis de picos de uso, planificación de capacidad
bikeAvailabilitySchema.index({
  totalUsos: -1,
  dia: -1
}, {
  name: 'idx_bikes_top_usage_days',
  background: true
});

// Índice compuesto para análisis de eficiencia del servicio
// Usado en: métricas de rendimiento, KPIs operacionales
bikeAvailabilitySchema.index({
  dia: 1,
  promedioUsosPorBicicleta: 1,
  tasaOcupacion: 1
}, {
  name: 'idx_bikes_efficiency_metrics',
  background: true,
  sparse: true
});

/**
 * Métodos estáticos para consultas comunes
 */

/**
 * Obtener estadísticas de disponibilidad por rango de fechas
 *
 * @param {Date} startDate - Fecha de inicio
 * @param {Date} endDate - Fecha de fin
 * @returns {Promise<Object>} Estadísticas agregadas
 */
bikeAvailabilitySchema.statics.getStatsByDateRange = function(startDate, endDate) {
  return this.aggregate([
    {
      $match: {
        dia: { $gte: startDate, $lte: endDate }
      }
    },
    {
      $group: {
        _id: null,
        totalRegistros: { $sum: 1 },
        promedioUsosDiarios: { $avg: '$totalUsos' },
        totalUsos: { $sum: '$totalUsos' },
        promedioHorasUso: { $avg: '$horasTotalesUsosBicicletas' },
        promedioBicicletasDisponibles: { $avg: '$mediaBicicletasDisponibles' },
        maxUsosDia: { $max: '$totalUsos' },
        minUsosDia: { $min: '$totalUsos' },
        promedioTasaOcupacion: { $avg: '$tasaOcupacion' },
        totalUsosAnual: { $sum: '$usosAbonadoAnual' },
        totalUsosOcasional: { $sum: '$usosAbonadoOcasional' }
      }
    }
  ]);
};

/**
 * Obtener tendencias mensuales
 *
 * @param {number} year - Año para el análisis
 * @returns {Promise<Array>} Tendencias por mes
 */
bikeAvailabilitySchema.statics.getMonthlyTrends = function(year) {
  const startDate = new Date(year, 0, 1);
  const endDate = new Date(year, 11, 31, 23, 59, 59);

  return this.aggregate([
    {
      $match: {
        dia: { $gte: startDate, $lte: endDate }
      }
    },
    {
      $group: {
        _id: { $month: '$dia' },
        mes: { $first: { $month: '$dia' } },
        totalUsos: { $sum: '$totalUsos' },
        promedioUsosDiarios: { $avg: '$totalUsos' },
        promedioBicicletasDisponibles: { $avg: '$mediaBicicletasDisponibles' },
        totalUsosAnual: { $sum: '$usosAbonadoAnual' },
        totalUsosOcasional: { $sum: '$usosAbonadoOcasional' }
      }
    },
    {
      $sort: { mes: 1 }
    }
  ]);
};

/**
 * Obtener días con mayor y menor uso
 *
 * @param {number} limit - Número de registros a retornar
 * @returns {Promise<Object>} Top días de mayor y menor uso
 */
bikeAvailabilitySchema.statics.getTopUsageDays = async function(limit = 10) {
  const [topDays, bottomDays] = await Promise.all([
    this.find()
      .sort({ totalUsos: -1 })
      .limit(limit)
      .select('dia totalUsos mediaBicicletasDisponibles tasaOcupacion'),

    this.find()
      .sort({ totalUsos: 1 })
      .limit(limit)
      .select('dia totalUsos mediaBicicletasDisponibles tasaOcupacion')
  ]);

  return { topDays, bottomDays };
};

/**
 * Comparar tipos de abonados
 *
 * @param {Date} startDate - Fecha de inicio
 * @param {Date} endDate - Fecha de fin
 * @returns {Promise<Object>} Comparación de usos por tipo de abonado
 */
bikeAvailabilitySchema.statics.compareSubscriptionTypes = function(startDate, endDate) {
  return this.aggregate([
    {
      $match: {
        dia: { $gte: startDate, $lte: endDate }
      }
    },
    {
      $group: {
        _id: null,
        totalUsosAnual: { $sum: '$usosAbonadoAnual' },
        totalUsosOcasional: { $sum: '$usosAbonadoOcasional' },
        promedioUsosAnual: { $avg: '$usosAbonadoAnual' },
        promedioUsosOcasional: { $avg: '$usosAbonadoOcasional' }
      }
    },
    {
      $project: {
        _id: 0,
        totalUsosAnual: 1,
        totalUsosOcasional: 1,
        promedioUsosAnual: { $round: ['$promedioUsosAnual', 2] },
        promedioUsosOcasional: { $round: ['$promedioUsosOcasional', 2] },
        porcentajeAnual: {
          $round: [{
            $multiply: [
              { $divide: ['$totalUsosAnual', { $add: ['$totalUsosAnual', '$totalUsosOcasional'] }] },
              100
            ]
          }, 2]
        },
        porcentajeOcasional: {
          $round: [{
            $multiply: [
              { $divide: ['$totalUsosOcasional', { $add: ['$totalUsosAnual', '$totalUsosOcasional'] }] },
              100
            ]
          }, 2]
        }
      }
    }
  ]);
};

/**
 * Obtener análisis de eficiencia del servicio optimizado
 * Método que mueve la lógica de agregación del controller al modelo
 *
 * @param {Object} filters - Filtros opcionales (fechas, etc.)
 * @returns {Promise<Object>} Análisis de eficiencia
 */
bikeAvailabilitySchema.statics.getEfficiencyAnalysisOptimized = async function(filters = {}) {
  const analysis = await this.aggregate([
    { $match: filters },
    {
      $group: {
        _id: null,
        promedioTasaOcupacion: { $avg: '$tasaOcupacion' },
        promedioUsosPorBicicleta: { $avg: '$promedioUsosPorBicicleta' },
        maxTasaOcupacion: { $max: '$tasaOcupacion' },
        minTasaOcupacion: { $min: '$tasaOcupacion' },
        promedioHorasUso: { $avg: '$horasTotalesUsosBicicletas' },
        promedioHorasDisponibilidad: { $avg: '$horasTotalesDisponibilidadBicicletasEnAnclajes' }
      }
    },
    {
      $project: {
        _id: 0,
        promedioTasaOcupacion: { $round: ['$promedioTasaOcupacion', 2] },
        promedioUsosPorBicicleta: { $round: ['$promedioUsosPorBicicleta', 2] },
        maxTasaOcupacion: { $round: ['$maxTasaOcupacion', 2] },
        minTasaOcupacion: { $round: ['$minTasaOcupacion', 2] },
        promedioHorasUso: { $round: ['$promedioHorasUso', 2] },
        promedioHorasDisponibilidad: { $round: ['$promedioHorasDisponibilidad', 2] }
      }
    }
  ]);

  return analysis.length > 0 ? analysis[0] : null;
};

/**
 * Obtener datos históricos agregados optimizado
 * Método que mueve la lógica de agregación del controller al modelo
 *
 * @param {Object} filters - Filtros opcionales (fechas, etc.)
 * @param {String} aggregation - Tipo de agregación: 'day', 'week', 'month'
 * @returns {Promise<Array>} Datos históricos agregados
 */
bikeAvailabilitySchema.statics.getHistoricalDataOptimized = async function(filters = {}, aggregation = 'day') {
  // Configurar agrupación según el nivel de agregación
  let groupBy = {};
  let sortBy = {};

  switch (aggregation) {
    case 'week':
      groupBy = {
        year: { $year: '$dia' },
        week: { $week: '$dia' }
      };
      sortBy = { '_id.year': 1, '_id.week': 1 };
      break;

    case 'month':
      groupBy = {
        year: { $year: '$dia' },
        month: { $month: '$dia' }
      };
      sortBy = { '_id.year': 1, '_id.month': 1 };
      break;

    default: // day
      groupBy = {
        year: { $year: '$dia' },
        month: { $month: '$dia' },
        day: { $dayOfMonth: '$dia' }
      };
      sortBy = { '_id.year': 1, '_id.month': 1, '_id.day': 1 };
  }

  const historicalData = await this.aggregate([
    { $match: filters },
    {
      $group: {
        _id: groupBy,
        totalUsos: { $sum: '$totalUsos' },
        promedioUsos: { $avg: '$totalUsos' },
        promedioBicicletasDisponibles: { $avg: '$mediaBicicletasDisponibles' },
        promedioTasaOcupacion: { $avg: '$tasaOcupacion' },
        totalUsosAnual: { $sum: '$usosAbonadoAnual' },
        totalUsosOcasional: { $sum: '$usosAbonadoOcasional' },
        registros: { $sum: 1 }
      }
    },
    { $sort: sortBy },
    {
      $project: {
        periodo: '$_id',
        totalUsos: 1,
        promedioUsos: { $round: ['$promedioUsos', 2] },
        promedioBicicletasDisponibles: { $round: ['$promedioBicicletasDisponibles', 2] },
        promedioTasaOcupacion: { $round: ['$promedioTasaOcupacion', 2] },
        totalUsosAnual: 1,
        totalUsosOcasional: 1,
        registros: 1
      }
    }
  ]);

  return historicalData;
};

/**
 * Análisis de tendencias de uso de bicicletas
 *
 * Analiza la evolución del uso de bicicletas en el tiempo, identificando
 * patrones de demanda, tendencias de crecimiento y comportamiento por tipo de usuario.
 * Utiliza el índice idx_bikes_usage_analysis para optimización.
 *
 * @param {Object} options - Opciones de análisis
 * @param {Date} options.startDate - Fecha de inicio del análisis
 * @param {Date} options.endDate - Fecha de fin del análisis
 * @param {String} [options.groupBy='month'] - Agrupación: 'day', 'week', 'month'
 * @param {Boolean} [options.includeUserTypes=true] - Incluir desglose por tipo de usuario
 * @returns {Promise<Array>} Array con tendencias de uso
 *
 * @example
 * const trends = await BikeAvailability.getUsageTrends({
 *   startDate: new Date('2051-01-01'),
 *   endDate: new Date('2051-12-31'),
 *   groupBy: 'month',
 *   includeUserTypes: true
 * });
 */
bikeAvailabilitySchema.statics.getUsageTrends = function(options) {
  const { startDate, endDate, groupBy = 'month', includeUserTypes = true } = options;

  if (!startDate || !endDate) {
    throw new Error('Se requieren fechas de inicio y fin');
  }

  let groupId;
  let sortField;

  switch (groupBy) {
    case 'day':
      groupId = {
        año: { $year: '$dia' },
        mes: { $month: '$dia' },
        dia: { $dayOfMonth: '$dia' }
      };
      sortField = { 'periodo.año': 1, 'periodo.mes': 1, 'periodo.dia': 1 };
      break;
    case 'week':
      groupId = {
        año: { $year: '$dia' },
        semana: { $week: '$dia' }
      };
      sortField = { 'periodo.año': 1, 'periodo.semana': 1 };
      break;
    case 'month':
    default:
      groupId = {
        año: { $year: '$dia' },
        mes: { $month: '$dia' }
      };
      sortField = { 'periodo.año': 1, 'periodo.mes': 1 };
      break;
  }

  const pipeline = [
    {
      $match: {
        dia: { $gte: startDate, $lte: endDate }
      }
    },
    {
      $group: {
        _id: groupId,
        totalUsos: { $sum: '$totalUsos' },
        promedioDisponibilidad: { $avg: '$mediaBicicletasDisponibles' },
        promedioTasaOcupacion: { $avg: '$tasaOcupacion' },
        promedioUsosPorBici: { $avg: '$promedioUsosPorBicicleta' },
        ...(includeUserTypes && {
          totalUsosAnual: { $sum: '$usosAbonadoAnual' },
          totalUsosOcasional: { $sum: '$usosAbonadoOcasional' },
          promedioUsosAnual: { $avg: '$usosAbonadoAnual' },
          promedioUsosOcasional: { $avg: '$usosAbonadoOcasional' }
        }),
        diasRegistrados: { $sum: 1 }
      }
    },
    {
      $project: {
        _id: 0,
        periodo: '$_id',
        totalUsos: 1,
        promedioDisponibilidad: { $round: ['$promedioDisponibilidad', 2] },
        promedioTasaOcupacion: { $round: ['$promedioTasaOcupacion', 2] },
        promedioUsosPorBici: { $round: ['$promedioUsosPorBici', 2] },
        ...(includeUserTypes && {
          distribucionUsuarios: {
            totalAnual: '$totalUsosAnual',
            totalOcasional: '$totalUsosOcasional',
            promedioAnual: { $round: ['$promedioUsosAnual', 2] },
            promedioOcasional: { $round: ['$promedioUsosOcasional', 2] },
            porcentajeAnual: {
              $round: [{
                $multiply: [
                  { $divide: ['$totalUsosAnual', { $add: ['$totalUsosAnual', '$totalUsosOcasional'] }] },
                  100
                ]
              }, 2]
            }
          }
        }),
        diasRegistrados: 1
      }
    },
    { $sort: sortField }
  ];

  return this.aggregate(pipeline);
};

/**
 * Predicción de demanda basada en patrones históricos
 *
 * Analiza patrones históricos de uso para identificar días de alta demanda,
 * tendencias estacionales y proyecciones futuras. Incluye análisis de días
 * de la semana y detección de anomalías.
 * Utiliza índices temporales para optimización.
 *
 * @param {Object} options - Opciones de predicción
 * @param {Date} [options.startDate] - Fecha de inicio del análisis histórico
 * @param {Date} [options.endDate] - Fecha de fin del análisis histórico
 * @param {Number} [options.threshold=80] - Umbral de ocupación para considerar alta demanda (%)
 * @returns {Promise<Object>} Objeto con análisis de patrones y predicciones
 *
 * @example
 * const prediction = await BikeAvailability.getDemandPrediction({
 *   startDate: new Date('2051-01-01'),
 *   endDate: new Date('2051-12-31'),
 *   threshold: 80
 * });
 */
bikeAvailabilitySchema.statics.getDemandPrediction = async function(options = {}) {
  const { startDate, endDate, threshold = 80 } = options;

  const matchStage = {};
  if (startDate && endDate) {
    matchStage.dia = { $gte: startDate, $lte: endDate };
  }

  const patternAnalysis = await this.aggregate([
    ...(Object.keys(matchStage).length > 0 ? [{ $match: matchStage }] : []),
    {
      $project: {
        dia: 1,
        diaSemana: { $dayOfWeek: '$dia' },
        mes: { $month: '$dia' },
        totalUsos: 1,
        tasaOcupacion: 1,
        mediaBicicletasDisponibles: 1,
        altaDemanda: { $gte: ['$tasaOcupacion', threshold] }
      }
    },
    {
      $group: {
        _id: {
          diaSemana: '$diaSemana',
          mes: '$mes'
        },
        promedioUsos: { $avg: '$totalUsos' },
        promedioTasaOcupacion: { $avg: '$tasaOcupacion' },
        promedioDisponibilidad: { $avg: '$mediaBicicletasDisponibles' },
        diasAltaDemanda: { $sum: { $cond: ['$altaDemanda', 1, 0] } },
        totalDias: { $sum: 1 }
      }
    },
    {
      $project: {
        _id: 0,
        diaSemana: '$_id.diaSemana',
        mes: '$_id.mes',
        promedioUsos: { $round: ['$promedioUsos', 2] },
        promedioTasaOcupacion: { $round: ['$promedioTasaOcupacion', 2] },
        promedioDisponibilidad: { $round: ['$promedioDisponibilidad', 2] },
        probabilidadAltaDemanda: {
          $round: [{ $multiply: [{ $divide: ['$diasAltaDemanda', '$totalDias'] }, 100] }, 2]
        },
        totalDias: 1
      }
    },
    { $sort: { probabilidadAltaDemanda: -1 } }
  ]);

  const globalStats = await this.aggregate([
    ...(Object.keys(matchStage).length > 0 ? [{ $match: matchStage }] : []),
    {
      $group: {
        _id: null,
        promedioUsosGeneral: { $avg: '$totalUsos' },
        maximoUsos: { $max: '$totalUsos' },
        minimoUsos: { $min: '$totalUsos' },
        desviacionEstandar: { $stdDevPop: '$totalUsos' },
        promedioTasaOcupacion: { $avg: '$tasaOcupacion' }
      }
    },
    {
      $project: {
        _id: 0,
        promedioUsosGeneral: { $round: ['$promedioUsosGeneral', 2] },
        maximoUsos: 1,
        minimoUsos: 1,
        desviacionEstandar: { $round: ['$desviacionEstandar', 2] },
        promedioTasaOcupacion: { $round: ['$promedioTasaOcupacion', 2] }
      }
    }
  ]);

  return {
    patrones: patternAnalysis,
    estadisticasGenerales: globalStats[0] || {},
    recomendaciones: {
      umbralAltaDemanda: threshold,
      periodo: startDate && endDate ? { inicio: startDate, fin: endDate } : 'Histórico completo'
    }
  };
};

// Crear y exportar el modelo
const BikeAvailability = mongoose.model('BikeAvailability', bikeAvailabilitySchema);

module.exports = BikeAvailability;
