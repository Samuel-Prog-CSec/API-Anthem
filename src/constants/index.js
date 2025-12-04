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
  SCOOTER_ASSIGNMENT: ['totalPatinetes', 'distrito', 'barrio', 'fecha', 'densidad', 'proveedor'],
  TRAFFIC: ['fecha', 'puntoMedidaId', 'intensidad', 'ocupacion', 'carga']
};

/**
 * Campos de ordenamiento por defecto
 */
const DEFAULT_SORT_FIELDS = {
  FINE: 'fecha',
  SCOOTER_ASSIGNMENT: 'totalPatinetes',
  DEFAULT_ORDER: 'desc'
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
 * Timeouts para queries de MongoDB
 * Previenen conexiones colgadas y mejoran la resiliencia
 */
const MONGODB_TIMEOUTS = {
  QUERY_TIMEOUT_MS: 5000, // 5 segundos para queries simples (find, findOne, findById, count)
  AGGREGATE_TIMEOUT_MS: 10000 // 10 segundos para aggregations complejas
};

/**
 * Límites para agregaciones de MongoDB
 * Usados en pipelines de agregación para prevenir problemas de memoria
 */
const AGGREGATION_LIMITS = {
  SMALL: 1000, // Para aggregations pequeñas (proximidad, detalles)
  MEDIUM: 5000, // Para aggregations medianas (estadísticas de punto único)
  LARGE: 10000, // Para aggregations grandes (estadísticas generales)
  XLARGE: 50000, // Para aggregations muy grandes (análisis masivos)
  TOP_RESULTS: 50, // Límite para rankings/tops
  PREVIEW: 5, // Límite para vistas previas
  MONTHLY_STATS: 12 // Límite para estadísticas mensuales
};

/**
 * Límites especiales de paginación por entidad
 * Algunos endpoints necesitan límites diferentes por naturaleza de datos
 */
const SPECIAL_PAGINATION_LIMITS = {
  LOCATIONS: {
    DEFAULT: 100, // Más puntos geográficos por defecto
    MAX: 500 // Límite alto para mapas
  },
  CONTAINERS: {
    DEFAULT: 100, // Muchos contenedores en la ciudad
    SEARCH_MAX: 200 // Límite para búsquedas de contenedores
  },
  BIKES: {
    DEFAULT: 100 // Muchas estaciones de bicicletas
  }
};

/**
 * Tipos de accidentes válidos
 * Deben coincidir con el enum del modelo Accident.js
 * Valores extraídos del CSV Anthem_CTC_Accidentalidad.csv
 * IMPORTANTE: Valores con formato exacto del CSV (espacios → guiones bajos, tildes preservadas)
 * ESTRUCTURA: Objeto clave-valor para eliminar hardcoded strings
 */
const ACCIDENT_TYPES = {
  ALCANCE: 'ALCANCE',
  ATROPELLO_A_ANIMAL: 'ATROPELLO_A_ANIMAL',
  ATROPELLO_A_PERSONA: 'ATROPELLO_A_PERSONA',
  CAIDA: 'CAÍDA',
  CHOQUE_CONTRA_OBSTACULO_FIJO: 'CHOQUE_CONTRA_OBSTÁCULO_FIJO',
  COLISION_FRONTAL: 'COLISIÓN_FRONTAL',
  COLISION_FRONTO_LATERAL: 'COLISIÓN_FRONTO-LATERAL',
  COLISION_LATERAL: 'COLISIÓN_LATERAL',
  COLISION_MULTIPLE: 'COLISIÓN_MÚLTIPLE',
  DESPEÑAMIENTO: 'DESPEÑAMIENTO',
  OTRO: 'OTRO',
  SOLO_SALIDA_DE_LA_VIA: 'SOLO_SALIDA_DE_LA_VÍA',
  VUELCO: 'VUELCO'
};

/**
 * Tipos de vehículos
 * Deben coincidir con el enum del modelo Accident.js
 * Valores completos extraídos del CSV Anthem_CTC_Accidentalidad.csv
 * IMPORTANTE: Formato exacto del CSV (espacios → guiones bajos, tildes/símbolos preservados)
 * ESTRUCTURA: Objeto clave-valor para eliminar hardcoded strings
 */
const VEHICLE_TYPES = {
  AMBULANCIA_SAMUR: 'AMBULANCIA_SAMUR',
  AUTOBUS_EMT: 'AUTOBUS_EMT',
  AUTOBUS: 'AUTOBÚS',
  AUTOBUS_ARTICULADO: 'AUTOBÚS_ARTICULADO',
  AUTOBUS_ARTICULADO_EMT: 'AUTOBÚS_ARTICULADO_EMT',
  AUTOCARAVANA: 'AUTOCARAVANA',
  BICICLETA: 'BICICLETA',
  BICICLETA_EPAC: 'BICICLETA_EPAC_(PEDALEO_ASISTIDO)',
  CAMION_DE_BOMBEROS: 'CAMIÓN_DE_BOMBEROS',
  CAMION_RIGIDO: 'CAMIÓN_RÍGIDO',
  CICLO: 'CICLO',
  CICLOMOTOR: 'CICLOMOTOR',
  CICLOMOTOR_DOS_RUEDAS: 'CICLOMOTOR_DE_DOS_RUEDAS_L1E-B',
  CICLOMOTOR_TRES_RUEDAS: 'CICLOMOTOR_DE_TRES_RUEDAS',
  CUADRICICLO_LIGERO: 'CUADRICICLO_LIGERO',
  CUADRICICLO_NO_LIGERO: 'CUADRICICLO_NO_LIGERO',
  FURGONETA: 'FURGONETA',
  MAQUINARIA_AGRICOLA: 'MAQUINARIA_AGRÍCOLA',
  MAQUINARIA_DE_OBRAS: 'MAQUINARIA_DE_OBRAS',
  MOTO_TRES_RUEDAS_MAS_125CC: 'MOTO_DE_TRES_RUEDAS_>_125CC',
  MOTO_TRES_RUEDAS_HASTA_125CC: 'MOTO_DE_TRES_RUEDAS_HASTA_125CC',
  MOTOCICLETA_MAS_125CC: 'MOTOCICLETA_>_125CC',
  MOTOCICLETA_HASTA_125CC: 'MOTOCICLETA_HASTA_125CC',
  OTROS_VEHICULOS_CON_MOTOR: 'OTROS_VEHÍCULOS_CON_MOTOR',
  OTROS_VEHICULOS_SIN_MOTOR: 'OTROS_VEHÍCULOS_SIN_MOTOR',
  PATINETE: 'PATINETE',
  REMOLQUE: 'REMOLQUE',
  SEMIREMOLQUE: 'SEMIREMOLQUE',
  SIN_ESPECIFICAR: 'SIN_ESPECIFICAR',
  TAXI: 'TAXI',
  TODO_TERRENO: 'TODO_TERRENO',
  TRACTOCAMION: 'TRACTOCAMIÓN',
  TREN_METRO: 'TREN/METRO',
  TURISMO: 'TURISMO',
  VEHICULO_ARTICULADO: 'VEHÍCULO_ARTICULADO',
  VMU_ELECTRICO: 'VMU_ELÉCTRICO'
};

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
/**
 * Array de códigos de magnitudes permitidas
 * Usado en validación de modelo AirQuality.js
 * Generado dinámicamente desde AIR_QUALITY_MAGNITUDES para asegurar consistencia
 */
const MAGNITUDES_PERMITIDAS = Object.keys(AIR_QUALITY_MAGNITUDES).map(Number);

/**
 * Valores por defecto para calidad de aire
 */
const AIR_QUALITY_DEFAULTS = {
  PROVINCIA: 28, // Madrid
  MUNICIPIO: 79, // Madrid ciudad
  MAGNITUD: 10 // PM10
};

/**
 * Tipos de contenedores
 * Deben coincidir con el enum del modelo Container.js
 */
const CONTAINER_TYPES = {
  ORGANICA: 'ORGANICA',
  RESTO: 'RESTO',
  ENVASES: 'ENVASES',
  VIDRIO: 'VIDRIO',
  PAPEL_CARTON: 'PAPEL-CARTON'
};

/**
 * Lotes de contenedores válidos
 */
const CONTAINER_LOTES = [1, 2, 3];

/**
 * Tipos de ubicaciones (Location model)
 * ESTRUCTURA: Objeto clave-valor para eliminar accesos por índice
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

/**
 * Tipos de geometría GeoJSON
 * ESTRUCTURA: Objeto clave-valor para eliminar accesos por índice
 */
const GEOMETRY_TYPES = {
  POINT: 'Point',
  LINE_STRING: 'LineString'
};

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
 * ESTRUCTURA: Objeto clave-valor para eliminar accesos por índice
 */
const SCOOTER_DENSITY_LEVELS = {
  BAJA: 'BAJA',
  MEDIA: 'MEDIA',
  ALTA: 'ALTA',
  MUY_ALTA: 'MUY_ALTA'
};

/**
 * Tipos de dominancia de proveedores de patinetes
 * ESTRUCTURA: Objeto clave-valor para eliminar accesos por índice
 */
const SCOOTER_PROVIDER_DOMINANCE = {
  EQUILIBRADA: 'EQUILIBRADA',
  MONOPOLIO: 'MONOPOLIO',
  DUOPOLIO: 'DUOPOLIO',
  OLIGOPOLIO: 'OLIGOPOLIO'
};

/**
 * Concentración de mercado de patinetes
 * ESTRUCTURA: Objeto clave-valor para eliminar accesos por índice
 */
const SCOOTER_MARKET_CONCENTRATION = {
  COMPETITIVA: 'COMPETITIVA',
  MODERADA: 'MODERADA',
  CONCENTRADA: 'CONCENTRADA',
  ALTA_CONCENTRACION: 'ALTA_CONCENTRACION'
};

/**
 * Tipos de zona urbana para patinetes
 */
const SCOOTER_ZONE_TYPES = {
  CENTRO_URBANO: 'CENTRO_URBANO',
  ZONA_COMERCIAL: 'ZONA_COMERCIAL',
  ZONA_RESIDENCIAL: 'ZONA_RESIDENCIAL',
  ZONA_UNIVERSITARIA: 'ZONA_UNIVERSITARIA',
  ZONA_TURISTICA: 'ZONA_TURISTICA',
  ZONA_EMPRESARIAL: 'ZONA_EMPRESARIAL',
  PERIFERIA: 'PERIFERIA',
  ZONA_TRANSPORTE: 'ZONA_TRANSPORTE'
};

/**
 * Niveles de prioridad de servicio de patinetes
 */
const SCOOTER_PRIORITY_LEVELS = {
  BAJA: 'BAJA',
  MEDIA: 'MEDIA',
  ALTA: 'ALTA',
  CRITICA: 'CRITICA'
};

/**
 * Niveles de demanda estimada de patinetes
 */
const SCOOTER_DEMAND_LEVELS = {
  BAJA: 'BAJA',
  MEDIA: 'MEDIA',
  ALTA: 'ALTA',
  MUY_ALTA: 'MUY_ALTA'
};

/**
 * Proveedores de patinetes eléctricos
 * Valores extraídos del CSV Anthem_CTC_AsignaciónPatinetes.csv
 */
const SCOOTER_PROVIDERS = {
  ACCIONA: 'ACCIONA',
  BIRD: 'BIRD',
  FLASH: 'FLASH',
  JUMP_UBER: 'JUMP_UBER',
  KOKO: 'KOKO',
  LIME: 'LIME',
  MOVO: 'MOVO',
  MYGO: 'MYGO',
  REBY_RIDES: 'REBY_RIDES',
  RIDECONGA: 'RIDECONGA',
  SJV_CONSULTING: 'SJV_CONSULTING',
  TAXIFY: 'TAXIFY',
  UFO: 'UFO',
  WIND: 'WIND'
};

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
  LOCKED: 423,
  TOO_MANY_REQUESTS: 429,
  INTERNAL_SERVER_ERROR: 500,
  SERVICE_UNAVAILABLE: 503
};

/**
 * Tipos de persona en accidentes
 *
 * IMPORTANTE: Valores del CSV: CONDUCTOR, PASAJERO, PEATÓN
 * Valores adicionales de dominio:
 * - TESTIGO: Testigos presenciales de accidentes (no aparece en CSV actual)
 * - VIAJERO: Viajeros de transporte público (no aparece en CSV actual, alias de PASAJERO)
 */
const PERSON_TYPES = {
  CONDUCTOR: 'CONDUCTOR',
  PEATÓN: 'PEATÓN',
  TESTIGO: 'TESTIGO',
  VIAJERO: 'VIAJERO',
  PASAJERO: 'PASAJERO'
};

/**
 * Tipos de lesión en accidentes
 * IMPORTANTE: Valores exactos del CSV (espacios → guiones bajos, tildes preservadas)
 *
 * Incluye alias cortos para compatibilidad con código existente:
 * - LEVE: Lesiones menores (asistencia ambulatoria, en el lugar, sin asistencia)
 * - GRAVE: Lesiones graves (ingresos hospitalarios)
 * - FALLECIDO: Fallecido en 24 horas
 * - DESCONOCIDO: Se desconoce el tipo de lesión
 */
const INJURY_TYPES = {
  // Valores exactos del CSV
  ASISTENCIA_SANITARIA_AMBULATORIA_CON_POSTERIORIDAD: 'ASISTENCIA_SANITARIA_AMBULATORIA_CON_POSTERIORIDAD',
  ASISTENCIA_SANITARIA_INMEDIATA_EN_CENTRO_DE_SALUD_O_MUTUA: 'ASISTENCIA_SANITARIA_INMEDIATA_EN_CENTRO_DE_SALUD_O_MUTUA',
  ASISTENCIA_SANITARIA_SÓLO_EN_EL_LUGAR_DEL_ACCIDENTE: 'ASISTENCIA_SANITARIA_SÓLO_EN_EL_LUGAR_DEL_ACCIDENTE',
  ATENCIÓN_EN_URGENCIAS_SIN_POSTERIOR_INGRESO: 'ATENCIÓN_EN_URGENCIAS_SIN_POSTERIOR_INGRESO',
  FALLECIDO_24_HORAS: 'FALLECIDO_24_HORAS',
  INGRESO_INFERIOR_O_IGUAL_A_24_HORAS: 'INGRESO_INFERIOR_O_IGUAL_A_24_HORAS',
  INGRESO_SUPERIOR_A_24_HORAS: 'INGRESO_SUPERIOR_A_24_HORAS',
  SE_DESCONOCE: 'SE_DESCONOCE',
  SIN_ASISTENCIA_SANITARIA: 'SIN_ASISTENCIA_SANITARIA',

  // Alias para compatibilidad con código existente (no usar en imports CSV)
  LEVE: 'ASISTENCIA_SANITARIA_SÓLO_EN_EL_LUGAR_DEL_ACCIDENTE', // Representativo de lesiones leves
  GRAVE: 'INGRESO_SUPERIOR_A_24_HORAS', // Representativo de lesiones graves
  FALLECIDO: 'FALLECIDO_24_HORAS',
  DESCONOCIDO: 'SE_DESCONOCE'
};

/**
 * Mapeo de tipos de lesión por severidad
 * Usado para clasificar accidentes según impacto en personas
 *
 * IMPORTANTE: Este mapeo agrupa los valores descriptivos del CSV por severidad
 * para facilitar consultas y estadísticas sin depender de alias individuales
 */
const INJURY_SEVERITY_MAPPING = {
  GRAVES: [
    'FALLECIDO_24_HORAS',
    'INGRESO_SUPERIOR_A_24_HORAS',
    'INGRESO_INFERIOR_O_IGUAL_A_24_HORAS',
    'ATENCIÓN_EN_URGENCIAS_SIN_POSTERIOR_INGRESO'
  ],
  LEVES: [
    'ASISTENCIA_SANITARIA_AMBULATORIA_CON_POSTERIORIDAD',
    'ASISTENCIA_SANITARIA_INMEDIATA_EN_CENTRO_DE_SALUD_O_MUTUA',
    'ASISTENCIA_SANITARIA_SÓLO_EN_EL_LUGAR_DEL_ACCIDENTE',
    'SIN_ASISTENCIA_SANITARIA'
  ],
  DESCONOCIDAS: ['SE_DESCONOCE']
};

/**
 * Estados meteorológicos
 *
 * IMPORTANTE: Valores exactos del CSV (espacios → guiones bajos, sin tildes)
 * - DESPEJADO, NUBLADO, LLUVIA_DEBIL, LLUVIA_INTENSA, GRANIZANDO, NEVANDO, SE_DESCONOCE
 *
 * Valores adicionales de dominio (condiciones meteorológicas válidas):
 * - NIEBLA: No aparece en CSV actual, pero es condición meteorológica común
 * - VIENTO_FUERTE: No aparece en CSV actual, pero es condición meteorológica válida
 * - NULL: Valor presente en CSV para casos sin datos
 */
const WEATHER_CONDITIONS = {
  DESPEJADO: 'DESPEJADO',
  NUBLADO: 'NUBLADO',
  LLUVIA_DEBIL: 'LLUVIA_DEBIL',
  LLUVIA_INTENSA: 'LLUVIA_INTENSA',
  GRANIZANDO: 'GRANIZANDO',
  NEVANDO: 'NEVANDO',
  SE_DESCONOCE: 'SE_DESCONOCE',
  NIEBLA: 'NIEBLA',
  VIENTO_FUERTE: 'VIENTO_FUERTE',
  NULL: 'NULL',

  // Alias para compatibilidad
  DESCONOCIDO: 'SE_DESCONOCE'
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
 * Días de la semana
 * Usado para mapear índices de día (0-6) a nombres
 */
const DAYS_OF_WEEK = [
  'Domingo',
  'Lunes',
  'Martes',
  'Miércoles',
  'Jueves',
  'Viernes',
  'Sábado'
];

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
 * Nombres de meses
 */
const MONTH_NAMES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
];

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
 * IMPORTANTE: Valores exactos del CSV (M30 sin guion)
 */
const TRAFFIC_ELEMENT_TYPES = {
  URB: 'URB',
  M30: 'M30'
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
const POPULATION_DENSITY_LEVELS = {
  BAJA: 'BAJA',
  MEDIA: 'MEDIA',
  ALTA: 'ALTA',
  MUY_ALTA: 'MUY_ALTA'
};

/**
 * Niveles de diversidad cultural
 * Usado en metadatos de Census
 * ESTRUCTURA: Objeto clave-valor para eliminar accesos por índice
 */
const CULTURAL_DIVERSITY_LEVELS = {
  BAJA: 'BAJA',
  MEDIA: 'MEDIA',
  ALTA: 'ALTA'
};

/**
 * Tipos de campos en metadatos
 * Usado en Census para tracking de campos faltantes
 */
const CENSUS_FIELD_TYPES = {
  POBLACION: 'poblacion',
  UBICACION: 'ubicacion',
  EDAD: 'edad'
};

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
  DESCONOCIDO: 'DESCONOCIDO' // Cambiado de NO_ASIGNADO para coincidir con CSV
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
 * Valores por defecto para campos opcionales
 */
const DEFAULT_VALUES = {
  UNSPECIFIED: 'SIN ESPECIFICAR'
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
  MAX_DISTANCE_METERS: 5000,
  DEFAULT_DISTANCE_METERS: 500
};

/**
 * Límites de rangos de fechas para consultas
 * Diferentes endpoints permiten diferentes rangos máximos
 */
const DATE_RANGE_LIMITS = {
  DEFAULT_MAX_DAYS: 365, // 1 año por defecto
  ACCIDENTS_MAX_DAYS: 730, // 2 años para accidentes (datos históricos importantes)
  AIR_QUALITY_MAX_DAYS: 730, // 2 años para calidad de aire
  NOISE_MAX_DAYS: 1825, // 5 años para análisis histórico de ruido
  MAX_MILLISECONDS_CALCULATION: 24 * 60 * 60 * 1000 // Cálculo del rango en ms
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
    WINDOW_MS: 15 * 60 * 1000, // 15 minutos
    MAX_REQUESTS: 100,
    RETRY_AFTER: 15 * 60
  },

  EXPORT: {
    WINDOW_MS: 60 * 60 * 1000, // 1 hora
    MAX_REQUESTS: 5,
    RETRY_AFTER: 60 * 60
  },

  HEAVY_QUERY: {
    WINDOW_MS: 5 * 60 * 1000, // 5 minutos
    MAX_REQUESTS: 10,
    RETRY_AFTER: 5 * 60
  },

  AUTH: {
    WINDOW_MS: 15 * 60 * 1000, // 15 minutos
    MAX_REQUESTS: 10, // Más restrictivo para auth
    RETRY_AFTER: 15 * 60
  },

  // Rate limits específicos por recurso
  NOISE_MONITORING: {
    LIST_MAX: 25, // Listado general
    STATS_MAX: 10, // Estadísticas
    SEARCH_MAX: 15 // Búsquedas
  },

  AIR_QUALITY: {
    LIST_MAX: 30
  },

  ACCIDENTS: {
    HEATMAP_MAX: 10, // Análisis de mapa de calor
    EXPORT_MAX: 3 // Exportaciones (datos sensibles)
  }
};

/**
 * Límites específicos de validación por ruta/entidad
 * Agrupados por categoría para fácil mantenimiento
 */
const ROUTE_SPECIFIC_LIMITS = {
  // Traffic
  TRAFFIC: {
    PUNTO_MAX_LIMIT: 500 // Consultas de punto específico permiten más registros
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
    POINTS_MAX: 12, // Máximo de puntos del carnet
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
 * Indicadores binarios S/N/NULL y variantes
 * Usados en varios modelos para campos con valores binarios o ausentes
 *
 * IMPORTANTE: Valores exactos del CSV
 * - Multas: descuento usa "SI"/"NO"
 * - Accidentes: positiva_alcohol usa "S"/"N", positiva_droga usa "1" (numérico)
 * - Calidad aire: validación usa "V"/"N"
 */
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
const SCOOTER_REPORT_TYPES = {
  PROVEEDORES: 'proveedores',
  UBICACION: 'ubicacion',
  TOTALES: 'totales'
};

/**
 * Razones de revocación de tokens
 * Usados en TokenBlacklist para registrar por qué un token fue revocado
 */
const TOKEN_REVOCATION_REASONS = {
  ROTATION: 'rotation',
  LOGOUT: 'logout',
  COMPROMISED: 'compromised',
  PASSWORD_CHANGE: 'password_change'
};

/**
 * Campos de métricas de ruido
 * Usados en NoiseMonitoring para campos faltantes en metadatos
 */
const NOISE_METRIC_FIELDS = {
  NIVEL_DIURNO: 'nivelDiurno',
  NIVEL_VESPERTINO: 'nivelVespertino',
  NIVEL_NOCTURNO: 'nivelNocturno',
  LAEQ24: 'laeq24',
  PERCENTILES: 'percentiles'
};

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
  MILLISECONDS_PER_DAY: 24 * 60 * 60 * 1000, // 86400000 ms = 1 día
  MILLISECONDS_PER_HOUR: 60 * 60 * 1000, // 3600000 ms = 1 hora
  MILLISECONDS_PER_MINUTE: 60 * 1000 // 60000 ms = 1 minuto
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
 * Tipos de denunciante para multas de trafico
 * Valores extraidos del CSV Anthem_CTC_Multas_*.csv
 * ESTRUCTURA: Objeto clave-valor para eliminar hardcoded strings
 */
const FINE_DENOUNCER_TYPES = {
  POLICIA_MUNICIPAL: 'POLICIA MUNICIPAL',
  SER: 'SER',
  SACE: 'SACE',
  AGENTES_DE_MOVILIDAD: 'AGENTES DE MOVILIDAD'
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

/**
 * Años del dataset
 * IMPORTANTE: El dataset de Anthem Smart City contiene datos del año 2051
 * Estos valores se usan como defaults en consultas y validaciones
 *
 * CONTEXTO: Este proyecto trabaja con datos proyectados/simulados del futuro
 * para análisis de Smart City. NO cambiar estos valores sin revisar todo el proyecto.
 */
const DATASET_YEARS = {
  DEFAULT_YEAR: 2051, // Año por defecto para consultas (donde están los datos)
  MIN_YEAR: 2050, // Año mínimo del dataset
  MAX_YEAR: 2052, // Año máximo del dataset
  VALIDATION_MIN: 2000, // Validación mínima para inputs de usuario
  VALIDATION_MAX: 2099, // Validación máxima para inputs de usuario

  // Fechas default para consultas (strings ISO para construcción de Date objects)
  DEFAULT_START_DATE: '2051-01-01', // Fecha de inicio por defecto
  DEFAULT_END_DATE: '2051-12-31' // Fecha de fin por defecto
};

/**
 * Límites de validación numérica
 * Valores estándar usados en validaciones de Mongoose schemas
 * Centraliza min/max para edad, fechas, coordenadas, porcentajes, etc.
 */
const VALIDATION_LIMITS = {
  // Tiempo - Fechas y horas
  MONTH_MIN: 1,
  MONTH_MAX: 12,
  DAY_MIN: 1,
  DAY_MAX: 31,
  HOUR_MIN: 0,
  HOUR_MAX: 23,
  MINUTE_MIN: 0,
  MINUTE_MAX: 59,
  YEAR_MIN: 2000, // Años históricos aceptados
  YEAR_MAX: 3000, // Años futuros aceptados (para proyecciones)

  // Demografía y personas
  AGE_MIN: 0,
  AGE_MAX: 120, // Edad máxima humana razonable

  // Porcentajes y ratios
  PERCENTAGE_MIN: 0,
  PERCENTAGE_MAX: 100,
  RATIO_MIN: 0, // Ratios siempre no negativos
  SCORE_MIN: 0, // Puntuaciones normalizadas 0-1
  SCORE_MAX: 1,

  // Coordenadas geográficas - WGS84 (lat/lng)
  LATITUDE_MIN: -90,
  LATITUDE_MAX: 90,
  LONGITUDE_MIN: -180,
  LONGITUDE_MAX: 180,

  // Coordenadas UTM - España (zonas 29, 30, 31)
  UTM_X_MIN: 100000, // 100,000 m (100 km)
  UTM_X_MAX: 1000000, // 1,000,000 m (1,000 km)
  UTM_Y_MIN: 3000000, // 3,000,000 m (límite sur España)
  UTM_Y_MAX: 5000000, // 5,000,000 m (límite norte España)

  // Velocidades (km/h)
  SPEED_MIN: 0,
  SPEED_MAX: 300, // Velocidad máxima razonable (trenes de alta velocidad)

  // Ruido (decibelios dB)
  NOISE_MIN: 0,
  NOISE_MAX: 150, // 150 dB = umbral del dolor

  // Multas - Puntos de carnet
  DRIVER_POINTS_MIN: 0,
  DRIVER_POINTS_MAX: 12, // Sistema español de puntos de carnet

  // Cantidades genéricas
  QUANTITY_MIN: 0, // Cantidad no negativa
  QUANTITY_POSITIVE_MIN: 1, // Cantidad mínima positiva

  // Tráfico
  TRAFFIC_INTENSITY_MIN: 0,
  TRAFFIC_INTENSITY_MAX: 10000, // Vehículos/hora máximo razonable
  TRAFFIC_OCCUPANCY_MIN: 0,
  TRAFFIC_OCCUPANCY_MAX: 100 // Porcentaje de ocupación
};

/**
 * Thresholds de tráfico
 * Umbrales para clasificar niveles de congestión, intensidad y calidad de datos
 */
const TRAFFIC_THRESHOLDS = {
  // Niveles de congestión basados en ocupación (%) y carga (%)
  CONGESTION_CRITICAL_OCCUPANCY: 80, // >= 80% ocupación = Crítico
  CONGESTION_CRITICAL_LOAD: 90, // >= 90% carga = Crítico
  CONGESTION_HIGH_OCCUPANCY: 60, // >= 60% ocupación = Alto
  CONGESTION_HIGH_LOAD: 70, // >= 70% carga = Alto
  CONGESTION_MEDIUM_OCCUPANCY: 40, // >= 40% ocupación = Medio
  CONGESTION_MEDIUM_LOAD: 50, // >= 50% carga = Medio

  // Niveles de intensidad (vehículos/hora)
  INTENSITY_VERY_HIGH: 4000, // >= 4000 veh/h = Muy alta
  INTENSITY_HIGH: 3000, // >= 3000 veh/h = Alta
  INTENSITY_MEDIUM: 2000, // >= 2000 veh/h = Media
  INTENSITY_LOW: 1000, // >= 1000 veh/h = Baja

  // Calidad de datos por periodo de integración (minutos)
  DATA_QUALITY_EXCELLENT_PERIOD: 3, // >= 3 min + sin errores = Excelente
  DATA_QUALITY_GOOD_PERIOD: 2, // >= 2 min + datos parciales = Buena
  DATA_QUALITY_ACCEPTABLE_PERIOD: 1 // >= 1 min = Aceptable
};

/**
 * Límites de velocidad por zona (km/h)
 * Usado en Location model para defaults y validaciones
 */
const SPEED_LIMIT_ZONES = {
  ZONE_30: 30, // Zona 30 (mayoría de Madrid)
  ZONE_50: 50, // Zona 50 (vías principales)
  ZONE_70: 70, // Zona 70 (circunvalación)
  ZONE_90: 90, // Carreteras convencionales
  ZONE_120: 120, // Autopistas/autovías
  DEFAULT: 30 // Default para Madrid (zona 30)
};

/**
 * Whitelist de parámetros HTTP que legítimamente pueden ser arrays
 * Usado en middleware de seguridad (HPP protection) para permitir arrays en query strings
 *
 * IMPORTANTE: Solo incluir parámetros que REALMENTE necesitan soportar arrays múltiples
 * Formato típico de uso: ?ids=1&ids=2&ids=3 o ?distrito=Centro&distrito=Norte
 *
 * @constant {Array<string>}
 */
const HPP_ARRAY_PARAMS_WHITELIST = [
  // Identificadores
  'id', // Filtros por ID único
  'ids', // Filtros por múltiples IDs: ?ids=1&ids=2&ids=3

  // Estados y clasificaciones
  'status', // Múltiples estados: ?status=active&status=pending
  'tipo', // Tipos generales (contenedor, accidente, ubicación, etc.)
  'tipoContenedor', // Tipos de contenedor: ORGANICA, RESTO, ENVASES, etc.
  'tipoAccidente', // Tipos de accidente: ALCANCE, ATROPELLO, etc.
  'tipoVehiculo', // Tipos de vehículo: TURISMO, MOTOCICLETA, etc.
  'tipoInfraccion', // Tipos de infracción de tráfico

  // Ubicaciones geográficas
  'distrito', // Múltiples distritos en consultas (Census usa $in)
  'barrio', // Múltiples barrios

  // Calidad del aire
  'magnitud', // Múltiples magnitudes de contaminación: NO2, PM10, etc.
  'estacion', // Múltiples estaciones de medición

  // Ruido
  'nmt', // Múltiples estaciones de ruido (NoiseMonitoring usa $in)
  'stations', // Estaciones para comparativas de ruido

  // Multas
  'calificacion', // Múltiples calificaciones de multas: LEVE, GRAVE, MUY_GRAVE (Fine usa $in)

  // Accidentes
  'gravedad', // Múltiples gravedades de accidentes

  // Fechas (se usan en paralelo en muchas queries)
  'startDate', // Fecha de inicio de rango
  'endDate', // Fecha de fin de rango

  // Metadatos
  'fields' // Proyección de campos (usado en algunas consultas avanzadas)
];

module.exports = {
  // Severidad
  SEVERITY_LEVELS,

  // Ordenamiento
  SORT_FIELDS,

  // Paginación
  PAGINATION,
  MONGODB_TIMEOUTS,
  AGGREGATION_LIMITS,
  SPECIAL_PAGINATION_LIMITS,

  // Valores por defecto
  DEFAULT_VALUES,

  // Accidentes
  ACCIDENT_TYPES,
  VEHICLE_TYPES,
  PERSON_TYPES,
  INJURY_TYPES,
  INJURY_SEVERITY_MAPPING,
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
  FINE_DENOUNCER_TYPES,

  // Patinetes - Thresholds
  SCOOTER_DENSITY_THRESHOLDS,
  SCOOTER_DEMAND_THRESHOLDS,
  MARKET_CONCENTRATION_THRESHOLDS,

  // Censo - Thresholds
  CULTURAL_DIVERSITY_THRESHOLDS,

  // Bicicletas - Thresholds
  BIKE_USAGE_THRESHOLDS,

  // Dataset - Años de los datos
  DATASET_YEARS,

  // Validación - Límites numéricos
  VALIDATION_LIMITS,

  // Tráfico - Thresholds
  TRAFFIC_THRESHOLDS,

  // Velocidad - Zonas de límite
  SPEED_LIMIT_ZONES,

  // Seguridad HTTP - Whitelist para HPP protection
  HPP_ARRAY_PARAMS_WHITELIST,
  AIR_QUALITY_DEFAULTS,
  MONTH_NAMES,
  BIKE_THRESHOLDS: {
    DEMAND_PREDICTION: 80
  },
  CENSUS_DEFAULTS: {
    START_YEAR: 2051,
    END_YEAR: 2051,
    DISTRICT_LABEL: 'TODOS'
  },
  FINE_CONSTANTS: {
    DISCOUNT_PERCENTAGE: 50
  },
  DASHBOARD_PERIODS: {
    DAYS_7: 7,
    DAYS_30: 30,
    DAYS_90: 90
  },
  MEASUREMENT_POINT_TYPES: {
    ACUSTICA: 'acustica',
    TRAFICO: 'trafico'
  },
  TRANSPORT_ROUTE_TYPES: {
    CERCANIAS: 'ruta_cercanias',
    AUTOBUS: 'ruta_autobus',
    INTERURBANO: 'ruta_interurbano',
    METRO: 'ruta_metro',
    METRO_LIGERO: 'ruta_metro_ligero',
    TAXI: 'zona_taxi'
  },
  NOISE_THRESHOLDS: {
    DEFAULT: 65
  },
  ZONE_TYPES: {
    MIXED: 'mixed'
  },
  SCOOTER_KEY_AREAS: {
    CENTRAL: ['CENTRO', 'SOL'],
    UNIVERSITY: ['UNIVERSIDAD', 'CAMPUS'],
    TRANSPORT: ['ATOCHA', 'CHAMARTIN'],
    COMMERCIAL: ['RETIRO', 'SALAMANCA']
  },
  SCOOTER_AGGREGATION_FIELDS: {
    DISTRITO: 'distrito',
    BARRIO: 'barrio'
  },
  DEFAULT_SORT_FIELDS
};
