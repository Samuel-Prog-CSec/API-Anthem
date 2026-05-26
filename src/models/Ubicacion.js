const mongoose = require('mongoose');
const { coordinatesUTMSchema } = require('./schemas/commonSchemas');
const {
  LOCATION_TYPES,
  GEOMETRY_TYPES,
  UTM_ZONES,
  TRAFFIC_ELEMENT_TYPES,
  DEFAULT_UTM_ZONE,
  VALIDATION_LIMITS
} = require('../constants');
/**
 * Esquema para las ubicaciones de infraestructura y puntos de medición
 * Modelo mejorado con validaciones y métodos geoespaciales
 */
const locationSchema = new mongoose.Schema({
  // Identificación
  tipo: {
    type: String,
    enum: Object.values(LOCATION_TYPES),
    required: true,
    index: true
  },

  // Datos específicos para estaciones acústicas
  nmt: {
    type: String, // Número de estación de monitorización
    index: true,
    sparse: true,
    validate: {
      validator: function(v) {
        return this.tipo !== LOCATION_TYPES.ESTACION_ACUSTICA || (v && v.length > 0);
      },
      message: 'Las estaciones acústicas requieren nmt'
    }
  },

  // Datos específicos para puntos de tráfico
  cod_cent: {
    type: String,
    sparse: true
  },

  id_punto: {
    type: String,
    index: true,
    sparse: true,
    validate: {
      validator: function(v) {
        return this.tipo !== LOCATION_TYPES.PUNTO_TRAFICO || (v && v.length > 0);
      },
      message: 'Los puntos de tráfico requieren id_punto'
    }
  },

  tipo_elem: {
    type: String,
    enum: [...Object.values(TRAFFIC_ELEMENT_TYPES), null],
    sparse: true
  },

  // Codigo de distrito (para puntos de trafico)
  // Usado en analisis de congestion por zona
  distrito: {
    type: Number,
    index: true,
    sparse: true,
    min: [1, 'Codigo de distrito debe ser mayor a 0'],
    max: [21, 'Codigo de distrito debe ser menor o igual a 21'] // Madrid tiene 21 distritos
  },

  // Informacion general
  nombre: {
    type: String,
    trim: true,
    index: true
  },

  descripcion: {
    type: String,
    trim: true
  },

  // Coordenadas UTM (Universal Transverse Mercator)
  // Sistema de coordenadas oficial para España
  coordenadas: coordinatesUTMSchema,

  // Para rutas GPX, almacenaremos arrays de puntos
  ruta: [{
    lat: {
      type: Number
    },
    lon: {
      type: Number
    },
    elevation: {
      type: Number
    }
  }],

  // Zona UTM (España tiene zonas 29, 30 y 31)
  zonaUTM: {
    type: Number,
    enum: UTM_ZONES,
    default: DEFAULT_UTM_ZONE // La mayoría de Madrid está en zona 30
  },

  // Para analisis geoespacial con GeoJSON
  // NOTA: No todos los registros tienen coordenadas geograficas validas (algunos solo UTM)
  // Por eso geometry no es requerido - las queries geoespaciales solo funcionaran
  // con registros que tengan geometry definido
  geometry: {
    type: {
      type: String,
      enum: Object.values(GEOMETRY_TYPES),
      default: GEOMETRY_TYPES.POINT
    },
    coordinates: {
      type: mongoose.Schema.Types.Mixed, // Mixed para soportar Point [lng, lat] y LineString [[lng, lat], ...]
      required: false, // No requerido - algunos registros solo tienen coordenadas UTM
      validate: {
        validator: function(coords) {
          // Permitir undefined/null (campo opcional)
          if (coords === undefined || coords === null) {
            return true;
          }

          const geomType = this.geometry?.type || GEOMETRY_TYPES.POINT;

          if (geomType === GEOMETRY_TYPES.POINT) {
            // Point requiere exactamente 2 coordenadas [lng, lat]
            if (!Array.isArray(coords) || coords.length !== 2) {
              return false;
            }
            // Validar rangos: lng entre -180 y 180, lat entre -90 y 90
            const [lng, lat] = coords;
            return typeof lng === 'number' && typeof lat === 'number' &&
                   lng >= VALIDATION_LIMITS.LONGITUDE_MIN && lng <= VALIDATION_LIMITS.LONGITUDE_MAX &&
                   lat >= VALIDATION_LIMITS.LATITUDE_MIN && lat <= VALIDATION_LIMITS.LATITUDE_MAX;
          }

          if (geomType === GEOMETRY_TYPES.LINE_STRING) {
            // LineString requiere array de arrays, minimo 2 puntos
            if (!Array.isArray(coords) || coords.length < 2) {
              return false;
            }
            // Validar que cada punto tenga 2 coordenadas validas
            return coords.every(point => {
              if (!Array.isArray(point) || point.length !== 2) {return false;}
              const [lng, lat] = point;
              return typeof lng === 'number' && typeof lat === 'number' &&
                     lng >= VALIDATION_LIMITS.LONGITUDE_MIN && lng <= VALIDATION_LIMITS.LONGITUDE_MAX &&
                     lat >= VALIDATION_LIMITS.LATITUDE_MIN && lat <= VALIDATION_LIMITS.LATITUDE_MAX;
            });
          }

          return false;
        },
        message: 'Coordenadas invalidas: Point requiere [lng, lat], LineString requiere array de [lng, lat] (minimo 2 puntos)'
      }
    }
  },

  // Estado y metadatos
  activo: {
    type: Boolean,
    default: true,
    index: true
  },

  fechaInstalacion: {
    type: Date
  },

  ultimaActualizacion: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true,
  collection: 'locations'
});

// Transformación de salida para reducir payload
locationSchema.set('toJSON', {
  transform: (_doc, ret) => {
    delete ret.createdAt;
    delete ret.updatedAt;
    delete ret.__v;
    return ret;
  }
});

/**
 * Índices para optimización de consultas
 */

// ========================================
// ÍNDICE GEOESPACIAL - Búsquedas por proximidad
// ========================================
// Índice 2dsphere para geometría GeoJSON
// Usado en: Búsquedas $near, $geoWithin para ubicaciones
// Soporta: Mapas interactivos, rutas cercanas, puntos de interés
// Tipos: Point, LineString para sensores de tráfico, rutas de transporte, etc.
// CRÍTICO: Necesario para queries geográficas con GeoJSON
locationSchema.index({ geometry: '2dsphere' });

// ========================================
// ÍNDICES PRINCIPALES - Consultas frecuentes
// ========================================

// Índice compuesto: tipo + coordenadas UTM
// Usado en: GET /api/locations?tipo=PUNTO_TRAFICO
// Soporta: Búsqueda de ubicaciones específicas por tipo y coordenadas
// Tipos: PUNTO_TRAFICO, ESTACION_MEDIDA_ACUSTICA, RUTA_TRANSPORTE, etc.
locationSchema.index({
  tipo: 1,
  'coordenadas.x': 1,
  'coordenadas.y': 1
});

// Índice compuesto: tipo + activo
// Usado en: GET /api/locations?tipo=X&activo=true
// Soporta: Filtrado de ubicaciones activas
// Ejemplo: "Puntos de medida de tráfico activos"
locationSchema.index({
  tipo: 1,
  activo: 1
});

// ========================================
// ÍNDICE DE BÚSQUEDA TEXTUAL
// ========================================
// Índice de texto completo para búsquedas flexibles
// Usado en: Búsqueda con $text por nombre, descripción
// Soporta: "Buscar sensor en Chamberí", autocompletado
locationSchema.index({
  nombre: 'text',
  descripcion: 'text'
});

/**
 * Middleware pre-save para cálculos
 */
locationSchema.pre('save', function(next) {
  // Actualizar timestamp
  this.ultimaActualizacion = new Date();
  return next();
});

/**
 * Query Builder optimizado para búsquedas con filtros flexibles (PATRÓN HÍBRIDO)
 *
 * Encapsula lógica de queries geoespaciales y filtros complejos manteniendo optimizaciones:
 * - .lean() para +40% rendimiento
 * - Promise.all() para ejecución paralela
 * - Proyecciones dinámicas
 * - Queries geoespaciales optimizadas con índice 2dsphere
 *
 * @param {Object} options - Objeto de configuración
 * @param {Object} options.filters - Filtros MongoDB base (tipo, activo, etc.)
 * @param {Object} options.geoQuery - Query geoespacial opcional
 * @param {Object} options.geoQuery.coordinates - [longitude, latitude]
 * @param {Number} options.geoQuery.maxDistance - Distancia máxima en metros
 * @param {Object} options.sort - Opciones de ordenamiento
 * @param {Object} options.pagination - { skip, limit }
 * @param {Object} options.projection - Campos a incluir (opcional)
 * @param {Boolean} options.lean - Usar .lean() para performance (default: true)
 * @param {Boolean} options.includeStats - Incluir estadísticas agregadas (default: false)
 * @returns {Promise<Object>} { data, total, stats }
 *
 * @example
 * // Búsqueda geoespacial con filtros
 * const resultado = await Location.buscarConOpciones({
 *   filters: { tipo: 'punto_trafico', activo: true },
 *   geoQuery: { coordinates: [-3.7038, 40.4168], maxDistance: 1000 },
 *   sort: { nombre: 1 },
 *   pagination: { skip: 0, limit: 50 },
 *   lean: true,
 *   includeStats: true
 * });
 *
 * @example
 * // Búsqueda simple sin geolocalización
 * const resultado = await Location.buscarConOpciones({
 *   filters: { activo: true },
 *   sort: { nombre: 1 },
 *   pagination: { skip: 0, limit: 50 }
 * });
 */
locationSchema.statics.buscarConOpciones = async function(options) {
  const {
    filters = {},
    geoQuery = null,
    sort = { nombre: 1 },
    pagination = { skip: 0, limit: 50 },
    projection = null,
    lean = true,
    includeStats = false
  } = options;

  // Combinar filtros base con query geoespacial si existe
  const finalFilters = { ...filters };

  if (geoQuery && geoQuery.coordinates) {
    finalFilters.geometry = {
      $near: {
        $geometry: {
          type: GEOMETRY_TYPES.POINT,
          coordinates: geoQuery.coordinates // [longitude, latitude]
        },
        $maxDistance: geoQuery.maxDistance || 1000
      }
    };
  }

  // Construir query principal
  let query = this.find(finalFilters, projection)
    .sort(sort)
    .skip(pagination.skip)
    .limit(pagination.limit);

  // Aplicar .lean() para performance
  if (lean) {
    query = query.lean();
  }

  // Array de promises para ejecución paralela
  const promises = [
    query.exec(),
    this.countDocuments(finalFilters)
  ];

  // Agregar stats solo si se solicitan explícitamente
  if (includeStats) {
    promises.push(
      this.aggregate([
        { $match: finalFilters },
        {
          $group: {
            _id: null,
            totalRegistros: { $sum: 1 },
            tiposUnicos: { $addToSet: '$tipo' },
            totalActivos: {
              $sum: { $cond: ['$activo', 1, 0] }
            }
          }
        }
      ])
    );
  }

  // Ejecutar todas las queries en paralelo
  const results = await Promise.all(promises);

  return {
    data: results[0],
    total: results[1],
    stats: includeStats && results[2] && results[2][0] ? results[2][0] : null
  };
};

module.exports = mongoose.model('Locations', locationSchema);
