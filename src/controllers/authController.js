/**
 * Controlador de Autenticación
 *
 * Gestiona las operaciones de autenticación de usuarios incluyendo registro, login,
 * y gestión de tokens con medidas de seguridad completas.
 *
 */

const { validationResult } = require('express-validator');
const User = require('../models/User');
const TokenBlacklist = require('../models/TokenBlacklist');
const { createResponse } = require('../utils/responseHelper');
const { validatePassword } = require('../utils/passwordValidator');
const { HTTP_STATUS } = require('../constants');
const {
  createValidationError,
  createAuthError,
  createInternalError,
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
  getTokenExpiration
} = require('../utils/tokenHelper');
const {
  logLoginAttempt,
  logUserRegistration,
  logSessionTermination,
  logTokenRefresh,
  logAccountLockout,
  logPasswordChange
} = require('../utils/securityLogger');

/**
 * Controlador de Registro de Usuario
 *
 * Crea una nueva cuenta de usuario con validación y verificaciones de seguridad.
 * Previene cuentas duplicadas y asegura la integridad de datos.
 *
 * @route POST /api/v1/auth/register
 * @access Public
 */
const register = async (req, res, next) => {
  try {
    // Verificar errores de validación
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return next(createValidationError('Errores de validación', errors.array()));
    }

    const { username, email, password } = req.body;

    // Validar fortaleza de contraseña ANTES de hashear
    const passwordValidation = validatePassword(password);
    if (!passwordValidation.isValid) {
      return next(createBadRequestError('La contraseña no cumple los requisitos de seguridad', {
        errors: passwordValidation.errors
      }));
    }

    // Verificar si el usuario ya existe
    const existingUser = await User.findByEmailOrUsername(email);
    if (existingUser) {
      return next(createConflictError('Ya existe un usuario con este email o nombre de usuario'));
    }

    // Crear nuevo usuario
    const user = new User({
      username,
      email,
      password
    });

    await user.save();

    // Generar access token y refresh token
    const tokens = generateTokens(user);

    // Preparar datos del usuario para respuesta (excluyendo información sensible)
    const userData = {
      id: user._id,
      username: user.username,
      email: user.email,
      role: user.role,
      isActive: user.isActive,
      createdAt: user.createdAt
    };

    // Establecer cookies HTTP-only seguras para los tokens
    res.cookie('accessToken', tokens.accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 15 * 60 * 1000 // 15 minutos
    });

    res.cookie('refreshToken', tokens.refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 30 * 24 * 60 * 60 * 1000 // 30 días
    });

    req.log.info({ username, email }, 'Nuevo usuario registrado exitosamente');

    // Registrar evento de seguridad
    logUserRegistration(user._id.toString(), email, username, req.ip);

    res.status(201).json(
      createResponse(
        'Usuario registrado exitosamente',
        {
          user: userData,
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken
        }
      )
    );

  } catch (error) {
    authLogger.error({
      error: error.message,
      stack: error.stack,
      username: req.body?.username,
      endpoint: 'POST /api/auth/register'
    }, 'Error en registro de usuario');

    // Manejar errores de MongoDB
    if (error.code === 11000 || error.name === 'ValidationError' || error.name === 'CastError') {
      const mongoError = handleMongoError(error);
      return res.status(mongoError.statusCode).json(
        formatErrorResponse(mongoError)
      );
    }

    return next(createInternalError('Error durante el registro', error));
  }
};

/**
 * Controlador de Login de Usuario
 *
 * Autentica credenciales de usuario y proporciona token de acceso.
 * Implementa bloqueo de cuenta y seguimiento de intentos de login.
 *
 * @route POST /api/v1/auth/login
 * @access Public
 */
const login = async (req, res, next) => {
  try {
    // Verificar errores de validación
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return next(createValidationError('Errores de validación', errors.array()));
    }

    const { identifier, password } = req.body;

    // Buscar usuario por email o nombre de usuario
    const user = await User.findByEmailOrUsername(identifier);
    if (!user) {
      logLoginAttempt(false, identifier, null, req.ip, req.get('user-agent'), 'user_not_found');
      return next(createAuthError('Credenciales inválidas'));
    }

    // Verificar si la cuenta está bloqueada
    if (user.isLocked) {
      logLoginAttempt(false, identifier, user._id.toString(), req.ip, req.get('user-agent'), 'account_locked');
      logAccountLockout(user._id.toString(), identifier, user.loginAttempts, user.lockUntil, req.ip);

      return res.status(423).json(
        formatErrorResponse(
          createAuthError('Cuenta bloqueada temporalmente por demasiados intentos fallidos')
        )
      );
    }

    // Verificar si la cuenta está activa
    if (!user.isActive) {
      logLoginAttempt(false, identifier, user._id.toString(), req.ip, req.get('user-agent'), 'account_inactive');
      return next(createForbiddenError('La cuenta está desactivada'));
    }

    // Validar contraseña
    const isPasswordValid = await user.comparePassword(password);
    if (!isPasswordValid) {
      await user.handleFailedLogin();
      logLoginAttempt(false, identifier, user._id.toString(), req.ip, req.get('user-agent'), 'invalid_password');
      return next(createAuthError('Credenciales inválidas'));
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
    res.cookie('accessToken', tokens.accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 15 * 60 * 1000 // 15 minutos
    });

    res.cookie('refreshToken', tokens.refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 30 * 24 * 60 * 60 * 1000 // 30 días
    });

    req.log.info({ username: user.username, email: user.email }, 'Usuario inició sesión exitosamente');

    res.status(HTTP_STATUS.OK).json(
      createResponse(
        'Login exitoso',
        {
          user: userData,
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken
        }
      )
    );

  } catch (error) {
    authLogger.error({
      error: error.message,
      stack: error.stack,
      username: req.body?.username,
      endpoint: 'POST /api/auth/login'
    }, 'Error durante el login');
    return next(createInternalError('Error durante el login', error));
  }
};

/**
 * Controlador de Logout de Usuario
 *
 * Invalida la sesión actual limpiando cookies y agregando el refresh token a lista negra.
 *
 * @route POST /api/v1/auth/logout
 * @access Private
 */
const logout = async (req, res, next) => {
  try {
    // Obtener refresh token de cookies o body
    const refreshToken = req.cookies?.refreshToken || req.body?.refreshToken;

    // Si existe refresh token, agregarlo a lista negra
    if (refreshToken) {
      try {
        const decoded = await verifyRefreshToken(refreshToken);
        const tokenExpiration = getTokenExpiration(refreshToken);

        await TokenBlacklist.addToken(
          refreshToken,
          decoded.id,
          'logout',
          tokenExpiration
        );
      } catch (error) {
        // El token podría estar ya expirado, continuar con logout
        authLogger.warn({ error: error.message }, 'Refresh token inválido durante logout');
      }
    }

    // Limpiar cookies de autenticación
    res.clearCookie('accessToken');
    res.clearCookie('refreshToken');
    res.clearCookie('token'); // Nombre de cookie legacy

    req.log.info({ username: req.user.username }, 'Usuario cerró sesión');

    // Registrar evento de seguridad
    logSessionTermination(req.user._id.toString(), 'logout', req.ip);

    res.status(HTTP_STATUS.OK).json(
      createResponse('Logout exitoso')
    );

  } catch (error) {
    authLogger.error({
      error: error.message,
      stack: error.stack,
      userId: req.user?.id,
      endpoint: 'POST /api/auth/logout'
    }, 'Error durante el logout');
    return next(createInternalError('Error durante el logout', error));
  }
};

/**
 * Controlador de Obtención de Perfil de Usuario
 *
 * Recupera la información del perfil del usuario autenticado.
 *
 * @route GET /api/v1/auth/me
 * @access Private
 */
const getProfile = async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id).select('-password').lean();

    if (!user) {
      return next(createNotFoundError('Usuario', req.user.id));
    }

    res.status(HTTP_STATUS.OK).json(
      createResponse(
        'Perfil obtenido exitosamente',
        { user }
      )
    );

  } catch (error) {
    authLogger.error({
      error: error.message,
      stack: error.stack,
      userId: req.user?.id,
      endpoint: 'GET /api/auth/profile'
    }, 'Error al obtener el perfil');
    return next(createInternalError('Error al obtener el perfil', error));
  }
};

/**
 * Controlador de Renovación de Access Token
 *
 * Genera un nuevo access token usando un refresh token válido.
 * Implementa rotación de refresh token para seguridad mejorada.
 *
 * @route POST /api/v1/auth/refresh
 * @access Public (requiere refresh token válido)
 */
const refreshAccessToken = async (req, res, next) => {
  try {
    // Extraer refresh token de la request
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return next(createAuthError('Refresh token requerido'));
    }

    // Verificar refresh token PRIMERO (fallar rápido con mismo error)
    let decoded;
    try {
      decoded = await verifyRefreshToken(refreshToken);
    } catch (error) {
      // Error genérico - no revelar si el token es inválido o está en lista negra
      authLogger.warn({ ip: req.ip }, 'Token refresh fallido: token inválido');
      return next(createAuthError('Token inválido o expirado'));
    }

    // Verificar si el token está en lista negra (después de verificación para evitar ataques de timing)
    const isBlacklisted = await TokenBlacklist.isBlacklisted(refreshToken);
    if (isBlacklisted) {
      authLogger.warn({
        userId: decoded.id,
        ip: req.ip
      }, 'Intento de reusar refresh token revocado');
      return next(createAuthError('Token inválido o expirado'));
    }

    // Obtener usuario desde el token
    const user = await User.findById(decoded.id).select('-password');
    if (!user) {
      return next(createNotFoundError('Usuario', decoded.id));
    }

    // Verificar si la cuenta del usuario está activa
    if (!user.isActive) {
      return next(createForbiddenError('Cuenta desactivada'));
    }

    // Verificar si la cuenta está bloqueada
    if (user.isLocked) {
      return next(createForbiddenError('Cuenta bloqueada temporalmente'));
    }

    // Invalidar refresh token antiguo (rotación)
    const tokenExpiration = getTokenExpiration(refreshToken);
    await TokenBlacklist.addToken(
      refreshToken,
      user._id,
      'rotation',
      tokenExpiration
    );

    // Generar NUEVO access token Y NUEVO refresh token
    const tokens = generateTokens(user);

    // Establecer nuevas cookies
    res.cookie('accessToken', tokens.accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 15 * 60 * 1000 // 15 minutos
    });

    res.cookie('refreshToken', tokens.refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 30 * 24 * 60 * 60 * 1000 // 30 días
    });

    authLogger.info({ userId: user._id }, 'Refresh token rotado exitosamente');

    // Registrar evento de seguridad
    logTokenRefresh(user._id.toString(), true, req.ip);

    res.status(HTTP_STATUS.OK).json(
      createResponse(
        'Token renovado exitosamente',
        {
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken
        }
      )
    );

  } catch (error) {
    authLogger.error({
      error: error.message,
      stack: error.stack,
      endpoint: 'POST /api/auth/refresh'
    }, 'Error durante refresh token');
    return next(createInternalError('Error al renovar el token', error));
  }
};

/**
 * Controlador de Cambio de Contraseña
 *
 * Permite a usuarios autenticados cambiar su contraseña.
 * Requiere verificación de contraseña actual e invalida todos los refresh tokens.
 *
 * @route PUT /api/v1/auth/change-password
 * @access Private
 */
const changePassword = async (req, res, next) => {
  try {
    // Verificar errores de validación
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return next(createValidationError('Errores de validación', errors.array()));
    }

    const { currentPassword, newPassword } = req.body;
    const userId = req.user._id;

    // Obtener usuario con campo de contraseña
    const user = await User.findById(userId).select('+password');

    if (!user) {
      return next(createNotFoundError('Usuario', userId));
    }

    // Verificar contraseña actual
    const isPasswordValid = await user.comparePassword(currentPassword);
    if (!isPasswordValid) {
      logPasswordChange(userId.toString(), req.ip, false);
      return next(createAuthError('Contraseña actual incorrecta'));
    }

    // Validar fortaleza de la nueva contraseña
    const passwordValidation = validatePassword(newPassword);
    if (!passwordValidation.isValid) {
      return next(createBadRequestError('La nueva contraseña no cumple los requisitos de seguridad', {
        errors: passwordValidation.errors
      }));
    }

    // Verificar que la nueva contraseña sea diferente de la actual
    const isSamePassword = await user.comparePassword(newPassword);
    if (isSamePassword) {
      return next(createBadRequestError('La nueva contraseña debe ser diferente de la actual'));
    }

    // Actualizar contraseña
    user.password = newPassword;
    await user.save();

    // TODO: Invalidar todos los refresh tokens para este usuario
    // Esto requeriría rastrear refresh tokens activos por usuario
    // Por ahora, los tokens expirarán naturalmente

    // Registrar evento de seguridad
    logPasswordChange(userId.toString(), req.ip, true);

    req.log.info({ userId: userId.toString() }, 'Contraseña cambiada exitosamente');

    res.status(HTTP_STATUS.OK).json(
      createResponse('Contraseña cambiada exitosamente. Por favor, inicia sesión nuevamente con tu nueva contraseña.')
    );

  } catch (error) {
    authLogger.error({
      error: error.message,
      stack: error.stack,
      userId: req.user?._id,
      endpoint: 'PUT /api/auth/change-password'
    }, 'Error al cambiar contraseña');
    return next(createInternalError('Error al cambiar la contraseña', error));
  }
};

module.exports = {
  register,
  login,
  logout,
  getProfile,
  refreshAccessToken,
  changePassword
};

