/**
 * Token Helper Utilities
 *
 * Provides utilities for JWT token generation, validation, and management.
 * Implements security best practices for token handling.
 *
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
 * Verifies a refresh token
 *
 * @param {string} token - Refresh token to verify
 * @returns {Promise<object>} Decoded token payload
 * @throws {Error} If token is invalid or expired
 */
const verifyRefreshToken = async (token) => {
  try {
    return jwt.verify(token, config.jwt.secret, {
      algorithms: [config.jwt.algorithm],
      issuer: 'api-rest-auth',
      audience: 'api-rest-auth-refresh'
    });
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      throw new Error('Refresh token has expired');
    } else if (error.name === 'JsonWebTokenError') {
      throw new Error('Invalid refresh token');
    } else if (error.name === 'NotBeforeError') {
      throw new Error('Refresh token not active');
    } else {
      throw new Error('Refresh token verification failed');
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

  // Check query parameter (ONLY in development - security risk in production)
  if (req.query && req.query.token) {
    // Block query string tokens in production
    if (config.server.env === 'production') {
      throw new Error('Token in query string not allowed in production');
    }
    return req.query.token;
  }

  return null;
};

/**
 * Get expiration date from a JWT token
 *
 * @param {string} token - JWT token
 * @returns {Date} Expiration date
 * @throws {Error} If token is invalid or has no expiration
 */
const getTokenExpiration = (token) => {
  try {
    const decoded = jwt.decode(token);

    if (!decoded || !decoded.exp) {
      throw new Error('Token has no expiration date');
    }

    return new Date(decoded.exp * 1000);
  } catch (error) {
    throw new Error(`Failed to get token expiration: ${error.message}`);
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
