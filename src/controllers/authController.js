/**
 * Authentication Controller
 *
 * Handles user authentication operations including registration, login,
 * and token management with comprehensive security measures.
 *
 */

const { validationResult } = require('express-validator');
const User = require('../models/User');
const { createResponse, createErrorResponse } = require('../utils/responseHelper');
const { validatePassword } = require('../utils/passwordValidator');
const { createValidationError } = require('../utils/errorUtils');

/**
 * User Registration Controller
 *
 * Creates a new user account with validation and security checks.
 * Prevents duplicate accounts and ensures data integrity.
 *
 * @route POST /api/v1/auth/register
 * @access Public
 */
const register = async (req, res) => {
  try {
    // Check for validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json(
        createErrorResponse('Validation failed', errors.array())
      );
    }

    const { username, email, password } = req.body;

    // Validar fortaleza de contraseña ANTES de hashear
    const passwordValidation = validatePassword(password);
    if (!passwordValidation.isValid) {
      return res.status(400).json(
        createErrorResponse('La contraseña no cumple los requisitos de seguridad', {
          errors: passwordValidation.errors
        })
      );
    }

    // Check if user already exists
    const existingUser = await User.findByEmailOrUsername(email);
    if (existingUser) {
      return res.status(409).json(
        createErrorResponse('User already exists with this email or username')
      );
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

    console.log(`✅ New user registered: ${username} (${email})`);

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

    // Handle specific MongoDB errors
    if (error.code === 11000) {
      const field = Object.keys(error.keyPattern)[0];
      return res.status(409).json(
        createErrorResponse(`User with this ${field} already exists`)
      );
    }

    // Handle validation errors
    if (error.name === 'ValidationError') {
      const messages = Object.values(error.errors).map(err => err.message);
      return res.status(400).json(
        createErrorResponse('Validation failed', messages)
      );
    }

    res.status(500).json(
      createErrorResponse('Internal server error during registration')
    );
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
const login = async (req, res) => {
  try {
    // Check for validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json(
        createErrorResponse('Validation failed', errors.array())
      );
    }

    const { identifier, password } = req.body;

    // Find user by email or username
    const user = await User.findByEmailOrUsername(identifier);
    if (!user) {
      return res.status(401).json(
        createErrorResponse('Invalid credentials')
      );
    }

    // Check if account is locked
    if (user.isLocked) {
      return res.status(423).json(
        createErrorResponse('Account is temporarily locked due to too many failed login attempts')
      );
    }

    // Check if account is active
    if (!user.isActive) {
      return res.status(403).json(
        createErrorResponse('Account is deactivated')
      );
    }

    // Validate password
    const isPasswordValid = await user.comparePassword(password);
    if (!isPasswordValid) {
      await user.handleFailedLogin();
      return res.status(401).json(
        createErrorResponse('Invalid credentials')
      );
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

    console.log(`✅ User logged in: ${user.username} (${user.email})`);

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
    res.status(500).json(
      createErrorResponse('Internal server error during login')
    );
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
const logout = async (req, res) => {
  try {
    // Clear the authentication cookie
    res.clearCookie('token');

    console.log(`✅ User logged out: ${req.user.username}`);

    res.status(200).json(
      createResponse('Logout successful')
    );

  } catch (error) {
    console.error('❌ Logout error:', error);
    res.status(500).json(
      createErrorResponse('Internal server error during logout')
    );
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
const getProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password');

    if (!user) {
      return res.status(404).json(
        createErrorResponse('User not found')
      );
    }

    res.status(200).json(
      createResponse(
        'Profile retrieved successfully',
        { user }
      )
    );

  } catch (error) {
    console.error('❌ Get profile error:', error);
    res.status(500).json(
      createErrorResponse('Internal server error while retrieving profile')
    );
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
const updateProfile = async (req, res) => {
  try {
    // Check for validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json(
        createErrorResponse('Validation failed', errors.array())
      );
    }

    const { username, email } = req.body;
    const userId = req.user.id;

    // Check if new email is already taken by another user
    if (email && email !== req.user.email) {
      const existingUser = await User.findOne({ email, _id: { $ne: userId } });
      if (existingUser) {
        return res.status(409).json(
          createErrorResponse('Email already in use')
        );
      }
    }

    // Check if new username is already taken by another user
    if (username && username !== req.user.username) {
      const existingUser = await User.findOne({ username, _id: { $ne: userId } });
      if (existingUser) {
        return res.status(409).json(
          createErrorResponse('Username already in use')
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
      return res.status(404).json(
        createErrorResponse('User not found')
      );
    }

    console.log(`✅ Profile updated: ${user.username}`);

    res.status(200).json(
      createResponse(
        'Profile updated successfully',
        { user }
      )
    );

  } catch (error) {
    console.error('❌ Update profile error:', error);
    res.status(500).json(
      createErrorResponse('Internal server error while updating profile')
    );
  }
};

module.exports = {
  register,
  login,
  logout,
  getProfile,
  updateProfile
};
