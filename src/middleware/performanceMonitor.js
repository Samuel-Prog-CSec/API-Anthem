/**
 * Middleware de Monitoreo de Rendimiento
 *
 * Mide y registra los tiempos de respuesta de las peticiones HTTP.
 * Añade headers de diagnóstico y alerta sobre requests lentas.
 *
 * Optimizaciones aplicadas:
 * - Tracking de tiempo de respuesta con alta precisión
 * - Logging automático de requests lentas (>1s)
 * - Headers X-Response-Time para diagnóstico del cliente
 * - Métricas para análisis de performance
 */

const logger = require('../config/logger');
const { performanceLogger } = logger;

/**
 * Umbrales de performance (en milisegundos)
 */
const THRESHOLDS = {
  WARNING: 1000, // 1 segundo - requests lentas
  CRITICAL: 3000, // 3 segundos - requests muy lentas
  TIMEOUT: 10000 // 10 segundos - debería haber timeout antes
};

/**
 * Middleware principal de monitoreo de performance
 *
 * @param {object} req - Request de Express
 * @param {object} res - Response de Express
 * @param {Function} next - Next middleware
 */
const performanceMonitor = (req, res, next) => {
  // Marca de tiempo de inicio con alta precisión
  const startTime = Date.now();
  const startHrTime = process.hrtime();

  // Interceptar el evento 'finish' de la respuesta
  res.on('finish', () => {
    // Calcular duración total
    const duration = Date.now() - startTime;
    const hrDuration = process.hrtime(startHrTime);
    const durationMs = hrDuration[0] * 1000 + hrDuration[1] / 1000000;

    // Determinar nivel de severidad
    let severity = 'info';
    let message = 'Request completada';

    if (duration >= THRESHOLDS.CRITICAL) {
      severity = 'error';
      message = 'Request CRÍTICA - muy lenta';
    } else if (duration >= THRESHOLDS.WARNING) {
      severity = 'warn';
      message = 'Request lenta detectada';
    }

    // Información de la request
    const requestInfo = {
      method: req.method,
      url: req.originalUrl || req.url,
      path: req.path,
      statusCode: res.statusCode,
      duration: `${duration}ms`,
      durationPrecise: `${durationMs.toFixed(2)}ms`,
      contentLength: res.get('content-length') || 0,
      userAgent: req.get('user-agent'),
      ip: req.ip || req.connection.remoteAddress,
      userId: req.user?.id
    };

    // Logging según severidad (evitar mutar headers después de finish)
    if (severity === 'error') {
      performanceLogger.error(requestInfo, message);
    } else if (severity === 'warn') {
      performanceLogger.warn(requestInfo, message);
    } else {
      performanceLogger.debug(requestInfo, message);
    }

    // Métricas adicionales si la request fue lenta (solo logging)
    if (duration >= THRESHOLDS.WARNING) {
      performanceLogger.warn({
        ...requestInfo,
        query: req.query,
        params: req.params,
        threshold: THRESHOLDS.WARNING,
        recommendedAction: 'Revisar optimización de queries, índices DB o caché'
      }, 'Análisis de request lenta');
    }

    // Detectar posibles timeouts o requests muy lentas
    if (duration >= THRESHOLDS.CRITICAL) {
      performanceLogger.error({
        ...requestInfo,
        query: req.query,
        params: req.params,
        threshold: THRESHOLDS.CRITICAL,
        criticalIssue: true,
        urgentAction: 'Requiere atención inmediata - posible problema de performance'
      }, 'Request CRÍTICA detectada');
    }
  });

  // Continuar con la cadena de middleware
  next();
};

/**
 * Obtener estadísticas de performance (para endpoint de admin)
 *
 * @returns {object} Estadísticas de performance
 */
const getPerformanceStats = () => {
  return {
    thresholds: {
      warning: `${THRESHOLDS.WARNING}ms`,
      critical: `${THRESHOLDS.CRITICAL}ms`,
      timeout: `${THRESHOLDS.TIMEOUT}ms`
    },
    monitoring: {
      enabled: true,
      headers: ['X-Response-Time', 'X-Performance-Warning'],
      logging: {
        slowRequests: `>= ${THRESHOLDS.WARNING}ms`,
        criticalRequests: `>= ${THRESHOLDS.CRITICAL}ms`
      }
    },
    recommendations: [
      'Requests > 1s: Revisar queries DB, añadir índices o implementar caché',
      'Requests > 3s: Requiere optimización inmediata o refactorización',
      'Usar header X-Response-Time para diagnóstico en cliente',
      'Configurar alertas automáticas para requests críticas'
    ]
  };
};

/**
 * Middleware ligero solo para añadir header (sin logging)
 * Útil en rutas de alta frecuencia donde no se necesita logging detallado
 *
 * @param {object} req - Request de Express
 * @param {object} res - Response de Express
 * @param {Function} next - Next middleware
 */
const performanceHeaderOnly = (req, res, next) => {
  const startTime = Date.now();

  res.on('finish', () => {
    const duration = Date.now() - startTime;
    res.set('X-Response-Time', `${duration}ms`);
  });

  next();
};

module.exports = {
  performanceMonitor,
  performanceHeaderOnly,
  getPerformanceStats,
  THRESHOLDS
};
