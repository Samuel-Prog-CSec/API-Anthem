/**
 * Logger de Eventos de Seguridad
 *
 * Funciones wrapper para registrar eventos de seguridad usando Pino securityLogger.
 * Proporciona una interfaz consistente para logging de eventos de seguridad en toda la aplicación.
 *
 * POR QUÉ EXISTE ESTO (vs usar Pino securityLogger directamente):
 * 1. Estandariza el formato de eventos de seguridad
 * 2. Centraliza los nombres de eventos (LOGIN_ATTEMPT, PASSWORD_CHANGE, etc.)
 * 3. Simplifica el uso desde controladores (no necesitan conocer estructura interna)
 * 4. Usa directamente el securityLogger de Pino (no crea logger duplicado)
 * 5. Facilita cambios futuros en formato sin modificar controladores
 *
 */

const { securityLogger } = require('../config/logger');

/**
 * Registrar intento de inicio de sesión
 *
 * @param {boolean} success - Si el inicio de sesión fue exitoso
 * @param {string} identifier - Email o nombre de usuario usado
 * @param {string} userId - ID de usuario (si se encontró)
 * @param {string} ip - Dirección IP del cliente
 * @param {string} userAgent - Cadena de user agent
 * @param {string} reason - Razón del fallo (si aplica)
 */
const logLoginAttempt = (success, identifier, userId, ip, userAgent, reason = null) => {
  const logData = {
    event: 'LOGIN_ATTEMPT',
    success,
    identifier,
    userId,
    ip,
    userAgent
  };

  if (!success && reason) {
    logData.reason = reason;
  }

  if (success) {
    securityLogger.info(logData, 'Intento de inicio de sesión exitoso');
  } else {
    securityLogger.warn(logData, 'Intento de inicio de sesión fallido');
  }
};

/**
 * Registrar cambio de contraseña
 *
 * @param {string} userId - ID de usuario
 * @param {string} ip - Dirección IP del cliente
 * @param {boolean} success - Si el cambio fue exitoso
 */
const logPasswordChange = (userId, ip, success = true) => {
  const logData = {
    event: 'PASSWORD_CHANGE',
    userId,
    ip,
    success
  };

  if (success) {
    securityLogger.info(logData, 'Contraseña cambiada exitosamente');
  } else {
    securityLogger.error(logData, 'Cambio de contraseña fallido');
  }
};

/**
 * Registrar intento de acceso no autorizado
 *
 * @param {string} userId - ID de usuario (si está autenticado)
 * @param {string} resource - Recurso/ruta intentado
 * @param {string} action - Acción intentada
 * @param {string} ip - Dirección IP del cliente
 * @param {string} reason - Razón de denegación
 */
const logUnauthorizedAccess = (userId, resource, action, ip, reason) => {
  securityLogger.warn({
    event: 'UNAUTHORIZED_ACCESS',
    userId,
    resource,
    action,
    ip,
    reason
  }, 'Intento de acceso no autorizado');
};

/**
 * Registrar evento de validación de token
 *
 * @param {boolean} success - Si la validación fue exitosa
 * @param {string} reason - Razón del fallo (si aplica)
 * @param {object} metadata - Metadatos adicionales (userId, ip, userAgent, tokenPrefix)
 */
const logTokenValidation = (success, reason, metadata = {}) => {
  const logData = {
    event: 'TOKEN_VALIDATION',
    success,
    ...metadata
  };

  if (!success && reason) {
    logData.reason = reason;
  }

  if (success) {
    securityLogger.info(logData, 'Validación de token exitosa');
  } else {
    securityLogger.warn(logData, 'Validación de token fallida');
  }
};

/**
 * Registrar bloqueo de cuenta
 *
 * @param {string} userId - ID de usuario
 * @param {string} identifier - Email o nombre de usuario
 * @param {number} attempts - Número de intentos fallidos
 * @param {Date} lockUntil - Tiempo de expiración del bloqueo
 * @param {string} ip - Dirección IP del cliente
 */
const logAccountLockout = (userId, identifier, attempts, lockUntil, ip) => {
  securityLogger.warn({
    event: 'ACCOUNT_LOCKOUT',
    userId,
    identifier,
    failedAttempts: attempts,
    lockUntil: lockUntil.toISOString(),
    ip
  }, `Cuenta bloqueada después de ${attempts} intentos fallidos`);
};

/**
 * Registrar refresco de token
 *
 * @param {string} userId - ID de usuario
 * @param {boolean} rotated - Si el token fue rotado
 * @param {string} ip - Dirección IP del cliente
 */
const logTokenRefresh = (userId, rotated, ip) => {
  securityLogger.info({
    event: 'TOKEN_REFRESH',
    userId,
    rotated,
    ip
  }, 'Token refrescado' + (rotated ? ' con rotación' : ''));
};

/**
 * Registrar registro de usuario
 *
 * @param {string} userId - ID del nuevo usuario
 * @param {string} email - Email del usuario
 * @param {string} username - Nombre de usuario
 * @param {string} ip - Dirección IP del cliente
 */
const logUserRegistration = (userId, email, username, ip) => {
  securityLogger.info({
    event: 'USER_REGISTRATION',
    userId,
    email,
    username,
    ip
  }, 'Nuevo usuario registrado');
};

/**
 * Registrar terminación de sesión
 *
 * @param {string} userId - ID de usuario
 * @param {string} reason - Razón de terminación (logout, force_logout, timeout)
 * @param {string} ip - Dirección IP del cliente
 */
const logSessionTermination = (userId, reason, ip) => {
  securityLogger.info({
    event: 'SESSION_TERMINATION',
    userId,
    reason,
    ip
  }, `Sesión terminada: ${reason}`);
};

/**
 * Registrar verificación de permisos
 *
 * @param {string} userId - ID de usuario
 * @param {string} resource - Recurso al que se está accediendo
 * @param {string} permission - Permiso requerido
 * @param {boolean} granted - Si el permiso fue concedido
 * @param {string} ip - Dirección IP del cliente
 */
const logPermissionCheck = (userId, resource, permission, granted, ip) => {
  const logData = {
    event: 'PERMISSION_CHECK',
    userId,
    resource,
    permission,
    granted,
    ip
  };

  if (granted) {
    securityLogger.info(logData, 'Permiso concedido');
  } else {
    securityLogger.warn(logData, 'Permiso denegado');
  }
};

module.exports = {
  logLoginAttempt,
  logPasswordChange,
  logUnauthorizedAccess,
  logTokenValidation,
  logAccountLockout,
  logTokenRefresh,
  logUserRegistration,
  logSessionTermination,
  logPermissionCheck
};
