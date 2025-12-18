/**
 * Modelo de Multas
 *
 * Esquema de Mongoose para almacenar y gestionar datos de multas de tráfico
 * provenientes del sistema municipal. Incluye información sobre infracciones,
 * ubicación, importes y datos del vehículo infractor.
 */

const mongoose = require('mongoose');
const {
  coordinatesUTMSchema,
  validateTimeFormat,
  validateDatasetDate,
  validateAmount,
  validateSpeed,
  validateLicensePoints,
  validateMonth,
  validateYear
} = require('./schemas/commonSchemas');
const {
  SEVERITY_LEVELS,
  INFRACTION_TYPES,
  FINE_CONFIG,
  VALIDATION_LIMITS,
  MONGODB_TIMEOUTS,
  DATASET_YEARS
} = require('../constants');

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
    index: true,
    validate: {
      validator: validateDatasetDate,
      message: `La fecha de la multa debe estar dentro del rango del dataset (${DATASET_YEARS.MIN_YEAR}-${DATASET_YEARS.MAX_YEAR})`
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

  año: {
    type: Number,
    required: true,
    index: true,
    validate: {
      validator: validateYear,
      message: `Año debe estar entre ${VALIDATION_LIMITS.YEAR_MIN} y ${VALIDATION_LIMITS.YEAR_MAX}`
    }
  },

  hora: {
    type: String,
    required: true,
    trim: true,
    index: true,
    validate: {
      validator: validateTimeFormat,
      message: 'Hora debe tener formato válido HH:MM o HH.MM'
    }
  },

  // Clasificación de la infracción
  calificacion: {
    type: String,
    required: true,
    trim: true,
    enum: Object.values(SEVERITY_LEVELS.FINE),
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
    type: coordinatesUTMSchema,
    required: false
  },

  // Información económica
  importeBoletín: {
    type: Number,
    required: true,
    index: true,
    min: [VALIDATION_LIMITS.QUANTITY_MIN, 'Importe del boletín no puede ser negativo'],
    validate: {
      validator: validateAmount,
      message: 'Importe del boletín debe ser válido (máximo 2 decimales, no negativo)'
    }
  },

  tieneDescuento: {
    type: Boolean,
    required: true,
    default: false,
    index: true
  },

  importeFinal: {
    type: Number,
    required: false,
    min: [VALIDATION_LIMITS.QUANTITY_MIN, 'Importe final no puede ser negativo'],
    validate: [
      {
        validator: validateAmount,
        message: 'Importe final debe ser válido (máximo 2 decimales, no negativo)'
      },
      {
        validator: function(v) {
          // Validar coherencia: importeFinal no puede ser mayor que importeBoletín
          if (v === null || v === undefined) {return true;}
          return v <= this.importeBoletín;
        },
        message: 'Importe final no puede ser mayor que el importe del boletín'
      }
    ]
  },

  // Penalizaciones
  puntosDetraídos: {
    type: Number,
    required: true,
    index: true,
    validate: {
      validator: validateLicensePoints,
      message: `Puntos detraídos deben estar entre ${VALIDATION_LIMITS.DRIVER_POINTS_MIN} y ${VALIDATION_LIMITS.DRIVER_POINTS_MAX}`
    }
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
      required: false,
      min: [VALIDATION_LIMITS.SPEED_MIN, 'Velocidad límite no puede ser negativa'],
      validate: {
        validator: validateSpeed,
          message: `Velocidad límite debe estar entre ${VALIDATION_LIMITS.SPEED_MIN} y ${VALIDATION_LIMITS.SPEED_MAX} km/h`
      }
    },
    velocidadCirculacion: {
      type: Number,
      required: false,
      min: [VALIDATION_LIMITS.SPEED_MIN, 'Velocidad de circulación no puede ser negativa'],
      validate: {
        validator: validateSpeed,
          message: `Velocidad de circulación debe estar entre ${VALIDATION_LIMITS.SPEED_MIN} y ${VALIDATION_LIMITS.SPEED_MAX} km/h`
      }
    },
    exceso: {
      type: Number,
      required: false,
      min: [VALIDATION_LIMITS.SPEED_MIN, 'Exceso de velocidad no puede ser negativo'],
      validate: {
        validator: function(v) {
          // Validar coherencia con velocidades
          if (v === null || v === undefined) {return true;}
          if (!this.datosVelocidad.velocidadLimite || !this.datosVelocidad.velocidadCirculacion) {
            return true;
          }
          const excesoCalculado = this.datosVelocidad.velocidadCirculacion - this.datosVelocidad.velocidadLimite;
          return Math.abs(v - excesoCalculado) < 1; // Tolerancia de 1 km/h por redondeos
        },
        message: 'Exceso de velocidad debe ser coherente con velocidadCirculacion - velocidadLimite'
      }
    }
  },

  // Metadatos y clasificación automática
  metadatos: {
    tipoInfraccion: {
      type: String,
      enum: Object.values(INFRACTION_TYPES),
      default: INFRACTION_TYPES.OTRAS
    },
    esInfraccionGrave: {
      type: Boolean,
      default: function() {
        return this.calificacion === SEVERITY_LEVELS.FINE.GRAVE ||
               this.calificacion === SEVERITY_LEVELS.FINE.MUY_GRAVE;
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
  versionKey: false,
  collection: 'fines',
  toJSON: {
    transform: (_doc, ret) => {
      delete ret.createdAt;
      delete ret.updatedAt;
      return ret;
    }
  }
});

/**
 * Índices para optimización de consultas
 */

// ========================================
// ÍNDICE COMPUESTO - Identificación de multas
// ========================================
// Índice para búsquedas específicas por combinación de campos
// Usado en: Búsquedas detalladas de multas en ubicación + fecha/hora + importe
// NO es único porque pueden haber múltiples multas en mismo lugar/fecha/hora
fineSchema.index(
  { lugar: 1, fecha: 1, hora: 1, importeBoletín: 1 },
  { unique: false, name: 'fine_identification' }
);

// ========================================
// ÍNDICES PRINCIPALES - Consultas frecuentes
// ========================================

// Índice compuesto: fecha (desc) + calificacion
// Usado en: GET /api/fines?calificacion=LEVE&startDate=X&endDate=Y
// Sort por fecha descendente (multas más recientes primero)
fineSchema.index({ fecha: -1, calificacion: 1 });

// Índice compuesto: año + mes + calificacion
// Usado en: Agregaciones mensuales por gravedad de multa
// Soporta: Estadísticas mensuales filtradas por calificacion
fineSchema.index({ año: 1, mes: 1, calificacion: 1 });

// Índice compuesto: lugar + fecha
// Usado en: GET /api/fines?lugar=CALLE+X
// Soporta: Análisis de multas por ubicación específica
fineSchema.index({ lugar: 1, fecha: -1 });

// Índice compuesto: denunciante + fecha
// Usado en: Análisis de multas por organismo denunciante (Policía Municipal, Radar, etc.)
// Soporta: Estadísticas por tipo de denunciante
fineSchema.index({ denunciante: 1, fecha: -1 });

// Índice para ranking de multas por importe (desc)
// Usado en: Identificación de multas más costosas
// Soporta: GET /api/fines?sortBy=importeBoletín&sortOrder=desc
fineSchema.index({ importeBoletín: -1, fecha: -1 });

// Índice para análisis de pérdida de puntos
// Usado en: Ranking de multas con más puntos detraídos
// Soporta: Infracciones más graves por puntos
fineSchema.index({ puntosDetraídos: -1, fecha: -1 });

// ========================================
// ÍNDICES GEOGRÁFICOS
// ========================================

// Índice compuesto para coordenadas UTM
// Usado en: Búsquedas geográficas, mapas de calor de multas
// Soporta: Análisis espacial de infracciones
// SPARSE: Coordenadas opcionales, solo indexar documentos con coordenadas
fineSchema.index({ 'coordenadas.x': 1, 'coordenadas.y': 1 }, {
  sparse: true
});

// ========================================
// ÍNDICES PARA FILTROS ESPECÍFICOS
// ========================================

// Índice para filtro por tipo de infracción
// Usado en: GET /api/fines?tipoInfraccion=VELOCIDAD
// Metadatos calculados: VELOCIDAD, ESTACIONAMIENTO, SEMAFORO, etc.
fineSchema.index({ 'metadatos.tipoInfraccion': 1, fecha: -1 });

// Índice para filtro por gravedad de infracción
// Usado en: GET /api/fines?esInfraccionGrave=true
// Filtro booleano: infracciones graves (MUY GRAVE) vs leves/graves
fineSchema.index({ 'metadatos.esInfraccionGrave': 1, fecha: -1 });

// Índice para filtro por descuento aplicado
// Usado en: Análisis de pronto pago, estadísticas de descuentos
// Soporta: GET /api/fines?tieneDescuento=true
fineSchema.index({ tieneDescuento: 1, fecha: -1 });

// ========================================
// ÍNDICES PARA AGREGACIONES
// ========================================

// Índice compuesto para estadísticas de ubicaciones
// Usado en: Fine.getStatisticsOptimized() - Agregaciones por lugar
// Soporta: $group por lugar + calificacion, sort por fecha
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

// Índice compuesto para análisis temporal mensual
// Usado en: Evolución de multas por ubicación y mes
// Soporta: Series temporales mensuales por lugar
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

// ========================================
// ÍNDICE DE BÚSQUEDA TEXTUAL
// ========================================

// Índice de texto completo para búsquedas flexibles
// Usado en: Búsquedas con $text por lugar, descripción o denunciante
// Soporta: Autocompletado, búsqueda general de multas
fineSchema.index({
  lugar: 'text',
  descripcionInfraccion: 'text',
  denunciante: 'text'
});

// Índice cubierto para listados frecuentes (evita fetch de documento completo)
fineSchema.index({
  fecha: -1,
  calificacion: 1,
  importeFinal: -1,
  'ubicacion.distrito': 1
}, {
  name: 'idx_fines_list_cover',
  background: true
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
    this.importeFinal = this.importeBoletín * FINE_CONFIG.DISCOUNT_RATE; // 50% de descuento
  } else {
    this.importeFinal = this.importeBoletín;
  }

  // Calcular exceso de velocidad si aplica
  if (this.datosVelocidad.velocidadLimite && this.datosVelocidad.velocidadCirculacion) {
    this.datosVelocidad.exceso = Math.max(0,
      this.datosVelocidad.velocidadCirculacion - this.datosVelocidad.velocidadLimite
    );
  }

  // Validar datos de velocidad y clasificar tipo
  if (this.datosVelocidad.velocidadLimite && this.datosVelocidad.velocidadCirculacion) {
    this.metadatos.esInfraccionVelocidad = true;
    this.metadatos.tipoInfraccion = INFRACTION_TYPES.VELOCIDAD;
  }

  next();
});

/**
 * Métodos estáticos para consultas agregadas (OPTIMIZADOS)
 */

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
      { $limit: parseInt(limit, 10) }
    ]).option({ allowDiskUse: true, maxTimeMS: MONGODB_TIMEOUTS.AGGREGATE_TIMEOUT_MS }),

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
          tiposInfraccionUnicos: { $addToSet: '$metadatos.tipoInfraccion' },
          denunciantesUnicos: { $addToSet: '$denunciante' }
        }
      }
    ]).option({ allowDiskUse: true, maxTimeMS: MONGODB_TIMEOUTS.AGGREGATE_TIMEOUT_MS })
  ]);

  return {
    estadisticas,
    resumen: resumenGeneral[0] ? {
      ...resumenGeneral[0],
      totalLugaresUnicos: resumenGeneral[0].lugaresUnicos.length,
      totalTiposInfraccion: resumenGeneral[0].tiposInfraccionUnicos.length,
      totalDenunciantesUnicos: resumenGeneral[0].denunciantesUnicos.length
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
    { $limit: parseInt(limit, 10) }
  ]).option({ allowDiskUse: true, maxTimeMS: MONGODB_TIMEOUTS.AGGREGATE_TIMEOUT_MS });

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
  ]).option({ allowDiskUse: true, maxTimeMS: MONGODB_TIMEOUTS.AGGREGATE_TIMEOUT_MS });

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
