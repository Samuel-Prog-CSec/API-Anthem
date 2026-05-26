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
  WEATHER_CONDITIONS,
  DAY_PERIODS,
  WORKDAY_TYPES,
  FACTORES_RIESGO,
  SEVERITY_LEVELS,
  GENDERS,
  BINARY_INDICATORS,
  DATASET_YEARS,
  VALIDATION_LIMITS,
  GEOMETRY_TYPES
} = require('../constants');
const accidenteService = require('../services/accidenteService');

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

  // Informacion de lesiones
  // Se guarda el codigo original del CSV sin validar coherencia con
  // `tipoLesion`: el mapeo oficial ya se hace en el script de
  // importacion (importarAccidentes.js) siguiendo la tabla del
  // dataset_information.md, y el modelo debe aceptar los datos
  // historicos aunque haya inconsistencias puntuales en la fuente.
  codigoLesividad: {
    type: String,
    required: false,
    trim: true
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

    // Coordenadas geograficas (UTM ETRS89 zona 30N, oficial Espana)
    coordenadas: {
      type: coordinatesUTMSchema,
      required: false
    },

    // Geometria GeoJSON WGS84 derivada desde UTM en el importador.
    // Permite queries `$near`, `$geoWithin` y el endpoint /mapa.
    // NO usar `default: 'Point'`: Mongoose crearia subdocumentos vacios
    // que rompen el indice 2dsphere sparse. Se crea solo cuando el
    // importador asigna geometry explicitamente con coordinates.
    geometry: {
      type: {
        type: String,
        enum: [GEOMETRY_TYPES.POINT]
      },
      coordinates: {
        type: [Number], // [lng, lat]
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
  name: 'idx_accidents_list_cover'
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

// Indice compuesto para consultas por rango de coordenadas UTM.
// Las coordenadas son UTM (metros), no GeoJSON, por lo que aqui no se puede
// usar 2dsphere; para queries por area se hacen $gte/$lte sobre x e y.
// Sparse: coordenadas opcionales, solo se indexan documentos con coordenadas.
// Este indice es el unico necesario para queries exactas + rango UTM
// (sustituye al duplicado anonimo previo sobre los mismos campos).
accidentSchema.index(
  { 'ubicacion.coordenadas.x': 1, 'ubicacion.coordenadas.y': 1 },
  { name: 'idx_accidents_coordenadas_utm', sparse: true }
);

// Indice geoespacial 2dsphere sobre ubicacion.geometry (WGS84).
// Soporta queries `$near`, `$geoWithin` y alimenta el endpoint
// GET /accidentes/mapa que devuelve FeatureCollection GeoJSON.
// SPARSE: solo indexa documentos con geometry (importador derivado de UTM).
accidentSchema.index(
  { 'ubicacion.geometry': '2dsphere' },
  { name: 'idx_accidents_geometry_2dsphere', sparse: true }
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
  name: 'idx_accidents_tipo_gravedad_analysis'
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
  name: 'idx_accidents_fecha_distrito_smartcity'
});

// Índice compuesto principal: fecha DESC + tipo + gravedad
// Usado en: GET /api/accidents con sort por fecha + filtros combinados
// Soporta: Listados ordenados con múltiples filtros
accidentSchema.index({ fecha: -1, 'circunstancias.tipoAccidente': 1, 'circunstancias.gravedad': 1 }, {
  name: 'idx_accidents_timeline_severity'
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
 * Metodos estaticos delegados a `services/accidenteService.js`.
 *
 * El service contiene la implementacion real de las 11 agregaciones y
 * el heatmap; el modelo expone wrappers thin para mantener la API
 * publica clasica `Accidente.metodoX(...)`.
 */
accidentSchema.statics.obtenerEstadisticasPorPeriodo = function(startDate, endDate) {
  return accidenteService.obtenerEstadisticasPorPeriodo(this, startDate, endDate);
};

accidentSchema.statics.obtenerPuntosNegros = function(limit, startDate, endDate) {
  return accidenteService.obtenerPuntosNegros(this, limit, startDate, endDate);
};

accidentSchema.statics.obtenerAnalisisPorVehiculo = function(startDate, endDate) {
  return accidenteService.obtenerAnalisisPorVehiculo(this, startDate, endDate);
};

accidentSchema.statics.obtenerPatronesTemporales = function(groupBy) {
  return accidenteService.obtenerPatronesTemporales(this, groupBy);
};

accidentSchema.statics.obtenerComparativaDistritos = function(filters) {
  return accidenteService.obtenerComparativaDistritos(this, filters);
};

accidentSchema.statics.obtenerAnalisisSeguridadCalles = function(filters, limit) {
  return accidenteService.obtenerAnalisisSeguridadCalles(this, filters, limit);
};

accidentSchema.statics.obtenerAnalisisTendencias = function(filters) {
  return accidenteService.obtenerAnalisisTendencias(this, filters);
};

accidentSchema.statics.obtenerCorrelacionMeteorologica = function(filters) {
  return accidenteService.obtenerCorrelacionMeteorologica(this, filters);
};

accidentSchema.statics.obtenerDistribucionDistritos = function(filters, limit) {
  return accidenteService.obtenerDistribucionDistritos(this, filters, limit);
};

accidentSchema.statics.obtenerAnalisisFactoresRiesgo = function(filters) {
  return accidenteService.obtenerAnalisisFactoresRiesgo(this, filters);
};

accidentSchema.statics.obtenerDatosMapaCalor = function(filters, limite, precision) {
  return accidenteService.obtenerDatosMapaCalor(this, filters, limite, precision);
};



// Crear y exportar el modelo
const Accidente = mongoose.model('Accidente', accidentSchema);

module.exports = Accidente;
