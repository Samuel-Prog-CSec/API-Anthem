/**
 * Módulo de configuración de la base de datos
 *
 * Este módulo maneja la conexión a MongoDB utilizando Mongoose.
 * Implementa la lógica de reintento de conexión y manejo de errores.
 */

const mongoose = require('mongoose');

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
      // Configuraciones de optimización de conexión
      maxPoolSize: 20, // Número máximo de conexiones en el pool
      serverSelectionTimeoutMS: 5000, // Tiempo máximo para intentar conectar
      socketTimeoutMS: 60000, // Tiempo máximo que una conexión permanece abierta
    };

    // Conectar a MongoDB
    const conn = await mongoose.connect(uri, options);

    console.log(`MongoDB conectado: ${conn.connection.host}:${conn.connection.port}`);
    console.log(`Base de datos: ${conn.connection.name}`);

    // Listeners de eventos de conexión para monitoreo
    mongoose.connection.on('error', (err) => {
      console.error('Error de conexión a MongoDB:', err);
    });

    mongoose.connection.on('disconnected', () => {
      console.warn('MongoDB desconectado. Intentando reconectar...');
    });

    mongoose.connection.on('reconnected', () => {
      console.log('Reconexión a MongoDB exitosa');
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
    console.error('Fallo de conexión a la base de datos:', error.message);

    // Reintentar la conexión después de un retraso
    setTimeout(() => {
      console.log('Reintentando la conexión a la base de datos...');
      connectDB(uri);
    }, 5000);
  }
};

/**
 * Comprobar si la conexión a la base de datos está activa
 *
 * @returns {boolean} True si está conectado, False en caso contrario
 */
const isConnected = () => {
  return mongoose.connection.readyState === 1;
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
  isConnected,
  getConnectionStats
};
