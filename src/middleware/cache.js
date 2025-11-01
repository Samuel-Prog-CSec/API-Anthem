/**
 * Middleware de caché para optimización de consultas frecuentes
 *
 * Este middleware implementa un sistema de caché en memoria para reducir
 * la carga en la base de datos y mejorar los tiempos de respuesta.
 */

const NodeCache = require('node-cache');
const logger = require('../config/logger');
const { cacheLogger } = logger;

/**
 * Diferentes instancias de caché según el tipo de datos
 * Cada una con TTL (Time To Live) apropiado
 */
const caches = {
  // Datos demográficos (cambian raramente) - 1 hora
  demographic: new NodeCache({
    stdTTL: 3600, // 1 hora
    checkperiod: 600, // Limpieza cada 10 minutos
    useClones: false, // Performance: no clonar objetos
    deleteOnExpire: true
  }),

  // Estadísticas de multas (cambios diarios) - 30 minutos
  statistics: new NodeCache({
    stdTTL: 1800, // 30 minutos
    checkperiod: 300, // Limpieza cada 5 minutos
    useClones: false,
    deleteOnExpire: true
  }),

  // Datos de tráfico (cambian frecuentemente) - 5 minutos
  traffic: new NodeCache({
    stdTTL: 300, // 5 minutos
    checkperiod: 60, // Limpieza cada minuto
    useClones: false,
    deleteOnExpire: true
  }),

  // Datos estáticos (ubicaciones, configuración) - 24 horas
  static: new NodeCache({
    stdTTL: 86400, // 24 horas
    checkperiod: 3600, // Limpieza cada hora
    useClones: false,
    deleteOnExpire: true
  }),

  // Calidad del aire (cambios cada 30 min) - 30 minutos
  airQuality: new NodeCache({
    stdTTL: 1800, // 30 minutos
    checkperiod: 300, // Limpieza cada 5 minutos
    useClones: false,
    deleteOnExpire: true
  }),

  // Disponibilidad de bicicletas (cambios frecuentes) - 5 minutos
  bikes: new NodeCache({
    stdTTL: 300, // 5 minutos
    checkperiod: 60, // Limpieza cada minuto
    useClones: false,
    deleteOnExpire: true
  }),

  // Contenedores de residuos (datos estáticos) - 24 horas
  containers: new NodeCache({
    stdTTL: 86400, // 24 horas
    checkperiod: 3600, // Limpieza cada hora
    useClones: false,
    deleteOnExpire: true
  }),

  // Contaminación acústica (cambios cada 30 min) - 30 minutos
  noise: new NodeCache({
    stdTTL: 1800, // 30 minutos
    checkperiod: 300, // Limpieza cada 5 minutos
    useClones: false,
    deleteOnExpire: true
  })
};

// Mantener caché legacy para compatibilidad
const cache = caches.traffic;
const statsCache = caches.statistics;

/**
 * Middleware de caché inteligente con soporte para diferentes tipos
 * @param {string} cacheType - Tipo de caché: 'demographic', 'statistics', 'traffic', 'static'
 * @param {function} keyGenerator - Función para generar clave de caché (opcional)
 */
const cacheMiddleware = (cacheType = 'traffic', keyGenerator = null) => {
  return (req, res, next) => {
    // Validar tipo de caché
    const cacheInstance = caches[cacheType] || caches.traffic;

    // Generar clave de caché
    const cacheKey = keyGenerator
      ? keyGenerator(req)
      : `${req.method}:${req.originalUrl}:${JSON.stringify(req.query)}`;

    try {
      // Intentar obtener del caché
      const cached = cacheInstance.get(cacheKey);

      if (cached) {
        // Cache HIT - retornar datos cacheados
        const cacheAge = Math.floor((Date.now() - (cached.timestamp || Date.now())) / 1000);

        return res.status(200)
          .set('X-Cache-Status', 'HIT')
          .set('X-Cache-Type', cacheType)
          .set('X-Cache-Age', `${cacheAge}s`)
          .json({
            ...cached.data,
            _cache: {
              hit: true,
              age: `${cacheAge}s`,
              type: cacheType
            }
          });
      }

      // Cache MISS - interceptar res.json para cachear
      const originalJson = res.json.bind(res);

      res.json = function(data) {
        // Solo cachear respuestas exitosas
        if (res.statusCode >= 200 && res.statusCode < 300) {
          const cacheData = {
            data,
            timestamp: Date.now()
          };

          cacheInstance.set(cacheKey, cacheData);
          res.set('X-Cache-Status', 'MISS');
          res.set('X-Cache-Type', cacheType);
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
    const cacheKey = `stats_${req.originalUrl}_${JSON.stringify(req.query)}`;

    try {
      const cachedData = statsCache.get(cacheKey);

      if (cachedData) {
        res.set('X-Cache', 'HIT');
        res.set('X-Cache-Type', 'STATS');
        return res.status(200).json(cachedData);
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
 * Middleware de compresión condicional
 * Añade metadatos sobre el tamaño de la respuesta sin comprimir realmente
 * NOTA: La compresión real debería manejarse con express-compression o similar
 */
const compressionMiddleware = () => {
  return (req, res, next) => {
    const originalSend = res.json;

    res.json = function(data) {
      // Calcular tamaño aproximado de la respuesta
      const responseSize = JSON.stringify(data).length;

      // Añadir metadata del tamaño de respuesta
      // NO establecer Content-Encoding sin comprimir realmente
      if (responseSize > 1024) {
        res.set('X-Response-Size', responseSize.toString());
        res.set('X-Uncompressed-Size', responseSize.toString());
      }

      originalSend.call(this, data);
    };

    next();
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

  } if (!cacheType) {
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
  compressionMiddleware,
  clearCache,
  getCacheStats,
  caches // Exportar para uso directo si es necesario
};
