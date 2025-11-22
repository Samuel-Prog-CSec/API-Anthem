/**
 * Colección de Middleware de Seguridad
 *
 * Middleware de seguridad integral para proteger la API contra
 * vulnerabilidades y ataques comunes.
 *
 */

const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const mongoSanitize = require('express-mongo-sanitize');
const xss = require('xss');
const config = require('../config/config');
const { RATE_LIMITS } = require('../constants');
const { createRateLimitResponse, createErrorResponse } = require('../utils/responseHelper');
const { securityLogger: pinoSecurityLogger } = require('../config/logger');

/**
 * Configuración de limitación de tasa
 *
 * Previene el abuso limitando el número de peticiones desde una única IP.
 * Diferentes límites para diferentes tipos de endpoints.
 */

// Limitador de tasa general de API
const generalLimiter = rateLimit({
  windowMs: config.security.rateLimitWindowMs, // Ventana de tiempo en milisegundos
  max: config.security.rateLimitMaxRequests, // Máximo de peticiones por ventana
  message: createRateLimitResponse(Math.ceil(config.security.rateLimitWindowMs / 1000)),
  standardHeaders: true, // Devolver información de límite de tasa en headers
  legacyHeaders: false, // Deshabilitar headers legacy
  handler: (req, res) => {
    pinoSecurityLogger.warn({ ip: req.ip, path: req.path }, 'Límite de tasa excedido');
    res.status(429).json(createRateLimitResponse(Math.ceil(config.security.rateLimitWindowMs / 1000)));
  }
});

// Limitador de tasa estricto para endpoints de autenticación
const authLimiter = rateLimit({
  windowMs: RATE_LIMITS.AUTH.WINDOW_MS,
  max: RATE_LIMITS.AUTH.MAX_REQUESTS,
  message: createRateLimitResponse(RATE_LIMITS.AUTH.RETRY_AFTER),
  skipSuccessfulRequests: true, // No contar peticiones exitosas
  handler: (req, res) => {
    pinoSecurityLogger.warn({ ip: req.ip, path: req.path }, 'Límite de tasa de autenticación excedido');
    res.status(429).json(createRateLimitResponse(RATE_LIMITS.AUTH.RETRY_AFTER));
  }
});

// Limitador de tasa para consultas pesadas para endpoints intensivos en recursos
const heavyQueryLimiter = rateLimit({
  windowMs: RATE_LIMITS.HEAVY_QUERY.WINDOW_MS,
  max: RATE_LIMITS.HEAVY_QUERY.MAX_REQUESTS,
  message: createRateLimitResponse(RATE_LIMITS.HEAVY_QUERY.RETRY_AFTER),
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    pinoSecurityLogger.warn({ ip: req.ip, path: req.path }, 'Límite de tasa de consulta pesada excedido');
    res.status(429).json(createRateLimitResponse(RATE_LIMITS.HEAVY_QUERY.RETRY_AFTER));
  }
});

/**
 * Configuración de middleware de seguridad Helmet
 *
 * Establece varios headers de seguridad para proteger contra vulnerabilidades comunes.
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

  // Headers de Cross-Origin Resource Sharing
  crossOriginEmbedderPolicy: false, // Deshabilitar para compatibilidad de API
  crossOriginResourcePolicy: { policy: 'cross-origin' },

  // Referrer Policy
  referrerPolicy: { policy: 'no-referrer' },

  // HTTP Strict Transport Security (solo HTTPS)
  hsts: {
    maxAge: 31536000, // 1 año
    includeSubDomains: true,
    preload: true
  }
});

/**
 * Middleware de sanitización de entrada
 *
 * Previene ataques de inyección NoSQL sanitizando la entrada del usuario.
 */
const sanitizeInput = mongoSanitize({
  replaceWith: '_', // Reemplazar caracteres prohibidos con guión bajo
  onSanitize: ({ req, key }) => {
    pinoSecurityLogger.warn({ key, ip: req.ip }, 'Entrada sanitizada - posible intento de inyección NoSQL');
  }
});

/**
 * Middleware de Protección XSS
 *
 * Sanitiza la entrada del usuario para prevenir ataques de Cross-Site Scripting.
 * Limpia recursivamente todos los valores de cadena en req.body, req.query y req.params.
 *
 * @middleware
 */
const xssProtection = (req, res, next) => {
  /**
   * Sanitizar recursivamente propiedades de objetos
   * @param {Object} obj - Objeto a sanitizar
   * @returns {Object} Objeto sanitizado
   */
  const sanitizeObject = (obj) => {
    if (!obj || typeof obj !== 'object') {
      return obj;
    }

    for (const key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        const value = obj[key];

        if (typeof value === 'string') {
          // Sanitizar valores de cadena
          const sanitized = xss(value);

          // Registrar si se detecta intento de XSS
          if (sanitized !== value) {
            pinoSecurityLogger.warn({
              field: key,
              ip: req.ip,
              originalLength: value.length,
              sanitizedLength: sanitized.length
            }, 'Intento de XSS detectado y sanitizado');
          }

          obj[key] = sanitized;
        } else if (typeof value === 'object' && value !== null) {
          // Sanitizar recursivamente objetos anidados
          sanitizeObject(value);
        }
      }
    }

    return obj;
  };

  try {
    // Sanitizar cuerpo de la petición
    if (req.body) {
      req.body = sanitizeObject(req.body);
    }

    // Sanitizar parámetros de query
    if (req.query) {
      req.query = sanitizeObject(req.query);
    }

    // Sanitizar parámetros de URL
    if (req.params) {
      req.params = sanitizeObject(req.params);
    }

    next();
  } catch (error) {
    pinoSecurityLogger.error({ error: error.message, stack: error.stack }, 'Error en middleware de protección XSS');
    next(error);
  }
};

/**
 * Middleware de headers de seguridad personalizados
 *
 * Añade headers de seguridad adicionales no cubiertos por helmet.
 */
const customSecurityHeaders = (req, res, next) => {
  // Eliminar información sensible del servidor
  res.removeHeader('X-Powered-By');

  // Añadir headers de seguridad personalizados
  res.setHeader('X-API-Version', config.api.version);
  res.setHeader('X-Request-ID', req.id || 'unknown');

  // Control de caché para datos sensibles
  if (req.path.includes('/auth') || req.path.includes('/user')) {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }

  next();
};

/**
 * Middleware de validación de peticiones
 *
 * Valida la estructura de las peticiones y previene peticiones malformadas.
 */
const validateRequest = (req, res, next) => {
  // Verificar peticiones sospechosamente grandes
  const maxSize = 1024 * 1024; // 1MB
  const contentLength = req.get('Content-Length');

  if (contentLength && parseInt(contentLength) > maxSize) {
    pinoSecurityLogger.warn({ contentLength, ip: req.ip }, 'Petición grande detectada - posible intento de DoS');
    return res.status(413).json(
      createErrorResponse('Entidad de petición demasiado grande')
    );
  }

  // Validar tipo de contenido para peticiones POST/PUT
  if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
    const contentType = req.get('Content-Type');
    if (contentType && !contentType.includes('application/json')) {
      return res.status(415).json(
        createErrorResponse('Tipo de medio no soportado. Se esperaba application/json')
      );
    }
  }

  // Prevenir HTTP Parameter Pollution (HPP)
  // Detectar parámetros duplicados en query string
  if (req.query) {
    for (const [key, value] of Object.entries(req.query)) {
      if (Array.isArray(value)) {
        pinoSecurityLogger.warn(
          { key, valueCount: value.length, ip: req.ip },
          'Parámetro duplicado detectado - posible HTTP Parameter Pollution'
        );
        // Tomar solo el primer valor para prevenir HPP
        req.query[key] = value[0];
      }
    }
  }

  next();
};

/**
 * Logging de peticiones para monitoreo de seguridad
 */
const securityLogger = (req, res, next) => {
  const startTime = Date.now();

  // Registrar accesos a endpoints sensibles
  const sensitiveEndpoints = ['/auth', '/admin', '/password'];
  const isSensitive = sensitiveEndpoints.some(endpoint => req.path.includes(endpoint));

  if (isSensitive) {
    pinoSecurityLogger.info({
      method: req.method,
      path: req.path,
      ip: req.ip
    }, 'Acceso a endpoint sensible');
  }

  // Registrar respuesta cuando la petición se completa
  res.on('finish', () => {
    const duration = Date.now() - startTime;

    if (res.statusCode >= 400) {
      pinoSecurityLogger.warn({
        method: req.method,
        path: req.path,
        statusCode: res.statusCode,
        duration: `${duration}ms`,
        ip: req.ip
      }, 'Petición fallida');
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
