/**
 * Modelo de Asignación de Patinetes
 *
 * Esquema de Mongoose para almacenar y gestionar la distribución de patinetes
 * eléctricos por distrito y barrio, incluyendo información por proveedor y
 * estadísticas de disponibilidad para optimización del servicio urbano.
 */

const mongoose = require('mongoose');

/**
 * Sub-esquema para datos de un proveedor específico
 */
const proveedorSchema = new mongoose.Schema({
  nombre: {
    type: String,
    required: [true, 'Nombre del proveedor obligatorio'],
    trim: true,
    maxlength: [50, 'Nombre del proveedor muy largo']
  },
  cantidad: {
    type: Number,
    required: [true, 'Cantidad de patinetes obligatoria'],
    min: [0, 'La cantidad no puede ser negativa'],
    validate: {
      validator: function(v) {
        return Number.isInteger(v);
      },
      message: 'La cantidad debe ser un número entero'
    }
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
    required: [true, 'Fecha de asignación obligatoria'],
    default: Date.now,
    index: true
  },

  // Información geográfica administrativa
  distrito: {
    nombre: {
      type: String,
      required: [true, 'Nombre de distrito obligatorio'],
      trim: true,
      uppercase: true,
      maxlength: [100, 'Nombre de distrito muy largo'],
      index: true
    }
  },

  barrio: {
    nombre: {
      type: String,
      required: [true, 'Nombre de barrio obligatorio'],
      trim: true,
      maxlength: [100, 'Nombre de barrio muy largo'],
      index: true
    }
  },

  // Lista de proveedores y sus asignaciones
  proveedores: {
    type: [proveedorSchema],
    required: [true, 'Lista de proveedores obligatoria'],
    validate: {
      validator: function(v) {
        return v && v.length > 0;
      },
      message: 'Debe haber al menos un proveedor'
    }
  },

  // Estadísticas calculadas automáticamente
  estadisticas: {
    totalPatinetes: {
      type: Number,
      required: [true, 'Total de patinetes obligatorio'],
      min: [0, 'Total no puede ser negativo'],
      index: true
    },
    totalProveedores: {
      type: Number,
      min: [0, 'Total proveedores no puede ser negativo']
    },
    proveedoresActivos: {
      type: Number,
      min: [0, 'Proveedores activos no puede ser negativo']
    },
    promedioPatinetesPorProveedor: {
      type: Number,
      min: [0, 'Promedio no puede ser negativo']
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
      type: Number,
      min: [0, 'Índice HHI no puede ser negativo'],
      max: [1, 'Índice HHI no puede exceder 1']
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
        min: [0, 'Puntuación no puede ser negativa'],
        max: [1, 'Puntuación no puede exceder 1'],
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
// Índice único para evitar duplicados
scooterAssignmentSchema.index(
  {
    'distrito.nombre': 1,
    'barrio.nombre': 1,
    fechaAsignacion: 1
  },
  { unique: true, name: 'unique_scooter_assignment' }
);

// Índices para consultas frecuentes
scooterAssignmentSchema.index({ fechaAsignacion: -1, 'distrito.nombre': 1 });
scooterAssignmentSchema.index({ 'estadisticas.totalPatinetes': -1, fechaAsignacion: -1 });
scooterAssignmentSchema.index({ 'clasificacionArea.tipoZona': 1, fechaAsignacion: -1 });
scooterAssignmentSchema.index({ 'estadisticas.densidadPatinetes': 1 });

// Índices para análisis de mercado
scooterAssignmentSchema.index({ 'analisisDistribucion.concentracionMercado': 1 });
scooterAssignmentSchema.index({ 'analisisDistribucion.indiceHerfindahl': -1 });

// Índices para proveedores
scooterAssignmentSchema.index({ 'proveedores.nombre': 1, fechaAsignacion: -1 });
scooterAssignmentSchema.index({ 'proveedores.cantidad': -1 });

// Índice de texto para búsqueda
scooterAssignmentSchema.index({
  'distrito.nombre': 'text',
  'barrio.nombre': 'text',
  'proveedores.nombre': 'text'
});

// Índice compuesto fecha + proveedor (análisis temporal por proveedor)
// Usado en: GET /api/scooter-assignments?proveedor=X&fecha=Y
// Requiere desenrollado de array proveedores para consultas específicas
scooterAssignmentSchema.index({ fechaAsignacion: 1, 'proveedores.nombre': 1 }, {
  name: 'idx_scooters_date_provider_analysis',
  background: true
});

// Índice compuesto distrito + fecha (consultas de evolución por distrito)
// Usado en: series temporales de distribución, comparativas distritales
scooterAssignmentSchema.index({ 'distrito.nombre': 1, fechaAsignacion: 1 }, {
  name: 'idx_scooters_district_evolution',
  background: true
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
 * Método para calcular estadísticas básicas
 */
scooterAssignmentSchema.methods.calcularEstadisticas = function() {
  // Calcular totales
  this.estadisticas.totalPatinetes = this.proveedores.reduce((total, proveedor) => {
    return total + (proveedor.activo ? proveedor.cantidad : 0);
  }, 0);

  this.estadisticas.totalProveedores = this.proveedores.length;
  this.estadisticas.proveedoresActivos = this.proveedores.filter(p => p.activo && p.cantidad > 0).length;

  // Promedio por proveedor
  if (this.estadisticas.proveedoresActivos > 0) {
    this.estadisticas.promedioPatinetesPorProveedor =
      this.estadisticas.totalPatinetes / this.estadisticas.proveedoresActivos;
  } else {
    this.estadisticas.promedioPatinetesPorProveedor = 0;
  }

  // Clasificar densidad
  if (this.estadisticas.totalPatinetes === 0) {
    this.estadisticas.densidadPatinetes = 'BAJA';
  } else if (this.estadisticas.totalPatinetes <= 20) {
    this.estadisticas.densidadPatinetes = 'BAJA';
  } else if (this.estadisticas.totalPatinetes <= 50) {
    this.estadisticas.densidadPatinetes = 'MEDIA';
  } else if (this.estadisticas.totalPatinetes <= 80) {
    this.estadisticas.densidadPatinetes = 'ALTA';
  } else {
    this.estadisticas.densidadPatinetes = 'MUY_ALTA';
  }
};

/**
 * Método para analizar la distribución de mercado
 */
scooterAssignmentSchema.methods.analizarDistribucion = function() {
  const proveedoresActivos = this.proveedores
    .filter(p => p.activo && p.cantidad > 0)
    .sort((a, b) => b.cantidad - a.cantidad);

  if (proveedoresActivos.length === 0) {
    return;
  }

  const total = this.estadisticas.totalPatinetes;

  // Proveedor dominante
  this.analisisDistribucion.proveedorDominante = {
    nombre: proveedoresActivos[0].nombre,
    cantidad: proveedoresActivos[0].cantidad,
    porcentaje: total > 0 ? (proveedoresActivos[0].cantidad / total) * 100 : 0
  };

  // Proveedor secundario
  if (proveedoresActivos.length > 1) {
    this.analisisDistribucion.proveedorSecundario = {
      nombre: proveedoresActivos[1].nombre,
      cantidad: proveedoresActivos[1].cantidad,
      porcentaje: total > 0 ? (proveedoresActivos[1].cantidad / total) * 100 : 0
    };
  }

  // Calcular índice Herfindahl-Hirschman (HHI)
  let hhi = 0;
  proveedoresActivos.forEach(proveedor => {
    const participacion = total > 0 ? proveedor.cantidad / total : 0;
    hhi += participacion * participacion;
  });
  this.analisisDistribucion.indiceHerfindahl = hhi;

  // Clasificar concentración de mercado
  if (hhi < 0.15) {
    this.analisisDistribucion.concentracionMercado = 'COMPETITIVA';
    this.estadisticas.dominanciaProveedores = 'EQUILIBRADA';
  } else if (hhi < 0.25) {
    this.analisisDistribucion.concentracionMercado = 'MODERADA';
    this.estadisticas.dominanciaProveedores = 'OLIGOPOLIO';
  } else if (hhi < 0.5) {
    this.analisisDistribucion.concentracionMercado = 'CONCENTRADA';
    this.estadisticas.dominanciaProveedores = 'DUOPOLIO';
  } else {
    this.analisisDistribucion.concentracionMercado = 'ALTA_CONCENTRACION';
    this.estadisticas.dominanciaProveedores = 'MONOPOLIO';
  }
};

/**
 * Método para clasificar el área urbana
 */
scooterAssignmentSchema.methods.clasificarArea = function() {
  const distritoNombre = this.distrito.nombre.toLowerCase();
  const barrioNombre = this.barrio.nombre.toLowerCase();
  const totalPatinetes = this.estadisticas.totalPatinetes;

  // Clasificar tipo de zona basado en nombres
  if (distritoNombre.includes('centro') || barrioNombre.includes('centro') ||
      barrioNombre.includes('sol') || barrioNombre.includes('mayor')) {
    this.clasificacionArea.tipoZona = 'CENTRO_URBANO';
    this.clasificacionArea.prioridadServicio = 'CRITICA';
    this.clasificacionArea.demandaEstimada = 'MUY_ALTA';
  } else if (barrioNombre.includes('universidad') || barrioNombre.includes('moncloa')) {
    this.clasificacionArea.tipoZona = 'ZONA_UNIVERSITARIA';
    this.clasificacionArea.prioridadServicio = 'ALTA';
    this.clasificacionArea.demandaEstimada = 'ALTA';
  } else if (barrioNombre.includes('atocha') || barrioNombre.includes('estacion') ||
             barrioNombre.includes('metro') || barrioNombre.includes('chamartin')) {
    this.clasificacionArea.tipoZona = 'ZONA_TRANSPORTE';
    this.clasificacionArea.prioridadServicio = 'ALTA';
    this.clasificacionArea.demandaEstimada = 'ALTA';
  } else if (distritoNombre.includes('salamanca') || distritoNombre.includes('chamberi')) {
    this.clasificacionArea.tipoZona = 'ZONA_COMERCIAL';
    this.clasificacionArea.prioridadServicio = 'ALTA';
    this.clasificacionArea.demandaEstimada = 'ALTA';
  } else {
    this.clasificacionArea.tipoZona = 'ZONA_RESIDENCIAL';
    this.clasificacionArea.prioridadServicio = 'MEDIA';
    this.clasificacionArea.demandaEstimada = 'MEDIA';
  }

  // Ajustar demanda basada en cantidad actual de patinetes
  if (totalPatinetes > 60) {
    this.clasificacionArea.demandaEstimada = 'MUY_ALTA';
  } else if (totalPatinetes > 40) {
    this.clasificacionArea.demandaEstimada = 'ALTA';
  } else if (totalPatinetes > 20) {
    this.clasificacionArea.demandaEstimada = 'MEDIA';
  } else {
    this.clasificacionArea.demandaEstimada = 'BAJA';
  }
};

/**
 * Método para validar la consistencia de los datos
 */
scooterAssignmentSchema.methods.validarDatos = function() {
  const camposFaltantes = [];
  let camposValidos = 0;
  const totalCampos = 4;

  // Verificar campos obligatorios
  if (!this.distrito.nombre) {
    camposFaltantes.push('ubicacion');
  } else {
    camposValidos++;
  }

  if (!this.barrio.nombre) {
    camposFaltantes.push('ubicacion');
  } else {
    camposValidos++;
  }

  if (!this.proveedores || this.proveedores.length === 0) {
    camposFaltantes.push('proveedores');
  } else {
    camposValidos++;
  }

  // Verificar suma correcta
  const sumaCalculada = this.proveedores.reduce((sum, p) => sum + (p.activo ? p.cantidad : 0), 0);
  this.metadatos.validacionDatos.sumaCorrecta = sumaCalculada === this.estadisticas.totalPatinetes;

  if (this.metadatos.validacionDatos.sumaCorrecta) {
    camposValidos++;
  } else {
    camposFaltantes.push('totales');
  }

  // Verificar proveedores duplicados
  const nombresProveedores = this.proveedores.map(p => p.nombre.toLowerCase());
  const nombresUnicos = [...new Set(nombresProveedores)];
  this.metadatos.validacionDatos.proveedoresDuplicados = nombresProveedores.length !== nombresUnicos.length;

  // Establecer calidad de datos
  this.metadatos.calidadDatos.camposFaltantes = [...new Set(camposFaltantes)];
  this.metadatos.calidadDatos.esCompleto = camposFaltantes.length === 0;
  this.metadatos.calidadDatos.puntuacionCalidad = camposValidos / totalCampos;
  this.metadatos.validacionDatos.datosConsistentes =
    this.metadatos.validacionDatos.sumaCorrecta && !this.metadatos.validacionDatos.proveedoresDuplicados;
};

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
  ]);
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
  ]);
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
  ]);
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
  ]);
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

// Crear y exportar el modelo
const ScooterAssignment = mongoose.model('ScooterAssignment', scooterAssignmentSchema);

module.exports = ScooterAssignment;
