/**
 * Módulo de configuración de la base de datos
 *
 * Este módulo maneja la conexión a MongoDB utilizando Mongoose.
 * Implementa la lógica de reintento de conexión y manejo de errores.
 */

const mongoose = require('mongoose');
const logger = require('./logger');
const { dbLogger } = logger;

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
    const esScriptMode = process.env.SCRIPT_MODE === 'true';
    const options = {
      // Configuraciones optimizadas de conexión para alto rendimiento
      maxPoolSize: esScriptMode ? 50 : 20, // Mas slots paralelos durante imports masivos
      minPoolSize: 5, // Mantener algunas conexiones calientes
      maxIdleTimeMS: 60000, // Mantener conexiones inactivas hasta 60s
      serverSelectionTimeoutMS: 5000, // Tiempo máximo para intentar conectar
      socketTimeoutMS: 60000, // Tiempo máximo que una conexión permanece abierta

      // Configuraciones adicionales de performance
      connectTimeoutMS: 10000, // Timeout de conexión inicial (10s)
      heartbeatFrequencyMS: 10000, // Frecuencia de heartbeat para detectar fallos (10s)
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

    // Monitoreo periódico de estadísticas del pool de conexiones
    // Ejecuta cada 60 segundos para detectar saturación o problemas de rendimiento
    setInterval(() => {
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

module.exports = {
  connectDB,
  getConnectionStats
};
