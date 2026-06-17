/**
 * Utilidad de Invalidación de Caché
 *
 * Proporciona funciones para invalidar selectivamente el caché cuando se
 * realizan operaciones de escritura (POST, PUT, DELETE) sobre un recurso.
 *
 * NOTA: actualmente este modulo NO esta cableado a ningun controlador (la API
 * no expone escrituras de datos; el dataset es estatico entre reimportaciones).
 * Se mantiene listo para el dia que se anadan endpoints de escritura.
 *
 * Estrategia de invalidación:
 * - Cada recurso se mapea a la(s) instancia(s) de cache que utiliza y se vacian
 *   por completo (`flushAll`). Se prefiere esto al filtrado por substring de la
 *   URL porque las claves de cache mezclan dos formatos (URL espanola en el
 *   keygen por defecto y prefijos namespaced como `fines:list`, `traffic-...`,
 *   `census:`, `scooters:` en los keygen personalizados); un substring fijo no
 *   casaba con ambos y la invalidacion borraba CERO claves. Vaciar la instancia
 *   garantiza coherencia (a costa de re-popular en el siguiente MISS, aceptable
 *   en una invalidacion disparada por escritura).
 */

const { caches } = require('../middleware/cache');
const logger = require('../config/logger');
const { cacheLogger } = logger;

/**
 * Vacia una o varias instancias de cache por nombre y devuelve el total de
 * claves invalidadas. Ignora nombres de instancia inexistentes.
 *
 * @param {string[]} nombresInstancia - Tipos de cache a vaciar (claves de `caches`)
 * @returns {number} Numero total de claves invalidadas
 */
const vaciarInstancias = (nombresInstancia) => {
  let total = 0;
  nombresInstancia.forEach((nombre) => {
    const instancia = caches[nombre];
    if (!instancia) {
      return;
    }
    total += instancia.keys().length;
    instancia.flushAll();
  });
  return total;
};

/**
 * Construye un invalidador de recurso que vacia las instancias indicadas y
 * registra el resultado de forma homogenea.
 *
 * @param {string} resource - Nombre del recurso (para logging)
 * @param {string[]} instancias - Instancias de cache asociadas al recurso
 * @returns {function(string=, string=): {success: boolean, keysInvalidated?: number, error?: string}}
 */
const construirInvalidador = (resource, instancias) => (referenciaId = null, action = 'update') => {
  try {
    const keysInvalidated = vaciarInstancias(instancias);
    cacheLogger.info({ resource, referenciaId, action, instancias, keysInvalidated }, `Caché de ${resource} invalidado`);
    return { success: true, keysInvalidated };
  } catch (error) {
    cacheLogger.error({ error: error.message, resource, referenciaId, action }, `Error invalidando caché de ${resource}`);
    return { success: false, error: error.message };
  }
};

// Mapa recurso -> instancia(s) de cache que utiliza (ver routes/*.js).
const invalidarCacheMultas = construirInvalidador('multas', ['fines', 'statistics']);
const invalidarCacheTrafico = construirInvalidador('trafico', ['traffic']);
const invalidarCacheCalidadAire = construirInvalidador('calidad-aire', ['airQuality']);
const invalidarCacheRuido = construirInvalidador('ruido', ['noise']);
const invalidarCacheBicicletas = construirInvalidador('bicicletas', ['bikes']);
const invalidarCacheContenedores = construirInvalidador('contenedores', ['containers']);
const invalidarCacheUbicaciones = construirInvalidador('ubicaciones', ['static']);
const invalidarCacheCenso = construirInvalidador('censo', ['demographic']);

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
