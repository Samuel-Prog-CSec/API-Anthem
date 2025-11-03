/**
 * Modelo de Multas
 *
 * Esquema de Mongoose para almacenar y gestionar datos de multas de tráfico
 * provenientes del sistema municipal. Incluye información sobre infracciones,
 * ubicación, importes y datos del vehículo infractor.
 */

const mongoose = require('mongoose');

/**
 * Sub-esquema para coordenadas UTM (Universal Transverse Mercator)
 * Sistema de coordenadas utilizado en España para datos geográficos oficiales
 */
const coordinatesSchema = new mongoose.Schema({
  x: {
    type: Number,
    required: false
  },
  y: {
    type: Number,
    required: false
  }
}, { _id: false });

/**
 * Esquema principal de Multas
 *
 * Basado en la estructura de los CSV de multas:
 * - CALIFICACION: tipo de infracción (LEVE, GRAVE, MUY GRAVE)
 * - LUGAR: ubicación donde se cometió la infracción
 * - MES/ANIO: fecha de la denuncia
 * - HORA: momento de la infracción
 * - IMP_BOL: importe del boletín
 * - DESCUENTO: si aplica descuento por pronto pago
 * - PUNTOS: puntos del carnet detraídos
 * - DENUNCIANTE: quien realizó la denuncia
 * - HECHO-BOL: descripción de la infracción
 * - VEL_LIMITE/VEL_CIRCULA: para infracciones de velocidad
 * - COORDENADAS: ubicación exacta
 */
const fineSchema = new mongoose.Schema({
  // Información temporal
  fecha: {
    type: Date,
    required: true,
    index: true
  },

  mes: {
    type: Number,
    required: true,
    index: true
  },

  año: {
    type: Number,
    required: true,
    index: true
  },

  hora: {
    type: String,
    required: true,
    trim: true,
    index: true
  },

  // Clasificación de la infracción
  calificacion: {
    type: String,
    required: true,
    enum: ['LEVE', 'GRAVE', 'MUY GRAVE'],
    uppercase: true,
    index: true
  },

  // Ubicación
  lugar: {
    type: String,
    required: true,
    trim: true,
    index: true
  },

  coordenadas: {
    type: coordinatesSchema,
    required: false
  },

  // Información económica
  importeBoletín: {
    type: Number,
    required: true,
    index: true
  },

  tieneDescuento: {
    type: Boolean,
    required: true,
    default: false,
    index: true
  },

  importeFinal: {
    type: Number,
    required: false
  },

  // Penalizaciones
  puntosDetraídos: {
    type: Number,
    required: true,
    index: true
  },

  // Información de la denuncia
  denunciante: {
    type: String,
    required: true,
    trim: true,
    index: true
  },

  descripcionInfraccion: {
    type: String,
    required: true,
    trim: true
  },

  // Datos específicos de infracciones de velocidad
  datosVelocidad: {
    velocidadLimite: {
      type: Number,
      required: false
    },
    velocidadCirculacion: {
      type: Number,
      required: false
    },
    exceso: {
      type: Number,
      required: false
    }
  },

  // Metadatos y clasificación automática
  metadatos: {
    tipoInfraccion: {
      type: String,
      enum: [
        'VELOCIDAD',
        'ESTACIONAMIENTO',
        'TELEFONO_MOVIL',
        'SEMAFORO',
        'ALCOHOL_DROGAS',
        'DOCUMENTACION',
        'OTRAS'
      ],
      default: 'OTRAS'
    },
    esInfraccionGrave: {
      type: Boolean,
      default: function() {
        return this.calificacion === 'GRAVE' || this.calificacion === 'MUY GRAVE';
      }
    },
    esInfraccionVelocidad: {
      type: Boolean,
      default: function() {
        return this.datosVelocidad.velocidadLimite !== null;
      }
    },
    zonaUrbana: {
      type: Boolean,
      default: true // Asumimos zona urbana por defecto
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
// Índice compuesto para evitar duplicados y optimizar búsquedas
fineSchema.index(
  { lugar: 1, fecha: 1, hora: 1, importeBoletín: 1 },
  { unique: false, name: 'fine_identification' }
);

// Índices para consultas frecuentes
fineSchema.index({ fecha: -1, calificacion: 1 });
fineSchema.index({ año: 1, mes: 1, calificacion: 1 });
fineSchema.index({ lugar: 1, fecha: -1 });
fineSchema.index({ denunciante: 1, fecha: -1 });
fineSchema.index({ importeBoletín: -1, fecha: -1 });
fineSchema.index({ puntosDetraídos: -1, fecha: -1 });

// Índices geográficos
fineSchema.index({ 'coordenadas.x': 1, 'coordenadas.y': 1 });

// Índices para filtros del frontend
fineSchema.index({ 'metadatos.tipoInfraccion': 1, fecha: -1 });
fineSchema.index({ 'metadatos.esInfraccionGrave': 1, fecha: -1 });
fineSchema.index({ tieneDescuento: 1, fecha: -1 });

// NUEVO: Índice compuesto para estadísticas y análisis de ubicaciones
fineSchema.index(
  {
    fecha: -1,
    lugar: 1,
    calificacion: 1
  },
  {
    name: 'idx_fines_statistics',
    background: true
  }
);

// NUEVO: Índice compuesto para análisis temporal
fineSchema.index(
  {
    año: 1,
    mes: 1,
    lugar: 1
  },
  {
    name: 'idx_fines_temporal',
    background: true
  }
);

// Índice de texto para búsqueda
fineSchema.index({
  lugar: 'text',
  descripcionInfraccion: 'text',
  denunciante: 'text'
});

/**
 * Middleware pre-save para procesamiento automático
 */
fineSchema.pre('save', function(next) {
  // Crear fecha completa a partir de mes y año
  if (!this.fecha && this.mes && this.año) {
    this.fecha = new Date(this.año, this.mes - 1, 1);
  }

  // Calcular importe final con descuento
  if (this.tieneDescuento && this.importeBoletín) {
    this.importeFinal = this.importeBoletín * 0.5; // 50% de descuento
  } else {
    this.importeFinal = this.importeBoletín;
  }

  // Calcular exceso de velocidad si aplica
  if (this.datosVelocidad.velocidadLimite && this.datosVelocidad.velocidadCirculacion) {
    this.datosVelocidad.exceso = Math.max(0,
      this.datosVelocidad.velocidadCirculacion - this.datosVelocidad.velocidadLimite
    );
  }

  // Clasificar tipo de infracción automáticamente
  this.clasificarTipoInfraccion();

  // Validar datos de velocidad
  if (this.datosVelocidad.velocidadLimite && this.datosVelocidad.velocidadCirculacion) {
    this.metadatos.esInfraccionVelocidad = true;
    this.metadatos.tipoInfraccion = 'VELOCIDAD';
  }

  next();
});

/**
 * Método para clasificar automáticamente el tipo de infracción
 */
fineSchema.methods.clasificarTipoInfraccion = function() {
  const descripcion = this.descripcionInfraccion.toLowerCase();

  if (descripcion.includes('velocidad') || descripcion.includes('radar')) {
    this.metadatos.tipoInfraccion = 'VELOCIDAD';
  } else if (descripcion.includes('estacionar') || descripcion.includes('aparcar')) {
    this.metadatos.tipoInfraccion = 'ESTACIONAMIENTO';
  } else if (descripcion.includes('teléfon') || descripcion.includes('móvil')) {
    this.metadatos.tipoInfraccion = 'TELEFONO_MOVIL';
  } else if (descripcion.includes('semáforo') || descripcion.includes('rojo')) {
    this.metadatos.tipoInfraccion = 'SEMAFORO';
  } else if (descripcion.includes('alcohol') || descripcion.includes('droga')) {
    this.metadatos.tipoInfraccion = 'ALCOHOL_DROGAS';
  } else if (descripcion.includes('documento') || descripcion.includes('permiso')) {
    this.metadatos.tipoInfraccion = 'DOCUMENTACION';
  } else {
    this.metadatos.tipoInfraccion = 'OTRAS';
  }
};

/**
 * Método para calcular el impacto económico total
 * @returns {Object} Desglose del impacto económico
 */
fineSchema.methods.calcularImpactoEconomico = function() {
  return {
    importeOriginal: this.importeBoletín,
    importeFinal: this.importeFinal,
    descuentoAplicado: this.tieneDescuento ? this.importeBoletín - this.importeFinal : 0,
    porcentajeDescuento: this.tieneDescuento ? 50 : 0
  };
};

/**
 * Método para verificar si es infracción grave
 * @returns {Boolean}
 */
fineSchema.methods.esGrave = function() {
  return this.calificacion === 'GRAVE' || this.calificacion === 'MUY GRAVE';
};

/**
 * Métodos estáticos para consultas agregadas
 */

/**
 * Obtener estadísticas por periodo
 */
fineSchema.statics.getStatisticsByPeriod = function(startDate, endDate) {
  return this.aggregate([
    {
      $match: {
        fecha: { $gte: startDate, $lte: endDate }
      }
    },
    {
      $group: {
        _id: null,
        totalMultas: { $sum: 1 },
        importeTotal: { $sum: '$importeFinal' },
        puntosDetraidos: { $sum: '$puntosDetraídos' },
        multasGraves: {
          $sum: {
            $cond: [{ $in: ['$calificacion', ['GRAVE', 'MUY GRAVE']] }, 1, 0]
          }
        },
        multasConDescuento: { $sum: { $cond: ['$tieneDescuento', 1, 0] } }
      }
    }
  ]);
};

/**
 * Obtener ranking de infracciones más comunes
 */
fineSchema.statics.getTopInfractions = function(limit = 10) {
  return this.aggregate([
    {
      $group: {
        _id: '$metadatos.tipoInfraccion',
        cantidad: { $sum: 1 },
        importePromedio: { $avg: '$importeFinal' },
        puntosPromedio: { $avg: '$puntosDetraídos' }
      }
    },
    {
      $sort: { cantidad: -1 }
    },
    {
      $limit: limit
    }
  ]);
};

/**
 * Obtener estadísticas por ubicación
 */
fineSchema.statics.getLocationStatistics = function() {
  return this.aggregate([
    {
      $group: {
        _id: '$lugar',
        totalMultas: { $sum: 1 },
        importeTotal: { $sum: '$importeFinal' },
        tiposInfraccion: { $addToSet: '$metadatos.tipoInfraccion' }
      }
    },
    {
      $sort: { totalMultas: -1 }
    },
    {
      $limit: 50 // Top 50 ubicaciones
    }
  ]);
};

/**
 * Obtener estadísticas optimizadas de multas
 * @param {Object} options - Opciones de filtrado
 * @param {Date} options.startDate - Fecha de inicio (opcional)
 * @param {Date} options.endDate - Fecha de fin (opcional)
 * @param {string} options.groupBy - Tipo de agrupación: 'day', 'month', 'year', 'type', 'location', 'severity'
 * @param {number} options.limit - Límite de resultados
 * @returns {Promise<Object>} Estadísticas agrupadas y resumen general
 */
fineSchema.statics.getStatisticsOptimized = async function(options) {
  const {
    startDate = null,
    endDate = null,
    groupBy = 'month',
    limit = 12
  } = options;

  // Construir filtros base
  const matchStage = {};
  if (startDate || endDate) {
    matchStage.fecha = {};
    if (startDate) {matchStage.fecha.$gte = new Date(startDate);}
    if (endDate) {matchStage.fecha.$lte = new Date(endDate);}
  }

  // Configurar agrupación según parámetro
  let groupByConfig = {};
  let sortStage = {};

  switch (groupBy) {
    case 'day':
      groupByConfig = {
        fecha: {
          $dateFromParts: {
            year: { $year: '$fecha' },
            month: { $month: '$fecha' },
            day: { $dayOfMonth: '$fecha' }
          }
        }
      };
      sortStage = { '_id.fecha': -1 };
      break;

    case 'year':
      groupByConfig = { año: '$año' };
      sortStage = { '_id.año': -1 };
      break;

    case 'type':
      groupByConfig = { tipoInfraccion: '$metadatos.tipoInfraccion' };
      sortStage = { totalMultas: -1 };
      break;

    case 'location':
      groupByConfig = { lugar: '$lugar' };
      sortStage = { totalMultas: -1 };
      break;

    case 'severity':
      groupByConfig = { calificacion: '$calificacion' };
      sortStage = { totalMultas: -1 };
      break;

    case 'month':
    default:
      groupByConfig = {
        año: '$año',
        mes: '$mes'
      };
      sortStage = { '_id.año': -1, '_id.mes': -1 };
      break;
  }

  // Ejecutar agregaciones en paralelo usando Promise.all
  const [estadisticas, resumenGeneral] = await Promise.all([
    // Agregación 1: Estadísticas agrupadas
    this.aggregate([
      { $match: matchStage },
      {
        $group: {
          _id: groupByConfig,
          totalMultas: { $sum: 1 },
          importeTotal: { $sum: '$importeFinal' },
          importePromedio: { $avg: '$importeFinal' },
          puntosTotal: { $sum: '$puntosDetraídos' },
          multasGraves: {
            $sum: { $cond: ['$metadatos.esInfraccionGrave', 1, 0] }
          },
          multasConDescuento: {
            $sum: { $cond: ['$tieneDescuento', 1, 0] }
          },
          multasVelocidad: {
            $sum: { $cond: ['$metadatos.esInfraccionVelocidad', 1, 0] }
          }
        }
      },
      {
        $addFields: {
          porcentajeGraves: {
            $multiply: [
              { $divide: ['$multasGraves', '$totalMultas'] },
              100
            ]
          },
          porcentajeConDescuento: {
            $multiply: [
              { $divide: ['$multasConDescuento', '$totalMultas'] },
              100
            ]
          }
        }
      },
      { $sort: sortStage },
      { $limit: parseInt(limit) }
    ]),

    // Agregación 2: Resumen general
    this.aggregate([
      { $match: matchStage },
      {
        $group: {
          _id: null,
          totalMultas: { $sum: 1 },
          importeTotal: { $sum: '$importeFinal' },
          puntosTotal: { $sum: '$puntosDetraídos' },
          fechaInicio: { $min: '$fecha' },
          fechaFin: { $max: '$fecha' },
          lugaresUnicos: { $addToSet: '$lugar' },
          tiposInfraccionUnicos: { $addToSet: '$metadatos.denunciante' }
        }
      }
    ])
  ]);

  return {
    estadisticas,
    resumen: resumenGeneral[0] ? {
      ...resumenGeneral[0],
      totalLugaresUnicos: resumenGeneral[0].lugaresUnicos.length,
      totalDenunciantesUnicos: resumenGeneral[0].tiposInfraccionUnicos.length
    } : null
  };
};

/**
 * Obtener ranking optimizado de ubicaciones con más multas
 * @param {Object} options - Opciones de filtrado
 * @param {Date} options.startDate - Fecha de inicio (opcional)
 * @param {Date} options.endDate - Fecha de fin (opcional)
 * @param {string} options.tipoInfraccion - Tipo de infracción a filtrar (opcional)
 * @param {number} options.limit - Límite de resultados
 * @returns {Promise<Array>} Ranking de ubicaciones
 */
fineSchema.statics.getLocationRankingOptimized = async function(options) {
  const {
    startDate = null,
    endDate = null,
    tipoInfraccion = null,
    limit = 20
  } = options;

  const matchFilters = {};

  if (startDate || endDate) {
    matchFilters.fecha = {};
    if (startDate) {matchFilters.fecha.$gte = new Date(startDate);}
    if (endDate) {matchFilters.fecha.$lte = new Date(endDate);}
  }

  if (tipoInfraccion) {
    matchFilters['metadatos.tipoInfraccion'] = tipoInfraccion;
  }

  const ranking = await this.aggregate([
    { $match: matchFilters },
    {
      $group: {
        _id: '$lugar',
        totalMultas: { $sum: 1 },
        importeTotal: { $sum: '$importeFinal' },
        importePromedio: { $avg: '$importeFinal' },
        puntosTotal: { $sum: '$puntosDetraídos' },
        tiposInfraccion: { $addToSet: '$metadatos.tipoInfraccion' },
        calificacionesMasComunes: { $addToSet: '$calificacion' },
        coordenadas: { $first: '$coordenadas' }
      }
    },
    {
      $addFields: {
        diversidadInfracciones: { $size: '$tiposInfraccion' },
        importePromedioPorMulta: {
          $round: ['$importePromedio', 2]
        }
      }
    },
    { $sort: { totalMultas: -1 } },
    { $limit: parseInt(limit) }
  ]);

  return ranking;
};

/**
 * Obtener análisis temporal optimizado de multas
 * @param {Object} options - Opciones de filtrado
 * @param {Date} options.startDate - Fecha de inicio (opcional)
 * @param {Date} options.endDate - Fecha de fin (opcional)
 * @param {string} options.tipoAnalisis - Tipo de análisis: 'hourly', 'daily', 'monthly', 'yearly'
 * @returns {Promise<Object>} Análisis temporal y tendencias
 */
fineSchema.statics.getTemporalAnalysisOptimized = async function(options) {
  const {
    startDate = null,
    endDate = null,
    tipoAnalisis = 'monthly'
  } = options;

  const matchFilters = {};

  if (startDate || endDate) {
    matchFilters.fecha = {};
    if (startDate) {matchFilters.fecha.$gte = new Date(startDate);}
    if (endDate) {matchFilters.fecha.$lte = new Date(endDate);}
  }

  let groupByConfig = {};
  let projectConfig = {};
  let sortField = { totalMultas: -1 };

  switch (tipoAnalisis) {
    case 'hourly':
      groupByConfig = {
        hora: {
          $substr: ['$hora', 0, 2]
        }
      };
      projectConfig = { hora: '$_id.hora' };
      sortField = { hora: 1 };
      break;

    case 'daily':
      groupByConfig = {
        diaSemana: { $dayOfWeek: '$fecha' },
        fecha: {
          $dateFromParts: {
            year: { $year: '$fecha' },
            month: { $month: '$fecha' },
            day: { $dayOfMonth: '$fecha' }
          }
        }
      };
      projectConfig = {
        diaSemana: '$_id.diaSemana',
        fecha: '$_id.fecha'
      };
      break;

    case 'yearly':
      groupByConfig = { año: '$año' };
      projectConfig = { año: '$_id.año' };
      break;

    case 'monthly':
    default:
      groupByConfig = {
        año: '$año',
        mes: '$mes'
      };
      projectConfig = {
        año: '$_id.año',
        mes: '$_id.mes'
      };
      break;
  }

  const analisis = await this.aggregate([
    { $match: matchFilters },
    {
      $group: {
        _id: groupByConfig,
        totalMultas: { $sum: 1 },
        importeTotal: { $sum: '$importeFinal' },
        importePromedio: { $avg: '$importeFinal' },
        multasGraves: {
          $sum: { $cond: ['$metadatos.esInfraccionGrave', 1, 0] }
        },
        tiposInfraccionMasComunes: { $addToSet: '$metadatos.tipoInfraccion' }
      }
    },
    {
      $project: {
        ...projectConfig,
        totalMultas: 1,
        importeTotal: { $round: ['$importeTotal', 2] },
        importePromedio: { $round: ['$importePromedio', 2] },
        multasGraves: 1,
        porcentajeGraves: {
          $round: [
            { $multiply: [{ $divide: ['$multasGraves', '$totalMultas'] }, 100] },
            2
          ]
        },
        diversidadTipos: { $size: '$tiposInfraccionMasComunes' }
      }
    },
    { $sort: sortField }
  ]);

  // Calcular tendencias si hay suficientes datos
  let tendencia = null;
  if (analisis.length > 1) {
    const valores = analisis.map(item => item.totalMultas);
    const primerValor = valores[0];
    const ultimoValor = valores[valores.length - 1];

    tendencia = {
      direccion: ultimoValor > primerValor ? 'CRECIENTE' : 'DECRECIENTE',
      variacionAbsoluta: ultimoValor - primerValor,
      variacionPorcentual: primerValor > 0 ?
        ((ultimoValor - primerValor) / primerValor * 100).toFixed(2) : 0
    };
  }

  return {
    analisis,
    tendencia
  };
};

// Crear y exportar el modelo
const Fine = mongoose.model('Fines', fineSchema);

module.exports = Fine;
