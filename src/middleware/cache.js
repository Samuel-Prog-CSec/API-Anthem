/**
 * Middleware de caché para optimización de consultas frecuentes
 *
 * Este middleware implementa un sistema de caché en memoria para reducir
 * la carga en la base de datos y mejorar los tiempos de respuesta.
 */

const NodeCache = require('node-cache');
const logger = require('../config/logger');
const { cacheLogger } = logger;
const { HTTP_STATUS } = require('../constants');
const { generateCacheKeyFromRequest, generateStatsCacheKey } = require('../utils/cacheKeyGenerator');

// Ventanas de control de expiración y SWR (stale-while-revalidate)
const STALE_GRACE_SECONDS = 60; // Mantener entradas expiradas 60s adicionales para servir en modo STALE
const NEAR_EXPIRY_RATIO = 0.2; // Si queda <20% del TTL, se dispara una revalidación en background
const MIN_NEAR_EXPIRY_MS = 5000; // Evitar umbrales demasiado pequeños

// Configuración centralizada por tipo de caché (TTL ajustados para datos estáticos)
const CACHE_CONFIG = {
  demographic: { stdTTL: 86400 * 7, checkperiod: 3600, maxKeys: 20000 }, // Datos estáticos, 7 días
  statistics: { stdTTL: 86400, checkperiod: 1800, maxKeys: 15000 }, // Estadísticas diarias, 24h
  traffic: { stdTTL: 86400, checkperiod: 1800, maxKeys: 20000 }, // Datos históricos, 24h
  static: { stdTTL: 0, checkperiod: 7200, maxKeys: 50000 }, // Configuración/ubicaciones, sin expiración
  airQuality: { stdTTL: 86400, checkperiod: 1800, maxKeys: 15000 }, // 24h
  bikes: { stdTTL: 86400, checkperiod: 1800, maxKeys: 5000 }, // Datos históricos
  containers: { stdTTL: 0, checkperiod: 7200, maxKeys: 50000 }, // Estáticos
  noise: { stdTTL: 86400, checkperiod: 1800, maxKeys: 10000 } // 24h
};

// Mapa de promesas en vuelo para evitar thundering herd en el mismo cacheKey
const pendingRequests = new Map();
// Mapa de revalidaciones en background para no lanzar múltiples refrescos simultáneos
const backgroundRefreshes = new Map();

const buildCache = (config) => {
  const instance = new NodeCache({
    ...config,
    useClones: false,
    deleteOnExpire: true
  });
  instance.options._swrGraceSeconds = config._swrGraceSeconds || STALE_GRACE_SECONDS;
  return instance;
};

/**
 * Middleware de caché para optimización de consultas frecuentes
 */
const caches = Object.fromEntries(
  Object.entries(CACHE_CONFIG).map(([key, config]) => [
    key,
    buildCache({ ...config, _swrGraceSeconds: STALE_GRACE_SECONDS })
  ])
);

const statsCache = caches.statistics;

const getExpiresAt = (cacheInstance, payload) => {
  if (!payload || payload.expiresAt) {
    return payload?.expiresAt ?? Infinity;
  }
  const ttlSeconds = cacheInstance.options.stdTTL;
  if (!ttlSeconds) {
    return Infinity;
  }
  return (payload.timestamp || Date.now()) + ttlSeconds * 1000;
};

const getNearExpiryThresholdMs = (cacheInstance) => {
  const ttlMs = (cacheInstance.options.stdTTL || 0) * 1000;
  if (ttlMs === 0) {
    return Infinity;
  }
  return Math.max(MIN_NEAR_EXPIRY_MS, ttlMs * NEAR_EXPIRY_RATIO);
};

const scheduleBackgroundRefresh = (req, cacheType, cacheKey) => {
  if (backgroundRefreshes.has(cacheKey)) {
    return;
  }

  const refreshPromise = (async () => {
    try {
      const url = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
      await fetch(url, {
        headers: {
          ...req.headers,
          'x-cache-refresh': '1'
        },
        method: req.method
      });
    } catch (error) {
      cacheLogger.warn({ cacheKey, cacheType, error: error.message }, 'Revalidación de caché fallida');
    } finally {
      backgroundRefreshes.delete(cacheKey);
    }
  })();

  backgroundRefreshes.set(cacheKey, refreshPromise);
};

const respondFromCache = (res, cacheType, cacheKey, payload, status = 'HIT') => {
  const cacheAge = Math.floor((Date.now() - (payload.timestamp || Date.now())) / 1000);
  res.status(HTTP_STATUS.OK)
    .set('X-Cache-Status', status)
    .set('X-Cache-Type', cacheType)
    .set('X-Cache-Age', `${cacheAge}s`)
    .json({
      ...payload.data,
      _cache: {
        hit: true,
        age: `${cacheAge}s`,
        type: cacheType,
        stale: status === 'STALE'
      }
    });
};

const storePayloadInCache = (cacheInstance, cacheKey, data) => {
  const now = Date.now();
  const ttlSeconds = cacheInstance.options.stdTTL || 0;
  const graceSeconds = cacheInstance.options._swrGraceSeconds || 0;
  const payload = {
    data,
    timestamp: now,
    expiresAt: ttlSeconds === 0 ? Infinity : now + ttlSeconds * 1000
  };

  const ttlWithGrace = ttlSeconds === 0 ? 0 : ttlSeconds + graceSeconds;
  cacheInstance.set(cacheKey, payload, ttlWithGrace);
  return payload;
};

const resolvePending = (cacheKey, payload, error = null) => {
  const pending = pendingRequests.get(cacheKey);
  if (!pending) {
    return;
  }
  if (error) {
    pending.reject(error);
  } else {
    pending.resolve(payload);
  }
  pendingRequests.delete(cacheKey);
};

/**
 * Middleware de caché inteligente con soporte para diferentes tipos
 * @param {string} cacheType - Tipo de caché: 'demographic', 'statistics', 'traffic', 'static'
 * @param {function} keyGenerator - Función para generar clave de caché (opcional)
 */
const cacheMiddleware = (cacheType = 'traffic', keyGenerator = null) => {
  return (req, res, next) => {
    // Validar tipo de caché
    const cacheInstance = caches[cacheType] || caches.traffic;

    // Permitir que llamadas de refresco eviten el corto circuito (pero sí escriban en caché)
    const isRefreshRequest = req.headers['x-cache-refresh'] === '1';

    // Generar clave de caché segura
    const cacheKey = keyGenerator
      ? keyGenerator(req)
      : generateCacheKeyFromRequest(req);

    try {
      if (!isRefreshRequest) {
        const cached = cacheInstance.get(cacheKey);

        if (cached) {
          const expiresAt = getExpiresAt(cacheInstance, cached);
          const now = Date.now();
          const isStale = expiresAt !== Infinity && now > expiresAt;
          const nearExpiry = expiresAt !== Infinity && (expiresAt - now) <= getNearExpiryThresholdMs(cacheInstance);

          if (isStale) {
            respondFromCache(res, cacheType, cacheKey, cached, 'STALE');
            if (req.method === 'GET') {
              scheduleBackgroundRefresh(req, cacheType, cacheKey);
            }
            return;
          }

          respondFromCache(res, cacheType, cacheKey, cached, 'HIT');
          if (nearExpiry && req.method === 'GET') {
            scheduleBackgroundRefresh(req, cacheType, cacheKey);
          }
          return;
        }

        // Si hay una petición ya resolviendo el mismo cacheKey, esperar su resultado para evitar thundering herd
        if (pendingRequests.has(cacheKey)) {
          pendingRequests.get(cacheKey).promise
            .then(payload => {
              if (payload) {
                respondFromCache(res, cacheType, cacheKey, payload, 'HIT');
              } else {
                next();
              }
            })
            .catch(() => next());
          return;
        }
      }

      const pendingEntry = {};
      pendingEntry.promise = new Promise((resolve, reject) => {
        pendingEntry.resolve = resolve;
        pendingEntry.reject = reject;
      });
      // Evitar Unhandled Rejection si nadie espera esta promesa (ej: si la petición falla y no hay clientes concurrentes)
      pendingEntry.promise.catch(() => {});
      
      pendingRequests.set(cacheKey, pendingEntry);

      const cleanupPending = () => {
        if (pendingRequests.has(cacheKey)) {
          resolvePending(cacheKey, null, new Error('Respuesta finalizada sin cachear'));
        }
      };

      res.once('finish', cleanupPending);
      res.once('close', cleanupPending);

      // Cache MISS - interceptar res.json para cachear
      const originalJson = res.json.bind(res);

      res.json = function(data) {
        // Solo cachear respuestas exitosas
        if (res.statusCode >= 200 && res.statusCode < 300) {
          const payload = storePayloadInCache(cacheInstance, cacheKey, data);
          res.set('X-Cache-Status', 'MISS');
          res.set('X-Cache-Type', cacheType);
          resolvePending(cacheKey, payload);
        } else {
          resolvePending(cacheKey, null, new Error('Respuesta no cacheable'));
        }

        return originalJson(data);
      };

      next();

    } catch (error) {
      cacheLogger.warn({ error: error.message, cacheType }, 'Error en middleware de caché');
      next();
    }
  };
};

/**
 * Middleware de caché específico para estadísticas (TTL más largo)
 */
const statsCacheMiddleware = () => {
  return (req, res, next) => {
    const cacheKey = generateStatsCacheKey(req.originalUrl, req.query);

    try {
      const cachedData = statsCache.get(cacheKey);

      if (cachedData) {
        res.set('X-Cache', 'HIT');
        res.set('X-Cache-Type', 'STATS');
        return res.status(HTTP_STATUS.OK).json(cachedData);
      }

      const originalSend = res.json;
      res.json = function(data) {
        if (res.statusCode === 200) {
          statsCache.set(cacheKey, data);
          res.set('X-Cache', 'MISS');
          res.set('X-Cache-Type', 'STATS');
        }

        originalSend.call(this, data);
      };

      next();

    } catch (error) {
      cacheLogger.warn({ error: error.message }, 'Error en middleware de caché de estadísticas');
      next();
    }
  };
};

/**
 * Función para limpiar caché manualmente
 * @param {string} cacheType - Tipo de caché a limpiar (opcional, limpia todos si no se especifica)
 * @param {string} pattern - Patrón para limpiar claves específicas
 */
const clearCache = (cacheType = null, pattern = null) => {
  if (cacheType && caches[cacheType]) {
    if (pattern) {
      const keys = caches[cacheType].keys();
      const matchingKeys = keys.filter(key => key.includes(pattern));
      caches[cacheType].del(matchingKeys);
      cacheLogger.info({ cacheType, deletedKeys: matchingKeys.length, pattern }, 'Caché limpiado con patrón');
      return { deletedKeys: matchingKeys.length, pattern, type: cacheType };
    }
    caches[cacheType].flushAll();
    cacheLogger.info({ cacheType }, 'Caché limpiado completamente');
    return { message: `Caché ${cacheType} limpiado completamente` };

  }

  if (!cacheType) {
    Object.keys(caches).forEach(type => {
      caches[type].flushAll();
    });
    cacheLogger.info('Todos los cachés limpiados');
    return { message: 'Todos los cachés limpiados' };
  }
  return { message: 'Tipo de caché no encontrado' };
};

/**
 * Función para obtener estadísticas del caché
 */
const getCacheStats = () => {
  const stats = {};

  Object.keys(caches).forEach(type => {
    const cacheInstance = caches[type];
    const cacheStats = cacheInstance.getStats();
    stats[type] = {
      keys: cacheInstance.keys().length,
      hits: cacheStats.hits,
      misses: cacheStats.misses,
      hitRate: cacheStats.hits > 0
        ? ((cacheStats.hits / (cacheStats.hits + cacheStats.misses)) * 100).toFixed(2) + '%'
        : '0%',
      ksize: cacheStats.ksize,
      vsize: cacheStats.vsize
    };
  });

  return stats;
};

module.exports = {
  cacheMiddleware,
  statsCacheMiddleware,
  clearCache,
  getCacheStats,
  caches // Exportar para uso directo si es necesario
};
