/**
 * Constantes geograficas
 *
 * Tipos de ubicaciones, geometrias GeoJSON, zonas UTM y limites de
 * coordenadas para validaciones de proximidad y bounding box.
 */

const LOCATION_TYPES = {
  ESTACION_ACUSTICA: 'estacion_acustica',
  PUNTO_TRAFICO: 'punto_trafico',
  RUTA_CERCANIAS: 'ruta_cercanias',
  RUTA_AUTOBUS: 'ruta_autobus',
  RUTA_INTERURBANO: 'ruta_interurbano',
  RUTA_METRO: 'ruta_metro',
  RUTA_METRO_LIGERO: 'ruta_metro_ligero',
  ZONA_TAXI: 'zona_taxi'
};

const GEOMETRY_TYPES = {
  POINT: 'Point',
  LINE_STRING: 'LineString'
};

const UTM_ZONES = [29, 30, 31];
const DEFAULT_UTM_ZONE = 30;

const GEO_LIMITS = {
  LONGITUDE_MIN: -180,
  LONGITUDE_MAX: 180,
  LATITUDE_MIN: -90,
  LATITUDE_MAX: 90,
  MIN_DISTANCE_METERS: 50,
  MAX_DISTANCE_METERS: 5000,
  DEFAULT_DISTANCE_METERS: 500
};

module.exports = {
  LOCATION_TYPES,
  GEOMETRY_TYPES,
  UTM_ZONES,
  DEFAULT_UTM_ZONE,
  GEO_LIMITS
};
