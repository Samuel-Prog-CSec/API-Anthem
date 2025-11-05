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
    const options = {
      // Configuraciones optimizadas de conexión para alto rendimiento
      maxPoolSize: 50, // Número máximo de conexiones en el pool (aumentado de 20)
      minPoolSize: 10, // Número mínimo de conexiones mantenidas en el pool
      maxIdleTimeMS: 30000, // Tiempo máximo de inactividad antes de cerrar conexión (30s)
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

    // Manejo de cierre de la conexión al terminar la aplicación
    // NOTA: Comentado para evitar conflictos con scripts de importación
    // que manejan su propia lógica de cierre de conexión
    // process.on('SIGINT', async () => {
    //   await mongoose.connection.close();
    //   console.log('Conexión a MongoDB cerrada por terminación de la aplicación');
    //   process.exit(0);
    // });

  } catch (error) {
    dbLogger.error({
      error: error.message,
      stack: error.stack
    }, 'Fallo de conexión a la base de datos');

    // Reintentar la conexión después de un retraso
    setTimeout(() => {
      dbLogger.info('Reintentando la conexión a la base de datos...');
      connectDB(uri);
    }, 5000);
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
