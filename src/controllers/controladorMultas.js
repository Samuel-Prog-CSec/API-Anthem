/**
 * Controlador de Multas
 *
 * Maneja las operaciones CRUD y consultas para datos de multas de tráfico.
 * Incluye filtrado avanzado, agregaciones estadísticas y análisis temporal
 * para el dashboard del frontend.
 */

const Multa = require('../models/Multa');
const { createInternalError, createNotFoundError } = require('../utils/errorUtils');
const { createPaginationMeta } = require('../utils/paginationHelper');
const { buildFilters, buildSortOptions, buildPaginationOptions, TRANSFORMS, parseNumericParams, buildResponseMetadata, executeFacetPagination } = require('../utils/queryHelper');
const { createResponse } = require('../utils/responseHelper');
const { documentosAFeatureCollection } = require('../utils/geoJsonHelper');
const { bboxDeDistrito } = require('../utils/centroidesDistritosMadrid');
const { SORT_FIELDS, PAGINATION, HTTP_STATUS, SEVERITY_LEVELS, INFRACTION_TYPES, DATA_QUALITY_LEVELS, MONGODB_TIMEOUTS, AGGREGATION_LIMITS, TIME_CONSTANTS, FINE_CONSTANTS, DASHBOARD_PERIODS, DEFAULT_SORT_FIELDS } = require('../constants');
const logger = require('../config/logger');

/**
 * Obtener multas con filtros avanzados
 * GET /api/v1/multas
 */
const obtenerMultas = async (req, res, next) => {
  try {
    // Extraer parámetros de consulta
    const {
      conDescuento,
      esGrave,
      page = PAGINATION.DEFAULT_PAGE,
      limit = PAGINATION.DEFAULT_LIMIT,
      sortBy = DEFAULT_SORT_FIELDS.FINE,
      sortOrder = DEFAULT_SORT_FIELDS.DEFAULT_ORDER,
      includeCoordinates = false
    } = req.query;

    // Configuración de filtros usando buildFilters
    const filterConfig = [
      { field: 'fecha', type: 'dateRange', params: ['startDate', 'endDate'] },
      { field: 'calificacion', type: 'in', param: 'calificacion', transform: TRANSFORMS.toUpperCaseArray },
      { field: 'lugar', type: 'regex', param: 'lugar' },
      { field: 'metadatos.tipoInfraccion', type: 'in', param: 'tipoInfraccion' },
      { field: 'denunciante', type: 'regex', param: 'denunciante' },
      { field: 'importeFinal', type: 'numericRange', params: ['minImporte', 'maxImporte'] },
      { field: 'puntosDetraídos', type: 'numericRange', params: ['minPuntos', 'maxPuntos'] }
    ];

    const filters = buildFilters(req.query, filterConfig);

    // Filtros booleanos adicionales
    if (conDescuento !== undefined) {
      filters.tieneDescuento = conDescuento === 'true';
    }

    if (esGrave !== undefined) {
      filters['metadatos.esInfraccionGrave'] = esGrave === 'true';
    }

    // Configurar paginación usando queryHelper
    const paginationOptions = buildPaginationOptions(
      { page, limit },
      { defaultLimit: PAGINATION.DEFAULT_LIMIT, maxLimit: PAGINATION.MAX_LIMIT }
    );

    // Configurar ordenamiento usando queryHelper
    const sortMapping = {
      fecha: 'fecha',
      importeFinal: 'importeFinal',
      puntosDetraídos: 'puntosDetraídos',
      lugar: 'lugar',
      calificacion: 'calificacion'
    };
    const sortOptions = buildSortOptions(
      { sortBy, sortOrder },
      sortMapping,
      SORT_FIELDS.FINE,
      'fecha',
      'desc'
    );

    // Proyeccion optimizada: seleccionar solo campos necesarios
    const projection = {
      fecha: 1,
      hora: 1,
      lugar: 1,
      calificacion: 1,
      importeBoletín: 1,
      importeFinal: 1,
      puntosDetraídos: 1,
      tieneDescuento: 1,
      denunciante: 1,
      'metadatos.tipoInfraccion': 1,
      'metadatos.esInfraccionGrave': 1,
      'metadatos.esInfraccionVelocidad': 1
    };

    // Incluir coordenadas si se solicita
    if (includeCoordinates) {
      projection.coordenadas = 1;
    }

    // Ejecutar consulta con facet para datos + total en una sola operación
    const {
      data,
      total: totalDocuments,
      fallback: fineFacetFallback,
      fallbackError: fineFacetError
    } = await executeFacetPagination({
      model: Multa,
      filters,
      sort: sortOptions,
      projection,
      pagination: paginationOptions,
      maxTimeMS: MONGODB_TIMEOUTS.AGGREGATE_TIMEOUT_MS
    });

    // Calcular metadatos de paginación usando helper
    const paginationMeta = createPaginationMeta(paginationOptions.page, paginationOptions.limit, totalDocuments);

    // Obtener estadísticas rápidas del conjunto filtrado
    const quickStatistics = await Multa.aggregate([
      { $match: filters },
      // NO usar $limit antes de $group - corrompe las estadísticas globales
      {
        $group: {
          _id: null,
          totalImporte: { $sum: '$importeFinal' },
          importePromedio: { $avg: '$importeFinal' },
          totalPuntos: { $sum: '$puntosDetraídos' },
          multasGraves: {
            $sum: { $cond: ['$metadatos.esInfraccionGrave', 1, 0] }
          },
          multasConDescuento: {
            $sum: { $cond: ['$tieneDescuento', 1, 0] }
          }
        }
      }
    ]);

    const responseData = {
      data,
      pagination: paginationMeta,
      estadisticas: quickStatistics[0] || {
        totalImporte: 0,
        importePromedio: 0,
        totalPuntos: 0,
        multasGraves: 0,
        multasConDescuento: 0
      },
      performance: fineFacetFallback ? {
        facetFallback: true,
        reason: fineFacetError
      } : undefined,
      filtros: {
        aplicados: Object.keys(filters).length > 0 ? filters : null,
        disponibles: {
          calificaciones: Object.values(SEVERITY_LEVELS.FINE),
          tiposInfraccion: Object.values(INFRACTION_TYPES)
        }
      }
    };

    res.status(HTTP_STATUS.OK).json(createResponse(responseData, 'Multas obtenidas exitosamente'));

  } catch (error) {
    logger.error({
      error: error.message,
      stack: error.stack,
      query: req.query,
      endpoint: 'GET /api/v1/multas'
    }, 'Error obteniendo multas');
    next(createInternalError('Error al obtener multas', error));
  }
};

/**
 * Obtener multa por ID con detalles completos
 * GET /api/v1/multas/:id
 */
const obtenerMultaPorId = async (req, res, next) => {
  try {
    const { id } = req.params;

    const multa = await Multa.findById(id)
      .maxTimeMS(MONGODB_TIMEOUTS.QUERY_TIMEOUT_MS) // Timeout de 5 segundos
      .lean();

    if (!multa) {
      return next(createNotFoundError('Multa', id));
    }

    // Agregar información calculada adicional
    const impactoEconomico = {
      importeOriginal: multa.importeBoletín,
      importeFinal: multa.importeFinal,
      descuentoAplicado: multa.tieneDescuento ? multa.importeBoletín - multa.importeFinal : 0,
      porcentajeDescuento: multa.tieneDescuento ? FINE_CONSTANTS.DISCOUNT_PERCENTAGE : 0
    };

    const responseData = {
      ...multa,
      impactoEconomico,
      gravedad: multa.calificacion === SEVERITY_LEVELS.FINE.GRAVE ||
                multa.calificacion === SEVERITY_LEVELS.FINE.MUY_GRAVE ? DATA_QUALITY_LEVELS.ALTA : DATA_QUALITY_LEVELS.BAJA
    };

    res.status(HTTP_STATUS.OK).json(createResponse(responseData, 'Detalles de multa obtenidos exitosamente'));

  } catch (error) {
    logger.error({
      error: error.message,
      stack: error.stack,
      fineId: req.params.id,
      endpoint: 'GET /api/v1/multas/:id'
    }, 'Error obteniendo detalles de multa');
    next(createInternalError('Error al obtener multa por ID', error));
  }
};

/**
 * Obtener estadísticas generales de multas
 * GET /api/v1/multas/estadisticas
 */
const obtenerEstadisticasMultas = async (req, res, next) => {
  try {
    const {
      startDate,
      endDate,
      groupBy = 'month'
    } = req.query;

    // Parsear parámetros numéricos
    const { limit } = parseNumericParams(
      req.query,
      ['limit'],
      { limit: AGGREGATION_LIMITS.MONTHLY_STATS }
    );

    // Llamar al método optimizado del modelo
    const result = await Multa.getStatisticsOptimized({
      startDate: startDate ? new Date(startDate) : null,
      endDate: endDate ? new Date(endDate) : null,
      groupBy,
      limit
    });

    const responseData = {
      estadisticas: result.estadisticas,
      resumen: result.resumen,
      configuracion: buildResponseMetadata({
        agrupacion: groupBy,
        filtros: startDate || endDate ? { startDate, endDate } : null,
        limite: limit
      })
    };

    res.status(HTTP_STATUS.OK).json(createResponse(responseData, 'Estadísticas de multas obtenidas exitosamente'));

  } catch (error) {
    logger.error({
      error: error.message,
      stack: error.stack,
      query: req.query,
      endpoint: 'GET /api/v1/multas/estadisticas'
    }, 'Error obteniendo estadísticas de multas');
    next(createInternalError('Error al calcular estadísticas', error));
  }
};

/**
 * Obtener ranking de ubicaciones con más multas
 * GET /api/v1/multas/ubicaciones/ranking
 */
const obtenerRankingUbicaciones = async (req, res, next) => {
  try {
    const {
      startDate,
      endDate,
      tipoInfraccion
    } = req.query;

    // Parsear parámetros numéricos
    const { limit } = parseNumericParams(
      req.query,
      ['limit'],
      { limit: AGGREGATION_LIMITS.TOP_RESULTS }
    );

    // Llamar al método optimizado del modelo
    const ranking = await Multa.getLocationRankingOptimized({
      startDate: startDate ? new Date(startDate) : null,
      endDate: endDate ? new Date(endDate) : null,
      tipoInfraccion,
      limit
    });

    const responseData = {
      ranking,
      configuracion: buildResponseMetadata({
        filtros: startDate || endDate || tipoInfraccion ? { startDate, endDate, tipoInfraccion } : null,
        limite: limit
      }),
      metadatos: {
        totalUbicaciones: ranking.length,
        fechaConsulta: new Date()
      }
    };

    res.status(HTTP_STATUS.OK).json(createResponse(responseData, 'Ranking de ubicaciones obtenido exitosamente'));

  } catch (error) {
    logger.error({
      error: error.message,
      stack: error.stack,
      query: req.query,
      endpoint: 'GET /api/v1/multas/ubicaciones/ranking'
    }, 'Error obteniendo ranking de ubicaciones');
    next(createInternalError('Error al obtener ranking', error));
  }
};

/**
 * Obtener análisis temporal de multas
 * GET /api/v1/multas/analisis/temporal
 */
const obtenerAnalisisTemporal = async (req, res, next) => {
  try {
    const {
      startDate,
      endDate,
      tipoAnalisis = 'monthly'
    } = req.query;

    // Llamar al método optimizado del modelo
    const result = await Multa.getTemporalAnalysisOptimized({
      startDate: startDate ? new Date(startDate) : null,
      endDate: endDate ? new Date(endDate) : null,
      tipoAnalisis
    });

    const responseData = {
      analisis: result.analisis,
      tendencia: result.tendencia,
      configuracion: buildResponseMetadata({
        tipoAnalisis,
        filtros: startDate || endDate ? { startDate, endDate } : null
      }),
      metadatos: {
        totalPeriodos: result.analisis.length,
        fechaConsulta: new Date()
      }
    };

    res.status(HTTP_STATUS.OK).json(createResponse(responseData, 'Análisis temporal obtenido exitosamente'));

  } catch (error) {
    logger.error({
      error: error.message,
      stack: error.stack,
      query: req.query,
      endpoint: 'GET /api/v1/multas/analisis/temporal'
    }, 'Error en análisis temporal de multas');
    next(createInternalError('Error en análisis temporal', error));
  }
};

/**
 * Obtener métricas del dashboard principal
 * GET /api/v1/multas/dashboard
 */
const obtenerMetricasDashboard = async (req, res, next) => {
  try {
    const {
      periodo = '30days' // 7days, 30days, 90days, year
    } = req.query;

    // Calcular fechas según el periodo
    const ahora = new Date();
    let fechaInicio;

    switch (periodo) {
      case '7days':
        fechaInicio = new Date(ahora.getTime() - DASHBOARD_PERIODS.DAYS_7 * TIME_CONSTANTS.MILLISECONDS_PER_DAY);
        break;
      case '90days':
        fechaInicio = new Date(ahora.getTime() - DASHBOARD_PERIODS.DAYS_90 * TIME_CONSTANTS.MILLISECONDS_PER_DAY);
        break;
      case 'year':
        fechaInicio = new Date(ahora.getFullYear(), 0, 1);
        break;
      case '30days':
      default:
        fechaInicio = new Date(ahora.getTime() - DASHBOARD_PERIODS.DAYS_30 * TIME_CONSTANTS.MILLISECONDS_PER_DAY);
        break;
    }

    // Las agregaciones (metricas generales, top infracciones, evolucion diaria)
    // viven en el modelo. El controller solo coordina request -> respuesta
    const {
      metricasGenerales,
      topInfracciones,
      evolucionDiaria
    } = await Multa.getDashboardMetrics(fechaInicio, ahora);

    const metricsGeneral = metricasGenerales;

    const responseData = {
      periodo: {
        descripcion: periodo,
        fechaInicio,
        fechaFin: ahora
      },
      metricas: {
        general: metricsGeneral || {
          totalMultas: 0,
          importeTotal: 0,
          puntosTotal: 0,
          multasGraves: 0,
          multasConDescuento: 0,
          multasVelocidad: 0
        },
        topInfracciones,
        evolucionDiaria
      },
      resumen: {
        porcentajeGraves: metricsGeneral && metricsGeneral.totalMultas > 0 ?
          (metricsGeneral.multasGraves / metricsGeneral.totalMultas * 100).toFixed(2) : 0,
        importePromedioPorMulta: metricsGeneral && metricsGeneral.totalMultas > 0 ?
          (metricsGeneral.importeTotal / metricsGeneral.totalMultas).toFixed(2) : 0,
        puntosPromedioPorMulta: metricsGeneral && metricsGeneral.totalMultas > 0 ?
          (metricsGeneral.puntosTotal / metricsGeneral.totalMultas).toFixed(2) : 0
      }
    };

    res.status(HTTP_STATUS.OK).json(createResponse(responseData, 'Métricas del dashboard obtenidas exitosamente'));

  } catch (error) {
    logger.error({
      error: error.message,
      stack: error.stack,
      query: req.query,
      endpoint: 'GET /api/v1/multas/dashboard'
    }, 'Error obteniendo métricas del dashboard');
    next(createInternalError('Error al obtener métricas', error));
  }
};

/**
 * Obtener multas como FeatureCollection GeoJSON. Solo se incluyen las
 * multas cuyo CSV trae coordenadas UTM validas (la geometry WGS84 se
 * deriva en el importador).
 *
 * GET /api/v1/multas/mapa
 *
 * Devuelve un FeatureCollection GeoJSON con multas georreferenciadas para
 * renderizar en el mapa del frontend.
 *
 * Query params soportados:
 *   - startDate, endDate, calificacion, tipoInfraccion: filtros de dominio
 *   - bbox: 'minLng,minLat,maxLng,maxLat' (filtro espacial directo)
 *   - distrito: codigo (1-21) o nombre del distrito. Cuando se proporciona,
 *     y NO hay bbox explicito, se deriva un bbox aproximado a partir del
 *     centroide del distrito (cuadrado de `radioKm` km, default 4 km).
 *     Util para vistas cross-domain "por distrito" donde Multas no tiene
 *     campo distrito normalizado y un filtro `lugar` regex daria falsos
 *     positivos. Ver `bboxDeDistrito` para limitaciones de la aproximacion.
 *   - radioKm: radio en km para el bbox derivado de distrito (1-15, default 4)
 *   - limite: maximo de features (cap interno + validacion en route)
 */
const obtenerMapaMultas = async (req, res, next) => {
  try {
    const { bbox, limite, distrito: distritoQuery, radioKm: radioKmQuery } = req.query;

    const filterConfig = [
      { field: 'fecha', type: 'dateRange', params: ['startDate', 'endDate'] },
      { field: 'calificacion', type: 'exact', param: 'calificacion', transform: TRANSFORMS.toUpperCase },
      { field: 'metadatos.tipoInfraccion', type: 'exact', param: 'tipoInfraccion', transform: TRANSFORMS.toUpperCase }
    ];
    const filters = buildFilters(req.query, filterConfig);
    // Exigir coordinates validas (no solo geometry != null, porque
    // Mongoose guarda `{type:'Point'}` sin coordinates cuando el
    // subdoc existe pero esta incompleto).
    filters['geometry.coordinates'] = { $exists: true, $ne: null, $type: 'array' };

    // Resolver bbox efectivo: bbox explicito tiene prioridad. Si no, intentar
    // derivar desde el codigo/nombre de distrito.
    let bboxString = bbox;
    let distritoResuelto = null;
    let bboxOrigen = bbox ? 'explicit' : null;

    if (!bbox && distritoQuery) {
      const result = bboxDeDistrito(distritoQuery, radioKmQuery);
      if (result) {
        distritoResuelto = result.distrito;
        bboxString = result.bbox.join(',');
        bboxOrigen = `distrito:${result.distrito.codigo}:radio${result.radioKm}km`;
      }
    }

    if (bboxString) {
      const [minLng, minLat, maxLng, maxLat] = bboxString.split(',').map(Number);
      if ([minLng, minLat, maxLng, maxLat].every(v => Number.isFinite(v))) {
        filters.geometry = {
          $geoWithin: { $box: [[minLng, minLat], [maxLng, maxLat]] }
        };
      }
    }

    // Cap interno alineado con `MAP_LIMITS.DEFAULT_MAX` (la validacion previa
    // en routes/multas.js ya rechaza valores >1000, este cap es defense in
    // depth por si la ruta cambia en el futuro).
    const limit = Math.min(parseInt(limite, 10) || 1000, 1000);

    const docs = await Multa.find(filters, {
      _id: 1,
      fecha: 1,
      lugar: 1,
      calificacion: 1,
      importeBoletín: 1,
      puntosDetraídos: 1,
      geometry: 1,
      'metadatos.tipoInfraccion': 1
    })
      .sort({ fecha: -1 })
      .limit(limit)
      .maxTimeMS(MONGODB_TIMEOUTS.AGGREGATE_TIMEOUT_MS)
      .lean();

    const featureCollection = documentosAFeatureCollection(
      docs,
      (doc) => ({
        id: doc._id?.toString(),
        geometry: doc.geometry,
        properties: {
          fecha: doc.fecha,
          lugar: doc.lugar,
          calificacion: doc.calificacion,
          importe: doc.importeBoletín,
          puntos: doc.puntosDetraídos,
          tipoInfraccion: doc.metadatos?.tipoInfraccion
        }
      }),
      { recurso: 'multas', limite: limit }
    );

    // Anadir metadatos del bbox derivado para que el cliente sepa el origen
    // y pueda mostrarlo en UI ("Mostrando multas de Centro - aproximacion 4km")
    if (bboxOrigen) {
      featureCollection._meta = featureCollection._meta || {};
      featureCollection._meta.bboxOrigen = bboxOrigen;
      if (distritoResuelto) {
        featureCollection._meta.distrito = {
          codigo: distritoResuelto.codigo,
          nombre: distritoResuelto.nombre,
          centroide: distritoResuelto.coordenadas,
          aproximacion: 'bbox-cuadrado-desde-centroide'
        };
      }
    }

    res.status(HTTP_STATUS.OK).json(
      createResponse(featureCollection, 'Mapa de multas generado exitosamente')
    );

  } catch (error) {
    logger.error({ error: error.message, endpoint: 'GET /api/v1/multas/mapa' }, 'Error al generar mapa de multas');
    next(createInternalError('Error al generar mapa de multas', error));
  }
};

module.exports = {
  obtenerMultas,
  obtenerMultaPorId,
  obtenerEstadisticasMultas,
  obtenerRankingUbicaciones,
  obtenerAnalisisTemporal,
  obtenerMetricasDashboard,
  obtenerMapaMultas
};

