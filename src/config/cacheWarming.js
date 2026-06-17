/**
 * Módulo de Precalentamiento (Warm-up) al iniciar el servidor
 *
 * IMPORTANTE — alcance real: este modulo ejecuta las queries/agregaciones mas
 * habituales para calentar el WORKING SET de MongoDB (cache de WiredTiger en RAM
 * y plan cache del optimizador). NO puebla el cache HTTP de respuestas que vive
 * en `middleware/cache.js` (ese se indexa por hash de la request y solo se
 * escribe desde el propio `cacheMiddleware`). Por tanto la PRIMERA peticion a
 * cada endpoint sigue siendo un MISS de cache HTTP, pero la consulta subyacente
 * a Mongo ya encuentra las paginas calientes en memoria y responde mucho mas
 * rapido. El beneficio es de I/O de base de datos, no de cache de aplicacion.
 *
 * Estrategia:
 * - Tocar datos estáticos (ubicaciones, distritos) y las estadisticas mas
 *   consultadas para que sus indices/documentos queden en RAM.
 * - Ejecutar en background (no bloquea el arranque) y en paralelo.
 * - Logging detallado del proceso.
 */

const Location = require('../models/Ubicacion');
const Multa = require('../models/Multa');
const Traffic = require('../models/Trafico');
const AirQuality = require('../models/CalidadAire');
const Censo = require('../models/Censo');
const AsignacionPatinetes = require('../models/AsignacionPatinetes');
const Accidente = require('../models/Accidente');
const logger = require('./logger');
const { cacheLogger } = logger;
const { DATASET_YEARS } = require('../constants');

const MAX_RETRY_ATTEMPTS = 2;
const RETRY_DELAY_MS = 5000;

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
      .maxTimeMS(30000)
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
    await Location.distinct('distrito').maxTimeMS(15000);

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
    await Multa.aggregate([
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
      .option({ maxTimeMS: 30000 })
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
      .maxTimeMS(30000)
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
      .maxTimeMS(30000)
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
 * Precalentar caché de dashboard demográfico
 * Datos del censo consultados frecuentemente
 */
const warmCensusDashboardCache = async () => {
  try {
    cacheLogger.info('Precalentando caché de dashboard demográfico...');

    // Precalentar métricas generales del año por defecto del dataset
    await Censo.aggregate([
      { $match: { año: DATASET_YEARS.DEFAULT_YEAR } },
      {
        $group: {
          _id: null,
          poblacionTotal: { $sum: '$estadisticas.totalPoblacion' },
          totalEspañoles: { $sum: '$estadisticas.totalEspañoles' },
          totalExtranjeros: { $sum: '$estadisticas.totalExtranjeros' },
          distritosUnicos: { $addToSet: '$distrito.codigo' }
        }
      }
    ])
      .option({ allowDiskUse: true, maxTimeMS: 30000 });

    // Precalentar top 5 distritos por población
    await Censo.aggregate([
      { $match: { año: DATASET_YEARS.DEFAULT_YEAR } },
      {
        $group: {
          _id: {
            codigo: '$distrito.codigo',
            nombre: '$distrito.descripcion'
          },
          poblacionTotal: { $sum: '$estadisticas.totalPoblacion' }
        }
      },
      { $sort: { poblacionTotal: -1 } },
      { $limit: 5 }
    ])
      .option({ allowDiskUse: true, maxTimeMS: 30000 });

    cacheLogger.info('Caché de dashboard demográfico precalentado correctamente');
    return { success: true, resource: 'census-dashboard' };

  } catch (error) {
    cacheLogger.warn({
      error: error.message,
      resource: 'census-dashboard'
    }, 'Error precalentando caché de dashboard demográfico (no crítico)');

    return { success: false, resource: 'census-dashboard', error: error.message };
  }
};

/**
 * Precalentar caché de asignación de patinetes
 * Datos de patinetes eléctricos consultados frecuentemente
 */
const warmAsignacionPatinetesCache = async () => {
  try {
    cacheLogger.info('Precalentando caché de asignación de patinetes...');

    // Precalentar estadísticas generales de patinetes
    await AsignacionPatinetes.aggregate([
      {
        $group: {
          _id: null,
          totalPatinetes: { $sum: '$totalPatinetes' },
          proveedoresUnicos: { $addToSet: '$proveedor' },
          distritosUnicos: { $addToSet: '$distrito' }
        }
      }
    ])
      .option({ allowDiskUse: true, maxTimeMS: 30000 });

    // Precalentar top 5 distritos por densidad de patinetes
    await AsignacionPatinetes.aggregate([
      {
        $group: {
          _id: '$distrito',
          densidadPromedio: { $avg: '$densidad' },
          totalPatinetes: { $sum: '$totalPatinetes' }
        }
      },
      { $sort: { densidadPromedio: -1 } },
      { $limit: 5 }
    ])
      .option({ allowDiskUse: true, maxTimeMS: 30000 });

    cacheLogger.info('Caché de asignación de patinetes precalentado correctamente');
    return { success: true, resource: 'scooter-assignment' };

  } catch (error) {
    cacheLogger.warn({
      error: error.message,
      resource: 'scooter-assignment'
    }, 'Error precalentando caché de asignación de patinetes (no crítico)');

    return { success: false, resource: 'scooter-assignment', error: error.message };
  }
};

/**
 * Precalentar caché de accidentes recientes
 * Mejora la latencia inicial de los listados y estadísticas rápidas
 */
const warmAccidentRecentCache = async () => {
  try {
    cacheLogger.info('Precalentando caché de accidentes recientes...');

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    await Accidente.find({ fecha: { $gte: thirtyDaysAgo } })
      .select('numeroExpediente fecha hora ubicacion.nombreDistrito ubicacion.coordenadas analisis.puntuacionGravedad')
      .sort({ fecha: -1 })
      .limit(200)
      .maxTimeMS(30000)
      .lean();

    cacheLogger.info('Caché de accidentes recientes precalentado correctamente');
    return { success: true, resource: 'accidents-recent' };

  } catch (error) {
    cacheLogger.warn({
      error: error.message,
      resource: 'accidents-recent'
    }, 'Error precalentando caché de accidentes (no crítico)');

    return { success: false, resource: 'accidents-recent', error: error.message };
  }
};

const warmupTasks = [
  { name: 'locations', fn: warmLocationCache },
  { name: 'districts', fn: warmDistrictCache },
  { name: 'fines-stats', fn: warmFineStatsCache },
  { name: 'traffic', fn: warmTrafficCache },
  { name: 'air-quality', fn: warmAirQualityCache },
  { name: 'census-dashboard', fn: warmCensusDashboardCache },
  { name: 'scooter-assignment', fn: warmAsignacionPatinetesCache },
  { name: 'accidents-recent', fn: warmAccidentRecentCache }
];

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const runWarmTaskWithRetry = async (task) => {
  let attempt = 0;
  let lastError = null;

  while (attempt < MAX_RETRY_ATTEMPTS) {
    attempt += 1;
    try {
      const result = await task.fn();
      if (result?.success) {
        return { ...result, attempts: attempt };
      }
      lastError = new Error(result?.error || 'Warmup returned without exito');
    } catch (error) {
      lastError = error;
    }

    if (attempt < MAX_RETRY_ATTEMPTS) {
      cacheLogger.warn({ task: task.name, attempt, error: lastError?.message }, 'Cache warming fallido, reintentando...');
      await sleep(RETRY_DELAY_MS * attempt);
    }
  }

  return {
    success: false,
    resource: task.name,
    error: lastError?.message || 'Error desconocido en warmup',
    attempts: attempt
  };
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
    const results = await Promise.allSettled(
      warmupTasks.map(task => runWarmTaskWithRetry(task))
    );

    // Analizar resultados
    const fulfilled = results.filter(r => r.status === 'fulfilled').map(r => r.value);
    const successful = fulfilled.filter(r => r.success).length;
    const failed = warmupTasks.length - successful;

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
  warmAirQualityCache,
  warmCensusDashboardCache,
  warmAsignacionPatinetesCache,
  warmAccidentRecentCache
};
