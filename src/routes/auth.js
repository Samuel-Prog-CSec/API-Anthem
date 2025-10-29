/**
 * Authentication Routes
 *
 * Defines all authentication-related API endpoints including
 * user registration, login, logout, and profile management.
 *
 * @author API Development Team
 * @version 1.0.0
 */

const express = require('express');
const router = express.Router();

// Controllers
const {
  register,
  login,
  logout,
  getProfile,
  updateProfile
} = require('../controllers/authController');

// Middleware
const { authenticate } = require('../middleware/auth');
const { authLimiter } = require('../middleware/security');
const {
  validateRegistration,
  validateLogin,
  validateProfileUpdate
} = require('../middleware/validation');

/**
 * @route   POST /api/v1/auth/register
 * @desc    Register a new user
 * @access  Public
 * @middleware Rate limiting, Input validation
 *
 * Request Body:
 * - username (required): Unique username (3-30 chars)
 * - email (required): Valid email address
 * - password (required): Strong password (8+ chars with complexity requirements)
 * - firstName (optional): User's first name
 * - lastName (optional): User's last name
 *
 * Response: User object and JWT token
 */
router.post('/register',
  authLimiter,           // Apply strict rate limiting for auth endpoints
  validateRegistration,  // Validate input data
  register              // Controller function
);

/**
 * @route   POST /api/v1/auth/login
 * @desc    Authenticate user and get token
 * @access  Public
 * @middleware Rate limiting, Input validation
 *
 * Request Body:
 * - identifier (required): Email or username
 * - password (required): User's password
 *
 * Response: User object and JWT token
 */
router.post('/login',
  authLimiter,      // Apply strict rate limiting for auth endpoints
  validateLogin,    // Validate input data
  login            // Controller function
);

/**
 * @route   POST /api/v1/auth/logout
 * @desc    Logout user (clear token cookie)
 * @access  Private
 * @middleware Authentication required
 *
 * Response: Success message
 */
router.post('/logout',
  authenticate,     // Require authentication
  logout           // Controller function
);

/**
 * @route   GET /api/v1/auth/me
 * @desc    Get current authenticated user's profile
 * @access  Private
 * @middleware Authentication required
 *
 * Response: Current user's profile information
 */
router.get('/me',
  authenticate,     // Require authentication
  getProfile       // Controller function
);

/**
 * @route   PUT /api/v1/auth/profile
 * @desc    Update authenticated user's profile
 * @access  Private
 * @middleware Authentication required, Input validation
 *
 * Request Body:
 * - firstName (optional): Updated first name
 * - lastName (optional): Updated last name
 *
 * Response: Updated user profile
 */
router.put('/profile',
  authenticate,           // Require authentication
  validateProfileUpdate,  // Validate input data
  updateProfile          // Controller function
);

/**
 * @route   GET /api/v1/auth/verify-token
 * @desc    Verify if the current token is valid
 * @access  Private
 * @middleware Authentication required
 *
 * Response: Token validation status and user info
 */
router.get('/verify-token',
  authenticate,     // Require authentication
  (req, res) => {
    // If we reach here, the token is valid (authenticate middleware passed)
    const { createResponse } = require('../utils/responseHelper');

    res.status(200).json(
      createResponse(
        'Token is valid',
        {
          user: {
            id: req.user._id,
            username: req.user.username,
            email: req.user.email,
            role: req.user.role,
            isActive: req.user.isActive
          },
          tokenValid: true
        }
      )
    );
  }
);

module.exports = router;
