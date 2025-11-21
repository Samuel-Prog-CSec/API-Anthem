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
  MAX_PASSWORD_LENGTH: 128
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
 * Usados en ScooterAssignment para campos faltantes
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
  WORKDAY_TYPES,

  // Usuarios y autenticación
  USER_ROLES,
  USER_SECURITY,

  // HTTP
  HTTP_STATUS,

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
  NOISE_METRIC_FIELDS
};
