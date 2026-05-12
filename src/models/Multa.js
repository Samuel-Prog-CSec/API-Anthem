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
  AGGREGATION_LIMITS,
  DATASET_YEARS,
  GEOMETRY_TYPES
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
const multaSchema = new mongoose.Schema({
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

  // Geometria GeoJSON WGS84 derivada desde UTM en el importador.
  // Necesaria para queries `$near`/`$geoWithin` y el endpoint
  // GET /multas/mapa.
  geometry: {
    type: {
      type: String,
      enum: [GEOMETRY_TYPES.POINT],
      default: GEOMETRY_TYPES.POINT
    },
    coordinates: {
      type: [Number],
      required: false,
      validate: {
        validator: function(coords) {
          if (!coords || coords.length === 0) {return true;}
          if (coords.length !== 2) {return false;}
          const [lng, lat] = coords;
          return (
            typeof lng === 'number' &&
            typeof lat === 'number' &&
            lng >= VALIDATION_LIMITS.LONGITUDE_MIN && lng <= VALIDATION_LIMITS.LONGITUDE_MAX &&
            lat >= VALIDATION_LIMITS.LATITUDE_MIN && lat <= VALIDATION_LIMITS.LATITUDE_MAX
          );
        },
        message: 'geometry.coordinates debe ser [lng, lat] dentro de rangos validos'
      }
    }
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
    },
    // Marca true cuando la calificacion vino vacia o invalida en el CSV
    // y se asigno LEVE por defecto. Permite distinguir LEVE real de LEVE
    // inferido en analisis BI sin perder esa diferencia.
    calificacionInferida: {
      type: Boolean,
      default: false
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
multaSchema.index(
  { lugar: 1, fecha: 1, hora: 1, importeBoletín: 1 },
  { unique: false, name: 'fine_identification' }
);

// ========================================
// ÍNDICES PRINCIPALES - Consultas frecuentes
// ========================================

// Índice compuesto: fecha (desc) + calificacion
// Usado en: GET /api/fines?calificacion=LEVE&startDate=X&endDate=Y
// Sort por fecha descendente (multas más recientes primero)
multaSchema.index({ fecha: -1, calificacion: 1 });

// Índice compuesto: año + mes + calificacion
// Usado en: Agregaciones mensuales por gravedad de multa
// Soporta: Estadísticas mensuales filtradas por calificacion
multaSchema.index({ año: 1, mes: 1, calificacion: 1 });

// Índice compuesto: lugar + fecha
// Usado en: GET /api/fines?lugar=CALLE+X
// Soporta: Análisis de multas por ubicación específica
multaSchema.index({ lugar: 1, fecha: -1 });

// Índice compuesto: denunciante + fecha
// Usado en: Análisis de multas por organismo denunciante (Policía Municipal, Radar, etc.)
// Soporta: Estadísticas por tipo de denunciante
multaSchema.index({ denunciante: 1, fecha: -1 });

// Índice para ranking de multas por importe (desc)
// Usado en: Identificación de multas más costosas
// Soporta: GET /api/fines?sortBy=importeBoletín&sortOrder=desc
multaSchema.index({ importeBoletín: -1, fecha: -1 });

// Índice para análisis de pérdida de puntos
// Usado en: Ranking de multas con más puntos detraídos
// Soporta: Infracciones más graves por puntos
multaSchema.index({ puntosDetraídos: -1, fecha: -1 });

// ========================================
// ÍNDICES GEOGRÁFICOS
// ========================================

// Índice compuesto para coordenadas UTM
// Usado en: Búsquedas geográficas, mapas de calor de multas
// Soporta: Análisis espacial de infracciones
// SPARSE: Coordenadas opcionales, solo indexar documentos con coordenadas
multaSchema.index({ 'coordenadas.x': 1, 'coordenadas.y': 1 }, {
  sparse: true
});

// Indice geoespacial 2dsphere sobre geometry (WGS84) para el
// endpoint GET /multas/mapa y queries `$near`/`$geoWithin`.
// SPARSE: solo indexa documentos con geometry derivada desde UTM.
multaSchema.index(
  { geometry: '2dsphere' },
  { name: 'idx_multas_geometry_2dsphere', sparse: true }
);

// ========================================
// ÍNDICES PARA FILTROS ESPECÍFICOS
// ========================================

// Índice para filtro por tipo de infracción
// Usado en: GET /api/fines?tipoInfraccion=VELOCIDAD
// Metadatos calculados: VELOCIDAD, ESTACIONAMIENTO, SEMAFORO, etc.
multaSchema.index({ 'metadatos.tipoInfraccion': 1, fecha: -1 });

// Índice para filtro por gravedad de infracción
// Usado en: GET /api/fines?esInfraccionGrave=true
// Filtro booleano: infracciones graves (MUY GRAVE) vs leves/graves
multaSchema.index({ 'metadatos.esInfraccionGrave': 1, fecha: -1 });

// Índice para filtro por descuento aplicado
// Usado en: Análisis de pronto pago, estadísticas de descuentos
// Soporta: GET /api/fines?tieneDescuento=true
multaSchema.index({ tieneDescuento: 1, fecha: -1 });

// ========================================
// ÍNDICES PARA AGREGACIONES
// ========================================

// Índice compuesto para estadísticas de ubicaciones
// Usado en: Multa.getStatisticsOptimized() - Agregaciones por lugar
// Soporta: $group por lugar + calificacion, sort por fecha
multaSchema.index(
  {
    fecha: -1,
    lugar: 1,
    calificacion: 1
  },
  {
    name: 'idx_fines_statistics'
  }
);

// Índice compuesto para análisis temporal mensual
// Usado en: Evolución de multas por ubicación y mes
// Soporta: Series temporales mensuales por lugar
multaSchema.index(
  {
    año: 1,
    mes: 1,
    lugar: 1
  },
  {
    name: 'idx_fines_temporal'
  }
);

// ========================================
// ÍNDICE DE BÚSQUEDA TEXTUAL
// ========================================

// Índice de texto completo para búsquedas flexibles
// Usado en: Búsquedas con $text por lugar, descripción o denunciante
// Soporta: Autocompletado, búsqueda general de multas
multaSchema.index({
  lugar: 'text',
  descripcionInfraccion: 'text',
  denunciante: 'text'
});

// Indice cubierto para listados frecuentes (evita fetch de documento completo)
multaSchema.index({
  fecha: -1,
  calificacion: 1,
  importeFinal: -1,
  lugar: 1
}, {
  name: 'idx_multas_listado_cobertura'
});

/**
 * Middleware pre-save para procesamiento automático
 */
multaSchema.pre('save', function(next) {
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
multaSchema.statics.getStatisticsOptimized = async function(options) {
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
multaSchema.statics.getLocationRankingOptimized = async function(options) {
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
multaSchema.statics.getTemporalAnalysisOptimized = async function(options) {
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

/**
 * Calcular metricas agregadas para el dashboard de multas en un periodo
 * Ejecuta 3 agregaciones en paralelo: metricas generales, top infracciones
 * y evolucion diaria. Encapsula las pipelines aqui para mantener controllers
 * delgados y reutilizar la logica de negocio
 *
 * @param {Date} fechaInicio - Limite inferior del periodo
 * @param {Date} fechaFin - Limite superior del periodo
 * @param {Object} options - { topInfraccionesLimit, maxTimeMS }
 * @returns {Promise<Object>} { metricasGenerales, topInfracciones, evolucionDiaria }
 */
multaSchema.statics.getDashboardMetrics = async function(fechaInicio, fechaFin, options = {}) {
  const topLimit = options.topInfraccionesLimit ?? AGGREGATION_LIMITS.PREVIEW;
  const maxTimeMS = options.maxTimeMS ?? MONGODB_TIMEOUTS.AGGREGATE_TIMEOUT_MS;
  const matchPeriodo = { fecha: { $gte: fechaInicio, $lte: fechaFin } };

  const pipelineGenerales = [
    { $match: matchPeriodo },
    {
      $group: {
        _id: null,
        totalMultas: { $sum: 1 },
        importeTotal: { $sum: '$importeFinal' },
        puntosTotal: { $sum: '$puntosDetraídos' },
        multasGraves: { $sum: { $cond: ['$metadatos.esInfraccionGrave', 1, 0] } },
        multasConDescuento: { $sum: { $cond: ['$tieneDescuento', 1, 0] } },
        multasVelocidad: { $sum: { $cond: ['$metadatos.esInfraccionVelocidad', 1, 0] } }
      }
    }
  ];

  const pipelineTopInfracciones = [
    { $match: matchPeriodo },
    {
      $group: {
        _id: '$metadatos.tipoInfraccion',
        cantidad: { $sum: 1 },
        importePromedio: { $avg: '$importeFinal' }
      }
    },
    { $sort: { cantidad: -1 } },
    { $limit: topLimit }
  ];

  const pipelineEvolucionDiaria = [
    { $match: matchPeriodo },
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
        totalMultas: { $sum: 1 },
        importeTotal: { $sum: '$importeFinal' }
      }
    },
    { $sort: { '_id.fecha': 1 } }
  ];

  // allSettled: una agregacion lenta o fallida no debe descartar el resto del dashboard
  const [resGenerales, resTop, resEvolucion] = await Promise.allSettled([
    this.aggregate(pipelineGenerales).maxTimeMS(maxTimeMS).exec(),
    this.aggregate(pipelineTopInfracciones).maxTimeMS(maxTimeMS).exec(),
    this.aggregate(pipelineEvolucionDiaria).maxTimeMS(maxTimeMS).exec()
  ]);

  return {
    metricasGenerales: resGenerales.status === 'fulfilled' ? (resGenerales.value[0] || null) : null,
    topInfracciones: resTop.status === 'fulfilled' ? resTop.value : [],
    evolucionDiaria: resEvolucion.status === 'fulfilled' ? resEvolucion.value : []
  };
};

// Crear y exportar el modelo
const Multa = mongoose.model('Multa', multaSchema);

module.exports = Multa;
