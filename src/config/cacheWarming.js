/**
 * Módulo de Precalentamiento de Caché (Cache Warming)
 *
 * Precalienta el caché al iniciar el servidor con datos frecuentemente
 * accedidos para mejorar el rendimiento de las primeras peticiones.
 *
 * Estrategia:
 * - Cachear datos estáticos (ubicaciones, distritos)
 * - Cachear estadísticas recientes más consultadas
 * - Ejecutar en paralelo para minimizar tiempo de inicio
 * - Logging detallado del proceso
 */

const Location = require('../models/Location');
const Fine = require('../models/Fine');
const Traffic = require('../models/Traffic');
const AirQuality = require('../models/AirQuality');
const logger = require('./logger');
const { cacheLogger } = logger;

/**
 * Precalentar caché de ubicaciones
 * Datos estáticos que rara vez cambian
 */
const warmLocationCache = async () => {
  try {
    cacheLogger.info('Precalentando caché de ubicaciones...');

    // Cachear puntos de tráfico (más consultados)
    await Location.find({ tipo: 'punto_trafico' })
      .select('nombre coordenadas id_punto geometry')
      .limit(100)
      .maxTimeMS(5000)
      .lean();

    // Cachear estaciones acústicas
    await Location.find({ tipo: 'estacion_acustica' })
      .select('nombre coordenadas nmt geometry')
      .limit(50)
      .maxTimeMS(5000)
      .lean();

    cacheLogger.info('Caché de ubicaciones precalentado correctamente');
    return { success: true, resource: 'locations' };

  } catch (error) {
    cacheLogger.warn({
      error: error.message,
      resource: 'locations'
    }, 'Error precalentando caché de ubicaciones (no crítico)');

    return { success: false, resource: 'locations', error: error.message };
  }
};

/**
 * Precalentar caché de distritos
 * Usado frecuentemente en filtros y agrupaciones
 */
const warmDistrictCache = async () => {
  try {
    cacheLogger.info('Precalentando caché de distritos...');

    // Obtener lista de distritos únicos
    await Location.distinct('distrito').maxTimeMS(3000);

    cacheLogger.info('Caché de distritos precalentado correctamente');
    return { success: true, resource: 'districts' };

  } catch (error) {
    cacheLogger.warn({
      error: error.message,
      resource: 'districts'
    }, 'Error precalentando caché de distritos (no crítico)');

    return { success: false, resource: 'districts', error: error.message };
  }
};

/**
 * Precalentar caché de estadísticas recientes de multas
 * Dashboard principal - datos más consultados
 */
const warmFineStatsCache = async () => {
  try {
    cacheLogger.info('Precalentando caché de estadísticas de multas...');

    // Calcular fecha de hace 30 días
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    // Precalentar estadísticas básicas
    await Fine.aggregate([
      {
        $match: {
          fecha: { $gte: thirtyDaysAgo }
        }
      },
      { $limit: 10000 },
      {
        $group: {
          _id: null,
          totalMultas: { $sum: 1 },
          importeTotal: { $sum: '$importeFinal' }
        }
      }
    ])
      .maxTimeMS(5000)
      .exec();

    cacheLogger.info('Caché de estadísticas de multas precalentado correctamente');
    return { success: true, resource: 'fines-stats' };

  } catch (error) {
    cacheLogger.warn({
      error: error.message,
      resource: 'fines-stats'
    }, 'Error precalentando caché de estadísticas de multas (no crítico)');

    return { success: false, resource: 'fines-stats', error: error.message };
  }
};

/**
 * Precalentar caché de datos de tráfico recientes
 * Datos más consultados en dashboard
 */
const warmTrafficCache = async () => {
  try {
    cacheLogger.info('Precalentando caché de tráfico...');

    // Últimas mediciones (últimas 24 horas simuladas)
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);

    await Traffic.find({
      fecha: { $gte: yesterday }
    })
      .select('fecha puntoMedidaId metricas analisis')
      .limit(100)
      .maxTimeMS(5000)
      .lean();

    cacheLogger.info('Caché de tráfico precalentado correctamente');
    return { success: true, resource: 'traffic' };

  } catch (error) {
    cacheLogger.warn({
      error: error.message,
      resource: 'traffic'
    }, 'Error precalentando caché de tráfico (no crítico)');

    return { success: false, resource: 'traffic', error: error.message };
  }
};

/**
 * Precalentar caché de calidad del aire reciente
 * Dashboard ambiental - datos consultados frecuentemente
 */
const warmAirQualityCache = async () => {
  try {
    cacheLogger.info('Precalentando caché de calidad del aire...');

    // Últimas mediciones de magnitudes principales
    const recentDate = new Date();
    recentDate.setDate(recentDate.getDate() - 7);

    // SO2 (Dióxido de azufre) - magnitud 1
    // NO2 (Dióxido de nitrógeno) - magnitud 8
    // PM10 (Partículas < 10μm) - magnitud 10
    await AirQuality.find({
      fecha: { $gte: recentDate },
      magnitud: { $in: [1, 8, 10] }
    })
      .select('fecha estacion magnitud processingMetadata')
      .limit(100)
      .maxTimeMS(5000)
      .lean();

    cacheLogger.info('Caché de calidad del aire precalentado correctamente');
    return { success: true, resource: 'air-quality' };

  } catch (error) {
    cacheLogger.warn({
      error: error.message,
      resource: 'air-quality'
    }, 'Error precalentando caché de calidad del aire (no crítico)');

    return { success: false, resource: 'air-quality', error: error.message };
  }
};

/**
 * Función principal de precalentamiento de caché
 * Ejecuta todas las operaciones en paralelo
 *
 * @returns {Promise<object>} Resultado del precalentamiento
 */
const warmupCache = async () => {
  const startTime = Date.now();

  cacheLogger.info('==========================================');
  cacheLogger.info('Iniciando precalentamiento de caché...');
  cacheLogger.info('==========================================');

  try {
    // Ejecutar todas las operaciones de warmup en paralelo
    const results = await Promise.allSettled([
      warmLocationCache(),
      warmDistrictCache(),
      warmFineStatsCache(),
      warmTrafficCache(),
      warmAirQualityCache()
    ]);

    // Analizar resultados
    const successful = results.filter(r => r.status === 'fulfilled' && r.value.success).length;
    const failed = results.filter(r => r.status === 'rejected' || !r.value.success).length;

    const duration = Date.now() - startTime;

    cacheLogger.info('==========================================');
    cacheLogger.info({
      successful,
      failed,
      total: results.length,
      duration: `${duration}ms`
    }, 'Precalentamiento de caché completado');
    cacheLogger.info('==========================================');

    return {
      success: true,
      summary: {
        successful,
        failed,
        total: results.length,
        duration: `${duration}ms`
      },
      details: results.map((r, i) => ({
        index: i,
        status: r.status,
        ...(r.status === 'fulfilled' ? r.value : { error: r.reason?.message })
      }))
    };

  } catch (error) {
    const duration = Date.now() - startTime;

    cacheLogger.error({
      error: error.message,
      duration: `${duration}ms`
    }, 'Error crítico durante precalentamiento de caché');

    return {
      success: false,
      error: error.message,
      duration: `${duration}ms`
    };
  }
};

/**
 * Precalentar caché de forma opcional (no bloquea inicio del servidor)
 * Se recomienda usar esta función en producción para evitar delays en el arranque
 *
 * @returns {Promise<void>}
 */
const warmupCacheAsync = () => {
  // Ejecutar en background sin bloquear
  setImmediate(async () => {
    try {
      await warmupCache();
    } catch (error) {
      cacheLogger.error({
        error: error.message
      }, 'Error en precalentamiento asíncrono de caché (no crítico)');
    }
  });

  cacheLogger.info('Precalentamiento de caché iniciado en background');
};

module.exports = {
  warmupCache,
  warmupCacheAsync,
  warmLocationCache,
  warmDistrictCache,
  warmFineStatsCache,
  warmTrafficCache,
  warmAirQualityCache
};
