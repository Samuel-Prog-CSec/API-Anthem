/**
 * Authorization Middleware
 *
 * Handles role-based access control and permission checking.
 * Works in conjunction with authentication middleware.
 *
 * @author API Development Team
 * @version 1.0.0
 */

const { createForbiddenResponse } = require('../utils/responseHelper');
const { authLogger } = require('../config/logger');

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
