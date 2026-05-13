/**
 * Middleware de seguridad integral para proteger la API contra
 * vulnerabilidades y ataques comunes.
 * Previene el abuso limitando el número de peticiones desde una única IP.
 * Diferentes límites para diferentes tipos de endpoints.
 */

const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const mongoSanitize = require('express-mongo-sanitize');
const xss = require('xss');
const { validationResult } = require('express-validator');
const config = require('../config/config');
const { RATE_LIMITS, HPP_ARRAY_PARAMS_WHITELIST, HTTP_STATUS } = require('../constants');
const { createRateLimitResponse, createErrorResponse } = require('../utils/responseHelper');
const { securityLogger: pinoSecurityLogger } = require('../config/logger');

// Limitador de tasa general de API
const generalLimiter = rateLimit({
  windowMs: config.security.rateLimitWindowMs, // Ventana de tiempo en milisegundos
  max: config.security.rateLimitMaxRequests, // Máximo de peticiones por ventana
  message: createRateLimitResponse(Math.ceil(config.security.rateLimitWindowMs / 1000)),
  standardHeaders: true, // Devolver información de límite de tasa en headers
  legacyHeaders: false, // Deshabilitar headers legacy
  skip: (_req, _res) => config.testMode.enabled, // Saltar en modo de pruebas
  handler: (req, res) => {
    pinoSecurityLogger.warn({ ip: req.ip, path: req.path }, 'Límite de tasa excedido');
    res.status(HTTP_STATUS.TOO_MANY_REQUESTS).json(createRateLimitResponse(Math.ceil(config.security.rateLimitWindowMs / 1000)));
  }
});

// Limitador de tasa estricto para endpoints de autenticación
const authLimiter = rateLimit({
  windowMs: RATE_LIMITS.AUTH.WINDOW_MS,
  max: RATE_LIMITS.AUTH.MAX_REQUESTS,
  message: createRateLimitResponse(RATE_LIMITS.AUTH.RETRY_AFTER),
  skipSuccessfulRequests: true, // No contar peticiones exitosas
  skip: (_req, _res) => config.testMode.enabled, // Saltar en modo de pruebas
  handler: (req, res) => {
    pinoSecurityLogger.warn({ ip: req.ip, path: req.path }, 'Límite de tasa de autenticación excedido');
    res.status(HTTP_STATUS.TOO_MANY_REQUESTS).json(createRateLimitResponse(RATE_LIMITS.AUTH.RETRY_AFTER));
  }
});

// Limitador de tasa para consultas pesadas para endpoints intensivos en recursos
const heavyQueryLimiter = rateLimit({
  windowMs: RATE_LIMITS.HEAVY_QUERY.WINDOW_MS,
  max: RATE_LIMITS.HEAVY_QUERY.MAX_REQUESTS,
  message: createRateLimitResponse(RATE_LIMITS.HEAVY_QUERY.RETRY_AFTER),
  standardHeaders: true,
  legacyHeaders: false,
  skip: (_req, _res) => config.testMode.enabled, // Saltar en modo de pruebas
  handler: (req, res) => {
    pinoSecurityLogger.warn({ ip: req.ip, path: req.path }, 'Límite de tasa de consulta pesada excedido');
    res.status(HTTP_STATUS.TOO_MANY_REQUESTS).json(createRateLimitResponse(RATE_LIMITS.HEAVY_QUERY.RETRY_AFTER));
  }
});

/**
 * Configuración de middleware de seguridad Helmet
 *
 * Establece varios headers de seguridad para proteger contra vulnerabilidades comunes.
 */
const helmetConfig = helmet({
  // Content Security Policy - Configuración restrictiva para API REST
  // No servimos HTML/CSS/JS, por lo que bloqueamos todo
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'none'"], // No cargar ningún recurso
      frameAncestors: ["'none'"] // No permitir ser embebido en iframes
    },
  },

  // Headers de Cross-Origin Resource Sharing
  crossOriginEmbedderPolicy: false, // Deshabilitar para compatibilidad de API
  crossOriginResourcePolicy: { policy: 'cross-origin' },

  // Referrer Policy
  referrerPolicy: { policy: 'no-referrer' },

  // HSTS deshabilitado - proyecto universitario sin HTTPS
  hsts: false
});

/**
 * Middleware de sanitización de entrada
 *
 * Previene ataques de inyección NoSQL sanitizando la entrada del usuario.
 */
const sanitizeInput = mongoSanitize({
  replaceWith: '_', // Reemplazar caracteres prohibidos con guión bajo
  allowDots: false, // Bloquear acceso a propiedades anidadas vía dot-notation
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
  // Limites conservadores para mitigar DoS por payloads recursivos profundos
  // o con arrays masivos. La mayoria de queries legitimas no superan estos limites
  const MAX_DEPTH = 5;
  const MAX_KEYS_PER_LEVEL = 100;
  const MAX_ARRAY_LENGTH = 100;

  const sanitizeObject = (obj, depth = 0) => {
    if (depth > MAX_DEPTH || obj === null || obj === undefined) {
      return obj;
    }

    if (typeof obj === 'string') {
      const sanitized = xss(obj);
      if (sanitized !== obj) {
        pinoSecurityLogger.warn({ ip: req.ip, depth, originalLength: obj.length, sanitizedLength: sanitized.length }, 'Intento de XSS detectado y sanitizado');
      }
      return sanitized;
    }

    if (Array.isArray(obj)) {
      if (obj.length > MAX_ARRAY_LENGTH) {
        throw new Error('Payload con demasiados elementos en un array');
      }
      return obj.map((item) => sanitizeObject(item, depth + 1));
    }

    if (typeof obj === 'object') {
      const keys = Object.keys(obj);
      if (keys.length > MAX_KEYS_PER_LEVEL) {
        throw new Error('Payload con demasiadas propiedades en un nivel');
      }

      const sanitized = {};
      for (const key of keys) {
        sanitized[key] = sanitizeObject(obj[key], depth + 1);
      }
      return sanitized;
    }

    return obj;
  };

  try {
    // Sanitizar req.body, req.query y req.params (mutabilidad restaurada en server.js)
    req.body = sanitizeObject(req.body);
    req.query = sanitizeObject(req.query);
    req.params = sanitizeObject(req.params);
    next();
  } catch (error) {
    pinoSecurityLogger.warn({
      ip: req.ip,
      path: req.originalUrl,
      message: error.message
    }, 'Payload rechazado por límites de sanitización');

    return res.status(HTTP_STATUS.BAD_REQUEST).json(
      createErrorResponse('El payload enviado excede los límites permitidos')
    );
  }
};

/**
 * Middleware de headers de seguridad personalizados
 *
 * Añade headers de seguridad adicionales no cubiertos por helmet.
 */
const customSecurityHeaders = (req, res, next) => {
  // Eliminar informacion sensible del servidor
  res.removeHeader('X-Powered-By');

  // Cabecera legacy contra clickjacking. Helmet ya configura
  // `Content-Security-Policy: frame-ancestors 'none'` (browsers modernos),
  // pero `X-Frame-Options: DENY` cubre tambien IE11 y otros clientes viejos
  // que no respetan la directiva CSP.
  res.setHeader('X-Frame-Options', 'DENY');

  // Restringir capacidades del navegador no usadas por la API (defensa en
  // profundidad). Bloquea acceso a camara, microfono, geolocalizacion, etc.
  // si algun cliente intentara ejecutar codigo embebido sobre la respuesta.
  res.setHeader(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=(), payment=(), usb=(), magnetometer=(), gyroscope=(), accelerometer=()'
  );

  // Anadir headers de seguridad personalizados
  // X-API-Version solo en entornos no productivos para no exponer la version a posibles atacantes
  if (config.server.env !== 'production') {
    res.setHeader('X-API-Version', config.api.version);
  }
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
  const errors = validationResult(req);

  if (!errors.isEmpty()) {
    const formattedErrors = errors.array().map(error => ({
      field: error.path || error.param,
      message: error.msg,
      value: error.value
    }));

    return res.status(HTTP_STATUS.BAD_REQUEST).json({
      success: false,
      message: 'Errores de validación',
      errors: formattedErrors
    });
  }

  // Verificar peticiones sospechosamente grandes
  const maxSize = 1024 * 1024; // 1MB
  const contentLength = req.get('Content-Length');

  if (contentLength && parseInt(contentLength, 10) > maxSize) {
    pinoSecurityLogger.warn({ contentLength, ip: req.ip }, 'Petición grande detectada - posible intento de DoS');
    return res.status(HTTP_STATUS.PAYLOAD_TOO_LARGE).json(
      createErrorResponse('Entidad de petición demasiado grande')
    );
  }

  // Validar tipo de contenido para peticiones POST/PUT
  if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
    const contentType = req.get('Content-Type');
    if (contentType && !contentType.includes('application/json')) {
      return res.status(HTTP_STATUS.UNSUPPORTED_MEDIA_TYPE).json(
        createErrorResponse('Tipo de medio no soportado. Se esperaba application/json')
      );
    }
  }

  // Prevenir HTTP Parameter Pollution (HPP)
  // Detectar parámetros duplicados en query string
  // Whitelist de parámetros que legítimamente pueden ser arrays (importada desde constants)
  if (req.query) {
    for (const [key, value] of Object.entries(req.query)) {
      if (Array.isArray(value)) {
        // Si el parámetro está en la whitelist, permitir el array
        if (HPP_ARRAY_PARAMS_WHITELIST.includes(key)) {
          // Mantener el array tal cual para filtros legítimos
          continue;
        }

        // Si no está en whitelist, es potencial HPP - tomar solo primer valor
        pinoSecurityLogger.warn(
          { key, valueCount: value.length, ip: req.ip },
          'Parámetro duplicado detectado fuera de whitelist - posible HTTP Parameter Pollution'
        );
        req.query[key] = value[0];
      }

      // Bloquear objetos anidados en query (intento de inyección mediante foo[bar]=x)
      // Permitir arrays (stations[]=1&stations[]=2) pero bloquear objetos reales
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        pinoSecurityLogger.warn(
          { key, value, ip: req.ip },
          'Objeto detectado en query string - posible ataque de inyección'
        );
        return res.status(HTTP_STATUS.BAD_REQUEST).json(
          createErrorResponse('Estructura de query inválida: no se permiten objetos anidados')
        );
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
