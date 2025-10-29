/**
 * Main Server Application
 *
 * Entry point for the Professional REST API.
 * Configures Express server with security, middleware, routes, and error handling.
 *
 */

const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');

// Import configuration and database
const config = require('./config/config');
const { connectDB } = require('./config/database');

// Import Pino logger
const logger = require('./config/logger');
const { httpLoggerMiddleware, enrichRequestContext, errorLogger } = require('./middleware/requestLogger');

// Import middleware
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

// Import routes
const routes = require('./routes');

/**
 * Initialize Express application
 */
const app = express();

/**
 * Global exception handlers
 * Must be set up before any other code
 */
handleUnhandledRejection();
handleUncaughtException();

/**
 * Trust proxy settings
 * Important for rate limiting and IP detection behind reverse proxies
 */
app.set('trust proxy', 1);

/**
 * Security Middleware Configuration
 * Applied in order of importance for security
 */

// Request timeout handling
app.use(timeoutHandler(config.api.timeout));

// Security headers and protection
app.use(helmetConfig);
app.use(customSecurityHeaders);

// Input sanitization (prevent NoSQL injection)
app.use(sanitizeInput);

// XSS Protection (prevent Cross-Site Scripting)
app.use(xssProtection);

// Request validation and size limits
app.use(validateRequest);

// Rate limiting
app.use(generalLimiter);

// Security logging
app.use(securityLogger);

/**
 * CORS Configuration
 * Configure cross-origin resource sharing
 */
const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (mobile apps, Postman, etc.)
    if (!origin) {return callback(null, true);}

    // Check if origin is allowed
    if (config.security.corsOrigins.includes(origin) ||
        config.security.corsOrigins.includes('*')) {
      return callback(null, true);
    }

    // Log blocked CORS request
    logger.warn({ origin }, 'CORS blocked request from origin');
    callback(new Error('Not allowed by CORS'));
  },
  credentials: true, // Allow cookies
  optionsSuccessStatus: 200, // For legacy browser support
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: [
    'Origin',
    'X-Requested-With',
    'Content-Type',
    'Accept',
    'Authorization',
    'Cache-Control',
    'X-API-Key'
  ]
};

app.use(cors(corsOptions));

/**
 * Body Parsing Middleware
 * Parse incoming request bodies
 */
app.use(express.json({
  limit: '10mb', // Limit JSON payload size
  verify: (req, res, buf) => {
    // Store raw body for webhook signature verification if needed
    req.rawBody = buf;
  }
}));

app.use(express.urlencoded({
  extended: true,
  limit: '10mb'
}));

// Cookie parsing for JWT tokens in cookies
app.use(cookieParser());

/**
 * Logging Middleware
 * HTTP request logging with Pino
 */
app.use(httpLoggerMiddleware);
app.use(enrichRequestContext);

/**
 * Health Check Endpoint (before rate limiting)
 * Simple endpoint for load balancer health checks
 */
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

/**
 * API Routes
 * Mount all API routes under /api/v1
 */
app.use(config.api.prefix + '/' + config.api.version, routes);

/**
 * Root endpoint
 * Redirect to API documentation
 */
app.get('/', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'Welcome to Professional REST API',
    version: config.api.version,
    documentation: `${req.protocol}://${req.get('host')}${config.api.prefix}/${config.api.version}/docs`,
    endpoints: {
      health: '/health',
      api: `${config.api.prefix}/${config.api.version}`,
      docs: `${config.api.prefix}/${config.api.version}/docs`
    }
  });
});

/**
 * Error Handling Middleware
 * Must be last in the middleware chain
 */
app.use(errorLogger);       // Log errors with Pino
app.use(notFoundHandler);   // Handle 404 errors
app.use(globalErrorHandler); // Handle all other errors

/**
 * Start Server Function
 * Connects to database and starts the HTTP server
 */
const startServer = async () => {
  try {
    // Connect to MongoDB
    logger.info('Connecting to MongoDB...');
    await connectDB(config.database.uri);

    // Start HTTP server
    const server = app.listen(config.server.port, config.server.host, () => {
      logger.info({
        environment: config.server.env,
        host: config.server.host,
        port: config.server.port,
        apiVersion: config.api.version,
        baseUrl: `http://${config.server.host}:${config.server.port}`,
        apiUrl: `http://${config.server.host}:${config.server.port}${config.api.prefix}/${config.api.version}`,
        healthCheck: `http://${config.server.host}:${config.server.port}/health`
      }, 'Server started successfully');

      logger.info({
        features: [
          'JWT Authentication',
          'Password Hashing (bcrypt)',
          'Rate Limiting',
          'Input Validation',
          'NoSQL Injection Prevention',
          'XSS Protection',
          'Security Headers (Helmet)',
          'CORS Protection',
          'Account Lockout Protection'
        ]
      }, 'Security features enabled');

      logger.info('Ready to accept connections');
    });

    // Graceful shutdown handling
    const gracefulShutdown = (signal) => {
      logger.info({ signal }, 'Received shutdown signal, starting graceful shutdown');

      server.close((err) => {
        if (err) {
          logger.error({ error: err.message }, 'Error during server shutdown');
          process.exit(1);
        }

        logger.info('HTTP server closed');

        // Close database connection
        require('mongoose').connection.close().then(() => {
          logger.info('Database connection closed');
          logger.info('Graceful shutdown completed');
          process.exit(0);
        });
      });

      // Force shutdown after 30 seconds
      setTimeout(() => {
        logger.fatal('Could not close connections in time, forcefully shutting down');
        process.exit(1);
      }, 30000);
    };

    // Listen for shutdown signals
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));

    return server;

  } catch (error) {
    logger.fatal({ error: error.message, stack: error.stack }, 'Failed to start server');
    process.exit(1);
  }
};

// Start the server if this file is run directly
if (require.main === module) {
  startServer();
}

// Export app for testing purposes
module.exports = { app, startServer };
