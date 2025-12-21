/**
 * Aplicación Principal del Servidor
 *
 * Punto de entrada para la API REST profesional.
 * Configura el servidor Express con seguridad, middleware, rutas y manejo de errores.
 *
 */

const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const compression = require('compression');
const https = require('https');
const http = require('http');
const fs = require('fs');

// Importar configuración y base de datos
// Force restart for env update
const { HTTP_STATUS } = require('./constants');
const config = require('./config/config');
const { connectDB } = require('./config/database');
const { validateCorsOrigin } = require('./config/corsValidator');
const { warmupCacheAsync } = require('./config/cacheWarming');


// Importar logger Pino
const logger = require('./config/logger');
const { httpLoggerMiddleware, enrichRequestContext, errorLogger } = require('./middleware/requestLogger');

// Importar middleware
const {
  generalLimiter,
  helmetConfig,
  sanitizeInput,
  xssProtection,
  enforceHttps,
  customSecurityHeaders,
  validateRequest,
  securityLogger
} = require('./middleware/security');

const { performanceMonitor } = require('./middleware/performanceMonitor');

const {
  globalErrorHandler,
  notFoundHandler,
  handleUnhandledRejection,
  handleUncaughtException,
  timeoutHandler
} = require('./middleware/errorHandler');

// Importar rutas
const routes = require('./routes');

/**
 * Inicializar aplicación Express
 */
const app = express();

/**
 * Manejadores de excepciones globales
 * Deben configurarse antes que cualquier otro código
 */
handleUnhandledRejection();
handleUncaughtException();

/**
 * Configuración de trust proxy
 * Importante para rate limiting y detección de IP detrás de proxies inversos
 */
app.set('trust proxy', 1);

// Middleware de context y logging (debe ir al principio para registrar todo)
app.use(enrichRequestContext);
app.use(httpLoggerMiddleware);


// En producción, forzar HTTPS para evitar sniffing por HTTP
app.use(enforceHttps);

/**
 * Deshabilitar header X-Powered-By
 * Mejora la seguridad evitando revelar la tecnología del servidor
 */
app.disable('x-powered-by');

/**
 * Configuración de Middleware de Seguridad
 * Aplicado en orden de importancia para seguridad
 */

// Manejo de timeout de peticiones
app.use(timeoutHandler(config.api.timeout));

// Headers de seguridad y protección
app.use(helmetConfig);
app.use(customSecurityHeaders);

// IMPORTANTE: Validación ANTES de sanitización
// La validación debe ocurrir primero para rechazar datos inválidos sin alterarlos
// Si sanitizamos primero, podemos alterar datos válidos (ej: contraseñas con caracteres especiales)
app.use(validateRequest);

// Sanitización de entrada (prevenir inyección NoSQL)
// Workaround para Express 5: req.query es inmutable, creamos una copia mutable
app.use((req, res, next) => {
  if (req.query) {
    const mutableQuery = { ...req.query };
    // Redefinimos property para permitir modificación por sanitizers
    Object.defineProperty(req, 'query', {
      value: mutableQuery,
      writable: true,
      enumerable: true,
      configurable: true
    });
  }
  if (req.params) {
    const mutableParams = { ...req.params };
     Object.defineProperty(req, 'params', {
      value: mutableParams,
      writable: true,
      enumerable: true,
      configurable: true
    });
  }
  next();
});

// Se aplica DESPUÉS de validación para limpiar datos que ya pasaron las reglas de negocio
app.use(sanitizeInput);

// Protección XSS (prevenir Cross-Site Scripting)
// Se aplica al final para escapar caracteres antes de procesamiento
app.use(xssProtection);

/**
 * @route   GET /health
 * @desc    Endpoint de Health Check básico (ANTES del rate limiting)
 * @access  Public
 *
 * Endpoint de Health Check (ANTES del rate limiting)
 * Endpoint simple para health checks de balanceadores de carga
 * IMPORTANTE: Debe estar antes del rate limiter para evitar que los health checks
 * consuman las peticiones del límite de tasa y marquen falsamente el servicio como caído
 */
app.get('/health', (req, res) => {
  res.status(HTTP_STATUS.OK).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// Limitación de tasa
app.use(generalLimiter);

// Logging de seguridad
app.use(securityLogger);

/**
 * Configuración de CORS
 * Configurar compartición de recursos entre orígenes con controles de seguridad estrictos
 */
const corsOptions = {
  origin: validateCorsOrigin,

  // Permitir envío de cookies y credenciales (JWT en HttpOnly cookies)
  credentials: true,

  // Código de éxito para navegadores legacy (IE11)
  optionsSuccessStatus: 200,

  // Métodos HTTP permitidos (solo los necesarios)
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],

  // Headers que el cliente puede enviar
  allowedHeaders: [
    'Origin',
    'X-Requested-With',
    'Content-Type',
    'Accept',
    'Authorization',
    'X-Request-ID'
  ],

  // Headers que el cliente puede leer en la respuesta
  exposedHeaders: [
    'Content-Length',
    'Content-Type',
    'X-Request-ID',
    'X-RateLimit-Limit',
    'X-RateLimit-Remaining',
    'X-RateLimit-Reset'
  ],

  // Caché de preflight request (1 hora - reducido para mayor flexibilidad)
  maxAge: 3600,

  // Deshabilitar pass-through de CORS preflight al siguiente handler
  preflightContinue: false
};

// Aplicar CORS globalmente
app.use(cors(corsOptions));

/**
 * Middleware de Compresión
 * Comprime las respuestas HTTP con gzip/deflate para reducir ancho de banda
 * Impacto: Reduce respuestas típicas en 60-70% (500KB → 150KB)
 */
app.use(compression({
  level: 6, // Nivel de compresión balanceado (0-9, 6 es óptimo CPU vs tamaño)
  threshold: 1024, // Solo comprimir respuestas mayores a 1KB
  filter: (req, res) => {
    // No comprimir si el cliente lo solicita explícitamente
    if (req.headers['x-no-compression']) {
      return false;
    }
    // Usar el filtro por defecto de compression (verifica Content-Type)
    return compression.filter(req, res);
  }
}));

/**
 * Middleware para headers de caché CORS
 * Añade 'Vary: Origin, Access-Control-Request-Headers, Access-Control-Request-Method'
 * Esto es crítico para que CDNs y proxies cacheen correctamente las respuestas CORS
 */
app.use((req, res, next) => {
  // Vary: Origin indica que la respuesta varía según el origin de la petición
  // Esto evita que un CDN sirva una respuesta con headers CORS incorrectos
  const varyHeaders = ['Origin'];

  // Para preflight requests, también variar por los headers de solicitud CORS
  if (req.method === 'OPTIONS') {
    varyHeaders.push('Access-Control-Request-Headers', 'Access-Control-Request-Method');
  }

  res.setHeader('Vary', varyHeaders.join(', '));
  next();
});

/**
 * Middleware de Parsing de Body
 * Parsear cuerpos de peticiones entrantes
 */
app.use(express.json({
  limit: '10mb', // Limitar tamaño de payload JSON
  verify: (req, res, buf) => {
    // Almacenar body crudo para verificación de firma de webhooks si es necesario
    req.rawBody = buf;
  }
}));

app.use(express.urlencoded({
  extended: true,
  limit: '10mb'
}));

/**
 * Parsing de cookies para tokens JWT en cookies
 * Configuración con opciones de seguridad para CORS
 *
 * IMPORTANTE: En producción con CORS y credentials:
 * - httpOnly: true (previene acceso desde JavaScript)
 * - secure: true (solo envía cookie por HTTPS)
 * - sameSite: 'none' (permite cookies cross-origin con credentials: true)
 *
 * NOTA CRÍTICA: sameSite='none' requiere HTTPS obligatoriamente
 * Si no se usa HTTPS, los navegadores rechazarán la cookie
 */
app.use(cookieParser());

// Configurar opciones de cookies seguras para producción
if (config.server.env === 'production') {
  app.use((req, res, next) => {
    // Wrapper para res.cookie con opciones seguras por defecto
    const originalCookie = res.cookie.bind(res);
    res.cookie = (name, value, options = {}) => {
      return originalCookie(name, value, {
        httpOnly: true, // Previene XSS - cookie no accesible desde JS
        secure: true, // Solo HTTPS - obligatorio para sameSite='none'
        sameSite: 'none', // Permite CORS con credentials - requiere secure=true
        ...options
      });
    };
    next();
  });
}

/**
 * Middleware de Logging
 * Logging de peticiones HTTP con Pino
 */
app.use(httpLoggerMiddleware);
app.use(enrichRequestContext);

/**
 * Middleware de Monitoreo de Rendimiento
 * Rastrea tiempos de respuesta y registra peticiones lentas
 */
app.use(performanceMonitor);

/**
 * Rutas de la API
 * Montar todas las rutas de API bajo /api/v1
 */
app.use(config.api.prefix + '/' + config.api.version, routes);

/**
 * Endpoint raíz
 * Redirigir a documentación de la API
 */
app.get('/', (req, res) => {
  res.status(HTTP_STATUS.OK).json({
    success: true,
    message: 'Bienvenido a la API REST Profesional',
    version: config.api.version,
    endpoints: {
      health: '/health',
      api: `${config.api.prefix}/${config.api.version}`,
    }
  });
});

/**
 * Middleware de Manejo de Errores
 * Debe ser el último en la cadena de middleware
 */
app.use(errorLogger); // Registrar errores con Pino
app.use(notFoundHandler); // Manejar errores 404
app.use(globalErrorHandler); // Manejar todos los demás errores

/**
 * Función de Inicio del Servidor
 * Conecta a la base de datos e inicia el servidor HTTP/HTTPS
 *
 * Modos de operación:
 * - SSL_ENABLED=false: Solo HTTP (desarrollo)
 * - SSL_ENABLED=true: HTTPS + redirección HTTP opcional (producción)
 */
const startServer = async () => {
  try {
    // Conectar a MongoDB
    logger.info('Conectando a MongoDB...');
    await connectDB(config.database.uri);

    // Precalentar caché en background (no bloquea arranque del servidor)
    warmupCacheAsync();

    let server;
    let httpRedirectServer;
    const protocol = config.ssl.enabled ? 'https' : 'http';
    const port = config.ssl.enabled ? config.ssl.httpsPort : config.server.port;

    if (config.ssl.enabled) {
      // Modo HTTPS (producción)
      try {
        const sslOptions = {
          key: fs.readFileSync(config.ssl.keyPath),
          cert: fs.readFileSync(config.ssl.certPath)
        };

        // Crear servidor HTTPS
        server = https.createServer(sslOptions, app);

        // Opcional: Crear servidor HTTP que redirige a HTTPS
        if (config.ssl.redirectHttp) {
          const httpApp = express();
          httpApp.use((req, res) => {
            const httpsUrl = `https://${req.headers.host}${req.url}`;
            res.redirect(301, httpsUrl);
          });
          httpRedirectServer = http.createServer(httpApp);
          httpRedirectServer.listen(config.server.port, config.server.host, () => {
            logger.info({
              port: config.server.port,
              redirectsTo: `https://${config.server.host}:${config.ssl.httpsPort}`
            }, 'Servidor HTTP de redireccion iniciado');
          });
        }

        logger.info('Certificados SSL cargados correctamente');

      } catch (sslError) {
        logger.fatal({
          error: sslError.message,
          keyPath: config.ssl.keyPath,
          certPath: config.ssl.certPath
        }, 'Error al cargar certificados SSL');
        process.exit(1);
      }
    } else {
      // Modo HTTP (desarrollo)
      server = http.createServer(app);
      logger.warn('SSL deshabilitado - usando HTTP sin cifrar (solo para desarrollo)');
    }

    // Configurar timeouts HTTP contra ataques Slowloris
    // Previene que atacantes mantengan conexiones abiertas indefinidamente
    server.headersTimeout = 60000; // 60s para recibir headers completos
    server.keepAliveTimeout = 65000; // 65s para conexiones keep-alive (mayor que ALB/nginx típico)
    server.requestTimeout = 30000; // 30s para completar una request

    // Iniciar servidor principal
    server.listen(port, config.server.host, () => {
      logger.info({
        environment: config.server.env,
        host: config.server.host,
        port: port,
        protocol: protocol,
        sslEnabled: config.ssl.enabled,
        apiVersion: config.api.version,
        baseUrl: `${protocol}://${config.server.host}:${port}`,
        apiUrl: `${protocol}://${config.server.host}:${port}${config.api.prefix}/${config.api.version}`,
        healthCheck: `${protocol}://${config.server.host}:${port}/health`
      }, 'Servidor iniciado exitosamente');

      logger.info({
        features: [
          'Autenticación JWT',
          'Hashing de Contraseñas (bcrypt)',
          'Limitación de Tasa',
          'Validación de Entrada',
          'Prevención de Inyección NoSQL',
          'Protección XSS',
          'Headers de Seguridad (Helmet)',
          'Protección CORS',
          'Protección de Bloqueo de Cuenta',
          config.ssl.enabled ? 'Conexión HTTPS/TLS' : 'HTTP (sin cifrar)'
        ]
      }, 'Funcionalidades de seguridad habilitadas');

      logger.info('Listo para aceptar conexiones');
    });

    // Manejo de apagado graceful
    const gracefulShutdown = (signal) => {
      logger.info({ signal }, 'Señal de apagado recibida, iniciando apagado graceful');

      const closeServer = (srv, name) => {
        return new Promise((resolve) => {
          if (!srv) {
            logger.info(`${name} no encontrado, saltando cerrado`);
            return resolve();
          }
          srv.close((err) => {
            if (err) {
              logger.error({ error: err.message }, `Error cerrando ${name}`);
            } else {
              logger.info(`${name} cerrado`);
            }
            resolve();
          });
        });
      };

      Promise.all([
        closeServer(server, 'Servidor principal'),
        closeServer(httpRedirectServer, 'Servidor HTTP de redireccion')
      ]).then(() => {
        // Cerrar conexión a base de datos
        require('mongoose').connection.close().then(() => {
          logger.info('Conexión a base de datos cerrada');
          logger.info('Apagado graceful completado');
          process.exit(0);
        });
      });

      // Forzar apagado después de 30 segundos
      setTimeout(() => {
        logger.fatal('No se pudieron cerrar las conexiones a tiempo, apagando forzosamente');
        process.exit(1);
      }, 30000);
    };

    // Escuchar señales de apagado
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));

    return server;

  } catch (error) {
    logger.fatal({ error: error.message, stack: error.stack }, 'Fallo al iniciar el servidor');
    process.exit(1);
  }
};

// Iniciar el servidor si este archivo se ejecuta directamente
if (require.main === module) {
  startServer();
}

// Exportar app para propósitos de testing
module.exports = { app, startServer };
