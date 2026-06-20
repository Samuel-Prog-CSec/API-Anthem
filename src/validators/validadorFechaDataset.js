/**
 * Validador de fecha del dataset, compartido por los endpoints de ingesta IoT.
 *
 * Valida que una fecha:
 *  - tenga formato ISO 8601 (YYYY-MM-DD o ISO completo con hora),
 *  - este dentro del rango de anios del dataset (DATASET_YEARS),
 *  - sea una fecha de calendario REAL. En particular RECHAZA 2051-02-29: 2051 no
 *    es bisiesto, el dataset trae ese dia ficticio y `new Date('2051-02-29')` lo
 *    desbordaria silenciosamente a 2051-03-01, corrompiendo el 1 de marzo
 *    (coherente con el rechazo explicito de los importadores CSV).
 *
 * Uso con express-validator: `body('fecha').exists().bail().custom(validarFechaDataset)`.
 */

const { DATASET_YEARS } = require('../constants');

/**
 * @param {string|Date} valor - Fecha a validar (string ISO o Date)
 * @returns {boolean} true si es valida
 * @throws {Error} con mensaje en espanol si no lo es
 */
const validarFechaDataset = (valor) => {
  const texto = valor instanceof Date ? valor.toISOString() : String(valor);
  const coincidencia = /^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/.exec(texto);
  if (!coincidencia) {
    throw new Error('La fecha debe tener formato ISO 8601 (YYYY-MM-DD o ISO completo)');
  }

  const anio = Number(coincidencia[1]);
  const mesBase1 = Number(coincidencia[2]);
  const dia = Number(coincidencia[3]);

  if (anio < DATASET_YEARS.MIN_YEAR || anio > DATASET_YEARS.MAX_YEAR) {
    throw new Error(`El anio debe estar entre ${DATASET_YEARS.MIN_YEAR} y ${DATASET_YEARS.MAX_YEAR} (rango del dataset Smart City 2051)`);
  }
  if (mesBase1 < 1 || mesBase1 > 12) {
    throw new Error('El mes de la fecha es invalido');
  }

  // Verificar que la fecha existe realmente en el calendario (rechaza 29/02 de
  // anios no bisiestos como 2050 y 2051). Se comparan los componentes UTC.
  const fecha = new Date(Date.UTC(anio, mesBase1 - 1, dia));
  const existe = fecha.getUTCFullYear() === anio
    && fecha.getUTCMonth() === mesBase1 - 1
    && fecha.getUTCDate() === dia;
  if (!existe) {
    throw new Error(`Fecha de calendario inexistente: ${coincidencia[1]}-${coincidencia[2]}-${coincidencia[3]} (recuerde que ${anio} no es bisiesto)`);
  }

  return true;
};

module.exports = { validarFechaDataset };
