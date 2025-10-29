/**
 * Token Helper Utilities
 *
 * Provides utilities for JWT token generation, validation, and management.
 * Implements security best practices for token handling.
 *
 * @author API Development Team
 * @version 1.0.0
 */

const jwt = require('jsonwebtoken');
const config = require('../config/config');

/**
 * Generates a JWT access token
 *
 * @param {object} payload - Token payload data
 * @param {string} expiresIn - Token expiration time (optional)
 * @returns {string} Generated JWT token
 */
const generateAccessToken = (payload, expiresIn = config.jwt.expiresIn) => {
  return jwt.sign(
    payload,
    config.jwt.secret,
    {
      expiresIn,
      algorithm: config.jwt.algorithm,
      issuer: 'api-rest-auth',
      audience: 'api-rest-auth-client'
    }
  );
};

/**
 * Generates a refresh token (longer expiration)
 *
 * @param {object} payload - Token payload data
 * @returns {string} Generated refresh token
 */
const generateRefreshToken = (payload) => {
  return jwt.sign(
    payload,
    config.jwt.secret,
    {
      expiresIn: '30d', // Refresh tokens last longer
      algorithm: config.jwt.algorithm,
      issuer: 'api-rest-auth',
      audience: 'api-rest-auth-refresh'
    }
  );
};

/**
 * Generates both access and refresh tokens
 *
 * @param {object} user - User object
 * @returns {object} Object containing both tokens
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
 * Verifies and decodes a JWT token
 *
 * @param {string} token - JWT token to verify
 * @returns {Promise<object>} Decoded token payload
 * @throws {Error} If token is invalid or expired
 */
const verifyToken = async (token) => {
  try {
    return jwt.verify(token, config.jwt.secret, {
      algorithms: [config.jwt.algorithm],
      issuer: 'api-rest-auth',
      audience: 'api-rest-auth-client'
    });
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      throw new Error('Token has expired');
    } else if (error.name === 'JsonWebTokenError') {
      throw new Error('Invalid token');
    } else if (error.name === 'NotBeforeError') {
      throw new Error('Token not active');
    } else {
      throw new Error('Token verification failed');
    }
  }
};

/**
 * Extracts token from Authorization header or cookies
 *
 * @param {object} req - Express request object
 * @returns {string|null} Extracted token or null if not found
 */
const extractToken = (req) => {
  // Check Authorization header
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7);
  }

  // Check cookies
  if (req.cookies && req.cookies.token) {
    return req.cookies.token;
  }

  // Check query parameter (not recommended for production)
  if (req.query && req.query.token) {
    return req.query.token;
  }

  return null;
};

/**
 * Decodes token without verification (for debugging)
 *
 * @param {string} token - JWT token to decode
 * @returns {object|null} Decoded token or null if invalid
 */
const decodeToken = (token) => {
  try {
    return jwt.decode(token);
  } catch (error) {
    return null;
  }
};

module.exports = {
  generateAccessToken,
  generateRefreshToken,
  generateTokens,
  verifyToken,
  extractToken,
  decodeToken
};
