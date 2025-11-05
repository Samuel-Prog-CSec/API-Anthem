/**
 * Security Event Logger
 *
 * Wrapper functions for logging security events using Pino securityLogger.
 * Provides a consistent interface for security event logging throughout the application.
 *
 * WHY THIS EXISTS (vs using Pino securityLogger directly):
 * 1. Estandariza el formato de eventos de seguridad
 * 2. Centraliza los nombres de eventos (LOGIN_ATTEMPT, PASSWORD_CHANGE, etc.)
 * 3. Simplifica el uso desde controladores (no necesitan conocer estructura interna)
 * 4. Usa directamente el securityLogger de Pino (no crea logger duplicado)
 * 5. Facilita cambios futuros en formato sin modificar controladores
 *
 */

const { securityLogger } = require('../config/logger');

/**
 * Log login attempt
 *
 * @param {boolean} success - Whether login was successful
 * @param {string} identifier - Email or username used
 * @param {string} userId - User ID (if found)
 * @param {string} ip - Client IP address
 * @param {string} userAgent - User agent string
 * @param {string} reason - Failure reason (if applicable)
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
    securityLogger.info(logData, 'Login attempt successful');
  } else {
    securityLogger.warn(logData, 'Login attempt failed');
  }
};

/**
 * Log password change
 *
 * @param {string} userId - User ID
 * @param {string} ip - Client IP address
 * @param {boolean} success - Whether change was successful
 */
const logPasswordChange = (userId, ip, success = true) => {
  const logData = {
    event: 'PASSWORD_CHANGE',
    userId,
    ip,
    success
  };

  if (success) {
    securityLogger.info(logData, 'Password changed successfully');
  } else {
    securityLogger.error(logData, 'Password change failed');
  }
};

/**
 * Log unauthorized access attempt
 *
 * @param {string} userId - User ID (if authenticated)
 * @param {string} resource - Attempted resource/path
 * @param {string} action - Attempted action
 * @param {string} ip - Client IP address
 * @param {string} reason - Denial reason
 */
const logUnauthorizedAccess = (userId, resource, action, ip, reason) => {
  securityLogger.warn({
    event: 'UNAUTHORIZED_ACCESS',
    userId,
    resource,
    action,
    ip,
    reason
  }, 'Unauthorized access attempt');
};

/**
 * Log token validation event
 *
 * @param {boolean} success - Whether validation succeeded
 * @param {string} reason - Failure reason (if applicable)
 * @param {object} metadata - Additional metadata (userId, ip, userAgent, tokenPrefix)
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
    securityLogger.info(logData, 'Token validation successful');
  } else {
    securityLogger.warn(logData, 'Token validation failed');
  }
};

/**
 * Log account lockout
 *
 * @param {string} userId - User ID
 * @param {string} identifier - Email or username
 * @param {number} attempts - Number of failed attempts
 * @param {Date} lockUntil - Lock expiration time
 * @param {string} ip - Client IP address
 */
const logAccountLockout = (userId, identifier, attempts, lockUntil, ip) => {
  securityLogger.warn({
    event: 'ACCOUNT_LOCKOUT',
    userId,
    identifier,
    failedAttempts: attempts,
    lockUntil: lockUntil.toISOString(),
    ip
  }, `Account locked after ${attempts} failed attempts`);
};

/**
 * Log token refresh
 *
 * @param {string} userId - User ID
 * @param {boolean} rotated - Whether token was rotated
 * @param {string} ip - Client IP address
 */
const logTokenRefresh = (userId, rotated, ip) => {
  securityLogger.info({
    event: 'TOKEN_REFRESH',
    userId,
    rotated,
    ip
  }, 'Token refreshed' + (rotated ? ' with rotation' : ''));
};

/**
 * Log user registration
 *
 * @param {string} userId - New user ID
 * @param {string} email - User email
 * @param {string} username - Username
 * @param {string} ip - Client IP address
 */
const logUserRegistration = (userId, email, username, ip) => {
  securityLogger.info({
    event: 'USER_REGISTRATION',
    userId,
    email,
    username,
    ip
  }, 'New user registered');
};

/**
 * Log session termination
 *
 * @param {string} userId - User ID
 * @param {string} reason - Termination reason (logout, force_logout, timeout)
 * @param {string} ip - Client IP address
 */
const logSessionTermination = (userId, reason, ip) => {
  securityLogger.info({
    event: 'SESSION_TERMINATION',
    userId,
    reason,
    ip
  }, `Session terminated: ${reason}`);
};

/**
 * Log permission check
 *
 * @param {string} userId - User ID
 * @param {string} resource - Resource being accessed
 * @param {string} permission - Required permission
 * @param {boolean} granted - Whether permission was granted
 * @param {string} ip - Client IP address
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
    securityLogger.info(logData, 'Permission granted');
  } else {
    securityLogger.warn(logData, 'Permission denied');
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
