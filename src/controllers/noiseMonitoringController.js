/**
 * Controlador de Contaminación Acústica
 *
 * Maneja las operaciones CRUD y consultas para datos de contaminación acústica.
 * Incluye análisis por períodos del día, cumplimiento normativo y estadísticas.
 */

const { validationResult } = require('express-validator');
const NoiseMonitoring = require('../models/NoiseMonitoring');
const { AppError, createValidationError } = require('../utils/errorUtils');
const { parsePaginationParams, createPaginationMeta, parseDateRangeFilter } = require('../utils/paginationHelper');
const { buildFilters, buildSortOptions, buildPaginationOptions } = require('../utils/queryHelper');
const { SORT_FIELDS, PAGINATION } = require('../constants');

/**
 * Obtener datos de contaminación acústica con filtros
 * GET /api/v1/noise-monitoring
 */
const getNoiseMonitoringData = async (req, res, next) => {
  try {
    // Verificar errores de validación
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return next(createValidationError('Parámetros de consulta inválidos', errors.array()));
    }

    // Configuración de filtros usando queryHelper
    const filterConfig = [
      { field: 'fecha', type: 'dateRange', params: ['startDate', 'endDate'] },
      { field: 'año', type: 'numeric', param: 'año' },
      { field: 'mes', type: 'numeric', param: 'mes' },
      { field: 'nmt', type: 'in', param: 'nmt', transform: v => Array.isArray(v) ? v.map(n => parseInt(n)) : [parseInt(v)] },
      { field: 'nombre', type: 'regex', param: 'nombre' }
    ];

    const filters = buildFilters(req.query, filterConfig);

    // Filtro de calidad de datos
    if (req.query.includeInvalid !== 'true') {
      filters['dataQuality.hasValidData'] = true;
    }

    // Configurar ordenamiento usando queryHelper
    const sortOptions = buildSortOptions(
      req.query.sortBy || 'fecha',
      req.query.sortOrder || 'desc',
      ['fecha', 'nmt', 'nombre', 'laeq24', 'año', 'mes'],
      'fecha'
    );

    // Configurar paginación usando queryHelper
    const paginationOptions = buildPaginationOptions(req.query, {
      defaultLimit: PAGINATION.DEFAULT_LIMIT,
      maxLimit: PAGINATION.MAX_LIMIT
    });

    // Ejecutar consulta
    const [data, totalDocuments] = await Promise.all([
      NoiseMonitoring.find(filters)
        .sort(sortOptions)
        .skip(paginationOptions.skip)
        .limit(paginationOptions.limit)
        .select('-percentiles -dataQuality -processingInfo') // Excluir datos detallados por defecto
        .lean(),
      NoiseMonitoring.countDocuments(filters)
    ]);

    // Agregar información de cumplimiento normativo
    const dataWithCompliance = data.map(item => {
      const compliance = {
        diurno: item.nivelDiurno <= 65,
        vespertino: item.nivelVespertino <= 65,
        nocturno: item.nivelNocturno <= 55,
        global: item.nivelDiurno <= 65 && item.nivelVespertino <= 65 && item.nivelNocturno <= 55
      };

      return {
        ...item,
        cumplimientoNormativo: compliance
      };
    });

    const response = {
      success: true,
      message: 'Datos de contaminación acústica obtenidos exitosamente',
      data: dataWithCompliance,
      pagination: createPaginationMeta(paginationOptions.page, paginationOptions.limit, totalDocuments),
      filters: {
        applied: Object.keys(filters).length > 0 ? filters : null
      }
    };

    res.status(200).json(response);

  } catch (error) {
    console.error('Error obteniendo datos de contaminación acústica:', error);
    next(new AppError('Error interno del servidor al obtener datos', 500));
  }
};

/**
 * Obtener datos detallados de contaminación acústica por ID
 * GET /api/v1/noise-monitoring/:id
 */
const getNoiseMonitoringById = async (req, res, next) => {
  try {
    const { id } = req.params;

    const data = await NoiseMonitoring.findById(id).lean();

    if (!data) {
      return next(new AppError('Registro de contaminación acústica no encontrado', 404));
    }

    // Calcular análisis de cumplimiento normativo detallado
    const analisisNormativo = {
      limites: {
        diurno: { valor: 65, descripcion: 'Límite diurno (07:00-19:00)' },
        vespertino: { valor: 65, descripcion: 'Límite vespertino (19:00-23:00)' },
        nocturno: { valor: 55, descripcion: 'Límite nocturno (23:00-07:00)' }
      },
      cumplimiento: {
        diurno: {
          cumple: data.nivelDiurno ? data.nivelDiurno <= 65 : null,
          exceso: data.nivelDiurno ? Math.max(0, data.nivelDiurno - 65) : 0
        },
        vespertino: {
          cumple: data.nivelVespertino ? data.nivelVespertino <= 65 : null,
          exceso: data.nivelVespertino ? Math.max(0, data.nivelVespertino - 65) : 0
        },
        nocturno: {
          cumple: data.nivelNocturno ? data.nivelNocturno <= 55 : null,
          exceso: data.nivelNocturno ? Math.max(0, data.nivelNocturno - 55) : 0
        }
      }
    };

    // Determinar período más problemático
    const niveles = [
      { periodo: 'diurno', valor: data.nivelDiurno, limite: 65 },
      { periodo: 'vespertino', valor: data.nivelVespertino, limite: 65 },
      { periodo: 'nocturno', valor: data.nivelNocturno, limite: 55 }
    ].filter(n => n.valor !== null);

    const periodoMasProblematico = niveles.length > 0
      ? niveles.reduce((max, current) => {
          const excesoActual = Math.max(0, current.valor - current.limite);
          const excesoMax = Math.max(0, max.valor - max.limite);
          return excesoActual > excesoMax ? current : max;
        })
      : null;

    res.status(200).json({
      success: true,
      message: 'Detalles de contaminación acústica obtenidos exitosamente',
      data: {
        ...data,
        analisisNormativo,
        periodoMasProblematico,
        interpretacion: {
          laeq24: data.laeq24 ? `Nivel continuo equivalente de ${data.laeq24.toFixed(1)} dB durante 24h` : null,
          tendencia: data.percentiles ? {
            ruidoFondo: data.percentiles.las99, // Nivel superado el 99% del tiempo
            ruidoHabitual: data.percentiles.las50, // Mediana (50%)
            picos: data.percentiles.las01 // Nivel superado solo el 1% del tiempo
          } : null
        }
      }
    });

  } catch (error) {
    console.error('Error obteniendo detalles de contaminación acústica:', error);
    next(new AppError('Error interno del servidor', 500));
  }
};

/**
 * Obtener estadísticas de contaminación acústica
 * GET /api/v1/noise-monitoring/statistics
 */
const getNoiseStatistics = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return next(createValidationError('Parámetros de consulta inválidos', errors.array()));
    }

    const {
      startDate,
      endDate,
      nmt,
      groupBy = 'station' // station, month, year
    } = req.query;

    // Construir filtros usando queryHelper
    const filterConfig = [
      { field: 'fecha', type: 'dateRange', params: ['startDate', 'endDate'] },
      { field: 'nmt', type: 'numeric', param: 'nmt' }
    ];

    const matchStage = buildFilters(req.query, filterConfig);
    matchStage['dataQuality.hasValidData'] = true;

    // Configurar agrupación
    let groupByConfig = {};
    let sortStage = {};

    switch (groupBy) {
      case 'month':
        groupByConfig = { año: '$año', mes: '$mes' };
        sortStage = { '_id.año': -1, '_id.mes': -1 };
        break;

      case 'year':
        groupByConfig = { año: '$año' };
        sortStage = { '_id.año': -1 };
        break;

      case 'station':
      default:
        groupByConfig = { nmt: '$nmt', nombre: '$nombre' };
        sortStage = { '_id.nmt': 1 };
        break;
    }

    // Pipeline de agregación
    const pipeline = [
      { $match: matchStage },
      {
        $group: {
          _id: groupByConfig,
          promedioDiurno: { $avg: '$nivelDiurno' },
          promedioVespertino: { $avg: '$nivelVespertino' },
          promedioNocturno: { $avg: '$nivelNocturno' },
          promedioLaeq24: { $avg: '$laeq24' },
          maximoDiurno: { $max: '$nivelDiurno' },
          maximoVespertino: { $max: '$nivelVespertino' },
          maximoNocturno: { $max: '$nivelNocturno' },
          maximoLaeq24: { $max: '$laeq24' },
          minimoDiurno: { $min: '$nivelDiurno' },
          minimoVespertino: { $min: '$nivelVespertino' },
          minimoNocturno: { $min: '$nivelNocturno' },
          minimoLaeq24: { $min: '$laeq24' },
          totalMediciones: { $sum: 1 },
          // Calcular incumplimientos
          incumplimientosDiurnos: {
            $sum: { $cond: [{ $gt: ['$nivelDiurno', 65] }, 1, 0] }
          },
          incumplimientosVespertinos: {
            $sum: { $cond: [{ $gt: ['$nivelVespertino', 65] }, 1, 0] }
          },
          incumplimientosNocturnos: {
            $sum: { $cond: [{ $gt: ['$nivelNocturno', 55] }, 1, 0] }
          }
        }
      },
      {
        $addFields: {
          // Calcular porcentajes de cumplimiento
          cumplimientoDiurno: {
            $multiply: [
              { $divide: [
                { $subtract: ['$totalMediciones', '$incumplimientosDiurnos'] },
                '$totalMediciones'
              ]},
              100
            ]
          },
          cumplimientoVespertino: {
            $multiply: [
              { $divide: [
                { $subtract: ['$totalMediciones', '$incumplimientosVespertinos'] },
                '$totalMediciones'
              ]},
              100
            ]
          },
          cumplimientoNocturno: {
            $multiply: [
              { $divide: [
                { $subtract: ['$totalMediciones', '$incumplimientosNocturnos'] },
                '$totalMediciones'
              ]},
              100
            ]
          }
        }
      },
      { $sort: sortStage },
      { $limit: 200 }
    ];

    const estadisticas = await NoiseMonitoring.aggregate(pipeline);

    // Obtener resumen general
    const resumenGeneral = await NoiseMonitoring.aggregate([
      { $match: matchStage },
      {
        $group: {
          _id: null,
          totalRegistros: { $sum: 1 },
          estacionesUnicas: { $addToSet: '$nmt' },
          promedioGeneralLaeq24: { $avg: '$laeq24' },
          fechaInicio: { $min: '$fecha' },
          fechaFin: { $max: '$fecha' },
          totalIncumplimientos: {
            $sum: {
              $add: [
                { $cond: [{ $gt: ['$nivelDiurno', 65] }, 1, 0] },
                { $cond: [{ $gt: ['$nivelVespertino', 65] }, 1, 0] },
                { $cond: [{ $gt: ['$nivelNocturno', 55] }, 1, 0] }
              ]
            }
          }
        }
      }
    ]);

    const response = {
      success: true,
      message: 'Estadísticas de contaminación acústica obtenidas exitosamente',
      data: {
        estadisticas,
        resumen: resumenGeneral[0] ? {
          ...resumenGeneral[0],
          totalEstaciones: resumenGeneral[0].estacionesUnicas.length,
          porcentajeCumplimientoGeneral: resumenGeneral[0].totalRegistros > 0
            ? ((resumenGeneral[0].totalRegistros * 3 - resumenGeneral[0].totalIncumplimientos) / (resumenGeneral[0].totalRegistros * 3)) * 100
            : 0
        } : null,
        configuracion: {
          agrupacion: groupBy,
          filtros: Object.keys(matchStage).length > 1 ? matchStage : null
        },
        limitesNormativos: {
          diurno: 65,
          vespertino: 65,
          nocturno: 55,
          descripcion: 'Límites en decibelios (dB) según normativa'
        }
      }
    };

    res.status(200).json(response);

  } catch (error) {
    console.error('Error obteniendo estadísticas de contaminación acústica:', error);
    next(new AppError('Error interno del servidor al calcular estadísticas', 500));
  }
};

/**
 * Obtener ranking de estaciones por nivel de ruido
 * GET /api/v1/noise-monitoring/ranking
 */
const getNoiseRanking = async (req, res, next) => {
  try {
    const {
      startDate,
      endDate,
      orderBy = 'laeq24', // laeq24, diurno, vespertino, nocturno
      limit = 20
    } = req.query;

    // Configuración de filtros usando queryHelper
    const filterConfig = [
      { field: 'fecha', type: 'dateRange', params: ['startDate', 'endDate'] }
    ];

    const matchStage = buildFilters(req.query, filterConfig);
    matchStage['dataQuality.hasValidData'] = true;

    // Configurar campo de ordenamiento
    const orderByField = {
      'diurno': '$nivelDiurno',
      'vespertino': '$nivelVespertino',
      'nocturno': '$nivelNocturno',
      'laeq24': '$laeq24'
    }[orderBy] || '$laeq24';

    const pipeline = [
      { $match: matchStage },
      {
        $group: {
          _id: { nmt: '$nmt', nombre: '$nombre' },
          promedioOrden: { $avg: orderByField },
          promedioDiurno: { $avg: '$nivelDiurno' },
          promedioVespertino: { $avg: '$nivelVespertino' },
          promedioNocturno: { $avg: '$nivelNocturno' },
          promedioLaeq24: { $avg: '$laeq24' },
          maximoRegistrado: { $max: orderByField },
          totalMediciones: { $sum: 1 },
          ultimaMedicion: { $max: '$fecha' }
        }
      },
      {
        $addFields: {
          cumplimientoGeneral: {
            $cond: [
              { $and: [
                { $lte: ['$promedioDiurno', 65] },
                { $lte: ['$promedioVespertino', 65] },
                { $lte: ['$promedioNocturno', 55] }
              ]},
              'CUMPLE',
              'NO_CUMPLE'
            ]
          }
        }
      },
      { $sort: { promedioOrden: -1 } }, // Descendente (más ruidosos primero)
      { $limit: parseInt(limit) }
    ];

    const ranking = await NoiseMonitoring.aggregate(pipeline);

    const response = {
      success: true,
      message: 'Ranking de contaminación acústica obtenido exitosamente',
      data: {
        ranking,
        configuracion: {
          ordenadoPor: orderBy,
          descripcion: {
            'laeq24': 'Nivel continuo equivalente 24h',
            'diurno': 'Nivel diurno (07:00-19:00)',
            'vespertino': 'Nivel vespertino (19:00-23:00)',
            'nocturno': 'Nivel nocturno (23:00-07:00)'
          }[orderBy],
          limite: parseInt(limit)
        },
        interpretacion: {
          orden: 'Descendente (de mayor a menor nivel de ruido)',
          cumplimiento: {
            'CUMPLE': 'Cumple con todos los límites normativos',
            'NO_CUMPLE': 'Excede al menos un límite normativo'
          }
        }
      }
    };

    res.status(200).json(response);

  } catch (error) {
    console.error('Error obteniendo ranking de contaminación acústica:', error);
    next(new AppError('Error interno del servidor al generar ranking', 500));
  }
};

/**
 * Buscar estaciones de monitoreo
 * GET /api/v1/noise-monitoring/stations/search
 */
const searchStations = async (req, res, next) => {
  try {
    const { q: searchTerm, limit = 20 } = req.query;

    if (!searchTerm || searchTerm.trim().length < 2) {
      return next(new AppError('Término de búsqueda debe tener al menos 2 caracteres', 400));
    }

    const pipeline = [
      {
        $match: {
          $or: [
            { nombre: { $regex: searchTerm.trim(), $options: 'i' } },
            { nmt: isNaN(parseInt(searchTerm)) ? null : parseInt(searchTerm) }
          ].filter(Boolean)
        }
      },
      {
        $group: {
          _id: { nmt: '$nmt', nombre: '$nombre' },
          ultimaMedicion: { $max: '$fecha' },
          totalMediciones: { $sum: 1 },
          promedioLaeq24: { $avg: '$laeq24' }
        }
      },
      {
        $sort: { ultimaMedicion: -1 }
      },
      {
        $limit: parseInt(limit)
      }
    ];

    const estaciones = await NoiseMonitoring.aggregate(pipeline);

    res.status(200).json({
      success: true,
      message: `Encontradas ${estaciones.length} estaciones`,
      data: estaciones,
      busqueda: {
        termino: searchTerm,
        resultados: estaciones.length,
        limite: parseInt(limit)
      }
    });

  } catch (error) {
    console.error('Error buscando estaciones:', error);
    next(new AppError('Error interno del servidor en la búsqueda', 500));
  }
};

module.exports = {
  getNoiseMonitoringData,
  getNoiseMonitoringById,
  getNoiseStatistics,
  getNoiseRanking,
  searchStations
};
