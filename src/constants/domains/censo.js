/**
 * Constantes de dominio: Censo Demografico
 *
 * Grupos de edad, rangos, generos, niveles de densidad y diversidad cultural,
 * y umbrales para clasificacion sociologica.
 */

const AGE_GROUPS = {
  INFANTIL: 'INFANTIL',
  JUVENIL: 'JUVENIL',
  ADULTO_JOVEN: 'ADULTO_JOVEN',
  ADULTO: 'ADULTO',
  MAYOR: 'MAYOR',
  ANCIANO: 'ANCIANO'
};

const POPULATION_DENSITY_LEVELS = {
  BAJA: 'BAJA',
  MEDIA: 'MEDIA',
  ALTA: 'ALTA',
  MUY_ALTA: 'MUY_ALTA'
};

const CULTURAL_DIVERSITY_LEVELS = {
  BAJA: 'BAJA',
  MEDIA: 'MEDIA',
  ALTA: 'ALTA'
};

const CENSUS_FIELD_TYPES = {
  POBLACION: 'poblacion',
  UBICACION: 'ubicacion',
  EDAD: 'edad'
};

const AGE_RANGES = {
  INFANTIL: { min: 0, max: 14 },
  JUVENIL: { min: 15, max: 24 },
  ADULTO_JOVEN: { min: 25, max: 44 },
  ADULTO: { min: 45, max: 64 },
  MAYOR: { min: 65, max: 84 },
  ANCIANO: { min: 85, max: 120 }
};

const WORKING_AGE = { min: 16, max: 65 };
const ELDERLY_AGE = { min: 65, max: 120 };

const GENDERS = {
  HOMBRE: 'HOMBRE',
  MUJER: 'MUJER',
  DESCONOCIDO: 'DESCONOCIDO'
};

const CULTURAL_DIVERSITY_THRESHOLDS = {
  HIGH: 25,
  MEDIUM: 10,
  LOW: 0
};

const CENSUS_DEFAULTS = {
  START_YEAR: 2051,
  END_YEAR: 2051,
  DISTRICT_LABEL: 'TODOS'
};

const DASHBOARD_PERIODS = {
  DAYS_7: 7,
  DAYS_30: 30,
  DAYS_90: 90
};

module.exports = {
  AGE_GROUPS,
  POPULATION_DENSITY_LEVELS,
  CULTURAL_DIVERSITY_LEVELS,
  CENSUS_FIELD_TYPES,
  AGE_RANGES,
  WORKING_AGE,
  ELDERLY_AGE,
  GENDERS,
  CULTURAL_DIVERSITY_THRESHOLDS,
  CENSUS_DEFAULTS,
  DASHBOARD_PERIODS
};
