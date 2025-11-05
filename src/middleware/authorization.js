/**
 * Authorization Middleware
 *
 * Handles role-based access control and permission checking.
 * Works in conjunction with authentication middleware.
 *
 */

const { createForbiddenResponse } = require('../utils/responseHelper');
const { authLogger } = require('../config/logger');
const { logPermissionCheck, logUnauthorizedAccess } = require('../utils/securityLogger');

/**
 * Role-based authorization middleware factory
 *
 * Creates middleware that checks if authenticated user has required role(s).
 * Must be used after authentication middleware.
 *
 * @param {...string} roles - Required roles
 * @returns {function} Authorization middleware function
 */
const authorize = (...roles) => {
  return (req, res, next) => {
    // Check if user is authenticated
    if (!req.user) {
      return res.status(401).json(
        createForbiddenResponse('Authentication required for this resource')
      );
    }

    // Check if user has required role
    if (!roles.includes(req.user.role)) {
      authLogger.warn({
        username: req.user.username,
        userRole: req.user.role,
        requiredRoles: roles,
        path: req.path,
        method: req.method
      }, 'Authorization failed - insufficient permissions');

      // Log security event
      logPermissionCheck(
        req.user._id.toString(),
        req.path,
        roles.join('|'),
        false,
        req.ip
      );

      logUnauthorizedAccess(
        req.user._id.toString(),
        req.path,
        req.method,
        req.ip,
        `Required role: ${roles.join('|')}, User role: ${req.user.role}`
      );

      return res.status(403).json(
        createForbiddenResponse('Insufficient permissions to access this resource')
      );
    }

    authLogger.debug({
      username: req.user.username,
      userRole: req.user.role,
      requiredRoles: roles,
      path: req.path
    }, 'Authorization granted');

    // Log successful permission check
    logPermissionCheck(
      req.user._id.toString(),
      req.path,
      roles.join('|'),
      true,
      req.ip
    );

    next();
  };
};

/**
 * Admin-only authorization middleware
 * Shortcut for admin role authorization
 *
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 * @param {function} next - Express next function
 */
const adminOnly = (req, res, next) => {
  return authorize('admin')(req, res, next);
};

module.exports = {
  authorize,
  adminOnly
};
