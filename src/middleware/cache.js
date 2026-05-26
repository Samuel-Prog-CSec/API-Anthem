/**
 * Middleware de caché para optimización de consultas frecuentes
 *
 * Este middleware implementa un sistema de caché en memoria para reducir
 * la carga en la base de datos y mejorar los tiempos de respuesta.
 */

const NodeCache = require('node-cache');
const logger = require('../config/logger');
const { cacheLogger } = logger;
const config = require('../config/config');
const { HTTP_STATUS } = require('../constants');
const { generateCacheKeyFromRequest, generateStatsCacheKey } = require('../utils/cacheKeyGenerator');

// Ventanas de control de expiración y SWR (stale-while-revalidate)
const STALE_GRACE_SECONDS = 60; // Mantener entradas expiradas 60s adicionales para servir en modo STALE
const NEAR_EXPIRY_RATIO = 0.2; // Si queda <20% del TTL, se dispara una revalidación en background
const MIN_NEAR_EXPIRY_MS = 5000; // Evitar umbrales demasiado pequeños

/**
 * Configuracion centralizada por tipo de cache.
 *
 * Criterio de TTL:
 *  - El dataset Smart City 2051 es estatico entre re-imports, asi que en
 *    teoria podriamos usar TTL infinito en todo lo que dependa solo de BD.
 *    En la practica preferimos 24h como techo razonable para que un
 *    re-import (1-2h, ver scripts/importAll.js) se propague sin reinicio.
 *  - `demographic` baja de 7 dias a 24h por el mismo motivo: si reimportamos
 *    el censo, no queremos servir respuestas viejas durante toda la semana.
 *  - `static`/`containers` (ubicaciones, configuracion) bajan de TTL=0
 *    (infinito) a 24h por consistencia y para evitar entradas inmortales
 *    en memoria si la app no se reinicia durante mucho tiempo.
 *
 * `maxKeys` actua como techo defensivo contra explosiones de cardinalidad
 * (queries con muchas combinaciones de filtros). Si se alcanza, node-cache
 * empezara a rechazar nuevas entradas con error (capturado por buildCache).
 */
const DIA_EN_SEGUNDOS = 24 * 3600;
const CACHE_CONFIG = {
  demographic: { stdTTL: DIA_EN_SEGUNDOS, checkperiod: 1800, maxKeys: 20000 }, // Censo, 24h
  statistics: { stdTTL: DIA_EN_SEGUNDOS, checkperiod: 1800, maxKeys: 15000 }, // Estadisticas, 24h
  traffic: { stdTTL: DIA_EN_SEGUNDOS, checkperiod: 1800, maxKeys: 20000 }, // Trafico historico, 24h
  static: { stdTTL: DIA_EN_SEGUNDOS, checkperiod: 3600, maxKeys: 50000 }, // Configuracion, 24h
  airQuality: { stdTTL: DIA_EN_SEGUNDOS, checkperiod: 1800, maxKeys: 15000 }, // Aire, 24h
  bikes: { stdTTL: DIA_EN_SEGUNDOS, checkperiod: 1800, maxKeys: 5000 }, // Bicicletas, 24h
  containers: { stdTTL: DIA_EN_SEGUNDOS, checkperiod: 3600, maxKeys: 50000 }, // Contenedores, 24h
  noise: { stdTTL: DIA_EN_SEGUNDOS, checkperiod: 1800, maxKeys: 10000 }, // Ruido, 24h
  fines: { stdTTL: DIA_EN_SEGUNDOS, checkperiod: 1800, maxKeys: 15000 } // Multas, 24h
};

// Mapa de promesas en vuelo para evitar thundering herd en el mismo cacheKey
const pendingRequests = new Map();
// Mapa de revalidaciones en background para no lanzar múltiples refrescos simultáneos
const backgroundRefreshes = new Map();

// TTL de seguridad (ms) para entradas de los mapas de control de concurrencia.
// Si un handler crashea antes de disparar `res.finish`/`res.close`, la limpieza
// natural no ocurre y la entrada quedaria en memoria para siempre. Este TTL
// actua como red de seguridad: tras `CONTROL_MAPS_SAFETY_TTL_MS` se elimina
// la entrada si sigue presente, evitando crecimiento ilimitado de memoria.
const CONTROL_MAPS_SAFETY_TTL_MS = 30000;

/**
 * Inserta una entrada en un Map global de control con TTL de seguridad.
 *
 * Si transcurridos `ttlMs` la entrada sigue presente y es la MISMA (===) que
 * la insertada, se elimina automaticamente. Se compara por identidad para no
 * borrar entradas que ya hayan sido reemplazadas por otra peticion concurrente.
 *
 * El timer usa `unref()` para no bloquear el cierre del proceso al apagar el
 * servidor (graceful shutdown).
 *
 * @param {Map}     map   - Mapa global donde insertar.
 * @param {string}  key   - Clave (normalmente cacheKey).
 * @param {*}       value - Valor a insertar.
 * @param {number} [ttlMs=CONTROL_MAPS_SAFETY_TTL_MS] - TTL en milisegundos.
 */
const setWithSafetyTtl = (map, key, value, ttlMs = CONTROL_MAPS_SAFETY_TTL_MS) => {
  map.set(key, value);
  const timer = setTimeout(() => {
    if (map.get(key) === value) {
      map.delete(key);
      cacheLogger.warn(
        { cacheKey: key, ttlMs },
        'Entrada de control eliminada por TTL de seguridad (handler no limpio)'
      );
    }
  }, ttlMs);
  if (typeof timer.unref === 'function') {
    timer.unref();
  }
};

/**
 * Cache L2 de fallback ante errores de la base de datos.
 *
 * Cuando una peticion entra en MISS sobre un cache primario y el handler falla
 * (timeout MongoDB, conexion caida, error 5xx), el `globalErrorHandler` consulta
 * este cache para servir la ultima respuesta exitosa conocida con header
 * `X-Cache-Status: STALE_FALLBACK`. Asi el dashboard sigue siendo usable durante
 * incidencias transitorias en lugar de devolver un 500 en cascada.
 *
 * TTL muy largo (24h) y `maxKeys` generoso porque solo guardamos payloads que
 * YA estaban siendo cacheados en algun cache primario; no introduce mas presion
 * de memoria proporcional al trafico, solo a la diversidad de queries.
 */
const fallbackCache = new NodeCache({
  stdTTL: 24 * 3600,
  checkperiod: 3600,
  maxKeys: 30000,
  useClones: false,
  deleteOnExpire: true
});

const buildCache = (cacheConfig) => {
  const instance = new NodeCache({
    ...cacheConfig,
    useClones: false,
    deleteOnExpire: true
  });
  instance.options._swrGraceSeconds = cacheConfig._swrGraceSeconds || STALE_GRACE_SECONDS;
  return instance;
};

/**
 * Middleware de cache para optimizacion de consultas frecuentes
 */
const caches = Object.fromEntries(
  Object.entries(CACHE_CONFIG).map(([key, cacheConfig]) => [
    key,
    buildCache({ ...cacheConfig, _swrGraceSeconds: STALE_GRACE_SECONDS })
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
  // Solo refrescar background en lecturas idempotentes (no POST/PUT/DELETE)
  if (req.method !== 'GET') {
    return;
  }
  if (backgroundRefreshes.has(cacheKey)) {
    return;
  }

  const refreshPromise = (async () => {
    try {
      // SEGURIDAD: construir la URL con `config.server.host`/`port` en vez de
      // `req.get('host')` para evitar SSRF. Un cliente malicioso podria
      // enviar `Host: internal-service:8080` y forzar al server a hacer
      // peticiones internas con el JWT del usuario adjunto.
      const baseUrl = `http://${config.server.host}:${config.server.port}`;
      const url = `${baseUrl}${req.originalUrl}`;

      // Reenviamos solo el header Authorization (no cookies ni Host) para
      // que el background refresh se autentique como el usuario, pero sin
      // arrastrar headers que podrian sesgar el resultado.
      const refreshHeaders = { 'x-cache-refresh': '1' };
      if (req.headers.authorization) {
        refreshHeaders.authorization = req.headers.authorization;
      }

      await fetch(url, {
        headers: refreshHeaders,
        method: req.method
      });
    } catch (error) {
      cacheLogger.warn({ cacheKey, cacheType, error: error.message }, 'Revalidacion de cache fallida');
    } finally {
      backgroundRefreshes.delete(cacheKey);
    }
  })();

  setWithSafetyTtl(backgroundRefreshes, cacheKey, refreshPromise);
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

const storePayloadInCache = (cacheInstance, cacheKey, data, cacheType) => {
  const now = Date.now();
  const ttlSeconds = cacheInstance.options.stdTTL || 0;
  const graceSeconds = cacheInstance.options._swrGraceSeconds || 0;
  const payload = {
    data,
    timestamp: now,
    expiresAt: ttlSeconds === 0 ? Infinity : now + ttlSeconds * 1000,
    cacheType: cacheType || 'unknown'
  };

  const ttlWithGrace = ttlSeconds === 0 ? 0 : ttlSeconds + graceSeconds;
  cacheInstance.set(cacheKey, payload, ttlWithGrace);

  // Replicar al fallback cache (L2) con TTL extendido para servir como
  // respuesta degradada si la DB falla en una proxima peticion del mismo recurso
  fallbackCache.set(cacheKey, payload);

  return payload;
};

/**
 * Obtiene el payload de fallback para un cacheKey si existe.
 * Usado por el `globalErrorHandler` para servir respuestas degradadas ante
 * errores de la base de datos.
 *
 * @param {string} cacheKey - Clave generada por `generateCacheKeyFromRequest`
 * @returns {{data: any, timestamp: number, cacheType: string}|undefined}
 */
const getFallbackPayload = (cacheKey) => fallbackCache.get(cacheKey);

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
            scheduleBackgroundRefresh(req, cacheType, cacheKey);
            return;
          }

          respondFromCache(res, cacheType, cacheKey, cached, 'HIT');
          if (nearExpiry) {
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

      setWithSafetyTtl(pendingRequests, cacheKey, pendingEntry);

      const cleanupPending = () => {
        if (pendingRequests.has(cacheKey)) {
          resolvePending(cacheKey, null, new Error('Respuesta finalizada sin cachear'));
        }
      };

      res.once('finish', cleanupPending);
      res.once('close', cleanupPending);

      // Registrar contexto de cache en req para que `globalErrorHandler` pueda
      // intentar servir un payload de fallback (L2) si el handler falla con 5xx.
      // Ver `getFallbackPayload` arriba.
      req._cacheContext = { cacheType, cacheKey };

      // Cache MISS - interceptar res.json para cachear
      const originalJson = res.json.bind(res);

      res.json = function(data) {
        // Solo cachear respuestas exitosas
        if (res.statusCode >= 200 && res.statusCode < 300) {
          const payload = storePayloadInCache(cacheInstance, cacheKey, data, cacheType);
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
  getFallbackPayload, // Usado por `globalErrorHandler` para stale fallback
  caches // Exportar para uso directo si es necesario
};
