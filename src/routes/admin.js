/**
 * Rutas de administración del sistema
 *
 * Endpoints para administradores para gestionar el caché,
 * obtener métricas del sistema y realizar tareas de mantenimiento.
 */

const express = require('express');

const { ROUTE_SPECIFIC_LIMITS, HTTP_STATUS } = require('../constants');

// Middleware de autenticación y autorización
const { authenticate } = require('../middleware/auth');
const { adminOnly } = require('../middleware/authorization');
const { validateRequest } = require('../middleware/security');
const { validarLimpiezaCache } = require('../validators/validadorAdmin');

// Utilidades de cache y monitoreo (getPerformanceStats se usa en endpoints, no como middleware)
const { clearCache, getCacheStats } = require('../middleware/cache');
const { getPerformanceStats } = require('../middleware/performanceMonitor');
const { getETagStats } = require('../middleware/etag');
const { AppError } = require('../utils/errorUtils');
const logger = require('../config/logger');

const router = express.Router();

// Nota: performanceMonitor se aplica una sola vez en routes/index.js

/**
 * @route   GET /api/v1/admin/cache/stats
 * @desc    Obtener estadísticas del caché
 * @access  Privado (solo administradores)
 */
router.get('/cache/stats',
  authenticate,
  adminOnly,
  (req, res, next) => {
    try {
      const stats = getCacheStats();

      // Calcular hit rates globales
      const globalHitRate = Object.values(stats).reduce((acc, cacheType) => {
        const total = cacheType.hits + cacheType.misses;
        if (total > 0) {
          acc.totalHits += cacheType.hits;
          acc.totalRequests += total;
        }
        return acc;
      }, { totalHits: 0, totalRequests: 0 });

      const overallHitRate = globalHitRate.totalRequests > 0
        ? ((globalHitRate.totalHits / globalHitRate.totalRequests) * 100).toFixed(2) + '%'
        : '0%';

      res.status(HTTP_STATUS.OK).json({
        success: true,
        message: 'Estadísticas de caché obtenidas exitosamente',
        data: {
          timestamp: new Date().toISOString(),
          overallHitRate,
          cachesByType: stats,
          totalCaches: Object.keys(stats).length,
          totalKeys: Object.values(stats).reduce((sum, cache) => sum + cache.keys, 0)
        }
      });
    } catch (error) {
      logger.error({
        error: error.message,
        stack: error.stack,
        endpoint: 'GET /api/v1/admin/cache/stats',
        userId: req.user?.id
      }, 'Error obteniendo estadísticas de caché');
      next(new AppError('Error interno del servidor al obtener estadísticas', HTTP_STATUS.INTERNAL_SERVER_ERROR));
    }
  }
);

/**
 * @route   DELETE /api/v1/admin/cache/clear
 * @desc    Limpiar caché del sistema
 * @access  Privado (solo administradores)
 */
router.delete('/cache/clear',
  authenticate,
  adminOnly,
  ...validarLimpiezaCache,
  validateRequest,

  (req, res, next) => {
    try {
      const { type, pattern } = req.query;

      const result = clearCache(type || null, pattern || null);

      res.status(HTTP_STATUS.OK).json({
        success: true,
        message: pattern
          ? `Caché limpiado para el patrón: ${pattern}`
          : type
            ? `Caché tipo ${type} limpiado exitosamente`
            : 'Todo el caché ha sido limpiado exitosamente',
        data: {
          timestamp: new Date().toISOString(),
          type: type || 'all',
          pattern: pattern || null,
          result,
          action: 'cache_cleared'
        }
      });

      logger.info({
        type: type || 'ALL',
        pattern: pattern || 'NONE',
        result,
        userId: req.user?.id
      }, '[ADMIN] Caché limpiado por administrador');

    } catch (error) {
      logger.error({
        error: error.message,
        stack: error.stack,
        endpoint: 'DELETE /api/v1/admin/cache/clear',
        userId: req.user?.id
      }, 'Error limpiando caché');
      next(new AppError('Error interno del servidor al limpiar caché', HTTP_STATUS.INTERNAL_SERVER_ERROR));
    }
  }
);

/**
 * @route   GET /api/v1/admin/system/health
 * @desc    Obtener estado de salud del sistema con metricas detalladas
 * @access  Privado (solo administradores)
 *
 * Devuelve:
 *   - Estado de conexion a MongoDB con latencia de ping (RTT)
 *   - Tamano del connection pool (cuando esta disponible)
 *   - Memoria heap (rss/heapUsed/heapTotal)
 *   - Hit rate global del cache + breakdown por tipo
 *   - Lista de issues detectados (alta latencia, memoria alta, DB caida, etc.)
 *
 * Util para alertas en QA y monitoring continuo.
 */
router.get('/system/health',
  authenticate,
  adminOnly,
  async (req, res, next) => {
    try {
      const mongoose = require('mongoose');

      const issues = [];

      // ----- Estado de la base de datos + ping latency (RTT) -----
      const dbStatus = mongoose.connection.readyState === 1 ? 'connected' : 'disconnected';
      let dbPingLatencyMs = null;

      if (dbStatus === 'connected') {
        try {
          const pingStart = Date.now();
          // ping admin command es la forma mas barata de medir RTT a la DB
          await mongoose.connection.db.admin().ping();
          dbPingLatencyMs = Date.now() - pingStart;

          if (dbPingLatencyMs > 200) {
            issues.push('high_db_latency');
          }
        } catch (pingError) {
          // Conexion en estado raro: readyState=1 pero no responde a ping
          dbPingLatencyMs = -1;
          issues.push('db_ping_failed');
          logger.warn({ error: pingError.message }, 'Ping a DB fallo en health check');
        }
      } else {
        issues.push('database_disconnected');
      }

      // ----- Connection pool size (best-effort, depende del driver) -----
      let connectionPool = null;
      try {
        const client = mongoose.connection.getClient?.();
        const topology = client?.topology;
        if (topology?.s?.servers) {
          const servers = Array.from(topology.s.servers.values());
          const firstServer = servers[0];
          const pool = firstServer?.pool || firstServer?.s?.pool;
          if (pool) {
            connectionPool = {
              totalConnections: pool.totalConnectionCount ?? null,
              availableConnections: pool.availableConnectionCount ?? null,
              waitQueueSize: pool.waitQueueSize ?? null
            };
          }
        }
      } catch (_poolError) {
        // El driver no expone metricas del pool consistentemente entre versiones;
        // no es critico para el health check, lo dejamos en null
        connectionPool = null;
      }

      // ----- Memoria -----
      const memoryUsage = process.memoryUsage();
      const heapUsedMB = Math.round(memoryUsage.heapUsed / 1024 / 1024);

      if (memoryUsage.heapUsed > ROUTE_SPECIFIC_LIMITS.ADMIN.MEMORY_THRESHOLD_BYTES) {
        issues.push('high_memory_usage');
      }

      // ----- Cache: hit rate global y breakdown por tipo -----
      // BUG ANTERIOR: el codigo accedia a cacheStats.general.keys, pero el cache
      // real no tiene una entrada llamada 'general' (los tipos son demographic,
      // statistics, traffic, static, airQuality, bikes, containers, noise).
      // Eso lanzaba TypeError 'Cannot read properties of undefined' en cuanto se
      // llamaba al endpoint. Sumamos todos los caches existentes en su lugar.
      const cacheStats = getCacheStats();
      const cacheTotals = Object.values(cacheStats).reduce(
        (acc, c) => ({
          keys: acc.keys + (c.keys || 0),
          hits: acc.hits + (c.hits || 0),
          misses: acc.misses + (c.misses || 0)
        }),
        { keys: 0, hits: 0, misses: 0 }
      );
      const totalRequests = cacheTotals.hits + cacheTotals.misses;
      const globalHitRate = totalRequests > 0
        ? Number(((cacheTotals.hits / totalRequests) * 100).toFixed(2))
        : 0;

      // Si el cache esta caliente (hubo trafico) y el hit rate es bajo, es senal
      // de keys mal normalizadas o TTLs demasiado cortos. Util para QA.
      if (totalRequests > 100 && globalHitRate < 30) {
        issues.push('low_cache_hit_rate');
      }

      // ----- Estado general derivado de issues -----
      let status = 'healthy';
      if (issues.includes('database_disconnected') || issues.includes('db_ping_failed')) {
        status = 'degraded';
      } else if (issues.length > 0) {
        status = 'warning';
      }

      const healthData = {
        status,
        timestamp: new Date().toISOString(),
        uptime: {
          seconds: process.uptime(),
          formatted: formatUptime(process.uptime())
        },
        database: {
          status: dbStatus,
          name: mongoose.connection.name || 'unknown',
          pingLatencyMs: dbPingLatencyMs,
          connectionPool
        },
        memory: {
          rssMB: Math.round(memoryUsage.rss / 1024 / 1024),
          heapUsedMB,
          heapTotalMB: Math.round(memoryUsage.heapTotal / 1024 / 1024),
          externalMB: Math.round(memoryUsage.external / 1024 / 1024)
        },
        cache: {
          totalKeys: cacheTotals.keys,
          totalHits: cacheTotals.hits,
          totalMisses: cacheTotals.misses,
          globalHitRatePct: globalHitRate,
          byType: cacheStats
        },
        node: {
          version: process.version,
          platform: process.platform
        },
        issues
      };

      res.status(HTTP_STATUS.OK).json({
        success: true,
        message: 'Estado de salud del sistema obtenido exitosamente',
        data: healthData
      });

    } catch (error) {
      logger.error({
        error: error.message,
        stack: error.stack,
        endpoint: 'GET /api/v1/admin/system/health',
        userId: req.user?.id
      }, 'Error obteniendo estado de salud');
      next(new AppError('Error interno del servidor al obtener estado de salud', HTTP_STATUS.INTERNAL_SERVER_ERROR));
    }
  }
);

/**
 * @route   GET /api/v1/admin/performance/stats
 * @desc    Obtener estadísticas de rendimiento
 * @access  Privado (solo administradores)
 */
router.get('/performance/stats',
  authenticate,
  adminOnly,
  (req, res, next) => {
    try {
      const stats = getPerformanceStats();

      res.status(HTTP_STATUS.OK).json({
        success: true,
        message: 'Estadísticas de rendimiento obtenidas exitosamente',
        data: {
          timestamp: new Date().toISOString(),
          performanceStats: stats
        }
      });

    } catch (error) {
      logger.error({
        error: error.message,
        stack: error.stack,
        endpoint: 'GET /api/v1/admin/performance/stats',
        userId: req.user?.id
      }, 'Error obteniendo estadísticas de rendimiento');
      next(new AppError('Error interno del servidor al obtener estadísticas de rendimiento', HTTP_STATUS.INTERNAL_SERVER_ERROR));
    }
  }
);

/**
 * @route   GET /api/v1/admin/etag/stats
 * @desc    Obtener estadísticas de ETags
 * @access  Privado (solo administradores)
 */
router.get('/etag/stats',
  authenticate,
  adminOnly,
  (req, res, next) => {
    try {
      const stats = getETagStats();

      res.status(HTTP_STATUS.OK).json({
        success: true,
        message: 'Estadísticas de ETags obtenidas exitosamente',
        data: {
          timestamp: new Date().toISOString(),
          etagStats: stats
        }
      });

    } catch (error) {
      logger.error({
        error: error.message,
        stack: error.stack,
        endpoint: 'GET /api/v1/admin/etag/stats',
        userId: req.user?.id
      }, 'Error obteniendo estadísticas de ETags');
      next(new AppError('Error interno del servidor al obtener estadísticas de ETags', HTTP_STATUS.INTERNAL_SERVER_ERROR));
    }
  }
);

/**
 * Función auxiliar para formatear tiempo de actividad
 */
function formatUptime(seconds) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  return `${days}d ${hours}h ${minutes}m ${secs}s`;
}

module.exports = router;
