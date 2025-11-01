/**
 * Authentication Middleware
 *
 * Handles JWT token validation and user authentication.
 * Protects routes that require user authentication.
 *
 */

const User = require('../models/User');
const { verifyToken, extractToken } = require('../utils/tokenHelper');
const { createUnauthorizedResponse } = require('../utils/responseHelper');
const { authLogger } = require('../config/logger');

/**
 * Authentication middleware
 *
 * Verifies JWT token and attaches user information to request object.
 * Protects routes that require authenticated users.
 *
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 * @param {function} next - Express next function
 */
const authenticate = async (req, res, next) => {
  try {
    // Extract token from request
    const token = extractToken(req);

    if (!token) {
      return res.status(401).json(
        createUnauthorizedResponse('Access token is required')
      );
    }

    // Verify token
    let decoded;
    try {
      decoded = await verifyToken(token);
    } catch (error) {
      return res.status(401).json(
        createUnauthorizedResponse(`Token validation failed: ${error.message}`)
      );
    }

    // Get user from token payload
    const user = await User.findById(decoded.id).select('-password');

    if (!user) {
      return res.status(401).json(
        createUnauthorizedResponse('User not found')
      );
    }

    // Check if user account is active
    if (!user.isActive) {
      return res.status(403).json(
        createUnauthorizedResponse('Account is deactivated')
      );
    }

    // Check if account is locked
    if (user.isLocked) {
      return res.status(423).json(
        createUnauthorizedResponse('Account is temporarily locked')
      );
    }

    // Attach user to request object
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
    }, 'Authentication middleware error');
    return res.status(500).json(
      createUnauthorizedResponse('Authentication error')
    );
  }
};

module.exports = {
  authenticate
};
