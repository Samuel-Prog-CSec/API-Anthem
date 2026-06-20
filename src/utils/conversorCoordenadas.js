/**
 * Conversion de coordenadas WGS84 (lon/lat) <-> ETRS89 / UTM 30N.
 *
 * El modelo de Ubicaciones guarda coordenadas UTM (sistema oficial espanol,
 * EPSG:25830) ademas de la geometria GeoJSON. La ingesta IoT recibe lon/lat
 * (WGS84), por lo que necesitamos derivar la UTM para rellenar `coordenadas`.
 *
 * Se apoya en `proj4` (dependencia del backend). Existe un helper gemelo en
 * scripts/importation/helpers/conversorCoordenadas.js para los importadores
 * CSV; este vive en src/ para que el codigo de aplicacion no dependa de scripts.
 */

const proj4 = require('proj4');
const { VALIDATION_LIMITS } = require('../constants');

const EPSG_ETRS89_UTM30N = 'EPSG:25830';
const EPSG_WGS84 = 'EPSG:4326';

proj4.defs(EPSG_ETRS89_UTM30N,
  '+proj=utm +zone=30 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs +type=crs'
);
proj4.defs(EPSG_WGS84,
  '+proj=longlat +datum=WGS84 +no_defs +type=crs'
);

/** @returns {boolean} true si (lon, lat) son numeros finitos en rango WGS84. */
const esWGS84Valida = (lon, lat) =>
  Number.isFinite(lon) && Number.isFinite(lat) &&
  lon >= VALIDATION_LIMITS.LONGITUDE_MIN && lon <= VALIDATION_LIMITS.LONGITUDE_MAX &&
  lat >= VALIDATION_LIMITS.LATITUDE_MIN && lat <= VALIDATION_LIMITS.LATITUDE_MAX;

/** @returns {boolean} true si (x, y) caen en el bbox UTM peninsular. */
const esUTMValida = (x, y) =>
  Number.isFinite(x) && Number.isFinite(y) &&
  x >= VALIDATION_LIMITS.UTM_X_MIN && x <= VALIDATION_LIMITS.UTM_X_MAX &&
  y >= VALIDATION_LIMITS.UTM_Y_MIN && y <= VALIDATION_LIMITS.UTM_Y_MAX;

/**
 * Convierte lon/lat WGS84 a UTM ETRS89 zona 30N.
 * @param {number} lat
 * @param {number} lon
 * @returns {{x: number, y: number}|null} UTM redondeada a cm, o null si invalida
 */
const latLonAUTM30N = (lat, lon) => {
  if (!esWGS84Valida(lon, lat)) { return null; }
  const [x, y] = proj4(EPSG_WGS84, EPSG_ETRS89_UTM30N, [lon, lat]);
  if (!esUTMValida(x, y)) { return null; }
  return { x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100 };
};

module.exports = {
  esWGS84Valida,
  esUTMValida,
  latLonAUTM30N
};
