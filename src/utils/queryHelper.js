/**
 * Query Helper Functions
 *
 * Funciones reutilizables para construcción de queries, filtros y ordenamiento.
 * Elimina código duplicado en controladores y servicios.
 *
 */

/**
 * Escapa caracteres especiales de regex para prevenir ataques ReDoS
 *
 * @param {string} str - String a escapar
 * @returns {string} String escapado
 */
const escapeRegex = (str) => {
  if (typeof str !== 'string') {
    return '';
  }
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
};

/**
 * Construye objeto de filtros para queries de MongoDB
 *
 * @param {Object} queryParams - Query parameters de la request
 * @param {Array} filterConfig - Configuración de filtros
 * @returns {Object} Objeto de filtros para MongoDB
 *
 * @example
 * const filters = buildFilters(req.query, [
 *   { field: 'distrito.nombre', type: 'regex', param: 'distrito' },
 *   { field: 'gravedad', type: 'in', param: 'gravedad' },
 *   { field: 'fecha', type: 'dateRange', params: ['startDate', 'endDate'] }
 * ]);
 */
const buildFilters = (queryParams, filterConfig) => {
  const filters = {};

  if (!filterConfig || !Array.isArray(filterConfig)) {
    return filters;
  }

  filterConfig.forEach(config => {
    const { field, type, param, params, transform } = config;

    switch (type) {
      case 'regex': {
        const value = queryParams[param];
        if (value) {
          // Sanitizar entrada de usuario para prevenir ataques ReDoS
          const sanitizedValue = escapeRegex(value);
          filters[field] = new RegExp(sanitizedValue, 'i');
        }
        break;
      }

      case 'exact': {
        const value = queryParams[param];
        if (value !== undefined && value !== null && value !== '') {
          filters[field] = transform ? transform(value) : value;
        }
        break;
      }

      case 'in': {
        const value = queryParams[param];
        if (value) {
          const values = Array.isArray(value) ? value : [value];
          filters[field] = { $in: values };
        }
        break;
      }

      case 'dateRange': {
        const [startParam, endParam] = params || ['startDate', 'endDate'];
        const startDate = queryParams[startParam];
        const endDate = queryParams[endParam];

        if (startDate || endDate) {
          filters[field] = {};
          if (startDate) {
            filters[field].$gte = new Date(startDate);
          }
          if (endDate) {
            filters[field].$lte = new Date(endDate);
          }
        }
        break;
      }

      case 'numeric': {
        const value = queryParams[param];
        if (value !== undefined && value !== null) {
          const numValue = Number(value);
          if (!isNaN(numValue)) {
            filters[field] = numValue;
          }
        }
        break;
      }

      case 'numericRange': {
        const [minParam, maxParam] = params || ['min', 'max'];
        const minValue = queryParams[minParam];
        const maxValue = queryParams[maxParam];

        if (minValue !== undefined || maxValue !== undefined) {
          filters[field] = {};
          if (minValue !== undefined) {
            const numMin = Number(minValue);
            if (!isNaN(numMin)) {
              filters[field].$gte = numMin;
            }
          }
          if (maxValue !== undefined) {
            const numMax = Number(maxValue);
            if (!isNaN(numMax)) {
              filters[field].$lte = numMax;
            }
          }
        }
        break;
      }

      case 'boolean': {
        const value = queryParams[param];
        if (value !== undefined) {
          filters[field] = value === 'true' || value === true;
        }
        break;
      }

      default:
        // Tipo no reconocido, ignorar
        break;
    }
  });

  return filters;
};

/**
 * Construye opciones de ordenamiento para queries de MongoDB
 * Soporta dos formas de uso: legacy (params individuales) y nuevo (objeto + mapping)
 *
 * @param {string|Object} sortByOrQuery - Campo por el cual ordenar O objeto query completo
 * @param {string|Object} sortOrderOrMapping - Dirección del ordenamiento O mapping de campos
 * @param {Array} validFields - Campos válidos para ordenamiento
 * @param {string} defaultField - Campo por defecto si sortBy no es válido
 * @param {string} defaultOrder - Orden por defecto ('asc' o 'desc')
 * @returns {Object} Objeto de ordenamiento para MongoDB
 *
 * @example
 * // Uso legacy
 * const sortOptions = buildSortOptions('fecha', 'desc', ['fecha', 'nombre'], 'fecha');
 *
 * // Uso nuevo con mapping
 * const sortOptions = buildSortOptions(
 *   { sortBy: 'totalPoblacion', sortOrder: 'desc' },
 *   { totalPoblacion: 'estadisticas.totalPoblacion', edad: 'edad' },
 *   ['totalPoblacion', 'edad'],
 *   'fechaCenso',
 *   'desc'
 * );
 */
const buildSortOptions = (sortByOrQuery, sortOrderOrMapping, validFields = [], defaultField = 'createdAt', defaultOrder = 'desc') => {
  let sortBy, sortOrder, sortMapping;

  // Detectar si es uso nuevo (primer parámetro es objeto) o legacy
  if (typeof sortByOrQuery === 'object' && sortByOrQuery !== null) {
    // Uso nuevo con objeto query y mapping
    sortBy = sortByOrQuery.sortBy;
    sortOrder = sortByOrQuery.sortOrder;
    sortMapping = sortOrderOrMapping || {}; // Segundo parámetro es el mapping
    defaultOrder = defaultField || 'desc'; // En modo nuevo, 4to param es defaultOrder
    defaultField = validFields[0] || 'createdAt'; // En modo nuevo, 3er param todavía es validFields
  } else {
    // Uso legacy (params individuales)
    sortBy = sortByOrQuery;
    sortOrder = sortOrderOrMapping;
    sortMapping = null;
  }

  // Validar que el campo sea válido
  const sortField = validFields.includes(sortBy) ? sortBy : defaultField;

  // Si hay mapping, aplicarlo
  const actualField = sortMapping && sortMapping[sortField] ? sortMapping[sortField] : sortField;

  // Determinar dirección (1 = ascendente, -1 = descendente)
  let sortDirection;
  if (sortOrder === 'asc' || sortOrder === '1' || sortOrder === 1) {
    sortDirection = 1;
  } else if (sortOrder === 'desc' || sortOrder === '-1' || sortOrder === -1) {
    sortDirection = -1;
  } else {
    // Por defecto según defaultOrder
    sortDirection = defaultOrder === 'asc' ? 1 : -1;
  }

  return { [actualField]: sortDirection };
};

/**
 * Valida un rango de fechas
 *
 * @param {string|Date} startDate - Fecha de inicio
 * @param {string|Date} endDate - Fecha de fin
 * @param {number} maxDays - Máximo de días permitidos en el rango (default: 365)
 * @returns {Object} Objeto con isValid y error opcional
 *
 * @example
 * const validation = validateDateRange(req.query.startDate, req.query.endDate, 365);
 * if (!validation.isValid) {
 *   return next(new AppError(validation.error, 400));
 * }
 */
const validateDateRange = (startDate, endDate, maxDays = 365) => {
  // Si no hay fechas, es válido
  if (!startDate && !endDate) {
    return { isValid: true };
  }

  // Si solo hay una fecha, es válido
  if (!startDate || !endDate) {
    return { isValid: true };
  }

  const start = new Date(startDate);
  const end = new Date(endDate);

  // Validar que son fechas válidas
  if (isNaN(start.getTime())) {
    return {
      isValid: false,
      error: 'Fecha de inicio no es válida'
    };
  }

  if (isNaN(end.getTime())) {
    return {
      isValid: false,
      error: 'Fecha de fin no es válida'
    };
  }

  // Validar que la fecha de inicio no sea posterior a la de fin
  if (start > end) {
    return {
      isValid: false,
      error: 'Fecha de inicio no puede ser posterior a fecha de fin'
    };
  }

  // Validar que el rango no exceda el máximo permitido
  const diffTime = Math.abs(end - start);
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

  if (diffDays > maxDays) {
    return {
      isValid: false,
      error: `El rango de fechas no puede superar ${maxDays} días`
    };
  }

  return { isValid: true };
};

/**
 * Construye opciones de paginación
 * Complementa al paginationHelper existente
 *
 * @param {Object} queryParams - Query parameters de la request
 * @param {Object} options - Opciones adicionales (maxLimit, defaultLimit, etc.)
 * @returns {Object} Objeto con page, limit, skip
 *
 * @example
 * const pagination = buildPaginationOptions(req.query);
 * // Retorna: { page: 1, limit: 50, skip: 0 }
 */
const buildPaginationOptions = (queryParams, options = {}) => {
  const {
    maxLimit = 100,
    defaultLimit = 50,
    maxPage = 1000
  } = options;

  let page = parseInt(queryParams.page) || 1;
  let limit = parseInt(queryParams.limit) || defaultLimit;

  // Validar límites
  if (limit > maxLimit) {
    limit = maxLimit;
  }

  if (limit < 1) {
    limit = defaultLimit;
  }

  if (page < 1) {
    page = 1;
  }

  if (page > maxPage) {
    page = maxPage;
  }

  const skip = (page - 1) * limit;

  return { page, limit, skip };
};

module.exports = {
  escapeRegex,
  buildFilters,
  buildSortOptions,
  validateDateRange,
  buildPaginationOptions
};
