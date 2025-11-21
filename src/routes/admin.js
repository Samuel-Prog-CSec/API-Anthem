/**
 * Rutas de administración del sistema
 *
 * Endpoints para administradores para gestionar el caché,
 * obtener métricas del sistema y realizar tareas de mantenimiento.
 */

const express = require('express');
const { query } = require('express-validator');

// Middleware de autenticación y autorización
const { authenticate } = require('../middleware/auth');
const { adminOnly } = require('../middleware/authorization');
const { validateRequest } = require('../middleware/security');
const { performanceMonitor } = require('../middleware/performanceMonitor');

// Utilidades de caché
const { clearCache, getCacheStats } = require('../middleware/cache');
const { getPerformanceStats } = require('../middleware/performanceMonitor');
const { getETagStats } = require('../middleware/etag');
const { AppError } = require('../utils/errorUtils');
const logger = require('../config/logger');

const router = express.Router();

// Aplicar performanceMonitor a todas las rutas de admin
router.use(performanceMonitor);

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

      res.status(200).json({
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
      next(new AppError('Error interno del servidor al obtener estadísticas', 500));
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

  query('type')
    .optional()
    .isString()
    .trim()
    .withMessage('Type debe ser una cadena de texto válida'),

  query('pattern')
    .optional()
    .isString()
    .trim()
    .isLength({ min: 1, max: 100 })
    .withMessage('Pattern debe ser una cadena de texto válida'),

  validateRequest,

  (req, res, next) => {
    try {
      const { type, pattern } = req.query;

      const result = clearCache(type || null, pattern || null);

      res.status(200).json({
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
      next(new AppError('Error interno del servidor al limpiar caché', 500));
    }
  }
);

/**
 * @route   GET /api/v1/admin/system/health
 * @desc    Obtener estado de salud del sistema
 * @access  Privado (solo administradores)
 */
router.get('/system/health',
  authenticate,
  adminOnly,
  async (req, res, next) => {
    try {
      const mongoose = require('mongoose');

      // Verificar estado de la base de datos
      const dbStatus = mongoose.connection.readyState === 1 ? 'connected' : 'disconnected';

      // Obtener estadísticas de memoria
      const memoryUsage = process.memoryUsage();

      // Obtener tiempo de actividad
      const uptime = process.uptime();

      // Obtener estadísticas de caché
      const cacheStats = getCacheStats();

      const healthData = {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: {
          seconds: uptime,
          formatted: formatUptime(uptime)
        },
        database: {
          status: dbStatus,
          name: mongoose.connection.name || 'unknown'
        },
        memory: {
          used: Math.round(memoryUsage.used / 1024 / 1024), // MB
          heap: Math.round(memoryUsage.heapUsed / 1024 / 1024), // MB
          external: Math.round(memoryUsage.external / 1024 / 1024) // MB
        },
        cache: {
          generalKeys: cacheStats.general.keys,
          statisticsKeys: cacheStats.statistics.keys,
          totalKeys: cacheStats.general.keys + cacheStats.statistics.keys
        },
        node: {
          version: process.version,
          platform: process.platform
        }
      };

      // Determinar estado general
      if (dbStatus !== 'connected') {
        healthData.status = 'degraded';
        healthData.issues = ['database_disconnected'];
      }

      if (memoryUsage.heapUsed > 500 * 1024 * 1024) { // 500MB
        healthData.status = healthData.status === 'healthy' ? 'warning' : 'degraded';
        healthData.issues = healthData.issues || [];
        healthData.issues.push('high_memory_usage');
      }

      res.status(200).json({
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
      next(new AppError('Error interno del servidor al obtener estado de salud', 500));
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

      res.status(200).json({
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
      next(new AppError('Error interno del servidor al obtener estadísticas de rendimiento', 500));
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

      res.status(200).json({
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
      next(new AppError('Error interno del servidor al obtener estadísticas de ETags', 500));
    }
  }
);

/**
 * Función auxiliar para calcular hit rate del caché
 */
function calculateHitRate(stats) {
  if (!stats || !stats.hits || !stats.misses) {
    return 0;
  }

  const total = stats.hits + stats.misses;
  return total > 0 ? Math.round((stats.hits / total) * 100) : 0;
}

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
