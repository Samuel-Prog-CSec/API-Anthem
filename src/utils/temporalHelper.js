/**
 * Utilidades temporales compartidas para la ingesta de datos de sensores.
 *
 * Centraliza la derivacion de campos temporales (franja horaria del dia y
 * normalizacion a medianoche UTC) para que los endpoints de ingesta IoT
 * produzcan EXACTAMENTE los mismos valores que los importadores CSV
 * (ver scripts/importation/importarAforoBicicletas.js -> getFranjaHoraria).
 */

const { DAY_PERIODS } = require('../constants');

/**
 * Determina la franja horaria del dia a partir de la hora (0-23).
 * Cortes identicos a los importadores de aforo (bicicletas/peatones).
 *
 * @param {number} hora - Hora del dia [0-23]
 * @returns {string} Franja horaria (uno de DAY_PERIODS)
 */
const obtenerFranjaHoraria = (hora) => {
  if (hora >= 0 && hora <= 5) { return DAY_PERIODS.MADRUGADA; }
  if (hora >= 6 && hora <= 11) { return DAY_PERIODS.MAÑANA; }
  if (hora >= 12 && hora <= 14) { return DAY_PERIODS.MEDIODIA; }
  if (hora >= 15 && hora <= 20) { return DAY_PERIODS.TARDE; }
  return DAY_PERIODS.NOCHE;
};

/**
 * Normaliza una fecha a la medianoche UTC de su dia natural.
 *
 * Necesario para casar con la clave unica de las colecciones diarias
 * (p.ej. air_quality usa (estacion, magnitud, fecha-dia) y los aforos
 * (identificador, fecha-dia, hora)). Trabaja siempre en UTC para no depender
 * del huso horario de la maquina que ejecuta el servidor.
 *
 * @param {Date|string|number} fecha - Fecha de entrada
 * @returns {Date} Fecha a las 00:00:00.000 UTC del mismo dia natural
 */
const inicioDiaUTC = (fecha) => {
  const d = fecha instanceof Date ? fecha : new Date(fecha);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
};

module.exports = {
  obtenerFranjaHoraria,
  inicioDiaUTC
};
