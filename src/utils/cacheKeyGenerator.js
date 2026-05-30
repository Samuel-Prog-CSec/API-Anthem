/**
 * Generador de Claves de Caché Seguro
 *
 * Proporciona funciones para generar claves de caché determinísticas y seguras,
 * previniendo cache poisoning, colisiones y bypass de caché.
 *
 * Características:
 * - Ordenación alfabética de parámetros para determinismo
 * - Hash SHA-256 para prevenir manipulación
 * - Sanitización de valores
 * - Claves de longitud fija
 */

const crypto = require('crypto');

/**
 * Genera una clave de caché segura y determinística
 *
 * @param {string} method - Método HTTP (GET, POST, etc.)
 * @param {string} url - URL de la request (req.originalUrl)
 * @param {Object} query - Query parameters (req.query)
 * @returns {string} Clave de caché segura en formato method:url:hash
 *
 * @example
 * // Request: GET /api/traffic?fecha=2051-01-01&distrito=1
 * const key = generateSecureCacheKey('GET', '/api/traffic', { fecha: '2051-01-01', distrito: '1' });
 * // Resultado: "GET:/api/traffic:a1b2c3d4e5f6g7h8"
 */
const generateSecureCacheKey = (method, url, query = {}) => {
  // 1. Ordenar alfabéticamente las claves del query para determinismo
  const sortedQuery = {};
  Object.keys(query)
    .sort()
    .forEach(key => {
      const value = query[key];

      // 2. Sanitizar valores (convertir a string y trim)
      if (Array.isArray(value)) {
        // Para arrays, ordenar elementos y convertir a string
        sortedQuery[key] = value
          .map(v => String(v).trim())
          .sort()
          .join(',');
      } else if (value !== undefined && value !== null) {
        // Para valores simples, convertir a string
        sortedQuery[key] = String(value).trim();
      }
    });

  // 3. Crear string determinístico
  const queryString = JSON.stringify(sortedQuery);

  // 4. Generar hash SHA-256 para evitar claves muy largas y prevenir manipulación
  const hash = crypto
    .createHash('sha256')
    .update(`${method}:${url}:${queryString}`)
    .digest('hex')
    .substring(0, 16); // Primeros 16 caracteres del hash (64 bits)

  // 5. Clave final legible + hash
  return `${method}:${url}:${hash}`;
};

/**
 * Genera una clave de caché a partir de un objeto Request de Express
 *
 * @param {Object} req - Objeto request de Express
 * @returns {string} Clave de caché segura
 *
 * @example
 * const key = generateCacheKeyFromRequest(req);
 */
const generateCacheKeyFromRequest = (req) => {
  return generateSecureCacheKey(req.method, req.originalUrl, req.query);
};

/**
 * Genera una clave de caché para estadísticas con prefijo
 *
 * @param {string} url - URL de la request
 * @param {Object} query - Query parameters
 * @returns {string} Clave de caché con prefijo "stats_"
 *
 * @example
 * const key = generateStatsCacheKey('/api/census/dashboard', { año: 2051 });
 * // Resultado: "stats_/api/census/dashboard:a1b2c3d4e5f6g7h8"
 */
const generateStatsCacheKey = (url, query = {}) => {
  const hash = generateSecureCacheKey('GET', url, query).split(':')[2];
  return `stats_${url}:${hash}`;
};

/**
 * Genera una clave de caché determinista a partir de un prefijo descriptivo
 * (recurso + operacion) y la query de la request.
 *
 * Sustituye al antipatron `${prefijo}:${JSON.stringify(req.query)}` que se
 * usaba en las rutas: ese formato no es determinista (el orden de las
 * claves del query parseado puede variar) y produce misses de cache para
 * queries logicamente identicas. Internamente se usa la misma logica que
 * `generateSecureCacheKey` (sort alfabetico + hash SHA-256), garantizando
 * que `?a=1&b=2` y `?b=2&a=1` colisionen en la misma entrada.
 *
 * @param {string} prefix - Prefijo descriptivo, p.ej. `accidents:list`.
 * @param {Object} query - `req.query` de Express.
 * @returns {string} Clave en formato `${prefix}:${hash16}`.
 */
const generatePrefixedCacheKey = (prefix, query = {}) => {
  // BUG fix: `generateSecureCacheKey` devuelve `METHOD:URL:HASH`. Con
  // `.split(':')[2]` solo funcionaba si `prefix` no contenia `:`. Para
  // prefijos como `pedestrian:list`, `fines:list`, `censo:list`,
  // `accidentes:list` el split daba ['GET','pedestrian','list','HASH'] y
  // tomabamos `'list'` como hash, lo que hacia que **todas las querys
  // del mismo endpoint colisionaran en la misma clave de cache** y
  // devolvieran siempre la respuesta cacheada inicial (que el frontend
  // veia como `documentsPerPage:1` en paginacion porque la primera
  // llamada fue con `limit:1` del warming/dashboard counts).
  // El hash es el ultimo segmento, lo tomamos con `pop()`.
  const parts = generateSecureCacheKey('GET', prefix, query).split(':');
  const hash = parts[parts.length - 1];
  return `${prefix}:${hash}`;
};

/**
 * Valida si una clave de caché tiene el formato correcto
 *
 * @param {string} key - Clave de caché a validar
 * @returns {boolean} true si la clave es válida
 *
 * @example
 * isValidCacheKey('GET:/api/traffic:a1b2c3d4e5f6g7h8'); // true
 * isValidCacheKey('invalid-key'); // false
 */
const isValidCacheKey = (key) => {
  // Formato esperado: METHOD:URL:HASH (16 caracteres hexadecimales)
  const cacheKeyRegex = /^[A-Z]+:[^:]+:[a-f0-9]{16}$/;
  const statsCacheKeyRegex = /^stats_[^:]+:[a-f0-9]{16}$/;

  return cacheKeyRegex.test(key) || statsCacheKeyRegex.test(key);
};

module.exports = {
  generateSecureCacheKey,
  generateCacheKeyFromRequest,
  generateStatsCacheKey,
  generatePrefixedCacheKey,
  isValidCacheKey
};
