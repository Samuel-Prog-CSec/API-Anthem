/**
 * Modulo de configuración de la aplicación
 *
 * Este módulo centraliza toda la configuración de variables de entorno
 * y proporciona validación para las variables de entorno requeridas.
 */

require('dotenv').config();

/**
 * Validar que todas las variables de entorno requeridas estén definidas
 *
 * @throws {Error} Si falta alguna variable de entorno requerida
 */
const validateEnvironment = () => {
  const required = [
    'DATABASE_URI',
    'JWT_SECRET'
  ];

  const missing = required.filter(key => !process.env[key]);

  if (missing.length > 0) {
    throw new Error(`Faltan variables de entorno requeridas: ${missing.join(', ')}`);
  }

  // Validar la fortaleza de JWT_SECRET
  if (process.env.JWT_SECRET.length < 32) {
    // eslint-disable-next-line no-console
    console.warn('Advertencia: JWT_SECRET debe tener al menos 32 caracteres para mayor seguridad');
  }
};

/**
 * Objeto de configuración de la aplicación
 * Contiene todos los valores de configuración con valores predeterminados
 */
const config = {
  // Configuración del servidor
  server: {
    port: parseInt(process.env.PORT) || 3000,
    env: process.env.NODE_ENV || 'development',
    host: process.env.HOST || 'localhost'
  },

  // Configuración de la BD
  database: {
    uri: process.env.DATABASE_URI,
    options: {
      maxPoolSize: parseInt(process.env.DB_MAX_POOL_SIZE) || 15,
      serverSelectionTimeoutMS: parseInt(process.env.DB_TIMEOUT) || 5000,
    }
  },

  // Configuración de JWT
  jwt: {
    secret: process.env.JWT_SECRET,
    expiresIn: process.env.JWT_EXPIRE || '15m',
    algorithm: 'HS256' // Algoritmo recomendado para JWT por su balance entre seguridad y rendimiento
  },

  // Configuración de seguridad
  security: {
    bcryptSaltRounds: parseInt(process.env.BCRYPT_SALT_ROUNDS) || 12,
    rateLimitWindowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000, // 15 minutos
    rateLimitMaxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100, // 100 solicitudes por ventana
    corsOrigins: process.env.CORS_ORIGINS ? process.env.CORS_ORIGINS.split(',') : ['http://localhost:3000'],
  },

  // Configuración de la API
  api: {
    version: 'v1.0',
    prefix: '/api',
    timeout: parseInt(process.env.API_TIMEOUT) || 30000 // 30 segundos
  }
};

// Validar la configuración al cargar el módulo
try {
  validateEnvironment();
  // eslint-disable-next-line no-console
  console.log(`Configuración cargada para el entorno ${config.server.env}`);
} catch (error) {
  // eslint-disable-next-line no-console
  console.error('Error de configuración:', error.message);
  process.exit(1);
}

module.exports = config;
