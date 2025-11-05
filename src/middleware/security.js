/**
 * Security Middleware Collection
 *
 * Comprehensive security middleware for protecting the API against
 * common vulnerabilities and attacks.
 *
 * @author API Development Team
 * @version 1.0.0
 */

const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const mongoSanitize = require('express-mongo-sanitize');
const xss = require('xss');
const config = require('../config/config');
const { createRateLimitResponse, createErrorResponse } = require('../utils/responseHelper');
const { securityLogger: pinoSecurityLogger } = require('../config/logger');

/**
 * Rate limiting configuration
 *
 * Prevents abuse by limiting the number of requests from a single IP.
 * Different limits for different types of endpoints.
 */

// General API rate limiter
const generalLimiter = rateLimit({
  windowMs: config.security.rateLimitWindowMs, // Time window in milliseconds
  max: config.security.rateLimitMaxRequests, // Max requests per window
  message: createRateLimitResponse(Math.ceil(config.security.rateLimitWindowMs / 1000)),
  standardHeaders: true, // Return rate limit info in headers
  legacyHeaders: false, // Disable legacy headers
  handler: (req, res) => {
    pinoSecurityLogger.warn({ ip: req.ip, path: req.path }, 'Rate limit exceeded');
    res.status(429).json(createRateLimitResponse(Math.ceil(config.security.rateLimitWindowMs / 1000)));
  }
});

// Strict rate limiter for authentication endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // Max 10 attempts per 15 minutes
  message: createRateLimitResponse(15 * 60), // 15 minutes in seconds
  skipSuccessfulRequests: true, // Don't count successful requests
  handler: (req, res) => {
    pinoSecurityLogger.warn({ ip: req.ip, path: req.path }, 'Auth rate limit exceeded');
    res.status(429).json(createRateLimitResponse(15 * 60));
  }
});

// Heavy query rate limiter for resource-intensive endpoints
const heavyQueryLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 5, // Max 5 heavy queries per minute
  message: createRateLimitResponse(60),
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    pinoSecurityLogger.warn({ ip: req.ip, path: req.path }, 'Heavy query rate limit exceeded');
    res.status(429).json(createRateLimitResponse(60));
  }
});

/**
 * Helmet security middleware configuration
 *
 * Sets various security headers to protect against common vulnerabilities.
 */
const helmetConfig = helmet({
  // Content Security Policy
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", 'data:', 'https:'],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"],
    },
  },

  // Cross-Origin Resource Sharing headers
  crossOriginEmbedderPolicy: false, // Disable for API compatibility
  crossOriginResourcePolicy: { policy: 'cross-origin' },

  // Referrer Policy
  referrerPolicy: { policy: 'no-referrer' },

  // HTTP Strict Transport Security (HTTPS only)
  hsts: {
    maxAge: 31536000, // 1 year
    includeSubDomains: true,
    preload: true
  }
});

/**
 * Input sanitization middleware
 *
 * Prevents NoSQL injection attacks by sanitizing user input.
 */
const sanitizeInput = mongoSanitize({
  replaceWith: '_', // Replace prohibited characters with underscore
  onSanitize: ({ req, key }) => {
    pinoSecurityLogger.warn({ key, ip: req.ip }, 'Input sanitized - potential NoSQL injection attempt');
  }
});

/**
 * XSS Protection Middleware
 *
 * Sanitizes user input to prevent Cross-Site Scripting attacks.
 * Recursively cleans all string values in req.body, req.query, and req.params.
 *
 * @middleware
 */
const xssProtection = (req, res, next) => {
  /**
   * Recursively sanitize object properties
   * @param {Object} obj - Object to sanitize
   * @returns {Object} Sanitized object
   */
  const sanitizeObject = (obj) => {
    if (!obj || typeof obj !== 'object') {
      return obj;
    }

    for (const key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        const value = obj[key];

        if (typeof value === 'string') {
          // Sanitize string values
          const sanitized = xss(value);

          // Log if XSS attempt detected
          if (sanitized !== value) {
            pinoSecurityLogger.warn({
              field: key,
              ip: req.ip,
              originalLength: value.length,
              sanitizedLength: sanitized.length
            }, 'XSS attempt detected and sanitized');
          }

          obj[key] = sanitized;
        } else if (typeof value === 'object' && value !== null) {
          // Recursively sanitize nested objects
          sanitizeObject(value);
        }
      }
    }

    return obj;
  };

  try {
    // Sanitize request body
    if (req.body) {
      req.body = sanitizeObject(req.body);
    }

    // Sanitize query parameters
    if (req.query) {
      req.query = sanitizeObject(req.query);
    }

    // Sanitize URL parameters
    if (req.params) {
      req.params = sanitizeObject(req.params);
    }

    next();
  } catch (error) {
    pinoSecurityLogger.error({ error: error.message, stack: error.stack }, 'Error in XSS protection middleware');
    next(error);
  }
};

/**
 * Custom security headers middleware
 *
 * Adds additional security headers not covered by helmet.
 */
const customSecurityHeaders = (req, res, next) => {
  // Remove sensitive server information
  res.removeHeader('X-Powered-By');

  // Add custom security headers
  res.setHeader('X-API-Version', config.api.version);
  res.setHeader('X-Request-ID', req.id || 'unknown');

  // Cache control for sensitive data
  if (req.path.includes('/auth') || req.path.includes('/user')) {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }

  next();
};

/**
 * Request validation middleware
 *
 * Validates request structure and prevents malformed requests.
 */
const validateRequest = (req, res, next) => {
  // Check for suspiciously large requests
  const maxSize = 1024 * 1024; // 1MB
  const contentLength = req.get('Content-Length');

  if (contentLength && parseInt(contentLength) > maxSize) {
    pinoSecurityLogger.warn({ contentLength, ip: req.ip }, 'Large request detected - potential DoS attempt');
    return res.status(413).json(
      createErrorResponse('Request entity too large')
    );
  }

  // Validate content type for POST/PUT requests
  if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
    const contentType = req.get('Content-Type');
    if (contentType && !contentType.includes('application/json')) {
      return res.status(415).json(
        createErrorResponse('Unsupported media type. Expected application/json')
      );
    }
  }

  next();
};

/**
 * Request logging for security monitoring
 */
const securityLogger = (req, res, next) => {
  const startTime = Date.now();

  // Log sensitive endpoint access
  const sensitiveEndpoints = ['/auth', '/admin', '/password'];
  const isSensitive = sensitiveEndpoints.some(endpoint => req.path.includes(endpoint));

  if (isSensitive) {
    pinoSecurityLogger.info({
      method: req.method,
      path: req.path,
      ip: req.ip
    }, 'Sensitive endpoint access');
  }

  // Log response when request completes
  res.on('finish', () => {
    const duration = Date.now() - startTime;

    if (res.statusCode >= 400) {
      pinoSecurityLogger.warn({
        method: req.method,
        path: req.path,
        statusCode: res.statusCode,
        duration: `${duration}ms`,
        ip: req.ip
      }, 'Failed request');
    }
  });

  next();
};

module.exports = {
  generalLimiter,
  authLimiter,
  heavyQueryLimiter,
  helmetConfig,
  sanitizeInput,
  xssProtection,
  customSecurityHeaders,
  validateRequest,
  securityLogger
};
