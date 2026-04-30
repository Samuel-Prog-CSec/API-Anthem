/**
 * Constantes de dominio: Bicicletas Electricas
 *
 * Umbrales de uso por porcentaje de ocupacion y umbrales para prediccion
 * de demanda.
 */

const UMBRALES_USO_BICICLETAS = {
  HIGH_DEMAND_OCCUPANCY: 80,
  MEDIUM_DEMAND_OCCUPANCY: 60,
  LOW_DEMAND_OCCUPANCY: 40,
  MIN_OCCUPANCY: 0
};

const BIKE_THRESHOLDS = {
  DEMAND_PREDICTION: 80
};

module.exports = {
  UMBRALES_USO_BICICLETAS,
  BIKE_THRESHOLDS
};
