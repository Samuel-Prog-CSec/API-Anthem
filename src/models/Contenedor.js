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
  MONGODB_TIMEOUTS
} = require('../constants');
const logger = require('../config/logger');

/**
 * Esquema de Contenedores
 *
 * Define la estructura de los documentos de contenedores con índices
 * optimizados para consultas geoespaciales y de filtrado.
 */
const contenedorSchema = new mongoose.Schema({
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

  // Información geográfica - Barrio.
  // Sin default. El CSV trae barrio vacio en 71 % de filas y antes el
  // schema rellenaba con "SIN ESPECIFICAR" creando un valor que parecia
  // dato. Ahora si el CSV no informa, el campo queda undefined y la UI
  // muestra "—" / "No disponible".
  barrio: {
    type: String,
    required: false,
    trim: true
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

// Transformación de salida para reducir payload
contenedorSchema.set('toJSON', {
  transform: (_doc, ret) => {
    delete ret.createdAt;
    delete ret.updatedAt;
    delete ret.__v;
    return ret;
  }
});

/**
 * Middleware pre-save para generar dirección completa y validar coherencia de coordenadas
 */
contenedorSchema.pre('save', function(next) {
  // Generar dirección completa
  if (this.direccion) {
    const parts = [];

    if (this.direccion.tipoVia) {parts.push(this.direccion.tipoVia);}
    if (this.direccion.nombre) {parts.push(this.direccion.nombre);}
    if (this.direccion.numero) {parts.push(this.direccion.numero);}

    this.direccion.completa = parts.join(' ');
  }

  // Validacion de coherencia UTM vs GeoJSON.
  //
  // Convencion del proyecto: UTM se almacena SIEMPRE en METROS (zona 30N
  // ETRS89). El CSV original de contenedores trae UTM en centimetros, pero
  // el importador (helpers/coordenadas.js, perfil 'contenedores') normaliza
  // a metros antes de persistir. Por eso aqui asumimos metros directamente.
  //
  // Esta validacion es defensiva: detecta inconsistencias si alguien guarda
  // un contenedor manualmente con UTM en cm o con coordenadas mal mapeadas.
  if (this.coordenadas?.x && this.coordenadas?.y && this.location?.coordinates) {
    const [lng, lat] = this.location.coordinates;
    const utmX = this.coordenadas.x; // metros
    const utmY = this.coordenadas.y; // metros

    // Conversion aproximada para Madrid (zona UTM 30N).
    // Centroide aproximado: lng=-3.7, lat=40.4 que corresponde a UTM
    // (440000, 4474000) en metros. 111320 m/grado de latitud (constante
    // suficiente al nivel de tolerancia que aplicamos).
    const expectedLng = -3.7 + (utmX - 440000) / 111320;
    const expectedLat = 40.4 + (utmY - 4474000) / 111320;

    const lngDiff = Math.abs(lng - expectedLng);
    const latDiff = Math.abs(lat - expectedLat);

    // Tolerancia: 0.01 grados (~1.1 km). Detecta errores graves (zona UTM
    // incorrecta, ejes invertidos) sin disparar falsos positivos por
    // redondeo o por la aproximacion lineal.
    if (lngDiff > 0.01 || latDiff > 0.01) {
      logger.warn(
        `[Contenedor ${this.codigoInternoSituado}] Advertencia: Posible incoherencia entre coordenadas UTM y GeoJSON. ` +
        `UTM: (${utmX}, ${utmY}) m → GeoJSON esperado: [${expectedLng.toFixed(4)}, ${expectedLat.toFixed(4)}], ` +
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
// ÍNDICE COMPUESTO - Lookup por código + tipo
// ========================================
// NO se marca como unique porque el dataset Anthem reutiliza el
// codigoInternoSituado para contenedores fisicamente distintos (mismo
// codigo+tipo en coordenadas distintas, hasta 1.6 km de separacion).
// Antes el `unique:true` rechazaba silenciosamente 2 585 contenedores
// reales (verificado: 166 grupos con coords > 5 m).
// El importador hace el dedup correcto usando la clave 4-tuple
// (codigo + tipo + lon + lat) en memoria.
contenedorSchema.index({
  codigoInternoSituado: 1,
  tipoContenedor: 1
}, {
  name: 'idx_containers_code_type'
});

// ========================================
// ÍNDICE GEOESPACIAL - Búsquedas por proximidad
// ========================================
// Índice 2dsphere para consultas geográficas avanzadas
// Usado en: Contenedor.buscarCercanos() - Contenedores cerca de coordenadas
// Usado en: Contenedor.findWithinArea() - Contenedores en área
// Soporta: $near, $geoWithin, $geoIntersects
// CRÍTICO: Necesario para mapas y búsquedas por proximidad
contenedorSchema.index({ location: '2dsphere' }, {
  name: 'idx_containers_geospatial'
});

// ========================================
// ÍNDICES PRINCIPALES - Consultas frecuentes
// ========================================

// Índice compuesto jerárquico: distrito + barrio
// Usado en: GET /api/v1/contenedores?distrito=X&barrio=Y
// Soporta: Filtrado geográfico administrativo
contenedorSchema.index({
  distrito: 1,
  barrio: 1
}, {
  name: 'idx_containers_location_hierarchy'
});

// Índice compuesto: tipo + distrito
// Usado en: GET /api/v1/contenedores?tipoContenedor=ORGANICA&distrito=X
// Soporta: Análisis de cobertura por tipo de residuo y distrito
// Ejemplo: "¿Cuántos contenedores de orgánica hay en Centro?"
contenedorSchema.index({
  tipoContenedor: 1,
  distrito: 1
}, {
  name: 'idx_containers_type_district'
});

// ========================================
// ÍNDICES PARA AGREGACIONES
// ========================================

// Índice compuesto para análisis de densidad
// Usado en: Contenedor metodos estaticos - Analisis de cobertura
// Soporta: Mapas de calor, densidad de contenedores por tipo y área
// Combina: distrito + tipo + geolocalización
contenedorSchema.index({
  distrito: 1,
  tipoContenedor: 1,
  location: '2dsphere'
}, {
  name: 'idx_containers_density_analysis'
});

// Índice para gestión por lotes
// Usado en: Queries administrativas de mantenimiento
// Soporta: "Contenedores del lote X de tipo Y"
contenedorSchema.index({
  lote: 1,
  tipoContenedor: 1
}, {
  name: 'idx_containers_batch_type'
});

// Índice compuesto para estadísticas detalladas por barrio
// Usado en: Análisis granular de distribución
// Soporta: Cantidad de contenedores por barrio y tipo
contenedorSchema.index({
  barrio: 1,
  tipoContenedor: 1,
  cantidad: 1
}, {
  name: 'idx_containers_neighborhood_type'
});

// ========================================
// ÍNDICE DE BÚSQUEDA TEXTUAL
// ========================================
// Índice de texto completo para búsquedas de direcciones
// Usado en: Búsqueda con $text por calle o dirección completa
// Pesos: nombre de calle (10) más relevante que dirección completa (5)
// Soporta: "Contenedores en Gran Vía"
contenedorSchema.index({
  'direccion.nombre': 'text',
  'direccion.completa': 'text'
}, {
  name: 'idx_containers_address_search',
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
contenedorSchema.statics.buscarCercanos = function(longitude, latitude, maxDistance = 500, tipoContenedor = null) {
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
contenedorSchema.statics.obtenerEstadisticasPorDistrito = function(distrito = null, lote = null) {
  const match = {};
  if (distrito) { match.distrito = distrito; }
  if (lote !== undefined && lote !== null && lote !== '') { match.lote = Number(lote); }
  const matchStage = { $match: match };

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
  ]).option({ allowDiskUse: true, maxTimeMS: MONGODB_TIMEOUTS.AGGREGATE_TIMEOUT_MS });
};

/**
 * Obtener estadísticas de contenedores por barrio
 *
 * @param {string} distrito - Nombre del distrito
 * @param {string} barrio - Nombre del barrio (opcional)
 * @returns {Promise<Array>} Estadísticas por tipo de contenedor
 */
contenedorSchema.statics.obtenerEstadisticasPorBarrio = function(distrito, barrio = null) {
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
  ]).option({ allowDiskUse: true, maxTimeMS: MONGODB_TIMEOUTS.AGGREGATE_TIMEOUT_MS });
};

/**
 * Obtener resumen general de contenedores
 *
 * @returns {Promise<Object>} Resumen con totales por tipo
 */
contenedorSchema.statics.obtenerResumenGeneral = function(lote = null) {
  const pipeline = [];
  // Filtro opcional por lote (para que los KPIs reflejen el lote activo).
  if (lote !== undefined && lote !== null && lote !== '') {
    pipeline.push({ $match: { lote: Number(lote) } });
  }
  pipeline.push(
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
  );
  return this.aggregate(pipeline).option({ allowDiskUse: true, maxTimeMS: MONGODB_TIMEOUTS.AGGREGATE_TIMEOUT_MS });
};

/**
 * Contar contenedores por tipo en un área específica
 *
 * @param {string} distrito - Nombre del distrito
 * @param {string} barrio - Nombre del barrio (opcional)
 * @returns {Promise<Object>} Conteo por tipo
 */
contenedorSchema.statics.contarPorTipo = async function(distrito, barrio = null) {
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
  ]).option({ maxTimeMS: MONGODB_TIMEOUTS.AGGREGATE_TIMEOUT_MS });

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
contenedorSchema.statics.obtenerDatosMapaCalor = function(tipoContenedor = null, limit = 5000) {
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
  ]).option({ allowDiskUse: true, maxTimeMS: MONGODB_TIMEOUTS.AGGREGATE_TIMEOUT_MS });
};

/**
 * Análisis de cobertura por tipo de contenedor y distrito
 * @param {String} distrito - Distrito específico (opcional, null para todos)
 * @returns {Promise<Array>} Análisis de cobertura por distrito y tipo
 */
contenedorSchema.statics.obtenerAnalisisCobertura = function(distrito = null) {
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
  ]).option({ allowDiskUse: true, maxTimeMS: MONGODB_TIMEOUTS.AGGREGATE_TIMEOUT_MS });
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
 * const density = await Contenedor.obtenerAnalisisDensidadPorDistrito({
 *   distrito: 'CENTRO',
 *   tipoContenedor: 'ORGANICA',
 *   includeBarrios: true
 * });
 */
/**
 * Obtener documentos para construir un FeatureCollection GeoJSON.
 *
 * Patron paralelo a otros endpoints `/mapa` (ruido, multas, accidentes).
 * Devuelve documentos lean con location + propiedades minimas necesarias.
 * Soporta filtrado por bbox (4 valores: minLng, minLat, maxLng, maxLat)
 * para no devolver toda la coleccion cuando el cliente solo ve un trozo
 * del mapa, ademas de filtros administrativos.
 *
 * @param {Object} filtros - Filtros de consulta
 * @param {string} [filtros.tipoContenedor] - Tipo de contenedor (uppercase)
 * @param {string} [filtros.distrito] - Nombre del distrito
 * @param {string} [filtros.barrio] - Nombre del barrio
 * @param {number} [filtros.lote] - Lote 1, 2 o 3
 * @param {Array<number>} [filtros.bbox] - [minLng, minLat, maxLng, maxLat]
 * @param {number} [filtros.limit=50000] - Tope de seguridad. 50k cubre el
 *   dataset completo (~38k contenedores) para que el mapa (clusterizado) no
 *   recorte puntos y la leyenda "N contenedores" sea el total real y no un
 *   subconjunto silencioso. Usa MarkerClusterGroup (como las ~30k ubicaciones).
 * @returns {Promise<Array>} Documentos lean con location + propiedades
 */
contenedorSchema.statics.obtenerCaracteristicasMapa = function(filtros = {}) {
  const { tipoContenedor, distrito, barrio, lote, bbox, limit = 50000 } = filtros;

  const match = {};
  if (tipoContenedor) {match.tipoContenedor = tipoContenedor.toUpperCase();}
  if (distrito) {match.distrito = distrito;}
  if (barrio) {match.barrio = barrio;}
  if (lote !== undefined && lote !== null) {match.lote = Number(lote);}

  // Filtro espacial bbox (usa indice 2dsphere)
  if (Array.isArray(bbox) && bbox.length === 4) {
    const [minLng, minLat, maxLng, maxLat] = bbox.map(Number);
    if ([minLng, minLat, maxLng, maxLat].every(Number.isFinite)) {
      match.location = {
        $geoWithin: {
          $box: [[minLng, minLat], [maxLng, maxLat]]
        }
      };
    }
  }

  const projection = {
    codigoInternoSituado: 1,
    tipoContenedor: 1,
    cantidad: 1,
    lote: 1,
    distrito: 1,
    barrio: 1,
    'direccion.completa': 1,
    location: 1
  };

  return this.find(match, projection)
    .limit(Number.isFinite(limit) ? limit : 50000)
    .maxTimeMS(MONGODB_TIMEOUTS.AGGREGATE_TIMEOUT_MS)
    .lean();
};

contenedorSchema.statics.obtenerAnalisisDensidadPorDistrito = function(options = {}) {
  const { distrito, tipoContenedor, lote, includeBarrios = true } = options;

  const matchStage = {};
  if (distrito) {
    matchStage.distrito = distrito;
  }
  if (tipoContenedor) {
    matchStage.tipoContenedor = tipoContenedor;
  }
  if (lote !== undefined && lote !== null && lote !== '') {
    matchStage.lote = Number(lote);
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

  return this.aggregate(pipeline).option({ allowDiskUse: true });
};

// Crear y exportar el modelo
const Contenedor = mongoose.model('Contenedor', contenedorSchema);

module.exports = Contenedor;
