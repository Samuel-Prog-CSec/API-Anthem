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
    required: [true, 'El código interno del situado es obligatorio'],
    index: true
  },

  // Tipo de residuo que recoge el contenedor
  tipoContenedor: {
    type: String,
    required: [true, 'El tipo de contenedor es obligatorio'],
    enum: {
      values: ['ORGANICA', 'RESTO', 'ENVASES', 'VIDRIO', 'PAPEL-CARTON'],
      message: 'Tipo de contenedor no válido'
    },
    index: true
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
    required: [true, 'La cantidad es obligatoria'],
    min: [1, 'La cantidad debe ser al menos 1'],
    default: 1
  },

  // Lote al que pertenece (1, 2 o 3)
  lote: {
    type: Number,
    required: [true, 'El lote es obligatorio'],
    enum: {
      values: [1, 2, 3],
      message: 'El lote debe ser 1, 2 o 3'
    },
    index: true
  },

  // Información geográfica - Distrito
  distrito: {
    type: String,
    required: [true, 'El distrito es obligatorio'],
    trim: true,
    index: true
  },

  // Información geográfica - Barrio
  barrio: {
    type: String,
    required: false, // Opcional - algunos registros no tienen barrio especificado
    trim: true,
    index: true,
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
      required: [true, 'El nombre de la vía es obligatorio'],
      trim: true,
      index: true
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
      required: [true, 'La coordenada X es obligatoria']
    },
    y: {
      type: Number,
      required: [true, 'La coordenada Y es obligatoria']
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
      type: [Number], // [longitud, latitud]
      required: [true, 'Las coordenadas geográficas son obligatorias'],
      validate: {
        validator: function(coords) {
          return coords.length === 2 &&
                 coords[0] >= -180 && coords[0] <= 180 &&
                 coords[1] >= -90 && coords[1] <= 90;
        },
        message: 'Coordenadas geográficas no válidas'
      }
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

// Índice compuesto para búsquedas por código y tipo
containerSchema.index({
  codigoInternoSituado: 1,
  tipoContenedor: 1
});

// Índice geoespacial para búsquedas por proximidad
containerSchema.index({ location: '2dsphere' });

// Índice compuesto para consultas por distrito y barrio
containerSchema.index({
  distrito: 1,
  barrio: 1,
  tipoContenedor: 1
});

// Índice para búsquedas por lote y tipo
containerSchema.index({
  lote: 1,
  tipoContenedor: 1
});

// Índice para búsquedas de texto en direcciones
containerSchema.index({
  'direccion.nombre': 'text',
  'direccion.completa': 'text'
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
containerSchema.statics.findNearby = async function(longitude, latitude, maxDistance = 500, tipoContenedor = null) {
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
containerSchema.statics.getStatsByDistrict = async function(distrito = null) {
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
containerSchema.statics.getStatsByBarrio = async function(distrito, barrio = null) {
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
containerSchema.statics.getGeneralSummary = async function() {
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
  if (barrio) {query.barrio = barrio;}

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
containerSchema.statics.findWithinArea = async function(coordinates, tipoContenedor = null) {
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

// Crear y exportar el modelo
const Container = mongoose.model('Container', containerSchema);

module.exports = Container;
