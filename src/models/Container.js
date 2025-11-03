/**
 * Modelo de Contenedores de Residuos
 *
 * Esquema de Mongoose para la gestión de ubicaciones de contenedores.
 * Contiene información sobre la ubicación, tipo y características de contenedores
 * de residuos distribuidos por la ciudad.
 */

const mongoose = require('mongoose');

/**
 * Esquema de Contenedores
 *
 * Define la estructura de los documentos de contenedores con índices
 * optimizados para consultas geoespaciales y de filtrado.
 */
const containerSchema = new mongoose.Schema({
  // Código de identificación del situado/punto de aportación
  codigoInternoSituado: {
    type: String,
    required: true
  },

  // Tipo de residuo que recoge el contenedor
  tipoContenedor: {
    type: String,
    required: true,
    enum: ['ORGANICA', 'RESTO', 'ENVASES', 'VIDRIO', 'PAPEL-CARTON']
  },

  // Modelo del contenedor (código interno)
  modelo: {
    type: String,
    trim: true
  },

  // Descripción del modelo/tipo de contenedor
  descripcionModelo: {
    type: String,
    trim: true
  },

  // Cantidad de contenedores en el situado
  cantidad: {
    type: Number,
    required: true,
    default: 1
  },

  // Lote al que pertenece (1, 2 o 3)
  lote: {
    type: Number,
    required: true,
    enum: [1, 2, 3]
  },

  // Información geográfica - Distrito
  distrito: {
    type: String,
    required: true,
    trim: true
  },

  // Información geográfica - Barrio
  barrio: {
    type: String,
    required: false, // Opcional - algunos registros no tienen barrio especificado
    trim: true,
    default: 'SIN ESPECIFICAR'
  },

  // Dirección del contenedor
  direccion: {
    tipoVia: {
      type: String,
      trim: true
    },
    nombre: {
      type: String,
      required: true,
      trim: true
    },
    numero: {
      type: String,
      trim: true
    },
    // Dirección completa concatenada
    completa: {
      type: String,
      trim: true
    }
  },

  // Coordenadas UTM (en centímetros según documentación)
  coordenadas: {
    x: {
      type: Number,
      required: true
    },
    y: {
      type: Number,
      required: true
    }
  },

  // Coordenadas geográficas (grados decimales)
  location: {
    type: {
      type: String,
      enum: ['Point'],
      default: 'Point'
    },
    coordinates: {
      type: [Number],
      required: true
    }
  }

}, {
  timestamps: true,
  versionKey: false,
  collection: 'containers'
});

/**
 * Middleware pre-save para generar dirección completa
 */
containerSchema.pre('save', function(next) {
  // Generar dirección completa
  if (this.direccion) {
    const parts = [];

    if (this.direccion.tipoVia) {parts.push(this.direccion.tipoVia);}
    if (this.direccion.nombre) {parts.push(this.direccion.nombre);}
    if (this.direccion.numero) {parts.push(this.direccion.numero);}

    this.direccion.completa = parts.join(' ');
  }

  next();
});

/**
 * Índices para optimización de consultas
 */

// Índice único compuesto para evitar duplicados
containerSchema.index({
  codigoInternoSituado: 1,
  tipoContenedor: 1
}, {
  name: 'idx_containers_unique_code_type',
  background: true
});

// Índice geoespacial 2dsphere para búsquedas por proximidad y áreas
// Usado en: findNearby(), findWithinArea(), queries geoespaciales
containerSchema.index({ location: '2dsphere' }, {
  name: 'idx_containers_geospatial',
  background: true
});

// Índice compuesto jerárquico: distrito + barrio
// Usado en: GET /api/containers?distrito=X&barrio=Y, filtrado por ubicación
containerSchema.index({
  distrito: 1,
  barrio: 1
}, {
  name: 'idx_containers_location_hierarchy',
  background: true
});

// Índice compuesto: tipo + distrito (consultas de cobertura por tipo)
// Usado en: análisis de distribución de tipos por distrito, estadísticas
containerSchema.index({
  tipoContenedor: 1,
  distrito: 1
}, {
  name: 'idx_containers_type_district',
  background: true
});

// Índice compuesto para análisis de densidad: distrito + tipo + geolocalización
// Usado en: análisis de densidad, mapas de calor, cobertura por área
containerSchema.index({
  distrito: 1,
  tipoContenedor: 1,
  location: '2dsphere'
}, {
  name: 'idx_containers_density_analysis',
  background: true
});

// Índice para búsquedas por lote y tipo
// Usado en: queries por gestión de lotes, mantenimiento
containerSchema.index({
  lote: 1,
  tipoContenedor: 1
}, {
  name: 'idx_containers_batch_type',
  background: true
});

// Índice de texto para búsquedas de direcciones
// Usado en: búsqueda textual de contenedores por dirección
containerSchema.index({
  'direccion.nombre': 'text',
  'direccion.completa': 'text'
}, {
  name: 'idx_containers_address_search',
  background: true,
  weights: {
    'direccion.nombre': 10,
    'direccion.completa': 5
  }
});

// Índice compuesto para consultas por barrio y tipo
// Usado en: estadísticas detalladas por barrio, filtrado específico
containerSchema.index({
  barrio: 1,
  tipoContenedor: 1,
  cantidad: 1
}, {
  name: 'idx_containers_neighborhood_type',
  background: true
});

/**
 * Métodos estáticos para consultas comunes
 */

/**
 * Buscar contenedores cercanos a una ubicación
 *
 * @param {number} longitude - Longitud
 * @param {number} latitude - Latitud
 * @param {number} maxDistance - Distancia máxima en metros (default: 500)
 * @param {string} tipoContenedor - Tipo de contenedor (opcional)
 * @returns {Promise<Array>} Contenedores cercanos ordenados por distancia
 */
containerSchema.statics.findNearby = function(longitude, latitude, maxDistance = 500, tipoContenedor = null) {
  const query = {
    location: {
      $near: {
        $geometry: {
          type: 'Point',
          coordinates: [longitude, latitude]
        },
        $maxDistance: maxDistance
      }
    }
  };

  if (tipoContenedor) {
    query.tipoContenedor = tipoContenedor;
  }

  return this.find(query)
    .limit(50)
    .select('-__v');
};

/**
 * Obtener estadísticas de contenedores por distrito
 *
 * @param {string} distrito - Nombre del distrito (opcional)
 * @returns {Promise<Array>} Estadísticas por tipo de contenedor
 */
containerSchema.statics.getStatsByDistrict = function(distrito = null) {
  const matchStage = distrito ? { $match: { distrito } } : { $match: {} };

  return this.aggregate([
    matchStage,
    {
      $group: {
        _id: {
          distrito: '$distrito',
          tipoContenedor: '$tipoContenedor'
        },
        totalContenedores: { $sum: '$cantidad' },
        totalUbicaciones: { $sum: 1 }
      }
    },
    {
      $group: {
        _id: '$_id.distrito',
        distrito: { $first: '$_id.distrito' },
        contenedoresPorTipo: {
          $push: {
            tipo: '$_id.tipoContenedor',
            total: '$totalContenedores',
            ubicaciones: '$totalUbicaciones'
          }
        },
        totalGeneral: { $sum: '$totalContenedores' }
      }
    },
    {
      $sort: { distrito: 1 }
    }
  ]);
};

/**
 * Obtener estadísticas de contenedores por barrio
 *
 * @param {string} distrito - Nombre del distrito
 * @param {string} barrio - Nombre del barrio (opcional)
 * @returns {Promise<Array>} Estadísticas por tipo de contenedor
 */
containerSchema.statics.getStatsByBarrio = function(distrito, barrio = null) {
  const matchStage = barrio
    ? { $match: { distrito, barrio } }
    : { $match: { distrito } };

  return this.aggregate([
    matchStage,
    {
      $group: {
        _id: {
          distrito: '$distrito',
          barrio: '$barrio',
          tipoContenedor: '$tipoContenedor'
        },
        totalContenedores: { $sum: '$cantidad' },
        totalUbicaciones: { $sum: 1 }
      }
    },
    {
      $group: {
        _id: {
          distrito: '$_id.distrito',
          barrio: '$_id.barrio'
        },
        distrito: { $first: '$_id.distrito' },
        barrio: { $first: '$_id.barrio' },
        contenedoresPorTipo: {
          $push: {
            tipo: '$_id.tipoContenedor',
            total: '$totalContenedores',
            ubicaciones: '$totalUbicaciones'
          }
        },
        totalGeneral: { $sum: '$totalContenedores' }
      }
    },
    {
      $sort: { barrio: 1 }
    }
  ]);
};

/**
 * Obtener resumen general de contenedores
 *
 * @returns {Promise<Object>} Resumen con totales por tipo
 */
containerSchema.statics.getGeneralSummary = function() {
  return this.aggregate([
    {
      $group: {
        _id: '$tipoContenedor',
        totalContenedores: { $sum: '$cantidad' },
        totalUbicaciones: { $sum: 1 }
      }
    },
    {
      $group: {
        _id: null,
        porTipo: {
          $push: {
            tipo: '$_id',
            total: '$totalContenedores',
            ubicaciones: '$totalUbicaciones'
          }
        },
        totalGeneral: { $sum: '$totalContenedores' },
        totalUbicaciones: { $sum: '$totalUbicaciones' }
      }
    }
  ]);
};

/**
 * Contar contenedores por tipo en un área específica
 *
 * @param {string} distrito - Nombre del distrito
 * @param {string} barrio - Nombre del barrio (opcional)
 * @returns {Promise<Object>} Conteo por tipo
 */
containerSchema.statics.countByType = async function(distrito, barrio = null) {
  const query = { distrito };
  if (barrio) {
    query.barrio = barrio;
  }

  const results = await this.aggregate([
    { $match: query },
    {
      $group: {
        _id: '$tipoContenedor',
        cantidad: { $sum: '$cantidad' },
        ubicaciones: { $sum: 1 }
      }
    }
  ]);

  // Convertir array a objeto para fácil acceso
  const summary = {
    distrito,
    ...(barrio && { barrio }),
    total: 0,
    totalUbicaciones: 0,
    porTipo: {}
  };

  results.forEach(item => {
    summary.porTipo[item._id] = {
      cantidad: item.cantidad,
      ubicaciones: item.ubicaciones
    };
    summary.total += item.cantidad;
    summary.totalUbicaciones += item.ubicaciones;
  });

  return summary;
};

/**
 * Buscar contenedores dentro de un polígono (área)
 *
 * @param {Array} coordinates - Array de coordenadas del polígono [[lng, lat], ...]
 * @param {string} tipoContenedor - Tipo de contenedor (opcional)
 * @returns {Promise<Array>} Contenedores dentro del área
 */
containerSchema.statics.findWithinArea = function(coordinates, tipoContenedor = null) {
  const query = {
    location: {
      $geoWithin: {
        $geometry: {
          type: 'Polygon',
          coordinates: [coordinates]
        }
      }
    }
  };

  if (tipoContenedor) {
    query.tipoContenedor = tipoContenedor;
  }

  return this.find(query).select('-__v');
};

/**
 * Obtener datos para mapa de calor de contenedores
 * @param {String} tipoContenedor - Tipo de contenedor a filtrar (opcional)
 * @param {Number} limit - Límite de puntos (default: 5000)
 * @returns {Promise<Array>} Array de puntos con coordenadas
 */
containerSchema.statics.getHeatmapData = function(tipoContenedor = null, limit = 5000) {
  const filter = tipoContenedor ? { tipoContenedor: tipoContenedor.toUpperCase() } : {};

  return this.aggregate([
    { $match: filter },
    {
      $project: {
        latitude: { $arrayElemAt: ['$location.coordinates', 1] },
        longitude: { $arrayElemAt: ['$location.coordinates', 0] },
        cantidad: 1,
        tipoContenedor: 1
      }
    },
    { $limit: limit }
  ]);
};

/**
 * Análisis de cobertura por tipo de contenedor y distrito
 * @param {String} distrito - Distrito específico (opcional, null para todos)
 * @returns {Promise<Array>} Análisis de cobertura por distrito y tipo
 */
containerSchema.statics.getCoverageAnalysis = function(distrito = null) {
  const matchStage = distrito ? { $match: { distrito } } : { $match: {} };

  return this.aggregate([
    matchStage,
    {
      $group: {
        _id: {
          distrito: '$distrito',
          tipoContenedor: '$tipoContenedor'
        },
        totalContenedores: { $sum: '$cantidad' },
        totalUbicaciones: { $sum: 1 },
        puntos: {
          $push: {
            lng: { $arrayElemAt: ['$location.coordinates', 0] },
            lat: { $arrayElemAt: ['$location.coordinates', 1] }
          }
        }
      }
    },
    {
      $group: {
        _id: '$_id.distrito',
        distrito: { $first: '$_id.distrito' },
        tipos: {
          $push: {
            tipo: '$_id.tipoContenedor',
            total: '$totalContenedores',
            ubicaciones: '$totalUbicaciones'
          }
        },
        totalGeneral: { $sum: '$totalContenedores' }
      }
    },
    { $sort: { distrito: 1 } }
  ]);
};

/**
 * Análisis de densidad de contenedores por distrito
 *
 * Calcula la densidad de contenedores por distrito y tipo, incluyendo
 * métricas de distribución espacial. Utiliza el índice idx_containers_density_analysis
 * para optimización de consultas geoespaciales.
 *
 * @param {Object} options - Opciones de análisis
 * @param {String} [options.distrito] - Distrito específico (opcional)
 * @param {String} [options.tipoContenedor] - Tipo de contenedor específico (opcional)
 * @param {Boolean} [options.includeBarrios=true] - Incluir desglose por barrios
 * @returns {Promise<Array>} Array con análisis de densidad por distrito
 *
 * @example
 * const density = await Container.getDensityAnalysisByDistrict({
 *   distrito: 'CENTRO',
 *   tipoContenedor: 'ORGANICA',
 *   includeBarrios: true
 * });
 */
containerSchema.statics.getDensityAnalysisByDistrict = function(options = {}) {
  const { distrito, tipoContenedor, includeBarrios = true } = options;

  const matchStage = {};
  if (distrito) {
    matchStage.distrito = distrito;
  }
  if (tipoContenedor) {
    matchStage.tipoContenedor = tipoContenedor;
  }

  const groupByDistrict = [
    { $match: Object.keys(matchStage).length > 0 ? matchStage : { distrito: { $exists: true } } },
    {
      $group: {
        _id: {
          distrito: '$distrito',
          ...(includeBarrios && { barrio: '$barrio' }),
          ...(tipoContenedor ? {} : { tipo: '$tipoContenedor' })
        },
        totalContenedores: { $sum: '$cantidad' },
        totalPuntos: { $sum: 1 },
        contenedoresPorTipo: {
          $push: {
            tipo: '$tipoContenedor',
            cantidad: '$cantidad',
            lote: '$lote'
          }
        },
        coordenadas: {
          $push: {
            type: 'Point',
            coordinates: '$location.coordinates'
          }
        }
      }
    },
    {
      $project: {
        _id: 0,
        distrito: '$_id.distrito',
        ...(includeBarrios && { barrio: '$_id.barrio' }),
        ...(!tipoContenedor && { tipoContenedor: '$_id.tipo' }),
        totalContenedores: 1,
        totalPuntos: 1,
        densidad: {
          contenedoresPorPunto: {
            $round: [{ $divide: ['$totalContenedores', '$totalPuntos'] }, 2]
          }
        },
        distribucionTipos: {
          $reduce: {
            input: '$contenedoresPorTipo',
            initialValue: {},
            in: {
              $mergeObjects: [
                '$$value',
                {
                  $cond: [
                    { $eq: ['$$this.tipo', 'ORGANICA'] },
                    { ORGANICA: { $add: [{ $ifNull: ['$$value.ORGANICA', 0] }, '$$this.cantidad'] } },
                    '$$value'
                  ]
                },
                {
                  $cond: [
                    { $eq: ['$$this.tipo', 'RESTO'] },
                    { RESTO: { $add: [{ $ifNull: ['$$value.RESTO', 0] }, '$$this.cantidad'] } },
                    '$$value'
                  ]
                },
                {
                  $cond: [
                    { $eq: ['$$this.tipo', 'ENVASES'] },
                    { ENVASES: { $add: [{ $ifNull: ['$$value.ENVASES', 0] }, '$$this.cantidad'] } },
                    '$$value'
                  ]
                },
                {
                  $cond: [
                    { $eq: ['$$this.tipo', 'VIDRIO'] },
                    { VIDRIO: { $add: [{ $ifNull: ['$$value.VIDRIO', 0] }, '$$this.cantidad'] } },
                    '$$value'
                  ]
                },
                {
                  $cond: [
                    { $eq: ['$$this.tipo', 'PAPEL-CARTON'] },
                    { 'PAPEL-CARTON': { $add: [{ $ifNull: ['$$value.PAPEL-CARTON', 0] }, '$$this.cantidad'] } },
                    '$$value'
                  ]
                }
              ]
            }
          }
        }
      }
    },
    {
      $sort: includeBarrios
        ? { distrito: 1, barrio: 1 }
        : { distrito: 1, totalContenedores: -1 }
    }
  ];

  return this.aggregate(groupByDistrict);
};

// Crear y exportar el modelo
const Container = mongoose.model('Container', containerSchema);

module.exports = Container;
