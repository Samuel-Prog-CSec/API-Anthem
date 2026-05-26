/**
 * Helper de conversion de coordenadas ETRS89/UTM30N <-> WGS84
 *
 * Los datasets de Smart City mezclan coordenadas UTM (sistema oficial
 * espanol EPSG:25830, zona 30N) con longitud/latitud (WGS84). Este
 * helper centraliza las transformaciones para poblar el campo
 * `geometry` GeoJSON cuando el CSV solo trae UTM, y viceversa.
 *
 * Se apoya en `proj4`, instalado como dependencia del backend.
 */

const proj4 = require('proj4');

const {
  VALIDATION_LIMITS,
  GEOMETRY_TYPES
} = require('../../../src/constants');

// ETRS89 / UTM zona 30N (uso oficial en la Espana peninsular).
const EPSG_ETRS89_UTM30N = 'EPSG:25830';
// WGS84 (lon/lat), sistema GeoJSON estandar.
const EPSG_WGS84 = 'EPSG:4326';

// Definicion explicita de proyecciones. proj4 trae EPSG:4326 por
// defecto, pero siempre registramos ambas para evitar sorpresas.
proj4.defs(EPSG_ETRS89_UTM30N,
  '+proj=utm +zone=30 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs +type=crs'
);
proj4.defs(EPSG_WGS84,
  '+proj=longlat +datum=WGS84 +no_defs +type=crs'
);

/**
 * Validar coordenada UTM peninsular espanola (zona 30N).
 * Utiliza rangos definidos en VALIDATION_LIMITS.
 *
 * @param {number} x
 * @param {number} y
 * @returns {boolean}
 */
function esUTMValida(x, y) {
  return (
    typeof x === 'number' &&
    typeof y === 'number' &&
    Number.isFinite(x) &&
    Number.isFinite(y) &&
    x >= VALIDATION_LIMITS.UTM_X_MIN &&
    x <= VALIDATION_LIMITS.UTM_X_MAX &&
    y >= VALIDATION_LIMITS.UTM_Y_MIN &&
    y <= VALIDATION_LIMITS.UTM_Y_MAX
  );
}

/**
 * Validar coordenada geografica WGS84.
 *
 * @param {number} lon
 * @param {number} lat
 * @returns {boolean}
 */
function esWGS84Valida(lon, lat) {
  return (
    typeof lon === 'number' &&
    typeof lat === 'number' &&
    Number.isFinite(lon) &&
    Number.isFinite(lat) &&
    lon >= VALIDATION_LIMITS.LONGITUDE_MIN &&
    lon <= VALIDATION_LIMITS.LONGITUDE_MAX &&
    lat >= VALIDATION_LIMITS.LATITUDE_MIN &&
    lat <= VALIDATION_LIMITS.LATITUDE_MAX
  );
}

/**
 * Convertir UTM ETRS89 zona 30N a lon/lat WGS84.
 *
 * CONTRATO: devuelve `null` cuando la entrada esta fuera de los rangos
 * definidos en `VALIDATION_LIMITS.UTM_*` o cuando el resultado WGS84
 * cae fuera de la peninsula. Es responsabilidad del caller comprobar
 * el null y decidir si rechazar la fila, dejar la geometria como
 * `undefined` (campo opcional) o registrar el caso en su tracker.
 *
 * @param {number} x - Coordenada X UTM (este)
 * @param {number} y - Coordenada Y UTM (norte)
 * @returns {{ lon: number, lat: number }|null}
 */
function utm30NToLatLon(x, y) {
  if (!esUTMValida(x, y)) {
    return null;
  }
  const [lon, lat] = proj4(EPSG_ETRS89_UTM30N, EPSG_WGS84, [x, y]);
  if (!esWGS84Valida(lon, lat)) {
    return null;
  }
  return { lon, lat };
}

/**
 * Convertir lon/lat WGS84 a UTM ETRS89 zona 30N.
 *
 * CONTRATO: devuelve `null` si las coordenadas WGS84 estan fuera de
 * rango o si el resultado UTM cae fuera del bbox peninsular.
 * Mismas reglas de manejo que `utm30NToLatLon`.
 *
 * @param {number} lat
 * @param {number} lon
 * @returns {{ x: number, y: number }|null}
 */
function latLonToUTM30N(lat, lon) {
  if (!esWGS84Valida(lon, lat)) {
    return null;
  }
  const [x, y] = proj4(EPSG_WGS84, EPSG_ETRS89_UTM30N, [lon, lat]);
  if (!esUTMValida(x, y)) {
    return null;
  }
  return { x, y };
}

/**
 * Construir un objeto `geometry` GeoJSON Point valido a partir de
 * UTM ETRS89 zona 30N.
 *
 * CONTRATO: devuelve `null` si la conversion falla (UTM fuera de rango
 * o resultado WGS84 invalido). El caller decide si:
 *   - rechazar la fila (track al RejectionTracker con motivo
 *     COORDENADAS_FUERA_DE_RANGO),
 *   - guardar la fila sin geometry (`geometry: undefined`, queda fuera
 *     del indice 2dsphere pero no rompe queries no geo),
 *   - re-intentar con otra fuente (campo lat/lon alternativo).
 *
 * @param {number} x - UTM X
 * @param {number} y - UTM Y
 * @returns {{ type: 'Point', coordinates: [number, number] }|null}
 */
function construirGeometryDesdeUTM(x, y) {
  const wgs = utm30NToLatLon(x, y);
  if (!wgs) {
    return null;
  }
  return {
    type: GEOMETRY_TYPES.POINT,
    coordinates: [wgs.lon, wgs.lat]
  };
}

/**
 * Construir GeoJSON Point a partir de lon/lat directos.
 *
 * CONTRATO: devuelve `null` si las coordenadas estan fuera del bbox
 * peninsular. Mismas reglas de manejo que `construirGeometryDesdeUTM`.
 *
 * @param {number} lon
 * @param {number} lat
 * @returns {{ type: 'Point', coordinates: [number, number] }|null}
 */
function construirGeometryDesdeWGS84(lon, lat) {
  if (!esWGS84Valida(lon, lat)) {
    return null;
  }
  return {
    type: GEOMETRY_TYPES.POINT,
    coordinates: [lon, lat]
  };
}

module.exports = {
  EPSG_ETRS89_UTM30N,
  EPSG_WGS84,
  esUTMValida,
  esWGS84Valida,
  utm30NToLatLon,
  latLonToUTM30N,
  construirGeometryDesdeUTM,
  construirGeometryDesdeWGS84
};
