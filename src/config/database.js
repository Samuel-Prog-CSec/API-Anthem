/**
 * Módulo de configuración de la base de datos
 *
 * Este módulo maneja la conexión a MongoDB utilizando Mongoose.
 * Implementa la lógica de reintento de conexión y manejo de errores.
 */

const mongoose = require('mongoose');
const logger = require('./logger');
const { dbLogger } = logger;

// Handle del interval del monitor de pool, expuesto para que el graceful
// shutdown lo libere y no quede colgado tras cerrar la conexion a Mongo.
let poolMonitorIntervalId = null;

/**
 * Conectar a la base de datos MongoDB
 *
 * Establece la conexión a MongoDB con configuraciones optimizadas para producción.
 * Implementa la reconexión automática y el monitoreo de la conexión.
 *
 * @param {string} uri - Conexión URI de MongoDB
 * @returns {Promise<void>} Promise que se resuelve cuando está conectado
 * @throws {Error} Si la conexión falla después de reintentos
 */
const connectDB = async (uri) => {
  try {
    // GUARDA ANTI-DOCKER / ANTI-DUAL-STACK
    //
    // Historico: en Windows con MongoDB nativo y Docker simultaneos, usar
    // `localhost:27017` provocaba que la app conectase al contenedor (via
    // IPv6 ::1 -> port forwarding del runtime) mientras MongoDB Compass
    // (que usa 127.0.0.1) veia el nativo. Resultado: la app reportaba BD
    // vacia y los importadores rellenaban la base equivocada.
    //
    // Para evitar regresion, detectamos el patron y avisamos en arranque.
    // No abortamos para no romper despliegues legitimos donde `localhost`
    // o `host.docker.internal` SI sean correctos (Docker compose, K8s).
    if (/mongodb:\/\/(localhost|host\.docker\.internal)(:|\/)/i.test(uri)) {
      dbLogger.warn({
        uri: uri.replace(/\/\/[^@]+@/, '//<credentials>@'),
        recomendacion: 'Usar 127.0.0.1 en local para evitar conflictos IPv4/IPv6 con Docker'
      }, 'DATABASE_URI usa `localhost` o `host.docker.internal`. En desarrollo local sobre Windows esto puede acabar conectando al contenedor en vez del MongoDB nativo. Si es intencional ignorar este aviso.');
    }

    // Configuracion global de Mongoose antes de la conexion.
    // strictQuery: descarta campos no declarados en el schema en las queries
    // (.find, .updateOne, etc.). En Mongoose 7+ el default ya es true, pero
    // lo hacemos explicito para que sea obvio en code review y robusto frente
    // a cambios de default en futuras versiones.
    mongoose.set('strictQuery', true);

    const esScriptMode = process.env.SCRIPT_MODE === 'true';
    const options = {
      // Configuraciones optimizadas de conexión para alto rendimiento
      // Pool calibrado para servidor long-running OLTP con algo de OLAP
      // (estadisticas + endpoints /mapa). En scripts se amplia para soportar
      // 11 importadores en paralelo durante la fase 2.
      maxPoolSize: esScriptMode ? 50 : 20,
      minPoolSize: 5, // Pre-warm 5 conexiones para evitar latencia en arranque
      maxIdleTimeMS: 60000, // Reciclar conexiones inactivas tras 60s
      serverSelectionTimeoutMS: 5000, // Failover rapido si BD no responde
      socketTimeoutMS: 60000, // Permite agregaciones pesadas (mapas, stats)

      // Configuraciones adicionales de performance
      connectTimeoutMS: 10000, // Timeout de conexión inicial (10s)
      heartbeatFrequencyMS: 10000, // Frecuencia de heartbeat para detectar fallos (10s)

      // Comportamiento de buffering
      // bufferCommands=true (default Mongoose): si la conexion se cae, las
      // queries se encolan hasta que vuelve. En desarrollo es conveniente
      // para no romper hot-reload de nodemon durante reinicios de MongoDB.
      // En produccion preferimos fail-fast para evitar que la cola crezca
      // sin limites mientras MongoDB esta caido y los clients ya tienen
      // sus propios retries (peor experiencia: timeout en lugar de error).
      bufferCommands: process.env.NODE_ENV !== 'production',

      // Identificador de la aplicacion en logs/metrics de MongoDB.
      // Util cuando varios servicios apuntan al mismo cluster.
      appName: esScriptMode ? 'API-Anthem-scripts' : 'API-Anthem-server',
    };

    // Conectar a MongoDB
    const conn = await mongoose.connect(uri, options);

    dbLogger.info({
      host: conn.connection.host,
      port: conn.connection.port,
      database: conn.connection.name,
      poolSize: options.maxPoolSize,
      minPoolSize: options.minPoolSize
    }, 'MongoDB conectado exitosamente con pool optimizado');

    // Monitoreo periodico de estadisticas del pool de conexiones
    // Ejecuta cada 60 segundos para detectar saturacion o problemas de rendimiento
    poolMonitorIntervalId = setInterval(() => {
      const db = mongoose.connection.db;
      if (db && db.serverConfig) {
        try {
          const poolStats = db.serverConfig.s?.pool || {};
          const stats = {
            availableConnections: poolStats.availableConnections || 0,
            totalConnections: poolStats.totalConnections || 0,
            waitQueueSize: poolStats.waitQueueSize || 0,
            poolSize: options.maxPoolSize,
            minPoolSize: options.minPoolSize
          };

          // Log solo si hay conexiones activas o cola de espera
          if (stats.totalConnections > 0 || stats.waitQueueSize > 0) {
            dbLogger.debug(stats, 'Estadísticas del pool de conexiones MongoDB');

            // Alertas de saturación del pool
            if (stats.waitQueueSize > 5) {
              dbLogger.warn({
                ...stats,
                message: 'Cola de espera de conexiones elevada. Considerar aumentar maxPoolSize.'
              }, 'Pool de conexiones saturado');
            }

            if (stats.availableConnections === 0 && stats.totalConnections === options.maxPoolSize) {
              dbLogger.warn({
                ...stats,
                message: 'Pool de conexiones al máximo. Todas las conexiones en uso.'
              }, 'Pool de conexiones al límite');
            }
          }
        } catch (monitorError) {
          // Silenciar errores de monitoreo para no afectar la aplicación
          dbLogger.debug({ error: monitorError.message }, 'Error al obtener estadísticas del pool');
        }
      }
    }, 60000); // Cada 60 segundos

    // Listeners de eventos de conexión para monitoreo
    mongoose.connection.on('error', (err) => {
      dbLogger.error({ error: err.message }, 'Error de conexión a MongoDB');
    });

    mongoose.connection.on('disconnected', () => {
      dbLogger.warn('MongoDB desconectado. Intentando reconectar...');
    });

    mongoose.connection.on('reconnected', () => {
      dbLogger.info('Reconexión a MongoDB exitosa');
    });

  } catch (error) {
    dbLogger.error({
      error: error.message,
      stack: error.stack
    }, 'Fallo de conexión a la base de datos');

    // Solo reintentar si estamos en modo servidor (no en scripts)
    if (!process.env.SCRIPT_MODE) {
      setTimeout(() => {
        dbLogger.info('Reintentando la conexión a la base de datos...');
        connectDB(uri);
      }, 5000);
    } else {
      throw error;
    }
  }
};

/**
 * Obtener estadísticas de la conexión a la base de datos
 *
 * @returns {object} Objeto de estadísticas de conexión
 */
const getConnectionStats = () => {
  const connection = mongoose.connection;
  return {
    readyState: connection.readyState,
    host: connection.host,
    port: connection.port,
    name: connection.name,
    collections: Object.keys(connection.collections),
  };
};

/**
 * Detiene el interval del monitor de pool de conexiones.
 *
 * Debe llamarse durante el graceful shutdown para que el proceso pueda
 * terminar sin que el interval mantenga el event loop activo. Es seguro
 * llamarla varias veces o si el interval nunca se inicio.
 */
const stopPoolMonitor = () => {
  if (poolMonitorIntervalId) {
    clearInterval(poolMonitorIntervalId);
    poolMonitorIntervalId = null;
  }
};

module.exports = {
  connectDB,
  getConnectionStats,
  stopPoolMonitor
};
