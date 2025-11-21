/**
 * Utilidades de Paginación
 *
 * Funciones helper para estandarizar la paginación en toda la API.
 * Centraliza la lógica de cálculo y validación de parámetros de paginación.
 */

const { PAGINATION } = require('../constants');

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

/**
 * Construye opciones de paginación con validación robusta de límites
 * Previene ataques DoS mediante límites excesivos
 *
 * @param {Object} query - Query parameters de la request
 * @returns {Object} Objeto con page, limit, skip validados
 *
 * @example
 * const { page, limit, skip } = buildPaginationOptions(req.query);
 */
const buildPaginationOptions = (query = {}) => {
  // Parsear y validar limit
  let limit = parseInt(query.limit) || PAGINATION.DEFAULT_LIMIT;

  // Validar límite mínimo
  if (limit < PAGINATION.MIN_LIMIT) {
    limit = PAGINATION.DEFAULT_LIMIT;
  }

  // Validar límite máximo (prevenir DoS)
  if (limit > PAGINATION.MAX_LIMIT) {
    limit = PAGINATION.MAX_LIMIT;
  }

  // Parsear y validar page
  let page = parseInt(query.page) || PAGINATION.DEFAULT_PAGE;

  // Validar página mínima
  if (page < PAGINATION.DEFAULT_PAGE) {
    page = PAGINATION.DEFAULT_PAGE;
  }

  // Validar página máxima (prevenir ataques)
  if (page > PAGINATION.MAX_PAGE) {
    page = PAGINATION.MAX_PAGE;
  }

  // Calcular skip
  const skip = (page - 1) * limit;

  return {
    page,
    limit,
    skip
  };
};

module.exports = {
  createPaginationMeta,
  parseDateRangeFilter,
  buildPaginationOptions
};
