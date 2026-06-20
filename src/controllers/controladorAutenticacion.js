/**
 * Controlador de Autenticación
 *
 * Gestiona las operaciones de autenticación de usuarios incluyendo registro, login,
 * y gestión de tokens con medidas de seguridad completas.
 *
 */

const bcrypt = require('bcryptjs');
const User = require('../models/User');
const TokenBlacklist = require('../models/TokenBlacklist');
const config = require('../config/config');
const { createResponse } = require('../utils/responseHelper');
const { validatePassword } = require('../utils/passwordValidator');
const {
  HTTP_STATUS,
  MONGODB_TIMEOUTS,
  TIME_CONSTANTS,
  TOKEN_REVOCATION_REASONS,
  TOKEN_VALIDATION
} = require('../constants');
const {
  createAuthError,
  createConflictError,
  createNotFoundError,
  createBadRequestError,
  createForbiddenError,
  handleMongoError,
  formatErrorResponse
} = require('../utils/errorUtils');
const { authLogger } = require('../config/logger');
const {
  generateTokens,
  verifyRefreshToken,
  getTokenExpiration,
  decodeToken
} = require('../utils/tokenHelper');
const {
  logLoginAttempt,
  logUserRegistration,
  logSessionTermination,
  logTokenRefresh,
  logAccountLockout,
  logPasswordChange
} = require('../utils/securityLogger');
const asyncHandler = require('../utils/asyncHandler');

// Las cookies van con Secure cuando el servidor sirve sobre HTTPS (produccion)
// En desarrollo local sin HTTPS, Secure se desactiva para que el navegador acepte la cookie
const esProduccion = config.server.env === 'production';

const baseCookieOptions = {
  httpOnly: true,
  secure: esProduccion,
  sameSite: 'strict',
  path: '/'
};

// Opciones para la cookie del REFRESH token. En produccion usa SameSite=None
// para que el navegador la envie en peticiones CROSS-SITE: la SPA puede servirse
// desde un site distinto al de la API (p.ej. frontend en local o en otro host ->
// API en la nube). Sin esto, la cookie httpOnly de refresh no viaja cross-site y
// la sesion no se restaura al recargar ni se renueva (logout a los ~15 min).
// SameSite=None EXIGE Secure (ya activo en produccion).
//
// SEGURIDAD: el access token NO se afloja (sigue Strict). La SPA lo usa via header
// Authorization (en memoria), por lo que su cookie no necesita viajar cross-site;
// mantenerla Strict evita CSRF a traves del fallback de cookie de `extractToken`
// en los endpoints protegidos. El unico consumidor de la cookie de refresh es
// /auth/refresh, y un CSRF alli es inocuo: la respuesta no se puede leer por CORS
// y los tokens rotados se entregan en cookies httpOnly inaccesibles al atacante.
const baseRefreshCookieOptions = {
  httpOnly: true,
  secure: esProduccion,
  sameSite: esProduccion ? 'none' : 'strict',
  path: '/'
};

const buildCookieOptions = (maxAgeMs) => ({
  ...baseCookieOptions,
  maxAge: maxAgeMs
});

const buildRefreshCookieOptions = (maxAgeMs) => ({
  ...baseRefreshCookieOptions,
  maxAge: maxAgeMs
});

const isValidTokenFormat = (token) =>
  typeof token === 'string'
  && token.length <= TOKEN_VALIDATION.MAX_TOKEN_LENGTH
  && TOKEN_VALIDATION.JWT_REGEX.test(token);

// Hash bcrypt placeholder usado cuando el usuario no existe en login.
// Realiza un compare contra este hash para igualar el tiempo de respuesta con
// el de un login real con contrasena incorrecta. Mitiga ataques de timing que
// podrian enumerar usuarios validos midiendo la latencia entre "usuario
// inexistente" (rapido) vs "usuario existe, contrasena mala" (slow por bcrypt).
// El hash corresponde a una string aleatoria que nunca coincidira con input
// real; coste regenerado en cada arranque para evitar dependencia de un valor
// fijo en disco.
const TIMING_DUMMY_HASH = bcrypt.hashSync(
  `dummy-${Date.now()}-${Math.random()}`,
  config.security.bcryptSaltRounds
);

/**
 * Controlador de Registro de Usuario
 *
 * Crea una nueva cuenta de usuario con validacion y verificaciones de seguridad.
 * Previene cuentas duplicadas y asegura la integridad de datos.
 *
 * Nota: el manejo de errores generales lo cubre `asyncHandler` + `globalErrorHandler`.
 * Aqui se mantiene un catch especifico solo para errores de MongoDB (duplicate key,
 * validation, cast) porque requieren transformacion via `handleMongoError`.
 *
 * @route POST /api/v1/auth/register
 * @access Public
 */
const register = asyncHandler(async (req, res, next) => {
  const { username, email, password } = req.body;

  // Validar fortaleza de contrasena ANTES de hashear
  const passwordValidation = validatePassword(password);
  if (!passwordValidation.isValid) {
    return next(createBadRequestError('La contrasena no cumple los requisitos de seguridad', {
      errors: passwordValidation.errors
    }));
  }

  // Verificar si el usuario ya existe
  const existingUser = await User.findByEmailOrUsername(email).maxTimeMS(MONGODB_TIMEOUTS.QUERY_TIMEOUT_MS);
  if (existingUser) {
    return next(createConflictError('Ya existe un usuario con este email o nombre de usuario'));
  }

  // Crear nuevo usuario. Capturamos errores de MongoDB conocidos
  // (duplicate key, validacion, cast) y los transformamos via handleMongoError
  // a un AppError tipado, que el globalErrorHandler convertira en respuesta
  // HTTP. Otros errores se propagan sin transformar.
  const user = new User({ username, email, password });
  try {
    await user.save();
  } catch (error) {
    // Duplicado por carrera (dos registros simultaneos con el mismo
    // email/username): devolver el MISMO mensaje generico que la verificacion
    // previa. `handleMongoError` revelaria el campo (email vs username) y el
    // valor concretos, habilitando enumeracion de usuarios.
    if (error.code === 11000) {
      return next(createConflictError('Ya existe un usuario con este email o nombre de usuario'));
    }
    if (error.name === 'ValidationError' || error.name === 'CastError') {
      return next(handleMongoError(error));
    }
    throw error;
  }

  // Generar access token y refresh token
  const tokens = generateTokens(user);

  // Preparar datos del usuario para respuesta (excluyendo informacion sensible)
  const userData = {
    id: user._id,
    username: user.username,
    email: user.email,
    role: user.role,
    isActive: user.isActive,
    createdAt: user.createdAt
  };

  // Establecer cookies HTTP-only seguras para los tokens
  res.cookie('accessToken', tokens.accessToken, buildCookieOptions(15 * TIME_CONSTANTS.MILLISECONDS_PER_MINUTE));
  res.cookie('refreshToken', tokens.refreshToken, buildRefreshCookieOptions(30 * TIME_CONSTANTS.MILLISECONDS_PER_DAY));

  req.log.info({ username, email }, 'Nuevo usuario registrado exitosamente');

  // Registrar evento de seguridad
  logUserRegistration(user._id.toString(), email, username, req.ip);

  res.status(HTTP_STATUS.CREATED).json(
    createResponse(
      {
        user: userData,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken
      },
      'Usuario registrado exitosamente'
    )
  );
});

/**
 * Controlador de Login de Usuario
 *
 * Autentica credenciales de usuario y proporciona token de acceso.
 * Implementa bloqueo de cuenta y seguimiento de intentos de login.
 *
 * @route POST /api/v1/auth/login
 * @access Public
 */
const login = asyncHandler(async (req, res, next) => {
  const { identifier, password } = req.body;

  // Buscar usuario por email o nombre de usuario
  const user = await User.findByEmailOrUsername(identifier).maxTimeMS(MONGODB_TIMEOUTS.QUERY_TIMEOUT_MS);
  if (!user) {
    // Mitigacion de timing attack: ejecutar bcrypt.compare dummy para igualar
    // tiempo de respuesta con un login fallido por contrasena incorrecta. Sin
    // esto, la diferencia de latencia entre "no existe" (~5ms) y "existe pero
    // mala" (~150ms con bcrypt cost 12) permite enumerar usuarios validos.
    await bcrypt.compare(password || '', TIMING_DUMMY_HASH);
    logLoginAttempt(false, identifier, null, req.ip, req.get('user-agent'), 'user_not_found');
    return next(createAuthError('Credenciales invalidas'));
  }

  // Verificar si la cuenta esta bloqueada
  if (user.isLocked) {
    logLoginAttempt(false, identifier, user._id.toString(), req.ip, req.get('user-agent'), 'account_locked');
    logAccountLockout(user._id.toString(), identifier, user.loginAttempts, user.lockUntil, req.ip);

    return res.status(HTTP_STATUS.LOCKED).json(
      formatErrorResponse(
        createAuthError('Cuenta bloqueada temporalmente por demasiados intentos fallidos')
      )
    );
  }

  // Verificar si la cuenta esta activa
  if (!user.isActive) {
    logLoginAttempt(false, identifier, user._id.toString(), req.ip, req.get('user-agent'), 'account_inactive');
    return next(createForbiddenError('La cuenta esta desactivada'));
  }

  // Validar contrasena
  const isPasswordValid = await user.comparePassword(password);
  if (!isPasswordValid) {
    await user.handleFailedLogin();
    logLoginAttempt(false, identifier, user._id.toString(), req.ip, req.get('user-agent'), 'invalid_password');
    return next(createAuthError('Credenciales invalidas'));
  }

  // Manejar login exitoso
  await user.handleSuccessfulLogin();

  // Registrar login exitoso
  logLoginAttempt(true, identifier, user._id.toString(), req.ip, req.get('user-agent'));

  // Generar access token y refresh token
  const tokens = generateTokens(user);

  // Preparar datos del usuario para respuesta
  const userData = {
    id: user._id,
    username: user.username,
    email: user.email,
    role: user.role,
    isActive: user.isActive,
    lastLogin: new Date()
  };

  // Establecer cookies HTTP-only seguras para los tokens
  res.cookie('accessToken', tokens.accessToken, buildCookieOptions(15 * TIME_CONSTANTS.MILLISECONDS_PER_MINUTE));
  res.cookie('refreshToken', tokens.refreshToken, buildRefreshCookieOptions(30 * TIME_CONSTANTS.MILLISECONDS_PER_DAY));

  req.log.info({ username: user.username, email: user.email }, 'Usuario inicio sesion exitosamente');

  res.status(HTTP_STATUS.OK).json(
    createResponse(
      {
        user: userData,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken
      },
      'Login exitoso'
    )
  );
});

/**
 * Controlador de Logout de Usuario
 *
 * Invalida la sesión actual limpiando cookies y agregando el refresh token a lista negra.
 *
 * @route POST /api/v1/auth/logout
 * @access Private
 */
const logout = asyncHandler(async (req, res) => {
  // Obtener refresh token de cookies o body
  const refreshToken = req.cookies?.refreshToken || req.body?.refreshToken;

  // Si existe refresh token, agregarlo a lista negra (solo si formato es valido)
  if (refreshToken) {
    if (!isValidTokenFormat(refreshToken)) {
      authLogger.warn({ ip: req.ip }, 'Refresh token con formato invalido durante logout');
    } else {
      try {
        const decoded = await verifyRefreshToken(refreshToken);
        const tokenExpiration = getTokenExpiration(refreshToken);

        // Preferir revocacion por jti (mas eficiente). Fallback a token completo
        // para entradas legacy emitidas antes de la migracion a jti.
        if (decoded.jti) {
          await TokenBlacklist.addJti(
            decoded.jti,
            decoded.id,
            TOKEN_REVOCATION_REASONS.LOGOUT,
            tokenExpiration
          );
        } else {
          await TokenBlacklist.addToken(
            refreshToken,
            decoded.id,
            TOKEN_REVOCATION_REASONS.LOGOUT,
            tokenExpiration
          );
        }
      } catch (error) {
        // El token podria estar ya expirado, continuar con logout
        authLogger.warn({ error: error.message }, 'Refresh token invalido durante logout');
      }
    }
  }

  // Revocar tambien el access token actual (por jti) para que el logout
  // invalide la sesion de inmediato y no solo el refresh token. El middleware
  // `authenticate` consulta esta blacklist por jti en cada peticion. En TEST_MODE
  // `req.token` es la clave bypass (no un JWT) y decodeToken devuelve null -> se
  // omite sin error.
  if (req.token) {
    try {
      const decodedAccess = decodeToken(req.token);
      if (decodedAccess?.jti && decodedAccess?.exp) {
        await TokenBlacklist.addJti(
          decodedAccess.jti,
          req.user._id,
          TOKEN_REVOCATION_REASONS.LOGOUT,
          new Date(decodedAccess.exp * 1000)
        );
      }
    } catch (error) {
      authLogger.warn({ error: error.message }, 'No se pudo revocar el access token durante el logout');
    }
  }

  // Limpiar cookies de autenticacion (usar mismas flags que al setear)
  res.clearCookie('accessToken', baseCookieOptions);
  res.clearCookie('refreshToken', baseRefreshCookieOptions);
  res.clearCookie('token', baseCookieOptions); // Nombre de cookie legacy

  req.log.info({ username: req.user.username }, 'Usuario cerro sesion');

  // Registrar evento de seguridad
  logSessionTermination(req.user._id.toString(), 'logout', req.ip);

  res.status(HTTP_STATUS.OK).json(
    createResponse(null, 'Logout exitoso')
  );
});

/**
 * Controlador de Obtención de Perfil de Usuario
 *
 * Recupera la información del perfil del usuario autenticado.
 *
 * @route GET /api/v1/auth/me
 * @access Private
 */
const getProfile = asyncHandler(async (req, res, next) => {
  // IMPORTANTE: req.user proviene de un objeto .lean() (auth middleware), por lo
  // que tiene `_id` pero NO el virtual `id`. Usar `req.user.id` aqui hacia
  // findById(undefined) -> null -> 404 para TODOS los usuarios reales.
  // Ademas, al usar .lean() no se aplica el transform toJSON del schema, por lo
  // que hay que excluir explicitamente los campos internos de seguridad
  // (loginAttempts, lockUntil) para no filtrarlos en la respuesta.
  const user = await User.findById(req.user._id)
    .select('-password -loginAttempts -lockUntil -createdAt -updatedAt')
    .maxTimeMS(MONGODB_TIMEOUTS.QUERY_TIMEOUT_MS)
    .lean();

  if (!user) {
    return next(createNotFoundError('Usuario', req.user._id));
  }

  res.status(HTTP_STATUS.OK).json(
    createResponse(
      { user },
      'Perfil obtenido exitosamente'
    )
  );
});

/**
 * Controlador de Renovación de Access Token
 *
 * Genera un nuevo access token usando un refresh token válido.
 * Implementa rotación de refresh token para seguridad mejorada.
 *
 * @route POST /api/v1/auth/refresh
 * @access Public (requiere refresh token válido)
 */
const refreshAccessToken = asyncHandler(async (req, res, next) => {
  // Extraer refresh token validado (body o cookie)
  const refreshToken = req.validatedRefreshToken || req.body?.refreshToken || req.cookies?.refreshToken;

  if (!refreshToken || !isValidTokenFormat(refreshToken)) {
    return next(createAuthError('Refresh token requerido'));
  }

  // Verificar refresh token PRIMERO (fallar rapido con mismo error)
  let decoded;
  try {
    decoded = await verifyRefreshToken(refreshToken);
  } catch (_error) {
    // Error generico - no revelar si el token es invalido o esta en lista negra
    authLogger.warn({ ip: req.ip }, 'Token refresh fallido: token invalido');
    return next(createAuthError('Token invalido o expirado'));
  }

  // Verificar si el token esta en lista negra (despues de verificacion para evitar ataques de timing)
  // Tokens nuevos: lookup por jti (rapido, indice unique sobre UUID).
  // Tokens legacy sin jti: lookup por el JWT completo.
  const isBlacklisted = decoded.jti
    ? await TokenBlacklist.isJtiBlacklisted(decoded.jti)
    : await TokenBlacklist.isBlacklisted(refreshToken);
  if (isBlacklisted) {
    authLogger.warn({
      userId: decoded.id,
      ip: req.ip
    }, 'Intento de reusar refresh token revocado');
    return next(createAuthError('Token invalido o expirado'));
  }

  // Obtener usuario desde el token (incluir passwordChangedAt para verificacion)
  const user = await User.findById(decoded.id)
    .select('-password +passwordChangedAt')
    .maxTimeMS(MONGODB_TIMEOUTS.QUERY_TIMEOUT_MS)
    .lean();
  if (!user) {
    // El refresh token es criptograficamente valido pero el usuario ya no
    // existe (cuenta eliminada). Devolver 401 generico (token invalido) en
    // lugar de 404 con el ObjectId: ese 404 filtraba un identificador interno
    // y permitia distinguir "usuario borrado" de "token invalido".
    authLogger.warn({ ip: req.ip }, 'Refresh token de usuario inexistente');
    return next(createAuthError('Token invalido o expirado'));
  }

  // Verificar si la cuenta del usuario esta activa
  if (!user.isActive) {
    return next(createForbiddenError('Cuenta desactivada'));
  }

  // Verificar si la cuenta esta bloqueada
  if (user.isLocked) {
    return next(createForbiddenError('Cuenta bloqueada temporalmente'));
  }

  // SEGURIDAD CRITICA: Verificar si el usuario cambio su contrasena despues de emitir este refresh token
  // Esto invalida TODOS los tokens (access y refresh) emitidos antes del cambio de contrasena
  if (user.passwordChangedAt) {
    const changedTimestamp = parseInt(user.passwordChangedAt.getTime() / 1000, 10);
    const tokenIssuedAt = decoded.iat;

    if (tokenIssuedAt < changedTimestamp) {
      authLogger.warn({
        userId: user._id,
        ip: req.ip,
        tokenIat: tokenIssuedAt,
        passwordChangedAt: changedTimestamp
      }, 'Intento de usar refresh token emitido antes de cambio de contrasena');
      return next(createAuthError('Token invalido o expirado'));
    }
  }

  // Invalidar refresh token antiguo (rotacion) de forma ATOMICA.
  // El insert con indice unico sobre `jti` actua como claim: si esta peticion
  // es la primera en rotar el token, claimed=true y continuamos; si otra
  // peticion concurrente ya lo rotó (o es un reuso del token), claimed=false y
  // abortamos SIN emitir un nuevo par. Esto cierra la ventana check-then-act
  // que permitia obtener dos pares de tokens a partir del mismo refresh token.
  const tokenExpiration = getTokenExpiration(refreshToken);
  if (decoded.jti) {
    const { claimed } = await TokenBlacklist.claimJti(
      decoded.jti,
      user._id,
      TOKEN_REVOCATION_REASONS.ROTATION,
      tokenExpiration
    );
    if (!claimed) {
      authLogger.warn({
        userId: user._id,
        ip: req.ip
      }, 'Rotacion concurrente o reuso de refresh token detectado: abortando');
      return next(createAuthError('Token invalido o expirado'));
    }
  } else {
    // Tokens legacy sin jti: no se puede reclamar atomicamente por jti; se
    // mantiene el comportamiento previo (idempotente) hasta su expiracion.
    await TokenBlacklist.addToken(
      refreshToken,
      user._id,
      TOKEN_REVOCATION_REASONS.ROTATION,
      tokenExpiration
    );
  }

  // Generar NUEVO access token Y NUEVO refresh token
  const tokens = generateTokens(user);

  // Establecer nuevas cookies
  res.cookie('accessToken', tokens.accessToken, buildCookieOptions(15 * TIME_CONSTANTS.MILLISECONDS_PER_MINUTE));
  res.cookie('refreshToken', tokens.refreshToken, buildRefreshCookieOptions(30 * TIME_CONSTANTS.MILLISECONDS_PER_DAY));

  authLogger.info({ userId: user._id }, 'Refresh token rotado exitosamente');

  // Registrar evento de seguridad
  logTokenRefresh(user._id.toString(), true, req.ip);

  res.status(HTTP_STATUS.OK).json(
    createResponse(
      {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        user: {
          id: user._id,
          username: user.username,
          email: user.email,
          role: user.role,
          isActive: user.isActive
        }
      },
      'Token renovado exitosamente'
    )
  );
});

/**
 * Controlador de Cambio de Contraseña
 *
 * Permite a usuarios autenticados cambiar su contraseña.
 * Requiere verificación de contraseña actual e invalida todos los refresh tokens.
 *
 * @route PUT /api/v1/auth/change-password
 * @access Private
 */
const changePassword = asyncHandler(async (req, res, next) => {
  const { currentPassword, newPassword } = req.body;
  const userId = req.user._id;

  // Obtener usuario con campo de contrasena
  const user = await User.findById(userId)
    .select('+password')
    .maxTimeMS(MONGODB_TIMEOUTS.QUERY_TIMEOUT_MS);

  if (!user) {
    return next(createNotFoundError('Usuario', userId));
  }

  // Verificar contrasena actual
  const isPasswordValid = await user.comparePassword(currentPassword);
  if (!isPasswordValid) {
    logPasswordChange(userId.toString(), req.ip, false);
    return next(createAuthError('Contrasena actual incorrecta'));
  }

  // Validar fortaleza de la nueva contrasena
  const passwordValidation = validatePassword(newPassword);
  if (!passwordValidation.isValid) {
    return next(createBadRequestError('La nueva contrasena no cumple los requisitos de seguridad', {
      errors: passwordValidation.errors
    }));
  }

  // Verificar que la nueva contrasena sea diferente de la actual
  const isSamePassword = await user.comparePassword(newPassword);
  if (isSamePassword) {
    return next(createBadRequestError('La nueva contrasena debe ser diferente de la actual'));
  }

  // Actualizar contrasena y timestamp de cambio.
  // NOTA: sin offset de -1000ms. change-password NO emite tokens nuevos (la
  // respuesta pide volver a iniciar sesion), asi que no hay token recien creado
  // que proteger; el offset solo abria una ventana de ~1s en la que un token
  // anterior al cambio seguia siendo aceptado por el check iat < passwordChangedAt.
  user.password = newPassword;
  user.passwordChangedAt = Date.now();
  await user.save();

  // Defensa en profundidad: revocar de inmediato por jti el access token con el
  // que se realizo el cambio, para invalidarlo sin depender solo de la
  // comparacion iat < passwordChangedAt. Mismo patron que logout. En TEST_MODE
  // `req.token` es la clave bypass (no un JWT) y decodeToken devuelve null -> se
  // omite sin error.
  if (req.token) {
    try {
      const decodedAccess = decodeToken(req.token);
      if (decodedAccess?.jti && decodedAccess?.exp) {
        await TokenBlacklist.addJti(
          decodedAccess.jti,
          userId,
          TOKEN_REVOCATION_REASONS.PASSWORD_CHANGE,
          new Date(decodedAccess.exp * 1000)
        );
      }
    } catch (error) {
      authLogger.warn({ error: error.message }, 'No se pudo revocar el access token tras cambio de contrasena');
    }
  }

  // Registrar evento de seguridad
  logPasswordChange(userId.toString(), req.ip, true);

  req.log.info({ userId: userId.toString() }, 'Contrasena cambiada exitosamente');

  res.status(HTTP_STATUS.OK).json(
    createResponse(null, 'Contrasena cambiada exitosamente. Por favor, inicia sesion nuevamente con tu nueva contrasena.')
  );
});

/**
 * Verifica que el token actual es valido y devuelve el usuario asociado.
 *
 * Cuando llega aqui el middleware `authenticate` ya valido el token, por lo
 * que `req.user` esta siempre poblado. Sirve como endpoint de "ping" para que
 * el frontend confirme su sesion sin tener que recargar el perfil completo.
 *
 * @route GET /api/v1/auth/verify-token
 * @access Private
 */
const verifyToken = asyncHandler(async (req, res) => {
  res.status(HTTP_STATUS.OK).json(
    createResponse(
      {
        user: {
          id: req.user._id,
          username: req.user.username,
          email: req.user.email,
          role: req.user.role,
          isActive: req.user.isActive
        },
        tokenValid: true
      },
      'Token valido'
    )
  );
});

module.exports = {
  register,
  login,
  logout,
  getProfile,
  refreshAccessToken,
  changePassword,
  verifyToken
};

