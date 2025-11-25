/**
 * Modelo de Tráfico
 *
 * Esquema de Mon  fecha: {
    type: Date,
    required: true,
    index: true,
    validate: {
      validator: validateDatasetDate,
      message: 'La fecha debe estar dentro del rango del dataset (2050-2052)'
    }
  },a almacenar y gestionar datos de intensidad del tráfico
 * provenientes de los sensores distribuidos por la ciudad.
 * Incluye validaciones, índices optimizados para consultas frecuentes,
 * y métodos para análisis de congestión y calidad de datos.
 */

const mongoose = require('mongoose');
const { validateSpeed, validatePercentage, validateDatasetDate, validateMonth, validateYear } = require('./schemas/commonSchemas');
const {
  CONGESTION_LEVELS,
  DATA_QUALITY_LEVELS,
  TRAFFIC_ELEMENT_TYPES,
  TRAFFIC_INTENSITY_LEVELS,
  TRAFFIC_ERROR_CODES,
  DAY_PERIODS,
  WORKDAY_TYPES,
  VALIDATION_LIMITS,
  TRAFFIC_THRESHOLDS
} = require('../constants');

/**
 * Esquema principal de mediciones de tráfico
 *
 * Basado en la estructura de los CSV de tráfico:
 * - id: Identificación única del Punto de Medida (relación con PuntoMedidaTrafico)
 * - fecha: Fecha y hora oficiales con formato yyyy-mm-dd hh:mi:ss
 * - identif: Identificador del Punto de Medida (compatibilidad hacia atrás)
 * - tipo_elem: Tipo de Punto de Medida (Urbano o M30)
 * - intensidad: Intensidad del Punto de Medida en el periodo de 15 minutos (vehículos/hora)
 * - ocupacion: Tiempo de Ocupación del Punto de Medida en el periodo de 15 minutos (%)
 * - carga: Carga de vehículos en el periodo de 15 minutos (0-100)
 * - vmed: Velocidad media de los vehículos en el periodo de 15 minutos (Km./h)
 * - error: Indicación de errores en el periodo de medición
 * - periodo_integracion: Número de muestras recibidas para el periodo
 */
const trafficSchema = new mongoose.Schema({
  // Identificación del punto de medida
  puntoMedidaId: {
    type: String,
    required: true,
    index: true,
    trim: true
  },

  // Información temporal
  fecha: {
    type: Date,
    required: true,
    index: true,
    validate: {
      validator: validateDatasetDate,
      message: 'La fecha de medición debe estar dentro del rango del dataset (2050-2052)'
    }
  },

  // Para facilitar consultas por periodos
  año: {
    type: Number,
    required: true,
    index: true,
    validate: {
      validator: validateYear,
      message: 'Año debe estar entre 2000 y 3000'
    }
  },

  mes: {
    type: Number,
    required: true,
    index: true,
    validate: {
      validator: validateMonth,
      message: 'Mes debe estar entre 1 y 12'
    }
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

  // Clasificación del punto de medida
  tipoElemento: {
    type: String,
    required: true,
    enum: Object.values(TRAFFIC_ELEMENT_TYPES),
    index: true,
    uppercase: true
  },

  // Métricas de tráfico
  metricas: {
    // Intensidad del tráfico (vehículos/hora)
    intensidad: {
      type: Number,
      required: true,
      index: true,
      validate: {
        validator: function(v) {
          // Validación mejorada: límite superior realista (máximo físico ~10000 veh/h por carril)
          return v >= VALIDATION_LIMITS.TRAFFIC_INTENSITY_MIN && v <= VALIDATION_LIMITS.TRAFFIC_INTENSITY_MAX;
        },
        message: `Intensidad debe estar entre ${VALIDATION_LIMITS.TRAFFIC_INTENSITY_MIN} y ${VALIDATION_LIMITS.TRAFFIC_INTENSITY_MAX} veh/h (límite físico razonable)`
      }
    },

    // Porcentaje de ocupación de la vía (0-100%)
    // null representa ausencia de datos
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

    // Carga de la vía (0-100)
    // null representa ausencia de datos
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

    // Velocidad media (solo para M-30, en km/h)
    // null representa ausencia de datos
    velocidadMedia: {
      type: Number,
      required: false,
      default: null,
      validate: {
        validator: function(v) {
          if (v === null || v === undefined) {return true;}
          return validateSpeed(v);
        },
        message: 'Velocidad media debe estar entre 0 y 300 km/h o ser null'
      }
    }
  },

  // Control de calidad
  calidadDatos: {
    // Indicador de error
    error: {
      type: String,
      required: true,
      enum: TRAFFIC_ERROR_CODES,
      default: 'N'
    },

    // Número de muestras integradas
    periodoIntegracion: {
      type: Number,
      required: true
    },

    // Calidad general de la medición
    calidadGeneral: {
      type: String,
      enum: Object.values(DATA_QUALITY_LEVELS),
      default: 'SIN_DATOS'
    }
  },

  // Análisis automático de condiciones de tráfico
  analisis: {
    // Nivel de congestión basado en ocupación y carga
    nivelCongestion: {
      type: String,
      enum: Object.values(CONGESTION_LEVELS),
      default: 'SIN_DATOS',
      index: true
    },

    // Clasificación por intensidad
    clasificacionIntensidad: {
      type: String,
      enum: TRAFFIC_INTENSITY_LEVELS,
      default: 'SIN_DATOS',
      index: true
    },

    // Periodo del día
    periodoDia: {
      type: String,
      enum: Object.values(DAY_PERIODS),
      default: DAY_PERIODS.MAÑANA,
      index: true
    },

    // Día laborable o festivo (se puede mejorar con calendario festivos)
    tipoJornada: {
      type: String,
      enum: Object.values(WORKDAY_TYPES),
      default: 'LABORABLE',
      index: true
    }
  },

  // Información de procesamiento
  procesamiento: {
    importadoEn: {
      type: Date,
      default: Date.now
    },
    archivoOrigen: {
      type: String,
      trim: true
    },
    validacionesPasadas: [{
      validacion: String,
      resultado: Boolean,
      fecha: {
        type: Date,
        default: Date.now
      }
    }]
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
// Garantiza que no existan mediciones duplicadas para el mismo punto en la misma fecha/hora
// Combinación: puntoMedidaId + fecha
// CRÍTICO: NO ELIMINAR
trafficSchema.index(
  { puntoMedidaId: 1, fecha: 1 },
  { unique: true, name: 'traffic_unique_measurement' }
);

// ========================================
// ÍNDICES PRINCIPALES - Consultas frecuentes
// ========================================

// ÍNDICE CONSOLIDADO: fecha + puntoMedidaId + intensidad
// MEJORA: Reemplaza 2 índices redundantes optimizando espacio
// Soporta queries: { fecha: -1 }, { fecha: -1, puntoMedidaId: 1 }, { fecha: -1, puntoMedidaId: 1, intensidad: -1 }
// Usado en: trafficController.js:60,87 - Sort por fecha + filtro puntoMedidaId + ordenación por intensidad
// Leftmost prefix permite múltiples patrones de consulta
trafficSchema.index({ fecha: -1, puntoMedidaId: 1, 'metricas.intensidad': -1 }, {
  name: 'idx_traffic_date_point_intensity',
  background: true
});

// Índice para consultas temporales descompuestas (análisis por períodos)
// Usado en: Agregaciones que usan año, mes, dia, hora
// Soporta: Análisis por franjas horarias, patrones diarios/mensuales
trafficSchema.index({ año: 1, mes: 1, dia: 1, hora: 1 }, {
  name: 'idx_traffic_temporal_components',
  background: true
});

// Índice compuesto: tipoElemento + fecha
// Usado en: trafficController.js:49 - Filtro tipoElemento (URB, M30)
// Soporta: GET /api/traffic?tipoElemento=URB&startDate=X&endDate=Y
trafficSchema.index({ tipoElemento: 1, fecha: -1 }, {
  name: 'idx_traffic_type_timeline',
  background: true
});

// ========================================
// ÍNDICES PARA MÉTRICAS DE TRÁFICO
// ========================================

// Índice SPARSE para velocidad media (solo para M-30)
// MEJORA: Usa sparse index ya que velocidadMedia es opcional (solo M-30 tiene datos)
// Ahorro de espacio: ~40-50% (no indexa documentos URB sin velocidad)
// Usado en: Consultas de velocidad en M-30, análisis de fluidez
// Soporta: GET /api/traffic?tipoElemento=M-30&sortBy=velocidadMedia
trafficSchema.index({ 'metricas.velocidadMedia': -1, fecha: -1 }, {
  name: 'idx_traffic_speed_m30',
  background: true,
  sparse: true, // SPARSE: Solo indexa docs con velocidadMedia != null
  partialFilterExpression: {
    'metricas.velocidadMedia': { $ne: null },
    tipoElemento: 'M-30' // Solo M-30 tiene velocidad
  }
});

// Índice para filtrar por nivel de congestión
// Usado en: trafficController.js:50 - Filtro nivelCongestion
// Soporta: GET /api/traffic?nivelCongestion=ALTO
trafficSchema.index({ 'analisis.nivelCongestion': 1, fecha: -1 }, {
  name: 'idx_traffic_congestion_timeline',
  background: true
});

// Índice para análisis por período del día y tipo de vía
// Usado en: Agregaciones de patrones (MAÑANA, TARDE, NOCHE)
// Soporta: Análisis de congestión por franja horaria y tipo de elemento
trafficSchema.index({ 'analisis.periodoDia': 1, tipoElemento: 1 }, {
  name: 'idx_traffic_period_type',
  background: true
});

// ========================================
// ÍNDICES PARA AGREGACIONES AVANZADAS
// ========================================

// Índice compuesto para análisis de patrones de tráfico
// Usado en: Traffic.getCongestionAnalysisOptimized() - Agregaciones complejas
// Soporta: $group por tipoElemento + periodoDia + tipoJornada
trafficSchema.index({
  tipoElemento: 1,
  'analisis.periodoDia': 1,
  'analisis.tipoJornada': 1,
  fecha: -1
}, {
  name: 'idx_traffic_pattern_analysis',
  background: true
});

// Índice para análisis histórico de congestión por punto
// Usado en: Análisis de evolución temporal de congestión en ubicación específica
// Soporta: Series temporales de nivelCongestion para un puntoMedidaId
trafficSchema.index({
  puntoMedidaId: 1,
  'analisis.nivelCongestion': 1,
  fecha: -1
}, {
  name: 'idx_traffic_point_congestion_history',
  background: true
});

/**
 * ========================================
 * MÉTODOS DE INSTANCIA
 * ========================================
 */

/**
 * Calculate congestion level based on occupation and load
 * Updates: analisis.nivelCongestion
 */
trafficSchema.methods.calculateCongestionLevel = function() {
  const ocupacion = this.metricas.ocupacion || 0;
  const carga = this.metricas.carga || 0;

  // Si no hay datos válidos
  if (this.calidadDatos.error !== TRAFFIC_ERROR_CODES.NO_ERROR) {
    this.analisis.nivelCongestion = CONGESTION_LEVELS.SIN_DATOS;
    return;
  }

  // Clasificación basada en ocupación y carga
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

/**
 * Calculate intensity classification based on traffic flow
 * Updates: analisis.clasificacionIntensidad
 */
trafficSchema.methods.calculateIntensityClassification = function() {
  const intensidad = this.metricas.intensidad || 0;

  // Si no hay datos válidos
  if (this.calidadDatos.error !== TRAFFIC_ERROR_CODES.NO_ERROR) {
    this.analisis.clasificacionIntensidad = TRAFFIC_INTENSITY_LEVELS.SIN_DATOS;
    return;
  }

  // Clasificación basada en intensidad (vehículos/hora)
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

/**
 * Calculate overall data quality based on error indicator and integration period
 * Updates: calidadDatos.calidadGeneral
 */
trafficSchema.methods.calculateOverallQuality = function() {
  const error = this.calidadDatos.error;
  const periodoIntegracion = this.calidadDatos.periodoIntegracion || 0;

  // Clasificación de calidad
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
 * Middleware pre-save para procesamiento automático
 */
trafficSchema.pre('save', function(next) {
  // Extraer componentes de fecha
  if (this.fecha) {
    this.año = this.fecha.getFullYear();
    this.mes = this.fecha.getMonth() + 1;
    this.dia = this.fecha.getDate();
    this.hora = this.fecha.getHours();
    this.minutos = this.fecha.getMinutes();
  }

  // Calcular análisis automáticos si no están establecidos
  if (!this.analisis) {
    this.analisis = {};
  }

  if (!this.analisis.nivelCongestion) {
    this.calculateCongestionLevel();
  }

  if (!this.analisis.clasificacionIntensidad) {
    this.calculateIntensityClassification();
  }

  if (!this.calidadDatos) {
    this.calidadDatos = {};
  }

  if (!this.calidadDatos.calidadGeneral) {
    this.calculateOverallQuality();
  }

  next();
});

/**
 * Métodos estáticos para consultas agregadas (OPTIMIZADOS)
 */

/**
 * Obtener análisis de congestión optimizado con lookup a ubicaciones
 * @param {Object} filters - Filtros de fecha y tipo
 * @param {string} groupBy - Criterio de agrupación ('distrito' o 'tipoElemento')
 * @returns {Promise<Array>} Análisis de congestión por zona
 */
trafficSchema.statics.getCongestionAnalysisOptimized = async function(filters = {}, groupBy = 'distrito') {
  const pipeline = [
    { $match: filters }
  ];

  // Si agrupamos por distrito, necesitamos hacer lookup
  if (groupBy === 'distrito') {
    pipeline.push(
      {
        $lookup: {
          from: 'locations',
          let: { puntoId: '$puntoMedidaId' },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ['$tipo', 'punto_trafico'] },
                    { $eq: ['$id_punto', '$$puntoId'] }
                  ]
                }
              }
            },
            {
              $project: { distrito: 1, _id: 0 }
            }
          ],
          as: 'ubicacion'
        }
      },
      {
        $addFields: {
          distrito: { $arrayElemAt: ['$ubicacion.distrito', 0] }
        }
      }
    );
  }

  // Agregación principal
  pipeline.push(
    {
      $group: {
        _id: groupBy === 'distrito' ? '$distrito' : '$tipoElemento',
        totalMediciones: { $sum: 1 },
        intensidadPromedio: {
          $avg: {
            $cond: [{ $gte: ['$metricas.intensidad', 0] }, '$metricas.intensidad', null]
          }
        },
        ocupacionPromedio: {
          $avg: {
            $cond: [{ $gte: ['$metricas.ocupacion', 0] }, '$metricas.ocupacion', null]
          }
        },
        medicionesFluidas: {
          $sum: { $cond: [{ $eq: ['$analisis.nivelCongestion', 'FLUIDO'] }, 1, 0] }
        },
        medicionesDensas: {
          $sum: { $cond: [{ $eq: ['$analisis.nivelCongestion', 'DENSO'] }, 1, 0] }
        },
        medicionesCongestionadas: {
          $sum: { $cond: [{ $eq: ['$analisis.nivelCongestion', 'CONGESTIONADO'] }, 1, 0] }
        },
        medicionesColapsadas: {
          $sum: { $cond: [{ $eq: ['$analisis.nivelCongestion', 'COLAPSADO'] }, 1, 0] }
        }
      }
    },
    {
      $addFields: {
        zona: '$_id',
        porcentajeCongestion: {
          $cond: [
            { $gt: ['$totalMediciones', 0] },
            {
              $multiply: [
                {
                  $divide: [
                    { $add: ['$medicionesCongestionadas', '$medicionesColapsadas'] },
                    '$totalMediciones'
                  ]
                },
                100
              ]
            },
            0
          ]
        },
        porcentajeFluido: {
          $cond: [
            { $gt: ['$totalMediciones', 0] },
            {
              $multiply: [
                { $divide: ['$medicionesFluidas', '$totalMediciones'] },
                100
              ]
            },
            0
          ]
        }
      }
    },
    {
      $project: {
        _id: 0,
        zona: 1,
        totalMediciones: 1,
        intensidadPromedio: { $round: ['$intensidadPromedio', 2] },
        ocupacionPromedio: { $round: ['$ocupacionPromedio', 2] },
        distribucion: {
          fluidas: '$medicionesFluidas',
          densas: '$medicionesDensas',
          congestionadas: '$medicionesCongestionadas',
          colapsadas: '$medicionesColapsadas'
        },
        porcentajeCongestion: { $round: ['$porcentajeCongestion', 2] },
        porcentajeFluido: { $round: ['$porcentajeFluido', 2] }
      }
    },
    { $sort: { porcentajeCongestion: -1 } }
  );

  return this.aggregate(pipeline).allowDiskUse(true).maxTimeMS(10000);
};

/**
 * Obtener datos históricos optimizado con agregación por periodo
 * @param {Object} filters - Filtros de fecha, punto, tipo
 * @param {string} aggregation - Tipo de agregación ('hour', 'day', 'week', 'month')
 * @returns {Promise<Array>} Datos históricos agregados
 */
trafficSchema.statics.getHistoricalDataOptimized = async function(filters = {}, aggregation = 'hour') {
  // Configurar agrupación temporal según el tipo
  let dateGrouping;
  let sortFields;

  switch (aggregation) {
    case 'hour':
      dateGrouping = {
        año: '$año',
        mes: '$mes',
        dia: '$dia',
        hora: '$hora'
      };
      sortFields = { 'periodo.año': 1, 'periodo.mes': 1, 'periodo.dia': 1, 'periodo.hora': 1 };
      break;
    case 'day':
      dateGrouping = {
        año: '$año',
        mes: '$mes',
        dia: '$dia'
      };
      sortFields = { 'periodo.año': 1, 'periodo.mes': 1, 'periodo.dia': 1 };
      break;
    case 'week':
      dateGrouping = {
        año: '$año',
        semana: { $week: '$fecha' }
      };
      sortFields = { 'periodo.año': 1, 'periodo.semana': 1 };
      break;
    case 'month':
      dateGrouping = {
        año: '$año',
        mes: '$mes'
      };
      sortFields = { 'periodo.año': 1, 'periodo.mes': 1 };
      break;
    default:
      dateGrouping = { hora: '$hora' };
      sortFields = { 'periodo.hora': 1 };
  }

  const pipeline = [
    { $match: filters },
    {
      $group: {
        _id: dateGrouping,
        totalMediciones: { $sum: 1 },
        intensidadPromedio: {
          $avg: {
            $cond: [{ $gte: ['$metricas.intensidad', 0] }, '$metricas.intensidad', null]
          }
        },
        intensidadMaxima: {
          $max: {
            $cond: [{ $gte: ['$metricas.intensidad', 0] }, '$metricas.intensidad', null]
          }
        },
        intensidadMinima: {
          $min: {
            $cond: [{ $gte: ['$metricas.intensidad', 0] }, '$metricas.intensidad', null]
          }
        },
        ocupacionPromedio: {
          $avg: {
            $cond: [{ $gte: ['$metricas.ocupacion', 0] }, '$metricas.ocupacion', null]
          }
        },
        ocupacionMaxima: {
          $max: {
            $cond: [{ $gte: ['$metricas.ocupacion', 0] }, '$metricas.ocupacion', null]
          }
        },
        cargaPromedio: {
          $avg: {
            $cond: [{ $gte: ['$metricas.carga', 0] }, '$metricas.carga', null]
          }
        },
        velocidadPromedio: {
          $avg: {
            $cond: [{ $gte: ['$metricas.velocidad', 0] }, '$metricas.velocidad', null]
          }
        },
        medicionesCongestionadas: {
          $sum: {
            $cond: [
              { $in: ['$analisis.nivelCongestion', [CONGESTION_LEVELS.CONGESTIONADO, CONGESTION_LEVELS.COLAPSADO]] },
              1,
              0
            ]
          }
        },
        medicionesConfiables: {
          $sum: {
            $cond: [
              { $in: ['$calidadDatos.calidadGeneral', [DATA_QUALITY_LEVELS.ALTA, DATA_QUALITY_LEVELS.MEDIA]] },
              1,
              0
            ]
          }
        }
      }
    },
    {
      $addFields: {
        periodo: '$_id',
        porcentajeCongestion: {
          $cond: [
            { $gt: ['$totalMediciones', 0] },
            {
              $multiply: [
                { $divide: ['$medicionesCongestionadas', '$totalMediciones'] },
                100
              ]
            },
            0
          ]
        },
        confiabilidad: {
          $cond: [
            { $gt: ['$totalMediciones', 0] },
            {
              $multiply: [
                { $divide: ['$medicionesConfiables', '$totalMediciones'] },
                100
              ]
            },
            0
          ]
        }
      }
    },
    {
      $project: {
        _id: 0,
        periodo: 1,
        totalMediciones: 1,
        metricas: {
          intensidad: {
            promedio: { $round: ['$intensidadPromedio', 2] },
            maxima: { $round: ['$intensidadMaxima', 2] },
            minima: { $round: ['$intensidadMinima', 2] }
          },
          ocupacion: {
            promedio: { $round: ['$ocupacionPromedio', 2] },
            maxima: { $round: ['$ocupacionMaxima', 2] }
          },
          carga: { $round: ['$cargaPromedio', 2] },
          velocidad: { $round: ['$velocidadPromedio', 2] }
        },
        porcentajeCongestion: { $round: ['$porcentajeCongestion', 2] },
        confiabilidad: { $round: ['$confiabilidad', 2] }
      }
    },
    { $sort: sortFields }
  ];

  return this.aggregate(pipeline).allowDiskUse(true).maxTimeMS(10000);
};

/**
 * Obtener estadísticas generales optimizado con agregación paralela
 * @param {Object} filters - Filtros de fecha y tipo
 * @returns {Promise<Object>} Estadísticas generales y detalladas
 */
trafficSchema.statics.getTrafficStatisticsOptimized = async function(filters = {}) {
  // Usar Promise.all para ejecutar agregaciones en paralelo
  const [estadisticasGenerales, distribucionTipos, distribucionHoraria] = await Promise.all([
    // Estadísticas generales
    this.aggregate([
      { $match: filters },
      {
        $group: {
          _id: null,
          totalMediciones: { $sum: 1 },
          intensidadPromedio: {
            $avg: {
              $cond: [{ $gte: ['$metricas.intensidad', 0] }, '$metricas.intensidad', null]
            }
          },
          intensidadMaxima: {
            $max: {
              $cond: [{ $gte: ['$metricas.intensidad', 0] }, '$metricas.intensidad', null]
            }
          },
          ocupacionPromedio: {
            $avg: {
              $cond: [{ $gte: ['$metricas.ocupacion', 0] }, '$metricas.ocupacion', null]
            }
          },
          cargaPromedio: {
            $avg: {
              $cond: [{ $gte: ['$metricas.carga', 0] }, '$metricas.carga', null]
            }
          },
          velocidadPromedio: {
            $avg: {
              $cond: [{ $gte: ['$metricas.velocidad', 0] }, '$metricas.velocidad', null]
            }
          },
          medicionesConfiables: {
            $sum: {
              $cond: [{ $in: ['$calidadDatos.calidadGeneral', [DATA_QUALITY_LEVELS.ALTA, DATA_QUALITY_LEVELS.MEDIA]] }, 1, 0]
            }
          },
          medicionesCongestionadas: {
            $sum: {
              $cond: [{ $in: ['$analisis.nivelCongestion', [CONGESTION_LEVELS.CONGESTIONADO, CONGESTION_LEVELS.COLAPSADO]] }, 1, 0]
            }
          }
        }
      },
      {
        $project: {
          _id: 0,
          totalMediciones: 1,
          intensidadPromedio: { $round: ['$intensidadPromedio', 2] },
          intensidadMaxima: { $round: ['$intensidadMaxima', 2] },
          ocupacionPromedio: { $round: ['$ocupacionPromedio', 2] },
          cargaPromedio: { $round: ['$cargaPromedio', 2] },
          velocidadPromedio: { $round: ['$velocidadPromedio', 2] },
          porcentajeConfiabilidad: {
            $round: [
              { $multiply: [{ $divide: ['$medicionesConfiables', '$totalMediciones'] }, 100] },
              2
            ]
          },
          porcentajeCongestion: {
            $round: [
              { $multiply: [{ $divide: ['$medicionesCongestionadas', '$totalMediciones'] }, 100] },
              2
            ]
          }
        }
      }
    ]),

    // Distribución por tipos de elemento
    this.aggregate([
      { $match: filters },
      {
        $group: {
          _id: '$tipoElemento',
          cantidad: { $sum: 1 },
          intensidadPromedio: {
            $avg: {
              $cond: [{ $gte: ['$metricas.intensidad', 0] }, '$metricas.intensidad', null]
            }
          }
        }
      },
      {
        $project: {
          _id: 0,
          tipo: '$_id',
          cantidad: 1,
          intensidadPromedio: { $round: ['$intensidadPromedio', 2] }
        }
      },
      { $sort: { cantidad: -1 } }
    ]).allowDiskUse(true).maxTimeMS(10000),

    // Distribución horaria
    this.aggregate([
      { $match: filters },
      {
        $group: {
          _id: '$analisis.periodoDia',
          cantidad: { $sum: 1 },
          intensidadPromedio: {
            $avg: {
              $cond: [{ $gte: ['$metricas.intensidad', 0] }, '$metricas.intensidad', null]
            }
          },
          congestionPromedio: {
            $avg: {
              $cond: [
                { $in: ['$analisis.nivelCongestion', [CONGESTION_LEVELS.CONGESTIONADO, CONGESTION_LEVELS.COLAPSADO]] },
                100,
                0
              ]
            }
          }
        }
      },
      {
        $project: {
          _id: 0,
          periodo: '$_id',
          cantidad: 1,
          intensidadPromedio: { $round: ['$intensidadPromedio', 2] },
          nivelCongestion: { $round: ['$congestionPromedio', 2] }
        }
      },
      {
        $sort: {
          periodo: 1
        }
      }
    ]).allowDiskUse(true).maxTimeMS(10000)
  ]);

  return {
    resumen: estadisticasGenerales[0] || {},
    porTipoElemento: distribucionTipos,
    porPeriodoDia: distribucionHoraria
  };
};

// Crear y exportar el modelo
const Traffic = mongoose.model('Traffic', trafficSchema);

module.exports = Traffic;
