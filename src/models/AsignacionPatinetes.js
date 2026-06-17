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
  NIVELES_DENSIDAD_PATINETES,
  DOMINANCIA_PROVEEDORES_PATINETES,
  CONCENTRACION_MERCADO_PATINETES,
  TIPOS_ZONA_PATINETES,
  NIVELES_PRIORIDAD_PATINETES,
  NIVELES_DEMANDA_PATINETES,
  TIPOS_INFORME_PATINETES,
  UMBRALES_DENSIDAD_PATINETES,
  UMBRALES_DEMANDA_PATINETES,
  UMBRALES_CONCENTRACION_MERCADO,
  VALIDATION_LIMITS,
  DATASET_YEARS,
  AREAS_CLAVE_PATINETES
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
      message: `La fecha de asignación debe estar dentro del rango del dataset (${DATASET_YEARS.MIN_YEAR}-${DATASET_YEARS.MAX_YEAR})`
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
      enum: Object.values(NIVELES_DENSIDAD_PATINETES),
      default: NIVELES_DENSIDAD_PATINETES.MEDIA
    },
    dominanciaProveedores: {
      type: String,
      enum: Object.values(DOMINANCIA_PROVEEDORES_PATINETES),
      default: DOMINANCIA_PROVEEDORES_PATINETES.EQUILIBRADA
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
      enum: Object.values(CONCENTRACION_MERCADO_PATINETES),
      default: CONCENTRACION_MERCADO_PATINETES.COMPETITIVA
    }
  },

  // Clasificación de área urbana
  clasificacionArea: {
    tipoZona: {
      type: String,
      enum: Object.values(TIPOS_ZONA_PATINETES),
      default: TIPOS_ZONA_PATINETES.ZONA_RESIDENCIAL
    },
    prioridadServicio: {
      type: String,
      enum: Object.values(NIVELES_PRIORIDAD_PATINETES),
      default: NIVELES_PRIORIDAD_PATINETES.MEDIA
    },
    demandaEstimada: {
      type: String,
      enum: Object.values(NIVELES_DEMANDA_PATINETES),
      default: NIVELES_DEMANDA_PATINETES.MEDIA
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
        enum: Object.values(TIPOS_INFORME_PATINETES)
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
  versionKey: false,
  collection: 'scooter_assignments'
});

// Transformación de salida para reducir payload
scooterAssignmentSchema.set('toJSON', {
  transform: (_doc, ret) => {
    delete ret.createdAt;
    delete ret.updatedAt;
    delete ret.__v;
    delete ret.procesamiento;
    return ret;
  }
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
// Usado en: AsignacionPatinetes métodos estáticos - Evolución por proveedor
// Soporta: "Crecimiento de LIME en últimos 6 meses"
scooterAssignmentSchema.index({ fechaAsignacion: 1, 'proveedores.nombre': 1 }, {
  name: 'idx_scooters_date_provider_analysis'
});

// Índice compuesto: distrito + fecha (series temporales distritales)
// Usado en: Evolución temporal de disponibilidad por distrito
// Soporta: "Variación de patinetes en Centro mes a mes"
scooterAssignmentSchema.index({ 'distrito.nombre': 1, fechaAsignacion: 1 }, {
  name: 'idx_scooters_district_evolution'
});

// Índice compuesto: fecha + totalPatinetes (ranking temporal)
// Usado en: Análisis de disponibilidad en el tiempo
// Soporta: "Zonas con más patinetes por período"
scooterAssignmentSchema.index({ fechaAsignacion: 1, 'estadisticas.totalPatinetes': -1 }, {
  name: 'idx_scooters_availability_ranking'
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
 * Calcular estadísticas para la asignación
 * Actualiza: estadisticas.*
 */
scooterAssignmentSchema.methods.calcularEstadisticas = function() {
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
  if (this.estadisticas.totalPatinetes >= UMBRALES_DENSIDAD_PATINETES.MUY_ALTA) {
    this.estadisticas.densidadPatinetes = NIVELES_DENSIDAD_PATINETES.MUY_ALTA;
  } else if (this.estadisticas.totalPatinetes >= UMBRALES_DENSIDAD_PATINETES.ALTA) {
    this.estadisticas.densidadPatinetes = NIVELES_DENSIDAD_PATINETES.ALTA;
  } else if (this.estadisticas.totalPatinetes >= UMBRALES_DENSIDAD_PATINETES.MEDIA) {
    this.estadisticas.densidadPatinetes = NIVELES_DENSIDAD_PATINETES.MEDIA;
  } else {
    this.estadisticas.densidadPatinetes = NIVELES_DENSIDAD_PATINETES.BAJA;
  }
};

/**
 * Analizar distribución y concentración de mercado
 * Actualiza: analisisDistribucion.*
 */
scooterAssignmentSchema.methods.analizarDistribucion = function() {
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
  if (hhi >= UMBRALES_CONCENTRACION_MERCADO.HIGH) {
    this.analisisDistribucion.concentracionMercado = CONCENTRACION_MERCADO_PATINETES.ALTA_CONCENTRACION;
    this.estadisticas.dominanciaProveedores = DOMINANCIA_PROVEEDORES_PATINETES.MONOPOLIO;
  } else if (hhi >= UMBRALES_CONCENTRACION_MERCADO.MODERATE) {
    this.analisisDistribucion.concentracionMercado = CONCENTRACION_MERCADO_PATINETES.CONCENTRADA;
    this.estadisticas.dominanciaProveedores = proveedoresActivos.length === 2 ? DOMINANCIA_PROVEEDORES_PATINETES.DUOPOLIO : DOMINANCIA_PROVEEDORES_PATINETES.OLIGOPOLIO;
  } else if (hhi >= UMBRALES_CONCENTRACION_MERCADO.LOW) {
    this.analisisDistribucion.concentracionMercado = CONCENTRACION_MERCADO_PATINETES.MODERADA;
    this.estadisticas.dominanciaProveedores = DOMINANCIA_PROVEEDORES_PATINETES.OLIGOPOLIO;
  } else {
    this.analisisDistribucion.concentracionMercado = CONCENTRACION_MERCADO_PATINETES.COMPETITIVA;
    this.estadisticas.dominanciaProveedores = DOMINANCIA_PROVEEDORES_PATINETES.EQUILIBRADA;
  }
};

/**
 * Classify area type based on location and density
 * Updates: clasificacionArea.*
 */
scooterAssignmentSchema.methods.clasificarArea = function() {
  const distrito = this.distrito.nombre.toUpperCase();
  const barrio = this.barrio.nombre.toUpperCase();
  const totalPatinetes = this.estadisticas.totalPatinetes;

  // Clasificar tipo de zona (basado en distritos conocidos de Madrid)
  if (AREAS_CLAVE_PATINETES.CENTRAL.some(loc => distrito.includes(loc) || barrio.includes(loc))) {
    this.clasificacionArea.tipoZona = TIPOS_ZONA_PATINETES.CENTRO_URBANO;
    this.clasificacionArea.prioridadServicio = NIVELES_PRIORIDAD_PATINETES.CRITICA;
  } else if (AREAS_CLAVE_PATINETES.UNIVERSITY.some(loc => barrio.includes(loc))) {
    this.clasificacionArea.tipoZona = TIPOS_ZONA_PATINETES.ZONA_UNIVERSITARIA;
    this.clasificacionArea.prioridadServicio = NIVELES_PRIORIDAD_PATINETES.ALTA;
  } else if (AREAS_CLAVE_PATINETES.TRANSPORT.some(loc => barrio.includes(loc))) {
    this.clasificacionArea.tipoZona = TIPOS_ZONA_PATINETES.ZONA_TRANSPORTE;
    this.clasificacionArea.prioridadServicio = NIVELES_PRIORIDAD_PATINETES.ALTA;
  } else if (AREAS_CLAVE_PATINETES.COMMERCIAL.some(loc => distrito.includes(loc))) {
    this.clasificacionArea.tipoZona = TIPOS_ZONA_PATINETES.ZONA_COMERCIAL;
    this.clasificacionArea.prioridadServicio = NIVELES_PRIORIDAD_PATINETES.ALTA;
  } else {
    this.clasificacionArea.tipoZona = TIPOS_ZONA_PATINETES.ZONA_RESIDENCIAL;
    this.clasificacionArea.prioridadServicio = NIVELES_PRIORIDAD_PATINETES.MEDIA;
  }

  // Estimar demanda basada en densidad
  if (totalPatinetes >= UMBRALES_DEMANDA_PATINETES.MUY_ALTA) {
    this.clasificacionArea.demandaEstimada = NIVELES_DEMANDA_PATINETES.MUY_ALTA;
  } else if (totalPatinetes >= UMBRALES_DEMANDA_PATINETES.ALTA) {
    this.clasificacionArea.demandaEstimada = NIVELES_DEMANDA_PATINETES.ALTA;
  } else if (totalPatinetes >= UMBRALES_DEMANDA_PATINETES.MEDIA) {
    this.clasificacionArea.demandaEstimada = NIVELES_DEMANDA_PATINETES.MEDIA;
  } else {
    this.clasificacionArea.demandaEstimada = NIVELES_DEMANDA_PATINETES.BAJA;
  }
};

/**
 * Validate data consistency
 * Updates: metadatos.validacionDatos.*
 */
scooterAssignmentSchema.methods.validarDatos = function() {
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
  this.calcularEstadisticas();
  this.analizarDistribucion();
  this.clasificarArea();
  this.validarDatos();

  // Actualizar timestamp
  this.procesamiento.ultimaActualizacion = new Date();

  next();
});

/**
 * Metodos estaticos delegados a `services/asignacionPatinetesService.js`.
 *
 * El service contiene la implementacion real de las 9 funciones (resumen,
 * estadisticas por distrito, analisis mercado, zonas concentracion, panel,
 * optimizacion, filtros, detalles area, comparativa temporal); el modelo
 * expone wrappers thin para mantener la API publica clasica.
 */
const asignacionPatinetesService = require('../services/asignacionPatinetesService');

scooterAssignmentSchema.statics.obtenerResumenAsignacion = function(doc) {
  return asignacionPatinetesService.obtenerResumenAsignacion(doc);
};

scooterAssignmentSchema.statics.obtenerEstadisticasDistrito = function(fecha, filtros = {}) {
  return asignacionPatinetesService.obtenerEstadisticasDistrito(this, fecha, filtros);
};

scooterAssignmentSchema.statics.obtenerAnalisisMercadoProveedores = function(fecha, filtros = {}) {
  return asignacionPatinetesService.obtenerAnalisisMercadoProveedores(this, fecha, filtros);
};

scooterAssignmentSchema.statics.obtenerZonasMayorConcentracion = function(limite, fecha, filtros = {}) {
  return asignacionPatinetesService.obtenerZonasMayorConcentracion(this, limite, fecha, filtros);
};

scooterAssignmentSchema.statics.obtenerPanelDistribucion = function(fecha) {
  return asignacionPatinetesService.obtenerPanelDistribucion(this, fecha);
};

scooterAssignmentSchema.statics.obtenerDatosAnalisisOptimizacion = function(fecha) {
  return asignacionPatinetesService.obtenerDatosAnalisisOptimizacion(this, fecha);
};

scooterAssignmentSchema.statics.obtenerAsignacionesConFiltros = function(filters, sortOptions, pagination, projection) {
  return asignacionPatinetesService.obtenerAsignacionesConFiltros(this, filters, sortOptions, pagination, projection);
};

scooterAssignmentSchema.statics.obtenerDetallesAreaOptimizado = function(distrito, barrio, fecha) {
  return asignacionPatinetesService.obtenerDetallesAreaOptimizado(this, distrito, barrio, fecha);
};

scooterAssignmentSchema.statics.obtenerDatosComparativaTemporal = function(fechaInicio, fechaFin, distrito, agrupacion) {
  return asignacionPatinetesService.obtenerDatosComparativaTemporal(this, fechaInicio, fechaFin, distrito, agrupacion);
};


// Crear y exportar el modelo
const AsignacionPatinetes = mongoose.model('AsignacionPatinetes', scooterAssignmentSchema);

module.exports = AsignacionPatinetes;
