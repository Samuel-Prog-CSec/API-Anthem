/**
 * Constantes de la API REST
 *
 * Constantes centralizadas para toda la API REST.
 * Elimina valores duplicados de múltiples archivos.
 *
 * IMPORTANTE: Este archivo es la única fuente de verdad para constantes
 * compartidas entre modelos, controllers, middleware y utils.
 *
 * NO modificar valores sin verificar su uso en toda la aplicación.
 */

/**
 * Niveles de severidad/gravedad por tipo de dato
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

/**
 * Campos válidos para ordenamiento por tipo de entidad
 * Usado por queryHelper.buildSortOptions()
 */
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
  SCOOTER_ASSIGNMENT: ['fecha', 'distrito', 'proveedor', 'numeroPatinetes', 'disponibles', 'enUso'],
  TRAFFIC: ['fecha', 'puntoMedidaId', 'intensidad', 'ocupacion', 'carga']
};

/**
 * Configuración de paginación
 * Valores por defecto y límites
 */
const PAGINATION = {
  DEFAULT_PAGE: 1,
  DEFAULT_LIMIT: 50,
  MIN_LIMIT: 1,
  MAX_LIMIT: 100,
  MAX_PAGE: 1000
};

/**
 * Límites para agregaciones de MongoDB
 * Usados en pipelines de agregación para prevenir problemas de memoria
 */
const AGGREGATION_LIMITS = {
  SMALL: 1000,        // Para aggregations pequeñas (proximidad, detalles)
  MEDIUM: 5000,       // Para aggregations medianas (estadísticas de punto único)
  LARGE: 10000,       // Para aggregations grandes (estadísticas generales)
  XLARGE: 50000,      // Para aggregations muy grandes (análisis masivos)
  TOP_RESULTS: 50,    // Límite para rankings/tops
  PREVIEW: 5          // Límite para vistas previas
};

/**
 * Límites especiales de paginación por entidad
 * Algunos endpoints necesitan límites diferentes por naturaleza de datos
 */
const SPECIAL_PAGINATION_LIMITS = {
  LOCATIONS: {
    DEFAULT: 100,     // Más puntos geográficos por defecto
    MAX: 500          // Límite alto para mapas
  },
  CONTAINERS: {
    DEFAULT: 100,     // Muchos contenedores en la ciudad
    SEARCH_MAX: 200   // Límite para búsquedas de contenedores
  },
  BIKES: {
    DEFAULT: 100      // Muchas estaciones de bicicletas
  }
};

/**
 * Tipos de accidentes válidos
 * Deben coincidir con el enum del modelo Accident.js
 * Valores extraídos del CSV Anthem_CTC_Accidentalidad.csv
 */
const ACCIDENT_TYPES = [
  'ALCANCE',
  'ATROPELLO_ANIMAL',
  'ATROPELLO_PERSONA',
  'CAIDA',
  'CHOQUE_OBSTACULO_FIJO',
  'COLISION_FRONTAL',
  'COLISION_FRONTO_LATERAL',
  'COLISION_LATERAL',
  'COLISION_MULTIPLE',
  'DESPENAMIENTO',
  'OTRO',
  'SOLO_SALIDA_VIA',
  'VUELCO'
];

/**
 * Tipos de vehículos
 * Deben coincidir con el enum del modelo Accident.js
 * Valores completos extraídos del CSV Anthem_CTC_Accidentalidad.csv
 */
const VEHICLE_TYPES = [
  'AMBULANCIA',
  'AUTOBUS',
  'AUTOBUS_ARTICULADO',
  'AUTOBUS_ARTICULADO_EMT',
  'AUTOBUS_EMT',
  'AUTOCARAVANA',
  'BICICLETA',
  'BICICLETA_EPAC',
  'CAMION_BOMBEROS',
  'CAMION_RIGIDO',
  'CICLO',
  'CICLOMOTOR',
  'CICLOMOTOR_DOS_RUEDAS_L1EB',
  'CICLOMOTOR_TRES_RUEDAS',
  'CUADRICICLO_LIGERO',
  'CUADRICICLO_NO_LIGERO',
  'FURGONETA',
  'MAQUINARIA_AGRICOLA',
  'MAQUINARIA_OBRAS',
  'MOTOCICLETA_HASTA_125CC',
  'MOTOCICLETA_MAS_125CC',
  'MOTO_TRES_RUEDAS_HASTA_125CC',
  'MOTO_TRES_RUEDAS_MAS_125CC',
  'OTROS_CON_MOTOR',
  'OTROS_SIN_MOTOR',
  'PATINETE',
  'REMOLQUE',
  'SEMIREMOLQUE',
  'SIN_ESPECIFICAR',
  'TAXI',
  'TODO_TERRENO',
  'TRACTOCAMION',
  'TREN_METRO',
  'TURISMO',
  'VEHICULO_ARTICULADO',
  'VMU_ELECTRICO'
];

/**
 * Magnitudes de calidad de aire
 * IMPORTANTE: Los códigos numéricos deben respetarse tal como están en AirQuality.js
 * Fuente: Ministerio para la Transición Ecológica (MITECO)
 */
const AIR_QUALITY_MAGNITUDES = {
  1: 'Dióxido de azufre (SO2)',
  6: 'Monóxido de carbono (CO)',
  7: 'Monóxido de nitrógeno (NO)',
  8: 'Dióxido de nitrógeno (NO2)',
  9: 'Partículas < 2.5 μm (PM2.5)',
  10: 'Partículas < 10 μm (PM10)',
  12: 'Óxidos de nitrógeno (NOx)',
  14: 'Ozono (O3)',
  20: 'Tolueno',
  30: 'Benceno',
  35: 'Etilbenceno',
  42: 'Hidrocarburos totales (HCT)',
  43: 'Hidrocarburos no metánicos (HCNM)',
  44: 'Metano (CH4)'
};

/**
 * Array de códigos de magnitudes permitidas
 * Usado en validación de modelo AirQuality.js
 */
const MAGNITUDES_PERMITIDAS = [1, 6, 7, 8, 9, 10, 12, 14, 20, 30, 35, 42, 43, 44];

/**
 * Tipos de contenedores
 * Deben coincidir con el enum del modelo Container.js
 */
const CONTAINER_TYPES = [
  'ORGANICA',
  'RESTO',
  'ENVASES',
  'VIDRIO',
  'PAPEL-CARTON'
];

/**
 * Lotes de contenedores válidos
 */
const CONTAINER_LOTES = [1, 2, 3];

/**
 * Tipos de ubicaciones (Location model)
 */
const LOCATION_TYPES = [
  'estacion_acustica',
  'punto_trafico',
  'ruta_cercanias',
  'ruta_autobus',
  'ruta_interurbano',
  'ruta_metro',
  'ruta_metro_ligero',
  'zona_taxi'
];

/**
 * Tipos de geometría GeoJSON
 */
const GEOMETRY_TYPES = ['Point', 'LineString'];

/**
 * Zonas UTM válidas para España
 */
const UTM_ZONES = [29, 30, 31];

/**
 * Límites normativos de ruido (decibelios)
 * Basado en normativa europea de contaminación acústica
 */
const NOISE_LIMITS = {
  DIURNO: 65, // 07:00 - 19:00
  VESPERTINO: 65, // 19:00 - 23:00
  NOCTURNO: 55 // 23:00 - 07:00
};

/**
 * Niveles de densidad de patinetes
 */
const SCOOTER_DENSITY_LEVELS = ['BAJA', 'MEDIA', 'ALTA', 'MUY_ALTA'];

/**
 * Tipos de dominancia de proveedores de patinetes
 */
const SCOOTER_PROVIDER_DOMINANCE = ['EQUILIBRADA', 'MONOPOLIO', 'DUOPOLIO', 'OLIGOPOLIO'];

/**
 * Concentración de mercado de patinetes
 */
const SCOOTER_MARKET_CONCENTRATION = ['COMPETITIVA', 'MODERADA', 'CONCENTRADA', 'ALTA_CONCENTRACION'];

/**
 * Tipos de zona urbana para patinetes
 */
const SCOOTER_ZONE_TYPES = [
  'CENTRO_URBANO',
  'ZONA_COMERCIAL',
  'ZONA_RESIDENCIAL',
  'ZONA_UNIVERSITARIA',
  'ZONA_TURISTICA',
  'ZONA_EMPRESARIAL',
  'PERIFERIA',
  'ZONA_TRANSPORTE'
];

/**
 * Niveles de prioridad de servicio de patinetes
 */
const SCOOTER_PRIORITY_LEVELS = ['BAJA', 'MEDIA', 'ALTA', 'CRITICA'];

/**
 * Niveles de demanda estimada de patinetes
 */
const SCOOTER_DEMAND_LEVELS = ['BAJA', 'MEDIA', 'ALTA', 'MUY_ALTA'];

/**
 * Proveedores de patinetes eléctricos
 * Valores extraídos del CSV Anthem_CTC_AsignaciónPatinetes.csv
 */
const SCOOTER_PROVIDERS = [
  'ACCIONA',
  'BIRD',
  'FLASH',
  'JUMP_UBER',
  'KOKO',
  'LIME',
  'MOVO',
  'MYGO',
  'REBY_RIDES',
  'RIDECONGA',
  'SJV_CONSULTING',
  'TAXIFY',
  'UFO',
  'WIND'
];

/**
 * Roles de usuario
 */
const USER_ROLES = {
  ADMIN: 'admin',
  USER: 'user'
};

/**
 * Códigos de estado HTTP comunes
 */
const HTTP_STATUS = {
  OK: 200,
  CREATED: 201,
  NO_CONTENT: 204,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  UNPROCESSABLE_ENTITY: 422,
  TOO_MANY_REQUESTS: 429,
  INTERNAL_SERVER_ERROR: 500,
  SERVICE_UNAVAILABLE: 503
};

/**
 * Tipos de persona en accidentes
 */
const PERSON_TYPES = {
  CONDUCTOR: 'CONDUCTOR',
  PEATON: 'PEATON',
  TESTIGO: 'TESTIGO',
  VIAJERO: 'VIAJERO',
  PASAJERO: 'PASAJERO'
};

/**
 * Tipos de lesión en accidentes
 */
const INJURY_TYPES = {
  LEVE: 'LEVE',
  GRAVE: 'GRAVE',
  FALLECIDO: 'FALLECIDO',
  SIN_ASISTENCIA: 'SIN_ASISTENCIA',
  DESCONOCIDO: 'DESCONOCIDO'
};

/**
 * Estados meteorológicos
 */
const WEATHER_CONDITIONS = {
  DESPEJADO: 'DESPEJADO',
  NUBLADO: 'NUBLADO',
  LLUVIA_LIGERA: 'LLUVIA_LIGERA',
  LLUVIA_INTENSA: 'LLUVIA_INTENSA',
  NIEBLA: 'NIEBLA',
  VIENTO_FUERTE: 'VIENTO_FUERTE',
  GRANIZO: 'GRANIZO',
  NIEVE: 'NIEVE',
  DESCONOCIDO: 'DESCONOCIDO',
  NULL: 'NULL'
};

/**
 * Periodos de tiempo para rangos y filtros
 */
const TIME_PERIODS = {
  HOUR: 'HORA',
  DAY: 'DIA',
  WEEK: 'SEMANA',
  MONTH: 'MES',
  YEAR: 'ANIO'
};

/**
 * Periodos del día
 */
const DAY_PERIODS = {
  MADRUGADA: 'MADRUGADA',
  MAÑANA: 'MAÑANA',
  MEDIODIA: 'MEDIODIA',
  TARDE: 'TARDE',
  NOCHE: 'NOCHE'
};

/**
 * Tipos de jornada
 */
const WORKDAY_TYPES = {
  LABORABLE: 'LABORABLE',
  SABADO: 'SABADO',
  DOMINGO_FESTIVO: 'DOMINGO_FESTIVO'
};

/**
 * Factores de riesgo en accidentes
 */
const RISK_FACTORS = {
  ALCOHOL: 'ALCOHOL',
  DROGAS: 'DROGAS',
  VELOCIDAD_INADECUADA: 'VELOCIDAD_INADECUADA',
  CONDICIONES_METEOROLOGICAS: 'CONDICIONES_METEOROLOGICAS',
  HORA_MADRUGADA: 'HORA_MADRUGADA',
  VEHICULO_DOS_RUEDAS: 'VEHICULO_DOS_RUEDAS',
  ZONA_ACCIDENTES_FRECUENTES: 'ZONA_ACCIDENTES_FRECUENTES'
};

/**
 * Niveles de congestión de tráfico
 */
const CONGESTION_LEVELS = {
  FLUIDO: 'FLUIDO',
  DENSO: 'DENSO',
  CONGESTIONADO: 'CONGESTIONADO',
  COLAPSADO: 'COLAPSADO',
  SIN_DATOS: 'SIN_DATOS'
};

/**
 * Clasificación de intensidad de tráfico
 */
const TRAFFIC_INTENSITY_LEVELS = {
  MUY_BAJA: 'MUY_BAJA',
  BAJA: 'BAJA',
  MEDIA: 'MEDIA',
  ALTA: 'ALTA',
  MUY_ALTA: 'MUY_ALTA',
  SIN_DATOS: 'SIN_DATOS'
};

/**
 * Códigos de error de sensores de tráfico
 */
const TRAFFIC_ERROR_CODES = {
  NO_ERROR: 'N',
  ERROR: 'E',
  SIN_DATOS: 'S'
};

/**
 * Niveles de calidad de datos
 */
const DATA_QUALITY_LEVELS = {
  ALTA: 'ALTA',
  MEDIA: 'MEDIA',
  BAJA: 'BAJA',
  SIN_DATOS: 'SIN_DATOS'
};

/**
 * Tipos de elementos de medición de tráfico
 */
const TRAFFIC_ELEMENT_TYPES = {
  URB: 'URB',
  M30: 'M-30'
};

/**
 * Tipos de infracción de tráfico
 */
const INFRACTION_TYPES = {
  VELOCIDAD: 'VELOCIDAD',
  ESTACIONAMIENTO: 'ESTACIONAMIENTO',
  TELEFONO_MOVIL: 'TELEFONO_MOVIL',
  SEMAFORO: 'SEMAFORO',
  ALCOHOL_DROGAS: 'ALCOHOL_DROGAS',
  DOCUMENTACION: 'DOCUMENTACION',
  OTRAS: 'OTRAS'
};

/**
 * Grupos de edad del censo
 */
const AGE_GROUPS = {
  INFANTIL: 'INFANTIL', // 0-14 años
  JUVENIL: 'JUVENIL', // 15-24 años
  ADULTO_JOVEN: 'ADULTO_JOVEN', // 25-44 años
  ADULTO: 'ADULTO', // 45-64 años
  MAYOR: 'MAYOR', // 65-84 años
  ANCIANO: 'ANCIANO' // 85+ años
};

/**
 * Niveles de densidad poblacional
 * Usado en metadatos de Census
 */
const POPULATION_DENSITY_LEVELS = ['BAJA', 'MEDIA', 'ALTA', 'MUY_ALTA'];

/**
 * Niveles de diversidad cultural
 * Usado en metadatos de Census
 */
const CULTURAL_DIVERSITY_LEVELS = ['BAJA', 'MEDIA', 'ALTA'];

/**
 * Tipos de campos en metadatos
 * Usado en Census para tracking de campos faltantes
 */
const CENSUS_FIELD_TYPES = ['poblacion', 'ubicacion', 'edad'];

/**
 * Rangos de edad por grupo
 * Para uso en clasificaciones y validaciones
 */
const AGE_RANGES = {
  INFANTIL: { min: 0, max: 14 },
  JUVENIL: { min: 15, max: 24 },
  ADULTO_JOVEN: { min: 25, max: 44 },
  ADULTO: { min: 45, max: 64 },
  MAYOR: { min: 65, max: 84 },
  ANCIANO: { min: 85, max: 120 }
};

/**
 * Edad de grupos productivos
 */
const WORKING_AGE = { min: 16, max: 65 };

/**
 * Edad tercera edad
 */
const ELDERLY_AGE = { min: 65, max: 120 };

/**
 * Géneros
 * Valores extraídos del CSV Anthem_CTC_Accidentalidad.csv
 */
const GENDERS = {
  HOMBRE: 'HOMBRE',
  MUJER: 'MUJER',
  DESCONOCIDO: 'DESCONOCIDO'  // Cambiado de NO_ASIGNADO para coincidir con CSV
};

/**
 * Configuración de seguridad de usuario
 */
const USER_SECURITY = {
  MAX_LOGIN_ATTEMPTS: 5,
  LOCK_TIME_MS: 2 * 60 * 60 * 1000, // 2 horas
  MIN_PASSWORD_LENGTH: 6,
  MAX_PASSWORD_LENGTH: 128,
  MIN_USERNAME_LENGTH: 3,
  MAX_USERNAME_LENGTH: 30
};

/**
 * Límites de validación para usuarios (login, registro, formularios)
 * Usados en middleware de validación de express-validator
 */
const USER_VALIDATION = {
  // Username
  MIN_USERNAME_LENGTH: 3,
  MAX_USERNAME_LENGTH: 30,

  // Password
  MIN_PASSWORD_LENGTH: 8,
  MAX_PASSWORD_LENGTH: 64,

  // Email
  MAX_EMAIL_LENGTH: 155,

  // Identifier (login puede ser username o email)
  MIN_IDENTIFIER_LENGTH: 3,
  MAX_IDENTIFIER_LENGTH: 30,

  // Password strength pattern (usado en regex de validación)
  PASSWORD_PATTERN: /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]+$/,

  // Username pattern (solo alfanuméricos, guiones y guiones bajos)
  USERNAME_PATTERN: /^[a-zA-Z0-9_-]+$/,

  // Forbidden usernames (no permitidos para registro)
  FORBIDDEN_USERNAMES: ['admin', 'root', 'api', 'system', 'null', 'undefined']
};

/**
 * Límites de búsqueda y filtrado
 * Usados en validaciones de query strings
 */
const SEARCH_LIMITS = {
  // Búsqueda general (query 'q')
  QUERY_MIN_LENGTH: 1,
  QUERY_MAX_LENGTH: 100,

  // Filtros geográficos
  DISTRITO_MIN_LENGTH: 2,
  DISTRITO_MAX_LENGTH: 100,
  BARRIO_MIN_LENGTH: 2,
  BARRIO_MAX_LENGTH: 100,

  // Pattern para fields de proyección
  FIELDS_PATTERN: /^[a-zA-Z,_]+$/,

  // Pattern para sortBy
  SORTBY_PATTERN: /^[a-zA-Z][a-zA-Z0-9_]*$/,

  // Otros límites de string
  PATTERN_MIN_LENGTH: 1,
  PATTERN_MAX_LENGTH: 100
};

/**
 * Límites de coordenadas geográficas
 * Usados en validaciones de consultas por proximidad
 */
const GEO_LIMITS = {
  LONGITUDE_MIN: -180,
  LONGITUDE_MAX: 180,
  LATITUDE_MIN: -90,
  LATITUDE_MAX: 90,
  MIN_DISTANCE_METERS: 50,
  MAX_DISTANCE_METERS: 5000
};

/**
 * Límites de rangos de fechas para consultas
 * Diferentes endpoints permiten diferentes rangos máximos
 */
const DATE_RANGE_LIMITS = {
  DEFAULT_MAX_DAYS: 365,    // 1 año por defecto
  ACCIDENTS_MAX_DAYS: 730,  // 2 años para accidentes (datos históricos importantes)
  NOISE_MAX_DAYS: 1825,     // 5 años para análisis histórico de ruido
  MAX_MILLISECONDS_CALCULATION: 24 * 60 * 60 * 1000  // Cálculo del rango en ms
};

/**
 * Configuración de rate limiting
 * Ventanas de tiempo y máximos de peticiones por ventana
 */
const RATE_LIMITS = {
  // Ventanas de tiempo en milisegundos
  WINDOWS: {
    ONE_MINUTE: 1 * 60 * 1000,
    FIVE_MINUTES: 5 * 60 * 1000,
    FIFTEEN_MINUTES: 15 * 60 * 1000,
    ONE_HOUR: 60 * 60 * 1000
  },

  // Ventanas en segundos (para retryAfter en headers)
  RETRY_AFTER: {
    ONE_MINUTE: 60,
    FIVE_MINUTES: 5 * 60,
    FIFTEEN_MINUTES: 15 * 60,
    ONE_HOUR: 60 * 60
  },

  // Máximos por tipo de operación
  GENERAL: {
    WINDOW_MS: 15 * 60 * 1000,  // 15 minutos
    MAX_REQUESTS: 100,
    RETRY_AFTER: 15 * 60
  },

  EXPORT: {
    WINDOW_MS: 60 * 60 * 1000,  // 1 hora
    MAX_REQUESTS: 5,
    RETRY_AFTER: 60 * 60
  },

  HEAVY_QUERY: {
    WINDOW_MS: 5 * 60 * 1000,   // 5 minutos
    MAX_REQUESTS: 10,
    RETRY_AFTER: 5 * 60
  },

  AUTH: {
    WINDOW_MS: 15 * 60 * 1000,  // 15 minutos
    MAX_REQUESTS: 10,           // Más restrictivo para auth
    RETRY_AFTER: 15 * 60
  },

  // Rate limits específicos por recurso
  NOISE_MONITORING: {
    LIST_MAX: 25,               // Listado general
    STATS_MAX: 10,              // Estadísticas
    SEARCH_MAX: 15              // Búsquedas
  },

  AIR_QUALITY: {
    LIST_MAX: 30
  },

  ACCIDENTS: {
    HEATMAP_MAX: 10,            // Análisis de mapa de calor
    EXPORT_MAX: 3               // Exportaciones (datos sensibles)
  }
};

/**
 * Límites específicos de validación por ruta/entidad
 * Agrupados por categoría para fácil mantenimiento
 */
const ROUTE_SPECIFIC_LIMITS = {
  // Traffic
  TRAFFIC: {
    PUNTO_MAX_LIMIT: 500        // Consultas de punto específico permiten más registros
  },

  // Noise Monitoring
  NOISE: {
    YEAR_MIN: 1900,
    YEAR_MAX: 2100,
    MONTH_MIN: 1,
    MONTH_MAX: 12,
    TOP_N_MIN: 5,
    TOP_N_MAX: 50,
    LIMIT_MIN: 1,
    LIMIT_MAX: 100,
    POINT_LIMIT_MIN: 5,
    POINT_LIMIT_MAX: 50,
    DB_THRESHOLD_MIN: 40,
    DB_THRESHOLD_MAX: 100
  },

  // Census
  CENSUS: {
    YEAR_MIN: 2000,
    YEAR_MAX: 3000,
    MONTH_MIN: 1,
    MONTH_MAX: 12,
    AGE_MIN: 0,
    AGE_MAX: 150,
    LIMIT_MIN: 1,
    LIMIT_MAX: 100
  },

  // Bike Availability
  BIKE: {
    YEAR_MIN: 2050,
    YEAR_MAX: 2052,
    TOP_N_MIN: 1,
    TOP_N_MAX: 50,
    OCCUPANCY_MIN: 50,
    OCCUPANCY_MAX: 100
  },

  // Air Quality
  AIR: {
    PROVINCIA_MIN: 1,
    PROVINCIA_MAX: 99,
    LIMIT_MIN: 1,
    LIMIT_MAX: 100
  },

  // Fines
  FINES: {
    POINTS_MIN: 0,
    POINTS_MAX: 12,            // Máximo de puntos del carnet
    LIMIT_MIN: 1,
    LIMIT_MAX: 100,
    TOP_N_MIN: 1,
    TOP_N_MAX: 50
  },

  // Locations
  LOCATIONS: {
    LIMIT_MIN: 1,
    LIMIT_MAX: 1000,
    DISTANCE_MIN: 100,
    DISTANCE_MAX: 50000
  },

  // Scooter Assignments
  SCOOTER: {
    PAGE_MIN: 1,
    PAGE_MAX: 1000,
    LIMIT_MIN: 1,
    LIMIT_MAX: 100,
    PROVIDER_MIN_LENGTH: 2,
    PROVIDER_MAX_LENGTH: 30,
    DISTRICT_MIN_LENGTH: 2,
    DISTRICT_MAX_LENGTH: 50,
    NEIGHBORHOOD_MIN_LENGTH: 2,
    NEIGHBORHOOD_MAX_LENGTH: 50,
    PATINETES_MIN: 0,
    PATINETES_MAX: 1000,
    DISPONIBLES_MIN: 0,
    DISPONIBLES_MAX: 1000,
    TOP_N_MIN: 1,
    TOP_N_MAX: 50
  },

  // Containers
  CONTAINERS: {
    LOTE_MIN: 1,
    LOTE_MAX: 3,
    SEARCH_MAX_LIMIT: 200
  },

  // Accidents
  ACCIDENTS: {
    DISTANCE_MIN: 100,
    DISTANCE_MAX: 1000
  },

  // Admin
  ADMIN: {
    PATTERN_MIN_LENGTH: 1,
    PATTERN_MAX_LENGTH: 100,
    MEMORY_THRESHOLD_MB: 500,
    MEMORY_THRESHOLD_BYTES: 500 * 1024 * 1024
  }
};

/**
 * Indicadores binarios S/N/NULL
 * Usados en varios modelos para campos con valores S/N/NULL
 */
const BINARY_INDICATORS = {
  YES: 'S',
  NO: 'N',
  NULL: 'NULL'
};

/**
 * Códigos de validación de datos
 * Usados en modelos de medición
 */
const VALIDATION_CODES = {
  VALID: 'V', // Válido
  INVALID: 'N' // No válido
};

/**
 * Tipos de reporte de scooters
 * Usaedos en ScooterAssignment para campos faltants
 */
const SCOOTER_REPORT_TYPES = ['proveedores', 'ubicacion', 'totales'];

/**
 * Razones de revocación de tokens
 * Usados en TokenBlacklist para registrar por qué un token fue revocado
 */
const TOKEN_REVOCATION_REASONS = ['rotation', 'logout', 'compromised', 'password_change'];

/**
 * Campos de métricas de ruido
 * Usados en NoiseMonitoring para campos faltantes en metadatos
 */
const NOISE_METRIC_FIELDS = ['nivelDiurno', 'nivelVespertino', 'nivelNocturno', 'laeq24', 'percentiles'];

/**
 * Constantes de tiempo
 * Usadas en validaciones temporales y cálculos de disponibilidad
 */
const TIME_CONSTANTS = {
  HOURS_PER_DAY: 24,
  MINUTES_PER_HOUR: 60,
  SECONDS_PER_MINUTE: 60,
  MILLISECONDS_PER_SECOND: 1000,
  DAYS_PER_WEEK: 7,
  MONTHS_PER_YEAR: 12,
  DAYS_PER_YEAR: 365,
  // Conversiones de tiempo útiles
  MILLISECONDS_PER_DAY: 24 * 60 * 60 * 1000,  // 86400000 ms = 1 día
  MILLISECONDS_PER_HOUR: 60 * 60 * 1000,      // 3600000 ms = 1 hora
  MILLISECONDS_PER_MINUTE: 60 * 1000          // 60000 ms = 1 minuto
};

/**
 * Configuración de multas
 * Tasas y porcentajes aplicados en cálculos de infracciones
 */
const FINE_CONFIG = {
  DISCOUNT_RATE: 0.5, // 50% descuento por pronto pago
  MAX_POINTS: 12 // Puntos máximos del carnet de conducir
};

/**
 * Thresholds de densidad de patinetes eléctricos
 * Usados para clasificar zonas según número de patinetes disponibles
 */
const SCOOTER_DENSITY_THRESHOLDS = {
  MUY_ALTA: 200, // >= 200 patinetes
  ALTA: 100, // >= 100 patinetes
  MEDIA: 50, // >= 50 patinetes
  BAJA: 0 // < 50 patinetes
};

/**
 * Thresholds de demanda estimada de patinetes
 * Basados en análisis de uso y disponibilidad por zona
 */
const SCOOTER_DEMAND_THRESHOLDS = {
  MUY_ALTA: 150, // >= 150 patinetes (demanda crítica)
  ALTA: 100, // >= 100 patinetes
  MEDIA: 50, // >= 50 patinetes
  BAJA: 0 // < 50 patinetes
};

/**
 * Thresholds de concentración de mercado (Índice Herfindahl-Hirschman)
 * Valores estándar económicos para análisis de competencia
 * HHI = suma de cuadrados de participaciones de mercado (0-10000)
 * Fuente: Directrices de Concentración Horizontal (UE, DOJ/FTC)
 */
const MARKET_CONCENTRATION_THRESHOLDS = {
  HIGH: 5000, // HHI >= 5000: Monopolio o alta concentración
  MODERATE: 2500, // HHI >= 2500: Concentración moderada
  LOW: 1500, // HHI >= 1500: Baja concentración
  COMPETITIVE: 0 // HHI < 1500: Mercado competitivo
};

/**
 * Thresholds de diversidad cultural
 * Basados en porcentaje de población extranjera
 * Criterios demográficos estándar para análisis sociológico
 */
const CULTURAL_DIVERSITY_THRESHOLDS = {
  HIGH: 25, // > 25% extranjeros = Alta diversidad
  MEDIUM: 10, // > 10% extranjeros = Media diversidad
  LOW: 0 // <= 10% extranjeros = Baja diversidad
};

/**
 * Thresholds de uso de bicicletas eléctricas
 * Basados en porcentaje de ocupación y patrones de demanda
 */
const BIKE_USAGE_THRESHOLDS = {
  HIGH_DEMAND_OCCUPANCY: 80, // > 80% ocupación = Alta demanda
  MEDIUM_DEMAND_OCCUPANCY: 60, // > 60% ocupación = Media demanda
  LOW_DEMAND_OCCUPANCY: 40, // > 40% ocupación = Baja demanda
  MIN_OCCUPANCY: 0 // >= 0% ocupación
};

module.exports = {
  // Severidad
  SEVERITY_LEVELS,

  // Ordenamiento
  SORT_FIELDS,

  // Paginación
  PAGINATION,
  AGGREGATION_LIMITS,
  SPECIAL_PAGINATION_LIMITS,

  // Accidentes
  ACCIDENT_TYPES,
  VEHICLE_TYPES,
  PERSON_TYPES,
  INJURY_TYPES,
  RISK_FACTORS,

  // Calidad del aire
  AIR_QUALITY_MAGNITUDES,
  MAGNITUDES_PERMITIDAS,

  // Contenedores
  CONTAINER_TYPES,
  CONTAINER_LOTES,

  // Ubicaciones
  LOCATION_TYPES,
  GEOMETRY_TYPES,
  UTM_ZONES,

  // Ruido
  NOISE_LIMITS,

  // Patinetes
  SCOOTER_DENSITY_LEVELS,
  SCOOTER_PROVIDER_DOMINANCE,
  SCOOTER_MARKET_CONCENTRATION,
  SCOOTER_ZONE_TYPES,
  SCOOTER_PRIORITY_LEVELS,
  SCOOTER_DEMAND_LEVELS,
  SCOOTER_PROVIDERS,
  SCOOTER_REPORT_TYPES,

  // Periodos temporales
  DAY_PERIODS,
  TIME_PERIODS,
  WORKDAY_TYPES,

  // Usuarios y autenticación
  USER_ROLES,
  USER_SECURITY,
  USER_VALIDATION,

  // HTTP
  HTTP_STATUS,

  // Validación y límites
  SEARCH_LIMITS,
  GEO_LIMITS,
  DATE_RANGE_LIMITS,
  RATE_LIMITS,
  ROUTE_SPECIFIC_LIMITS,

  // Clima
  WEATHER_CONDITIONS,

  // Tráfico
  CONGESTION_LEVELS,
  TRAFFIC_INTENSITY_LEVELS,
  TRAFFIC_ERROR_CODES,
  DATA_QUALITY_LEVELS,
  TRAFFIC_ELEMENT_TYPES,

  // Multas
  INFRACTION_TYPES,

  // Censo
  AGE_GROUPS,
  AGE_RANGES,
  WORKING_AGE,
  ELDERLY_AGE,
  GENDERS,
  POPULATION_DENSITY_LEVELS,
  CULTURAL_DIVERSITY_LEVELS,
  CENSUS_FIELD_TYPES,

  // Indicadores y códigos
  BINARY_INDICATORS,
  VALIDATION_CODES,

  // Tokens y autenticación
  TOKEN_REVOCATION_REASONS,

  // Métricas de ruido
  NOISE_METRIC_FIELDS,

  // Constantes de tiempo
  TIME_CONSTANTS,

  // Multas - Configuración
  FINE_CONFIG,

  // Patinetes - Thresholds
  SCOOTER_DENSITY_THRESHOLDS,
  SCOOTER_DEMAND_THRESHOLDS,
  MARKET_CONCENTRATION_THRESHOLDS,

  // Censo - Thresholds
  CULTURAL_DIVERSITY_THRESHOLDS,

  // Bicicletas - Thresholds
  BIKE_USAGE_THRESHOLDS
};
