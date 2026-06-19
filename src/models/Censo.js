/**
 * Modelo de Censo
 *
 * Esquema de Mongoose para almacenar y gestionar datos demográficos del censo
 * municipal. Incluye información poblacional por distritos, barrios, secciones
 * censales y grupos de edad, diferenciando entre población española y extranjera.
 */

const mongoose = require('mongoose');
const { validateMonth, validateYear, validateDatasetDate } = require('./schemas/commonSchemas');
const {
  WORKING_AGE,
  ELDERLY_AGE,
  AGE_GROUPS,
  AGE_RANGES,
  POPULATION_DENSITY_LEVELS,
  CULTURAL_DIVERSITY_LEVELS,
  CULTURAL_DIVERSITY_THRESHOLDS,
  CENSUS_FIELD_TYPES,
  DATASET_YEARS,
  VALIDATION_LIMITS
} = require('../constants');

/**
 * Sub-esquema para datos poblacionales por género
 */
const populationDataSchema = new mongoose.Schema({
  españoles: {
    hombres: {
      type: Number,
      required: true,
      min: [VALIDATION_LIMITS.QUANTITY_MIN, 'Población de hombres españoles no puede ser negativa']
    },
    mujeres: {
      type: Number,
      required: true,
      min: [VALIDATION_LIMITS.QUANTITY_MIN, 'Población de mujeres españolas no puede ser negativa']
    }
  },
  extranjeros: {
    hombres: {
      type: Number,
      required: true,
      min: [VALIDATION_LIMITS.QUANTITY_MIN, 'Población de hombres extranjeros no puede ser negativa']
    },
    mujeres: {
      type: Number,
      required: true,
      min: [VALIDATION_LIMITS.QUANTITY_MIN, 'Población de mujeres extranjeras no puede ser negativa']
    }
  }
}, { _id: false });

/**
 * Esquema principal de Censo
 *
 * Basado en la estructura de los CSV de censo:
 * - COD_DISTRITO: código del distrito municipal
 * - DESC_DISTRITO: descripción del distrito
 * - COD_DIST_BARRIO: código distrito-barrio
 * - DESC_BARRIO: descripción del barrio
 * - COD_BARRIO: código de barrio
 * - COD_DIST_SECCION: código distrito-sección
 * - COD_SECCION: código de sección
 * - COD_EDAD_INT: edad simple del grupo poblacional
 * - EspanolesHombres, EspanolesMujeres, ExtranjerosHombres, ExtranjerosMujeres
 */
const censusSchema = new mongoose.Schema({
  // NOTA: `index: true` removido en single-fields cuyos compuestos posteriores
  // ya cubren el patron de query (ver docs/optimizations_2026-05-26.md).
  // Mongoose ya no recreara los indices fechaCenso_1, mes_1, año_1,
  // distrito.codigo_1, distrito.descripcion_1, barrio.codigoDistritoBarrio_1,
  // barrio.codigo_1, barrio.descripcion_1, seccionCensal.codigoDistritoSeccion_1,
  // seccionCensal.codigo_1, edad_1, estadisticas.totalPoblacion_1 al arrancar.
  // Información temporal
  fechaCenso: {
    type: Date,
    required: true,
    validate: {
      validator: validateDatasetDate,
      message: `La fecha del censo debe estar dentro del rango del dataset (${DATASET_YEARS.MIN_YEAR}-${DATASET_YEARS.MAX_YEAR})`
    }
  },

  mes: {
    type: Number,
    required: true,
    validate: {
      validator: validateMonth,
      message: 'Mes debe estar entre 1 y 12'
    }
  },

  año: {
    type: Number,
    required: true,
    validate: {
      validator: validateYear,
      message: `Año debe estar entre ${VALIDATION_LIMITS.YEAR_MIN} y ${VALIDATION_LIMITS.YEAR_MAX}`
    }
  },

  // Identificación geográfica administrativa
  distrito: {
    codigo: {
      type: Number,
      required: true,
      min: [1, 'Código de distrito debe ser positivo']
    },
    descripcion: {
      type: String,
      required: true,
      trim: true,
      uppercase: true
    }
  },

  barrio: {
    codigoDistritoBarrio: {
      type: Number,
      required: true,
      min: [1, 'Código distrito-barrio debe ser positivo']
    },
    codigo: {
      type: Number,
      required: true,
      min: [1, 'Código de barrio debe ser positivo']
    },
    descripcion: {
      type: String,
      required: true,
      trim: true,
      uppercase: true
    }
  },

  seccionCensal: {
    codigoDistritoSeccion: {
      type: Number,
      required: true,
      min: [1, 'Código distrito-sección debe ser positivo']
    },
    codigo: {
      type: Number,
      required: true,
      min: [1, 'Código de sección inválido']
    }
  },

  // Información demográfica
  edad: {
    type: Number,
    required: [true, 'Edad obligatoria'],
    validate: {
      validator: function(v) {
        // Validar rango 0-120 para datos censales reales
        return Number.isInteger(v) && v >= 0 && v <= 120;
      },
      message: 'Edad debe estar entre 0 y 120 años'
    }
  },

  // Datos poblacionales
  poblacion: {
    type: populationDataSchema,
    required: [true, 'Datos de población obligatorios'],
    validate: {
      validator: function(v) {
        // Validar coherencia: al menos debe haber población > 0
        const total = v.españoles.hombres + v.españoles.mujeres + v.extranjeros.hombres + v.extranjeros.mujeres;
        return total >= 0;
      },
      message: 'Los datos de población deben sumar al menos 0'
    }
  },

  // Estadísticas calculadas automáticamente
  estadisticas: {
    totalEspañoles: {
      type: Number,
      min: [VALIDATION_LIMITS.QUANTITY_MIN, 'Total españoles no puede ser negativo'],
      validate: {
        validator: function(v) {
          // Coherencia: debe coincidir con la suma de españoles hombres + mujeres
          if (!this.poblacion) {return true;}
          const suma = this.poblacion.españoles.hombres + this.poblacion.españoles.mujeres;
          return Math.abs(v - suma) < 0.01; // Tolerancia para decimales
        },
        message: 'totalEspañoles debe coincidir con suma de hombres y mujeres españoles'
      }
    },
    totalExtranjeros: {
      type: Number,
      min: [VALIDATION_LIMITS.QUANTITY_MIN, 'Total extranjeros no puede ser negativo'],
      validate: {
        validator: function(v) {
          // Coherencia: debe coincidir con la suma de extranjeros hombres + mujeres
          if (!this.poblacion) {return true;}
          const suma = this.poblacion.extranjeros.hombres + this.poblacion.extranjeros.mujeres;
          return Math.abs(v - suma) < 0.01;
        },
        message: 'totalExtranjeros debe coincidir con suma de hombres y mujeres extranjeros'
      }
    },
    totalHombres: {
      type: Number,
      min: [VALIDATION_LIMITS.QUANTITY_MIN, 'Total hombres no puede ser negativo']
    },
    totalMujeres: {
      type: Number,
      min: [VALIDATION_LIMITS.QUANTITY_MIN, 'Total mujeres no puede ser negativo']
    },
    totalPoblacion: {
      type: Number,
      min: [VALIDATION_LIMITS.QUANTITY_MIN, 'Total población no puede ser negativo'],
      validate: {
        validator: function(v) {
          // Coherencia: debe coincidir con totalEspañoles + totalExtranjeros
          if (!this.estadisticas.totalEspañoles || !this.estadisticas.totalExtranjeros) {return true;}
          const suma = this.estadisticas.totalEspañoles + this.estadisticas.totalExtranjeros;
          return Math.abs(v - suma) < 0.01;
        },
        message: 'totalPoblacion debe coincidir con suma de españoles y extranjeros'
      }
    },
    porcentajeExtranjeros: {
      type: Number,
      min: [VALIDATION_LIMITS.PERCENTAGE_MIN, 'Porcentaje de extranjeros no puede ser negativo'],
      max: [VALIDATION_LIMITS.PERCENTAGE_MAX, 'Porcentaje de extranjeros no puede exceder 100%']
    },
    ratioGenero: {
      type: Number,
      min: [VALIDATION_LIMITS.RATIO_MIN, 'Ratio de género no puede ser negativo']
    }
  },

  // Clasificación por grupos de edad
  clasificacionEdad: {
    grupoEdad: {
      type: String,
      enum: Object.values(AGE_GROUPS),
      default: AGE_GROUPS.ADULTO_JOVEN
    },
    esGrupoProductivo: {
      type: Boolean,
      default: false
    },
    esTerceraEdad: {
      type: Boolean,
      default: false
    }
  },

  // Metadatos y calidad de datos
  metadatos: {
    // densidadPoblacional clasifica la cantidad de habitantes en este
    // segmento (edad x seccion censal x mes). Antes el default era fijo
    // (CULTURAL_DIVERSITY_LEVELS.MEDIA -- ademas con enum equivocado) y
    // todos los 2.85 M docs acababan como "MEDIA", convirtiendo el campo
    // en ruido. Ahora el default function clasifica por `totalPoblacion`:
    //   >50 MUY_ALTA, >20 ALTA, >5 MEDIA, resto BAJA.
    //
    // Los umbrales son intencionalmente bajos porque cada doc representa
    // UN tramo de edad concreto en UNA seccion censal, no el barrio entero.
    densidadPoblacional: {
      type: String,
      enum: Object.values(POPULATION_DENSITY_LEVELS),
      default: function() {
        const total = this.estadisticas?.totalPoblacion || 0;
        if (total > 50) {return POPULATION_DENSITY_LEVELS.MUY_ALTA;}
        if (total > 20) {return POPULATION_DENSITY_LEVELS.ALTA;}
        if (total > 5) {return POPULATION_DENSITY_LEVELS.MEDIA;}
        return POPULATION_DENSITY_LEVELS.BAJA;
      }
    },
    diversidadCultural: {
      type: String,
      enum: Object.values(CULTURAL_DIVERSITY_LEVELS),
      default: function() {
        if (this.estadisticas.porcentajeExtranjeros > CULTURAL_DIVERSITY_THRESHOLDS.HIGH) {return CULTURAL_DIVERSITY_LEVELS.ALTA;}
        if (this.estadisticas.porcentajeExtranjeros > CULTURAL_DIVERSITY_THRESHOLDS.MEDIUM) {return CULTURAL_DIVERSITY_LEVELS.MEDIA;}
        return CULTURAL_DIVERSITY_LEVELS.BAJA;
      }
    },
    calidadDatos: {
      esCompleto: {
        type: Boolean,
        default: true
      },
      camposFaltantes: [{
        type: String,
        enum: Object.values(CENSUS_FIELD_TYPES)
      }],
      puntuacionCalidad: {
        type: Number,
        min: [VALIDATION_LIMITS.SCORE_MIN, 'Puntuación no puede ser negativa'],
        max: [VALIDATION_LIMITS.SCORE_MAX, 'Puntuación no puede exceder 1'],
        default: 1
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
    versionDatos: {
      type: String,
      default: '1.0'
    }
  }

}, {
  timestamps: true,
  versionKey: false,
  collection: 'censuses'
});

/**
 * Índices para optimización de consultas
 */

// ========================================
// ÍNDICE ÚNICO - Prevención de duplicados
// ========================================
// Garantiza que no existan registros duplicados para la misma combinación de:
// distrito + barrio + sección censal + edad + año + mes
// Usado en: Scripts de importación para prevenir duplicados
// CRÍTICO: NO ELIMINAR
censusSchema.index(
  {
    'distrito.codigo': 1,
    'barrio.codigo': 1,
    'seccionCensal.codigo': 1,
    edad: 1,
    año: 1,
    mes: 1
  },
  { unique: true, name: 'unique_census_record' }
);

// ========================================
// ÍNDICES PRINCIPALES - Consultas frecuentes
// ========================================

// Índice compuesto: distrito + fecha
// Usado en: controladorCenso.js:64-69 - GET /api/census?distrito=X&startDate=Y&endDate=Z
// Filtros: distrito.codigo + fechaCenso (rango de fechas)
// Soporta: Estadísticas por distrito en período temporal
censusSchema.index(
  { 'distrito.codigo': 1, fechaCenso: 1 },
  {
    name: 'idx_census_district_date'
  }
);

// Índice compuesto: distrito + edad
// Usado en: controladorCenso.js:263 - getPiramidePoblacionalOptimizada()
// Usado en: controladorCenso.js:82-84 - Filtros minEdad, maxEdad
// Soporta: Pirámides poblacionales, análisis demográfico por edad
censusSchema.index(
  { 'distrito.codigo': 1, edad: 1 },
  {
    name: 'idx_census_district_age'
  }
);

// Índice para análisis de diversidad cultural (porcentaje extranjeros)
// Usado en: Agregaciones de estadísticas de inmigración
// Soporta: Ranking de barrios/distritos por diversidad
censusSchema.index(
  { fechaCenso: 1, 'estadisticas.porcentajeExtranjeros': -1 },
  {
    name: 'idx_census_foreign_population'
  }
);

// ========================================
// ÍNDICES PARA AGREGACIONES COMPLEJAS
// ========================================

// Índice compuesto para pirámide poblacional completa
// Usado en: Censo.getPiramidePoblacionalOptimizada() (línea 715)
// Soporta: $group por grupoEdad + distrito, sort por edad
censusSchema.index(
  {
    fechaCenso: 1,
    'distrito.codigo': 1,
    edad: 1,
    'clasificacionEdad.grupoEdad': 1
  },
  {
    name: 'idx_census_population_pyramid'
  }
);

// Índice para consultas temporales por año y mes
// Usado en: controladorCenso.js:312 - getEstadisticasDistrito (agregaciones por período)
// Filtros implícitos: año, mes, distrito.codigo
censusSchema.index(
  { año: 1, mes: 1, 'distrito.codigo': 1 },
  {
    name: 'idx_census_temporal_district'
  }
);

// Índice para ranking de población (descendente)
// Usado en: controladorCenso.js:732 - GET /api/census/dashboard
// Usado en: controladorCenso.js:85-86 - Filtros minPoblacion, maxPoblacion
// Soporta: Identificación de áreas más/menos pobladas, sorts por totalPoblacion
censusSchema.index(
  { 'estadisticas.totalPoblacion': -1, fechaCenso: -1 },
  {
    name: 'idx_census_population_ranking'
  }
);

// Índice para el sort por defecto del listado GET /censo (sortBy=fechaCenso) SIN
// filtro selectivo. Sin este indice, find({}).sort({fechaCenso:-1,_id:-1}) hacia
// COLLSCAN + SORT en memoria sobre ~2,85M docs (~2,8s). Con el, es un index scan
// top-K. El tiebreak por _id estabiliza la paginacion por cursor.
censusSchema.index(
  { fechaCenso: -1, _id: -1 },
  {
    name: 'idx_census_fecha_listado'
  }
);

// ========================================
// ÍNDICES PARA FILTROS ESPECÍFICOS
// ========================================

// Índice para análisis de grupos de edad específicos
// Usado en: controladorCenso.js:76 - Filtro grupoEdad
// Soporta: Consultas por rango de edad ('0-18', '19-64', '65+')
censusSchema.index(
  { 'clasificacionEdad.grupoEdad': 1, fechaCenso: -1 },
  {
    name: 'idx_census_age_group_timeline'
  }
);

// Índice para análisis de población productiva (19-64 años)
// Usado en: controladorCenso.js:90 - Filtro soloProductivos=true
// Soporta: Indicadores económicos, análisis de fuerza laboral
censusSchema.index(
  { 'clasificacionEdad.esGrupoProductivo': 1, fechaCenso: -1 },
  {
    name: 'idx_census_working_age'
  }
);

// Índice para análisis de tercera edad (65+ años)
// Usado en: controladorCenso.js:94 - Filtro soloTerceraEdad=true
// Soporta: Planificación de servicios sociales, análisis de envejecimiento
censusSchema.index(
  { 'clasificacionEdad.esTerceraEdad': 1, fechaCenso: -1 },
  {
    name: 'idx_census_elderly'
  }
);

// ========================================
// ÍNDICES SECUNDARIOS - Nivel barrio
// ========================================

// Índice compuesto para análisis detallado por barrio
// Usado en: controladorCenso.js:393 - Agregaciones por barrio
// Usado en: controladorCenso.js:74-75 - Filtro barrio.codigo
// Soporta: Estadísticas detalladas a nivel de barrio + edad
censusSchema.index(
  {
    'barrio.codigo': 1,
    fechaCenso: 1,
    edad: 1
  },
  {
    name: 'idx_census_neighborhood_demographics'
  }
);

// ========================================
// ÍNDICES DE BÚSQUEDA TEXTUAL
// ========================================

// Índice para búsqueda por nombre de distrito y barrio (exacta)
// Usado en: Búsquedas administrativas por nombre
// Soporta: Autocompletado, búsqueda por nombre de ubicación
censusSchema.index(
  { 'distrito.descripcion': 1, 'barrio.descripcion': 1 },
  {
    name: 'idx_census_geographic_names'
  }
);

// Índice de texto completo para búsqueda textual flexible
// Usado en: Búsquedas con $text (si se implementa en futuro)
// Pesos: distrito (10) tiene más relevancia que barrio (5)
censusSchema.index(
  {
    'distrito.descripcion': 'text',
    'barrio.descripcion': 'text'
  },
  {
    name: 'idx_census_text_search',
    weights: {
      'distrito.descripcion': 10,
      'barrio.descripcion': 5
    }
  }
);

/**
 * Middleware pre-save para cálculos automáticos
 */
censusSchema.pre('save', function(next) {
  // Crear fecha completa si no existe
  if (!this.fechaCenso && this.mes && this.año) {
    this.fechaCenso = new Date(this.año, this.mes - 1, 1);
  }

  // Inicializar objetos si no existen
  if (!this.estadisticas) {
    this.estadisticas = {};
  }
  if (!this.clasificacionEdad) {
    this.clasificacionEdad = {};
  }
  if (!this.metadatos) {
    this.metadatos = { calidadDatos: {} };
  }

  // Clasificar grupo de edad ANTES de calcular otras estadísticas
  this.classifyAgeGroup();

  // Calcular estadísticas poblacionales
  this.calculateStatistics();

  // Evaluar calidad de datos
  this.evaluateDataQuality();

  next();
});

/**
 * Método para calcular estadísticas poblacionales automáticamente
 */
censusSchema.methods.calculateStatistics = function() {
  const pob = this.poblacion;

  // Totales por nacionalidad
  this.estadisticas.totalEspañoles = pob.españoles.hombres + pob.españoles.mujeres;
  this.estadisticas.totalExtranjeros = pob.extranjeros.hombres + pob.extranjeros.mujeres;

  // Totales por género
  this.estadisticas.totalHombres = pob.españoles.hombres + pob.extranjeros.hombres;
  this.estadisticas.totalMujeres = pob.españoles.mujeres + pob.extranjeros.mujeres;

  // Total general
  this.estadisticas.totalPoblacion = this.estadisticas.totalEspañoles + this.estadisticas.totalExtranjeros;

  // Porcentajes y ratios
  if (this.estadisticas.totalPoblacion > 0) {
    this.estadisticas.porcentajeExtranjeros =
      (this.estadisticas.totalExtranjeros / this.estadisticas.totalPoblacion) * 100;
  } else {
    this.estadisticas.porcentajeExtranjeros = 0;
  }

  if (this.estadisticas.totalMujeres > 0) {
    this.estadisticas.ratioGenero = this.estadisticas.totalHombres / this.estadisticas.totalMujeres;
  } else {
    this.estadisticas.ratioGenero = 0;
  }
};

/**
 * Método para clasificar grupo de edad
 */
censusSchema.methods.classifyAgeGroup = function() {
  // Inicializar clasificacionEdad si no existe
  if (!this.clasificacionEdad) {
    this.clasificacionEdad = {};
  }

  if (this.edad <= AGE_RANGES.INFANTIL.max) {
    this.clasificacionEdad.grupoEdad = AGE_GROUPS.INFANTIL;
  } else if (this.edad <= AGE_RANGES.JUVENIL.max) {
    this.clasificacionEdad.grupoEdad = AGE_GROUPS.JUVENIL;
  } else if (this.edad <= AGE_RANGES.ADULTO_JOVEN.max) {
    this.clasificacionEdad.grupoEdad = AGE_GROUPS.ADULTO_JOVEN;
  } else if (this.edad <= AGE_RANGES.ADULTO.max) {
    this.clasificacionEdad.grupoEdad = AGE_GROUPS.ADULTO;
  } else if (this.edad <= AGE_RANGES.MAYOR.max) {
    this.clasificacionEdad.grupoEdad = AGE_GROUPS.MAYOR;
  } else {
    this.clasificacionEdad.grupoEdad = AGE_GROUPS.ANCIANO;
  }

  this.clasificacionEdad.esGrupoProductivo = this.edad >= WORKING_AGE.min && this.edad <= WORKING_AGE.max;
  this.clasificacionEdad.esTerceraEdad = this.edad >= ELDERLY_AGE.min;
};

/**
 * Método para evaluar calidad de datos
 */
censusSchema.methods.evaluateDataQuality = function() {
  const camposFaltantes = [];
  let camposValidos = 0;
  const totalCampos = 5;

  // Verificar campos obligatorios
  if (!this.distrito.codigo || !this.distrito.descripcion) {
    camposFaltantes.push('ubicacion');
  } else {
    camposValidos++;
  }

  if (!this.barrio.codigo || !this.barrio.descripcion) {
    camposFaltantes.push('ubicacion');
  } else {
    camposValidos++;
  }

  if (this.edad === null || this.edad === undefined) {
    camposFaltantes.push('edad');
  } else {
    camposValidos++;
  }

  if (!this.poblacion || this.estadisticas.totalPoblacion === 0) {
    camposFaltantes.push('poblacion');
  } else {
    camposValidos += 2; // Contar como 2 campos válidos
  }

  this.metadatos.calidadDatos.camposFaltantes = [...new Set(camposFaltantes)];
  this.metadatos.calidadDatos.esCompleto = camposFaltantes.length === 0;
  this.metadatos.calidadDatos.puntuacionCalidad = camposValidos / totalCampos;
};

/**
 * Método para obtener distribución demográfica
 * @returns {Object} Distribución por género y nacionalidad
 */
censusSchema.methods.getDemographicDistribution = function() {
  const total = this.estadisticas.totalPoblacion;

  if (total === 0) {
    return null;
  }

  return {
    totalPoblacion: total,
    distribucionNacionalidad: {
      españoles: {
        absoluto: this.estadisticas.totalEspañoles,
        porcentaje: (this.estadisticas.totalEspañoles / total) * 100
      },
      extranjeros: {
        absoluto: this.estadisticas.totalExtranjeros,
        porcentaje: this.estadisticas.porcentajeExtranjeros
      }
    },
    distribucionGenero: {
      hombres: {
        absoluto: this.estadisticas.totalHombres,
        porcentaje: (this.estadisticas.totalHombres / total) * 100
      },
      mujeres: {
        absoluto: this.estadisticas.totalMujeres,
        porcentaje: (this.estadisticas.totalMujeres / total) * 100
      }
    },
    ratioGenero: this.estadisticas.ratioGenero,
    grupoEdad: this.clasificacionEdad.grupoEdad
  };
};

/**
 * Métodos estáticos para consultas agregadas
 */

/**
 * Obtener pirámide poblacional por distrito
 */
/**
 * NUEVOS MÉTODOS ESTÁTICOS OPTIMIZADOS PARA PERFORMANCE
 */

/**
 * Obtener pirámide poblacional optimizada con $facet
 * Combina múltiples aggregations en una sola query
 *
 * @param {Object} options - Opciones de filtrado
 * @param {number} options.año - Año del censo (default: 2051 - año del dataset Anthem)
 * @param {number} options.distrito - Código del distrito (opcional)
 * @param {boolean} options.incluirExtranjeros - Incluir población extranjera
 * @returns {Promise<Object>} Pirámide poblacional detallada y simplificada
 */
/**
 * Metodos estaticos delegados a `services/censoService.js`.
 *
 * El service contiene la implementacion real de las 5 funciones (piramide,
 * analisis demografico, query builder con cursor, estadisticas distritos,
 * evolucion temporal); el modelo expone wrappers thin.
 */
const censoService = require('../services/censoService');

censusSchema.statics.obtenerPiramidePoblacionalOptimizada = function(options) {
  return censoService.obtenerPiramidePoblacionalOptimizada(this, options);
};

censusSchema.statics.obtenerAnalisisDemograficoOptimizado = function(options) {
  return censoService.obtenerAnalisisDemograficoOptimizado(this, options);
};

censusSchema.statics.buscarConOpciones = function(options) {
  return censoService.buscarConOpciones(this, options);
};

censusSchema.statics.obtenerEstadisticasDistritoOptimizadas = function(options) {
  return censoService.obtenerEstadisticasDistritoOptimizadas(this, options);
};



// Crear y exportar el modelo
const Censo = mongoose.model('Censo', censusSchema);

module.exports = Censo;

// Transformación de salida para reducir payload
censusSchema.set('toJSON', {
  transform: (_doc, ret) => {
    delete ret.createdAt;
    delete ret.updatedAt;
    delete ret.__v;
    delete ret.procesamiento;
    return ret;
  }
});
