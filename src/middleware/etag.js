/**
 * Middleware de ETags para Validación de Caché HTTP
 *
 * Implementa el estándar HTTP ETag para validación de caché en el cliente.
 * Permite que los clientes validen si sus recursos cacheados siguen siendo válidos
 * sin necesidad de descargar el contenido completo nuevamente (respuesta 304 Not Modified).
 *
 * Beneficios:
 * - Reduce ancho de banda (304 responses son ~200 bytes vs KB/MB de datos)
 * - Mejora performance del cliente (validación vs descarga completa)
 * - Compatible con todos los navegadores y clientes HTTP modernos
 * - Funciona en conjunto con caché del servidor (node-cache)
 *
 * @see https://developer.mozilla.org/es/docs/Web/HTTP/Headers/ETag
 * @see https://developer.mozilla.org/es/docs/Web/HTTP/Status/304
 */

const crypto = require('crypto');
const logger = require('../config/logger');
const { cacheLogger } = logger;

/**
 * Generar ETag basado en el contenido de la respuesta
 * Usa MD5 hash para generar un identificador único del contenido
 *
 * @param {*} data - Datos de la respuesta (objeto, array, string)
 * @returns {string} ETag hash en formato hexadecimal
 */
const generateETag = (data) => {
  try {
    // Convertir datos a string JSON si es objeto
    const content = typeof data === 'string' ? data : JSON.stringify(data);

    // Generar hash MD5 (suficiente para ETags, no se requiere seguridad criptográfica)
    const hash = crypto
      .createHash('md5')
      .update(content)
      .digest('hex');

    // Formato estándar de ETag: "hash" (con comillas)
    return `"${hash}"`;

  } catch (error) {
    cacheLogger.error({
      error: error.message
    }, 'Error generando ETag');

    // Retornar ETag genérico basado en timestamp si falla
    return `"${Date.now()}"`;
  }
};

/**
 * Middleware principal de ETags
 * Intercepta la respuesta JSON para añadir header ETag y manejar validación
 *
 * Flujo:
 * 1. Intercepta res.json()
 * 2. Genera ETag del contenido
 * 3. Compara con ETag del cliente (If-None-Match)
 * 4. Si coinciden: 304 Not Modified (sin body)
 * 5. Si no coinciden: 200 OK con nuevo ETag y contenido completo
 *
 * @param {object} req - Request de Express
 * @param {object} res - Response de Express
 * @param {Function} next - Next middleware
 */
const etagMiddleware = (req, res, next) => {
  // Guardar referencia al método original res.json
  const originalJson = res.json.bind(res);

  // Sobrescribir res.json para añadir lógica de ETag
  res.json = function(data) {
    // Generar ETag del contenido
    const etag = generateETag(data);

    // Añadir header ETag a la respuesta
    res.set('ETag', etag);

    // Obtener ETag del cliente (header If-None-Match)
    const clientETag = req.headers['if-none-match'];

    // Validación de caché: comparar ETags
    if (clientETag && clientETag === etag) {
      // ETags coinciden: contenido no ha cambiado
      // Retornar 304 Not Modified sin body

      cacheLogger.debug({
        method: req.method,
        url: req.originalUrl,
        clientETag,
        serverETag: etag,
        status: 304
      }, 'ETag válido - 304 Not Modified');

      // Añadir headers informativos
      res.set('X-Cache-Validation', 'HIT');

      // Enviar 304 sin contenido
      return res.status(304).end();
    }

    // ETags NO coinciden o cliente no envió ETag: enviar contenido completo
    cacheLogger.debug({
      method: req.method,
      url: req.originalUrl,
      clientETag: clientETag || 'none',
      serverETag: etag,
      status: 200,
      reason: clientETag ? 'etag-mismatch' : 'no-client-etag'
    }, 'ETag nuevo - 200 OK con contenido');

    // Añadir headers informativos
    res.set('X-Cache-Validation', clientETag ? 'MISS' : 'NONE');

    // Headers de control de caché adicionales
    // Cache-Control: permite al cliente cachear por 5 minutos
    // must-revalidate: fuerza validación con ETag antes de usar caché expirado
    res.set('Cache-Control', 'private, max-age=300, must-revalidate');

    // Enviar respuesta completa con contenido
    return originalJson(data);
  };

  // Continuar con la cadena de middleware
  next();
};

/**
 * Middleware de ETags deshabilitado (para rutas que no deben usar ETags)
 * Útil para endpoints con datos en tiempo real o que siempre cambian
 *
 * @param {object} req - Request de Express
 * @param {object} res - Response de Express
 * @param {Function} next - Next middleware
 */
const disableETag = (req, res, next) => {
  res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  next();
};

/**
 * Generar ETag fuerte (strong) basado en contenido + timestamp
 * Útil para recursos que cambian frecuentemente pero necesitan validación exacta
 *
 * @param {*} data - Datos de la respuesta
 * @param {Date} timestamp - Timestamp de la última modificación
 * @returns {string} ETag fuerte
 */
const generateStrongETag = (data, timestamp = new Date()) => {
  try {
    const content = typeof data === 'string' ? data : JSON.stringify(data);
    const contentHash = crypto.createHash('md5').update(content).digest('hex');
    const timeHash = crypto.createHash('md5').update(timestamp.toISOString()).digest('hex');

    // Combinar hashes
    const combinedHash = crypto
      .createHash('md5')
      .update(contentHash + timeHash)
      .digest('hex');

    return `"${combinedHash}"`;

  } catch (error) {
    cacheLogger.error({
      error: error.message
    }, 'Error generando ETag fuerte');

    return `"${Date.now()}"`;
  }
};

/**
 * Generar ETag débil (weak) basado solo en campos principales
 * Útil para recursos donde pequeños cambios no requieren re-descarga
 *
 * @param {object} data - Datos de la respuesta
 * @param {string[]} fields - Campos principales a considerar
 * @returns {string} ETag débil (prefijo W/)
 */
const generateWeakETag = (data, fields = []) => {
  try {
    // Extraer solo campos relevantes
    let relevantData = data;

    if (fields.length > 0 && typeof data === 'object') {
      relevantData = {};
      fields.forEach(field => {
        if (data[field] !== undefined) {
          relevantData[field] = data[field];
        }
      });
    }

    const content = typeof relevantData === 'string' ? relevantData : JSON.stringify(relevantData);
    const hash = crypto.createHash('md5').update(content).digest('hex');

    // Formato de ETag débil: W/"hash"
    return `W/"${hash}"`;

  } catch (error) {
    cacheLogger.error({
      error: error.message
    }, 'Error generando ETag débil');

    return `W/"${Date.now()}"`;
  }
};

/**
 * Obtener estadísticas de uso de ETags (para endpoint de admin)
 *
 * @returns {object} Estadísticas de ETags
 */
const getETagStats = () => {
  return {
    enabled: true,
    algorithm: 'MD5',
    types: {
      standard: 'Basado en contenido completo',
      strong: 'Contenido + timestamp',
      weak: 'Solo campos principales (W/)'
    },
    headers: {
      request: 'If-None-Match: "<etag-hash>"',
      response: 'ETag: "<etag-hash>"',
      cacheControl: 'Cache-Control: private, max-age=300, must-revalidate'
    },
    benefits: [
      'Reduce ancho de banda con 304 responses',
      'Valida caché del cliente automáticamente',
      'Compatible con todos los navegadores modernos',
      'Funciona en conjunto con node-cache del servidor'
    ],
    usage: {
      cacheHit: 'Cliente recibe 304 Not Modified (sin body)',
      cacheMiss: 'Cliente recibe 200 OK con contenido + nuevo ETag'
    }
  };
};

module.exports = {
  etagMiddleware,
  disableETag,
  generateETag,
  generateStrongETag,
  generateWeakETag,
  getETagStats
};
