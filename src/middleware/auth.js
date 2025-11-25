/**
 * Middleware de Autenticación
 *
 * Maneja la validación de tokens JWT y autenticación de usuarios.
 * Protege rutas que requieren autenticación de usuario.
 *
 */

const User = require('../models/User');
const { verifyToken, extractToken } = require('../utils/tokenHelper');
const { createUnauthorizedResponse } = require('../utils/responseHelper');
const { authLogger } = require('../config/logger');
const { logTokenValidation } = require('../utils/securityLogger');
const { HTTP_STATUS } = require('../constants');

/**
 * Middleware de autenticación
 *
 * Verifica el token JWT y adjunta la información del usuario al objeto request.
 * Protege rutas que requieren usuarios autenticados.
 *
 * @param {object} req - Objeto request de Express
 * @param {object} res - Objeto response de Express
 * @param {function} next - Función next de Express
 */
const authenticate = async (req, res, next) => {
  try {
    // Extraer token de la petición
    let token;

    try {
      token = extractToken(req);
    } catch (error) {
      // Token en query string bloqueado en producción
      return res.status(401).json(
        createUnauthorizedResponse(error.message)
      );
    }

    if (!token) {
      return res.status(401).json(
        createUnauthorizedResponse('Se requiere un token de acceso')
      );
    }

    // Verificar token
    let decoded;
    try {
      decoded = await verifyToken(token);

      // Registrar validación exitosa de token
      logTokenValidation(true, null, {
        userId: decoded.id,
        ip: req.ip,
        userAgent: req.get('user-agent')
      });
    } catch (error) {
      // Registrar validación fallida de token
      logTokenValidation(false, error.message, {
        tokenPrefix: token.substring(0, 20) + '...',
        ip: req.ip,
        userAgent: req.get('user-agent')
      });

      return res.status(401).json(
        createUnauthorizedResponse(`Validación de token fallida: ${error.message}`)
      );
    }

    // Obtener usuario del payload del token
    const user = await User.findById(decoded.id).select('-password');

    if (!user) {
      return res.status(401).json(
        createUnauthorizedResponse('Usuario no encontrado')
      );
    }

    // Verificar si la cuenta de usuario está activa
    if (!user.isActive) {
      return res.status(HTTP_STATUS.FORBIDDEN).json(
        createUnauthorizedResponse('La cuenta está desactivada')
      );
    }

    // Verificar si la cuenta está bloqueada
    if (user.isLocked) {
      return res.status(HTTP_STATUS.LOCKED).json(
        createUnauthorizedResponse('La cuenta está temporalmente bloqueada')
      );
    }

    // Verificar si el usuario cambió la contraseña después de emitir el token
    if (user.changedPasswordAfter(decoded.iat)) {
      return res.status(HTTP_STATUS.UNAUTHORIZED).json(
        createUnauthorizedResponse('El usuario cambió la contraseña recientemente. Por favor inicie sesión nuevamente.')
      );
    }

    // Adjuntar usuario al objeto request
    req.user = user;
    req.token = token;

    next();

  } catch (error) {
    authLogger.error({
      error: error.message,
      stack: error.stack,
      path: req.path,
      method: req.method,
      ip: req.ip
    }, 'Error en middleware de autenticación');
    return res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json(
      createUnauthorizedResponse('Error de autenticación')
    );
  }
};

module.exports = {
  authenticate
};
