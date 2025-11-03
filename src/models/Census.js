/**
 * Modelo de Censo
 *
 * Esquema de Mongoose para almacenar y gestionar datos demográficos del censo
 * municipal. Incluye información poblacional por distritos, barrios, secciones
 * censales y grupos de edad, diferenciando entre población española y extranjera.
 */

const mongoose = require('mongoose');

/**
 * Sub-esquema para datos poblacionales por género
 */
const populationDataSchema = new mongoose.Schema({
  españoles: {
    hombres: {
      type: Number,
      required: true
    },
    mujeres: {
      type: Number,
      required: true
    }
  },
  extranjeros: {
    hombres: {
      type: Number,
      required: true
    },
    mujeres: {
      type: Number,
      required: true
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
  // Información temporal
  fechaCenso: {
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

  // Identificación geográfica administrativa
  distrito: {
    codigo: {
      type: Number,
      required: true,
      index: true
    },
    descripcion: {
      type: String,
      required: true,
      trim: true,
      index: true
    }
  },

  barrio: {
    codigoDistritoBarrio: {
      type: Number,
      required: true,
      index: true
    },
    codigo: {
      type: Number,
      required: true,
      index: true
    },
    descripcion: {
      type: String,
      required: true,
      trim: true,
      index: true
    }
  },

  seccionCensal: {
    codigoDistritoSeccion: {
      type: Number,
      required: true,
      index: true
    },
    codigo: {
      type: Number,
      required: true,
      min: [1, 'Código de sección inválido'],
      index: true
    }
  },

  // Información demográfica
  edad: {
    type: Number,
    required: [true, 'Edad obligatoria'],
    min: [0, 'La edad no puede ser negativa'],
    max: [150, 'Edad excesiva'],
    index: true
  },

  // Datos poblacionales
  poblacion: {
    type: populationDataSchema,
    required: [true, 'Datos de población obligatorios']
  },

  // Estadísticas calculadas automáticamente
  estadisticas: {
    totalEspañoles: {
      type: Number,
      min: [0, 'Total españoles no puede ser negativo']
    },
    totalExtranjeros: {
      type: Number,
      min: [0, 'Total extranjeros no puede ser negativo']
    },
    totalHombres: {
      type: Number
    },
    totalMujeres: {
      type: Number
    },
    totalPoblacion: {
      type: Number,
      index: true
    },
    porcentajeExtranjeros: {
      type: Number
    },
    ratioGenero: {
      type: Number
    }
  },

  // Clasificación por grupos de edad
  clasificacionEdad: {
    grupoEdad: {
      type: String,
      enum: [
        'INFANTIL', // 0-14 años
        'JUVENIL', // 15-24 años
        'ADULTO_JOVEN', // 25-44 años
        'ADULTO', // 45-64 años
        'MAYOR', // 65+ años
        'ANCIANO' // 85+ años
      ],
      default: 'ADULTO_JOVEN'
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
    densidadPoblacional: {
      type: String,
      enum: ['BAJA', 'MEDIA', 'ALTA', 'MUY_ALTA'],
      default: 'MEDIA'
    },
    diversidadCultural: {
      type: String,
      enum: ['BAJA', 'MEDIA', 'ALTA'],
      default: function() {
        if (this.estadisticas.porcentajeExtranjeros > 25) {return 'ALTA';}
        if (this.estadisticas.porcentajeExtranjeros > 10) {return 'MEDIA';}
        return 'BAJA';
      }
    },
    calidadDatos: {
      esCompleto: {
        type: Boolean,
        default: true
      },
      camposFaltantes: [{
        type: String,
        enum: ['poblacion', 'ubicacion', 'edad']
      }],
      puntuacionCalidad: {
        type: Number,
        min: [0, 'Puntuación no puede ser negativa'],
        max: [1, 'Puntuación no puede exceder 1'],
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
  versionKey: false
});

/**
 * Índices para optimización de consultas
 */
// Índice único para evitar duplicados
censusSchema.index(
  {
    'distrito.codigo': 1,
    'barrio.codigo': 1,
    'seccionCensal.codigo': 1,
    edad: 1,
    año: 1,
    mes: 1
  },
  { unique: true, name: 'unique_census_record', background: true }
);

// Índice compuesto: distrito + fecha (consultas por distrito en periodo)
// Usado en: GET /api/census?distrito=X&año=Y, estadísticas por distrito
censusSchema.index(
  { 'distrito.codigo': 1, fechaCenso: 1 },
  {
    name: 'idx_census_district_date',
    background: true
  }
);

// Índice compuesto: distrito + edad (análisis demográfico por edad)
// Usado en: pirámide poblacional, análisis de grupos de edad por distrito
censusSchema.index(
  { 'distrito.codigo': 1, edad: 1 },
  {
    name: 'idx_census_district_age',
    background: true
  }
);

// Índice compuesto: fecha + porcentaje extranjeros (análisis de diversidad cultural)
// Usado en: ranking de barrios/distritos por diversidad, análisis temporal
censusSchema.index(
  { fechaCenso: 1, 'estadisticas.porcentajeExtranjeros': -1 },
  {
    name: 'idx_census_foreign_population',
    background: true
  }
);

// Índice compuesto para pirámide poblacional completa
// Usado en: análisis demográfico completo, generación de pirámides poblacionales
censusSchema.index(
  {
    fechaCenso: 1,
    'distrito.codigo': 1,
    edad: 1,
    'clasificacionEdad.grupoEdad': 1
  },
  {
    name: 'idx_census_population_pyramid',
    background: true
  }
);

// Índice para consultas temporales por año y mes
// Usado en: evolución demográfica, comparación entre periodos
censusSchema.index(
  { año: 1, mes: 1, 'distrito.codigo': 1 },
  {
    name: 'idx_census_temporal_district',
    background: true
  }
);

// Índice para ranking de población
// Usado en: identificación de áreas más/menos pobladas
censusSchema.index(
  { 'estadisticas.totalPoblacion': -1, fechaCenso: -1 },
  {
    name: 'idx_census_population_ranking',
    background: true
  }
);

// Índice para análisis de grupos de edad específicos
// Usado en: consultas filtradas por grupo de edad
censusSchema.index(
  { 'clasificacionEdad.grupoEdad': 1, fechaCenso: -1 },
  {
    name: 'idx_census_age_group_timeline',
    background: true
  }
);

// Índice para análisis de población productiva
// Usado en: indicadores económicos, análisis de fuerza laboral
censusSchema.index(
  { 'clasificacionEdad.esGrupoProductivo': 1, fechaCenso: -1 },
  {
    name: 'idx_census_working_age',
    background: true
  }
);

// Índice para análisis de tercera edad
// Usado en: planificación de servicios sociales, análisis de envejecimiento
censusSchema.index(
  { 'clasificacionEdad.esTerceraEdad': 1, fechaCenso: -1 },
  {
    name: 'idx_census_elderly',
    background: true
  }
);

// Índice compuesto para análisis por barrio
// Usado en: estadísticas detalladas a nivel de barrio
censusSchema.index(
  {
    'barrio.codigo': 1,
    fechaCenso: 1,
    edad: 1
  },
  {
    name: 'idx_census_neighborhood_demographics',
    background: true
  }
);

// Índices geográficos para búsqueda por nombre
censusSchema.index(
  { 'distrito.descripcion': 1, 'barrio.descripcion': 1 },
  {
    name: 'idx_census_geographic_names',
    background: true
  }
);

// Índice de texto para búsqueda textual
censusSchema.index(
  {
    'distrito.descripcion': 'text',
    'barrio.descripcion': 'text'
  },
  {
    name: 'idx_census_text_search',
    background: true,
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
  this.clasificarGrupoEdad();

  // Calcular estadísticas poblacionales
  this.calcularEstadisticas();

  // Evaluar calidad de datos
  this.evaluarCalidadDatos();

  next();
});

/**
 * Método para calcular estadísticas poblacionales automáticamente
 */
censusSchema.methods.calcularEstadisticas = function() {
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
censusSchema.methods.clasificarGrupoEdad = function() {
  // Inicializar clasificacionEdad si no existe
  if (!this.clasificacionEdad) {
    this.clasificacionEdad = {};
  }

  if (this.edad <= 14) {
    this.clasificacionEdad.grupoEdad = 'INFANTIL';
  } else if (this.edad <= 24) {
    this.clasificacionEdad.grupoEdad = 'JUVENIL';
  } else if (this.edad <= 44) {
    this.clasificacionEdad.grupoEdad = 'ADULTO_JOVEN';
  } else if (this.edad <= 64) {
    this.clasificacionEdad.grupoEdad = 'ADULTO';
  } else if (this.edad <= 84) {
    this.clasificacionEdad.grupoEdad = 'MAYOR';
  } else {
    this.clasificacionEdad.grupoEdad = 'ANCIANO';
  }

  this.clasificacionEdad.esGrupoProductivo = this.edad >= 16 && this.edad <= 65;
  this.clasificacionEdad.esTerceraEdad = this.edad >= 65;
};

/**
 * Método para evaluar calidad de datos
 */
censusSchema.methods.evaluarCalidadDatos = function() {
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
censusSchema.methods.getDistribucionDemografica = function() {
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
censusSchema.statics.getPiramidePoblacional = function(distritoId, año) {
  return this.aggregate([
    {
      $match: {
        'distrito.codigo': distritoId,
        año: año
      }
    },
    {
      $group: {
        _id: {
          grupoEdad: '$clasificacionEdad.grupoEdad',
          edad: '$edad'
        },
        totalHombres: { $sum: '$estadisticas.totalHombres' },
        totalMujeres: { $sum: '$estadisticas.totalMujeres' },
        totalPoblacion: { $sum: '$estadisticas.totalPoblacion' }
      }
    },
    {
      $sort: { '_id.edad': 1 }
    }
  ]);
};

/**
 * Obtener estadísticas por distrito
 */
censusSchema.statics.getEstadisticasDistrito = function(año, mes = null) {
  const matchCondition = { año };
  if (mes) {matchCondition.mes = mes;}

  return this.aggregate([
    { $match: matchCondition },
    {
      $group: {
        _id: {
          distrito: '$distrito.codigo',
          nombre: '$distrito.descripcion'
        },
        totalPoblacion: { $sum: '$estadisticas.totalPoblacion' },
        totalEspañoles: { $sum: '$estadisticas.totalEspañoles' },
        totalExtranjeros: { $sum: '$estadisticas.totalExtranjeros' },
        promedioPorcentajeExtranjeros: { $avg: '$estadisticas.porcentajeExtranjeros' },
        poblacionProductiva: {
          $sum: {
            $cond: ['$clasificacionEdad.esGrupoProductivo', '$estadisticas.totalPoblacion', 0]
          }
        },
        terceraEdad: {
          $sum: {
            $cond: ['$clasificacionEdad.esTerceraEdad', '$estadisticas.totalPoblacion', 0]
          }
        }
      }
    },
    {
      $addFields: {
        porcentajePoblacionProductiva: {
          $multiply: [
            { $divide: ['$poblacionProductiva', '$totalPoblacion'] },
            100
          ]
        },
        porcentajeTerceraEdad: {
          $multiply: [
            { $divide: ['$terceraEdad', '$totalPoblacion'] },
            100
          ]
        }
      }
    },
    {
      $sort: { totalPoblacion: -1 }
    }
  ]);
};

/**
 * Obtener evolución demográfica temporal
 */
censusSchema.statics.getEvolucionDemografica = function(distritoId = null) {
  const matchCondition = {};
  if (distritoId) {matchCondition['distrito.codigo'] = distritoId;}

  return this.aggregate([
    { $match: matchCondition },
    {
      $group: {
        _id: {
          año: '$año',
          mes: '$mes'
        },
        totalPoblacion: { $sum: '$estadisticas.totalPoblacion' },
        totalEspañoles: { $sum: '$estadisticas.totalEspañoles' },
        totalExtranjeros: { $sum: '$estadisticas.totalExtranjeros' },
        promedioPorcentajeExtranjeros: { $avg: '$estadisticas.porcentajeExtranjeros' }
      }
    },
    {
      $sort: { '_id.año': 1, '_id.mes': 1 }
    }
  ]);
};

/**
 * Obtener ranking de barrios más poblados
 */
censusSchema.statics.getRankingBarrios = function(año, limit = 20) {
  return this.aggregate([
    { $match: { año } },
    {
      $group: {
        _id: {
          distrito: '$distrito.descripcion',
          barrio: '$barrio.descripcion',
          codigoBarrio: '$barrio.codigo'
        },
        totalPoblacion: { $sum: '$estadisticas.totalPoblacion' },
        diversidadCultural: { $avg: '$estadisticas.porcentajeExtranjeros' },
        poblacionProductiva: {
          $sum: {
            $cond: ['$clasificacionEdad.esGrupoProductivo', '$estadisticas.totalPoblacion', 0]
          }
        }
      }
    },
    {
      $sort: { totalPoblacion: -1 }
    },
    {
      $limit: limit
    }
  ]);
};

/**
 * NUEVOS MÉTODOS ESTÁTICOS OPTIMIZADOS PARA PERFORMANCE
 */

/**
 * Obtener pirámide poblacional optimizada con $facet
 * Combina múltiples aggregations en una sola query
 *
 * @param {Object} options - Opciones de filtrado
 * @param {number} options.año - Año del censo
 * @param {number} options.distrito - Código del distrito (opcional)
 * @param {boolean} options.incluirExtranjeros - Incluir población extranjera
 * @returns {Promise<Object>} Pirámide poblacional detallada y simplificada
 */
censusSchema.statics.getPiramidePoblacionalOptimizada = async function(options) {
  const { año = 2051, distrito = null, incluirExtranjeros = true } = options;

  const matchFilters = { año: parseInt(año) };
  if (distrito) {
    matchFilters['distrito.codigo'] = parseInt(distrito);
  }

  // Estrategia: Ejecutar 2 agregaciones simples en paralelo (en lugar de 1 $facet complejo)
  const [piramideDetallada, datosGenerales] = await Promise.all([
    // Agregación 1: Pirámide detallada por edad
    this.aggregate([
      { $match: matchFilters },
      {
        $group: {
          _id: {
            grupoEdad: '$clasificacionEdad.grupoEdad',
            edad: '$edad'
          },
          hombresEsp: { $sum: '$poblacion.españoles.hombres' },
          mujeresEsp: { $sum: '$poblacion.españoles.mujeres' },
          hombresExt: { $sum: '$poblacion.extranjeros.hombres' },
          mujeresExt: { $sum: '$poblacion.extranjeros.mujeres' }
        }
      },
      {
        $project: {
          _id: 0,
          grupoEdad: '$_id.grupoEdad',
          edad: '$_id.edad',
          hombres: incluirExtranjeros
            ? { $add: ['$hombresEsp', '$hombresExt'] }
            : '$hombresEsp',
          mujeres: incluirExtranjeros
            ? { $add: ['$mujeresEsp', '$mujeresExt'] }
            : '$mujeresEsp',
          totalPoblacion: incluirExtranjeros
            ? { $add: ['$hombresEsp', '$mujeresEsp', '$hombresExt', '$mujeresExt'] }
            : { $add: ['$hombresEsp', '$mujeresEsp'] },
          detalleNacionalidad: {
            españoles: {
              hombres: '$hombresEsp',
              mujeres: '$mujeresEsp'
            },
            extranjeros: {
              hombres: '$hombresExt',
              mujeres: '$mujeresExt'
            }
          }
        }
      },
      { $sort: { edad: 1 } }
    ]),

    // Agregación 2: Totales y simplificada
    this.aggregate([
      { $match: matchFilters },
      {
        $group: {
          _id: '$clasificacionEdad.grupoEdad',
          totalHombres: { $sum: '$estadisticas.totalHombres' },
          totalMujeres: { $sum: '$estadisticas.totalMujeres' },
          totalPoblacion: { $sum: '$estadisticas.totalPoblacion' },
          totalEspañoles: { $sum: '$estadisticas.totalEspañoles' },
          totalExtranjeros: { $sum: '$estadisticas.totalExtranjeros' },
          edadMin: { $min: '$edad' },
          edadMax: { $max: '$edad' }
        }
      },
      {
        $project: {
          _id: 0,
          grupoEdad: '$_id',
          poblacion: {
            hombres: '$totalHombres',
            mujeres: '$totalMujeres',
            total: '$totalPoblacion'
          },
          nacionalidad: {
            españoles: '$totalEspañoles',
            extranjeros: '$totalExtranjeros'
          },
          rangoEdad: {
            minima: '$edadMin',
            maxima: '$edadMax'
          }
        }
      },
      { $sort: { 'rangoEdad.minima': 1 } }
    ])
  ]);

  // Calcular totales desde piramide simplificada
  const totales = datosGenerales.reduce(
    (acc, item) => ({
      totalPoblacion: acc.totalPoblacion + item.poblacion.total,
      totalHombres: acc.totalHombres + item.poblacion.hombres,
      totalMujeres: acc.totalMujeres + item.poblacion.mujeres,
      totalEspañoles: acc.totalEspañoles + item.nacionalidad.españoles,
      totalExtranjeros: acc.totalExtranjeros + item.nacionalidad.extranjeros
    }),
    {
      totalPoblacion: 0,
      totalHombres: 0,
      totalMujeres: 0,
      totalEspañoles: 0,
      totalExtranjeros: 0
    }
  );

  // Agregar ratios calculados
  totales.ratioGenero = totales.totalMujeres > 0
    ? Math.round((totales.totalHombres / totales.totalMujeres) * 1000) / 1000
    : 0;
  totales.porcentajeExtranjeros = totales.totalPoblacion > 0
    ? Math.round((totales.totalExtranjeros / totales.totalPoblacion) * 10000) / 100
    : 0;

  return {
    piramideDetallada,
    piramideSimplificada: datosGenerales,
    totales
  };
};

/**
 * Obtener análisis demográfico completo optimizado
 *
 * @param {Object} options - Opciones de filtrado
 * @param {number} options.año - Año del censo
 * @param {number} options.mes - Mes del censo (opcional)
 * @param {number} options.distrito - Código del distrito (opcional)
 * @returns {Promise<Object>} Análisis demográfico comprehensivo
 */
censusSchema.statics.getAnalisisDemograficoOptimizado = async function(options) {
  const { año = 2051, mes = null, distrito = null } = options;

  const matchFilters = { año: parseInt(año) };
  if (mes) {matchFilters.mes = parseInt(mes);}
  if (distrito) {matchFilters['distrito.codigo'] = parseInt(distrito);}

  // Usar $facet para ejecutar 2 agregaciones en paralelo (eliminando porDistrito para mejorar rendimiento)
  const results = await this.aggregate([
    { $match: matchFilters },
    {
      $facet: {
        // Distribución por grupos de edad
        porGrupoEdad: [
          {
            $group: {
              _id: '$clasificacionEdad.grupoEdad',
              totalPoblacion: { $sum: '$estadisticas.totalPoblacion' },
              totalHombres: { $sum: '$estadisticas.totalHombres' },
              totalMujeres: { $sum: '$estadisticas.totalMujeres' },
              edadMin: { $min: '$edad' },
              edadMax: { $max: '$edad' }
            }
          },
          {
            $project: {
              _id: 0,
              grupoEdad: '$_id',
              poblacion: {
                total: '$totalPoblacion',
                hombres: '$totalHombres',
                mujeres: '$totalMujeres'
              },
              rangoEdad: {
                min: '$edadMin',
                max: '$edadMax'
              }
            }
          },
          { $sort: { 'rangoEdad.min': 1 } }
        ],

        // Indicadores generales
        indicadores: [
          {
            $group: {
              _id: null,
              totalPoblacion: { $sum: '$estadisticas.totalPoblacion' },
              totalEspañoles: { $sum: '$estadisticas.totalEspañoles' },
              totalExtranjeros: { $sum: '$estadisticas.totalExtranjeros' },
              totalHombres: { $sum: '$estadisticas.totalHombres' },
              totalMujeres: { $sum: '$estadisticas.totalMujeres' },
              poblacionProductiva: {
                $sum: {
                  $cond: ['$clasificacionEdad.esGrupoProductivo', '$estadisticas.totalPoblacion', 0]
                }
              },
              terceraEdad: {
                $sum: {
                  $cond: ['$clasificacionEdad.esTerceraEdad', '$estadisticas.totalPoblacion', 0]
                }
              },
              menores: {
                $sum: {
                  $cond: [{ $lt: ['$edad', 18] }, '$estadisticas.totalPoblacion', 0]
                }
              }
            }
          },
          {
            $project: {
              _id: 0,
              totalPoblacion: 1,
              totalEspañoles: 1,
              totalExtranjeros: 1,
              totalHombres: 1,
              totalMujeres: 1,
              porcentajeExtranjeros: {
                $round: [{ $multiply: [{ $divide: ['$totalExtranjeros', '$totalPoblacion'] }, 100] }, 2]
              },
              ratioGenero: {
                $round: [{ $divide: ['$totalHombres', '$totalMujeres'] }, 3]
              },
              tasaDependencia: {
                $round: [
                  { $multiply: [{ $divide: [{ $add: ['$menores', '$terceraEdad'] }, '$poblacionProductiva'] }, 100] },
                  2
                ]
              },
              porcentajePoblacionProductiva: {
                $round: [{ $multiply: [{ $divide: ['$poblacionProductiva', '$totalPoblacion'] }, 100] }, 2]
              },
              porcentajeTerceraEdad: {
                $round: [{ $multiply: [{ $divide: ['$terceraEdad', '$totalPoblacion'] }, 100] }, 2]
              }
            }
          }
        ]
      }
    }
  ]).allowDikUse(true);

  return {
    distribuciones: {
      porGrupoEdad: results[0].porGrupoEdad
    },
    indicadores: results[0].indicadores[0] || {},
    metadatos: {
      año: parseInt(año),
      mes: mes ? parseInt(mes) : null,
      distrito: distrito ? parseInt(distrito) : null,
      fechaAnalisis: new Date()
    }
  };
};

// Crear y exportar el modelo
const Census = mongoose.model('Census', censusSchema);

module.exports = Census;
