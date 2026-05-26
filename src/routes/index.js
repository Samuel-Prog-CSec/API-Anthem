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
const { authenticate } = require('../middleware/auth');
const { adminOnly } = require('../middleware/authorization');

// Import route modules
const authRoutes = require('./auth');
const calidadAireRoutes = require('./calidadAire');
const ruidoRoutes = require('./ruido');
const multaRoutes = require('./multas');
const censoRoutes = require('./censo');
const adminRoutes = require('./admin');
const ubicacionesRoutes = require('./ubicaciones');
const traficoRoutes = require('./trafico');
const accidentRoutes = require('./accidentes');
const scooterAssignmentRoutes = require('./patinetes');
const bikeAvailabilityRoutes = require('./bicicletas');
const contenedorRoutes = require('./contenedores');
const bikeTrafficCountRoutes = require('./aforoBicicletas');
const pedestrianTrafficCountRoutes = require('./aforoPeatones');

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
          autenticacion: `/api/${config.api.version}/auth`,
          calidadAire: `/api/${config.api.version}/calidad-aire`,
          ruido: `/api/${config.api.version}/ruido`,
          multas: `/api/${config.api.version}/multas`,
          censo: `/api/${config.api.version}/censo`,
          ubicaciones: `/api/${config.api.version}/ubicaciones`,
          trafico: `/api/${config.api.version}/trafico`,
          accidentes: `/api/${config.api.version}/accidentes`,
          patinetes: `/api/${config.api.version}/patinetes`,
          bicicletas: `/api/${config.api.version}/bicicletas`,
          aforoBicicletas: `/api/${config.api.version}/aforo-bicicletas`,
          aforoPeatones: `/api/${config.api.version}/aforo-peatones`,
          contenedores: `/api/${config.api.version}/contenedores`,
          admin: `/api/${config.api.version}/admin`,
          salud: `/api/${config.api.version}/health`,
        }
      },
      'La API REST de la Smart City Anthem esta operativa'
    )
  );
});

/**
 * @route   GET /api/v1/health
 * @desc    Health check detallado (solo administradores)
 * @access  Private (admin)
 *
 * Proporciona un estado de salud completo, incluyendo conectividad a base
 * de datos, recursos del sistema y dependencias. Requiere rol admin porque
 * expone informacion de tech stack (plataforma, version de Node, uso de
 * memoria) util para fingerprinting de atacantes. El healthcheck publico
 * vive en `GET /health` (server.js) y solo devuelve status + uptime.
 */
router.get('/health', authenticate, adminOnly, (req, res) => {
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
      healthData,
      `Estado de la API: ${healthData.status}`
    )
  );
});

/**
 * @route   GET /api/v1/cors-test
 * @desc    Endpoint de diagnostico CORS (solo en entornos no productivos)
 * @access  Public (gatedo por NODE_ENV)
 *
 * Endpoint para diagnosticar configuracion de CORS durante desarrollo.
 * En produccion devuelve 404 porque expone la lista de origenes permitidos,
 * que es informacion de configuracion util para un atacante.
 */
router.get('/cors-test', (req, res, next) => {
  if (config.server.env === 'production') {
    return next();
  }

  const origin = req.get('origin') || 'No origin header';

  res.status(HTTP_STATUS.OK).json(
    createResponse(
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
          ? 'El origen esta permitido por la politica CORS'
          : 'La peticion no tiene origin (probablemente mismo origen o cliente no-navegador)'
      },
      'Diagnostico de CORS completado'
    )
  );
});

// Mount authentication routes
router.use('/auth', authRoutes);

// Rutas de datos medioambientales
router.use('/calidad-aire', calidadAireRoutes);
router.use('/ruido', ruidoRoutes);

// Rutas de datos de ciudad
router.use('/multas', multaRoutes);
router.use('/censo', censoRoutes);
router.use('/ubicaciones', ubicacionesRoutes);
router.use('/trafico', traficoRoutes);
router.use('/accidentes', accidentRoutes);
router.use('/patinetes', scooterAssignmentRoutes);

// Mount mobility and infrastructure routes
router.use('/bicicletas', bikeAvailabilityRoutes);
router.use('/aforo-bicicletas', bikeTrafficCountRoutes);
router.use('/aforo-peatones', pedestrianTrafficCountRoutes);
router.use('/contenedores', contenedorRoutes);

// Mount administration routes
router.use('/admin', adminRoutes);

/**
 * Express 5 Compatibility Note:
 * Se ha eliminado el catch-all route ('*') porque Express 5 requiere nombres de parámetros explícitos
 * en los wildcards. El notFoundHandler global en server.js manejará todas las rutas 404.
 */

module.exports = router;
