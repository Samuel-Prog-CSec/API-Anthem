/**
 * Constantes de autenticacion, autorizacion y rate limiting
 *
 * Roles, validacion de credenciales, validacion de tokens JWT, motivos de
 * revocacion y limites de rate por tipo de operacion.
 */

const USER_ROLES = {
  ADMIN: 'admin',
  USER: 'user'
};

const USER_SECURITY = {
  MAX_LOGIN_ATTEMPTS: 5,
  LOCK_TIME_MS: 2 * 60 * 60 * 1000,
  MIN_PASSWORD_LENGTH: 6,
  MAX_PASSWORD_LENGTH: 128,
  MIN_USERNAME_LENGTH: 3,
  MAX_USERNAME_LENGTH: 30
};

const USER_VALIDATION = {
  MIN_USERNAME_LENGTH: 3,
  MAX_USERNAME_LENGTH: 30,
  MIN_PASSWORD_LENGTH: 8,
  MAX_PASSWORD_LENGTH: 72,
  MAX_EMAIL_LENGTH: 155,
  MIN_IDENTIFIER_LENGTH: 3,
  MAX_IDENTIFIER_LENGTH: 30,
  PASSWORD_PATTERN: /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]+$/,
  USERNAME_PATTERN: /^[a-zA-Z0-9_-]+$/,
  FORBIDDEN_USERNAMES: ['admin', 'root', 'api', 'system', 'null', 'undefined']
};

const TOKEN_VALIDATION = {
  JWT_REGEX: /^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+$/,
  MAX_TOKEN_LENGTH: 1024
};

const TOKEN_REVOCATION_REASONS = {
  ROTATION: 'rotation',
  LOGOUT: 'logout',
  COMPROMISED: 'compromised',
  PASSWORD_CHANGE: 'password_change'
};

const RATE_LIMITS = {
  WINDOWS: {
    ONE_MINUTE: 1 * 60 * 1000,
    FIVE_MINUTES: 5 * 60 * 1000,
    FIFTEEN_MINUTES: 15 * 60 * 1000,
    ONE_HOUR: 60 * 60 * 1000
  },
  RETRY_AFTER: {
    ONE_MINUTE: 60,
    FIVE_MINUTES: 5 * 60,
    FIFTEEN_MINUTES: 15 * 60,
    ONE_HOUR: 60 * 60
  },
  GENERAL: {
    WINDOW_MS: 15 * 60 * 1000,
    MAX_REQUESTS: 100,
    RETRY_AFTER: 15 * 60
  },
  EXPORT: {
    WINDOW_MS: 60 * 60 * 1000,
    MAX_REQUESTS: 5,
    RETRY_AFTER: 60 * 60
  },
  HEAVY_QUERY: {
    WINDOW_MS: 5 * 60 * 1000,
    MAX_REQUESTS: 10,
    RETRY_AFTER: 5 * 60
  },
  AUTH: {
    WINDOW_MS: 15 * 60 * 1000,
    MAX_REQUESTS: 10,
    RETRY_AFTER: 15 * 60
  },
  NOISE_MONITORING: {
    LIST_MAX: 100,
    STATS_MAX: 50,
    SEARCH_MAX: 50
  },
  AIR_QUALITY: {
    LIST_MAX: 30
  },
  ACCIDENTS: {
    HEATMAP_MAX: 10,
    EXPORT_MAX: 3
  }
};

module.exports = {
  USER_ROLES,
  USER_SECURITY,
  USER_VALIDATION,
  TOKEN_VALIDATION,
  TOKEN_REVOCATION_REASONS,
  RATE_LIMITS
};
