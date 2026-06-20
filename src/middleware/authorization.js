/**
 * Middleware de Autorización
 *
 * Maneja el control de acceso basado en roles y verificación de permisos.
 * Funciona en conjunto con el middleware de autenticación.
 *
 */

const { createForbiddenResponse } = require('../utils/responseHelper');
const { authLogger } = require('../config/logger');
const { logPermissionCheck, logUnauthorizedAccess } = require('../utils/securityLogger');
const { HTTP_STATUS, USER_ROLES } = require('../constants');

/**
 * Factory de middleware de autorización basada en roles
 *
 * Crea middleware que verifica si el usuario autenticado tiene el/los rol(es) requerido(s).
 * Debe usarse después del middleware de autenticación.
 *
 * @param {...string} roles - Roles requeridos
 * @returns {function} Función middleware de autorización
 */
const authorize = (...roles) => {
  return (req, res, next) => {
    // Verificar si el usuario está autenticado
    if (!req.user) {
      return res.status(HTTP_STATUS.UNAUTHORIZED).json(
        createForbiddenResponse('Se requiere autenticación para este recurso')
      );
    }

    // Verificar si el usuario tiene el rol requerido
    if (!roles.includes(req.user.role)) {
      authLogger.warn({
        username: req.user.username,
        userRole: req.user.role,
        requiredRoles: roles,
        path: req.path,
        method: req.method
      }, 'Autorización fallida - permisos insuficientes');

      // Registrar evento de seguridad
      logPermissionCheck(
        req.user._id.toString(),
        req.path,
        roles.join('|'),
        false,
        req.ip
      );

      logUnauthorizedAccess(
        req.user._id.toString(),
        req.path,
        req.method,
        req.ip,
        `Rol requerido: ${roles.join('|')}, Rol de usuario: ${req.user.role}`
      );

      return res.status(HTTP_STATUS.FORBIDDEN).json(
        createForbiddenResponse('Permisos insuficientes para acceder a este recurso')
      );
    }

    authLogger.debug({
      username: req.user.username,
      userRole: req.user.role,
      requiredRoles: roles,
      path: req.path
    }, 'Autorización concedida');

    // Registrar verificación de permisos exitosa
    logPermissionCheck(
      req.user._id.toString(),
      req.path,
      roles.join('|'),
      true,
      req.ip
    );

    next();
  };
};

/**
 * Middleware de autorización solo para administradores
 * Atajo para autorización de rol admin
 *
 * @param {object} req - Objeto request de Express
 * @param {object} res - Objeto response de Express
 * @param {function} next - Función next de Express
 */
const adminOnly = (req, res, next) => {
  return authorize('admin')(req, res, next);
};

/**
 * Middleware de autorizacion para las rutas de ingesta de sensores (IoT).
 *
 * Permite solo a usuarios con rol SENSOR (nodos IoT aprovisionados) o ADMIN.
 * El registro publico crea siempre rol USER, de modo que un usuario que se
 * auto-registre NO puede escribir datos de sensores (mitiga el control de
 * acceso a nivel de funcion: OWASP API5). Las credenciales de sensor se
 * aprovisionan fuera de banda (scripts/provisionarSensor.js).
 */
const sensorOrAdmin = authorize(USER_ROLES.SENSOR, USER_ROLES.ADMIN);

module.exports = {
  authorize,
  adminOnly,
  sensorOrAdmin
};
