/**
 * Utilidad de Invalidación de Caché
 *
 * Proporciona funciones para invalidar selectivamente el caché
 * cuando se realizan operaciones de escritura (POST, PUT, DELETE).
 *
 * Estrategia de invalidación:
 * - Invalidación selectiva por tipo de recurso
 * - Invalidación en cascada para recursos relacionados
 * - Logging de invalidaciones para auditoría
 */

const { caches } = require('../middleware/cache');
const logger = require('../config/logger');
const { cacheLogger } = logger;

/**
 * Invalidar caché de multas
 * Se llama después de CREATE, UPDATE o DELETE de multas
 *
 * @param {string} fineId - ID de la multa (opcional)
 * @param {string} action - Acción realizada: 'create', 'update', 'delete'
 */
const invalidarCacheMultas = (multaId = null, action = 'update') => {
  try {
    const cacheInstance = caches.statistics;

    // Invalidar caché general de multas
    const generalKeys = cacheInstance.keys().filter(key =>
      key.includes('/api/') && key.includes('multas')
    );

    generalKeys.forEach(key => cacheInstance.del(key));

    cacheLogger.info({
      resource: 'multas',
      multaId,
      action,
      keysInvalidated: generalKeys.length
    }, 'Caché de multas invalidado');

    return { success: true, keysInvalidated: generalKeys.length };

  } catch (error) {
    cacheLogger.error({
      error: error.message,
      resource: 'multas',
      multaId,
      action
    }, 'Error invalidando caché de multas');

    return { success: false, error: error.message };
  }
};

/**
 * Invalidar caché de tráfico
 * Se llama después de CREATE, UPDATE o DELETE de datos de tráfico
 *
 * @param {string} puntoId - ID del punto de medición (opcional)
 * @param {string} action - Acción realizada
 */
const invalidarCacheTrafico = (puntoId = null, action = 'update') => {
  try {
    const cacheInstance = caches.traffic;

    // Invalidar caché de tráfico
    const trafficKeys = cacheInstance.keys().filter(key =>
      key.includes('/api/') && key.includes('traffic')
    );

    trafficKeys.forEach(key => cacheInstance.del(key));

    // Si hay un puntoId específico, invalidar también Location cache relacionado
    if (puntoId) {
      const locationCache = caches.static;
      const locationKeys = locationCache.keys().filter(key =>
        key.includes('locations') || key.includes(puntoId)
      );
      locationKeys.forEach(key => locationCache.del(key));
    }

    cacheLogger.info({
      resource: 'trafico',
      puntoId,
      action,
      keysInvalidated: trafficKeys.length
    }, 'Caché de tráfico invalidado');

    return { success: true, keysInvalidated: trafficKeys.length };

  } catch (error) {
    cacheLogger.error({
      error: error.message,
      resource: 'trafico',
      puntoId,
      action
    }, 'Error invalidando caché de tráfico');

    return { success: false, error: error.message };
  }
};

/**
 * Invalidar caché de calidad del aire
 * Se llama después de CREATE, UPDATE o DELETE de datos de calidad del aire
 *
 * @param {string} estacionId - ID de la estación (opcional)
 * @param {string} action - Acción realizada
 */
const invalidarCacheCalidadAire = (estacionId = null, action = 'update') => {
  try {
    const cacheInstance = caches.airQuality;

    const airQualityKeys = cacheInstance.keys().filter(key =>
      key.includes('/api/') && key.includes('air-quality')
    );

    airQualityKeys.forEach(key => cacheInstance.del(key));

    cacheLogger.info({
      resource: 'calidad-aire',
      estacionId,
      action,
      keysInvalidated: airQualityKeys.length
    }, 'Caché de calidad del aire invalidado');

    return { success: true, keysInvalidated: airQualityKeys.length };

  } catch (error) {
    cacheLogger.error({
      error: error.message,
      resource: 'calidad-aire',
      estacionId,
      action
    }, 'Error invalidando caché de calidad del aire');

    return { success: false, error: error.message };
  }
};

/**
 * Invalidar caché de ruido
 * Se llama después de CREATE, UPDATE o DELETE de datos de contaminación acústica
 *
 * @param {string} estacionId - ID de la estación (opcional)
 * @param {string} action - Acción realizada
 */
const invalidarCacheRuido = (estacionId = null, action = 'update') => {
  try {
    const cacheInstance = caches.noise;

    const noiseKeys = cacheInstance.keys().filter(key =>
      key.includes('/api/') && key.includes('noise')
    );

    noiseKeys.forEach(key => cacheInstance.del(key));

    cacheLogger.info({
      resource: 'ruido',
      estacionId,
      action,
      keysInvalidated: noiseKeys.length
    }, 'Caché de ruido invalidado');

    return { success: true, keysInvalidated: noiseKeys.length };

  } catch (error) {
    cacheLogger.error({
      error: error.message,
      resource: 'ruido',
      estacionId,
      action
    }, 'Error invalidando caché de ruido');

    return { success: false, error: error.message };
  }
};

/**
 * Invalidar caché de bicicletas
 * Se llama después de CREATE, UPDATE o DELETE de datos de disponibilidad de bicicletas
 *
 * @param {Date} fecha - Fecha del registro (opcional)
 * @param {string} action - Acción realizada
 */
const invalidarCacheBicicletas = (fecha = null, action = 'update') => {
  try {
    const cacheInstance = caches.bikes;

    const bikeKeys = cacheInstance.keys().filter(key =>
      key.includes('/api/') && key.includes('bike')
    );

    bikeKeys.forEach(key => cacheInstance.del(key));

    cacheLogger.info({
      resource: 'bicicletas',
      fecha,
      action,
      keysInvalidated: bikeKeys.length
    }, 'Caché de bicicletas invalidado');

    return { success: true, keysInvalidated: bikeKeys.length };

  } catch (error) {
    cacheLogger.error({
      error: error.message,
      resource: 'bicicletas',
      fecha,
      action
    }, 'Error invalidando caché de bicicletas');

    return { success: false, error: error.message };
  }
};

/**
 * Invalidar caché de contenedores
 * Se llama después de CREATE, UPDATE o DELETE de contenedores
 *
 * @param {string} containerId - ID del contenedor (opcional)
 * @param {string} action - Acción realizada
 */
const invalidarCacheContenedores = (contenedorId = null, action = 'update') => {
  try {
    const cacheInstance = caches.containers;

    const contenedorKeys = cacheInstance.keys().filter(key =>
      key.includes('/api/') && key.includes('contenedores')
    );

    contenedorKeys.forEach(key => cacheInstance.del(key));

    cacheLogger.info({
      resource: 'contenedores',
      contenedorId,
      action,
      keysInvalidated: contenedorKeys.length
    }, 'Caché de contenedores invalidado');

    return { success: true, keysInvalidated: contenedorKeys.length };

  } catch (error) {
    cacheLogger.error({
      error: error.message,
      resource: 'contenedores',
      contenedorId,
      action
    }, 'Error invalidando caché de contenedores');

    return { success: false, error: error.message };
  }
};

/**
 * Invalidar caché de ubicaciones
 * Se llama después de CREATE, UPDATE o DELETE de ubicaciones
 *
 * @param {string} ubicacionId - ID de la ubicación (opcional)
 * @param {string} action - Acción realizada
 */
const invalidarCacheUbicaciones = (ubicacionId = null, action = 'update') => {
  try {
    const cacheInstance = caches.static;

    const locationKeys = cacheInstance.keys().filter(key =>
      key.includes('/api/') && key.includes('location')
    );

    locationKeys.forEach(key => cacheInstance.del(key));

    cacheLogger.info({
      resource: 'ubicaciones',
      ubicacionId,
      action,
      keysInvalidated: locationKeys.length
    }, 'Caché de ubicaciones invalidado');

    return { success: true, keysInvalidated: locationKeys.length };

  } catch (error) {
    cacheLogger.error({
      error: error.message,
      resource: 'ubicaciones',
      ubicacionId,
      action
    }, 'Error invalidando caché de ubicaciones');

    return { success: false, error: error.message };
  }
};

/**
 * Invalidar caché demográfico (censo)
 * Se llama después de CREATE, UPDATE o DELETE de datos del censo
 *
 * @param {string} district - Nombre del distrito (opcional)
 * @param {string} action - Acción realizada
 */
const invalidarCacheCenso = (district = null, action = 'update') => {
  try {
    const cacheInstance = caches.demographic;

    const censoKeys = cacheInstance.keys().filter(key =>
      key.includes('/api/') && key.includes('censo')
    );

    censoKeys.forEach(key => cacheInstance.del(key));

    cacheLogger.info({
      resource: 'censo',
      district,
      action,
      keysInvalidated: censoKeys.length
    }, 'Caché demográfico invalidado');

    return { success: true, keysInvalidated: censoKeys.length };

  } catch (error) {
    cacheLogger.error({
      error: error.message,
      resource: 'censo',
      district,
      action
    }, 'Error invalidando caché demográfico');

    return { success: false, error: error.message };
  }
};

/**
 * Invalidar todo el caché (usar con precaución)
 * Se llama en casos extremos o después de cambios masivos
 *
 * @param {string} reason - Razón de la invalidación completa
 */
const invalidarTodosLosCaches = (reason = 'manual-flush') => {
  try {
    const results = {};

    Object.keys(caches).forEach(cacheType => {
      const cacheInstance = caches[cacheType];
      const keyCount = cacheInstance.keys().length;
      cacheInstance.flushAll();
      results[cacheType] = keyCount;
    });

    const totalKeys = Object.values(results).reduce((sum, count) => sum + count, 0);

    cacheLogger.warn({
      reason,
      cacheTypes: Object.keys(results),
      totalKeysInvalidated: totalKeys,
      details: results
    }, 'Todos los cachés invalidados');

    return { success: true, totalKeysInvalidated: totalKeys, details: results };

  } catch (error) {
    cacheLogger.error({
      error: error.message,
      reason
    }, 'Error invalidando todos los cachés');

    return { success: false, error: error.message };
  }
};

module.exports = {
  invalidarCacheMultas,
  invalidarCacheTrafico,
  invalidarCacheCalidadAire,
  invalidarCacheRuido,
  invalidarCacheBicicletas,
  invalidarCacheContenedores,
  invalidarCacheUbicaciones,
  invalidarCacheCenso,
  invalidarTodosLosCaches
};
