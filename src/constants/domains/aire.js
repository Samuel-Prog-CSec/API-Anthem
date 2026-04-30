/**
 * Constantes de dominio: Calidad del Aire
 *
 * Magnitudes del Ministerio para la Transicion Ecologica (MITECO),
 * lista derivada de magnitudes permitidas y valores por defecto.
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

// Generado dinamicamente desde AIR_QUALITY_MAGNITUDES para asegurar consistencia
const MAGNITUDES_PERMITIDAS = Object.keys(AIR_QUALITY_MAGNITUDES).map(Number);

const AIR_QUALITY_DEFAULTS = {
  PROVINCIA: 28,
  MUNICIPIO: 79,
  MAGNITUD: 10
};

module.exports = {
  AIR_QUALITY_MAGNITUDES,
  MAGNITUDES_PERMITIDAS,
  AIR_QUALITY_DEFAULTS
};
