const mongoose = require('mongoose');

/**
 * Esquema para las ubicaciones de infraestructura y puntos de medición
 */
const locationSchema = new mongoose.Schema({
  // Identificación
  tipo: {
    type: String,
    enum: [
      'estacion_acustica',
      'punto_trafico',
      'ruta_cercanias',
      'ruta_autobus',
      'ruta_interurbano',
      'ruta_metro',
      'ruta_metro_ligero',
      'zona_taxi'
    ],
    required: true,
    index: true
  },

  // Datos específicos para estaciones acústicas
  nmt: {
    type: String, // Número de estación de monitorización
    index: true
  },

  // Datos específicos para puntos de tráfico
  cod_cent: String,
  id_punto: String,
  tipo_elem: {
    type: String,
    enum: ['URB', 'M-30']
  },

  // Información general
  nombre: String,
  descripcion: String,

  // Coordenadas
  coordenadas: {
    x: {
      type: Number,
      required: true,
      index: true
    },
    y: {
      type: Number,
      required: true,
      index: true
    },
    // Para rutas GPX, almacenaremos arrays de puntos
    ruta: [{
      lat: Number,
      lon: Number,
      elevation: Number
    }]
  },

  // Metadatos
  distrito: String,
  barrio: String,

  // Para análisis geoespacial
  geometry: {
    type: {
      type: String,
      enum: ['Point', 'LineString'],
      default: 'Point'
    },
    coordinates: {
      type: [Number], // [longitude, latitude] para Point, array de arrays para LineString
      index: '2dsphere' // Índice geoespacial
    }
  }
}, {
  timestamps: true,
  collection: 'locations'
});

// Índices compuestos para consultas geoespaciales
locationSchema.index({
  tipo: 1,
  'coordenadas.x': 1,
  'coordenadas.y': 1
});

// Índice geoespacial 2dsphere para consultas avanzadas
locationSchema.index({
  geometry: '2dsphere' // Geometría para consultas geoespaciales
});

module.exports = mongoose.model('Locations', locationSchema);
