/**
 * Modelo de Contaminación Acústica
 *
 * Esquema de Mongoose para almacenar y gestionar datos de contaminación acústica
 * provenientes de las estaciones de monitorización de ruido distribuidas por la ciudad.
 * Incluye niveles de ruido por periodos del día y estadísticas acústicas.
 */

const mongoose = require('mongoose');

/**
 * Esquema de Contaminación Acústica
 *
 * Basado en la estructura del CSV de contaminación acústica:
 * - Fecha: periodo de medición (mes-año)
 * - NMT: número de estación de monitorización
 * - Nombre: nombre descriptivo de la ubicación
 * - Ld, Le, Ln: niveles por periodo (diurno, vespertino, nocturno)
 * - LAeq24: nivel equivalente de 24 horas
 * - LAS01-LAS99: percentiles estadísticos
 */
const noiseMonitoringSchema = new mongoose.Schema({
  // Información temporal
  fecha: {
    type: Date,
    required: true
  },

  mes: {
    type: Number,
    required: true
  },

  año: {
    type: Number,
    required: true
  },

  // Identificación de la estación
  nmt: {
    type: Number,
    required: true
  },

  nombre: {
    type: String,
    required: true,
    trim: true
  },

  // Niveles de ruido por periodo (en decibelios)
  nivelDiurno: { // Ld: 07:00 - 19:00
    type: Number,
    required: false
  },

  nivelVespertino: { // Le: 19:00 - 23:00
    type: Number,
    required: false
  },

  nivelNocturno: { // Ln: 23:00 - 07:00
    type: Number,
    required: false
  },

  // Nivel equivalente continuo de 24 horas
  laeq24: {
    type: Number,
    required: false
  },

  // Percentiles estadísticos (LAS01, LAS10, LAS50, LAS90, LAS99)
  percentiles: {
    las01: { // Percentil 1 (superado el 1% del tiempo)
      type: Number,
      required: false
    },
    las10: { // Percentil 10 (superado el 10% del tiempo)
      type: Number,
      required: false
    },
    las50: { // Percentil 50 (mediana)
      type: Number,
      required: false
    },
    las90: { // Percentil 90 (superado el 90% del tiempo)
      type: Number,
      required: false
    },
    las99: { // Percentil 99 (ruido de fondo)
      type: Number,
      required: false
    }
  },

  // Metadatos de calidad y procesamiento
  dataQuality: {
    hasValidData: {
      type: Boolean,
      default: true
    },
    missingFields: [{
      type: String,
      enum: ['nivelDiurno', 'nivelVespertino', 'nivelNocturno', 'laeq24', 'percentiles']
    }],
    qualityScore: {
      type: Number,
      default: 1
    }
  },

  // Información de procesamiento
  processingInfo: {
    importedAt: {
      type: Date,
      default: Date.now
    },
    sourceFile: {
      type: String,
      trim: true
    }
  }

}, {
  timestamps: true,
  versionKey: false
});

/**
 * Índices para optimización de consultas
 */
// Índice único para evitar duplicados
noiseMonitoringSchema.index(
  { nmt: 1, año: 1, mes: 1 },
  { unique: true, name: 'unique_station_period' }
);

// Índice de texto para búsqueda por nombre de estación
noiseMonitoringSchema.index({ nombre: 'text' }, {
  name: 'idx_noise_text_search',
  background: true
});

// Índice compuesto estacion (nmt) + fecha (consultas por estación específica)
// Usado en: GET /api/noise-monitoring?nmt=X&fecha=Y, series temporales por estación
noiseMonitoringSchema.index({ nmt: 1, fecha: 1 }, {
  name: 'idx_noise_station_timeline',
  background: true
});

// Índice compuesto fecha + nivelSonoro (identificación de picos de ruido)
// Usado en: alertas de contaminación acústica, búsqueda de niveles extremos
// Usaremos laeq24 como representante del nivel sonoro general
noiseMonitoringSchema.index({ fecha: 1, laeq24: 1 }, {
  name: 'idx_noise_date_level_alerts',
  background: true,
  sparse: true // Solo documentos con laeq24 válido
});

// Índice compuesto año + mes + nombre para búsquedas por nombre de estación en periodo
// Usado en: búsquedas por nombre de ubicación y rango temporal específico
// Ejemplo: GET /api/noise-monitoring?nombre=CENTRO&año=2051&mes=1
noiseMonitoringSchema.index({ año: 1, mes: 1, nombre: 1 }, {
  name: 'idx_noise_period_station_name',
  background: true
});

// Índice compuesto para análisis de cumplimiento normativo
// Usado en: agregaciones para detectar incumplimientos y estadísticas de calidad
// Ejemplo: Queries que filtran por fecha y niveles de ruido superiores a límites
noiseMonitoringSchema.index({ fecha: 1, nivelDiurno: 1, nivelNocturno: 1 }, {
  name: 'idx_noise_compliance_analysis',
  background: true,
  sparse: true // Solo documentos con datos válidos
});

// Índice para consultas recientes por estación con nivel de ruido
// Usado en: dashboards en tiempo real, alertas de niveles altos recientes
// Ejemplo: SELECT * FROM noise WHERE fecha >= recent ORDER BY laeq24 DESC
noiseMonitoringSchema.index({ fecha: -1, laeq24: -1 }, {
  name: 'idx_noise_recent_levels',
  background: true,
  sparse: true
});

// Índice compuesto para búsqueda por nombre de estación y rango de fechas
// Usado en: series temporales específicas de una estación por nombre
// Ejemplo: GET /api/noise-monitoring?nombre=PLAZA%20MAYOR&startDate=X&endDate=Y
noiseMonitoringSchema.index({ nombre: 1, fecha: -1 }, {
  name: 'idx_noise_station_name_timeline',
  background: true
});

/**
 * Middleware pre-save para procesamiento de calidad de datos
 */
noiseMonitoringSchema.pre('save', function(next) {
  const missingFields = [];
  let validFields = 0;
  const totalFields = 5; // nivelDiurno, nivelVespertino, nivelNocturno, laeq24, percentiles

  // Verificar campos principales
  if (this.nivelDiurno === null || this.nivelDiurno === undefined) {
    missingFields.push('nivelDiurno');
  } else {
    validFields++;
  }

  if (this.nivelVespertino === null || this.nivelVespertino === undefined) {
    missingFields.push('nivelVespertino');
  } else {
    validFields++;
  }

  if (this.nivelNocturno === null || this.nivelNocturno === undefined) {
    missingFields.push('nivelNocturno');
  } else {
    validFields++;
  }

  if (this.laeq24 === null || this.laeq24 === undefined) {
    missingFields.push('laeq24');
  } else {
    validFields++;
  }

  // Verificar percentiles
  const percentileFields = ['las01', 'las10', 'las50', 'las90', 'las99'];
  const validPercentiles = percentileFields.filter(field =>
    this.percentiles[field] !== null && this.percentiles[field] !== undefined
  );

  if (validPercentiles.length === 0) {
    missingFields.push('percentiles');
  } else {
    validFields++;
  }

  // Actualizar metadatos de calidad
  this.dataQuality.missingFields = missingFields;
  this.dataQuality.hasValidData = validFields > 0;
  this.dataQuality.qualityScore = validFields / totalFields;

  next();
});

/**
 * Método para verificar si los niveles cumplen con normativas
 * @returns {Object} Resultado de evaluación normativa
 */
noiseMonitoringSchema.methods.evaluateComplianceRules = function() {
  const compliance = {
    diurno: { value: this.nivelDiurno, compliant: null, limit: 65 },
    vespertino: { value: this.nivelVespertino, compliant: null, limit: 65 },
    nocturno: { value: this.nivelNocturno, compliant: null, limit: 55 },
    global: { compliant: true }
  };

  // Evaluar cumplimiento por periodo (límites ejemplo - ajustar según normativa local)
  if (this.nivelDiurno !== null) {
    compliance.diurno.compliant = this.nivelDiurno <= compliance.diurno.limit;
  }

  if (this.nivelVespertino !== null) {
    compliance.vespertino.compliant = this.nivelVespertino <= compliance.vespertino.limit;
  }

  if (this.nivelNocturno !== null) {
    compliance.nocturno.compliant = this.nivelNocturno <= compliance.nocturno.limit;
  }

  // Evaluar cumplimiento global
  compliance.global.compliant = [
    compliance.diurno.compliant,
    compliance.vespertino.compliant,
    compliance.nocturno.compliant
  ].every(c => c === null || c === true);

  return compliance;
};

/**
 * Método para obtener el nivel más alto del día
 * @returns {Object} Información del nivel máximo
 */
noiseMonitoringSchema.methods.getMaxDailyLevel = function() {
  const levels = [
    { periodo: 'diurno', valor: this.nivelDiurno },
    { periodo: 'vespertino', valor: this.nivelVespertino },
    { periodo: 'nocturno', valor: this.nivelNocturno }
  ].filter(l => l.valor !== null && l.valor !== undefined);

  if (levels.length === 0) {
    return { periodo: null, valor: null };
  }

  return levels.reduce((max, current) =>
    current.valor > max.valor ? current : max
  );
};

/**
 * Método estático para obtener estadísticas por estación
 */
noiseMonitoringSchema.statics.getStationStatistics = function(nmt, startDate, endDate) {
  return this.aggregate([
    {
      $match: {
        nmt: nmt,
        fecha: { $gte: startDate, $lte: endDate }
      }
    },
    {
      $group: {
        _id: '$nmt',
        nombre: { $first: '$nombre' },
        promedioLaeq24: { $avg: '$laeq24' },
        maximoLaeq24: { $max: '$laeq24' },
        minimoLaeq24: { $min: '$laeq24' },
        promedioDiurno: { $avg: '$nivelDiurno' },
        promedioVespertino: { $avg: '$nivelVespertino' },
        promedioNocturno: { $avg: '$nivelNocturno' },
        totalMediciones: { $sum: 1 }
      }
    }
  ]);
};

/**
 * Método estático para buscar estaciones por zona o nombre
 */
noiseMonitoringSchema.statics.searchStations = function(searchTerm) {
  return this.aggregate([
    {
      $match: {
        $text: { $search: searchTerm }
      }
    },
    {
      $group: {
        _id: '$nmt',
        nombre: { $first: '$nombre' },
        ultimaMedicion: { $max: '$fecha' },
        totalMediciones: { $sum: 1 }
      }
    },
    {
      $sort: { ultimaMedicion: -1 }
    }
  ]);
};

/**
 * Constantes de límites normativos de ruido (dB)
 */
noiseMonitoringSchema.statics.LIMITES_NORMATIVOS = {
  DIURNO: 65,
  VESPERTINO: 65,
  NOCTURNO: 55
};

/**
 * Obtener estadísticas agregadas con cumplimiento normativo
 * @param {Object} filters - Filtros de fecha y estación
 * @param {String} groupBy - Agrupación: 'station', 'month', 'year'
 * @returns {Promise<Object>} Estadísticas y resumen
 */
noiseMonitoringSchema.statics.getStatisticsOptimized = async function(filters, groupBy = 'station') {
  const matchStage = { ...filters, 'dataQuality.hasValidData': true };

  // Configurar agrupación
  const groupByConfig = {
    station: { nmt: '$nmt', nombre: '$nombre' },
    month: { año: '$año', mes: '$mes' },
    year: { año: '$año' }
  }[groupBy] || { nmt: '$nmt', nombre: '$nombre' };

  const sortStage = {
    station: { '_id.nmt': 1 },
    month: { '_id.año': -1, '_id.mes': -1 },
    year: { '_id.año': -1 }
  }[groupBy] || { '_id.nmt': 1 };

  const { DIURNO, VESPERTINO, NOCTURNO } = this.LIMITES_NORMATIVOS;

  // Pipeline de agregación optimizado
  const [estadisticas, resumenGeneral] = await Promise.all([
    // Estadísticas por grupo
    this.aggregate([
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
          incumplimientosDiurnos: { $sum: { $cond: [{ $gt: ['$nivelDiurno', DIURNO] }, 1, 0] } },
          incumplimientosVespertinos: { $sum: { $cond: [{ $gt: ['$nivelVespertino', VESPERTINO] }, 1, 0] } },
          incumplimientosNocturnos: { $sum: { $cond: [{ $gt: ['$nivelNocturno', NOCTURNO] }, 1, 0] } }
        }
      },
      {
        $addFields: {
          cumplimientoDiurno: {
            $multiply: [
              { $divide: [{ $subtract: ['$totalMediciones', '$incumplimientosDiurnos'] }, '$totalMediciones'] },
              100
            ]
          },
          cumplimientoVespertino: {
            $multiply: [
              { $divide: [{ $subtract: ['$totalMediciones', '$incumplimientosVespertinos'] }, '$totalMediciones'] },
              100
            ]
          },
          cumplimientoNocturno: {
            $multiply: [
              { $divide: [{ $subtract: ['$totalMediciones', '$incumplimientosNocturnos'] }, '$totalMediciones'] },
              100
            ]
          }
        }
      },
      { $sort: sortStage },
      { $limit: 200 }
    ]),

    // Resumen general
    this.aggregate([
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
                { $cond: [{ $gt: ['$nivelDiurno', DIURNO] }, 1, 0] },
                { $cond: [{ $gt: ['$nivelVespertino', VESPERTINO] }, 1, 0] },
                { $cond: [{ $gt: ['$nivelNocturno', NOCTURNO] }, 1, 0] }
              ]
            }
          }
        }
      }
    ])
  ]);

  const resumen = resumenGeneral[0] ? {
    ...resumenGeneral[0],
    totalEstaciones: resumenGeneral[0].estacionesUnicas.length,
    porcentajeCumplimientoGeneral: resumenGeneral[0].totalRegistros > 0
      ? ((resumenGeneral[0].totalRegistros * 3 - resumenGeneral[0].totalIncumplimientos) / (resumenGeneral[0].totalRegistros * 3)) * 100
      : 0
  } : null;

  return { estadisticas, resumen };
};

/**
 * Obtener ranking de estaciones por nivel de ruido
 * @param {Object} filters - Filtros de fecha
 * @param {String} sortBy - Campo de ordenación: 'laeq24', 'diurno', 'vespertino', 'nocturno'
 * @param {Number} limit - Límite de resultados
 * @returns {Promise<Array>} Ranking de estaciones
 */
noiseMonitoringSchema.statics.getRankingOptimized = function(filters, sortBy = 'laeq24', limit = 20) {
  const matchStage = { ...filters, 'dataQuality.hasValidData': true };

  const sortField = {
    laeq24: '$promedioLaeq24',
    diurno: '$promedioDiurno',
    vespertino: '$promedioVespertino',
    nocturno: '$promedioNocturno'
  }[sortBy] || '$promedioLaeq24';

  const pipeline = [
    { $match: matchStage },
    {
      $group: {
        _id: { nmt: '$nmt', nombre: '$nombre' },
        promedioLaeq24: { $avg: '$laeq24' },
        promedioDiurno: { $avg: '$nivelDiurno' },
        promedioVespertino: { $avg: '$nivelVespertino' },
        promedioNocturno: { $avg: '$nivelNocturno' },
        maximoLaeq24: { $max: '$laeq24' },
        totalMediciones: { $sum: 1 },
        fechaInicio: { $min: '$fecha' },
        fechaFin: { $max: '$fecha' }
      }
    },
    { $sort: { [sortField.substring(1)]: -1 } },
    { $limit: limit }
  ];

  return this.aggregate(pipeline);
};

/**
 * Calcular cumplimiento normativo para un registro
 * @param {Object} niveles - Objeto con nivelDiurno, nivelVespertino, nivelNocturno
 * @returns {Object} Objeto con cumplimiento por período
 */
noiseMonitoringSchema.statics.calcularCumplimientoNormativo = function(niveles) {
  const { DIURNO, VESPERTINO, NOCTURNO } = this.LIMITES_NORMATIVOS;

  return {
    diurno: niveles.nivelDiurno <= DIURNO,
    vespertino: niveles.nivelVespertino <= VESPERTINO,
    nocturno: niveles.nivelNocturno <= NOCTURNO,
    global: niveles.nivelDiurno <= DIURNO && niveles.nivelVespertino <= VESPERTINO && niveles.nivelNocturno <= NOCTURNO
  };
};

/**
 * Comparación entre estaciones de monitorización
 *
 * Compara niveles de ruido entre múltiples estaciones en un periodo determinado.
 * Utiliza el índice idx_noise_station_timeline para optimización.
 *
 * @param {Object} options - Opciones de comparación
 * @param {Array<Number>} options.stations - Array de NMT de estaciones a comparar
 * @param {Date} options.startDate - Fecha de inicio del periodo
 * @param {Date} options.endDate - Fecha de fin del periodo
 * @param {String} [options.metric='laeq24'] - Métrica a comparar: 'laeq24', 'nivelDiurno', 'nivelVespertino', 'nivelNocturno'
 * @returns {Promise<Array>} Array con datos comparativos de cada estación
 *
 * @example
 * const comparison = await NoiseMonitoring.getStationComparison({
 *   stations: [1, 2, 3],
 *   startDate: new Date('2051-01-01'),
 *   endDate: new Date('2051-12-31'),
 *   metric: 'laeq24'
 * });
 */
noiseMonitoringSchema.statics.getStationComparison = function(options) {
  const { stations, startDate, endDate, metric = 'laeq24' } = options;

  if (!stations || !Array.isArray(stations) || stations.length === 0) {
    throw new Error('Se requiere un array de estaciones para comparar');
  }

  if (!startDate || !endDate) {
    throw new Error('Se requieren fechas de inicio y fin');
  }

  const metricField = `$${metric}`;
  const matchStage = {
    nmt: { $in: stations },
    fecha: { $gte: startDate, $lte: endDate },
    [metric]: { $ne: null }
  };

  const pipeline = [
    { $match: matchStage },
    {
      $group: {
        _id: { nmt: '$nmt', nombre: '$nombre' },
        promedioNivel: { $avg: metricField },
        minimoNivel: { $min: metricField },
        maximoNivel: { $max: metricField },
        desviacionEstandar: { $stdDevPop: metricField },
        totalMediciones: { $sum: 1 },
        medicionesValidas: {
          $sum: { $cond: [{ $ne: [metricField, null] }, 1, 0] }
        }
      }
    },
    {
      $project: {
        nmt: '$_id.nmt',
        nombre: '$_id.nombre',
        promedioNivel: { $round: ['$promedioNivel', 2] },
        minimoNivel: { $round: ['$minimoNivel', 2] },
        maximoNivel: { $round: ['$maximoNivel', 2] },
        desviacionEstandar: { $round: ['$desviacionEstandar', 2] },
        totalMediciones: 1,
        medicionesValidas: 1,
        rangoVariacion: {
          $round: [{ $subtract: ['$maximoNivel', '$minimoNivel'] }, 2]
        },
        calidadDatos: {
          $round: [
            { $multiply: [{ $divide: ['$medicionesValidas', '$totalMediciones'] }, 100] },
            2
          ]
        },
        _id: 0
      }
    },
    { $sort: { promedioNivel: -1 } }
  ];

  return this.aggregate(pipeline);
};

/**
 * Análisis de tendencias temporales de ruido
 *
 * Analiza la evolución temporal de los niveles de ruido agrupados por diferentes
 * periodos (día, mes, año). Utiliza índices temporales para optimización.
 *
 * @param {Object} options - Opciones de análisis
 * @param {Number} [options.nmt] - NMT de estación específica (opcional)
 * @param {Date} options.startDate - Fecha de inicio del análisis
 * @param {Date} options.endDate - Fecha de fin del análisis
 * @param {String} [options.groupBy='month'] - Agrupación temporal: 'day', 'month', 'year'
 * @param {String} [options.metric='laeq24'] - Métrica a analizar
 * @returns {Promise<Array>} Array con tendencias temporales
 *
 * @example
 * const trends = await NoiseMonitoring.getTemporalTrends({
 *   nmt: 1,
 *   startDate: new Date('2051-01-01'),
 *   endDate: new Date('2051-12-31'),
 *   groupBy: 'month',
 *   metric: 'laeq24'
 * });
 */
noiseMonitoringSchema.statics.getTemporalTrends = function(options) {
  const { nmt, startDate, endDate, groupBy = 'month', metric = 'laeq24' } = options;

  if (!startDate || !endDate) {
    throw new Error('Se requieren fechas de inicio y fin');
  }

  const matchStage = {
    fecha: { $gte: startDate, $lte: endDate },
    [metric]: { $ne: null }
  };

  if (nmt) {
    matchStage.nmt = nmt;
  }

  const metricField = `$${metric}`;

  // Definir agrupación según el periodo
  let groupId;
  let sortField;

  switch (groupBy) {
    case 'day':
      groupId = {
        año: '$año',
        mes: '$mes',
        dia: { $dayOfMonth: '$fecha' }
      };
      sortField = { 'periodo.año': 1, 'periodo.mes': 1, 'periodo.dia': 1 };
      break;
    case 'year':
      groupId = { año: '$año' };
      sortField = { 'periodo.año': 1 };
      break;
    case 'month':
    default:
      groupId = { año: '$año', mes: '$mes' };
      sortField = { 'periodo.año': 1, 'periodo.mes': 1 };
      break;
  }

  const pipeline = [
    { $match: matchStage },
    {
      $group: {
        _id: groupId,
        promedioNivel: { $avg: metricField },
        minimoNivel: { $min: metricField },
        maximoNivel: { $max: metricField },
        desviacionEstandar: { $stdDevPop: metricField },
        totalMediciones: { $sum: 1 },
        estacionesUnicas: { $addToSet: '$nmt' }
      }
    },
    {
      $project: {
        _id: 0,
        periodo: '$_id',
        promedioNivel: { $round: ['$promedioNivel', 2] },
        minimoNivel: { $round: ['$minimoNivel', 2] },
        maximoNivel: { $round: ['$maximoNivel', 2] },
        desviacionEstandar: { $round: ['$desviacionEstandar', 2] },
        rangoVariacion: {
          $round: [{ $subtract: ['$maximoNivel', '$minimoNivel'] }, 2]
        },
        totalMediciones: 1,
        totalEstaciones: { $size: '$estacionesUnicas' }
      }
    },
    { $sort: sortField }
  ];

  return this.aggregate(pipeline);
};

/**
 * Análisis de cumplimiento normativo por zona
 *
 * Analiza el cumplimiento de límites normativos de ruido por estación y periodo.
 * Calcula porcentajes de cumplimiento y detecta incumplimientos críticos.
 * Utiliza el índice idx_noise_compliance_analysis para optimización.
 *
 * @param {Object} options - Opciones de análisis
 * @param {Date} options.startDate - Fecha de inicio del análisis
 * @param {Date} options.endDate - Fecha de fin del análisis
 * @param {Array<Number>} [options.stations] - Array de NMT específicos (opcional)
 * @returns {Promise<Object>} Objeto con análisis de cumplimiento y estadísticas
 *
 * @example
 * const compliance = await NoiseMonitoring.getComplianceAnalysisByZone({
 *   startDate: new Date('2051-01-01'),
 *   endDate: new Date('2051-12-31'),
 *   stations: [1, 2, 3]
 * });
 */
noiseMonitoringSchema.statics.getComplianceAnalysisByZone = async function(options) {
  const { startDate, endDate, stations } = options;

  if (!startDate || !endDate) {
    throw new Error('Se requieren fechas de inicio y fin');
  }

  const { DIURNO, VESPERTINO, NOCTURNO } = this.LIMITES_NORMATIVOS;
  const matchStage = { fecha: { $gte: startDate, $lte: endDate } };

  if (stations && Array.isArray(stations) && stations.length > 0) {
    matchStage.nmt = { $in: stations };
  }

  const buildComplianceCondition = (field, limit) => ({
    cumple: {
      $sum: {
        $cond: [{ $and: [{ $ne: [`$${field}`, null] }, { $lte: [`$${field}`, limit] }] }, 1, 0]
      }
    },
    incumple: {
      $sum: {
        $cond: [{ $and: [{ $ne: [`$${field}`, null] }, { $gt: [`$${field}`, limit] }] }, 1, 0]
      }
    },
    promedio: { $avg: `$${field}` },
    maximo: { $max: `$${field}` }
  });

  const estaciones = await this.aggregate([
    { $match: matchStage },
    {
      $group: {
        _id: { nmt: '$nmt', nombre: '$nombre' },
        totalMediciones: { $sum: 1 },
        ...buildComplianceCondition('nivelDiurno', DIURNO),
        ...buildComplianceCondition('nivelVespertino', VESPERTINO),
        ...buildComplianceCondition('nivelNocturno', NOCTURNO),
        promedioLaeq24: { $avg: '$laeq24' }
      }
    },
    {
      $project: {
        _id: 0,
        nmt: '$_id.nmt',
        nombre: '$_id.nombre',
        totalMediciones: 1,
        cumplimiento: {
          diurno: {
            cumple: '$cumple',
            incumple: '$incumple',
            porcentaje: {
              $round: [{
                $multiply: [{ $divide: ['$cumple', { $add: ['$cumple', '$incumple'] }] }, 100]
              }, 2]
            },
            limite: DIURNO,
            promedio: { $round: ['$promedio', 2] },
            maximo: { $round: ['$maximo', 2] }
          }
        },
        promedioGeneralLaeq24: { $round: ['$promedioLaeq24', 2] }
      }
    }
  ]);

  const resumenGlobal = {
    totalEstaciones: estaciones.length,
    cumplimientoPromedioGlobal: estaciones.length > 0
      ? Math.round(estaciones.reduce((sum, e) => sum + (e.cumplimiento?.diurno?.porcentaje || 0), 0) / estaciones.length * 100) / 100
      : 0,
    periodo: { inicio: startDate, fin: endDate },
    limites: { diurno: DIURNO, vespertino: VESPERTINO, nocturno: NOCTURNO }
  };

  return { estaciones, resumen: resumenGlobal };
};

// Crear y exportar el modelo
const NoiseMonitoring = mongoose.model('NoiseMonitoring', noiseMonitoringSchema);

module.exports = NoiseMonitoring;
