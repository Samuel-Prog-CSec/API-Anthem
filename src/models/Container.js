/**
 * Modelo de Contenedores de Residuos
 *
 * Esquema de Mongoose para la gestión de ubicaciones de contenedores.
 * Contiene información sobre la ubicación, tipo y características de contenedores
 * de residuos distribuidos por la ciudad.
 */

const mongoose = require('mongoose');
const { coordinatesUTMSchema } = require('./schemas/commonSchemas');
const {
  CONTAINER_TYPES,
  CONTAINER_LOTES,
  GEOMETRY_TYPES,
  VALIDATION_LIMITS,
  DEFAULT_VALUES,
  MONGODB_TIMEOUTS
} = require('../constants');
const logger = require('../config/logger');

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
    trim: true,
    required: true
  },

  // Tipo de residuo que recoge el contenedor
  tipoContenedor: {
    type: String,
    trim: true,
    required: true,
    uppercase: true,
    enum: Object.values(CONTAINER_TYPES)
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
    default: 1,
    min: [VALIDATION_LIMITS.QUANTITY_POSITIVE_MIN, 'La cantidad debe ser al menos 1']
  },

  // Lote al que pertenece (1, 2 o 3)
  lote: {
    type: Number,
    required: true,
    enum: CONTAINER_LOTES
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
    default: DEFAULT_VALUES.UNSPECIFIED
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
  coordenadas: coordinatesUTMSchema,

  // Coordenadas geográficas (grados decimales)
  location: {
    type: {
      type: String,
      enum: Object.values(GEOMETRY_TYPES),
      default: GEOMETRY_TYPES.POINT
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
 * Middleware pre-save para generar dirección completa y validar coherencia de coordenadas
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

  // Validación de coherencia UTM vs GeoJSON
  // Las coordenadas UTM y GeoJSON deben representar aproximadamente la misma ubicación
  // UTM está en centímetros, GeoJSON en grados decimales
  // Si hay discrepancia significativa, generar advertencia (no bloquear guardado)
  if (this.coordenadas?.x && this.coordenadas?.y && this.location?.coordinates) {
    const [lng, lat] = this.location.coordinates;
    const utmX = this.coordenadas.x;
    const utmY = this.coordenadas.y;

    // Conversión aproximada: Madrid zona UTM 30N
    // lng ≈ -3.7 grados para X ≈ 440000000 cm (440 km)
    // lat ≈ 40.4 grados para Y ≈ 4474000000 cm (4474 km)
    // Tolerancia: ±0.01 grados (≈1.1 km) para detectar errores graves
    const expectedLng = -3.7 + (utmX / 100 - 440000) / 111320; // 111320 m/grado aprox
    const expectedLat = 40.4 + (utmY / 100 - 4474000) / 111320;

    const lngDiff = Math.abs(lng - expectedLng);
    const latDiff = Math.abs(lat - expectedLat);

    // Si la diferencia es mayor a 0.01 grados (1.1 km), posible error
    if (lngDiff > 0.01 || latDiff > 0.01) {
      logger.warn(
        `[Container ${this.codigoInternoSituado}] Advertencia: Posible incoherencia entre coordenadas UTM y GeoJSON. ` +
        `UTM: (${utmX}, ${utmY}) → GeoJSON esperado: [${expectedLng.toFixed(4)}, ${expectedLat.toFixed(4)}], ` +
        `GeoJSON actual: [${lng}, ${lat}]. Diferencia: lng=${lngDiff.toFixed(4)}°, lat=${latDiff.toFixed(4)}°`
      );
    }
  }

  next();
});

/**
 * Índices para optimización de consultas
 */

// ========================================
// ÍNDICE ÚNICO - Prevención de duplicados
// ========================================
// Garantiza que no haya contenedores duplicados para mismo código + tipo
// Combinación: codigoInternoSituado + tipoContenedor
// Un código puede tener múltiples tipos (orgánica, envases, etc.)
containerSchema.index({
  codigoInternoSituado: 1,
  tipoContenedor: 1
}, {
  unique: true,
  name: 'idx_containers_unique_code_type',
  background: true
});

// ========================================
// ÍNDICE GEOESPACIAL - Búsquedas por proximidad
// ========================================
// Índice 2dsphere para consultas geográficas avanzadas
// Usado en: Container.findNearby() - Contenedores cerca de coordenadas
// Usado en: Container.findWithinArea() - Contenedores en área
// Soporta: $near, $geoWithin, $geoIntersects
// CRÍTICO: Necesario para mapas y búsquedas por proximidad
containerSchema.index({ location: '2dsphere' }, {
  name: 'idx_containers_geospatial',
  background: true
});

// ========================================
// ÍNDICES PRINCIPALES - Consultas frecuentes
// ========================================

// Índice compuesto jerárquico: distrito + barrio
// Usado en: GET /api/containers?distrito=X&barrio=Y
// Soporta: Filtrado geográfico administrativo
containerSchema.index({
  distrito: 1,
  barrio: 1
}, {
  name: 'idx_containers_location_hierarchy',
  background: true
});

// Índice compuesto: tipo + distrito
// Usado en: GET /api/containers?tipoContenedor=ORGANICA&distrito=X
// Soporta: Análisis de cobertura por tipo de residuo y distrito
// Ejemplo: "¿Cuántos contenedores de orgánica hay en Centro?"
containerSchema.index({
  tipoContenedor: 1,
  distrito: 1
}, {
  name: 'idx_containers_type_district',
  background: true
});

// ========================================
// ÍNDICES PARA AGREGACIONES
// ========================================

// Índice compuesto para análisis de densidad
// Usado en: Container métodos estáticos - Análisis de cobertura
// Soporta: Mapas de calor, densidad de contenedores por tipo y área
// Combina: distrito + tipo + geolocalización
containerSchema.index({
  distrito: 1,
  tipoContenedor: 1,
  location: '2dsphere'
}, {
  name: 'idx_containers_density_analysis',
  background: true
});

// Índice para gestión por lotes
// Usado en: Queries administrativas de mantenimiento
// Soporta: "Contenedores del lote X de tipo Y"
containerSchema.index({
  lote: 1,
  tipoContenedor: 1
}, {
  name: 'idx_containers_batch_type',
  background: true
});

// Índice compuesto para estadísticas detalladas por barrio
// Usado en: Análisis granular de distribución
// Soporta: Cantidad de contenedores por barrio y tipo
containerSchema.index({
  barrio: 1,
  tipoContenedor: 1,
  cantidad: 1
}, {
  name: 'idx_containers_neighborhood_type',
  background: true
});

// ========================================
// ÍNDICE DE BÚSQUEDA TEXTUAL
// ========================================
// Índice de texto completo para búsquedas de direcciones
// Usado en: Búsqueda con $text por calle o dirección completa
// Pesos: nombre de calle (10) más relevante que dirección completa (5)
// Soporta: "Contenedores en Gran Vía"
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
          type: GEOMETRY_TYPES.POINT,
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
  ]).allowDiskUse(true).maxTimeMS(MONGODB_TIMEOUTS.AGGREGATE_TIMEOUT_MS);
};

/**
 * Obtener estadísticas de contenedores por barrio
 *
 * @param {string} distrito - Nombre del distrito
 * @param {string} barrio - Nombre del barrio (opcional)
 * @returns {Promise<Array>} Estadísticas por tipo de contenedor
 */
containerSchema.statics.getStatsByNeighborhood = function(distrito, barrio = null) {
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
  ]).allowDiskUse(true).maxTimeMS(MONGODB_TIMEOUTS.AGGREGATE_TIMEOUT_MS);
};

/**
 * Obtener resumen general de contenedores
 *
 * @returns {Promise<Object>} Resumen con totales por tipo
 */
containerSchema.statics.getGeneralSummary = function() {
  return this.aggregate([
    // NO usar $limit antes de $group - necesitamos TODOS los documentos para estadísticas correctas
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
  ]).allowDiskUse(true).maxTimeMS(MONGODB_TIMEOUTS.AGGREGATE_TIMEOUT_MS);
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
  ]).allowDiskUse(true);
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
  ]).allowDiskUse(true);
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

  // Pipeline optimizado usando $group múltiples en lugar de $reduce
  const pipeline = [
    { $match: Object.keys(matchStage).length > 0 ? matchStage : { distrito: { $exists: true } } },
    // Primera agrupación: por distrito/barrio y tipo
    {
      $group: {
        _id: {
          distrito: '$distrito',
          ...(includeBarrios && { barrio: '$barrio' }),
          tipo: '$tipoContenedor'
        },
        cantidadPorTipo: { $sum: '$cantidad' },
        puntosPorTipo: { $sum: 1 }
      }
    },
    // Segunda agrupación: consolidar tipos en distribución
    {
      $group: {
        _id: {
          distrito: '$_id.distrito',
          ...(includeBarrios && { barrio: '$_id.barrio' })
        },
        totalContenedores: { $sum: '$cantidadPorTipo' },
        totalPuntos: { $sum: '$puntosPorTipo' },
        distribucion: {
          $push: {
            tipo: '$_id.tipo',
            cantidad: '$cantidadPorTipo',
            puntos: '$puntosPorTipo'
          }
        }
      }
    },
    // Proyección final para formato de salida
    {
      $project: {
        _id: 0,
        distrito: '$_id.distrito',
        ...(includeBarrios && { barrio: '$_id.barrio' }),
        totalContenedores: 1,
        totalPuntos: 1,
        densidad: {
          contenedoresPorPunto: {
            $round: [{ $divide: ['$totalContenedores', '$totalPuntos'] }, 2]
          }
        },
        distribucionTipos: {
          $arrayToObject: {
            $map: {
              input: '$distribucion',
              as: 'item',
              in: {
                k: '$$item.tipo',
                v: {
                  cantidad: '$$item.cantidad',
                  puntos: '$$item.puntos'
                }
              }
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

  return this.aggregate(pipeline).allowDiskUse(true);
};

// Crear y exportar el modelo
const Container = mongoose.model('Container', containerSchema);

module.exports = Container;
