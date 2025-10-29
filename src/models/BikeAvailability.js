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
    required: [true, 'La fecha es obligatoria']
  },

  // Horas totales que los usuarios han utilizado bicicletas
  horasTotalesUsosBicicletas: {
    type: Number,
    required: [true, 'Horas totales de uso es obligatorio'],
    min: [0, 'Las horas de uso no pueden ser negativas']
  },

  // Horas totales que ha habido bicicletas disponibles en anclajes
  horasTotalesDisponibilidadBicicletasEnAnclajes: {
    type: Number,
    required: [true, 'Horas totales de disponibilidad es obligatorio'],
    min: [0, 'Las horas de disponibilidad no pueden ser negativas']
  },

  // Sumatorio de horas de uso y disponibilidad
  totalHorasServicioBicicletas: {
    type: Number,
    required: [true, 'Total de horas de servicio es obligatorio'],
    min: [0, 'El total de horas de servicio no puede ser negativo']
  },

  // Media de bicicletas disponibles (total horas servicio / 24)
  mediaBicicletasDisponibles: {
    type: Number,
    required: [true, 'Media de bicicletas disponibles es obligatoria'],
    min: [0, 'La media de bicicletas no puede ser negativa']
  },

  // Número de viajes de usuarios con abono anual
  usosAbonadoAnual: {
    type: Number,
    required: [true, 'Usos de abonado anual es obligatorio'],
    min: [0, 'Los usos no pueden ser negativos'],
    default: 0
  },

  // Número de viajes de usuarios con abono ocasional
  usosAbonadoOcasional: {
    type: Number,
    required: [true, 'Usos de abonado ocasional es obligatorio'],
    min: [0, 'Los usos no pueden ser negativos'],
    default: 0
  },

  // Total de viajes del día
  totalUsos: {
    type: Number,
    required: [true, 'Total de usos es obligatorio'],
    min: [0, 'El total de usos no puede ser negativo']
  },

  // Campos calculados para análisis
  tasaOcupacion: {
    type: Number,
    min: [0, 'La tasa de ocupación no puede ser negativa'],
    max: [100, 'La tasa de ocupación no puede exceder 100%']
  },

  promedioUsosPorBicicleta: {
    type: Number,
    min: [0, 'El promedio de usos no puede ser negativo']
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
bikeAvailabilitySchema.index({ dia: 1 }, { unique: true });

// Índice compuesto para consultas por rango de fechas con ordenamiento
bikeAvailabilitySchema.index({ dia: -1, totalUsos: -1 });

// Índice para consultas de estadísticas agregadas
bikeAvailabilitySchema.index({
  dia: 1,
  mediaBicicletasDisponibles: 1,
  totalUsos: 1
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
bikeAvailabilitySchema.statics.getStatsByDateRange = async function(startDate, endDate) {
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
bikeAvailabilitySchema.statics.getMonthlyTrends = async function(year) {
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
bikeAvailabilitySchema.statics.compareSubscriptionTypes = async function(startDate, endDate) {
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

// Crear y exportar el modelo
const BikeAvailability = mongoose.model('BikeAvailability', bikeAvailabilitySchema);

module.exports = BikeAvailability;
