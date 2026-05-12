/**
 * Constantes de dominio: Contaminacion Acustica
 *
 * Limites normativos europeos por periodo del dia, campos de metricas
 * y tipos de zona urbana para analisis de cumplimiento.
 */

/**
 * Limites de ruido (LAeq, dB) usados para evaluar cumplimiento normativo
 * en estaciones acusticas urbanas.
 *
 * Fuente: Directiva 2002/49/CE del Parlamento Europeo sobre evaluacion y
 * gestion del ruido ambiental, transpuesta en Espana por la Ley 37/2003
 * del Ruido y el Real Decreto 1367/2007 (objetivos de calidad acustica
 * para zonas urbanas residenciales tipo "a").
 *
 * Periodos:
 *   DIURNO       (Day,     07:00-19:00) -> 65 dB
 *   VESPERTINO   (Evening, 19:00-23:00) -> 65 dB
 *   NOCTURNO     (Night,   23:00-07:00) -> 55 dB (mas restrictivo)
 *
 * Notas:
 * - Son objetivos para zonas residenciales/sectores predominantes; otras
 *   tipologias (industrial, sanitario, docente) tienen limites distintos
 *   no modelados aqui.
 * - Estos cortes coinciden con los D/E/N del dataset y con los del
 *   periodizador europeo. Ojo: NO coinciden con los periodos del dataset
 *   de Trafico (00-07 / 07-12 / 12-15 / 15-21 / 21-00), que responde a
 *   patrones de movilidad y no a la directiva de ruido.
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
