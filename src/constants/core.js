/**
 * Constantes core compartidas de infraestructura
 *
 * Codigos HTTP, paginacion, timeouts, periodos temporales y otras utilidades
 * transversales que no pertenecen a un dominio concreto. Mantenidas en ingles
 * por convencion de "infraestructura compartida".
 */

const HTTP_STATUS = {
  OK: 200,
  CREATED: 201,
  NO_CONTENT: 204,
  NOT_MODIFIED: 304,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  REQUEST_TIMEOUT: 408,
  CONFLICT: 409,
  PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 415,
  UNPROCESSABLE_ENTITY: 422,
  LOCKED: 423,
  TOO_MANY_REQUESTS: 429,
  INTERNAL_SERVER_ERROR: 500,
  SERVICE_UNAVAILABLE: 503
};

const PAGINATION = {
  DEFAULT_PAGE: 1,
  DEFAULT_LIMIT: 50,
  MIN_LIMIT: 1,
  MAX_LIMIT: 100,
  MAX_PAGE: 1000
};

const MONGODB_TIMEOUTS = {
  QUERY_TIMEOUT_MS: 5000,
  AGGREGATE_TIMEOUT_MS: 10000,
  // Agregaciones pesadas (p.ej. estadisticas de trafico con $facet sobre el
  // rango de 7 dias en ~132M docs): margen mayor para completar dentro del
  // timeout de axios (30s) en vez de devolver 500 por exceder el limite.
  AGGREGATE_TIMEOUT_HEAVY_MS: 25000
};

const AGGREGATION_LIMITS = {
  SMALL: 1000,
  MEDIUM: 5000,
  LARGE: 10000,
  XLARGE: 50000,
  TOP_RESULTS: 50,
  PREVIEW: 5,
  MONTHLY_STATS: 12
};

const SPECIAL_PAGINATION_LIMITS = {
  LOCATIONS: { DEFAULT: 100, MAX: 500 },
  CONTAINERS: { DEFAULT: 100, SEARCH_MAX: 200 },
  BIKES: { DEFAULT: 100 }
};

const DEFAULT_VALUES = {
  UNSPECIFIED: 'SIN ESPECIFICAR'
};

const TIME_CONSTANTS = {
  HOURS_PER_DAY: 24,
  MINUTES_PER_HOUR: 60,
  SECONDS_PER_MINUTE: 60,
  MILLISECONDS_PER_SECOND: 1000,
  DAYS_PER_WEEK: 7,
  MONTHS_PER_YEAR: 12,
  DAYS_PER_YEAR: 365,
  MILLISECONDS_PER_DAY: 24 * 60 * 60 * 1000,
  MILLISECONDS_PER_HOUR: 60 * 60 * 1000,
  MILLISECONDS_PER_MINUTE: 60 * 1000
};

const TIME_PERIODS = {
  HOUR: 'HORA',
  DAY: 'DIA',
  WEEK: 'SEMANA',
  MONTH: 'MES',
  YEAR: 'ANIO'
};

const DAYS_OF_WEEK = [
  'Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'
];

const DAY_PERIODS = {
  MADRUGADA: 'MADRUGADA',
  MAÑANA: 'MAÑANA',
  MEDIODIA: 'MEDIODIA',
  TARDE: 'TARDE',
  NOCHE: 'NOCHE'
};

const WORKDAY_TYPES = {
  LABORABLE: 'LABORABLE',
  SABADO: 'SABADO',
  DOMINGO_FESTIVO: 'DOMINGO_FESTIVO'
};

const MONTH_NAMES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
];

const BINARY_INDICATORS = {
  YES: 'S',
  NO: 'N',
  YES_FULL: 'SI',
  NO_FULL: 'NO',
  NUMERIC_TRUE: '1',
  NUMERIC_FALSE: '0',
  NULL: 'NULL',
  TRUE: 'true',
  FALSE: 'false'
};

const VALIDATION_CODES = {
  VALID: 'V',
  INVALID: 'N'
};

// Whitelist de parametros HTTP que legitimamente pueden ser arrays.
// Solo incluir parametros que REALMENTE necesitan soportar arrays multiples.
const HPP_ARRAY_PARAMS_WHITELIST = [
  'id', 'ids',
  'status', 'tipo', 'tipoContenedor', 'tipoAccidente', 'tipoVehiculo', 'tipoInfraccion',
  'distrito', 'barrio',
  'magnitud', 'estacion',
  'nmt', 'stations', 'stations[]',
  'calificacion',
  'gravedad',
  'startDate', 'endDate',
  'fields'
];

module.exports = {
  HTTP_STATUS,
  PAGINATION,
  MONGODB_TIMEOUTS,
  AGGREGATION_LIMITS,
  SPECIAL_PAGINATION_LIMITS,
  DEFAULT_VALUES,
  TIME_CONSTANTS,
  TIME_PERIODS,
  DAYS_OF_WEEK,
  DAY_PERIODS,
  WORKDAY_TYPES,
  MONTH_NAMES,
  BINARY_INDICATORS,
  VALIDATION_CODES,
  HPP_ARRAY_PARAMS_WHITELIST
};
