/**
 * Utilidad de Validación de Contraseñas
 *
 * Proporciona funciones para validar la fortaleza de contraseñas
 * antes de que sean hasheadas.
 */

// Lista de contraseñas comunes (top-500 sintetizada a partir de fuentes
// publicas: RockYou breach, SecLists, NIST common-passwords). Se carga una
// sola vez al arranque y se indexa en un `Set` para lookup O(1).
//
// Comparacion: exact match case-insensitive (no `includes`). El patron
// `includes` anterior bloqueaba contrasenas legitimas como
// "MiPasswordEspecial2025!" solo por contener "password". El estandar NIST
// recomienda match exacto sobre listas de contrasenas filtradas.
const commonPasswordsList = require('./data/commonPasswords.json');
const commonPasswordsSet = new Set(
  commonPasswordsList.map(entry => entry.toLowerCase())
);

/**
 * Valida la fortaleza de una contraseña
 *
 * Requisitos:
 * - Mínimo 8 caracteres
 * - Al menos una letra mayúscula
 * - Al menos una letra minúscula
 * - Al menos un número
 * - Al menos un carácter especial
 *
 * @param {string} password - Contraseña a validar
 * @returns {Object} { isValid: boolean, errors: string[] }
 */
const validatePasswordStrength = (password) => {
  const errors = [];

  if (!password || typeof password !== 'string') {
    return {
      isValid: false,
      errors: ['La contraseña es obligatoria']
    };
  }

  // Validar longitud mínima
  if (password.length < 8) {
    errors.push('La contraseña debe tener al menos 8 caracteres');
  }

  // Validar longitud máxima
  if (password.length > 128) {
    errors.push('La contraseña no puede exceder 128 caracteres');
  }

  // Validar letra mayúscula
  if (!/[A-Z]/.test(password)) {
    errors.push('La contraseña debe contener al menos una letra mayúscula');
  }

  // Validar letra minúscula
  if (!/[a-z]/.test(password)) {
    errors.push('La contraseña debe contener al menos una letra minúscula');
  }

  // Validar número
  if (!/\d/.test(password)) {
    errors.push('La contraseña debe contener al menos un número');
  }

  // Validar caracter especial (cualquier no alfanumerico). Antes la lista era
  // restrictiva y rechazaba caracteres comunes como ^, (, ), [, ], ~, etc.,
  // generando errores confusos para usuarios con teclados internacionales.
  if (!/[^A-Za-z0-9]/.test(password)) {
    errors.push('La contraseña debe contener al menos un carácter especial (cualquier no alfanumérico)');
  }

  return {
    isValid: errors.length === 0,
    errors
  };
};

/**
 * Verifica si una contraseña esta en la lista de contrasenas comunes.
 *
 * Comparacion exacta case-insensitive: solo se rechaza si la contrasena
 * coincide exactamente con una entrada de la lista (tras `toLowerCase()`).
 * Asi una contrasena fuerte que contenga un substring comun (ej:
 * "MiClaveSegura2025!") no se ve bloqueada injustamente.
 *
 * @param {string} password - Contraseña a verificar
 * @returns {boolean} True si la contrasena coincide con una comun
 */
const isCommonPassword = (password) => {
  if (typeof password !== 'string' || password.length === 0) {
    return false;
  }
  return commonPasswordsSet.has(password.toLowerCase());
};

/**
 * Validación completa de contraseña (fortaleza + contraseñas comunes)
 *
 * @param {string} password - Contraseña a validar
 * @returns {Object} { isValid: boolean, errors: string[] }
 */
const validatePassword = (password) => {
  const strengthValidation = validatePasswordStrength(password);

  if (!strengthValidation.isValid) {
    return strengthValidation;
  }

  // Verificar contraseñas comunes
  if (isCommonPassword(password)) {
    return {
      isValid: false,
      errors: ['La contraseña es demasiado común. Por favor, elija una contraseña más segura']
    };
  }

  return {
    isValid: true,
    errors: []
  };
};

module.exports = {
  validatePasswordStrength,
  isCommonPassword,
  validatePassword
};
