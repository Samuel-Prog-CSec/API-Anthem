/**
 * Modelo de Accidentalidad
 *
 * Esquema de Mongoose para almacenar y gestionar datos de accidentes de tráfico
 * provenientes del sistema municipal. Incluye información sobre ubicación,
 * circunstancias, vehículos involucrados y personas afectadas.
 */

const mongoose = require('mongoose');
const { coordinatesUTMSchema, validateTimeFormat, validateDatasetDate } = require('./schemas/commonSchemas');
const {
  TIPOS_ACCIDENTE,
  TIPOS_VEHICULO,
  TIPOS_PERSONA,
  TIPOS_LESION,
  MAPEO_SEVERIDAD_LESIONES,
  WEATHER_CONDITIONS,
  DAY_PERIODS,
  WORKDAY_TYPES,
  FACTORES_RIESGO,
  SEVERITY_LEVELS,
  GENDERS,
  BINARY_INDICATORS,
  DATASET_YEARS,
  VALIDATION_LIMITS,
  MONGODB_TIMEOUTS
} = require('../constants');

/**
 * Sub-esquema para información de la persona afectada
 */
const personaAfectadaSchema = new mongoose.Schema({
  tipoPersona: {
    type: String,
    required: true,
    enum: Object.values(TIPOS_PERSONA),
    uppercase: true
  },

  rangoEdad: {
    type: String,
    required: true,
    trim: true,
    validate: {
      validator: function(v) {
        // Validar que sea un rango válido (ej: "18-25", "65+", "0-17")
        return /^(\d+-\d+|\d+\+|DESCONOCIDO)$/i.test(v);
      },
      message: 'Rango de edad debe tener formato válido (ej: "18-25", "65+", "DESCONOCIDO")'
    }
  },

  sexo: {
    type: String,
    required: true,
    enum: Object.values(GENDERS),
    uppercase: true
  },

  // Información de lesiones
  codigoLesividad: {
    type: String,
    required: false,
    trim: true,
    validate: {
      validator: function(v) {
        // Validar coherencia entre código y tipo de lesión
        if (!v || !this.tipoLesion) {
          return true;
        }

        // Mapeo de códigos comunes de lesividad
        const codigosFallecido = ['14', '04', 'FALLECIDO'];

        // No permitir códigos de fallecido en lesiones leves
        if (this.tipoLesion === TIPOS_LESION.LEVE && codigosFallecido.includes(v)) {
          return false;
        }

        // Validar que fallecidos tengan códigos apropiados
        if (this.tipoLesion === TIPOS_LESION.FALLECIDO && !codigosFallecido.includes(v)) {
          return false;
        }

        return true;
      },
      message: 'El código de lesividad no es coherente con el tipo de lesión'
    }
  },

  tipoLesion: {
    type: String,
    enum: Object.values(TIPOS_LESION),
    uppercase: true,
    default: TIPOS_LESION.DESCONOCIDO
  },

  // Análisis de sustancias
  positivaAlcohol: {
    type: String,
    enum: Object.values(BINARY_INDICATORS),
    default: BINARY_INDICATORS.NULL,
    uppercase: true
  },

  positivaDroga: {
    type: String,
    enum: Object.values(BINARY_INDICATORS),
    default: BINARY_INDICATORS.NULL,
    uppercase: true
  }

}, { _id: false });

/**
 * Esquema principal de accidentes
 *
 * Basado en la estructura del CSV de accidentalidad:
 * - num_expediente: Identificador único del expediente
 * - fecha: Fecha del accidente
 * - hora: Hora del accidente (rangos horarios)
 * - localizacion: Ubicación específica del accidente
 * - numero: Número de la calle
 * - cod_distrito/distrito: Información del distrito
 * - tipo_accidente: Tipo específico de accidente
 * - estado_meteorologico: Condiciones climáticas
 * - tipo_vehiculo: Vehículo involucrado
 * - Datos de las personas afectadas
 * - coordenadas: Ubicación geográfica exacta
 */
const accidentSchema = new mongoose.Schema({
  /**
   * Numero de expediente del accidente
   *
   * IMPORTANTE: NO es unico. Un mismo expediente puede tener multiples documentos
   * (uno por cada persona afectada: conductor, pasajero, peaton, etc.)
   *
   * Para contar accidentes unicos, agrupar por numeroExpediente.
   * Para contar personas afectadas, contar documentos.
   *
   * @type {String}
   * @example "EXP-2051-001" (3 documentos: conductor, pasajero, peaton)
   */
  numeroExpediente: {
    type: String,
    required: true,
    unique: false, // Explicitamente NO unico - ver documentacion arriba
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
      message: `La fecha del accidente debe estar dentro del rango del dataset (${DATASET_YEARS.MIN_YEAR}-${DATASET_YEARS.MAX_YEAR})`
    }
  },

  año: {
    type: Number,
    required: true,
    index: true,
    min: [DATASET_YEARS.VALIDATION_MIN, `Año debe ser ${DATASET_YEARS.VALIDATION_MIN} o posterior`],
    // IMPORTANTE: Validación dinámica para soportar datos históricos y futuros
    // Los datos del proyecto corresponden al año 2051 (dataset Anthem)
    // No usar max estático porque se evalúa al cargar el módulo
    validate: {
      validator: function(value) {
        // Permitir años históricos (2000-2099) para análisis de datos
        // El dataset actual contiene datos de 2051
        return value >= DATASET_YEARS.VALIDATION_MIN && value <= DATASET_YEARS.VALIDATION_MAX;
      },
      message: `Año debe estar entre ${DATASET_YEARS.VALIDATION_MIN} y ${DATASET_YEARS.VALIDATION_MAX}`
    },
    default: DATASET_YEARS.DEFAULT_YEAR
  },

  mes: {
    type: Number,
    required: true,
    index: true,
    min: [VALIDATION_LIMITS.MONTH_MIN, `Mes debe estar entre ${VALIDATION_LIMITS.MONTH_MIN} y ${VALIDATION_LIMITS.MONTH_MAX}`],
    max: [VALIDATION_LIMITS.MONTH_MAX, `Mes debe estar entre ${VALIDATION_LIMITS.MONTH_MIN} y ${VALIDATION_LIMITS.MONTH_MAX}`]
  },

  dia: {
    type: Number,
    required: true,
    min: [VALIDATION_LIMITS.DAY_MIN, `Día debe estar entre ${VALIDATION_LIMITS.DAY_MIN} y ${VALIDATION_LIMITS.DAY_MAX}`],
    max: [VALIDATION_LIMITS.DAY_MAX, `Día debe estar entre ${VALIDATION_LIMITS.DAY_MIN} y ${VALIDATION_LIMITS.DAY_MAX}`]
  },

  // Hora en formato de rango (ej: "1:15:00")
  hora: {
    type: String,
    required: true,
    trim: true,
    index: true,
    validate: {
      validator: validateTimeFormat,
      message: 'Hora debe tener formato válido HH:MM o HH.MM (ej: "14:30" o "08:00")'
    }
  },

  franjaHoraria: {
    type: Number,
    default: null,
    index: true
  },

  // Ubicación del accidente
  ubicacion: {
    calle: {
      type: String,
      required: true,
      trim: true,
      index: true
    },

    numero: {
      type: String,
      required: false,
      trim: true
    },

    // Información del distrito
    codigoDistrito: {
      type: String,
      required: true,
      trim: true,
      index: true
    },

    nombreDistrito: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      index: true
    },

    // Coordenadas geográficas
    coordenadas: {
      type: coordinatesUTMSchema,
      required: false
    }
  },

  // Circunstancias del accidente
  circunstancias: {
    tipoAccidente: {
      type: String,
      required: true,
      trim: true,
      enum: Object.values(TIPOS_ACCIDENTE),
      index: true,
      default: TIPOS_ACCIDENTE.OTRO
    },

    // Campo temporal para procesar
    tipoAccidenteOriginal: {
      type: String,
      required: false
    },

    estadoMeteorologico: {
      type: String,
      required: false,
      trim: true,
      enum: Object.values(WEATHER_CONDITIONS),
      uppercase: true,
      default: WEATHER_CONDITIONS.DESCONOCIDO
    },

    // Gravedad del accidente (calculada automáticamente)
    gravedad: {
      type: String,
      enum: Object.values(SEVERITY_LEVELS.ACCIDENT),
      default: SEVERITY_LEVELS.ACCIDENT.LEVE,
      index: true
    }
  },

  // Vehículo involucrado
  vehiculo: {
    tipo: {
      type: String,
      required: true,
      trim: true,
      enum: Object.values(TIPOS_VEHICULO),
      uppercase: true,
      index: true,
      default: TIPOS_VEHICULO.SIN_ESPECIFICAR
    },

    tipoVehiculoOriginal: {
      type: String,
      required: false
    }
  },

  // Persona afectada (cada registro representa una persona)
  personaAfectada: {
    type: personaAfectadaSchema,
    required: true
  },

  // Análisis automático
  analisis: {
    // Periodo del día
    periodoDia: {
      type: String,
      enum: Object.values(DAY_PERIODS),
      default: DAY_PERIODS.MAÑANA,
      index: true
    },

    // Día de la semana
    diaSemana: {
      type: Number,
      default: null
    },

    tipoJornada: {
      type: String,
      enum: Object.values(WORKDAY_TYPES),
      default: WORKDAY_TYPES.LABORABLE,
      index: true
    },

    // Factores de riesgo
    factoresRiesgo: [{
      type: String,
      enum: Object.values(FACTORES_RIESGO)
    }],

    // Puntuación de gravedad (0-10)
    puntuacionGravedad: {
      type: Number,
      default: 0
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
  collection: 'accidents',
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
/**
 * Índices para optimización de consultas
 */

// ========================================
// ÍNDICE PRINCIPAL - Búsqueda por expediente
// ========================================

// Índice compuesto: numeroExpediente + fecha
// Usado en: GET /api/accidents/:numeroExpediente
// Soporta: Búsqueda de accidentes específicos por número de expediente
accidentSchema.index({ numeroExpediente: 1, fecha: -1 });

// Índice cubierto para listados (reduce fetch de documentos)
// Cubre: sort por fecha, filtro por distrito y gravedad, proyección básica
accidentSchema.index({
  fecha: -1,
  numeroExpediente: 1,
  'circunstancias.gravedad': 1,
  'ubicacion.nombreDistrito': 1
}, {
  name: 'idx_accidents_list_cover',
  background: true
});

// ========================================
// ÍNDICES TEMPORALES
// ========================================

// Índice para componentes temporales descompuestos
// Usado en: Agregaciones por año, mes, día
// Soporta: Análisis de tendencias temporales, patrones estacionales
accidentSchema.index({ año: 1, mes: 1, dia: 1 });

// Índice para análisis por franja horaria
// Usado en: Análisis de patrones horarios (MADRUGADA, MAÑANA, TARDE, NOCHE)
// Soporta: GET /api/accidents?franjaHoraria=MAÑANA
accidentSchema.index({ franjaHoraria: 1, fecha: -1 });

// ========================================
// ÍNDICES POR UBICACIÓN
// ========================================

// Índice para consultas por calle
// Usado en: GET /api/accidents?calle=GRAN+VIA
// Soporta: Análisis de puntos negros (calles con más accidentes)
accidentSchema.index({ 'ubicacion.calle': 1, fecha: -1 });

// Índice para consultas por distrito
// Usado en: GET /api/accidents?distrito=CENTRO
// Soporta: Estadísticas por distrito, comparativas geográficas
accidentSchema.index({ 'ubicacion.nombreDistrito': 1, fecha: -1 });

// Índice compuesto para coordenadas UTM
// Usado en: Búsquedas geográficas exactas por coordenadas
// Soporta: Mapas de accidentes, análisis de proximidad
// SPARSE: Coordenadas opcionales, solo indexar documentos con coordenadas
accidentSchema.index({ 'ubicacion.coordenadas.x': 1, 'ubicacion.coordenadas.y': 1 }, {
  sparse: true
});

// Índice compuesto para consultas por rango de coordenadas UTM
// Las coordenadas son UTM (metros), no GeoJSON, por lo que no se puede usar 2dsphere
// Para consultas por area: $gte/$lte sobre coordenadas.x y coordenadas.y
accidentSchema.index(
  { 'ubicacion.coordenadas.x': 1, 'ubicacion.coordenadas.y': 1 },
  { name: 'idx_accidents_coordenadas_utm', background: true, sparse: true }
);

// ========================================
// ÍNDICES POR CIRCUNSTANCIAS DEL ACCIDENTE
// ========================================

// Índice para tipo de accidente
// Usado en: GET /api/accidents?tipoAccidente=COLISION
// Tipos: COLISION, ATROPELLO, CAIDA, VUELCO, etc.
accidentSchema.index({ 'circunstancias.tipoAccidente': 1, fecha: -1 });

// Índice para gravedad del accidente
// Usado en: GET /api/accidents?gravedad=MORTAL
// Niveles: LEVE, GRAVE, MORTAL
accidentSchema.index({ 'circunstancias.gravedad': 1, fecha: -1 });

// Índice compuesto: tipoAccidente + gravedad
// Usado en: Análisis de peligrosidad por tipo de accidente
// Soporta: "Colisiones mortales", "Atropellos graves"
accidentSchema.index({ 'circunstancias.tipoAccidente': 1, 'circunstancias.gravedad': 1 }, {
  name: 'idx_accidents_tipo_gravedad_analysis',
  background: true
});

// ========================================
// ÍNDICES POR VEHÍCULO
// ========================================

// Índice para tipo de vehículo involucrado
// Usado en: GET /api/accidents?tipoVehiculo=TURISMO
// Tipos: TURISMO, MOTOCICLETA, BICICLETA, PESADO, etc.
accidentSchema.index({ 'vehiculo.tipo': 1, fecha: -1 });

// ========================================
// ÍNDICES POR PERSONA AFECTADA
// ========================================

// Índice para tipo de persona afectada
// Usado en: GET /api/accidents?tipoPersona=PEATÓN
// Tipos: CONDUCTOR, PASAJERO, PEATÓN, TESTIGO, VIAJERO
accidentSchema.index({ 'personaAfectada.tipoPersona': 1, fecha: -1 });

// Índice para tipo de lesión
// Usado en: GET /api/accidents?tipoLesion=GRAVE
// Soporta: Análisis de severidad de lesiones
accidentSchema.index({ 'personaAfectada.tipoLesion': 1, fecha: -1 });

// ========================================
// ÍNDICES PARA AGREGACIONES COMPLEJAS
// ========================================

// Índice compuesto para análisis temporal de patrones
// Usado en: Agregaciones por período del día + tipo de jornada
// Soporta: "Accidentes en hora punta", "Accidentes nocturnos"
accidentSchema.index({
  'analisis.periodoDia': 1,
  'analisis.tipoJornada': 1,
  fecha: -1
});

// Índice compuesto: tipo accidente + tipo lesión
// Usado en: Correlación entre tipo de accidente y gravedad de lesiones
// Soporta: "Atropellos con lesiones mortales"
accidentSchema.index({
  'circunstancias.tipoAccidente': 1,
  'personaAfectada.tipoLesion': 1,
  fecha: -1
});

// Índice compuesto: fecha + distrito (consultas filtradas frecuentes)
// Usado en: GET /api/accidents?distrito=X&startDate=Y&endDate=Z
// Optimizado para ordenamiento DESC por fecha + filtro distrito
accidentSchema.index({ fecha: 1, 'ubicacion.nombreDistrito': 1 }, {
  name: 'idx_accidents_fecha_distrito_smartcity',
  background: true
});

// Índice compuesto principal: fecha DESC + tipo + gravedad
// Usado en: GET /api/accidents con sort por fecha + filtros combinados
// Soporta: Listados ordenados con múltiples filtros
accidentSchema.index({ fecha: -1, 'circunstancias.tipoAccidente': 1, 'circunstancias.gravedad': 1 }, {
  name: 'idx_accidents_timeline_severity',
  background: true
});

// ========================================
// ÍNDICE DE BÚSQUEDA TEXTUAL
// ========================================

// Índice de texto completo para búsquedas flexibles
// Usado en: Búsqueda general con $text
// Campos indexados: calle, distrito, tipo de accidente
accidentSchema.index({
  'ubicacion.calle': 'text',
  'ubicacion.nombreDistrito': 'text',
  'circunstancias.tipoAccidente': 'text'
});

/**
 * Middleware pre-save
 */
accidentSchema.pre('save', function(next) {
  // Extraer componentes de fecha
  if (this.fecha) {
    this.año = this.fecha.getFullYear();
    this.mes = this.fecha.getMonth() + 1;
    this.dia = this.fecha.getDate();
  }

  // Calcular franja horaria
  if (this.hora && !this.franjaHoraria) {
    this.franjaHoraria = parseInt(this.hora.split(':')[0], 10);
  }

  next();
});

/**
 * Métodos estáticos para consultas agregadas
 */

/**
 * Obtener estadísticas por periodo
 */
accidentSchema.statics.obtenerEstadisticasPorPeriodo = function(startDate, endDate) {
  return this.aggregate([
    {
      $match: {
        fecha: { $gte: startDate, $lte: endDate }
      }
    },
    {
      $group: {
        _id: null,
        totalAccidentes: { $sum: 1 },
        accidentesGraves: {
          $sum: {
            $cond: [{ $in: ['$circunstancias.gravedad', MAPEO_SEVERIDAD_LESIONES.GRAVES] }, 1, 0]
          }
        },
        accidentesMortales: {
          $sum: {
            $cond: [{ $eq: ['$circunstancias.gravedad', SEVERITY_LEVELS.ACCIDENT.MORTAL] }, 1, 0]
          }
        },
        atropellos: {
          $sum: {
            $cond: [{ $eq: ['$circunstancias.tipoAccidente', TIPOS_ACCIDENTE.ATROPELLO_A_PERSONA] }, 1, 0]
          }
        },
        accidentesConAlcohol: {
          $sum: {
            $cond: [{ $eq: ['$personaAfectada.positivaAlcohol', BINARY_INDICATORS.YES] }, 1, 0]
          }
        }
      }
    }
  ]).option({ allowDiskUse: true, maxTimeMS: MONGODB_TIMEOUTS.AGGREGATE_TIMEOUT_MS });
};

/**
 * Obtener puntos negros de accidentes
 */
accidentSchema.statics.obtenerPuntosNegros = function(limit = 10, startDate = null, endDate = null) {
  const matchConditions = {};

  if (startDate && endDate) {
    matchConditions.fecha = { $gte: startDate, $lte: endDate };
  }

  return this.aggregate([
    { $match: matchConditions },
    {
      $group: {
        _id: {
          calle: '$ubicacion.calle',
          distrito: '$ubicacion.nombreDistrito'
        },
        totalAccidentes: { $sum: 1 },
        accidentesGraves: {
          $sum: {
            $cond: [{ $in: ['$circunstancias.gravedad', MAPEO_SEVERIDAD_LESIONES.GRAVES] }, 1, 0]
          }
        },
        tiposAccidente: { $addToSet: '$circunstancias.tipoAccidente' },
        puntuacionGravedadPromedio: { $avg: '$analisis.puntuacionGravedad' }
      }
    },
    {
      $addFields: {
        indiceGravedad: {
          $multiply: ['$puntuacionGravedadPromedio', '$totalAccidentes']
        }
      }
    },
    { $sort: { indiceGravedad: -1, totalAccidentes: -1 } },
    { $limit: limit }
  ]).option({ allowDiskUse: true, maxTimeMS: MONGODB_TIMEOUTS.AGGREGATE_TIMEOUT_MS });
};

/**
 * Obtener análisis por tipo de vehículo
 */
accidentSchema.statics.obtenerAnalisisPorVehiculo = function(startDate = null, endDate = null) {
  const matchConditions = {};

  if (startDate && endDate) {
    matchConditions.fecha = { $gte: startDate, $lte: endDate };
  }

  return this.aggregate([
    { $match: matchConditions },
    {
      $group: {
        _id: '$vehiculo.tipo',
        totalAccidentes: { $sum: 1 },
        accidentesGraves: {
          $sum: {
            $cond: [{ $in: ['$circunstancias.gravedad', MAPEO_SEVERIDAD_LESIONES.GRAVES] }, 1, 0]
          }
        },
        puntuacionGravedadPromedio: { $avg: '$analisis.puntuacionGravedad' }
      }
    },
    {
      $addFields: {
        porcentajeGravedad: {
          $multiply: [
            { $divide: ['$accidentesGraves', '$totalAccidentes'] },
            100
          ]
        }
      }
    },
    { $sort: { totalAccidentes: -1 } }
  ]).option({ allowDiskUse: true, maxTimeMS: MONGODB_TIMEOUTS.AGGREGATE_TIMEOUT_MS });
};

/**
 * Obtener patrones temporales
 */
accidentSchema.statics.obtenerPatronesTemporales = function(groupBy = 'hora') {
  const groupField = groupBy === 'hora' ? '$franjaHoraria' :
                    groupBy === 'diaSemana' ? '$analisis.diaSemana' :
                    '$analisis.periodoDia';

  return this.aggregate([
    {
      $group: {
        _id: groupField,
        totalAccidentes: { $sum: 1 },
        accidentesGraves: {
          $sum: {
            $cond: [{ $in: ['$circunstancias.gravedad', MAPEO_SEVERIDAD_LESIONES.GRAVES] }, 1, 0]
          }
        }
      }
    },
    { $sort: { _id: 1 } }
  ]).option({ allowDiskUse: true, maxTimeMS: MONGODB_TIMEOUTS.AGGREGATE_TIMEOUT_MS });
};

/**
 * Obtener comparativa completa entre distritos con todos los indicadores
 * @param {Object} filters - Filtros de consulta
 * @returns {Promise<Array>} Comparativa de distritos con métricas y porcentajes
 */
accidentSchema.statics.obtenerComparativaDistritos = function(filters = {}) {
  return this.aggregate([
    { $match: filters },
    {
      $group: {
        _id: '$ubicacion.nombreDistrito',
        totalAccidentes: { $sum: 1 },
        accidentesGraves: {
          $sum: {
            $cond: [{ $in: ['$circunstancias.gravedad', MAPEO_SEVERIDAD_LESIONES.GRAVES] }, 1, 0]
          }
        },
        accidentesMortales: {
          $sum: {
            $cond: [{ $eq: ['$circunstancias.gravedad', SEVERITY_LEVELS.ACCIDENT.MORTAL] }, 1, 0]
          }
        },
        atropellos: {
          $sum: {
            $cond: [{ $eq: ['$circunstancias.tipoAccidente', TIPOS_ACCIDENTE.ATROPELLO_A_PERSONA] }, 1, 0]
          }
        },
        accidentesAlcohol: {
          $sum: {
            $cond: [{ $eq: ['$personaAfectada.positivaAlcohol', BINARY_INDICATORS.YES] }, 1, 0]
          }
        },
        puntuacionGravedadPromedio: { $avg: '$analisis.puntuacionGravedad' },
        turismos: {
          $sum: {
            $cond: [{ $eq: ['$vehiculo.tipo', TIPOS_VEHICULO.TURISMO] }, 1, 0]
          }
        },
        motocicletas: {
          $sum: {
            $cond: [{ $eq: ['$vehiculo.tipo', TIPOS_VEHICULO.MOTOCICLETA_MAS_125CC] }, 1, 0]
          }
        },
        bicicletas: {
          $sum: {
            $cond: [{ $eq: ['$vehiculo.tipo', TIPOS_VEHICULO.BICICLETA] }, 1, 0]
          }
        }
      }
    },
    {
      $addFields: {
        porcentajeGravedad: {
          $multiply: [
            { $divide: ['$accidentesGraves', '$totalAccidentes'] },
            100
          ]
        },
        porcentajeAtropellos: {
          $multiply: [
            { $divide: ['$atropellos', '$totalAccidentes'] },
            100
          ]
        },
        porcentajeAlcohol: {
          $multiply: [
            { $divide: ['$accidentesAlcohol', '$totalAccidentes'] },
            100
          ]
        },
        indiceRiesgoTotal: {
          $add: [
            '$totalAccidentes',
            { $multiply: ['$accidentesGraves', 2] },
            { $multiply: ['$accidentesMortales', 5] }
          ]
        }
      }
    },
    { $sort: { totalAccidentes: -1 } }
  ]).option({ allowDiskUse: true, maxTimeMS: MONGODB_TIMEOUTS.AGGREGATE_TIMEOUT_MS });
};

/**
 * Obtener análisis de seguridad por calle con índice de riesgo calculado
 * @param {Object} filters - Filtros de consulta
 * @param {Number} limit - Límite de calles a retornar
 * @returns {Promise<Array>} Calles ordenadas por índice de riesgo
 */
accidentSchema.statics.obtenerAnalisisSeguridadCalles = function(filters = {}, limit = 20) {
  return this.aggregate([
    { $match: filters },
    {
      $group: {
        _id: {
          calle: '$ubicacion.calle',
          distrito: '$ubicacion.nombreDistrito'
        },
        totalAccidentes: { $sum: 1 },
        accidentesGraves: {
          $sum: {
            $cond: [{ $in: ['$circunstancias.gravedad', MAPEO_SEVERIDAD_LESIONES.GRAVES] }, 1, 0]
          }
        },
        atropellos: {
          $sum: {
            $cond: [{ $eq: ['$circunstancias.tipoAccidente', TIPOS_ACCIDENTE.ATROPELLO_A_PERSONA] }, 1, 0]
          }
        },
        accidentesAlcohol: {
          $sum: {
            $cond: [{ $eq: ['$personaAfectada.positivaAlcohol', BINARY_INDICATORS.YES] }, 1, 0]
          }
        },
        indiceSeveridad: { $avg: '$analisis.puntuacionGravedad' }
      }
    },
    {
      $addFields: {
        indiceRiesgo: {
          $add: [
            { $multiply: ['$totalAccidentes', 0.3] },
            { $multiply: ['$accidentesGraves', 0.4] },
            { $multiply: ['$atropellos', 0.2] },
            { $multiply: ['$accidentesAlcohol', 0.1] }
          ]
        }
      }
    },
    { $sort: { indiceRiesgo: -1 } },
    { $limit: limit }
  ]).option({ allowDiskUse: true, maxTimeMS: MONGODB_TIMEOUTS.AGGREGATE_TIMEOUT_MS });
};

/**
 * Obtener análisis temporal de tendencias por año y mes
 * @param {Object} filters - Filtros de consulta
 * @returns {Promise<Array>} Tendencias ordenadas cronológicamente
 */
accidentSchema.statics.obtenerAnalisisTendencias = function(filters = {}) {
  return this.aggregate([
    { $match: filters },
    {
      $group: {
        _id: {
          año: '$año',
          mes: '$mes'
        },
        totalAccidentes: { $sum: 1 },
        accidentesGraves: {
          $sum: {
            $cond: [{ $in: ['$circunstancias.gravedad', MAPEO_SEVERIDAD_LESIONES.GRAVES] }, 1, 0]
          }
        }
      }
    },
    { $sort: { '_id.año': 1, '_id.mes': 1 } }
  ]).option({ allowDiskUse: true, maxTimeMS: MONGODB_TIMEOUTS.AGGREGATE_TIMEOUT_MS });
};

/**
 * Obtener correlación entre condiciones meteorológicas y accidentes
 * @param {Object} filters - Filtros de consulta
 * @returns {Promise<Array>} Estadísticas por condición meteorológica
 */
accidentSchema.statics.obtenerCorrelacionMeteorologica = function(filters = {}) {
  return this.aggregate([
    { $match: filters },
    {
      $group: {
        _id: '$circunstancias.estadoMeteorologico',
        totalAccidentes: { $sum: 1 },
        accidentesGraves: {
          $sum: {
            $cond: [{ $in: ['$circunstancias.gravedad', MAPEO_SEVERIDAD_LESIONES.GRAVES] }, 1, 0]
          }
        }
      }
    },
    {
      $addFields: {
        porcentajeGravedad: {
          $multiply: [
            { $divide: ['$accidentesGraves', '$totalAccidentes'] },
            100
          ]
        }
      }
    },
    { $sort: { totalAccidentes: -1 } }
  ]).option({ allowDiskUse: true, maxTimeMS: MONGODB_TIMEOUTS.AGGREGATE_TIMEOUT_MS });
};

/**
 * Obtener distribución de accidentes por distrito con métricas de gravedad
 * @param {Object} filters - Filtros de consulta
 * @param {Number} limit - Límite de distritos a retornar
 * @returns {Promise<Array>} Distribución por distrito ordenada por total de accidentes
 */
accidentSchema.statics.obtenerDistribucionDistritos = function(filters = {}, limit = 15) {
  return this.aggregate([
    { $match: filters },
    {
      $group: {
        _id: '$ubicacion.nombreDistrito',
        totalAccidentes: { $sum: 1 },
        accidentesGraves: {
          $sum: {
            $cond: [{ $in: ['$circunstancias.gravedad', MAPEO_SEVERIDAD_LESIONES.GRAVES] }, 1, 0]
          }
        },
        puntuacionGravedadPromedio: { $avg: '$analisis.puntuacionGravedad' }
      }
    },
    { $sort: { totalAccidentes: -1 } },
    { $limit: limit }
  ]).option({ allowDiskUse: true, maxTimeMS: MONGODB_TIMEOUTS.AGGREGATE_TIMEOUT_MS });
};

/**
 * Obtener análisis de factores de riesgo más frecuentes
 * @param {Object} filters - Filtros de consulta
 * @returns {Promise<Array>} Factores de riesgo ordenados por frecuencia
 */
accidentSchema.statics.obtenerAnalisisFactoresRiesgo = function(filters = {}) {
  return this.aggregate([
    { $match: filters },
    // NO usar $limit antes de $unwind/$group - corrompe las estadísticas
    { $unwind: { path: '$analisis.factoresRiesgo', preserveNullAndEmptyArrays: true } },
    {
      $group: {
        _id: '$analisis.factoresRiesgo',
        cantidad: { $sum: 1 }
      }
    },
    { $sort: { cantidad: -1 } }
  ])
    .option({ allowDiskUse: true, maxTimeMS: MONGODB_TIMEOUTS.AGGREGATE_TIMEOUT_MS });
};

/**
 * Obtener datos optimizados para mapa de calor de accidentes
 * Agrupa puntos cercanos para reducir ruido visual en el mapa
 * @param {Object} filters - Filtros de consulta (fecha, gravedad, etc.)
 * @param {Number} limite - Máximo número de accidentes a procesar
 * @param {Number} precision - Distancia en metros para agrupar puntos (default: 100m)
 * @returns {Promise<Object>} Datos del heatmap con puntos agrupados y estadísticas
 */
accidentSchema.statics.obtenerDatosMapaCalor = async function(filters = {}, limite = 500, precision = 100) {
  // Añadir filtros obligatorios de coordenadas válidas
  const queryFilters = {
    ...filters,
    'ubicacion.coordenadas.x': { $exists: true, $ne: null },
    'ubicacion.coordenadas.y': { $exists: true, $ne: null }
  };

  // Obtener accidentes con coordenadas
  const heatmapData = await this.find(queryFilters)
    .select({
      'ubicacion.coordenadas': 1,
      'circunstancias.gravedad': 1,
      'analisis.puntuacionGravedad': 1,
      'personaAfectada.tipoLesion': 1,
      fecha: 1
    })
    .limit(parseInt(limite, 10))
    .lean();

  // Agrupar puntos cercanos para reducir ruido en el mapa
  const groupedPoints = {};

  heatmapData.forEach(accident => {
    const x = Math.round(accident.ubicacion.coordenadas.x / precision) * precision;
    const y = Math.round(accident.ubicacion.coordenadas.y / precision) * precision;
    const key = `${x},${y}`;

    if (!groupedPoints[key]) {
      groupedPoints[key] = {
        coordenadas: { x, y },
        accidentes: [],
        totalAccidentes: 0,
        accidentesGraves: 0,
        puntuacionGravedadPromedio: 0
      };
    }

    groupedPoints[key].accidentes.push(accident);
    groupedPoints[key].totalAccidentes++;

    if (MAPEO_SEVERIDAD_LESIONES.GRAVES.includes(accident.circunstancias.gravedad)) {
      groupedPoints[key].accidentesGraves++;
    }

    groupedPoints[key].puntuacionGravedadPromedio =
      (groupedPoints[key].puntuacionGravedadPromedio + accident.analisis.puntuacionGravedad) /
      groupedPoints[key].totalAccidentes;
  });

  // Transformar a formato de heatmap para frontend
  const heatmapPoints = Object.values(groupedPoints).map(group => ({
    lat: group.coordenadas.y,
    lng: group.coordenadas.x,
    weight: group.totalAccidentes,
    intensity: group.puntuacionGravedadPromedio,
    details: {
      totalAccidentes: group.totalAccidentes,
      accidentesGraves: group.accidentesGraves,
      porcentajeGravedad: (group.accidentesGraves / group.totalAccidentes) * 100
    }
  }));

  return {
    puntos: heatmapPoints,
    estadisticas: {
      totalPuntos: heatmapPoints.length,
      totalAccidentes: heatmapData.length
    }
  };
};

// Crear y exportar el modelo
const Accidente = mongoose.model('Accidente', accidentSchema);

module.exports = Accidente;
