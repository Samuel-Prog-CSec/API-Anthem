/**
 * Constantes de dominio: Contaminacion Acustica
 *
 * Limites normativos europeos por periodo del dia, campos de metricas
 * y tipos de zona urbana para analisis de cumplimiento.
 */

const NOISE_LIMITS = {
  DIURNO: 65,
  VESPERTINO: 65,
  NOCTURNO: 55
};

const NOISE_METRIC_FIELDS = {
  NIVEL_DIURNO: 'nivelDiurno',
  NIVEL_VESPERTINO: 'nivelVespertino',
  NIVEL_NOCTURNO: 'nivelNocturno',
  LAEQ24: 'laeq24',
  PERCENTILES: 'percentiles'
};

const NOISE_THRESHOLDS = {
  DEFAULT: 65
};

const ZONE_TYPES = {
  RESIDENTIAL: 'residential',
  COMMERCIAL: 'commercial',
  INDUSTRIAL: 'industrial',
  PARKS: 'parks',
  MIXED: 'mixed'
};

module.exports = {
  NOISE_LIMITS,
  NOISE_METRIC_FIELDS,
  NOISE_THRESHOLDS,
  ZONE_TYPES
};
