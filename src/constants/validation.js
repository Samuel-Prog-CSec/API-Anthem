/**
 * Constantes de validacion compartidas
 *
 * Limites de busqueda, rangos de fechas, limites por ruta, severidades
 * cross-domain (accidente, multa, calidad aire) y campos de ordenamiento.
 */

const SEVERITY_LEVELS = {
  ACCIDENT: {
    LEVE: 'LEVE',
    GRAVE: 'GRAVE',
    MORTAL: 'MORTAL',
    SIN_LESIONES: 'SIN_LESIONES'
  },
  FINE: {
    LEVE: 'LEVE',
    GRAVE: 'GRAVE',
    MUY_GRAVE: 'MUY_GRAVE'
  },
  AIR_QUALITY: {
    BUENA: 'BUENA',
    MODERADA: 'MODERADA',
    DAÑINA_GRUPOS_SENSIBLES: 'DAÑINA_GRUPOS_SENSIBLES',
    DAÑINA: 'DAÑINA',
    MUY_DAÑINA: 'MUY_DAÑINA',
    PELIGROSA: 'PELIGROSA'
  }
};

const SORT_FIELDS = {
  ACCIDENT: ['fecha', 'gravedad', 'distrito', 'tipoAccidente', 'numeroExpediente'],
  AIR_QUALITY: ['fecha', 'estacion', 'magnitud', 'provincia', 'municipio'],
  BIKE_AVAILABILITY: ['dia', 'fecha', 'totalUsos', 'mediaBicicletasDisponibles', 'horasTotalesUsos', 'horasTotalesDisponibilidad'],
  BIKE_CAPACITY: ['fecha', 'estacion', 'aforoEntradas', 'aforoSalidas'],
  CENSUS: ['fechaCenso', 'totalPoblacion', 'porcentajeExtranjeros', 'edad', 'distrito', 'barrio'],
  CONTAINER: ['tipoContenedor', 'distrito', 'barrio', 'direccion', 'lote'],
  FINE: ['fecha', 'importeFinal', 'puntosDetraídos', 'lugar', 'calificacion'],
  LOCATION: ['nombre', 'distrito', 'barrio', 'tipo'],
  NOISE_MONITORING: ['fecha', 'nmt', 'nombre', 'laeq24', 'nivelDiurno', 'nivelVespertino', 'nivelNocturno'],
  PARKING_OCCUPANCY: ['fecha', 'distrito', 'plazasTotales', 'plazasOcupadas'],
  SCOOTER_ASSIGNMENT: ['totalPatinetes', 'distrito', 'barrio', 'fecha', 'densidad', 'proveedor'],
  TRAFFIC: ['fecha', 'puntoMedidaId', 'intensidad', 'ocupacion', 'carga']
};

const DEFAULT_SORT_FIELDS = {
  FINE: 'fecha',
  SCOOTER_ASSIGNMENT: 'totalPatinetes',
  DEFAULT_ORDER: 'desc'
};

const SEARCH_LIMITS = {
  QUERY_MIN_LENGTH: 1,
  QUERY_MAX_LENGTH: 100,
  DISTRITO_MIN_LENGTH: 2,
  DISTRITO_MAX_LENGTH: 100,
  BARRIO_MIN_LENGTH: 2,
  BARRIO_MAX_LENGTH: 100,
  FIELDS_PATTERN: /^[a-zA-Z,_]+$/,
  SORTBY_PATTERN: /^[a-zA-Z][a-zA-Z0-9_]*$/,
  PATTERN_MIN_LENGTH: 1,
  PATTERN_MAX_LENGTH: 100
};

const DATE_RANGE_LIMITS = {
  DEFAULT_MAX_DAYS: 365,
  ACCIDENTS_MAX_DAYS: 730,
  AIR_QUALITY_MAX_DAYS: 730,
  NOISE_MAX_DAYS: 1825,
  // Multas: el dataset cubre meses, 1 ano de rango es suficiente para
  // analitica habitual y evita scans masivos sobre filtros poco selectivos
  FINES_MAX_DAYS: 365,
  // Trafico: las agregaciones (estadisticas/congestion/historico day-week-month/
  // mapa) leen del rollup diario `traffic_daily` (~1.5M docs), por lo que un ano
  // completo se resuelve en pocos segundos. El historico por HORA lee datos
  // crudos y se acota aparte a 2 dias en el controlador.
  TRAFFIC_MAX_DAYS: 365,
  MAX_MILLISECONDS_CALCULATION: 24 * 60 * 60 * 1000
};

// Caps absolutos de payload para endpoints `/mapa` y `/mapa-calor`.
// El frontend nunca renderiza mas de 1000 features simultaneas en Leaflet sin
// virtualizar/cluster, asi que este cap cubre todos los casos legitimos y
// previene queries patologicas que devuelvan miles de documentos.
const MAP_LIMITS = {
  DEFAULT_MAX: 1000, // generico para /mapa (FeatureCollection)
  HEATMAP_MAX: 500, // mapa de calor (cada punto es una agregacion mas costosa)
  MIN: 1
};

const ROUTE_SPECIFIC_LIMITS = {
  TRAFFIC: { PUNTO_MAX_LIMIT: 500 },
  NOISE: {
    YEAR_MIN: 1900, YEAR_MAX: 2100,
    MONTH_MIN: 1, MONTH_MAX: 12,
    TOP_N_MIN: 5, TOP_N_MAX: 50,
    LIMIT_MIN: 1, LIMIT_MAX: 100,
    POINT_LIMIT_MIN: 3, POINT_LIMIT_MAX: 50,
    DB_THRESHOLD_MIN: 40, DB_THRESHOLD_MAX: 100
  },
  CENSUS: {
    YEAR_MIN: 2000, YEAR_MAX: 3000,
    MONTH_MIN: 1, MONTH_MAX: 12,
    AGE_MIN: 0, AGE_MAX: 150,
    LIMIT_MIN: 1, LIMIT_MAX: 100
  },
  BIKE: {
    YEAR_MIN: 2050, YEAR_MAX: 2052,
    TOP_N_MIN: 1, TOP_N_MAX: 50,
    OCCUPANCY_MIN: 50, OCCUPANCY_MAX: 100
  },
  AIR: {
    PROVINCIA_MIN: 1, PROVINCIA_MAX: 99,
    LIMIT_MIN: 1, LIMIT_MAX: 100
  },
  FINES: {
    POINTS_MIN: 0, POINTS_MAX: 12,
    LIMIT_MIN: 1, LIMIT_MAX: 100,
    TOP_N_MIN: 1, TOP_N_MAX: 50
  },
  LOCATIONS: {
    LIMIT_MIN: 1, LIMIT_MAX: 1000,
    DISTANCE_MIN: 100, DISTANCE_MAX: 50000
  },
  SCOOTER: {
    PAGE_MIN: 1, PAGE_MAX: 1000,
    LIMIT_MIN: 1, LIMIT_MAX: 100,
    PROVIDER_MIN_LENGTH: 2, PROVIDER_MAX_LENGTH: 30,
    DISTRICT_MIN_LENGTH: 2, DISTRICT_MAX_LENGTH: 50,
    NEIGHBORHOOD_MIN_LENGTH: 2, NEIGHBORHOOD_MAX_LENGTH: 50,
    PATINETES_MIN: 0, PATINETES_MAX: 1000,
    DISPONIBLES_MIN: 0, DISPONIBLES_MAX: 1000,
    TOP_N_MIN: 1, TOP_N_MAX: 50
  },
  CONTAINERS: {
    LOTE_MIN: 1, LOTE_MAX: 3,
    SEARCH_MAX_LIMIT: 200
  },
  ACCIDENTS: {
    DISTANCE_MIN: 100, DISTANCE_MAX: 1000
  },
  ADMIN: {
    PATTERN_MIN_LENGTH: 1, PATTERN_MAX_LENGTH: 100,
    MEMORY_THRESHOLD_MB: 500,
    MEMORY_THRESHOLD_BYTES: 500 * 1024 * 1024
  }
};

const VALIDATION_LIMITS = {
  MONTH_MIN: 1, MONTH_MAX: 12,
  DAY_MIN: 1, DAY_MAX: 31,
  HOUR_MIN: 0, HOUR_MAX: 23,
  MINUTE_MIN: 0, MINUTE_MAX: 59,
  YEAR_MIN: 2000, YEAR_MAX: 3000,
  AGE_MIN: 0, AGE_MAX: 120,
  PERCENTAGE_MIN: 0, PERCENTAGE_MAX: 100,
  RATIO_MIN: 0,
  SCORE_MIN: 0, SCORE_MAX: 1,
  LATITUDE_MIN: -90, LATITUDE_MAX: 90,
  LONGITUDE_MIN: -180, LONGITUDE_MAX: 180,
  UTM_X_MIN: 100000, UTM_X_MAX: 1000000,
  UTM_Y_MIN: 3000000, UTM_Y_MAX: 5000000,
  SPEED_MIN: 0, SPEED_MAX: 300,
  NOISE_MIN: 0, NOISE_MAX: 150,
  DRIVER_POINTS_MIN: 0, DRIVER_POINTS_MAX: 12,
  QUANTITY_MIN: 0,
  QUANTITY_POSITIVE_MIN: 1,
  TRAFFIC_INTENSITY_MIN: 0, TRAFFIC_INTENSITY_MAX: 10000,
  TRAFFIC_OCCUPANCY_MIN: 0, TRAFFIC_OCCUPANCY_MAX: 100
};

module.exports = {
  SEVERITY_LEVELS,
  SORT_FIELDS,
  DEFAULT_SORT_FIELDS,
  SEARCH_LIMITS,
  DATE_RANGE_LIMITS,
  ROUTE_SPECIFIC_LIMITS,
  VALIDATION_LIMITS,
  MAP_LIMITS
};
