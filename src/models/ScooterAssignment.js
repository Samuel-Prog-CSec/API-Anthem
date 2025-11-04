/**
 * Modelo de Asignación de Patinetes
 *
 * Esquema de Mongoose para almacenar y gestionar la distribución de patinetes
 * eléctricos por distrito y barrio, incluyendo información por proveedor y
 * estadísticas de disponibilidad para optimización del servicio urbano.
 */

const mongoose = require('mongoose');
const { validateFechaNoFutura, validateMes, validateAño } = require('./schemas/commonSchemas');

/**
 * Sub-esquema para datos de un proveedor específico
 */
const proveedorSchema = new mongoose.Schema({
  nombre: {
    type: String,
    required: true,
    trim: true
  },
  cantidad: {
    type: Number,
    required: true,
    min: [0, 'La cantidad de patinetes no puede ser negativa']
  },
  activo: {
    type: Boolean,
    default: true
  }
}, { _id: false });

/**
 * Esquema principal de Asignación de Patinetes
 *
 * Basado en la estructura del CSV de asignación de patinetes:
 * - DISTRITO: nombre del distrito
 * - BARRIO: nombre del barrio
 * - [Proveedores]: cantidad de patinetes por cada proveedor
 * - TOTAL: total de patinetes en el área
 */
const scooterAssignmentSchema = new mongoose.Schema({
  // Información temporal
  fechaAsignacion: {
    type: Date,
    required: true,
    default: Date.now,
    index: true,
    validate: {
      validator: validateFechaNoFutura,
      message: 'La fecha de asignación no puede ser futura'
    }
  },

  // Información geográfica administrativa
  distrito: {
    nombre: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      index: true
    }
  },

  barrio: {
    nombre: {
      type: String,
      required: true,
      trim: true,
      index: true
    }
  },

  // Lista de proveedores y sus asignaciones
  proveedores: {
    type: [proveedorSchema],
    required: true,
    validate: {
      validator: function(v) {
        return Array.isArray(v) && v.length > 0;
      },
      message: 'Debe haber al menos un proveedor'
    }
  },

  // Estadísticas calculadas automáticamente
  estadisticas: {
    totalPatinetes: {
      type: Number,
      required: true,
      index: true,
      min: [0, 'El total de patinetes no puede ser negativo'],
      validate: {
        validator: function(value) {
          // Validar que totalPatinetes coincida con la suma de proveedores
          const sumaProveedores = this.proveedores.reduce((sum, p) => sum + p.cantidad, 0);
          return value === sumaProveedores;
        },
        message: 'El total de patinetes debe coincidir con la suma de todos los proveedores'
      }
    },
    totalProveedores: {
      type: Number
    },
    proveedoresActivos: {
      type: Number
    },
    promedioPatinetesPorProveedor: {
      type: Number
    },
    densidadPatinetes: {
      type: String,
      enum: ['BAJA', 'MEDIA', 'ALTA', 'MUY_ALTA'],
      default: 'MEDIA'
    },
    dominanciaProveedores: {
      type: String,
      enum: ['EQUILIBRADA', 'MONOPOLIO', 'DUOPOLIO', 'OLIGOPOLIO'],
      default: 'EQUILIBRADA'
    }
  },

  // Análisis de distribución
  analisisDistribucion: {
    proveedorDominante: {
      nombre: String,
      cantidad: Number,
      porcentaje: Number
    },
    proveedorSecundario: {
      nombre: String,
      cantidad: Number,
      porcentaje: Number
    },
    indiceHerfindahl: {
      type: Number
    },
    concentracionMercado: {
      type: String,
      enum: ['COMPETITIVA', 'MODERADA', 'CONCENTRADA', 'ALTA_CONCENTRACION'],
      default: 'COMPETITIVA'
    }
  },

  // Clasificación de área urbana
  clasificacionArea: {
    tipoZona: {
      type: String,
      enum: [
        'CENTRO_URBANO',
        'ZONA_COMERCIAL',
        'ZONA_RESIDENCIAL',
        'ZONA_UNIVERSITARIA',
        'ZONA_TURISTICA',
        'ZONA_EMPRESARIAL',
        'PERIFERIA',
        'ZONA_TRANSPORTE'
      ],
      default: 'ZONA_RESIDENCIAL'
    },
    prioridadServicio: {
      type: String,
      enum: ['BAJA', 'MEDIA', 'ALTA', 'CRITICA'],
      default: 'MEDIA'
    },
    demandaEstimada: {
      type: String,
      enum: ['BAJA', 'MEDIA', 'ALTA', 'MUY_ALTA'],
      default: 'MEDIA'
    }
  },

  // Metadatos de calidad y control
  metadatos: {
    calidadDatos: {
      esCompleto: {
        type: Boolean,
        default: true
      },
      camposFaltantes: [{
        type: String,
        enum: ['proveedores', 'ubicacion', 'totales']
      }],
      puntuacionCalidad: {
        type: Number,
        default: 1
      }
    },
    validacionDatos: {
      sumaCorrecta: {
        type: Boolean,
        default: true
      },
      proveedoresDuplicados: {
        type: Boolean,
        default: false
      },
      datosConsistentes: {
        type: Boolean,
        default: true
      }
    }
  },

  // Información de procesamiento
  procesamiento: {
    importadoEn: {
      type: Date,
      default: Date.now
    },
    archivoOrigen: {
      type: String,
      trim: true
    },
    versionDatos: {
      type: String,
      default: '1.0'
    },
    ultimaActualizacion: {
      type: Date,
      default: Date.now
    }
  }

}, {
  timestamps: true,
  versionKey: false
});

/**
 * Índices para optimización de consultas
 */

// ========================================
// ÍNDICE ÚNICO - Prevención de duplicados
// ========================================
// Garantiza que no haya asignaciones duplicadas para mismo distrito+barrio+fecha
// Combinación: distrito.nombre + barrio.nombre + fechaAsignacion
// CRÍTICO: NO ELIMINAR
scooterAssignmentSchema.index(
  {
    'distrito.nombre': 1,
    'barrio.nombre': 1,
    fechaAsignacion: 1
  },
  { unique: true, name: 'unique_scooter_assignment' }
);

// ========================================
// ÍNDICES PRINCIPALES - Consultas frecuentes
// ========================================

// Índice compuesto: fecha (desc) + distrito
// Usado en: GET /api/scooter-assignments?distrito=X
// Sort por fecha descendente (datos más recientes primero)
scooterAssignmentSchema.index({ fechaAsignacion: -1, 'distrito.nombre': 1 });

// Índice para ranking por total de patinetes
// Usado en: Zonas con mayor disponibilidad de patinetes
// Soporta: GET /api/scooter-assignments?sortBy=totalPatinetes&sortOrder=desc
scooterAssignmentSchema.index({ 'estadisticas.totalPatinetes': -1, fechaAsignacion: -1 });

// Índice para filtro por tipo de zona
// Usado en: GET /api/scooter-assignments?tipoZona=ALTA_DEMANDA
// Clasificación: ALTA_DEMANDA, MEDIA_DEMANDA, BAJA_DEMANDA, SATURADA
scooterAssignmentSchema.index({ 'clasificacionArea.tipoZona': 1, fechaAsignacion: -1 });

// Índice para densidad de patinetes
// Usado en: Análisis de concentración de patinetes por área
// Soporta: Cálculo de densidad (patinetes por km²)
scooterAssignmentSchema.index({ 'estadisticas.densidadPatinetes': 1 });

// ========================================
// ÍNDICES PARA ANÁLISIS DE MERCADO
// ========================================

// Índice para concentración de mercado (C4 - top 4 proveedores)
// Usado en: Análisis de competencia y monopolio
// Valores: 0-1 (1 = monopolio total)
scooterAssignmentSchema.index({ 'analisisDistribucion.concentracionMercado': 1 });

// Índice para Índice de Herfindahl-Hirschman (HHI)
// Usado en: Medición de concentración del mercado
// Valores: 0-10000 (>2500 = alta concentración)
scooterAssignmentSchema.index({ 'analisisDistribucion.indiceHerfindahl': -1 });

// ========================================
// ÍNDICES PARA ANÁLISIS POR PROVEEDOR
// ========================================

// Índice compuesto: proveedor + fecha
// Usado en: GET /api/scooter-assignments?proveedor=LIME
// Soporta: Series temporales por compañía específica
// NOTA: Array de proveedores, requiere desenrollado en agregaciones
scooterAssignmentSchema.index({ 'proveedores.nombre': 1, fechaAsignacion: -1 });

// Índice para ranking de proveedores por cantidad
// Usado en: Identificación de proveedores dominantes
// Soporta: "Top 5 proveedores por número de patinetes"
scooterAssignmentSchema.index({ 'proveedores.cantidad': -1 });

// ========================================
// ÍNDICES PARA AGREGACIONES TEMPORALES
// ========================================

// Índice compuesto: fecha + proveedor (análisis temporal específico)
// Usado en: ScooterAssignment métodos estáticos - Evolución por proveedor
// Soporta: "Crecimiento de LIME en últimos 6 meses"
scooterAssignmentSchema.index({ fechaAsignacion: 1, 'proveedores.nombre': 1 }, {
  name: 'idx_scooters_date_provider_analysis',
  background: true
});

// Índice compuesto: distrito + fecha (series temporales distritales)
// Usado en: Evolución temporal de disponibilidad por distrito
// Soporta: "Variación de patinetes en Centro mes a mes"
scooterAssignmentSchema.index({ 'distrito.nombre': 1, fechaAsignacion: 1 }, {
  name: 'idx_scooters_district_evolution',
  background: true
});

// Índice compuesto: fecha + totalPatinetes (ranking temporal)
// Usado en: Análisis de disponibilidad en el tiempo
// Soporta: "Zonas con más patinetes por período"
scooterAssignmentSchema.index({ fechaAsignacion: 1, 'estadisticas.totalPatinetes': -1 }, {
  name: 'idx_scooters_availability_ranking',
  background: true
});

// ========================================
// ÍNDICE DE BÚSQUEDA TEXTUAL
// ========================================

// Índice de texto completo para búsquedas flexibles
// Usado en: Búsquedas con $text por distrito, barrio o proveedor
// Soporta: Autocompletado, búsqueda general
scooterAssignmentSchema.index({
  'distrito.nombre': 'text',
  'barrio.nombre': 'text',
  'proveedores.nombre': 'text'
});

/**
 * Middleware pre-save para cálculos automáticos
 */
scooterAssignmentSchema.pre('save', function(next) {
  // Inicializar objetos si no existen
  if (!this.estadisticas) {
    this.estadisticas = {};
  }
  if (!this.analisisDistribucion) {
    this.analisisDistribucion = {};
  }
  if (!this.clasificacionArea) {
    this.clasificacionArea = {};
  }
  if (!this.metadatos) {
    this.metadatos = { calidadDatos: {}, validacionDatos: {} };
  }

  // Calcular estadísticas antes de guardar
  this.calcularEstadisticas();
  this.analizarDistribucion();
  this.clasificarArea();
  this.validarDatos();

  // Actualizar timestamp
  this.procesamiento.ultimaActualizacion = new Date();

  next();
});

/**
 * Método para obtener resumen de asignación
 */
scooterAssignmentSchema.methods.getResumenAsignacion = function() {
  return {
    ubicacion: {
      distrito: this.distrito.nombre,
      barrio: this.barrio.nombre
    },
    estadisticas: {
      totalPatinetes: this.estadisticas.totalPatinetes,
      totalProveedores: this.estadisticas.totalProveedores,
      proveedoresActivos: this.estadisticas.proveedoresActivos,
      densidad: this.estadisticas.densidadPatinetes
    },
    distribucion: {
      proveedorDominante: this.analisisDistribucion.proveedorDominante,
      concentracion: this.analisisDistribucion.concentracionMercado,
      indiceHHI: this.analisisDistribucion.indiceHerfindahl
    },
    clasificacion: {
      tipoZona: this.clasificacionArea.tipoZona,
      prioridad: this.clasificacionArea.prioridadServicio,
      demanda: this.clasificacionArea.demandaEstimada
    },
    proveedores: this.proveedores.filter(p => p.activo && p.cantidad > 0).map(p => ({
      nombre: p.nombre,
      cantidad: p.cantidad,
      porcentaje: this.estadisticas.totalPatinetes > 0 ?
        (p.cantidad / this.estadisticas.totalPatinetes) * 100 : 0
    }))
  };
};

/**
 * Métodos estáticos para consultas agregadas
 */

/**
 * Obtener estadísticas por distrito
 */
scooterAssignmentSchema.statics.getEstadisticasDistrito = function(fecha = null) {
  const matchCondition = {};
  if (fecha) {
    matchCondition.fechaAsignacion = {
      $gte: new Date(fecha),
      $lt: new Date(new Date(fecha).getTime() + 24 * 60 * 60 * 1000)
    };
  }

  return this.aggregate([
    { $match: matchCondition },
    {
      $group: {
        _id: '$distrito.nombre',
        totalPatinetes: { $sum: '$estadisticas.totalPatinetes' },
        totalBarrios: { $sum: 1 },
        promedioPatinetesPorBarrio: { $avg: '$estadisticas.totalPatinetes' },
        densidadPromedio: { $avg: '$estadisticas.promedioPatinetesPorProveedor' },
        zonasMayorDemanda: {
          $sum: {
            $cond: [
              { $eq: ['$clasificacionArea.demandaEstimada', 'MUY_ALTA'] },
              1,
              0
            ]
          }
        }
      }
    },
    {
      $sort: { totalPatinetes: -1 }
    }
  ]).allowDiskUse(true);
};

/**
 * Obtener análisis de mercado por proveedor
 */
scooterAssignmentSchema.statics.getAnalisisMercadoPorProveedor = function(fecha = null) {
  const matchCondition = {};
  if (fecha) {
    matchCondition.fechaAsignacion = {
      $gte: new Date(fecha),
      $lt: new Date(new Date(fecha).getTime() + 24 * 60 * 60 * 1000)
    };
  }

  return this.aggregate([
    { $match: matchCondition },
    { $unwind: '$proveedores' },
    {
      $match: {
        'proveedores.activo': true,
        'proveedores.cantidad': { $gt: 0 }
      }
    },
    {
      $group: {
        _id: '$proveedores.nombre',
        totalPatinetes: { $sum: '$proveedores.cantidad' },
        areasOperacion: { $sum: 1 },
        promedioPatinetesPorArea: { $avg: '$proveedores.cantidad' },
        distritos: { $addToSet: '$distrito.nombre' },
        zonasAlta: {
          $sum: {
            $cond: [
              { $eq: ['$clasificacionArea.demandaEstimada', 'MUY_ALTA'] },
              1,
              0
            ]
          }
        }
      }
    },
    {
      $addFields: {
        totalDistritos: { $size: '$distritos' }
      }
    },
    {
      $sort: { totalPatinetes: -1 }
    }
  ]).allowDiskUse(true);
};

/**
 * Obtener zonas de mayor concentración
 */
scooterAssignmentSchema.statics.getZonasMayorConcentracion = function(limite = 20, fecha = null) {
  const matchCondition = {};
  if (fecha) {
    matchCondition.fechaAsignacion = {
      $gte: new Date(fecha),
      $lt: new Date(new Date(fecha).getTime() + 24 * 60 * 60 * 1000)
    };
  }

  return this.aggregate([
    { $match: matchCondition },
    {
      $project: {
        distrito: '$distrito.nombre',
        barrio: '$barrio.nombre',
        totalPatinetes: '$estadisticas.totalPatinetes',
        densidad: '$estadisticas.densidadPatinetes',
        tipoZona: '$clasificacionArea.tipoZona',
        demanda: '$clasificacionArea.demandaEstimada',
        concentracion: '$analisisDistribucion.concentracionMercado',
        proveedorDominante: '$analisisDistribucion.proveedorDominante'
      }
    },
    {
      $sort: { totalPatinetes: -1 }
    },
    {
      $limit: limite
    }
  ]).allowDiskUse(true);
};

/**
 * Obtener dashboard de distribución
 */
scooterAssignmentSchema.statics.getDashboardDistribucion = function(fecha = null) {
  const matchCondition = {};
  if (fecha) {
    matchCondition.fechaAsignacion = {
      $gte: new Date(fecha),
      $lt: new Date(new Date(fecha).getTime() + 24 * 60 * 60 * 1000)
    };
  }

  return this.aggregate([
    { $match: matchCondition },
    {
      $facet: {
        resumenGeneral: [
          {
            $group: {
              _id: null,
              totalPatinetes: { $sum: '$estadisticas.totalPatinetes' },
              totalAreas: { $sum: 1 },
              promedioPatinetesPorArea: { $avg: '$estadisticas.totalPatinetes' },
              areasAltaDensidad: {
                $sum: {
                  $cond: [
                    { $in: ['$estadisticas.densidadPatinetes', ['ALTA', 'MUY_ALTA']] },
                    1,
                    0
                  ]
                }
              }
            }
          }
        ],
        distribucionPorTipoZona: [
          {
            $group: {
              _id: '$clasificacionArea.tipoZona',
              totalPatinetes: { $sum: '$estadisticas.totalPatinetes' },
              areas: { $sum: 1 },
              promedio: { $avg: '$estadisticas.totalPatinetes' }
            }
          },
          { $sort: { totalPatinetes: -1 } }
        ],
        distribucionPorDensidad: [
          {
            $group: {
              _id: '$estadisticas.densidadPatinetes',
              areas: { $sum: 1 },
              totalPatinetes: { $sum: '$estadisticas.totalPatinetes' }
            }
          }
        ],
        concentracionMercado: [
          {
            $group: {
              _id: '$analisisDistribucion.concentracionMercado',
              areas: { $sum: 1 },
              hhiPromedio: { $avg: '$analisisDistribucion.indiceHerfindahl' }
            }
          }
        ]
      }
    }
  ]).allowDiskUse(true);
};

/**
 * Obtener análisis de optimización de distribución
 * Identifica áreas sobreabastecidas y subabastecidas con recomendaciones
 */
scooterAssignmentSchema.statics.getOptimizationAnalysisData = function(fecha = null) {
  const matchCondition = {};
  if (fecha) {
    const fechaInicio = new Date(fecha);
    const fechaFin = new Date(fechaInicio.getTime() + 24 * 60 * 60 * 1000);
    matchCondition.fechaAsignacion = { $gte: fechaInicio, $lt: fechaFin };
  }

  return Promise.all([
    // Análisis de desbalance oferta-demanda
    this.aggregate([
      { $match: matchCondition },
      {
        $addFields: {
          demandaNumerica: {
            $switch: {
              branches: [
                { case: { $eq: ['$clasificacionArea.demandaEstimada', 'BAJA'] }, then: 1 },
                { case: { $eq: ['$clasificacionArea.demandaEstimada', 'MEDIA'] }, then: 2 },
                { case: { $eq: ['$clasificacionArea.demandaEstimada', 'ALTA'] }, then: 3 },
                { case: { $eq: ['$clasificacionArea.demandaEstimada', 'MUY_ALTA'] }, then: 4 }
              ],
              default: 2
            }
          },
          ofertaNumerica: {
            $switch: {
              branches: [
                { case: { $eq: ['$estadisticas.densidadPatinetes', 'BAJA'] }, then: 1 },
                { case: { $eq: ['$estadisticas.densidadPatinetes', 'MEDIA'] }, then: 2 },
                { case: { $eq: ['$estadisticas.densidadPatinetes', 'ALTA'] }, then: 3 },
                { case: { $eq: ['$estadisticas.densidadPatinetes', 'MUY_ALTA'] }, then: 4 }
              ],
              default: 2
            }
          }
        }
      },
      {
        $addFields: {
          balanceOfertaDemanda: { $subtract: ['$ofertaNumerica', '$demandaNumerica'] },
          tipoDesbalance: {
            $switch: {
              branches: [
                { case: { $gt: ['$balanceOfertaDemanda', 1] }, then: 'SOBREABASTECIDO' },
                { case: { $lt: ['$balanceOfertaDemanda', -1] }, then: 'SUBABASTECIDO' },
                { case: { $eq: ['$balanceOfertaDemanda', 0] }, then: 'EQUILIBRADO' }
              ],
              default: 'LIGERAMENTE_DESBALANCEADO'
            }
          }
        }
      },
      {
        $group: {
          _id: '$tipoDesbalance',
          areas: { $sum: 1 },
          totalPatinetes: { $sum: '$estadisticas.totalPatinetes' },
          ejemplos: {
            $push: {
              distrito: '$distrito.nombre',
              barrio: '$barrio.nombre',
              patinetes: '$estadisticas.totalPatinetes',
              demanda: '$clasificacionArea.demandaEstimada',
              densidad: '$estadisticas.densidadPatinetes',
              balance: '$balanceOfertaDemanda'
            }
          }
        }
      },
      { $addFields: { ejemplos: { $slice: ['$ejemplos', 5] } } }
    ]),

    // Recomendaciones de redistribución
    this.aggregate([
      { $match: matchCondition },
      {
        $project: {
          distrito: '$distrito.nombre',
          barrio: '$barrio.nombre',
          patinetes: '$estadisticas.totalPatinetes',
          demanda: '$clasificacionArea.demandaEstimada',
          densidad: '$estadisticas.densidadPatinetes',
          prioridad: '$clasificacionArea.prioridadServicio',
          tipoZona: '$clasificacionArea.tipoZona',
          concentracion: '$analisisDistribucion.concentracionMercado'
        }
      },
      {
        $addFields: {
          necesitaAtencion: {
            $or: [
              { $and: [{ $in: ['$demanda', ['ALTA', 'MUY_ALTA']] }, { $eq: ['$densidad', 'BAJA'] }] },
              { $and: [{ $eq: ['$demanda', 'BAJA'] }, { $in: ['$densidad', ['ALTA', 'MUY_ALTA']] }] },
              { $eq: ['$concentracion', 'ALTA_CONCENTRACION'] }
            ]
          }
        }
      },
      { $match: { necesitaAtencion: true } },
      { $sort: { patinetes: -1 } },
      { $limit: 10 }
    ])
  ]).then(([analisisDesbalance, recomendaciones]) => ({
    analisisDesbalance,
    recomendaciones
  }));
};

/**
 * Obtener asignaciones con filtros complejos y paginación
 * Consolida la lógica de filtrado, ordenación, paginación y projection
 * @param {Object} filters - Filtros construidos desde queryHelper
 * @param {Object} sortOptions - Opciones de ordenación
 * @param {Object} pagination - Opciones de paginación (skip, limit)
 * @param {Object} projection - Proyección condicional de campos
 * @returns {Promise<Object>} - Datos paginados con metadata
 */
scooterAssignmentSchema.statics.getAssignmentsWithFilters = async function(filters, sortOptions, pagination, projection = {}) {
  const { skip, limit } = pagination;

  // Consulta principal con projection
  const query = this.find(filters, projection)
    .sort(sortOptions)
    .skip(skip)
    .limit(limit)
    .lean();

  // Total de documentos que coinciden con filtros
  const total = await this.countDocuments(filters);

  // Ejecutar consulta
  const asignaciones = await query;

  return {
    asignaciones,
    total,
    page: Math.floor(skip / limit) + 1,
    totalPages: Math.ceil(total / limit),
    hasNextPage: skip + limit < total,
    hasPrevPage: skip > 0
  };
};

/**
 * Obtener detalles optimizados de un área específica
 * Incluye datos del área, historial y comparación con áreas similares
 * @param {String} distrito - Nombre del distrito
 * @param {String} barrio - Nombre del barrio
 * @param {Date|null} fecha - Fecha específica o null para más reciente
 * @returns {Promise<Object>} - Detalles completos del área
 */
scooterAssignmentSchema.statics.getAreaDetailsOptimized = async function(distrito, barrio, fecha = null) {
  // Construir filtro base
  const baseFilter = {
    'distrito.nombre': new RegExp(distrito, 'i'),
    'barrio.nombre': new RegExp(barrio, 'i')
  };

  // Buscar el área específica
  const areaFilter = { ...baseFilter };
  if (fecha) {
    const fechaInicio = new Date(fecha);
    const fechaFin = new Date(fechaInicio.getTime() + 24 * 60 * 60 * 1000);
    areaFilter.fechaAsignacion = { $gte: fechaInicio, $lt: fechaFin };
  } else {
    // Si no hay fecha, buscar el más reciente
    const ultimoRegistro = await this.findOne(baseFilter)
      .sort({ fechaAsignacion: -1 })
      .lean();

    if (!ultimoRegistro) {
      return null;
    }

    const fechaInicio = new Date(ultimoRegistro.fechaAsignacion);
    const fechaFin = new Date(fechaInicio.getTime() + 24 * 60 * 60 * 1000);
    areaFilter.fechaAsignacion = { $gte: fechaInicio, $lt: fechaFin };
  }

  // Ejecutar consultas en paralelo
  const [area, historial, areasSimilares] = await Promise.all([
    // 1. Área principal
    this.findOne(areaFilter).lean(),

    // 2. Historial (últimos 10 registros) - solo si no se especificó fecha
    fecha ? Promise.resolve([]) : this.find(baseFilter)
      .select('fechaAsignacion estadisticas.totalPatinetes estadisticas.densidadPatinetes')
      .sort({ fechaAsignacion: -1 })
      .limit(10)
      .lean(),

    // 3. Áreas similares (misma clasificación, diferente ubicación)
    (async () => {
      const areaTemp = await this.findOne(areaFilter).lean();
      if (!areaTemp) {
        return [];
      }

      return this.find({
        'clasificacionArea.tipoZona': areaTemp.clasificacionArea.tipoZona,
        'distrito.nombre': { $ne: areaTemp.distrito.nombre },
        fechaAsignacion: areaTemp.fechaAsignacion
      })
      .select('distrito.nombre barrio.nombre estadisticas.totalPatinetes')
      .sort({ 'estadisticas.totalPatinetes': -1 })
      .limit(5)
      .lean();
    })()
  ]);

  if (!area) {
    return null;
  }

  return {
    area,
    historial,
    areasSimilares
  };
};

/**
 * Obtener comparativa temporal entre ubicaciones
 * Agrupa datos por fecha y ubicación con estadísticas agregadas
 * @param {Date} fechaInicio - Fecha de inicio del rango
 * @param {Date} fechaFin - Fecha de fin del rango
 * @param {String|null} distrito - Distrito específico o null para todos
 * @param {String} agrupacion - Tipo de agrupación: 'distrito' o 'barrio'
 * @returns {Promise<Object>} - Datos procesados listos para frontend
 */
scooterAssignmentSchema.statics.getTemporalComparisonData = async function(fechaInicio, fechaFin, distrito = null, agrupacion = 'distrito') {
  // Construir condición de match
  const matchCondition = {
    fechaAsignacion: {
      $gte: new Date(fechaInicio),
      $lte: new Date(fechaFin)
    }
  };

  if (distrito) {
    matchCondition['distrito.nombre'] = new RegExp(distrito, 'i');
  }

  // Campo de agrupación dinámico
  const groupField = agrupacion === 'barrio' ?
    { distrito: '$distrito.nombre', barrio: '$barrio.nombre' } :
    '$distrito.nombre';

  // Ejecutar agregación
  const comparativa = await this.aggregate([
    { $match: matchCondition },
    {
      $group: {
        _id: {
          fecha: {
            $dateToString: {
              format: '%Y-%m-%d',
              date: '$fechaAsignacion'
            }
          },
          ubicacion: groupField
        },
        totalPatinetes: { $sum: '$estadisticas.totalPatinetes' },
        totalProveedores: { $avg: '$estadisticas.totalProveedores' },
        densidadPromedio: { $avg: '$estadisticas.promedioPatinetesPorProveedor' }
      }
    },
    {
      $sort: { '_id.fecha': 1, '_id.ubicacion': 1 }
    }
  ]);

  // Procesar datos para estructura amigable al frontend
  const datosProcessados = {};
  comparativa.forEach(item => {
    const fecha = item._id.fecha;
    const ubicacion = typeof item._id.ubicacion === 'object' ?
      `${item._id.ubicacion.distrito} - ${item._id.ubicacion.barrio}` :
      item._id.ubicacion;

    if (!datosProcessados[ubicacion]) {
      datosProcessados[ubicacion] = [];
    }

    datosProcessados[ubicacion].push({
      fecha,
      totalPatinetes: item.totalPatinetes,
      totalProveedores: Math.round(item.totalProveedores),
      densidadPromedio: Math.round(item.densidadPromedio * 100) / 100
    });
  });

  return {
    comparativa: datosProcessados,
    totalUbicaciones: Object.keys(datosProcessados).length
  };
};

// Crear y exportar el modelo
const ScooterAssignment = mongoose.model('ScooterAssignment', scooterAssignmentSchema);

module.exports = ScooterAssignment;
