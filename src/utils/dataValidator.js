/**
 * Data Validator para Scripts de Importación
 *
 * Centraliza TODAS las validaciones que antes estaban en los modelos Mongoose.
 * Se usa en scripts de importación para validar datos de CSV antes de insertar.
 *
 * Ventajas:
 * - Una sola fuente de verdad para reglas de validación
 * - Reutilizable en scripts y endpoints API
 * - Fácil de testear (sin necesidad de MongoDB)
 * - Performance: solo se ejecuta cuando se importa/crea
 */

/**
 * Validar coordenadas UTM para España
 * @param {number} x - Coordenada X (Este)
 * @param {number} y - Coordenada Y (Norte)
 * @returns {{valid: boolean, error?: string, data?: object}}
 */
function validateUTMCoordinates(x, y) {
  if (x === null || x === undefined || y === null || y === undefined) {
    return { valid: true, data: null }; // Coordenadas opcionales
  }

  // Validación de rango España (zona 30N típica)
  if (x < 100000 || x > 1000000) {
    return {
      valid: false,
      error: `Coordenada X UTM (${x}) fuera de rango válido para España (100,000 - 1,000,000 metros)`
    };
  }

  if (y < 3000000 || y > 5000000) {
    return {
      valid: false,
      error: `Coordenada Y UTM (${y}) fuera de rango válido para España (3,000,000 - 5,000,000 metros)`
    };
  }

  return {
    valid: true,
    data: { x: Number(x), y: Number(y) }
  };
}

/**
 * Validar formato de hora
 * @param {string} hora - Hora en formato HH:MM o HH.MM
 * @returns {{valid: boolean, error?: string, data?: string}}
 */
function validateHora(hora) {
  if (!hora || hora.trim() === '') {
    return { valid: false, error: 'Hora es obligatoria' };
  }

  // Aceptar formato HH:MM o HH.MM
  const horaRegex = /^([0-1]?[0-9]|2[0-3])[:.]([0-5][0-9])$/;

  if (!horaRegex.test(hora)) {
    return {
      valid: false,
      error: `Hora "${hora}" no tiene formato válido (debe ser HH:MM o HH.MM, ej: 14:30)`
    };
  }

  // Normalizar a formato HH:MM
  const normalized = hora.replace('.', ':');

  return { valid: true, data: normalized };
}

/**
 * Validar fecha (no puede ser futura)
 * @param {Date|string} fecha - Fecha a validar
 * @returns {{valid: boolean, error?: string, data?: Date}}
 */
function validateFecha(fecha) {
  if (!fecha) {
    return { valid: false, error: 'Fecha es obligatoria' };
  }

  const fechaObj = fecha instanceof Date ? fecha : new Date(fecha);

  if (isNaN(fechaObj.getTime())) {
    return { valid: false, error: `Fecha "${fecha}" no es válida` };
  }

  if (fechaObj > new Date()) {
    return {
      valid: false,
      error: `Fecha ${fechaObj.toISOString()} no puede ser futura`
    };
  }

  return { valid: true, data: fechaObj };
}

/**
 * Validar edad de persona
 * @param {number} edad - Edad de la persona
 * @returns {{valid: boolean, error?: string, data?: number}}
 */
function validateEdad(edad) {
  if (edad === null || edad === undefined) {
    return { valid: true, data: null }; // Edad opcional
  }

  const edadNum = Number(edad);

  if (!Number.isInteger(edadNum)) {
    return { valid: false, error: `Edad "${edad}" debe ser un número entero` };
  }

  if (edadNum < 0 || edadNum > 120) {
    return {
      valid: false,
      error: `Edad ${edadNum} fuera de rango válido (0-120 años)`
    };
  }

  return { valid: true, data: edadNum };
}

/**
 * Validar importe monetario (máx 2 decimales, no negativo)
 * @param {number} importe - Importe a validar
 * @returns {{valid: boolean, error?: string, data?: number}}
 */
function validateImporte(importe) {
  if (!importe && importe !== 0) {
    return { valid: false, error: 'Importe es obligatorio' };
  }

  const importeNum = Number(importe);

  if (isNaN(importeNum)) {
    return { valid: false, error: `Importe "${importe}" no es un número válido` };
  }

  if (importeNum < 0) {
    return { valid: false, error: 'Importe no puede ser negativo' };
  }

  // Validar máximo 2 decimales
  const decimales = (importeNum.toString().split('.')[1] || '').length;
  if (decimales > 2) {
    return {
      valid: false,
      error: `Importe ${importeNum} tiene más de 2 decimales (debe tener máximo 2)`
    };
  }

  // Redondear a 2 decimales por si acaso
  const importeRedondeado = Math.round(importeNum * 100) / 100;

  return { valid: true, data: importeRedondeado };
}

/**
 * Validar puntos de carnet (0-12, entero)
 * @param {number} puntos - Puntos detraídos
 * @returns {{valid: boolean, error?: string, data?: number}}
 */
function validatePuntosCarnet(puntos) {
  if (puntos === null || puntos === undefined) {
    return { valid: false, error: 'Puntos detraídos es obligatorio' };
  }

  const puntosNum = Number(puntos);

  if (!Number.isInteger(puntosNum)) {
    return { valid: false, error: 'Puntos deben ser un número entero' };
  }

  if (puntosNum < 0 || puntosNum > 12) {
    return {
      valid: false,
      error: `Puntos ${puntosNum} fuera de rango (0-12 puntos)`
    };
  }

  return { valid: true, data: puntosNum };
}

/**
 * Validar mes (1-12)
 * @param {number} mes - Mes del año
 * @returns {{valid: boolean, error?: string, data?: number}}
 */
function validateMes(mes) {
  const mesNum = Number(mes);

  if (!Number.isInteger(mesNum) || mesNum < 1 || mesNum > 12) {
    return { valid: false, error: `Mes ${mes} no válido (debe ser 1-12)` };
  }

  return { valid: true, data: mesNum };
}

/**
 * Validar año (rango 2000-3000)
 * @param {number} año - Año
 * @returns {{valid: boolean, error?: string, data?: number}}
 */
function validateAño(año) {
  const añoNum = Number(año);

  if (!Number.isInteger(añoNum) || añoNum < 2000 || añoNum > 3000) {
    return { valid: false, error: `Año ${año} no válido (debe ser 2000-3000)` };
  }

  return { valid: true, data: añoNum };
}

/**
 * Validar población (entero no negativo)
 * @param {number} poblacion - Cantidad de población
 * @returns {{valid: boolean, error?: string, data?: number}}
 */
function validatePoblacion(poblacion) {
  if (poblacion === null || poblacion === undefined) {
    return { valid: false, error: 'Cantidad de población es obligatoria' };
  }

  const poblacionNum = Number(poblacion);

  if (!Number.isInteger(poblacionNum)) {
    return { valid: false, error: 'Población debe ser un número entero' };
  }

  if (poblacionNum < 0) {
    return { valid: false, error: 'Población no puede ser negativa' };
  }

  return { valid: true, data: poblacionNum };
}

/**
 * Validar nivel de ruido en decibelios (0-150 dB)
 * @param {number} nivelRuido - Nivel de ruido en dB
 * @returns {{valid: boolean, error?: string, data?: number}}
 */
function validateNivelRuido(nivelRuido) {
  if (nivelRuido === null || nivelRuido === undefined) {
    return { valid: true, data: null }; // Nivel de ruido opcional
  }

  const nivelNum = Number(nivelRuido);

  if (isNaN(nivelNum)) {
    return { valid: false, error: 'Nivel de ruido debe ser un número' };
  }

  if (nivelNum < 0 || nivelNum > 150) {
    return {
      valid: false,
      error: `Nivel de ruido ${nivelNum} dB fuera de rango válido (0-150 dB)`
    };
  }

  return { valid: true, data: nivelNum };
}

/**
 * Validar velocidad (0-300 km/h)
 * @param {number} velocidad - Velocidad en km/h
 * @returns {{valid: boolean, error?: string, data?: number}}
 */
function validateVelocidad(velocidad) {
  if (velocidad === null || velocidad === undefined) {
    return { valid: true, data: null }; // Velocidad opcional
  }

  const velocidadNum = Number(velocidad);

  if (isNaN(velocidadNum) || velocidadNum < 0 || velocidadNum > 300) {
    return {
      valid: false,
      error: `Velocidad ${velocidad} no válida (debe ser 0-300 km/h)`
    };
  }

  return { valid: true, data: velocidadNum };
}

/**
 * Validar múltiples campos y devolver errores agregados
 * @param {Object} validations - Objeto con resultados de validaciones
 * @returns {{valid: boolean, errors: string[]}}
 *
 * Ejemplo:
 * const result = validateMultiple({
 *   fecha: validateFecha(row.fecha),
 *   hora: validateHora(row.hora),
 *   coordenadas: validateUTMCoordinates(row.x, row.y)
 * });
 *
 * if (!result.valid) {
 *   console.error('Errores:', result.errors);
 * }
 */
function validateMultiple(validations) {
  const errors = [];
  const validData = {};

  for (const [field, validation] of Object.entries(validations)) {
    if (!validation.valid) {
      errors.push(`${field}: ${validation.error}`);
    } else if (validation.data !== undefined) {
      validData[field] = validation.data;
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    data: validData
  };
}

module.exports = {
  // Validadores individuales
  validateUTMCoordinates,
  validateHora,
  validateFecha,
  validateEdad,
  validateImporte,
  validatePuntosCarnet,
  validateMes,
  validateAño,
  validatePoblacion,
  validateNivelRuido,
  validateVelocidad,

  // Helper para múltiples validaciones
  validateMultiple
};
