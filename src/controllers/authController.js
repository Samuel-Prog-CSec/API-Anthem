/**
 * Authentication Controller
 *
 * Handles user authentication operations including registration, login,
 * and token management with comprehensive security measures.
 *
 */

const { validationResult } = require('express-validator');
const User = require('../models/User');
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

    // Generate authentication token
    const token = user.generateAuthToken();

    // Prepare user data for response (excluding sensitive information)
    const userData = {
      id: user._id,
      username: user.username,
      email: user.email,
      role: user.role,
      isActive: user.isActive,
      createdAt: user.createdAt
    };

    // Set secure HTTP-only cookie for token
    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
    });

    req.log.info({ username, email }, 'Nuevo usuario registrado exitosamente');

    res.status(201).json(
      createResponse(
        'User registered successfully',
        {
          user: userData,
          token
        }
      )
    );

  } catch (error) {
    console.error('❌ Registration error:', error);

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
      return next(createAuthError('Credenciales inválidas'));
    }

    // Check if account is locked
    if (user.isLocked) {
      return res.status(423).json(
        formatErrorResponse(
          createAuthError('Cuenta bloqueada temporalmente por demasiados intentos fallidos')
        )
      );
    }

    // Check if account is active
    if (!user.isActive) {
      return next(createForbiddenError('La cuenta está desactivada'));
    }

    // Validate password
    const isPasswordValid = await user.comparePassword(password);
    if (!isPasswordValid) {
      await user.handleFailedLogin();
      return next(createAuthError('Credenciales inválidas'));
    }

    // Handle successful login
    await user.handleSuccessfulLogin();

    // Generate authentication token
    const token = user.generateAuthToken();

    // Prepare user data for response
    const userData = {
      id: user._id,
      username: user.username,
      email: user.email,
      role: user.role,
      isActive: user.isActive,
      lastLogin: new Date()
    };

    // Set secure HTTP-only cookie for token
    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
    });

    req.log.info({ username: user.username, email: user.email }, 'Usuario inició sesión exitosamente');

    res.status(200).json(
      createResponse(
        'Login successful',
        {
          user: userData,
          token
        }
      )
    );

  } catch (error) {
    console.error('❌ Login error:', error);
    return next(createInternalError('Error durante el login', error));
  }
};

/**
 * User Logout Controller
 *
 * Invalidates the current session by clearing the authentication cookie.
 *
 * @route POST /api/v1/auth/logout
 * @access Private
 */
const logout = async (req, res, next) => {
  try {
    // Clear the authentication cookie
    res.clearCookie('token');

    req.log.info({ username: req.user.username }, 'Usuario cerró sesión');

    res.status(200).json(
      createResponse('Logout successful')
    );

  } catch (error) {
    console.error('❌ Logout error:', error);
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
    console.error('❌ Get profile error:', error);
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
    console.error('❌ Update profile error:', error);
    return next(createInternalError('Error al actualizar el perfil', error));
  }
};

module.exports = {
  register,
  login,
  logout,
  getProfile,
  updateProfile
};
