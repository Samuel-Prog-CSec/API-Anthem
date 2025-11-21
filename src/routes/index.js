/**
 * Rutas de la API principal
 *
 * Define la estructura de rutas principal y combina todas las sub-rutas
 */

const express = require('express');
const router = express.Router();
const config = require('../config/config');
const { createResponse } = require('../utils/responseHelper');
const { getConnectionStats } = require('../config/database');

// Import route modules
const authRoutes = require('./auth');
const airQualityRoutes = require('./airQuality');
const noiseMonitoringRoutes = require('./noiseMonitoring');
const fineRoutes = require('./fines');
const censusRoutes = require('./census');
const adminRoutes = require('./admin');
const locationRoutes = require('./locations');
const trafficRoutes = require('./traffic');
const accidentRoutes = require('./accidents');
const scooterAssignmentRoutes = require('./scooterAssignments');
const bikeAvailabilityRoutes = require('./bikeAvailability');
const containerRoutes = require('./containers');

/**
 * @route   GET /api/v1.0
 * @desc    API welcome and status endpoint
 * @access  Public
 *
 * Provides basic API information, version, and health status.
 */
router.get('/api/v1.0', (req, res) => {
  const uptime = process.uptime();
  const uptimeHours = Math.floor(uptime / 3600);
  const uptimeMinutes = Math.floor((uptime % 3600) / 60);
  const uptimeSeconds = Math.floor(uptime % 60);

  res.status(200).json(
    createResponse(
      'La API REST de la Smart City Anthem está operativa',
      {
        api: {
          name: 'API REST Anthem Smart City',
          version: config.api.version,
          environment: config.server.env
        },
        server: {
          uptime: `${uptimeHours}h ${uptimeMinutes}m ${uptimeSeconds}s`,
          timestamp: new Date().toISOString(),
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        },
        endpoints: {
          authentication: '/api/v1.0/auth',
          airQuality: '/api/v1.0/air-quality',
          noiseMonitoring: '/api/v1.0/noise-monitoring',
          fines: '/api/v1.0/fines',
          census: '/api/v1.0/census',
          locations: '/api/v1.0/locations',
          traffic: '/api/v1.0/traffic',
          accidents: '/api/v1.0/accidents',
          scooterAssignments: '/api/v1.0/scooter-assignments',
          bikeAvailability: '/api/v1.0/bikes',
          containers: '/api/v1.0/containers',
          admin: '/api/v1.0/admin',
          health: '/api/v1.0/health',
        }
      }
    )
  );
});

/**
 * @route   GET /api/v1.0/health
 * @desc    Detailed health check endpoint
 * @access  Public
 *
 * Provides comprehensive health status including database connectivity,
 * system resources, and service dependencies.
 */
router.get('/health', (req, res) => {
  const healthData = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: config.server.env,
    version: config.api.version,

    // System information
    system: {
      platform: process.platform,
      nodeVersion: process.version,
      memory: {
        used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + ' MB',
        total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024) + ' MB',
        rss: Math.round(process.memoryUsage().rss / 1024 / 1024) + ' MB'
      },
      cpu: process.cpuUsage(),
    },

    // Database status
    database: {
      status: 'connected',
      ...getConnectionStats()
    },

    // Services status
    services: {
      authentication: 'operational',
      rateLimit: 'operational',
      security: 'operational'
    }
  };

  // Check database connectivity
  if (healthData.database.readyState !== 1) {
    healthData.status = 'degraded';
    healthData.database.status = 'disconnected';
    healthData.issues = ['Database connection unavailable'];
  }

  const statusCode = healthData.status === 'healthy' ? 200 : 503;

  res.status(statusCode).json(
    createResponse(
      `Estado de la API: ${healthData.status}`,
      healthData
    )
  );
});

/**
 * @route   GET /api/v1.0/cors-test
 * @desc    CORS diagnostic endpoint
 * @access  Public
 *
 * Endpoint para diagnosticar configuración de CORS.
 * Útil para debugging en desarrollo.
 */
router.get('/cors-test', (req, res) => {
  const origin = req.get('origin') || 'No origin header';

  res.status(200).json(
    createResponse(
      'CORS test successful',
      {
        origin: origin,
        allowedOrigins: config.security.corsOrigins,
        requestHeaders: {
          origin: req.get('origin'),
          referer: req.get('referer'),
          userAgent: req.get('user-agent'),
          host: req.get('host')
        },
        responseHeaders: {
          'access-control-allow-origin': res.get('access-control-allow-origin'),
          'access-control-allow-credentials': res.get('access-control-allow-credentials'),
          'vary': res.get('vary')
        },
        message: origin !== 'No origin header'
          ? 'Your origin is allowed by CORS policy'
          : 'Request has no origin (likely same-origin or non-browser client)'
      }
    )
  );
});

// Mount authentication routes
router.use('/auth', authRoutes);

// Mount environmental data routes
router.use('/air-quality', airQualityRoutes);
router.use('/noise-monitoring', noiseMonitoringRoutes);

// Mount city data routes
router.use('/fines', fineRoutes);
router.use('/census', censusRoutes);
router.use('/locations', locationRoutes);
router.use('/traffic', trafficRoutes);
router.use('/accidents', accidentRoutes);
router.use('/scooter-assignments', scooterAssignmentRoutes);

// Mount mobility and infrastructure routes
router.use('/bikes', bikeAvailabilityRoutes);
router.use('/containers', containerRoutes);

// Mount administration routes
router.use('/admin', adminRoutes);

/**
 * Express 5 Compatibility Note:
 * Se ha eliminado el catch-all route ('*') porque Express 5 requiere nombres de parámetros explícitos
 * en los wildcards. El notFoundHandler global en server.js manejará todas las rutas 404.
 */

module.exports = router;
