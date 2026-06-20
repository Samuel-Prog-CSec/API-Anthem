/**
 * Helper de construccion de ubicacion para los endpoints de ingesta de aforo
 * (bicicletas y peatones).
 *
 * Normaliza los campos de direccion y construye la geometria GeoJSON WGS84
 * SOLO cuando las coordenadas son validas. Nunca debe crearse un geometry
 * vacio `{ type: 'Point' }` sin `coordinates`: rompe el indice 2dsphere sparse
 * (error "Can't extract geo keys") y aborta la operacion.
 */

const { GEOMETRY_TYPES, VALIDATION_LIMITS } = require('../constants');

/**
 * Comprueba que (lng, lat) son numeros finitos dentro de los rangos validos.
 *
 * @param {number} lng - Longitud
 * @param {number} lat - Latitud
 * @returns {boolean}
 */
const esCoordenadaValida = (lng, lat) =>
  Number.isFinite(lng) &&
  Number.isFinite(lat) &&
  lng >= VALIDATION_LIMITS.LONGITUDE_MIN && lng <= VALIDATION_LIMITS.LONGITUDE_MAX &&
  lat >= VALIDATION_LIMITS.LATITUDE_MIN && lat <= VALIDATION_LIMITS.LATITUDE_MAX;

/**
 * Construye el subdocumento `ubicacion` de un documento de aforo a partir de la
 * ubicacion recibida en la lectura del sensor.
 *
 * @param {Object} [ubic={}] - Ubicacion de entrada
 * @param {number} [ubic.numeroDistrito]
 * @param {string} [ubic.distrito]
 * @param {string} [ubic.nombreVial]
 * @param {string} [ubic.numero]
 * @param {string} [ubic.codigoPostal]
 * @param {string} [ubic.observacionesDireccion]
 * @param {Object} [ubic.coordenadas] - { latitud, longitud }
 * @returns {Object} Subdocumento `ubicacion` listo para persistir
 */
const construirUbicacionAforo = (ubic = {}) => {
  const lat = ubic.coordenadas && ubic.coordenadas.latitud != null ? Number(ubic.coordenadas.latitud) : null;
  const lng = ubic.coordenadas && ubic.coordenadas.longitud != null ? Number(ubic.coordenadas.longitud) : null;

  const ubicacion = {
    numeroDistrito: ubic.numeroDistrito != null ? Number(ubic.numeroDistrito) : undefined,
    // El schema aplica uppercase/trim, pero lo normalizamos aqui tambien para
    // que el valor persistido sea consistente en operaciones de update.
    distrito: ubic.distrito ? String(ubic.distrito).trim().toUpperCase() : undefined,
    nombreVial: ubic.nombreVial ? String(ubic.nombreVial).trim() : undefined,
    numero: ubic.numero != null ? String(ubic.numero).trim() : undefined,
    codigoPostal: ubic.codigoPostal != null ? String(ubic.codigoPostal).trim() : undefined,
    observacionesDireccion: ubic.observacionesDireccion ? String(ubic.observacionesDireccion).trim() : undefined,
    coordenadas: (lat != null && lng != null) ? { latitud: lat, longitud: lng } : undefined
  };

  if (esCoordenadaValida(lng, lat)) {
    ubicacion.geometry = { type: GEOMETRY_TYPES.POINT, coordinates: [lng, lat] };
  }

  return ubicacion;
};

module.exports = {
  construirUbicacionAforo,
  esCoordenadaValida
};
