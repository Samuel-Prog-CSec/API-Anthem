/**
 * Sub-esquemas Comunes Reutilizables
 *
 * Define esquemas y validadores compartidos entre múltiples modelos
 * para mantener consistencia y evitar duplicación de código.
 */

const mongoose = require('mongoose');
const {
  VALIDATION_LIMITS,
  DATASET_YEARS
} = require('../../constants');

/**
 * Sub-esquema para coordenadas UTM (Universal Transverse Mercator)
 * Sistema de coordenadas utilizado en España (zonas 29, 30, 31)
 *
 * Validación de rangos:
 * - X: 100,000 - 1,000,000 metros (Este)
 * - Y: 3,000,000 - 5,000,000 metros (Norte)
 */
const coordinatesUTMSchema = new mongoose.Schema({
  x: {
    type: Number,
    required: false,
    min: [VALIDATION_LIMITS.UTM_X_MIN, `Coordenada X UTM fuera de rango válido para España (${VALIDATION_LIMITS.UTM_X_MIN} - ${VALIDATION_LIMITS.UTM_X_MAX} m)`],
    max: [VALIDATION_LIMITS.UTM_X_MAX, `Coordenada X UTM fuera de rango válido para España (${VALIDATION_LIMITS.UTM_X_MIN} - ${VALIDATION_LIMITS.UTM_X_MAX} m)`]
  },
  y: {
    type: Number,
    required: false,
    min: [VALIDATION_LIMITS.UTM_Y_MIN, `Coordenada Y UTM fuera de rango válido para España (${VALIDATION_LIMITS.UTM_Y_MIN} - ${VALIDATION_LIMITS.UTM_Y_MAX} m)`],
    max: [VALIDATION_LIMITS.UTM_Y_MAX, `Coordenada Y UTM fuera de rango válido para España (${VALIDATION_LIMITS.UTM_Y_MIN} - ${VALIDATION_LIMITS.UTM_Y_MAX} m)`]
  }
}, { _id: false });

/**
 * Sub-esquema para rango de fechas con validación
 * IMPORTANTE: Valida contra rango del dataset (2050-2052), NO contra fecha actual
 * El dataset de Anthem Smart City contiene datos proyectados del año 2051
 */
const dateRangeSchema = new mongoose.Schema({
  inicio: {
    type: Date,
    required: true,
    validate: {
      validator: function(v) {
        const year = v.getFullYear();
        return year >= DATASET_YEARS.MIN_YEAR && year <= DATASET_YEARS.MAX_YEAR;
      },
      message: `Fecha de inicio debe estar entre ${DATASET_YEARS.MIN_YEAR} y ${DATASET_YEARS.MAX_YEAR} (rango del dataset)`
    }
  },
  fin: {
    type: Date,
    required: true,
    validate: [
      {
        validator: function(v) {
          const year = v.getFullYear();
          return year >= DATASET_YEARS.MIN_YEAR && year <= DATASET_YEARS.MAX_YEAR;
        },
        message: `Fecha de fin debe estar entre ${DATASET_YEARS.MIN_YEAR} y ${DATASET_YEARS.MAX_YEAR} (rango del dataset)`
      },
      {
        validator: function(v) {
          return v >= this.inicio;
        },
        message: 'Fecha de fin debe ser posterior o igual a fecha de inicio'
      }
    ]
  }
}, { _id: false });

/**
 * Validador personalizado para horas en formato HH:MM o HH.MM
 * @param {String} time - Hora a validar
 * @returns {Boolean} - True si es válida
 */
function validateTimeFormat(time) {
  if (!time || time.trim() === '') {return false;}
  const timeRegex = /^([0-1]?[0-9]|2[0-3])[:.]([0-5][0-9])$/;
  return timeRegex.test(time);
}

/**
 * Validador personalizado para fechas del dataset
 * IMPORTANTE: Valida que la fecha esté en el rango del dataset (2050-2052), NO contra fecha actual
 * El dataset de Anthem Smart City contiene datos proyectados del año 2051
 *
 * @param {Date} date - Fecha a validar
 * @returns {Boolean} - True si está en rango del dataset
 */
function validateDatasetDate(date) {
  if (!date) {return false;}
  const dateObj = date instanceof Date ? date : new Date(date);
  if (isNaN(dateObj.getTime())) {return false;}

  const year = dateObj.getFullYear();
  return year >= DATASET_YEARS.MIN_YEAR && year <= DATASET_YEARS.MAX_YEAR;
}

/**
 * Validador personalizado para coordenadas geográficas (lat/lon)
 * @param {Number} valor - Coordenada a validar
 * @param {String} tipo - 'latitud' o 'longitud'
 * @returns {Boolean} - True si es válida
 */
function validateGeoCoordinate(valor, tipo) {
  if (tipo === 'latitud') {
    return valor >= VALIDATION_LIMITS.LATITUDE_MIN && valor <= VALIDATION_LIMITS.LATITUDE_MAX;
  } if (tipo === 'longitud') {
    return valor >= VALIDATION_LIMITS.LONGITUDE_MIN && valor <= VALIDATION_LIMITS.LONGITUDE_MAX;
  }
  return false;
}

/**
 * Validador personalizado para porcentajes (0-100)
 * @param {Number} value - Valor a validar
 * @returns {Boolean} - True si está en rango
 */
function validatePercentage(value) {
  return typeof value === 'number' && value >= VALIDATION_LIMITS.PERCENTAGE_MIN && value <= VALIDATION_LIMITS.PERCENTAGE_MAX;
}

/**
 * Validador personalizado para importes monetarios
 * Máximo 2 decimales, no negativo
 * @param {Number} amount - Importe a validar
 * @returns {Boolean} - True si es válido
 */
function validateAmount(amount) {
  if (typeof amount !== 'number' || amount < 0) {return false;}
  const decimals = (amount.toString().split('.')[1] || '').length;
  return decimals <= 2;
}

/**
 * Validador personalizado para edad (0-120 años)
 * @param {Number} age - Edad a validar
 * @returns {Boolean} - True si es válida
 */
function validateAge(age) {
  if (age === null || age === undefined) {return true;} // Opcional
  return Number.isInteger(age) && age >= VALIDATION_LIMITS.AGE_MIN && age <= VALIDATION_LIMITS.AGE_MAX;
}

/**
 * Validador personalizado para mes (1-12)
 * @param {Number} month - Mes a validar
 * @returns {Boolean} - True si es válido
 */
function validateMonth(month) {
  return Number.isInteger(month) && month >= VALIDATION_LIMITS.MONTH_MIN && month <= VALIDATION_LIMITS.MONTH_MAX;
}

/**
 * Validador personalizado para año (rango 2000-3000)
 * @param {Number} year - Año a validar
 * @returns {Boolean} - True si es válido
 */
function validateYear(year) {
  return Number.isInteger(year) && year >= VALIDATION_LIMITS.YEAR_MIN && year <= VALIDATION_LIMITS.YEAR_MAX;
}

/**
 * Validador personalizado para velocidad (0-300 km/h)
 * @param {Number} speed - Velocidad a validar
 * @returns {Boolean} - True si es válida
 */
function validateSpeed(speed) {
  if (speed === null || speed === undefined) {return true;} // Opcional
  return typeof speed === 'number' && speed >= VALIDATION_LIMITS.SPEED_MIN && speed <= VALIDATION_LIMITS.SPEED_MAX;
}

/**
 * Validador personalizado para nivel de ruido (0-150 dB)
 * @param {Number} level - Nivel de ruido a validar
 * @returns {Boolean} - True si es válido
 */
function validateNoiseLevel(level) {
  if (level === null || level === undefined) {return true;} // Opcional
  return typeof level === 'number' && level >= VALIDATION_LIMITS.NOISE_MIN && level <= VALIDATION_LIMITS.NOISE_MAX;
}

/**
 * Validador personalizado para puntos de carnet (0-12)
 * @param {Number} points - Puntos a validar
 * @returns {Boolean} - True si es válido
 */
function validateLicensePoints(points) {
  if (points === null || points === undefined) {return true;} // Opcional
  return Number.isInteger(points) && points >= VALIDATION_LIMITS.DRIVER_POINTS_MIN && points <= VALIDATION_LIMITS.DRIVER_POINTS_MAX;
}

// Exportar esquemas y validadores
module.exports = {
  // Esquemas
  coordinatesUTMSchema,
  dateRangeSchema,

  // Validadores
  validateTimeFormat,
  validateDatasetDate,
  validateGeoCoordinate,
  validatePercentage,
  validateAmount,
  validateAge,
  validateMonth,
  validateYear,
  validateSpeed,
  validateNoiseLevel,
  validateLicensePoints
};
