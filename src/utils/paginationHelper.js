/**
 * Utilidades de Paginación
 *
 * Funciones helper para estandarizar la paginación en toda la API.
 * Centraliza la lógica de cálculo y validación de parámetros de paginación.
 */

/**
 * Parsea y valida parámetros de paginación
 *
 * @param {number|string} page - Número de página solicitada
 * @param {number|string} limit - Número de elementos por página
 * @param {Object} options - Opciones de configuración
 * @param {number} options.defaultPage - Página por defecto (default: 1)
 * @param {number} options.defaultLimit - Límite por defecto (default: 50)
 * @param {number} options.maxLimit - Límite máximo permitido (default: 100)
 * @param {number} options.minLimit - Límite mínimo permitido (default: 1)
 * @returns {Object} Objeto con pageNum, limitNum y skip calculados
 */
const parsePaginationParams = (page, limit, options = {}) => {
  const {
    defaultPage = 1,
    defaultLimit = 50,
    maxLimit = 100,
    minLimit = 1
  } = options;

  // Parsear y validar página
  const pageNum = Math.max(defaultPage, parseInt(page) || defaultPage);

  // Parsear y validar límite
  const limitNum = Math.min(
    maxLimit,
    Math.max(minLimit, parseInt(limit) || defaultLimit)
  );

  // Calcular offset (skip)
  const skip = (pageNum - 1) * limitNum;

  return {
    pageNum,
    limitNum,
    skip
  };
};

/**
 * Crea objeto de metadatos de paginación para respuesta
 *
 * @param {number} currentPage - Página actual
 * @param {number} limit - Elementos por página
 * @param {number} totalDocuments - Total de documentos en la colección
 * @returns {Object} Metadatos de paginación estandarizados
 */
const createPaginationMeta = (currentPage, limit, totalDocuments) => {
  const totalPages = Math.ceil(totalDocuments / limit);
  const hasNextPage = currentPage < totalPages;
  const hasPrevPage = currentPage > 1;

  return {
    currentPage,
    totalPages,
    totalDocuments,
    documentsPerPage: limit,
    hasNextPage,
    hasPrevPage,
    nextPage: hasNextPage ? currentPage + 1 : null,
    prevPage: hasPrevPage ? currentPage - 1 : null
  };
};

/**
 * Construir filtros de fecha comunes
 *
 * @param {string|Date} startDate - Fecha de inicio
 * @param {string|Date} endDate - Fecha de fin
 * @param {string} fieldName - Nombre del campo de fecha (default: 'fecha')
 * @returns {Object|null} Filtro de fecha para Mongoose o null si no hay fechas
 */
const parseDateRangeFilter = (startDate, endDate, fieldName = 'fecha') => {
  if (!startDate && !endDate) {
    return null;
  }

  const dateFilter = {};

  if (startDate) {
    dateFilter.$gte = new Date(startDate);
  }

  if (endDate) {
    dateFilter.$lte = new Date(endDate);
  }

  return {
    [fieldName]: dateFilter
  };
};

module.exports = {
  parsePaginationParams,
  createPaginationMeta,
  parseDateRangeFilter
};
