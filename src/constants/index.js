/**
 * Application Constants
 *
 * Constantes centralizadas para toda la aplicación.
 * Elimina valores duplicados de múltiples archivos.
 *
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
  AIR_QUALITY: ['fecha', 'estacion', 'magnitud', 'valor', 'tecnica'],
  BIKE_AVAILABILITY: ['fecha', 'estacion', 'bicicletasDisponibles', 'anclajesDisponibles'],
  BIKE_CAPACITY: ['fecha', 'estacion', 'aforoEntradas', 'aforoSalidas'],
  CENSUS: ['fechaCenso', 'totalPoblacion', 'porcentajeExtranjeros', 'edad', 'distrito', 'barrio'],
  CONTAINER: ['tipoContenedor', 'distrito', 'barrio', 'direccion'],
  FINE: ['fecha', 'importeFinal', 'puntosDetraídos', 'lugar', 'calificacion'],
  LOCATION: ['nombre', 'distrito', 'barrio', 'tipo'],
  NOISE_MONITORING: ['fecha', 'estacion', 'nivelSonoro', 'periodo'],
  PARKING_OCCUPANCY: ['fecha', 'distrito', 'plazasTotales', 'plazasOcupadas'],
  SCOOTER_ASSIGNMENT: ['fecha', 'distrito', 'proveedor', 'numeroPatinetes', 'disponibles', 'enUso'],
  TRAFFIC: ['fecha', 'puntoMedidaId', 'intensidad', 'ocupacion', 'carga']
};

/**
 * Mensajes de error estandarizados
 * Disponibles en español (por defecto) e inglés
 */
const ERROR_MESSAGES = {
  ES: {
    // Validación
    VALIDATION_FAILED: 'Error de validación',
    INVALID_PARAMS: 'Parámetros inválidos',
    INVALID_DATE_RANGE: 'Rango de fechas inválido',
    INVALID_ID: 'ID inválido',
    REQUIRED_FIELD: 'Campo requerido',

    // Autenticación/Autorización
    UNAUTHORIZED: 'No autorizado',
    FORBIDDEN: 'Acceso prohibido',
    INVALID_TOKEN: 'Token inválido o expirado',
    INVALID_CREDENTIALS: 'Credenciales inválidas',
    ACCOUNT_LOCKED: 'Cuenta bloqueada temporalmente',

    // Recursos
    NOT_FOUND: 'Recurso no encontrado',
    ALREADY_EXISTS: 'El recurso ya existe',
    DUPLICATE_ENTRY: 'Entrada duplicada',

    // Servidor
    INTERNAL_ERROR: 'Error interno del servidor',
    SERVICE_UNAVAILABLE: 'Servicio no disponible',
    DATABASE_ERROR: 'Error de base de datos',

    // Rate Limiting
    RATE_LIMIT_EXCEEDED: 'Demasiadas peticiones',
    TOO_MANY_REQUESTS: 'Demasiadas solicitudes desde esta IP'
  },
  EN: {
    // Validation
    VALIDATION_FAILED: 'Validation failed',
    INVALID_PARAMS: 'Invalid parameters',
    INVALID_DATE_RANGE: 'Invalid date range',
    INVALID_ID: 'Invalid ID',
    REQUIRED_FIELD: 'Required field',

    // Authentication/Authorization
    UNAUTHORIZED: 'Unauthorized',
    FORBIDDEN: 'Forbidden',
    INVALID_TOKEN: 'Invalid or expired token',
    INVALID_CREDENTIALS: 'Invalid credentials',
    ACCOUNT_LOCKED: 'Account temporarily locked',

    // Resources
    NOT_FOUND: 'Resource not found',
    ALREADY_EXISTS: 'Resource already exists',
    DUPLICATE_ENTRY: 'Duplicate entry',

    // Server
    INTERNAL_ERROR: 'Internal server error',
    SERVICE_UNAVAILABLE: 'Service unavailable',
    DATABASE_ERROR: 'Database error',

    // Rate Limiting
    RATE_LIMIT_EXCEEDED: 'Rate limit exceeded',
    TOO_MANY_REQUESTS: 'Too many requests from this IP'
  }
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
 * Configuración de caché
 * TTL (Time To Live) por tipo de datos en segundos
 */
const CACHE_TTL = {
  // Datos que cambian frecuentemente
  REAL_TIME: 60, // 1 minuto
  TRAFFIC: 300, // 5 minutos
  BIKE_AVAILABILITY: 300, // 5 minutos
  PARKING_OCCUPANCY: 300, // 5 minutos

  // Datos que cambian moderadamente
  AIR_QUALITY: 1800, // 30 minutos
  NOISE_MONITORING: 1800, // 30 minutos
  SCOOTER_ASSIGNMENT: 1800, // 30 minutos

  // Datos relativamente estáticos
  ACCIDENTS: 3600, // 1 hora
  FINES: 3600, // 1 hora

  // Datos estáticos
  CENSUS: 86400, // 24 horas
  LOCATIONS: 86400, // 24 horas
  CONTAINERS: 86400, // 24 horas

  // Estadísticas y agregaciones
  STATISTICS: 3600, // 1 hora
  ANALYTICS: 7200, // 2 horas
  REPORTS: 43200 // 12 horas
};

/**
 * Tipos de accidentes válidos
 */
const ACCIDENT_TYPES = [
  'COLISION_DOBLE',
  'COLISION_MULTIPLE',
  'ATROPELLO',
  'SALIDA_VIA',
  'VUELCO',
  'CAIDA_MOTOCICLETA',
  'OTRO'
];

/**
 * Tipos de vehículos
 */
const VEHICLE_TYPES = [
  'TURISMO',
  'MOTOCICLETA',
  'CICLOMOTOR',
  'AUTOBUS',
  'CAMION',
  'FURGONETA',
  'BICICLETA',
  'OTRO'
];

/**
 * Magnitudes de calidad de aire
 * Según normativa europea
 */
const AIR_QUALITY_MAGNITUDES = {
  SO2: 'Dióxido de Azufre',
  NO2: 'Dióxido de Nitrógeno',
  NO: 'Monóxido de Nitrógeno',
  CO: 'Monóxido de Carbono',
  PM10: 'Partículas < 10 µm',
  PM25: 'Partículas < 2.5 µm',
  O3: 'Ozono',
  BEN: 'Benceno',
  TOL: 'Tolueno'
};

/**
 * Límites de contaminantes (µg/m³)
 * Valores indicativos según normativa
 */
const AIR_QUALITY_LIMITS = {
  PM10: {
    BUENA: 25,
    MODERADA: 50,
    DAÑINA_GRUPOS_SENSIBLES: 90,
    DAÑINA: 180,
    MUY_DAÑINA: 250,
    PELIGROSA: Infinity
  },
  PM25: {
    BUENA: 15,
    MODERADA: 30,
    DAÑINA_GRUPOS_SENSIBLES: 55,
    DAÑINA: 110,
    MUY_DAÑINA: 150,
    PELIGROSA: Infinity
  },
  NO2: {
    BUENA: 50,
    MODERADA: 100,
    DAÑINA_GRUPOS_SENSIBLES: 200,
    DAÑINA: 400,
    MUY_DAÑINA: 600,
    PELIGROSA: Infinity
  },
  O3: {
    BUENA: 60,
    MODERADA: 120,
    DAÑINA_GRUPOS_SENSIBLES: 180,
    DAÑINA: 240,
    MUY_DAÑINA: 300,
    PELIGROSA: Infinity
  }
};

/**
 * Tipos de contenedores
 */
const CONTAINER_TYPES = [
  'ORGANICA',
  'ENVASES',
  'PAPEL_CARTON',
  'VIDRIO',
  'ROPA',
  'ACEITE',
  'PILAS'
];

/**
 * Periodos de agregación temporal válidos
 */
const TEMPORAL_PERIODS = {
  HOURLY: 'hourly',
  DAILY: 'daily',
  WEEKLY: 'weekly',
  MONTHLY: 'monthly',
  QUARTERLY: 'quarterly',
  YEARLY: 'yearly'
};

/**
 * Rangos de fechas predefinidos
 */
const DATE_RANGES = {
  TODAY: 'today',
  YESTERDAY: 'yesterday',
  LAST_7_DAYS: 'last_7_days',
  LAST_30_DAYS: 'last_30_days',
  LAST_90_DAYS: 'last_90_days',
  THIS_MONTH: 'this_month',
  LAST_MONTH: 'last_month',
  THIS_YEAR: 'this_year',
  LAST_YEAR: 'last_year'
};

/**
 * Roles de usuario
 */
const USER_ROLES = {
  ADMIN: 'admin',
  USER: 'user',
  ANALYST: 'analyst',
  READONLY: 'readonly'
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
 * Proveedores de patinetes eléctricos
 */
const SCOOTER_PROVIDERS = [
  'LIME',
  'TIER',
  'DOTT',
  'WIND',
  'VOI',
  'OTRO'
];

module.exports = {
  SEVERITY_LEVELS,
  SORT_FIELDS,
  ERROR_MESSAGES,
  PAGINATION,
  CACHE_TTL,
  ACCIDENT_TYPES,
  VEHICLE_TYPES,
  AIR_QUALITY_MAGNITUDES,
  AIR_QUALITY_LIMITS,
  CONTAINER_TYPES,
  TEMPORAL_PERIODS,
  DATE_RANGES,
  USER_ROLES,
  HTTP_STATUS,
  SCOOTER_PROVIDERS
};
