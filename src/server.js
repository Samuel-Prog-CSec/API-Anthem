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
const http = require('http');

// Importar configuración y base de datos
// Force restart for env update
const { HTTP_STATUS } = require('./constants');
const config = require('./config/config');
const { connectDB, stopPoolMonitor } = require('./config/database');
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
  customSecurityHeaders,
  validateRequest,
  securityLogger
} = require('./middleware/security');

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
 * Importante para rate limiting y deteccion de IP detras de proxies inversos
 * Se confia unicamente en la lista declarada (loopback por defecto, override via TRUSTED_PROXIES)
 * para evitar IP spoofing por clientes maliciosos detras de proxies no controlados
 */
app.set('trust proxy', config.security.trustedProxies);

// Middleware de context y logging (debe ir al principio para registrar todo)
app.use(enrichRequestContext);
app.use(httpLoggerMiddleware);

/**
 * Deshabilitar header X-Powered-By
 * Mejora la seguridad evitando revelar la tecnologia del servidor
 */
app.disable('x-powered-by');

/**
 * Configuración de Middleware de Seguridad
 * Aplicado en orden de importancia para seguridad
 */

// Manejo de timeout de peticiones
app.use(timeoutHandler(config.api.timeout));

// Headers de seguridad y proteccion
app.use(helmetConfig);
app.use(customSecurityHeaders);

// Workaround para Express 5: `req.query` y `req.params` son inmutables por
// defecto. Tanto `validateRequest` (defensa HPP) como `sanitizeInput` y
// `xssProtection` necesitan poder MUTAR esos objetos. Por eso se aplica
// PRIMERO el workaround, no despues de validateRequest como antes (donde
// la mutacion fallaba en silencio y la defensa HPP no aplicaba).
app.use((req, res, next) => {
  if (req.query) {
    const mutableQuery = { ...req.query };
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

// IMPORTANTE: Validacion ANTES de sanitizacion
// La validacion rechaza datos invalidos sin alterarlos; si sanitizaramos primero
// podriamos alterar datos validos (ej. contrasenas con caracteres especiales).
app.use(validateRequest);

// Sanitizacion contra inyeccion NoSQL (despues de validar)
app.use(sanitizeInput);

// Proteccion XSS (escapar caracteres antes de procesamiento downstream)
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
 *
 * Limite reducido a 100KB porque la API actual no acepta uploads ni
 * payloads grandes (el payload mas grande legitimo es el registro de
 * usuario, <1KB). Reducir el limite reduce la superficie de DoS por
 * payload-bombing. Si en el futuro algun endpoint necesita mas tamano,
 * aplicar `express.json({ limit: '1mb' })` localmente solo a esa ruta.
 */
app.use(express.json({
  limit: '100kb',
  verify: (req, res, buf) => {
    // Almacenar body crudo para verificacion de firma de webhooks si es necesario
    req.rawBody = buf;
  }
}));

app.use(express.urlencoded({
  extended: true,
  limit: '100kb'
}));

/**
 * Parsing de cookies para tokens JWT en cookies
 * Opciones de seguridad configuradas en controladorAutenticacion (baseCookieOptions)
 */
app.use(cookieParser());

/**
 * Rutas de la API
 * Montar todas las rutas de API bajo /api/v1
 *
 * Nota: el logging (httpLoggerMiddleware + enrichRequestContext) y el
 * monitoreo de rendimiento (performanceMonitor) ya se aplican antes de
 * este punto (logging) o dentro de routes/index.js (performanceMonitor).
 * No duplicar aqui para evitar overhead (listeners y child loggers
 * triplicados por peticion).
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
 * Conecta a la base de datos e inicia el servidor HTTP
 */
const startServer = async () => {
  try {
    // Conectar a MongoDB
    logger.info('Conectando a MongoDB...');
    await connectDB(config.database.uri);

    // Precalentar caché en background (no bloquea arranque del servidor)
    warmupCacheAsync();

    const server = http.createServer(app);
    const port = config.server.port;

    // Configurar timeouts HTTP contra ataques Slowloris
    // Previene que atacantes mantengan conexiones abiertas indefinidamente
    server.headersTimeout = 60000; // 60s para recibir headers completos
    server.keepAliveTimeout = 65000; // 65s para conexiones keep-alive (mayor que ALB/nginx típico)
    server.requestTimeout = 30000; // 30s para completar una request

    // Iniciar servidor
    server.listen(port, config.server.host, () => {
      logger.info({
        environment: config.server.env,
        host: config.server.host,
        port: port,
        apiVersion: config.api.version,
        baseUrl: `http://${config.server.host}:${port}`,
        apiUrl: `http://${config.server.host}:${port}${config.api.prefix}/${config.api.version}`,
        healthCheck: `http://${config.server.host}:${port}/health`
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
          'Protección de Bloqueo de Cuenta'
        ]
      }, 'Funcionalidades de seguridad habilitadas');

      logger.info('Listo para aceptar conexiones');
    });

    // Manejo de apagado graceful
    const gracefulShutdown = (signal) => {
      logger.info({ signal }, 'Senal de apagado recibida, iniciando apagado graceful');

      // Detener el monitor del pool antes de cerrar la conexion a Mongo para
      // evitar que el setInterval intente consultar una conexion ya cerrada
      // y para que el event loop pueda drenarse correctamente
      stopPoolMonitor();

      server.close((err) => {
        if (err) {
          logger.error({ error: err.message }, 'Error cerrando servidor');
        } else {
          logger.info('Servidor cerrado');
        }

        // Cerrar conexion a base de datos
        require('mongoose').connection.close().then(() => {
          logger.info('Conexion a base de datos cerrada');
          logger.info('Apagado graceful completado');
          process.exit(0);
        });
      });

      // Forzar apagado despues de 30 segundos
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
