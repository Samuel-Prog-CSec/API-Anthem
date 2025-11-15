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
const invalidateFineCache = (fineId = null, action = 'update') => {
  try {
    const cacheInstance = caches.statistics;

    // Invalidar caché general de multas
    const generalKeys = cacheInstance.keys().filter(key =>
      key.includes('/api/') && key.includes('fines')
    );

    generalKeys.forEach(key => cacheInstance.del(key));

    cacheLogger.info({
      resource: 'fines',
      fineId,
      action,
      keysInvalidated: generalKeys.length
    }, 'Caché de multas invalidado');

    return { success: true, keysInvalidated: generalKeys.length };

  } catch (error) {
    cacheLogger.error({
      error: error.message,
      resource: 'fines',
      fineId,
      action
    }, 'Error invalidando caché de multas');

    return { success: false, error: error.message };
  }
};

/**
 * Invalidar caché de tráfico
 * Se llama después de CREATE, UPDATE o DELETE de datos de tráfico
 *
 * @param {string} pointId - ID del punto de medición (opcional)
 * @param {string} action - Acción realizada
 */
const invalidateTrafficCache = (pointId = null, action = 'update') => {
  try {
    const cacheInstance = caches.traffic;

    // Invalidar caché de tráfico
    const trafficKeys = cacheInstance.keys().filter(key =>
      key.includes('/api/') && key.includes('traffic')
    );

    trafficKeys.forEach(key => cacheInstance.del(key));

    // Si hay un pointId específico, invalidar también Location cache relacionado
    if (pointId) {
      const locationCache = caches.static;
      const locationKeys = locationCache.keys().filter(key =>
        key.includes('locations') || key.includes(pointId)
      );
      locationKeys.forEach(key => locationCache.del(key));
    }

    cacheLogger.info({
      resource: 'traffic',
      pointId,
      action,
      keysInvalidated: trafficKeys.length
    }, 'Caché de tráfico invalidado');

    return { success: true, keysInvalidated: trafficKeys.length };

  } catch (error) {
    cacheLogger.error({
      error: error.message,
      resource: 'traffic',
      pointId,
      action
    }, 'Error invalidando caché de tráfico');

    return { success: false, error: error.message };
  }
};

/**
 * Invalidar caché de calidad del aire
 * Se llama después de CREATE, UPDATE o DELETE de datos de calidad del aire
 *
 * @param {string} stationId - ID de la estación (opcional)
 * @param {string} action - Acción realizada
 */
const invalidateAirQualityCache = (stationId = null, action = 'update') => {
  try {
    const cacheInstance = caches.airQuality;

    const airQualityKeys = cacheInstance.keys().filter(key =>
      key.includes('/api/') && key.includes('air-quality')
    );

    airQualityKeys.forEach(key => cacheInstance.del(key));

    cacheLogger.info({
      resource: 'airQuality',
      stationId,
      action,
      keysInvalidated: airQualityKeys.length
    }, 'Caché de calidad del aire invalidado');

    return { success: true, keysInvalidated: airQualityKeys.length };

  } catch (error) {
    cacheLogger.error({
      error: error.message,
      resource: 'airQuality',
      stationId,
      action
    }, 'Error invalidando caché de calidad del aire');

    return { success: false, error: error.message };
  }
};

/**
 * Invalidar caché de ruido
 * Se llama después de CREATE, UPDATE o DELETE de datos de contaminación acústica
 *
 * @param {string} stationId - ID de la estación (opcional)
 * @param {string} action - Acción realizada
 */
const invalidateNoiseCache = (stationId = null, action = 'update') => {
  try {
    const cacheInstance = caches.noise;

    const noiseKeys = cacheInstance.keys().filter(key =>
      key.includes('/api/') && key.includes('noise')
    );

    noiseKeys.forEach(key => cacheInstance.del(key));

    cacheLogger.info({
      resource: 'noise',
      stationId,
      action,
      keysInvalidated: noiseKeys.length
    }, 'Caché de ruido invalidado');

    return { success: true, keysInvalidated: noiseKeys.length };

  } catch (error) {
    cacheLogger.error({
      error: error.message,
      resource: 'noise',
      stationId,
      action
    }, 'Error invalidando caché de ruido');

    return { success: false, error: error.message };
  }
};

/**
 * Invalidar caché de bicicletas
 * Se llama después de CREATE, UPDATE o DELETE de datos de disponibilidad de bicicletas
 *
 * @param {Date} date - Fecha del registro (opcional)
 * @param {string} action - Acción realizada
 */
const invalidateBikeCache = (date = null, action = 'update') => {
  try {
    const cacheInstance = caches.bikes;

    const bikeKeys = cacheInstance.keys().filter(key =>
      key.includes('/api/') && key.includes('bike')
    );

    bikeKeys.forEach(key => cacheInstance.del(key));

    cacheLogger.info({
      resource: 'bikes',
      date,
      action,
      keysInvalidated: bikeKeys.length
    }, 'Caché de bicicletas invalidado');

    return { success: true, keysInvalidated: bikeKeys.length };

  } catch (error) {
    cacheLogger.error({
      error: error.message,
      resource: 'bikes',
      date,
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
const invalidateContainerCache = (containerId = null, action = 'update') => {
  try {
    const cacheInstance = caches.containers;

    const containerKeys = cacheInstance.keys().filter(key =>
      key.includes('/api/') && key.includes('container')
    );

    containerKeys.forEach(key => cacheInstance.del(key));

    cacheLogger.info({
      resource: 'containers',
      containerId,
      action,
      keysInvalidated: containerKeys.length
    }, 'Caché de contenedores invalidado');

    return { success: true, keysInvalidated: containerKeys.length };

  } catch (error) {
    cacheLogger.error({
      error: error.message,
      resource: 'containers',
      containerId,
      action
    }, 'Error invalidando caché de contenedores');

    return { success: false, error: error.message };
  }
};

/**
 * Invalidar caché de ubicaciones (locations)
 * Se llama después de CREATE, UPDATE o DELETE de ubicaciones
 *
 * @param {string} locationId - ID de la ubicación (opcional)
 * @param {string} action - Acción realizada
 */
const invalidateLocationCache = (locationId = null, action = 'update') => {
  try {
    const cacheInstance = caches.static;

    const locationKeys = cacheInstance.keys().filter(key =>
      key.includes('/api/') && key.includes('location')
    );

    locationKeys.forEach(key => cacheInstance.del(key));

    cacheLogger.info({
      resource: 'locations',
      locationId,
      action,
      keysInvalidated: locationKeys.length
    }, 'Caché de ubicaciones invalidado');

    return { success: true, keysInvalidated: locationKeys.length };

  } catch (error) {
    cacheLogger.error({
      error: error.message,
      resource: 'locations',
      locationId,
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
const invalidateCensusCache = (district = null, action = 'update') => {
  try {
    const cacheInstance = caches.demographic;

    const censusKeys = cacheInstance.keys().filter(key =>
      key.includes('/api/') && key.includes('census')
    );

    censusKeys.forEach(key => cacheInstance.del(key));

    cacheLogger.info({
      resource: 'census',
      district,
      action,
      keysInvalidated: censusKeys.length
    }, 'Caché demográfico invalidado');

    return { success: true, keysInvalidated: censusKeys.length };

  } catch (error) {
    cacheLogger.error({
      error: error.message,
      resource: 'census',
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
const invalidateAllCaches = (reason = 'manual-flush') => {
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
  invalidateFineCache,
  invalidateTrafficCache,
  invalidateAirQualityCache,
  invalidateNoiseCache,
  invalidateBikeCache,
  invalidateContainerCache,
  invalidateLocationCache,
  invalidateCensusCache,
  invalidateAllCaches
};
