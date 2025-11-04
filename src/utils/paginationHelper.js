/**
 * Utilidades de Paginación
 *
 * Funciones helper para estandarizar la paginación en toda la API.
 * Centraliza la lógica de cálculo y validación de parámetros de paginación.
 */

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
  createPaginationMeta,
  parseDateRangeFilter
};
