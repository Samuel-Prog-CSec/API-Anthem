/**
 * Rutas de administración del sistema
 *
 * Endpoints para administradores para gestionar el caché,
 * obtener métricas del sistema y realizar tareas de mantenimiento.
 */

const express = require('express');
const { query } = require('express-validator');

// Middleware de autenticación
const { authenticate } = require('../middleware/auth');
const { validateRequest } = require('../middleware/security');

// Utilidades de caché
const { clearCache, getCacheStats } = require('../middleware/cache');
const { AppError } = require('../utils/errorUtils');

const router = express.Router();

/**
 * @route   GET /api/v1/admin/cache/stats
 * @desc    Obtener estadísticas del caché
 * @access  Privado (solo administradores)
 */
router.get('/cache/stats',
  authenticate,
  (req, res, next) => {
    try {
      const stats = getCacheStats();

      res.status(200).json({
        success: true,
        message: 'Estadísticas de caché obtenidas exitosamente',
        data: {
          timestamp: new Date().toISOString(),
          cacheStats: stats,
          performance: {
            hitRate: {
              general: calculateHitRate(stats.general.stats),
              statistics: calculateHitRate(stats.statistics.stats)
            }
          }
        }
      });
    } catch (error) {
      console.error('Error obteniendo estadísticas de caché:', error);
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

  query('pattern')
    .optional()
    .isString()
    .trim()
    .isLength({ min: 1, max: 100 })
    .withMessage('Pattern debe ser una cadena de texto válida'),

  validateRequest,

  (req, res, next) => {
    try {
      const { pattern } = req.query;

      const result = clearCache(pattern);

      res.status(200).json({
        success: true,
        message: pattern
          ? `Caché limpiado para el patrón: ${pattern}`
          : 'Todo el caché ha sido limpiado exitosamente',
        data: {
          timestamp: new Date().toISOString(),
          pattern: pattern || null,
          deletedEntries: result.deletedKeys || 0,
          action: 'cache_cleared'
        }
      });

      console.log(`[ADMIN] Caché limpiado por administrador. Patrón: ${pattern || 'ALL'}, Entradas eliminadas: ${result.deletedKeys || 'ALL'}`);

    } catch (error) {
      console.error('Error limpiando caché:', error);
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
      console.error('Error obteniendo estado de salud:', error);
      next(new AppError('Error interno del servidor al obtener estado de salud', 500));
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
