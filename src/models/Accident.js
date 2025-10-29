/**
 * Modelo de Accidentalidad
 *
 * Esquema de Mongoose para almacenar y gestionar datos de accidentes de tráfico
 * provenientes del sistema municipal. Incluye información sobre ubicación,
 * circunstancias, vehículos involucrados y personas afectadas.
 */

const mongoose = require('mongoose');

/**
 * Sub-esquema para coordenadas UTM
 */
const coordinatesSchema = new mongoose.Schema({
  x: {
    type: Number,
    required: false,
    validate: {
      validator: function(v) {
        return v === null || v === undefined || (v >= 100000 && v <= 1000000);
      },
      message: 'Coordenada X UTM debe estar entre 100,000 y 1,000,000 metros'
    }
  },
  y: {
    type: Number,
    required: false,
    validate: {
      validator: function(v) {
        return v === null || v === undefined || (v >= 3000000 && v <= 5000000);
      },
      message: 'Coordenada Y UTM debe estar entre 3,000,000 y 5,000,000 metros'
    }
  }
}, { _id: false });

/**
 * Sub-esquema para información de la persona afectada
 */
const personaAfectadaSchema = new mongoose.Schema({
  tipoPersona: {
    type: String,
    required: [true, 'Tipo de persona obligatorio'],
    enum: {
      values: ['CONDUCTOR', 'PEATON', 'TESTIGO', 'VIAJERO', 'PASAJERO'],
      message: 'Tipo de persona debe ser CONDUCTOR, PEATON, TESTIGO, VIAJERO o PASAJERO'
    },
    uppercase: true
  },

  rangoEdad: {
    type: String,
    required: [true, 'Rango de edad obligatorio'],
    trim: true,
    validate: {
      validator: function(v) {
        // Acepta formatos como "De 18 a 20 años", "Más de 65", etc.
        return v && v.length > 0;
      },
      message: 'Rango de edad no puede estar vacío'
    }
  },

  sexo: {
    type: String,
    required: [true, 'Sexo obligatorio'],
    enum: {
      values: ['HOMBRE', 'MUJER', 'NO_ASIGNADO'],
      message: 'Sexo debe ser HOMBRE, MUJER o NO_ASIGNADO'
    },
    uppercase: true
  },

  // Información de lesiones
  codigoLesividad: {
    type: String,
    required: false,
    validate: {
      validator: function(v) {
        if (!v) {return true;}
        return /^(0[1-7]|14|77)$/.test(v);
      },
      message: 'Código de lesividad no válido'
    }
  },

  tipoLesion: {
    type: String,
    enum: {
      values: ['LEVE', 'GRAVE', 'FALLECIDO', 'SIN_ASISTENCIA', 'DESCONOCIDO'],
      message: 'Tipo de lesión debe ser LEVE, GRAVE, FALLECIDO, SIN_ASISTENCIA o DESCONOCIDO'
    },
    uppercase: true,
    default: function() {
      // Mapear códigos de lesividad a tipos
      const codigoMap = {
        '01': 'LEVE', '02': 'LEVE', '05': 'LEVE',
        '06': 'LEVE', '07': 'LEVE',
        '03': 'GRAVE',
        '04': 'FALLECIDO',
        '14': 'SIN_ASISTENCIA',
        '77': 'DESCONOCIDO'
      };
      const codigo = this.codigoLesividad;
      return codigoMap[codigo] || 'DESCONOCIDO';
    }
  },

  // Análisis de sustancias
  positivaAlcohol: {
    type: String,
    enum: ['S', 'N', 'NULL'],
    default: 'NULL'
  },

  positivaDroga: {
    type: String,
    enum: ['S', 'N', 'NULL'],
    default: 'NULL'
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
  // Identificación del expediente
  numeroExpediente: {
    type: String,
    required: [true, 'Número de expediente obligatorio'],
    unique: false, // Un expediente puede tener múltiples registros (personas afectadas)
    index: true,
    trim: true,
    validate: {
      validator: function(v) {
        // Formato: aaaasnnnnnn (año + s + correlativo)
        return /^\d{4}S\d{6}$/.test(v);
      },
      message: 'Formato de expediente inválido. Debe ser AAAASnnnnnn'
    }
  },

  // Información temporal
  fecha: {
    type: Date,
    required: [true, 'Fecha del accidente obligatoria'],
    index: true
  },

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

  // Hora en formato de rango (ej: "1:15:00")
  hora: {
    type: String,
    required: [true, 'Hora del accidente obligatoria'],
    trim: true,
    validate: {
      validator: function(v) {
        // Acepta formatos como "1:15:00", "23:45:00"
        return /^\d{1,2}:\d{2}:\d{2}$/.test(v);
      },
      message: 'Formato de hora inválido. Debe ser H:MM:SS'
    },
    index: true
  },

  franjaHoraria: {
    type: Number,
    min: 0,
    max: 23,
    default: function() {
      if (this.hora) {
        return parseInt(this.hora.split(':')[0]);
      }
      return null;
    },
    index: true
  },

  // Ubicación del accidente
  ubicacion: {
    calle: {
      type: String,
      required: [true, 'Calle del accidente obligatoria'],
      trim: true,
      maxlength: [300, 'Calle no puede exceder 300 caracteres'],
      index: true
    },

    numero: {
      type: String,
      required: false,
      trim: true,
      maxlength: [10, 'Número no puede exceder 10 caracteres']
    },

    // Información del distrito
    codigoDistrito: {
      type: String,
      required: [true, 'Código de distrito obligatorio'],
      trim: true,
      index: true
    },

    nombreDistrito: {
      type: String,
      required: [true, 'Nombre de distrito obligatorio'],
      trim: true,
      uppercase: true,
      index: true
    },

    // Coordenadas geográficas
    coordenadas: {
      type: coordinatesSchema,
      required: false
    }
  },

  // Circunstancias del accidente
  circunstancias: {
    tipoAccidente: {
      type: String,
      required: [true, 'Tipo de accidente obligatorio'],
      trim: true,
      enum: {
        values: [
          'COLISION_DOBLE',
          'COLISION_MULTIPLE',
          'ALCANCE',
          'CHOQUE_OBSTACULO',
          'CHOQUE_OBSTACULO_FIJO',
          'ATROPELLO_PERSONA',
          'VUELCO',
          'CAIDA',
          'COLISION_FRONTO_LATERAL',
          'OTRAS_CAUSAS'
        ],
        message: 'Tipo de accidente no válido'
      },
      index: true,
      default: function() {
        // Normalizar texto original a enum
        const original = this.circunstancias && this.circunstancias.tipoAccidenteOriginal;
        if (!original) {return 'OTRAS_CAUSAS';}

        const lower = original.toLowerCase();
        if (lower.includes('colisión doble')) {return 'COLISION_DOBLE';}
        if (lower.includes('colisión múltiple')) {return 'COLISION_MULTIPLE';}
        if (lower.includes('alcance')) {return 'ALCANCE';}
        if (lower.includes('choque contra obstáculo fijo')) {return 'CHOQUE_OBSTACULO_FIJO';}
        if (lower.includes('choque contra obstáculo')) {return 'CHOQUE_OBSTACULO';}
        if (lower.includes('atropello')) {return 'ATROPELLO_PERSONA';}
        if (lower.includes('vuelco')) {return 'VUELCO';}
        if (lower.includes('caída')) {return 'CAIDA';}
        if (lower.includes('fronto-lateral')) {return 'COLISION_FRONTO_LATERAL';}
        return 'OTRAS_CAUSAS';
      }
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
      enum: {
        values: [
          'DESPEJADO',
          'NUBLADO',
          'LLUVIA_LIGERA',
          'LLUVIA_INTENSA',
          'NIEBLA',
          'VIENTO_FUERTE',
          'GRANIZO',
          'NIEVE',
          'DESCONOCIDO',
          'NULL'
        ],
        message: 'Estado meteorológico no válido'
      },
      uppercase: true,
      default: 'DESCONOCIDO'
    },

    // Gravedad del accidente (calculada automáticamente)
    gravedad: {
      type: String,
      enum: ['LEVE', 'GRAVE', 'MORTAL', 'SIN_LESIONES'],
      default: 'LEVE',
      index: true
    }
  },

  // Vehículo involucrado
  vehiculo: {
    tipo: {
      type: String,
      required: [true, 'Tipo de vehículo obligatorio'],
      trim: true,
      enum: {
        values: [
          'TURISMO',
          'MOTOCICLETA',
          'CICLOMOTOR',
          'BICICLETA',
          'AUTOBUS',
          'CAMION',
          'FURGONETA',
          'TAXI',
          'AMBULANCIA',
          'OTROS'
        ],
        message: 'Tipo de vehículo no válido'
      },
      uppercase: true,
      index: true,
      default: function() {
        const original = this.vehiculo && this.vehiculo.tipoVehiculoOriginal;
        if (!original) {return 'OTROS';}

        const lower = original.toLowerCase();
        if (lower.includes('turismo')) {return 'TURISMO';}
        if (lower.includes('motocicleta')) {return 'MOTOCICLETA';}
        if (lower.includes('ciclomotor')) {return 'CICLOMOTOR';}
        if (lower.includes('bicicleta')) {return 'BICICLETA';}
        if (lower.includes('autobús') || lower.includes('autobus')) {return 'AUTOBUS';}
        if (lower.includes('camión') || lower.includes('camion')) {return 'CAMION';}
        if (lower.includes('furgoneta')) {return 'FURGONETA';}
        if (lower.includes('taxi')) {return 'TAXI';}
        if (lower.includes('ambulancia')) {return 'AMBULANCIA';}
        return 'OTROS';
      }
    },

    tipoVehiculoOriginal: {
      type: String,
      required: false
    }
  },

  // Persona afectada (cada registro representa una persona)
  personaAfectada: {
    type: personaAfectadaSchema,
    required: [true, 'Información de la persona afectada obligatoria']
  },

  // Análisis automático
  analisis: {
    // Periodo del día
    periodoDia: {
      type: String,
      enum: ['MADRUGADA', 'MAÑANA', 'MEDIODIA', 'TARDE', 'NOCHE'],
      default: function() {
        const hora = this.franjaHoraria;
        if (hora !== null && hora !== undefined) {
          if (hora >= 0 && hora < 6) {return 'MADRUGADA';}
          if (hora >= 6 && hora < 12) {return 'MAÑANA';}
          if (hora >= 12 && hora < 15) {return 'MEDIODIA';}
          if (hora >= 15 && hora < 21) {return 'TARDE';}
          return 'NOCHE';
        }
        return 'MAÑANA';
      },
      index: true
    },

    // Día de la semana
    diaSemana: {
      type: Number,
      min: 0,
      max: 6,
      default: function() {
        return this.fecha ? this.fecha.getDay() : null;
      }
    },

    tipoJornada: {
      type: String,
      enum: ['LABORABLE', 'SABADO', 'DOMINGO_FESTIVO'],
      default: function() {
        const dayOfWeek = this.analisis && this.analisis.diaSemana;
        if (dayOfWeek === 0) {return 'DOMINGO_FESTIVO';}
        if (dayOfWeek === 6) {return 'SABADO';}
        return 'LABORABLE';
      },
      index: true
    },

    // Factores de riesgo
    factoresRiesgo: [{
      type: String,
      enum: [
        'ALCOHOL',
        'DROGAS',
        'VELOCIDAD_INADECUADA',
        'CONDICIONES_METEOROLOGICAS',
        'HORA_MADRUGADA',
        'VEHICULO_DOS_RUEDAS',
        'ZONA_ACCIDENTES_FRECUENTES'
      ]
    }],

    // Puntuación de gravedad (0-10)
    puntuacionGravedad: {
      type: Number,
      min: 0,
      max: 10,
      default: function() {
        let puntos = 0;

        // Puntos por tipo de lesión
        const persona = this.personaAfectada;
        if (persona && persona.tipoLesion === 'FALLECIDO') {puntos += 10;}
        else if (persona && persona.tipoLesion === 'GRAVE') {puntos += 7;}
        else if (persona && persona.tipoLesion === 'LEVE') {puntos += 3;}

        // Puntos por tipo de accidente
        const circs = this.circunstancias;
        if (circs && circs.tipoAccidente === 'ATROPELLO_PERSONA') {puntos += 3;}
        if (circs && circs.tipoAccidente === 'COLISION_MULTIPLE') {puntos += 2;}

        // Puntos por sustancias
        if (persona && persona.positivaAlcohol === 'S') {puntos += 2;}
        if (persona && persona.positivaDroga === 'S') {puntos += 2;}

        return Math.min(puntos, 10);
      }
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

// Índice principal para consultas por expediente
accidentSchema.index({ numeroExpediente: 1, fecha: -1 });

// Índices temporales
accidentSchema.index({ fecha: -1, 'ubicacion.nombreDistrito': 1 });
accidentSchema.index({ año: 1, mes: 1, dia: 1 });
accidentSchema.index({ franjaHoraria: 1, fecha: -1 });

// Índices por ubicación
accidentSchema.index({ 'ubicacion.calle': 1, fecha: -1 });
accidentSchema.index({ 'ubicacion.nombreDistrito': 1, fecha: -1 });
accidentSchema.index({ 'ubicacion.coordenadas.x': 1, 'ubicacion.coordenadas.y': 1 });

// Índices por circunstancias
accidentSchema.index({ 'circunstancias.tipoAccidente': 1, fecha: -1 });
accidentSchema.index({ 'circunstancias.gravedad': 1, fecha: -1 });
accidentSchema.index({ 'vehiculo.tipo': 1, fecha: -1 });

// Índices por persona afectada
accidentSchema.index({ 'personaAfectada.tipoPersona': 1, fecha: -1 });
accidentSchema.index({ 'personaAfectada.tipoLesion': 1, fecha: -1 });

// Índices compuestos para análisis avanzados
accidentSchema.index({
  'analisis.periodoDia': 1,
  'analisis.tipoJornada': 1,
  fecha: -1
});

accidentSchema.index({
  'circunstancias.tipoAccidente': 1,
  'personaAfectada.tipoLesion': 1,
  fecha: -1
});

// Índice de texto completo
accidentSchema.index({
  'ubicacion.calle': 'text',
  'ubicacion.nombreDistrito': 'text',
  'circunstancias.tipoAccidente': 'text'
});

// Índice compuesto fecha + distrito (consultas filtradas por distrito)
// Usado en: GET /api/accidents?distrito=X&fecha=Y
accidentSchema.index({ fecha: 1, 'ubicacion.nombreDistrito': 1 }, {
  name: 'idx_accidents_fecha_distrito_smartcity',
  background: true
});

// Índice geoespacial 2dsphere para consultas de proximidad y mapas de calor
// Usado en: heatmaps, búsquedas por radio, análisis geográfico
accidentSchema.index({ 'ubicacion.coordenadas': '2dsphere' }, {
  name: 'idx_accidents_geo_heatmap',
  background: true,
  sparse: true // Solo documentos con coordenadas
});

// Índice compuesto tipoAccidente + gravedad (análisis de peligrosidad)
// Usado en: estadísticas de gravedad por tipo, filtros combinados
accidentSchema.index({ 'circunstancias.tipoAccidente': 1, 'circunstancias.gravedad': 1 }, {
  name: 'idx_accidents_tipo_gravedad_analysis',
  background: true
});

// Índice compuesto fecha DESC + tipo + gravedad (listados ordenados filtrados)
// Usado en: GET /api/accidents (ordenados por fecha reciente con filtros)
accidentSchema.index({ fecha: -1, 'circunstancias.tipoAccidente': 1, 'circunstancias.gravedad': 1 }, {
  name: 'idx_accidents_timeline_severity',
  background: true
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
    this.franjaHoraria = parseInt(this.hora.split(':')[0]);
  }

  // Calcular gravedad automáticamente
  this.calcularGravedad();

  // Identificar factores de riesgo
  this.identificarFactoresRiesgo();

  next();
});

/**
 * Métodos de instancia
 */

/**
 * Calcular gravedad del accidente
 */
accidentSchema.methods.calcularGravedad = function() {
  const tipoLesion = this.personaAfectada.tipoLesion;

  if (tipoLesion === 'FALLECIDO') {
    this.circunstancias.gravedad = 'MORTAL';
  } else if (tipoLesion === 'GRAVE') {
    this.circunstancias.gravedad = 'GRAVE';
  } else if (tipoLesion === 'SIN_ASISTENCIA') {
    this.circunstancias.gravedad = 'SIN_LESIONES';
  } else {
    this.circunstancias.gravedad = 'LEVE';
  }
};

/**
 * Identificar factores de riesgo
 */
accidentSchema.methods.identificarFactoresRiesgo = function() {
  const factores = [];

  // Alcohol y drogas
  if (this.personaAfectada.positivaAlcohol === 'S') {
    factores.push('ALCOHOL');
  }
  if (this.personaAfectada.positivaDroga === 'S') {
    factores.push('DROGAS');
  }

  // Condiciones meteorológicas adversas
  if (['LLUVIA_INTENSA', 'NIEBLA', 'GRANIZO', 'NIEVE'].includes(this.circunstancias.estadoMeteorologico)) {
    factores.push('CONDICIONES_METEOROLOGICAS');
  }

  // Hora de madrugada (mayor riesgo)
  if (this.franjaHoraria >= 0 && this.franjaHoraria < 6) {
    factores.push('HORA_MADRUGADA');
  }

  // Vehículos de dos ruedas (mayor vulnerabilidad)
  if (['MOTOCICLETA', 'CICLOMOTOR', 'BICICLETA'].includes(this.vehiculo.tipo)) {
    factores.push('VEHICULO_DOS_RUEDAS');
  }

  this.analisis.factoresRiesgo = factores;
};

/**
 * Verificar si el accidente es grave
 */
accidentSchema.methods.esGrave = function() {
  return ['GRAVE', 'MORTAL'].includes(this.circunstancias.gravedad);
};

/**
 * Métodos estáticos para consultas agregadas
 */

/**
 * Obtener estadísticas por periodo
 */
accidentSchema.statics.getStatisticsByPeriod = function(startDate, endDate) {
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
            $cond: [{ $in: ['$circunstancias.gravedad', ['GRAVE', 'MORTAL']] }, 1, 0]
          }
        },
        accidentesMortales: {
          $sum: {
            $cond: [{ $eq: ['$circunstancias.gravedad', 'MORTAL'] }, 1, 0]
          }
        },
        atropellos: {
          $sum: {
            $cond: [{ $eq: ['$circunstancias.tipoAccidente', 'ATROPELLO_PERSONA'] }, 1, 0]
          }
        },
        accidentesConAlcohol: {
          $sum: {
            $cond: [{ $eq: ['$personaAfectada.positivaAlcohol', 'S'] }, 1, 0]
          }
        }
      }
    }
  ]);
};

/**
 * Obtener puntos negros de accidentes
 */
accidentSchema.statics.getAccidentBlackSpots = function(limit = 10, startDate = null, endDate = null) {
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
            $cond: [{ $in: ['$circunstancias.gravedad', ['GRAVE', 'MORTAL']] }, 1, 0]
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
  ]);
};

/**
 * Obtener análisis por tipo de vehículo
 */
accidentSchema.statics.getVehicleTypeAnalysis = function(startDate = null, endDate = null) {
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
            $cond: [{ $in: ['$circunstancias.gravedad', ['GRAVE', 'MORTAL']] }, 1, 0]
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
  ]);
};

/**
 * Obtener patrones temporales
 */
accidentSchema.statics.getTemporalPatterns = function(groupBy = 'hora') {
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
            $cond: [{ $in: ['$circunstancias.gravedad', ['GRAVE', 'MORTAL']] }, 1, 0]
          }
        }
      }
    },
    { $sort: { _id: 1 } }
  ]);
};

/**
 * Obtener comparativa completa entre distritos con todos los indicadores
 * @param {Object} filters - Filtros de consulta
 * @returns {Promise<Array>} Comparativa de distritos con métricas y porcentajes
 */
accidentSchema.statics.getDistrictComparisonData = function(filters = {}) {
  return this.aggregate([
    { $match: filters },
    {
      $group: {
        _id: '$ubicacion.nombreDistrito',
        totalAccidentes: { $sum: 1 },
        accidentesGraves: {
          $sum: {
            $cond: [{ $in: ['$circunstancias.gravedad', ['GRAVE', 'MORTAL']] }, 1, 0]
          }
        },
        accidentesMortales: {
          $sum: {
            $cond: [{ $eq: ['$circunstancias.gravedad', 'MORTAL'] }, 1, 0]
          }
        },
        atropellos: {
          $sum: {
            $cond: [{ $eq: ['$circunstancias.tipoAccidente', 'ATROPELLO_PERSONA'] }, 1, 0]
          }
        },
        accidentesAlcohol: {
          $sum: {
            $cond: [{ $eq: ['$personaAfectada.positivaAlcohol', 'S'] }, 1, 0]
          }
        },
        puntuacionGravedadPromedio: { $avg: '$analisis.puntuacionGravedad' },
        turismos: {
          $sum: {
            $cond: [{ $eq: ['$vehiculo.tipo', 'TURISMO'] }, 1, 0]
          }
        },
        motocicletas: {
          $sum: {
            $cond: [{ $eq: ['$vehiculo.tipo', 'MOTOCICLETA'] }, 1, 0]
          }
        },
        bicicletas: {
          $sum: {
            $cond: [{ $eq: ['$vehiculo.tipo', 'BICICLETA'] }, 1, 0]
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
  ]);
};

/**
 * Obtener análisis de seguridad por calle con índice de riesgo calculado
 * @param {Object} filters - Filtros de consulta
 * @param {Number} limit - Límite de calles a retornar
 * @returns {Promise<Array>} Calles ordenadas por índice de riesgo
 */
accidentSchema.statics.getStreetSafetyAnalysis = function(filters = {}, limit = 20) {
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
            $cond: [{ $in: ['$circunstancias.gravedad', ['GRAVE', 'MORTAL']] }, 1, 0]
          }
        },
        atropellos: {
          $sum: {
            $cond: [{ $eq: ['$circunstancias.tipoAccidente', 'ATROPELLO_PERSONA'] }, 1, 0]
          }
        },
        accidentesAlcohol: {
          $sum: {
            $cond: [{ $eq: ['$personaAfectada.positivaAlcohol', 'S'] }, 1, 0]
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
  ]);
};

/**
 * Obtener análisis temporal de tendencias por año y mes
 * @param {Object} filters - Filtros de consulta
 * @returns {Promise<Array>} Tendencias ordenadas cronológicamente
 */
accidentSchema.statics.getTrendAnalysis = function(filters = {}) {
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
            $cond: [{ $in: ['$circunstancias.gravedad', ['GRAVE', 'MORTAL']] }, 1, 0]
          }
        }
      }
    },
    { $sort: { '_id.año': 1, '_id.mes': 1 } }
  ]);
};

/**
 * Obtener correlación entre condiciones meteorológicas y accidentes
 * @param {Object} filters - Filtros de consulta
 * @returns {Promise<Array>} Estadísticas por condición meteorológica
 */
accidentSchema.statics.getWeatherCorrelation = function(filters = {}) {
  return this.aggregate([
    { $match: filters },
    {
      $group: {
        _id: '$circunstancias.estadoMeteorologico',
        totalAccidentes: { $sum: 1 },
        accidentesGraves: {
          $sum: {
            $cond: [{ $in: ['$circunstancias.gravedad', ['GRAVE', 'MORTAL']] }, 1, 0]
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
  ]);
};

/**
 * Obtener distribución de accidentes por distrito con métricas de gravedad
 * @param {Object} filters - Filtros de consulta
 * @param {Number} limit - Límite de distritos a retornar
 * @returns {Promise<Array>} Distribución por distrito ordenada por total de accidentes
 */
accidentSchema.statics.getDistrictDistribution = function(filters = {}, limit = 15) {
  return this.aggregate([
    { $match: filters },
    {
      $group: {
        _id: '$ubicacion.nombreDistrito',
        totalAccidentes: { $sum: 1 },
        accidentesGraves: {
          $sum: {
            $cond: [{ $in: ['$circunstancias.gravedad', ['GRAVE', 'MORTAL']] }, 1, 0]
          }
        },
        puntuacionGravedadPromedio: { $avg: '$analisis.puntuacionGravedad' }
      }
    },
    { $sort: { totalAccidentes: -1 } },
    { $limit: limit }
  ]);
};

/**
 * Obtener análisis de factores de riesgo más frecuentes
 * @param {Object} filters - Filtros de consulta
 * @returns {Promise<Array>} Factores de riesgo ordenados por frecuencia
 */
accidentSchema.statics.getRiskFactorsAnalysis = function(filters = {}) {
  return this.aggregate([
    { $match: filters },
    { $unwind: '$analisis.factoresRiesgo' },
    {
      $group: {
        _id: '$analisis.factoresRiesgo',
        cantidad: { $sum: 1 }
      }
    },
    { $sort: { cantidad: -1 } }
  ]);
};

/**
 * Obtener datos optimizados para mapa de calor de accidentes
 * Agrupa puntos cercanos para reducir ruido visual en el mapa
 * @param {Object} filters - Filtros de consulta (fecha, gravedad, etc.)
 * @param {Number} limite - Máximo número de accidentes a procesar
 * @param {Number} precision - Distancia en metros para agrupar puntos (default: 100m)
 * @returns {Promise<Object>} Datos del heatmap con puntos agrupados y estadísticas
 */
accidentSchema.statics.getHeatmapDataOptimized = async function(filters = {}, limite = 500, precision = 100) {
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
    .limit(parseInt(limite))
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

    if (['GRAVE', 'MORTAL'].includes(accident.circunstancias.gravedad)) {
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
const Accident = mongoose.model('Accidents', accidentSchema);

module.exports = Accident;
