/**
 * Modelo de Asignación de Patinetes
 *
 * Esquema de Mongoose para almacenar y gestionar la distribución de patinetes
 * eléctricos por distrito y barrio, incluyendo información por proveedor y
 * estadísticas de disponibilidad para optimización del servicio urbano.
 */

const mongoose = require('mongoose');
const { validateDatasetDate } = require('./schemas/commonSchemas');
const {
  SCOOTER_DENSITY_LEVELS,
  SCOOTER_PROVIDER_DOMINANCE,
  SCOOTER_MARKET_CONCENTRATION,
  SCOOTER_ZONE_TYPES,
  SCOOTER_PRIORITY_LEVELS,
  SCOOTER_DEMAND_LEVELS,
  SCOOTER_REPORT_TYPES,
  AGGREGATION_LIMITS,
  SCOOTER_DENSITY_THRESHOLDS,
  SCOOTER_DEMAND_THRESHOLDS,
  MARKET_CONCENTRATION_THRESHOLDS,
  TIME_CONSTANTS,
  VALIDATION_LIMITS,
  DATASET_YEARS
} = require('../constants');

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
    min: [VALIDATION_LIMITS.QUANTITY_MIN, 'La cantidad de patinetes no puede ser negativa']
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
    default: DATASET_YEARS.DEFAULT_START_DATE,
    index: true,
    validate: {
      validator: validateDatasetDate,
      message: 'La fecha de asignación debe estar dentro del rango del dataset (2050-2052)'
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
      min: [VALIDATION_LIMITS.QUANTITY_MIN, 'El total de patinetes no puede ser negativo'],
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
      enum: SCOOTER_DENSITY_LEVELS,
      default: 'MEDIA'
    },
    dominanciaProveedores: {
      type: String,
      enum: SCOOTER_PROVIDER_DOMINANCE,
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
      enum: SCOOTER_MARKET_CONCENTRATION,
      default: 'COMPETITIVA'
    }
  },

  // Clasificación de área urbana
  clasificacionArea: {
    tipoZona: {
      type: String,
      enum: SCOOTER_ZONE_TYPES,
      default: 'ZONA_RESIDENCIAL'
    },
    prioridadServicio: {
      type: String,
      enum: SCOOTER_PRIORITY_LEVELS,
      default: 'MEDIA'
    },
    demandaEstimada: {
      type: String,
      enum: SCOOTER_DEMAND_LEVELS,
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
        enum: SCOOTER_REPORT_TYPES
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
 * ========================================
 * MÉTODOS DE INSTANCIA
 * ========================================
 */

/**
 * Calculate statistics for the assignment
 * Updates: estadisticas.*
 */
scooterAssignmentSchema.methods.calculateStatistics = function() {
  // Total de proveedores
  this.estadisticas.totalProveedores = this.proveedores.length;

  // Proveedores activos con cantidad > 0
  this.estadisticas.proveedoresActivos = this.proveedores.filter(
    p => p.activo && p.cantidad > 0
  ).length;

  // Promedio de patinetes por proveedor
  this.estadisticas.promedioPatinetesPorProveedor =
    this.estadisticas.proveedoresActivos > 0
      ? this.estadisticas.totalPatinetes / this.estadisticas.proveedoresActivos
      : 0;

  // Clasificar densidad basada en total de patinetes
  if (this.estadisticas.totalPatinetes >= SCOOTER_DENSITY_THRESHOLDS.MUY_ALTA) {
    this.estadisticas.densidadPatinetes = SCOOTER_DENSITY_LEVELS[3]; // 'MUY_ALTA'
  } else if (this.estadisticas.totalPatinetes >= SCOOTER_DENSITY_THRESHOLDS.ALTA) {
    this.estadisticas.densidadPatinetes = SCOOTER_DENSITY_LEVELS[2]; // 'ALTA'
  } else if (this.estadisticas.totalPatinetes >= SCOOTER_DENSITY_THRESHOLDS.MEDIA) {
    this.estadisticas.densidadPatinetes = SCOOTER_DENSITY_LEVELS[1]; // 'MEDIA'
  } else {
    this.estadisticas.densidadPatinetes = SCOOTER_DENSITY_LEVELS[0]; // 'BAJA'
  }
};

/**
 * Analyze distribution and market concentration
 * Updates: analisisDistribucion.*
 */
scooterAssignmentSchema.methods.analyzeDistribution = function() {
  const proveedoresActivos = this.proveedores.filter(p => p.activo && p.cantidad > 0);

  if (proveedoresActivos.length === 0) {
    return;
  }

  // Ordenar por cantidad descendente
  const sorted = [...proveedoresActivos].sort((a, b) => b.cantidad - a.cantidad);

  // Proveedor dominante
  this.analisisDistribucion.proveedorDominante = {
    nombre: sorted[0].nombre,
    cantidad: sorted[0].cantidad,
    porcentaje: (sorted[0].cantidad / this.estadisticas.totalPatinetes) * 100
  };

  // Proveedor secundario (si existe)
  if (sorted.length > 1) {
    this.analisisDistribucion.proveedorSecundario = {
      nombre: sorted[1].nombre,
      cantidad: sorted[1].cantidad,
      porcentaje: (sorted[1].cantidad / this.estadisticas.totalPatinetes) * 100
    };
  }

  // Índice Herfindahl-Hirschman (HHI)
  const hhi = proveedoresActivos.reduce((sum, p) => {
    const share = (p.cantidad / this.estadisticas.totalPatinetes) * 100;
    return sum + (share * share);
  }, 0);

  this.analisisDistribucion.indiceHerfindahl = Math.round(hhi);

  // Clasificar concentración del mercado
  if (hhi >= MARKET_CONCENTRATION_THRESHOLDS.HIGH) {
    this.analisisDistribucion.concentracionMercado = SCOOTER_MARKET_CONCENTRATION[3]; // 'ALTA_CONCENTRACION'
    this.estadisticas.dominanciaProveedores = SCOOTER_PROVIDER_DOMINANCE[1]; // 'MONOPOLIO'
  } else if (hhi >= MARKET_CONCENTRATION_THRESHOLDS.MODERATE) {
    this.analisisDistribucion.concentracionMercado = SCOOTER_MARKET_CONCENTRATION[2]; // 'CONCENTRADA'
    this.estadisticas.dominanciaProveedores = proveedoresActivos.length === 2 ? SCOOTER_PROVIDER_DOMINANCE[2] : SCOOTER_PROVIDER_DOMINANCE[3]; // 'DUOPOLIO' : 'OLIGOPOLIO'
  } else if (hhi >= MARKET_CONCENTRATION_THRESHOLDS.LOW) {
    this.analisisDistribucion.concentracionMercado = SCOOTER_MARKET_CONCENTRATION[1]; // 'MODERADA'
    this.estadisticas.dominanciaProveedores = SCOOTER_PROVIDER_DOMINANCE[3]; // 'OLIGOPOLIO'
  } else {
    this.analisisDistribucion.concentracionMercado = SCOOTER_MARKET_CONCENTRATION[0]; // 'COMPETITIVA'
    this.estadisticas.dominanciaProveedores = SCOOTER_PROVIDER_DOMINANCE[0]; // 'EQUILIBRADA'
  }
};

/**
 * Classify area type based on location and density
 * Updates: clasificacionArea.*
 */
scooterAssignmentSchema.methods.classifyArea = function() {
  const distrito = this.distrito.nombre.toUpperCase();
  const barrio = this.barrio.nombre.toUpperCase();
  const totalPatinetes = this.estadisticas.totalPatinetes;

  // Clasificar tipo de zona (basado en distritos conocidos de Madrid)
  if (distrito.includes('CENTRO') || barrio.includes('SOL')) {
    this.clasificacionArea.tipoZona = SCOOTER_ZONE_TYPES[0]; // 'CENTRO_URBANO'
    this.clasificacionArea.prioridadServicio = SCOOTER_PRIORITY_LEVELS[3]; // 'CRITICA'
  } else if (barrio.includes('UNIVERSIDAD') || barrio.includes('CAMPUS')) {
    this.clasificacionArea.tipoZona = SCOOTER_ZONE_TYPES[3]; // 'ZONA_UNIVERSITARIA'
    this.clasificacionArea.prioridadServicio = SCOOTER_PRIORITY_LEVELS[2]; // 'ALTA'
  } else if (barrio.includes('ATOCHA') || barrio.includes('CHAMARTIN')) {
    this.clasificacionArea.tipoZona = SCOOTER_ZONE_TYPES[7]; // 'ZONA_TRANSPORTE'
    this.clasificacionArea.prioridadServicio = SCOOTER_PRIORITY_LEVELS[2]; // 'ALTA'
  } else if (distrito.includes('RETIRO') || distrito.includes('SALAMANCA')) {
    this.clasificacionArea.tipoZona = SCOOTER_ZONE_TYPES[1]; // 'ZONA_COMERCIAL'
    this.clasificacionArea.prioridadServicio = SCOOTER_PRIORITY_LEVELS[2]; // 'ALTA'
  } else {
    this.clasificacionArea.tipoZona = SCOOTER_ZONE_TYPES[2]; // 'ZONA_RESIDENCIAL'
    this.clasificacionArea.prioridadServicio = SCOOTER_PRIORITY_LEVELS[1]; // 'MEDIA'
  }

  // Estimar demanda basada en densidad
  if (totalPatinetes >= SCOOTER_DEMAND_THRESHOLDS.MUY_ALTA) {
    this.clasificacionArea.demandaEstimada = SCOOTER_DEMAND_LEVELS[3]; // 'MUY_ALTA'
  } else if (totalPatinetes >= SCOOTER_DEMAND_THRESHOLDS.ALTA) {
    this.clasificacionArea.demandaEstimada = SCOOTER_DEMAND_LEVELS[2]; // 'ALTA'
  } else if (totalPatinetes >= SCOOTER_DEMAND_THRESHOLDS.MEDIA) {
    this.clasificacionArea.demandaEstimada = SCOOTER_DEMAND_LEVELS[1]; // 'MEDIA'
  } else {
    this.clasificacionArea.demandaEstimada = SCOOTER_DEMAND_LEVELS[0]; // 'BAJA'
  }
};

/**
 * Validate data consistency
 * Updates: metadatos.validacionDatos.*
 */
scooterAssignmentSchema.methods.validateData = function() {
  // Verificar suma correcta
  const sumaProveedores = this.proveedores.reduce((sum, p) => sum + p.cantidad, 0);
  this.metadatos.validacionDatos.sumaCorrecta =
    sumaProveedores === this.estadisticas.totalPatinetes;

  // Verificar proveedores duplicados
  const nombresProveedores = this.proveedores.map(p => p.nombre);
  const nombresUnicos = new Set(nombresProveedores);
  this.metadatos.validacionDatos.proveedoresDuplicados =
    nombresProveedores.length !== nombresUnicos.size;

  // Verificar consistencia general
  this.metadatos.validacionDatos.datosConsistentes =
    this.metadatos.validacionDatos.sumaCorrecta &&
    !this.metadatos.validacionDatos.proveedoresDuplicados &&
    this.proveedores.every(p => p.cantidad >= 0);
};

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
  this.calculateStatistics();
  this.analyzeDistribution();
  this.classifyArea();
  this.validateData();

  // Actualizar timestamp
  this.procesamiento.ultimaActualizacion = new Date();

  next();
});

/**
 * Método para obtener resumen de asignación
 */
scooterAssignmentSchema.methods.getAssignmentSummary = function() {
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
scooterAssignmentSchema.statics.getDistrictStatistics = function(fecha = null) {
  const matchCondition = {};
  if (fecha) {
    matchCondition.fechaAsignacion = {
      $gte: new Date(fecha),
      $lt: new Date(new Date(fecha).getTime() + TIME_CONSTANTS.MILLISECONDS_PER_DAY)
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
  ]).allowDiskUse(true).maxTimeMS(10000);
};

/**
 * Obtener análisis de mercado por proveedor
 */
scooterAssignmentSchema.statics.getProviderMarketAnalysis = function(fecha = null) {
  const matchCondition = {};
  if (fecha) {
    matchCondition.fechaAsignacion = {
      $gte: new Date(fecha),
      $lt: new Date(new Date(fecha).getTime() + TIME_CONSTANTS.MILLISECONDS_PER_DAY)
    };
  }

  return this.aggregate([
    { $match: matchCondition },
    { $unwind: { path: '$proveedores', preserveNullAndEmptyArrays: true } },
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
  ]).allowDiskUse(true).maxTimeMS(10000);
};

/**
 * Obtener zonas de mayor concentración
 */
scooterAssignmentSchema.statics.getHighestConcentrationZones = function(limite = 20, fecha = null) {
  const matchCondition = {};
  if (fecha) {
    matchCondition.fechaAsignacion = {
      $gte: new Date(fecha),
      $lt: new Date(new Date(fecha).getTime() + TIME_CONSTANTS.MILLISECONDS_PER_DAY)
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
  ]).allowDiskUse(true).maxTimeMS(10000);
};

/**
 * Obtener dashboard de distribución
 */
scooterAssignmentSchema.statics.getDistributionDashboard = function(fecha = null) {
  const matchCondition = {};
  if (fecha) {
    matchCondition.fechaAsignacion = {
      $gte: new Date(fecha),
      $lt: new Date(new Date(fecha).getTime() + TIME_CONSTANTS.MILLISECONDS_PER_DAY)
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
  ]).allowDiskUse(true).maxTimeMS(10000);
};

/**
 * Obtener análisis de optimización de distribución
 * Identifica áreas sobreabastecidas y subabastecidas con recomendaciones
 */
scooterAssignmentSchema.statics.getOptimizationAnalysisData = function(fecha = null) {
  const matchCondition = {};
  if (fecha) {
    const fechaInicio = new Date(fecha);
    const fechaFin = new Date(fechaInicio.getTime() + TIME_CONSTANTS.MILLISECONDS_PER_DAY);
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
      { $limit: AGGREGATION_LIMITS.PREVIEW }
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
  // Construir filtro base usando búsqueda exacta (case-insensitive)
  // NO usamos $text aquí porque necesitamos match exacto de distrito+barrio
  // $text haría búsqueda parcial, no exacta
  const baseFilter = {
    'distrito.nombre': distrito,
    'barrio.nombre': barrio
  };

  // Buscar el área específica
  const areaFilter = { ...baseFilter };
  if (fecha) {
    const fechaInicio = new Date(fecha);
    const fechaFin = new Date(fechaInicio.getTime() + TIME_CONSTANTS.MILLISECONDS_PER_DAY);
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
    const fechaFin = new Date(fechaInicio.getTime() + TIME_CONSTANTS.MILLISECONDS_PER_DAY);
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

  // Si hay filtro por distrito, usar match exacto (case-sensitive como en BD)
  // NO usar RegExp porque degrada performance en agregaciones
  if (distrito) {
    matchCondition['distrito.nombre'] = distrito;
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
  const processedData = {};
  comparativa.forEach(item => {
    const fecha = item._id.fecha;
    const ubicacion = typeof item._id.ubicacion === 'object' ?
      `${item._id.ubicacion.distrito} - ${item._id.ubicacion.barrio}` :
      item._id.ubicacion;

    if (!processedData[ubicacion]) {
      processedData[ubicacion] = [];
    }

    processedData[ubicacion].push({
      fecha,
      totalPatinetes: item.totalPatinetes,
      totalProveedores: Math.round(item.totalProveedores),
      densidadPromedio: Math.round(item.densidadPromedio * 100) / 100
    });
  });

  return {
    comparativa: processedData,
    totalUbicaciones: Object.keys(processedData).length
  };
};

// Crear y exportar el modelo
const ScooterAssignment = mongoose.model('ScooterAssignment', scooterAssignmentSchema);

module.exports = ScooterAssignment;
