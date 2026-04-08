/**
 * Rutas de la API principal
 *
 * Define la estructura de rutas principal y combina todas las sub-rutas
 */

const express = require('express');
const router = express.Router();
const config = require('../config/config');
const { HTTP_STATUS } = require('../constants');
const { createResponse } = require('../utils/responseHelper');
const { getConnectionStats } = require('../config/database');
const { performanceMonitor } = require('../middleware/performanceMonitor');

// Import route modules
const authRoutes = require('./auth');
const calidadAireRoutes = require('./calidadAire');
const ruidoRoutes = require('./ruido');
const fineRoutes = require('./fines');
const censusRoutes = require('./census');
const adminRoutes = require('./admin');
const ubicacionesRoutes = require('./ubicaciones');
const trafficRoutes = require('./trafico');
const accidentRoutes = require('./accidentes');
const scooterAssignmentRoutes = require('./patinetes');
const bikeAvailabilityRoutes = require('./bicicletas');
const containerRoutes = require('./containers');
const bikeTrafficCountRoutes = require('./aforoBicicletas');

// Aplicar performanceMonitor GLOBALMENTE a todas las rutas de la API
router.use(performanceMonitor);

/**
 * @route   GET /api/v1
 * @desc    API welcome and status endpoint
 * @access  Public
 *
 * Provides basic API information, version, and health status.
 */
router.get('/', (req, res) => {
  const uptime = process.uptime();
  const uptimeHours = Math.floor(uptime / 3600);
  const uptimeMinutes = Math.floor((uptime % 3600) / 60);
  const uptimeSeconds = Math.floor(uptime % 60);

  res.status(HTTP_STATUS.OK).json(
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
          authentication: `/api/${config.api.version}/auth`,
          airQuality: `/api/${config.api.version}/air-quality`,
          noiseMonitoring: `/api/${config.api.version}/noise-monitoring`,
          fines: `/api/${config.api.version}/fines`,
          census: `/api/${config.api.version}/census`,
          locations: `/api/${config.api.version}/locations`,
          traffic: `/api/${config.api.version}/traffic`,
          accidentes: `/api/${config.api.version}/accidentes`,
          patinetes: `/api/${config.api.version}/patinetes`,
          bicicletas: `/api/${config.api.version}/bicicletas`,
          aforoBicicletas: `/api/${config.api.version}/aforo-bicicletas`,
          containers: `/api/${config.api.version}/containers`,
          admin: `/api/${config.api.version}/admin`,
          health: `/api/${config.api.version}/health`,
        }
      }
    )
  );
});

/**
 * @route   GET /api/v1/health
 * @desc    Detailed health check endpoint
 * @access  Public
 *
 * Proporciona un estado de salud completo, que incluye la conectividad
 * de la base de datos, los recursos del sistema y las dependencias del
 * servicio.
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

  const statusCode = healthData.status === 'healthy' ? HTTP_STATUS.OK : HTTP_STATUS.SERVICE_UNAVAILABLE;

  res.status(statusCode).json(
    createResponse(
      `Estado de la API: ${healthData.status}`,
      healthData
    )
  );
});

/**
 * @route   GET /api/v1/cors-test
 * @desc    CORS diagnostic endpoint
 * @access  Public
 *
 * Endpoint para diagnosticar configuración de CORS.
 * Útil para debugging en desarrollo.
 */
router.get('/cors-test', (req, res) => {
  const origin = req.get('origin') || 'No origin header';

  res.status(HTTP_STATUS.OK).json(
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

// Rutas de datos medioambientales
router.use('/calidad-aire', calidadAireRoutes);
router.use('/ruido', ruidoRoutes);

// Rutas de datos de ciudad
router.use('/fines', fineRoutes);
router.use('/census', censusRoutes);
router.use('/ubicaciones', ubicacionesRoutes);
router.use('/traffic', trafficRoutes);
router.use('/accidentes', accidentRoutes);
router.use('/patinetes', scooterAssignmentRoutes);

// Mount mobility and infrastructure routes
router.use('/bicicletas', bikeAvailabilityRoutes);
router.use('/aforo-bicicletas', bikeTrafficCountRoutes);
router.use('/containers', containerRoutes);

// Mount administration routes
router.use('/admin', adminRoutes);

/**
 * Express 5 Compatibility Note:
 * Se ha eliminado el catch-all route ('*') porque Express 5 requiere nombres de parámetros explícitos
 * en los wildcards. El notFoundHandler global en server.js manejará todas las rutas 404.
 */

module.exports = router;
