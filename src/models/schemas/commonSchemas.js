/**
 * Sub-esquemas Comunes Reutilizables
 *
 * Define esquemas y validadores compartidos entre múltiples modelos
 * para mantener consistencia y evitar duplicación de código.
 */

const mongoose = require('mongoose');
const { validateUTMCoordinates } = require('../../utils/dataValidator');

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
    min: [100000, 'Coordenada X UTM fuera de rango válido para España (100,000 - 1,000,000 m)'],
    max: [1000000, 'Coordenada X UTM fuera de rango válido para España (100,000 - 1,000,000 m)'],
    validate: {
      validator: function(v) {
        // Solo validar si está definida
        if (v === null || v === undefined) {return true;}
        // Validar usando función centralizada
        const result = validateUTMCoordinates(v, this.y || 0);
        return result.valid || !this.y; // Si no hay Y, no validar coherencia
      },
      message: props => `Coordenada X (${props.value}) no es válida para el sistema UTM de España`
    }
  },
  y: {
    type: Number,
    required: false,
    min: [3000000, 'Coordenada Y UTM fuera de rango válido para España (3,000,000 - 5,000,000 m)'],
    max: [5000000, 'Coordenada Y UTM fuera de rango válido para España (3,000,000 - 5,000,000 m)'],
    validate: {
      validator: function(v) {
        // Solo validar si está definida
        if (v === null || v === undefined) {return true;}
        // Validar usando función centralizada
        const result = validateUTMCoordinates(this.x || 0, v);
        return result.valid || !this.x; // Si no hay X, no validar coherencia
      },
      message: props => `Coordenada Y (${props.value}) no es válida para el sistema UTM de España`
    }
  }
}, { _id: false });

/**
 * Sub-esquema para rango de fechas con validación
 * Asegura que las fechas no sean futuras y tengan formato válido
 */
const dateRangeSchema = new mongoose.Schema({
  inicio: {
    type: Date,
    required: true,
    validate: {
      validator: function(v) {
        return v <= new Date();
      },
      message: 'Fecha de inicio no puede ser futura'
    }
  },
  fin: {
    type: Date,
    required: true,
    validate: [
      {
        validator: function(v) {
          return v <= new Date();
        },
        message: 'Fecha de fin no puede ser futura'
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
 * Validador personalizado para fechas no futuras
 * @param {Date} date - Fecha a validar
 * @returns {Boolean} - True si no es futura
 */
function validateNotFutureDate(date) {
  if (!date) {return false;}
  const dateObj = date instanceof Date ? date : new Date(date);
  return !isNaN(dateObj.getTime()) && dateObj <= new Date();
}

/**
 * Validador personalizado para coordenadas geográficas (lat/lon)
 * @param {Number} valor - Coordenada a validar
 * @param {String} tipo - 'latitud' o 'longitud'
 * @returns {Boolean} - True si es válida
 */
function validateGeoCoordinate(valor, tipo) {
  if (tipo === 'latitud') {
    return valor >= -90 && valor <= 90;
  } if (tipo === 'longitud') {
    return valor >= -180 && valor <= 180;
  }
  return false;
}

/**
 * Validador personalizado para porcentajes (0-100)
 * @param {Number} value - Valor a validar
 * @returns {Boolean} - True si está en rango
 */
function validatePercentage(value) {
  return typeof value === 'number' && value >= 0 && value <= 100;
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
  return Number.isInteger(age) && age >= 0 && age <= 120;
}

/**
 * Validador personalizado para mes (1-12)
 * @param {Number} month - Mes a validar
 * @returns {Boolean} - True si es válido
 */
function validateMonth(month) {
  return Number.isInteger(month) && month >= 1 && month <= 12;
}

/**
 * Validador personalizado para año (rango 2000-3000)
 * @param {Number} year - Año a validar
 * @returns {Boolean} - True si es válido
 */
function validateYear(year) {
  return Number.isInteger(year) && year >= 2000 && year <= 3000;
}

/**
 * Validador personalizado para velocidad (0-300 km/h)
 * @param {Number} speed - Velocidad a validar
 * @returns {Boolean} - True si es válida
 */
function validateSpeed(speed) {
  if (speed === null || speed === undefined) {return true;} // Opcional
  return typeof speed === 'number' && speed >= 0 && speed <= 300;
}

/**
 * Validador personalizado para nivel de ruido (0-150 dB)
 * @param {Number} level - Nivel de ruido a validar
 * @returns {Boolean} - True si es válido
 */
function validateNoiseLevel(level) {
  if (level === null || level === undefined) {return true;} // Opcional
  return typeof level === 'number' && level >= 0 && level <= 150;
}

/**
 * Validador personalizado para puntos de carnet (0-12)
 * @param {Number} points - Puntos a validar
 * @returns {Boolean} - True si es válido
 */
function validateLicensePoints(points) {
  if (points === null || points === undefined) {return true;} // Opcional
  return Number.isInteger(points) && points >= 0 && points <= 12;
}

// Exportar esquemas y validadores
module.exports = {
  // Esquemas
  coordinatesUTMSchema,
  dateRangeSchema,

  // Validadores
  validateTimeFormat,
  validateNotFutureDate,
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
