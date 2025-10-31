/**
 * Modelo de Tráfico
 *
 * Esquema de Mongoose para almacenar y gestionar datos de intensidad del tráfico
 * provenientes de los sensores distribuidos por la ciudad. Incluye información sobre
 * flujo vehicular, ocupación de vías, velocidades y estado de sensores.
 */

const mongoose = require('mongoose');

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
    required: [true, 'ID del punto de medida obligatorio'],
    index: true,
    trim: true,
    validate: {
      validator: function(v) {
        return /^\d+$/.test(v);
      },
      message: 'ID del punto de medida debe ser numérico'
    }
  },

  // Información temporal
  fecha: {
    type: Date,
    required: [true, 'Fecha y hora de medición obligatoria'],
    index: true
  },

  // Para facilitar consultas por periodos
  año: {
    type: Number,
    required: [true, 'Año obligatorio'],
    index: true
  },

  mes: {
    type: Number,
    required: [true, 'Mes obligatorio'],
    min: [1, 'Mes debe estar entre 1 y 12'],
    max: [12, 'Mes debe estar entre 1 y 12'],
    index: true
  },

  dia: {
    type: Number,
    required: [true, 'Día obligatorio'],
    min: [1, 'Día debe estar entre 1 y 31'],
    max: [31, 'Día debe estar entre 1 y 31']
  },

  hora: {
    type: Number,
    required: [true, 'Hora obligatoria'],
    min: [0, 'Hora debe estar entre 0 y 23'],
    max: [23, 'Hora debe estar entre 0 y 23'],
    index: true
  },

  minutos: {
    type: Number,
    required: [true, 'Minutos obligatorios'],
    min: [0, 'Minutos deben estar entre 0 y 59'],
    max: [59, 'Minutos deben estar entre 0 y 59'],
    validate: {
      validator: function(v) {
        // Las mediciones son cada 15 minutos: 0, 15, 30, 45
        return [0, 15, 30, 45].includes(v);
      },
      message: 'Las mediciones deben ser cada 15 minutos (0, 15, 30, 45)'
    }
  },

  // Clasificación del punto de medida
  tipoElemento: {
    type: String,
    required: [true, 'Tipo de elemento obligatorio'],
    enum: {
      values: ['URB', 'M-30'],
      message: 'Tipo de elemento debe ser URB (urbano) o M-30 (interurbano)'
    },
    index: true
  },

  // Métricas de tráfico
  metricas: {
    // Intensidad del tráfico (vehículos/hora)
    intensidad: {
      type: Number,
      required: [true, 'Intensidad obligatoria'],
      validate: {
        validator: function(v) {
          // Valor negativo indica ausencia de datos
          return v >= -1 && v <= 10000;
        },
        message: 'Intensidad debe estar entre -1 y 10000 veh/h'
      },
      index: true
    },

    // Porcentaje de ocupación de la vía
    ocupacion: {
      type: Number,
      required: [true, 'Ocupación obligatoria'],
      validate: {
        validator: function(v) {
          // Valor negativo indica ausencia de datos
          return v >= -1 && v <= 100;
        },
        message: 'Ocupación debe estar entre -1 y 100%'
      }
    },

    // Carga de la vía (0-100)
    carga: {
      type: Number,
      required: [true, 'Carga obligatoria'],
      validate: {
        validator: function(v) {
          // Valor negativo indica ausencia de datos
          return v >= -1 && v <= 100;
        },
        message: 'Carga debe estar entre -1 y 100'
      }
    },

    // Velocidad media (solo para M-30)
    velocidadMedia: {
      type: Number,
      required: function() {
        return this.tipoElemento === 'M-30';
      },
      validate: {
        validator: function(v) {
          if (this.tipoElemento === 'URB' && (v === null || v === undefined)) {
            return true; // Para urbanos, la velocidad puede ser nula
          }
          // Valor negativo indica ausencia de datos
          return v >= -1 && v <= 200;
        },
        message: 'Velocidad media debe estar entre -1 y 200 km/h'
      }
    }
  },

  // Control de calidad
  calidadDatos: {
    // Indicador de error
    error: {
      type: String,
      required: [true, 'Indicador de error obligatorio'],
      enum: {
        values: ['N', 'E', 'S'],
        message: 'Error debe ser N (sin errores), E (errores de calidad) o S (muestras erróneas)'
      },
      default: 'N'
    },

    // Número de muestras integradas
    periodoIntegracion: {
      type: Number,
      required: [true, 'Período de integración obligatorio'],
      min: [0, 'Período de integración no puede ser negativo'],
      max: [20, 'Período de integración no puede exceder 20 muestras'],
      validate: {
        validator: function(v) {
          return Number.isInteger(v);
        },
        message: 'Período de integración debe ser un número entero'
      }
    },

    // Calidad general de la medición
    calidadGeneral: {
      type: String,
      enum: ['ALTA', 'MEDIA', 'BAJA', 'SIN_DATOS'],
      default: function() {
        // Verificar que calidadDatos existe antes de acceder a sus propiedades
        if (!this.calidadDatos) {return 'SIN_DATOS';}

        if (this.calidadDatos.error === 'N' && this.calidadDatos.periodoIntegracion >= 4) {
          return 'ALTA';
        } if (this.calidadDatos.error === 'E' && this.calidadDatos.periodoIntegracion >= 2) {
          return 'MEDIA';
        } if (this.calidadDatos.error === 'S' || this.calidadDatos.periodoIntegracion < 2) {
          return 'BAJA';
        }
          return 'SIN_DATOS';

      }
    }
  },

  // Análisis automático de condiciones de tráfico
  analisis: {
    // Nivel de congestión basado en ocupación y carga
    nivelCongestion: {
      type: String,
      enum: ['FLUIDO', 'DENSO', 'CONGESTIONADO', 'COLAPSADO', 'SIN_DATOS'],
      default: function() {
        // Verificar que metricas existe antes de acceder
        if (!this.metricas) {return 'SIN_DATOS';}

        if (this.metricas.ocupacion < 0 || this.metricas.carga < 0) {
          return 'SIN_DATOS';
        }

        const ocupacion = this.metricas.ocupacion;
        const carga = this.metricas.carga;

        if (ocupacion < 10 && carga < 25) {
          return 'FLUIDO';
        } if (ocupacion < 30 && carga < 50) {
          return 'DENSO';
        } if (ocupacion < 60 && carga < 80) {
          return 'CONGESTIONADO';
        }
          return 'COLAPSADO';

      },
      index: true
    },

    // Clasificación por intensidad
    clasificacionIntensidad: {
      type: String,
      enum: ['MUY_BAJA', 'BAJA', 'MEDIA', 'ALTA', 'MUY_ALTA', 'SIN_DATOS'],
      default: function() {
        // Verificar que metricas existe antes de acceder
        if (!this.metricas) {return 'SIN_DATOS';}

        if (this.metricas.intensidad < 0) {
          return 'SIN_DATOS';
        }

        const intensidad = this.metricas.intensidad;

        if (intensidad < 200) {
          return 'MUY_BAJA';
        } if (intensidad < 500) {
          return 'BAJA';
        } if (intensidad < 1000) {
          return 'MEDIA';
        } if (intensidad < 2000) {
          return 'ALTA';
        }
          return 'MUY_ALTA';

      },
      index: true
    },

    // Periodo del día
    periodoDia: {
      type: String,
      enum: ['MADRUGADA', 'MAÑANA', 'MEDIODIA', 'TARDE', 'NOCHE'],
      default: function() {
        // Usar hora directamente si está disponible, sino derivar de fecha
        const hora = this.hora || (this.fecha ? this.fecha.getHours() : 0);

        if (hora >= 0 && hora < 6) {
          return 'MADRUGADA';
        } if (hora >= 6 && hora < 12) {
          return 'MAÑANA';
        } if (hora >= 12 && hora < 15) {
          return 'MEDIODIA';
        } if (hora >= 15 && hora < 21) {
          return 'TARDE';
        }
          return 'NOCHE';

      },
      index: true
    },

    // Día laborable o festivo (se puede mejorar con calendario festivos)
    tipoJornada: {
      type: String,
      enum: ['LABORABLE', 'SABADO', 'DOMINGO_FESTIVO'],
      default: function() {
        // Verificar que fecha existe antes de acceder
        if (!this.fecha) {return 'LABORABLE';}

        const dayOfWeek = new Date(this.fecha).getDay();
        if (dayOfWeek === 0) {
          return 'DOMINGO_FESTIVO';
        } if (dayOfWeek === 6) {
          return 'SABADO';
        }
          return 'LABORABLE';

      },
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

// Índice principal para evitar duplicados
trafficSchema.index(
  { puntoMedidaId: 1, fecha: 1 },
  { unique: true, name: 'traffic_unique_measurement' }
);

// Índices para consultas temporales
trafficSchema.index({ fecha: -1, puntoMedidaId: 1 });
trafficSchema.index({ año: 1, mes: 1, dia: 1, hora: 1 });
trafficSchema.index({ tipoElemento: 1, fecha: -1 });

// Índices para métricas de tráfico
trafficSchema.index({ 'metricas.intensidad': -1, fecha: -1 });
trafficSchema.index({ 'analisis.nivelCongestion': 1, fecha: -1 });
trafficSchema.index({ 'analisis.periodoDia': 1, tipoElemento: 1 });

// Índices compuestos para análisis avanzados
trafficSchema.index({
  tipoElemento: 1,
  'analisis.periodoDia': 1,
  'analisis.tipoJornada': 1,
  fecha: -1
});

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
 * Métodos de instancia
 */

/**
 * Calcular nivel de congestión basado en ocupación y carga
 */
trafficSchema.methods.calcularNivelCongestion = function() {
  if (!this.metricas || this.metricas.ocupacion < 0 || this.metricas.carga < 0) {
    this.analisis.nivelCongestion = 'SIN_DATOS';
    return;
  }

  const ocupacion = this.metricas.ocupacion;
  const carga = this.metricas.carga;

  if (ocupacion < 10 && carga < 25) {
    this.analisis.nivelCongestion = 'FLUIDO';
  } else if (ocupacion < 30 && carga < 50) {
    this.analisis.nivelCongestion = 'DENSO';
  } else if (ocupacion < 60 && carga < 80) {
    this.analisis.nivelCongestion = 'CONGESTIONADO';
  } else {
    this.analisis.nivelCongestion = 'COLAPSADO';
  }
};

/**
 * Calcular clasificación por intensidad
 */
trafficSchema.methods.calcularClasificacionIntensidad = function() {
  if (!this.metricas || this.metricas.intensidad < 0) {
    this.analisis.clasificacionIntensidad = 'SIN_DATOS';
    return;
  }

  const intensidad = this.metricas.intensidad;

  if (intensidad < 200) {
    this.analisis.clasificacionIntensidad = 'MUY_BAJA';
  } else if (intensidad < 500) {
    this.analisis.clasificacionIntensidad = 'BAJA';
  } else if (intensidad < 1000) {
    this.analisis.clasificacionIntensidad = 'MEDIA';
  } else if (intensidad < 2000) {
    this.analisis.clasificacionIntensidad = 'ALTA';
  } else {
    this.analisis.clasificacionIntensidad = 'MUY_ALTA';
  }
};

/**
 * Calcular calidad general de la medición
 */
trafficSchema.methods.calcularCalidadGeneral = function() {
  if (!this.calidadDatos) {
    this.calidadDatos.calidadGeneral = 'SIN_DATOS';
    return;
  }

  if (this.calidadDatos.error === 'N' && this.calidadDatos.periodoIntegracion >= 4) {
    this.calidadDatos.calidadGeneral = 'ALTA';
  } else if (this.calidadDatos.error === 'E' && this.calidadDatos.periodoIntegracion >= 2) {
    this.calidadDatos.calidadGeneral = 'MEDIA';
  } else if (this.calidadDatos.error === 'S' || this.calidadDatos.periodoIntegracion < 2) {
    this.calidadDatos.calidadGeneral = 'BAJA';
  } else {
    this.calidadDatos.calidadGeneral = 'SIN_DATOS';
  }
};

/**
 * Verificar si la medición es confiable
 */
trafficSchema.methods.esConfiable = function() {
  return this.calidadDatos.calidadGeneral === 'ALTA' ||
         this.calidadDatos.calidadGeneral === 'MEDIA';
};

/**
 * Métodos estáticos para consultas agregadas
 */

/**
 * Obtener estadísticas de tráfico por periodo
 */
trafficSchema.statics.getStatisticsByPeriod = function(startDate, endDate, tipoElemento = null) {
  const matchConditions = {
    fecha: { $gte: startDate, $lte: endDate }
  };

  if (tipoElemento) {
    matchConditions.tipoElemento = tipoElemento;
  }

  return this.aggregate([
    { $match: matchConditions },
    {
      $group: {
        _id: null,
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
        cargaPromedio: {
          $avg: {
            $cond: [{ $gte: ['$metricas.carga', 0] }, '$metricas.carga', null]
          }
        },
        velocidadPromedio: {
          $avg: {
            $cond: [{ $gte: ['$metricas.velocidadMedia', 0] }, '$metricas.velocidadMedia', null]
          }
        },
        medicionesConfiables: {
          $sum: {
            $cond: [{ $in: ['$calidadDatos.calidadGeneral', ['ALTA', 'MEDIA']] }, 1, 0]
          }
        }
      }
    }
  ]);
};

/**
 * Obtener puntos más congestionados
 */
trafficSchema.statics.getTopCongestedPoints = function(limit = 10, startDate = null, endDate = null) {
  const matchConditions = {};

  if (startDate && endDate) {
    matchConditions.fecha = { $gte: startDate, $lte: endDate };
  }

  return this.aggregate([
    { $match: matchConditions },
    {
      $group: {
        _id: '$puntoMedidaId',
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
        totalMediciones: { $sum: 1 },
        medicionesCongestionadas: {
          $sum: {
            $cond: [{ $in: ['$analisis.nivelCongestion', ['CONGESTIONADO', 'COLAPSADO']] }, 1, 0]
          }
        },
        tipoElemento: { $first: '$tipoElemento' }
      }
    },
    {
      $addFields: {
        porcentajeCongestion: {
          $multiply: [
            { $divide: ['$medicionesCongestionadas', '$totalMediciones'] },
            100
          ]
        }
      }
    },
    { $sort: { porcentajeCongestion: -1, ocupacionPromedio: -1 } },
    { $limit: limit }
  ]);
};

/**
 * Obtener patrones de tráfico por hora del día
 */
trafficSchema.statics.getTrafficPatternsByHour = function(tipoElemento = null, startDate = null, endDate = null) {
  const matchConditions = {};

  if (tipoElemento) {
    matchConditions.tipoElemento = tipoElemento;
  }

  if (startDate && endDate) {
    matchConditions.fecha = { $gte: startDate, $lte: endDate };
  }

  return this.aggregate([
    { $match: matchConditions },
    {
      $group: {
        _id: '$hora',
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
        totalMediciones: { $sum: 1 }
      }
    },
    { $sort: { _id: 1 } }
  ]);
};

/**
 * Obtener análisis de calidad de datos
 */
trafficSchema.statics.getDataQualityAnalysis = function(startDate = null, endDate = null) {
  const matchConditions = {};

  if (startDate && endDate) {
    matchConditions.fecha = { $gte: startDate, $lte: endDate };
  }

  return this.aggregate([
    { $match: matchConditions },
    {
      $group: {
        _id: '$calidadDatos.calidadGeneral',
        cantidad: { $sum: 1 },
        puntosMedida: { $addToSet: '$puntoMedidaId' }
      }
    },
    {
      $addFields: {
        cantidadPuntos: { $size: '$puntosMedida' }
      }
    },
    { $sort: { _id: 1 } }
  ]);
};

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

  return this.aggregate(pipeline);
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

  return this.aggregate(pipeline);
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
    ]),

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
    ])
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
