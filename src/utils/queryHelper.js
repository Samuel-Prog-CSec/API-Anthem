/**
 * Query Helper Functions
 *
 * Funciones reutilizables para construcción de queries, filtros y ordenamiento.
 * Elimina código duplicado en controladores y servicios.
 *
 */

const { MONGODB_TIMEOUTS } = require('../constants');

/**
 * Transformadores predefinidos para filtros
 * Elimina código repetitivo en configuración de filtros
 */
const TRANSFORMS = {
  /** Convierte valor (o array de valores) a mayúsculas, tolerante a no-strings */
  toUpperCase: v => Array.isArray(v)
    ? v.map(x => String(x).toUpperCase())
    : String(v).toUpperCase(),

  /** Convierte valor (o array de valores) a minúsculas, tolerante a no-strings */
  toLowerCase: v => Array.isArray(v)
    ? v.map(x => String(x).toLowerCase())
    : String(v).toLowerCase(),

  /** Convierte valor o array de valores a array de enteros */
  toIntArray: v => Array.isArray(v) ? v.map(m => parseInt(m, 10)) : [parseInt(v, 10)],

  /** Convierte valor o array de valores a array de mayúsculas */
  toUpperCaseArray: v => Array.isArray(v) ? v.map(c => c.toUpperCase()) : [v.toUpperCase()],

  /** Convierte a entero */
  toInt: v => parseInt(v, 10),

  /** Convierte a float */
  toFloat: v => parseFloat(v),

  /** Convierte string 'true'/'false' a boolean */
  toBoolean: v => v === 'true' || v === true
};

/**
 * Parsea parámetros numéricos de query de una sola vez
 * Evita múltiples parseInt redundantes en el código
 *
 * @param {Object} queryParams - Query parameters de la request
 * @param {Array<string>} numericFields - Campos a convertir a número
 * @param {Object} defaults - Valores por defecto para cada campo
 * @returns {Object} Objeto con valores parseados
 *
 * @example
 * const { año, mes, distrito, limit } = parseNumericParams(
 *   req.query,
 *   ['año', 'mes', 'distrito', 'limit'],
 *   { año: 2051, limit: 10 }
 * );
 */
const parseNumericParams = (queryParams, numericFields, defaults = {}) => {
  const result = {};
  numericFields.forEach(field => {
    const value = queryParams[field];
    if (value !== undefined && value !== null && value !== '') {
      const parsed = parseInt(value, 10);
      result[field] = isNaN(parsed) ? defaults[field] : parsed;
    } else {
      result[field] = defaults[field] !== undefined ? defaults[field] : null;
    }
  });
  return result;
};

/**
 * Construye objeto de metadatos/configuración para respuestas
 * Evita duplicación de patrones de metadatos en controllers
 *
 * @param {Object} params - Parámetros a incluir en metadatos
 * @param {Object} options - Opciones adicionales
 * @returns {Object} Objeto de metadatos formateado
 *
 * @example
 * const config = buildResponseMetadata({
 *   año: añoNum,
 *   mes: mesNum,
 *   distrito: distritoNum
 * }, { nullLabel: 'Todos' });
 */
const buildResponseMetadata = (params, options = {}) => {
  const { nullLabel = null, includeTimestamp = false } = options;
  const metadata = {};

  Object.entries(params).forEach(([key, value]) => {
    metadata[key] = value !== null && value !== undefined ? value : nullLabel;
  });

  if (includeTimestamp) {
    metadata.fechaConsulta = new Date().toISOString();
  }

  return metadata;
};

/**
 * Normaliza un parametro que un endpoint espera como ESCALAR.
 *
 * Un parametro duplicado en query string (`?x=a&x=b`) -- legitimo para los
 * filtros multi-valor de los listados, por eso esta en la whitelist HPP --
 * llega como array. En endpoints de un solo valor eso provocaba
 * `array.toUpperCase()` -> TypeError -> 500. Tomamos el primer valor para
 * degradar de forma segura en vez de romper.
 *
 * @param {*} value - Valor crudo de req.query
 * @returns {*} El primer elemento si es array; el valor tal cual en otro caso
 */
const primerValorEscalar = (value) => (Array.isArray(value) ? value[0] : value);

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
          // Construye una RegExp anti-ReDoS (longitud acotada + metacaracteres
          // escapados) a partir de un unico valor.
          const maxRegexLength = 200;
          const toRegex = (val) => {
            const truncatedValue = typeof val === 'string' && val.length > maxRegexLength
              ? val.substring(0, maxRegexLength)
              : val;
            return new RegExp(escapeRegex(truncatedValue), 'i');
          };
          // Un parametro duplicado (?x=a&x=b) llega como array: generar `$in`
          // de regex en lugar de reventar (un array no tiene metodos de string).
          filters[field] = Array.isArray(value)
            ? { $in: value.map(toRegex) }
            : toRegex(value);
        }
        break;
      }

      case 'exact': {
        const value = queryParams[param];
        if (value !== undefined && value !== null && value !== '') {
          const transformed = transform ? transform(value) : value;
          // Un parametro duplicado llega como array: traducir a `$in` (no a
          // igualdad contra el array entero, que no matchearia nada).
          filters[field] = Array.isArray(transformed)
            ? { $in: transformed }
            : transformed;
        }
        break;
      }

      case 'in': {
        const value = queryParams[param];
        if (value) {
          // Aplicar el `transform` declarado en la config si existe (ej.
          // `toIntArray` para convertir strings de query string a numeros).
          // Sin esto, `?magnitud=8` se queda como `{$in: ["8"]}` y no
          // matchea documentos donde `magnitud` esta tipado como Number.
          const transformed = transform ? transform(value) : value;
          const values = Array.isArray(transformed) ? transformed : [transformed];
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
        // Un parametro duplicado llega como array; tomar el primer valor
        // definido para no descartar el filtro en silencio.
        const raw = queryParams[param];
        const value = Array.isArray(raw) ? raw[0] : raw;
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

  let page = parseInt(queryParams.page, 10) || 1;
  let limit = parseInt(queryParams.limit, 10) || defaultLimit;

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

/**
 * Ejecuta un pipeline con $facet para obtener datos paginados, total y
 * (opcionalmente) estadisticas agregadas en una sola roundtrip a MongoDB.
 *
 * Antes este helper solo devolvia `data` + `total`; los controllers que
 * necesitaban estadisticas adicionales (`$sum`, `$avg`, etc.) lanzaban una
 * SEGUNDA agregacion `aggregate([{ $match }, { $group }])` sobre el mismo
 * filtro, lo que duplicaba la pasada por la coleccion. Ahora se pueden
 * pasar las stages `$group`/etc. en `statsPipeline` y se ejecutan dentro
 * del mismo `$facet`, ahorrando ~30-40% del tiempo de respuesta en
 * endpoints de listado de gran volumen (multas, accidentes, trafico).
 *
 * @param {Object}  options
 * @param {mongoose.Model} options.model        - Modelo Mongoose a consultar.
 * @param {Object}  [options.filters]           - Filtro `$match` raiz.
 * @param {Object}  [options.sort]              - Orden aplicado al facet `data`.
 * @param {Object}  [options.projection]        - Projection aplicada al facet `data`.
 * @param {Object}  [options.pagination]        - { page, limit, skip }.
 * @param {Array}   [options.statsPipeline]     - Stages para calcular estadisticas
 *                                                (normalmente un solo `$group`).
 *                                                Si se omite, no se calculan stats.
 * @param {boolean} [options.allowDiskUse=true]
 * @param {number}  [options.maxTimeMS]
 * @returns {Promise<{ data, total, stats, fallback, fallbackError }>}
 */
const executeFacetPagination = async ({
  model,
  filters = {},
  sort = {},
  projection = null,
  pagination = { page: 1, limit: 50, skip: 0 },
  statsPipeline = null,
  allowDiskUse = true,
  maxTimeMS = MONGODB_TIMEOUTS.AGGREGATE_TIMEOUT_MS
}) => {
  const { skip = 0, limit = 50 } = pagination;
  const pipeline = [
    { $match: filters || {} }
  ];

  if (sort && Object.keys(sort).length > 0) {
    pipeline.push({ $sort: sort });
  }

  const facets = {
    data: [
      ...(skip > 0 ? [{ $skip: skip }] : []),
      { $limit: limit },
      ...(projection ? [{ $project: projection }] : [])
    ],
    count: [{ $count: 'total' }]
  };

  if (Array.isArray(statsPipeline) && statsPipeline.length > 0) {
    facets.stats = statsPipeline;
  }

  pipeline.push({ $facet: facets });

  try {
    const [result] = await model.aggregate(pipeline)
      .option({ allowDiskUse, maxTimeMS })
      .exec();

    return {
      data: result?.data || [],
      total: result?.count?.[0]?.total || 0,
      stats: result?.stats?.[0] || null
    };
  } catch (error) {
    // Fallback: countDocuments + find + stats por separado para no bloquear
    // la respuesta. Cada query usa su propio timeout pero comparten el
    // contexto de filters.
    const total = await model.countDocuments(filters).maxTimeMS(MONGODB_TIMEOUTS.QUERY_TIMEOUT_MS);
    const data = await model.find(filters, projection || undefined)
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .maxTimeMS(maxTimeMS)
      .lean();

    let stats = null;
    if (Array.isArray(statsPipeline) && statsPipeline.length > 0) {
      try {
        const statsResult = await model.aggregate([
          { $match: filters || {} },
          ...statsPipeline
        ]).option({ allowDiskUse, maxTimeMS }).exec();
        stats = statsResult?.[0] || null;
      } catch (_statsErr) {
        // Si las stats fallan en modo fallback, las omitimos en silencio
        // (el endpoint sigue funcionando, solo pierde el bloque agregado)
        stats = null;
      }
    }

    return { data, total, stats, fallback: true, fallbackError: error.message };
  }
};

module.exports = {
  TRANSFORMS,
  parseNumericParams,
  buildResponseMetadata,
  primerValorEscalar,
  escapeRegex,
  buildFilters,
  buildSortOptions,
  validateDateRange,
  buildPaginationOptions,
  executeFacetPagination
};
