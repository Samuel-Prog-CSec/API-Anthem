/**
 * Helper para construir respuestas GeoJSON (RFC 7946).
 *
 * Todos los endpoints `/mapa` de la API devuelven un FeatureCollection
 * estandar consumible por librerias cartograficas (Leaflet, MapLibre,
 * Mapbox GL, OpenLayers, etc.). Este helper centraliza el formato para
 * garantizar consistencia entre recursos (ubicaciones, accidentes,
 * patinetes, aforo-bicicletas, ruido y multas).
 */

const { GEOMETRY_TYPES } = require('../constants');

/**
 * Calcular bounding box [minLng, minLat, maxLng, maxLat] a partir de un
 * array de features. Devuelve null si no hay features con geometria.
 *
 * @param {Array<Object>} features - Array de Feature GeoJSON
 * @returns {Array<number>|null}
 */
function calcularBbox(features) {
  if (!features || features.length === 0) {
    return null;
  }
  const acc = {
    minLng: Infinity,
    minLat: Infinity,
    maxLng: -Infinity,
    maxLat: -Infinity,
    tienePuntos: false
  };

  // Extraido como helper local para reducir niveles de anidamiento en el bucle
  const expandirBbox = (lng, lat) => {
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) {return;}
    acc.tienePuntos = true;
    if (lng < acc.minLng) {acc.minLng = lng;}
    if (lng > acc.maxLng) {acc.maxLng = lng;}
    if (lat < acc.minLat) {acc.minLat = lat;}
    if (lat > acc.maxLat) {acc.maxLat = lat;}
  };

  for (const feature of features) {
    const geom = feature?.geometry;
    if (!geom || !geom.coordinates) {continue;}

    if (geom.type === GEOMETRY_TYPES.POINT) {
      const [lng, lat] = geom.coordinates;
      expandirBbox(lng, lat);
    } else if (geom.type === GEOMETRY_TYPES.LINE_STRING && Array.isArray(geom.coordinates)) {
      for (const coord of geom.coordinates) {
        if (!Array.isArray(coord) || coord.length < 2) {continue;}
        expandirBbox(coord[0], coord[1]);
      }
    }
  }

  return acc.tienePuntos ? [acc.minLng, acc.minLat, acc.maxLng, acc.maxLat] : null;
}

/**
 * Construir un Feature GeoJSON a partir de un documento Mongoose.
 *
 * @param {Object} geometry - Objeto geometry valido { type, coordinates }
 * @param {Object} properties - Propiedades del feature
 * @param {string|number} [id] - Identificador opcional
 * @returns {Object} Feature GeoJSON
 */
function construirFeature(geometry, properties, id) {
  const feature = {
    type: 'Feature',
    geometry,
    properties: properties || {}
  };
  if (id !== undefined && id !== null) {
    feature.id = id;
  }
  return feature;
}

/**
 * Construir una respuesta FeatureCollection GeoJSON estandar.
 *
 * Estructura:
 *   {
 *     type: 'FeatureCollection',
 *     features: [...],
 *     metadata: { total, bbox, generadoEn }
 *   }
 *
 * @param {Array<Object>} features - Array de features ya construidos
 * @param {Object} [metadataExtra] - Metadatos adicionales del recurso
 * @returns {Object} FeatureCollection GeoJSON
 */
function construirFeatureCollection(features, metadataExtra = {}) {
  const items = Array.isArray(features) ? features : [];
  const bbox = calcularBbox(items);

  const featureCollection = {
    type: 'FeatureCollection',
    features: items,
    metadata: {
      total: items.length,
      generadoEn: new Date().toISOString(),
      ...metadataExtra
    }
  };

  if (bbox) {
    featureCollection.bbox = bbox;
    featureCollection.metadata.bbox = bbox;
  }

  return featureCollection;
}

/**
 * Helper de conveniencia: dado un array de documentos Mongoose lean(),
 * construye un FeatureCollection aplicando una funcion que extrae
 * geometry + properties de cada documento.
 *
 * @param {Array<Object>} docs - Documentos fuente
 * @param {Function} extractor - Funcion (doc) => { geometry, properties, id }
 * @param {Object} [metadataExtra]
 * @returns {Object}
 */
function documentosAFeatureCollection(docs, extractor, metadataExtra = {}) {
  const features = [];
  for (const doc of docs) {
    const extracted = extractor(doc);
    if (!extracted || !extracted.geometry) {continue;}
    features.push(
      construirFeature(extracted.geometry, extracted.properties, extracted.id)
    );
  }
  return construirFeatureCollection(features, metadataExtra);
}

module.exports = {
  calcularBbox,
  construirFeature,
  construirFeatureCollection,
  documentosAFeatureCollection
};
