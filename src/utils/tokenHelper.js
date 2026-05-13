/**
 * Utilidades de Helper de Tokens
 *
 * Proporciona utilidades para generación, validación y gestión de tokens JWT.
 * Implementa mejores prácticas de seguridad para manejo de tokens.
 *
 */

const jwt = require('jsonwebtoken');
const config = require('../config/config');

/**
 * Genera un token de acceso JWT
 *
 * @param {object} payload - Datos del payload del token
 * @param {string} expiresIn - Tiempo de expiración del token (opcional)
 * @returns {string} Token JWT generado
 */
const generateAccessToken = (payload, expiresIn = config.jwt.expiresIn) => {
  return jwt.sign(
    payload,
    config.jwt.secret,
    {
      expiresIn,
      algorithm: config.jwt.algorithm,
      issuer: config.jwt.issuer,
      audience: config.jwt.audience
    }
  );
};

/**
 * Genera un token de refresco (expiración más larga)
 *
 * @param {object} payload - Datos del payload del token
 * @returns {string} Token de refresco generado
 */
const generateRefreshToken = (payload) => {
  return jwt.sign(
    payload,
    config.jwt.refreshSecret,
    {
      expiresIn: config.jwt.refreshExpiresIn, // Configurado desde variable de entorno
      algorithm: config.jwt.algorithm,
      issuer: config.jwt.issuer,
      audience: 'api-rest-auth-refresh'
    }
  );
};

/**
 * Genera tokens de acceso y de refresco
 *
 * @param {object} user - Objeto de usuario
 * @returns {object} Objeto conteniendo ambos tokens
 */
const generateTokens = (user) => {
  const payload = {
    id: user._id,
    username: user.username,
    email: user.email,
    role: user.role
  };

  return {
    accessToken: generateAccessToken(payload),
    refreshToken: generateRefreshToken({ id: user._id })
  };
};

/**
 * Verifica y decodifica un token JWT
 *
 * @param {string} token - Token JWT a verificar
 * @returns {Promise<object>} Payload del token decodificado
 * @throws {Error} Si el token es inválido o ha expirado
 */
const verifyToken = async (token) => {
  try {
    return jwt.verify(token, config.jwt.secret, {
      algorithms: [config.jwt.algorithm],
      issuer: config.jwt.issuer,
      audience: config.jwt.audience
    });
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      throw new Error('El token ha expirado');
    } else if (error.name === 'JsonWebTokenError') {
      throw new Error('Token inválido');
    } else if (error.name === 'NotBeforeError') {
      throw new Error('Token no activo');
    } else {
      throw new Error('Verificación de token fallida');
    }
  }
};

/**
 * Verifica un token de refresco
 *
 * @param {string} token - Token de refresco a verificar
 * @returns {Promise<object>} Payload del token decodificado
 * @throws {Error} Si el token es inválido o ha expirado
 */
const verifyRefreshToken = async (token) => {
  try {
    return jwt.verify(token, config.jwt.refreshSecret, {
      algorithms: [config.jwt.algorithm],
      issuer: config.jwt.issuer,
      audience: 'api-rest-auth-refresh'
    });
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      throw new Error('El token de refresco ha expirado');
    } else if (error.name === 'JsonWebTokenError') {
      throw new Error('Token de refresco inválido');
    } else if (error.name === 'NotBeforeError') {
      throw new Error('Token de refresco no activo');
    } else {
      throw new Error('Verificación de token de refresco fallida');
    }
  }
};

/**
 * Extrae el token del header Authorization o de la cookie `accessToken`.
 *
 * Orden de extraccion:
 * 1. Header `Authorization: Bearer <token>` (uso principal del frontend SPA).
 * 2. Cookie httpOnly `accessToken` (alineada con el nombre que emite
 *    `controladorAutenticacion` en register/login/refresh).
 *
 * No se acepta token en query string en NINGUN entorno: los query params
 * suelen quedar logueados en proxies, browsers y herramientas de devtools,
 * lo que filtra el token a terceros sin que el usuario lo perciba.
 *
 * @param {object} req - Objeto request de Express
 * @returns {string|null} Token extraido o null si no se encontro
 */
const extractToken = (req) => {
  // Verificar header Authorization
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7);
  }

  // Verificar cookie httpOnly `accessToken` (alineada con `res.cookie('accessToken', ...)` del controller)
  if (req.cookies && req.cookies.accessToken) {
    return req.cookies.accessToken;
  }

  return null;
};

/**
 * Obtener fecha de expiración de un token JWT
 *
 * @param {string} token - Token JWT
 * @returns {Date} Fecha de expiración
 * @throws {Error} Si el token es inválido o no tiene expiración
 */
const getTokenExpiration = (token) => {
  try {
    const decoded = jwt.decode(token);

    if (!decoded || !decoded.exp) {
      throw new Error('El token no tiene fecha de expiración');
    }

    return new Date(decoded.exp * 1000);
  } catch (error) {
    throw new Error(`Fallo al obtener expiración del token: ${error.message}`);
  }
};

module.exports = {
  generateAccessToken,
  generateRefreshToken,
  generateTokens,
  verifyToken,
  verifyRefreshToken,
  extractToken,
  getTokenExpiration
};
