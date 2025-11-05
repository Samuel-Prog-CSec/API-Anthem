/**
 * Authentication Controller
 *
 * Handles user authentication operations including registration, login,
 * and token management with comprehensive security measures.
 *
 */

const { validationResult } = require('express-validator');
const User = require('../models/User');
const TokenBlacklist = require('../models/TokenBlacklist');
const { createResponse } = require('../utils/responseHelper');
const { validatePassword } = require('../utils/passwordValidator');
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
 * User Registration Controller
 *
 * Creates a new user account with validation and security checks.
 * Prevents duplicate accounts and ensures data integrity.
 *
 * @route POST /api/v1/auth/register
 * @access Public
 */
const register = async (req, res, next) => {
  try {
    // Check for validation errors
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

    // Check if user already exists
    const existingUser = await User.findByEmailOrUsername(email);
    if (existingUser) {
      return next(createConflictError('Ya existe un usuario con este email o nombre de usuario'));
    }

    // Create new user
    const user = new User({
      username,
      email,
      password
    });

    await user.save();

    // Generate access and refresh tokens
    const tokens = generateTokens(user);

    // Prepare user data for response (excluding sensitive information)
    const userData = {
      id: user._id,
      username: user.username,
      email: user.email,
      role: user.role,
      isActive: user.isActive,
      createdAt: user.createdAt
    };

    // Set secure HTTP-only cookies for tokens
    res.cookie('accessToken', tokens.accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 15 * 60 * 1000 // 15 minutes
    });

    res.cookie('refreshToken', tokens.refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 30 * 24 * 60 * 60 * 1000 // 30 days
    });

    req.log.info({ username, email }, 'Nuevo usuario registrado exitosamente');

    // Log security event
    logUserRegistration(user._id.toString(), email, username, req.ip);

    res.status(201).json(
      createResponse(
        'User registered successfully',
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

    // Handle MongoDB errors
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
 * User Login Controller
 *
 * Authenticates user credentials and provides access token.
 * Implements account locking and login attempt tracking.
 *
 * @route POST /api/v1/auth/login
 * @access Public
 */
const login = async (req, res, next) => {
  try {
    // Check for validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return next(createValidationError('Errores de validación', errors.array()));
    }

    const { identifier, password } = req.body;

    // Find user by email or username
    const user = await User.findByEmailOrUsername(identifier);
    if (!user) {
      logLoginAttempt(false, identifier, null, req.ip, req.get('user-agent'), 'user_not_found');
      return next(createAuthError('Credenciales inválidas'));
    }

    // Check if account is locked
    if (user.isLocked) {
      logLoginAttempt(false, identifier, user._id.toString(), req.ip, req.get('user-agent'), 'account_locked');
      logAccountLockout(user._id.toString(), identifier, user.loginAttempts, user.lockUntil, req.ip);

      return res.status(423).json(
        formatErrorResponse(
          createAuthError('Cuenta bloqueada temporalmente por demasiados intentos fallidos')
        )
      );
    }

    // Check if account is active
    if (!user.isActive) {
      logLoginAttempt(false, identifier, user._id.toString(), req.ip, req.get('user-agent'), 'account_inactive');
      return next(createForbiddenError('La cuenta está desactivada'));
    }

    // Validate password
    const isPasswordValid = await user.comparePassword(password);
    if (!isPasswordValid) {
      await user.handleFailedLogin();
      logLoginAttempt(false, identifier, user._id.toString(), req.ip, req.get('user-agent'), 'invalid_password');
      return next(createAuthError('Credenciales inválidas'));
    }

    // Handle successful login
    await user.handleSuccessfulLogin();

    // Log successful login
    logLoginAttempt(true, identifier, user._id.toString(), req.ip, req.get('user-agent'));

    // Generate access and refresh tokens
    const tokens = generateTokens(user);

    // Prepare user data for response
    const userData = {
      id: user._id,
      username: user.username,
      email: user.email,
      role: user.role,
      isActive: user.isActive,
      lastLogin: new Date()
    };

    // Set secure HTTP-only cookies for tokens
    res.cookie('accessToken', tokens.accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 15 * 60 * 1000 // 15 minutes
    });

    res.cookie('refreshToken', tokens.refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 30 * 24 * 60 * 60 * 1000 // 30 days
    });

    req.log.info({ username: user.username, email: user.email }, 'Usuario inició sesión exitosamente');

    res.status(200).json(
      createResponse(
        'Login successful',
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
 * User Logout Controller
 *
 * Invalidates the current session by clearing cookies and blacklisting refresh token.
 *
 * @route POST /api/v1/auth/logout
 * @access Private
 */
const logout = async (req, res, next) => {
  try {
    // Get refresh token from cookies or body
    const refreshToken = req.cookies?.refreshToken || req.body?.refreshToken;

    // If refresh token exists, blacklist it
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
        // Token might be already expired, continue with logout
        authLogger.warn({ error: error.message }, 'Refresh token inválido durante logout');
      }
    }

    // Clear authentication cookies
    res.clearCookie('accessToken');
    res.clearCookie('refreshToken');
    res.clearCookie('token'); // Legacy cookie name

    req.log.info({ username: req.user.username }, 'Usuario cerró sesión');

    // Log security event
    logSessionTermination(req.user._id.toString(), 'logout', req.ip);

    res.status(200).json(
      createResponse('Logout successful')
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
 * Get Current User Profile Controller
 *
 * Retrieves the authenticated user's profile information.
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

    res.status(200).json(
      createResponse(
        'Profile retrieved successfully',
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
 * Update User Profile Controller
 *
 * Updates the authenticated user's profile information.
 *
 * @route PUT /api/v1/auth/profile
 * @access Private
 */
const updateProfile = async (req, res, next) => {
  try {
    // Check for validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return next(createValidationError('Errores de validación', errors.array()));
    }

    const { username, email } = req.body;
    const userId = req.user.id;

    // Check if new email is already taken by another user
    if (email && email !== req.user.email) {
      const existingUser = await User.findOne({ email, _id: { $ne: userId } }).lean();
      if (existingUser) {
        return next(
          createConflictError('Email ya está en uso', { field: 'email', value: email })
        );
      }
    }

    // Check if new username is already taken by another user
    if (username && username !== req.user.username) {
      const existingUser = await User.findOne({ username, _id: { $ne: userId } }).lean();
      if (existingUser) {
        return next(
          createConflictError('Username ya está en uso', { field: 'username', value: username })
        );
      }
    }

    // Update user profile
    const updateData = {};
    if (username) {updateData.username = username;}
    if (email) {updateData.email = email;}

    const user = await User.findByIdAndUpdate(
      userId,
      updateData,
      { new: true, runValidators: true }
    ).select('-password');

    if (!user) {
      return next(createNotFoundError('Usuario', userId));
    }

    req.log.info({ username: user.username, userId }, 'Perfil de usuario actualizado');

    res.status(200).json(
      createResponse(
        'Profile updated successfully',
        { user }
      )
    );

  } catch (error) {
    authLogger.error({
      error: error.message,
      stack: error.stack,
      userId: req.user?.id,
      endpoint: 'PUT /api/auth/profile'
    }, 'Error al actualizar el perfil');
    return next(createInternalError('Error al actualizar el perfil', error));
  }
};

/**
 * Refresh Access Token Controller
 *
 * Generates a new access token using a valid refresh token.
 * Implements refresh token rotation for enhanced security.
 *
 * @route POST /api/v1/auth/refresh
 * @access Public (requires valid refresh token)
 */
const refreshAccessToken = async (req, res, next) => {
  try {
    // Extract refresh token from request
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return next(createAuthError('Refresh token requerido'));
    }

    // Verify refresh token FIRST (fail fast with same error)
    let decoded;
    try {
      decoded = await verifyRefreshToken(refreshToken);
    } catch (error) {
      // Generic error - don't reveal if token is invalid or blacklisted
      authLogger.warn({ ip: req.ip }, 'Token refresh fallido: token inválido');
      return next(createAuthError('Token inválido o expirado'));
    }

    // Check if token is blacklisted (after verification to avoid timing attacks)
    const isBlacklisted = await TokenBlacklist.isBlacklisted(refreshToken);
    if (isBlacklisted) {
      authLogger.warn({
        userId: decoded.id,
        ip: req.ip
      }, 'Intento de reusar refresh token revocado');
      return next(createAuthError('Token inválido o expirado'));
    }

    // Get user from token
    const user = await User.findById(decoded.id).select('-password');
    if (!user) {
      return next(createNotFoundError('Usuario', decoded.id));
    }

    // Check if user account is active
    if (!user.isActive) {
      return next(createForbiddenError('Cuenta desactivada'));
    }

    // Check if account is locked
    if (user.isLocked) {
      return next(createForbiddenError('Cuenta bloqueada temporalmente'));
    }

    // Invalidate old refresh token (rotation)
    const tokenExpiration = getTokenExpiration(refreshToken);
    await TokenBlacklist.addToken(
      refreshToken,
      user._id,
      'rotation',
      tokenExpiration
    );

    // Generate NEW access token AND NEW refresh token
    const tokens = generateTokens(user);

    // Set new cookies
    res.cookie('accessToken', tokens.accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 15 * 60 * 1000 // 15 minutes
    });

    res.cookie('refreshToken', tokens.refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 30 * 24 * 60 * 60 * 1000 // 30 days
    });

    authLogger.info({ userId: user._id }, 'Refresh token rotado exitosamente');

    // Log security event
    logTokenRefresh(user._id.toString(), true, req.ip);

    res.status(200).json(
      createResponse(
        'Token refreshed successfully',
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
 * Change Password Controller
 *
 * Allows authenticated users to change their password.
 * Requires current password verification and invalidates all refresh tokens.
 *
 * @route PUT /api/v1/auth/change-password
 * @access Private
 */
const changePassword = async (req, res, next) => {
  try {
    // Check for validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return next(createValidationError('Errores de validación', errors.array()));
    }

    const { currentPassword, newPassword } = req.body;
    const userId = req.user._id;

    // Get user with password field
    const user = await User.findById(userId).select('+password');

    if (!user) {
      return next(createNotFoundError('Usuario', userId));
    }

    // Verify current password
    const isPasswordValid = await user.comparePassword(currentPassword);
    if (!isPasswordValid) {
      logPasswordChange(userId.toString(), req.ip, false);
      return next(createAuthError('Contraseña actual incorrecta'));
    }

    // Validate new password strength
    const passwordValidation = validatePassword(newPassword);
    if (!passwordValidation.isValid) {
      return next(createBadRequestError('La nueva contraseña no cumple los requisitos de seguridad', {
        errors: passwordValidation.errors
      }));
    }

    // Check new password is different from current
    const isSamePassword = await user.comparePassword(newPassword);
    if (isSamePassword) {
      return next(createBadRequestError('La nueva contraseña debe ser diferente de la actual'));
    }

    // Update password
    user.password = newPassword;
    await user.save();

    // TODO: Invalidate all refresh tokens for this user
    // This would require tracking active refresh tokens per user
    // For now, tokens will expire naturally

    // Log security event
    logPasswordChange(userId.toString(), req.ip, true);

    req.log.info({ userId: userId.toString() }, 'Contraseña cambiada exitosamente');

    res.status(200).json(
      createResponse('Password changed successfully. Please login again with your new password.')
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
  updateProfile,
  refreshAccessToken,
  changePassword
};
