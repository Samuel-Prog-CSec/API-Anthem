/**
 * Utilidad de Validación de Contraseñas
 *
 * Proporciona funciones para validar la fortaleza de contraseñas
 * antes de que sean hasheadas.
 */

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

  // Validar carácter especial
  if (!/[@$!%*?&#+\-_=]/.test(password)) {
    errors.push('La contraseña debe contener al menos un carácter especial (@$!%*?&#+\\-_=)');
  }

  return {
    isValid: errors.length === 0,
    errors
  };
};

/**
 * Verifica si una contraseña es común o débil
 *
 * @param {string} password - Contraseña a verificar
 * @returns {boolean} True si es una contraseña común
 */
const isCommonPassword = (password) => {
  // Lista de contraseñas comunes (se puede expandir)
  const commonPasswords = [
    'password',
    'password123',
    '12345678',
    'qwerty',
    'abc123',
    'letmein',
    'welcome',
    'monkey',
    '1234567890',
    'Password1',
    'Password123',
    'admin',
    'admin123',
    'root',
    'toor',
    'pass',
    'test'
  ];

  return commonPasswords.some(common =>
    password.toLowerCase().includes(common.toLowerCase())
  );
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
