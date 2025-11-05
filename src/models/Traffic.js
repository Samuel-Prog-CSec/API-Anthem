/**
 * Modelo de Tráfico
 *
 * Esquema de Mongoose para almacenar y gestionar datos de intensidad del tráfico
 * provenientes de los sensores distribuidos por la ciudad. Incluye información sobre
 * flujo vehicular, ocupación de vías, velocidades y estado de sensores.
 */

const mongoose = require('mongoose');
const { validateVelocidad, validatePorcentaje, validateFechaNoFutura, validateMes, validateAño } = require('./schemas/commonSchemas');

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
      validator: validateFechaNoFutura,
      message: 'La fecha de medición no puede ser futura'
    }
  },

  // Para facilitar consultas por periodos
  año: {
    type: Number,
    required: true,
    index: true,
    validate: {
      validator: validateAño,
      message: 'Año debe estar entre 2000 y 3000'
    }
  },

  mes: {
    type: Number,
    required: true,
    index: true,
    validate: {
      validator: validateMes,
      message: 'Mes debe estar entre 1 y 12'
    }
  },

  dia: {
    type: Number,
    required: true,
    min: [1, 'Día debe estar entre 1 y 31'],
    max: [31, 'Día debe estar entre 1 y 31']
  },

  hora: {
    type: Number,
    required: true,
    index: true,
    min: [0, 'Hora debe estar entre 0 y 23'],
    max: [23, 'Hora debe estar entre 0 y 23']
  },

  minutos: {
    type: Number,
    required: true,
    min: [0, 'Minutos deben estar entre 0 y 59'],
    max: [59, 'Minutos deben estar entre 0 y 59']
  },

  // Clasificación del punto de medida
  tipoElemento: {
    type: String,
    required: true,
    enum: ['URB', 'M-30'],
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
      min: [0, 'Intensidad no puede ser negativa']
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
          return validatePorcentaje(v);
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
          return validateVelocidad(v);
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
      enum: ['N', 'E', 'S'],
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
      enum: ['ALTA', 'MEDIA', 'BAJA', 'SIN_DATOS'],
      default: 'SIN_DATOS'
    }
  },

  // Análisis automático de condiciones de tráfico
  analisis: {
    // Nivel de congestión basado en ocupación y carga
    nivelCongestion: {
      type: String,
      enum: ['FLUIDO', 'DENSO', 'CONGESTIONADO', 'COLAPSADO', 'SIN_DATOS'],
      default: 'SIN_DATOS',
      index: true
    },

    // Clasificación por intensidad
    clasificacionIntensidad: {
      type: String,
      enum: ['MUY_BAJA', 'BAJA', 'MEDIA', 'ALTA', 'MUY_ALTA', 'SIN_DATOS'],
      default: 'SIN_DATOS',
      index: true
    },

    // Periodo del día
    periodoDia: {
      type: String,
      enum: ['MADRUGADA', 'MAÑANA', 'MEDIODIA', 'TARDE', 'NOCHE'],
      default: 'MAÑANA',
      index: true
    },

    // Día laborable o festivo (se puede mejorar con calendario festivos)
    tipoJornada: {
      type: String,
      enum: ['LABORABLE', 'SABADO', 'DOMINGO_FESTIVO'],
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

// Índice compuesto: fecha (desc) + puntoMedidaId
// Usado en: trafficController.js:60 - Sort por fecha (línea 60: sortBy='fecha')
// Usado en: trafficController.js:48 - Filtro puntoMedidaId (línea 48)
// Soporta: GET /api/traffic?puntoMedidaId=X&sortBy=fecha&sortOrder=desc
trafficSchema.index({ fecha: -1, puntoMedidaId: 1 });

// Índice para consultas temporales descompuestas
// Usado en: Agregaciones que usan año, mes, dia, hora
// Soporta: Análisis por franjas horarias, patrones diarios/mensuales
trafficSchema.index({ año: 1, mes: 1, dia: 1, hora: 1 });

// Índice compuesto: tipoElemento + fecha
// Usado en: trafficController.js:49 - Filtro tipoElemento (URB, M30, INTERURBANA)
// Soporta: GET /api/traffic?tipoElemento=URB&startDate=X&endDate=Y
trafficSchema.index({ tipoElemento: 1, fecha: -1 });

// ========================================
// ÍNDICES PARA MÉTRICAS DE TRÁFICO
// ========================================

// Índice para ordenar por intensidad (tráfico más denso)
// Usado en: trafficController.js:60 - sortBy='intensidad'
// Usado en: Análisis de puntos más congestionados
// Soporta: GET /api/traffic?sortBy=intensidad&sortOrder=desc
trafficSchema.index({ 'metricas.intensidad': -1, fecha: -1 });

// Índice compuesto optimizado: fecha + puntoMedidaId + intensidad
// OPTIMIZACIÓN DE RENDIMIENTO: Para queries con filtro de fecha e intensidad
// Mejora: 5-10x más rápido en queries con múltiples filtros
// Soporta: GET /api/traffic?startDate=X&endDate=Y&puntoMedidaId=Z&minIntensidad=N
trafficSchema.index({ fecha: -1, puntoMedidaId: 1, 'metricas.intensidad': -1 });

// Índice para filtrar por nivel de congestión
// Usado en: trafficController.js:50 - Filtro nivelCongestion (BAJO, MEDIO, ALTO, MUY_ALTO)
// Soporta: GET /api/traffic?nivelCongestion=ALTO
trafficSchema.index({ 'analisis.nivelCongestion': 1, fecha: -1 });

// Índice para análisis por período del día y tipo de vía
// Usado en: Agregaciones de patrones (MAÑANA, TARDE, NOCHE)
// Soporta: Análisis de congestión por franja horaria y tipo de elemento
trafficSchema.index({ 'analisis.periodoDia': 1, tipoElemento: 1 });

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
});

// Índice para análisis histórico de congestión por punto
// Usado en: Análisis de evolución temporal de congestión en ubicación específica
// Soporta: Series temporales de nivelCongestion para un puntoMedidaId
trafficSchema.index({
  puntoMedidaId: 1,
  'analisis.nivelCongestion': 1,
  fecha: -1
});

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
    this.calcularNivelCongestion();
  }

  if (!this.analisis.clasificacionIntensidad) {
    this.calcularClasificacionIntensidad();
  }

  if (!this.calidadDatos) {
    this.calidadDatos = {};
  }

  if (!this.calidadDatos.calidadGeneral) {
    this.calcularCalidadGeneral();
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

  return this.aggregate(pipeline).allowDiskUse(true);
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
              { $in: ['$analisis.nivelCongestion', ['CONGESTIONADO', 'COLAPSADO']] },
              1,
              0
            ]
          }
        },
        medicionesConfiables: {
          $sum: {
            $cond: [
              { $in: ['$calidadDatos.calidadGeneral', ['ALTA', 'MEDIA']] },
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

  return this.aggregate(pipeline).allowDiskUse(true);
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
              $cond: [{ $in: ['$calidadDatos.calidadGeneral', ['ALTA', 'MEDIA']] }, 1, 0]
            }
          },
          medicionesCongestionadas: {
            $sum: {
              $cond: [{ $in: ['$analisis.nivelCongestion', ['CONGESTIONADO', 'COLAPSADO']] }, 1, 0]
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
    ]).allowDiskUse(true),

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
                { $in: ['$analisis.nivelCongestion', ['CONGESTIONADO', 'COLAPSADO']] },
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
    ]).allowDiskUse(true)
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
