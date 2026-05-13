/**
 * Modulo de configuración de la aplicación
 *
 * Este módulo centraliza toda la configuración de variables de entorno
 * y proporciona validación para las variables de entorno requeridas.
 */

require('dotenv').config();

/**
 * Validar que todas las variables de entorno requeridas esten definidas
 *
 * @throws {Error} Si falta alguna variable de entorno requerida
 */
const validateEnvironment = () => {
  const required = [
    'DATABASE_URI',
    'JWT_SECRET',
    'JWT_REFRESH_SECRET'
  ];

  const missing = required.filter(key => !process.env[key]);

  if (missing.length > 0) {
    throw new Error(`[ERROR] Faltan variables de entorno requeridas: ${missing.join(', ')}`);
  }

  // Validar la fortaleza de JWT_SECRET y JWT_REFRESH_SECRET
  const MIN_JWT_SECRET_LENGTH = 32;
  if (process.env.JWT_SECRET.length < MIN_JWT_SECRET_LENGTH || process.env.JWT_REFRESH_SECRET.length < MIN_JWT_SECRET_LENGTH) {
    const errorMessage = `[CRITICAL SECURITY] JWT_SECRET debe tener al menos ${MIN_JWT_SECRET_LENGTH} caracteres para mayor seguridad`;

    // En produccion, detener el servidor
    if (process.env.NODE_ENV === 'production') {
      throw new Error(errorMessage);
    }

    // En desarrollo, solo advertir (usar console.warn porque logger aun no esta inicializado)
    // eslint-disable-next-line no-console
    console.warn(`[WARNING] ${errorMessage}`);
  }

  // SEGURIDAD CRITICA: el modo test concede rol admin a cualquier peticion
  // que envie la clave bypass. NUNCA debe estar activo en produccion: si
  // se filtra, es un backdoor de severidad maxima.
  if (process.env.TEST_MODE === 'true' && process.env.NODE_ENV === 'production') {
    throw new Error('[CRITICAL SECURITY] TEST_MODE no puede activarse cuando NODE_ENV=production');
  }
};

/**
 * Objeto de configuración de la aplicación
 * Contiene todos los valores de configuración con valores predeterminados
 */
const config = {
  // Configuración del servidor
  server: {
    port: parseInt(process.env.PORT, 10) || 3000,
    env: process.env.NODE_ENV || 'development',
    host: process.env.HOST || 'localhost'
  },

  // Configuración de la BD
  database: {
    uri: process.env.DATABASE_URI,
    options: {
      maxPoolSize: parseInt(process.env.DB_MAX_POOL_SIZE, 10) || 15,
      serverSelectionTimeoutMS: parseInt(process.env.DB_TIMEOUT, 10) || 5000,
    }
  },

  // Configuración de JWT
  jwt: {
    secret: process.env.JWT_SECRET,
    refreshSecret: process.env.JWT_REFRESH_SECRET,
    expiresIn: process.env.JWT_EXPIRE || '15m',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRE || '30d',
    algorithm: 'HS256', // Algoritmo recomendado para JWT por su balance entre seguridad y rendimiento
    issuer: 'api-rest-auth',
    audience: 'api-rest-auth-client'
  },

  // Configuración de seguridad
  security: {
    bcryptSaltRounds: parseInt(process.env.BCRYPT_SALT_ROUNDS, 10) || 12,
    rateLimitWindowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 15 * 60 * 1000, // 15 minutos
    rateLimitMaxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS, 10) || 100, // 100 solicitudes por ventana
    corsOrigins: process.env.CORS_ORIGINS ? process.env.CORS_ORIGINS.split(',') : ['http://localhost:3000'],
    // Lista de IPs/CIDR de proxies confiables. Evita IP spoofing detrás de proxies inversos
    // En desarrollo se confia en loopback; en produccion configurar via TRUSTED_PROXIES
    trustedProxies: process.env.TRUSTED_PROXIES
      ? process.env.TRUSTED_PROXIES.split(',').map(s => s.trim()).filter(Boolean)
      : ['127.0.0.1', '::1']
  },

  // Configuración de la API
  api: {
    version: 'v1',
    prefix: '/api',
    timeout: parseInt(process.env.API_TIMEOUT, 10) || 30000 // 30 segundos
  },

  // Configuracion de modo de pruebas (facilita desarrollo)
  //
  // SEGURIDAD: si TEST_MODE=true y TEST_BYPASS_KEY no esta definida en .env,
  // se genera una clave aleatoria cada arranque y se imprime en stdout. Asi
  // evitamos un default hardcoded que un atacante podria adivinar si el
  // operador olvida poner TEST_MODE=false en produccion.
  testMode: {
    enabled: process.env.TEST_MODE === 'true',
    bypassKey: process.env.TEST_BYPASS_KEY
      || (process.env.TEST_MODE === 'true'
        ? require('crypto').randomBytes(32).toString('hex')
        : null),
  }
};

// Validar la configuración al cargar el módulo
try {
  validateEnvironment();
  // eslint-disable-next-line no-console
  console.log(`[INFO] Configuración cargada para el entorno ${config.server.env}`);

  if (config.testMode.enabled) {
    // eslint-disable-next-line no-console
    console.warn(`[WARNING] MODO DE PRUEBAS HABILITADO: Seguridad relajada para desarrollo`);
    // eslint-disable-next-line no-console
    console.warn(`[TEST MODE] Clave bypass para esta sesion: ${config.testMode.bypassKey}`);
  }
} catch (error) {
  // eslint-disable-next-line no-console
  console.error(`[ERROR] Error de configuración: ${error.message}`);
  process.exit(1);
}

module.exports = config;
