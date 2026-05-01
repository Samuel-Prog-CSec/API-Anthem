/**
 * Modelo de Disponibilidad de Bicicletas Eléctricas
 *
 * Esquema de Mongoose para la gestión de datos de disponibilidad de bicicletas eléctricas.
 * Contiene información diaria sobre uso, disponibilidad y estadísticas de bicicletas.
 */

const mongoose = require('mongoose');
const { validateDatasetDate } = require('./schemas/commonSchemas');
const {
  TIME_CONSTANTS,
  UMBRALES_USO_BICICLETAS,
  VALIDATION_LIMITS,
  MONGODB_TIMEOUTS,
  DATASET_YEARS
} = require('../constants');

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
    required: true,
    validate: {
      validator: validateDatasetDate,
      message: `La fecha debe estar dentro del rango del dataset (${DATASET_YEARS.MIN_YEAR}-${DATASET_YEARS.MAX_YEAR})`
    }
  },

  // Horas totales que los usuarios han utilizado bicicletas
  horasTotalesUsosBicicletas: {
    type: Number,
    required: true,
    min: [VALIDATION_LIMITS.QUANTITY_MIN, 'Las horas de uso no pueden ser negativas'],
    validate: {
      validator: function(v) {
        // Validación física: las horas de uso no pueden superar 24h * número de bicicletas
        // Si no hay bicicletas disponibles (mediaBicicletasDisponibles = 0), no puede haber horas de uso
        if (this.mediaBicicletasDisponibles === 0) {
          return v === 0;
        }
        // Las horas de uso totales no pueden superar el máximo físico posible (24h por bici)
        return v <= (TIME_CONSTANTS.HOURS_PER_DAY * this.mediaBicicletasDisponibles);
      },
      message: `Las horas de uso no pueden superar ${TIME_CONSTANTS.HOURS_PER_DAY} horas por bicicleta disponible (horasTotalesUso <= ${TIME_CONSTANTS.HOURS_PER_DAY} * mediaBicisDisponibles)`
    }
  },

  // Horas totales que ha habido bicicletas disponibles en anclajes
  horasTotalesDisponibilidadBicicletasEnAnclajes: {
    type: Number,
    required: true,
    min: [VALIDATION_LIMITS.QUANTITY_MIN, 'Las horas de disponibilidad no pueden ser negativas']
  },

  // Sumatorio de horas de uso y disponibilidad
  totalHorasServicioBicicletas: {
    type: Number,
    required: true,
    min: [VALIDATION_LIMITS.QUANTITY_MIN, 'El total de horas de servicio no puede ser negativo']
  },

  // Media de bicicletas disponibles (total horas servicio / 24)
  mediaBicicletasDisponibles: {
    type: Number,
    required: true,
    min: [VALIDATION_LIMITS.QUANTITY_MIN, 'La media de bicicletas disponibles no puede ser negativa']
  },

  // Número de viajes de usuarios con abono anual
  usosAbonadoAnual: {
    type: Number,
    required: true,
    default: 0,
    min: [VALIDATION_LIMITS.QUANTITY_MIN, 'Los usos con abono anual no pueden ser negativos']
  },

  // Número de viajes de usuarios con abono ocasional
  usosAbonadoOcasional: {
    type: Number,
    required: true,
    default: 0,
    min: [VALIDATION_LIMITS.QUANTITY_MIN, 'Los usos con abono ocasional no pueden ser negativos']
  },

  // Total de viajes del día
  totalUsos: {
    type: Number,
    required: true,
    min: [VALIDATION_LIMITS.QUANTITY_MIN, 'El total de usos no puede ser negativo'],
    validate: {
      validator: function(value) {
        return value === (this.usosAbonadoAnual + this.usosAbonadoOcasional);
      },
      message: 'El total de usos debe coincidir con la suma de usos por abono anual y ocasional'
    }
  },

  // Campos calculados para análisis
  tasaOcupacion: {
    type: Number,
    max: [VALIDATION_LIMITS.PERCENTAGE_MAX, 'La tasa de ocupación no puede superar el 100%']
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

// ========================================
// ÍNDICE ÚNICO - Prevención de duplicados
// ========================================
// Garantiza que solo exista un registro por día
// Un día = un resumen completo de disponibilidad de bicicletas
// CRÍTICO: NO ELIMINAR
bikeAvailabilitySchema.index({ dia: 1 }, {
  unique: true,
  name: 'idx_bikes_unique_date'
});

// ========================================
// ÍNDICES PRINCIPALES - Consultas frecuentes
// ========================================

// Índice para series temporales descendentes
// Usado en: GET /api/bike-availability?sortOrder=desc
// Soporta: Listados de datos más recientes primero, dashboards
bikeAvailabilitySchema.index({ dia: -1 }, {
  name: 'idx_bikes_timeline'
});

// Índice para ranking por total de usos
// Usado en: "Días con más uso del servicio"
// Sort: totalUsos descendente + día descendente
bikeAvailabilitySchema.index({
  totalUsos: -1,
  dia: -1
}, {
  name: 'idx_bikes_top_usage_days'
});

// ========================================
// ÍNDICES PARA ANÁLISIS DE USO
// ========================================

// Índice compuesto: día + tasa de ocupación
// Usado en: Análisis de eficiencia del servicio
// Soporta: Identificación de picos de demanda, períodos de saturación
// tasaOcupacion = horasUso / horasDisponibilidad
bikeAvailabilitySchema.index({
  dia: 1,
  tasaOcupacion: 1
}, {
  name: 'idx_bikes_usage_analysis'
});

// Índice compuesto: día + tipos de abonado
// Usado en: Comparación entre abonados anuales vs ocasionales
// Soporta: Análisis de distribución de usuarios, tendencias de suscripción
bikeAvailabilitySchema.index({
  dia: 1,
  usosAbonadoAnual: 1,
  usosAbonadoOcasional: 1
}, {
  name: 'idx_bikes_subscriber_comparison'
});

// ========================================
// ÍNDICES PARA ANÁLISIS DE DISPONIBILIDAD
// ========================================

// Índice compuesto: día + media de bicicletas disponibles
// Usado en: Análisis de capacidad del servicio
// Soporta: Predicción de demanda, planificación de expansión
// PARTIAL FILTER: Solo registros con mediaBicicletasDisponibles >= 0 (válidos)
bikeAvailabilitySchema.index({
  dia: 1,
  mediaBicicletasDisponibles: 1
}, {
  name: 'idx_bikes_availability_trends',
  partialFilterExpression: {
    mediaBicicletasDisponibles: { $gte: 0 }
  }
});

// ========================================
// ÍNDICES PARA MÉTRICAS DE EFICIENCIA
// ========================================

// Índice compuesto: día + métricas de rendimiento
// Usado en: KPIs operacionales, dashboards de gestión
// Métricas: promedioUsosPorBicicleta + tasaOcupación
// SPARSE: Solo documentos con métricas calculadas (no null)
bikeAvailabilitySchema.index({
  dia: 1,
  promedioUsosPorBicicleta: 1,
  tasaOcupacion: 1
}, {
  name: 'idx_bikes_efficiency_metrics',
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
bikeAvailabilitySchema.statics.obtenerEstadisticasPorRangoFechas = function(startDate, endDate) {
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
  ]).option({ allowDiskUse: true, maxTimeMS: MONGODB_TIMEOUTS.AGGREGATE_TIMEOUT_MS });
};

/**
 * Obtener tendencias mensuales
 *
 * @param {number} year - Año para el análisis
 * @returns {Promise<Array>} Tendencias por mes
 */
bikeAvailabilitySchema.statics.obtenerTendenciasMensuales = function(year) {
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
  ]).option({ allowDiskUse: true, maxTimeMS: MONGODB_TIMEOUTS.AGGREGATE_TIMEOUT_MS });
};

/**
 * Obtener días con mayor y menor uso
 *
 * @param {number} limit - Número de registros a retornar
 * @returns {Promise<Object>} Top días de mayor y menor uso
 */
bikeAvailabilitySchema.statics.obtenerDiasMayorUso = async function(limit = 10) {
  const [topDays, bottomDays] = await Promise.all([
    this.find()
      .sort({ totalUsos: -1 })
      .limit(limit)
      .select('dia totalUsos mediaBicicletasDisponibles tasaOcupacion')
      .lean()
      .maxTimeMS(MONGODB_TIMEOUTS.AGGREGATE_TIMEOUT_MS),

    this.find()
      .sort({ totalUsos: 1 })
      .limit(limit)
      .select('dia totalUsos mediaBicicletasDisponibles tasaOcupacion')
      .lean()
      .maxTimeMS(MONGODB_TIMEOUTS.AGGREGATE_TIMEOUT_MS)
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
bikeAvailabilitySchema.statics.compararTiposSuscripcion = function(startDate, endDate) {
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
            $cond: [
              { $eq: [{ $add: ['$totalUsosAnual', '$totalUsosOcasional'] }, 0] },
              0,
              { $multiply: [
                { $divide: ['$totalUsosAnual', { $add: ['$totalUsosAnual', '$totalUsosOcasional'] }] },
                100
              ]}
            ]
          }, 2]
        },
        porcentajeOcasional: {
          $round: [{
            $cond: [
              { $eq: [{ $add: ['$totalUsosAnual', '$totalUsosOcasional'] }, 0] },
              0,
              { $multiply: [
                { $divide: ['$totalUsosOcasional', { $add: ['$totalUsosAnual', '$totalUsosOcasional'] }] },
                100
              ]}
            ]
          }, 2]
        }
      }
    }
  ]).option({ allowDiskUse: true, maxTimeMS: MONGODB_TIMEOUTS.AGGREGATE_TIMEOUT_MS });
};

/**
 * Obtener análisis de eficiencia del servicio optimizado
 * Método que mueve la lógica de agregación del controller al modelo
 *
 * @param {Object} filters - Filtros opcionales (fechas, etc.)
 * @returns {Promise<Object>} Análisis de eficiencia
 */
bikeAvailabilitySchema.statics.obtenerAnalisisEficienciaOptimizado = async function(filters = {}) {
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
  ]).option({ allowDiskUse: true, maxTimeMS: MONGODB_TIMEOUTS.AGGREGATE_TIMEOUT_MS });

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
bikeAvailabilitySchema.statics.obtenerDatosHistoricosOptimizado = async function(filters = {}, aggregation = 'day') {
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
  ]).option({ allowDiskUse: true, maxTimeMS: MONGODB_TIMEOUTS.AGGREGATE_TIMEOUT_MS });

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
bikeAvailabilitySchema.statics.obtenerTendenciasUso = function(options) {
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
                $cond: [
                  { $eq: [{ $add: ['$totalUsosAnual', '$totalUsosOcasional'] }, 0] },
                  0,
                  { $multiply: [
                    { $divide: ['$totalUsosAnual', { $add: ['$totalUsosAnual', '$totalUsosOcasional'] }] },
                    100
                  ]}
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

  return this.aggregate(pipeline).option({ allowDiskUse: true, maxTimeMS: MONGODB_TIMEOUTS.AGGREGATE_TIMEOUT_MS });
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
bikeAvailabilitySchema.statics.obtenerPrediccionDemanda = async function(options = {}) {
  const { startDate, endDate, threshold = UMBRALES_USO_BICICLETAS.HIGH_DEMAND_OCCUPANCY } = options;

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
  ]).option({ allowDiskUse: true, maxTimeMS: MONGODB_TIMEOUTS.AGGREGATE_TIMEOUT_MS });

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
  ]).option({ allowDiskUse: true, maxTimeMS: MONGODB_TIMEOUTS.AGGREGATE_TIMEOUT_MS });

  return {
    patrones: patternAnalysis,
    estadisticasGenerales: globalStats[0] || {},
    recomendaciones: {
      umbralAltaDemanda: threshold,
      periodo: startDate && endDate ? { inicio: startDate, fin: endDate } : 'Histórico completo'
    }
  };
};

// Transformación de salida para reducir tamaño de respuesta
bikeAvailabilitySchema.set('toJSON', {
  transform: (_doc, ret) => {
    delete ret.createdAt;
    delete ret.updatedAt;
    return ret;
  }
});

// Crear y exportar el modelo
const BikeAvailability = mongoose.model('BikeAvailability', bikeAvailabilitySchema);

module.exports = BikeAvailability;
