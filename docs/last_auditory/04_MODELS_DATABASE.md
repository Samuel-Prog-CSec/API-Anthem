# 🗄️ MODELOS Y BASE DE DATOS

**Documento:** 04 de 10
**Fecha:** 16 de Octubre de 2025

---

## 📊 CALIFICACIÓN: 7.0/10

**Estado general:** ⚠️ REQUIERE ATENCIÓN

Modelos refactorizados (Census, Fine, Traffic) están optimizados. Los restantes 8 modelos necesitan mejoras en índices y validación.

---

## 📈 ESTADÍSTICAS GENERALES

```
Total de modelos: 11
Tamaño post-Sprint 1: ~2,593 líneas (+1,060 líneas por static methods)
Modelos con índices: 11/11 (pero incompletos)
Modelos con validación: 11/11 (pero inconsistente)
Modelos con métodos estáticos: 3/11 (27%)
```

---

## 🔴 PROBLEMA CRÍTICO: Índices Incompletos

**Severidad:** ALTA
**Impacto:** Performance crítico en queries frecuentes

### Análisis por Modelo

#### 1. Accident.js - ÍNDICES INSUFICIENTES

**Estado actual:**
```javascript
// src/models/Accident.js
accidentSchema.index({ fecha: 1 });
accidentSchema.index({ 'distrito.nombre': 1 });
accidentSchema.index({ gravedad: 1 });
```

**Problemas detectados:**

```javascript
// Query frecuente en accidentController.js (línea 180)
Accident.find({
  fecha: { $gte: startDate, $lte: endDate },
  'distrito.nombre': distrito,
  gravedad: { $in: ['GRAVE', 'MORTAL'] }
}).sort({ fecha: -1 });

// ❌ Sin índice compuesto para esta query común
```

**Índices faltantes:**

```javascript
// Queries de rango de fechas + distrito (muy frecuente)
accidentSchema.index({ fecha: 1, 'distrito.nombre': 1 });

// Queries de análisis por tipo de accidente + gravedad
accidentSchema.index({ tipoAccidente: 1, gravedad: 1 });

// Queries geoespaciales (para heatmaps)
accidentSchema.index({ 'ubicacion.coordinates': '2dsphere' });

// Queries de análisis temporal + tipo
accidentSchema.index({ fecha: -1, tipoAccidente: 1, gravedad: 1 });
```

**Impacto estimado:**
- Queries actuales: ~800-1200ms
- Con índices adecuados: ~100-200ms (-75% tiempo)

**Prioridad:** 🔴 CRÍTICA

---

#### 2. AirQuality.js - ÍNDICES INSUFICIENTES

**Estado actual:**
```javascript
// src/models/AirQuality.js
airQualitySchema.index({ fecha: 1 });
airQualitySchema.index({ estacion: 1 });
airQualitySchema.index({ magnitud: 1 });
```

**Problemas:**

```javascript
// Query frecuente en airQualityController.js (línea 220)
AirQuality.find({
  estacion: stationId,
  magnitud: 'NO2',
  fecha: { $gte: startDate, $lte: endDate }
}).sort({ fecha: 1 });

// ❌ Sin índice compuesto
```

**Índices faltantes:**

```javascript
// Análisis temporal por estación (muy frecuente)
airQualitySchema.index({ estacion: 1, fecha: 1 });

// Análisis de contaminante específico + fecha
airQualitySchema.index({ magnitud: 1, fecha: 1 });

// Análisis completo (estación + magnitud + fecha)
airQualitySchema.index({ estacion: 1, magnitud: 1, fecha: 1 });

// Búsqueda de valores críticos
airQualitySchema.index({ magnitud: 1, valor: 1 });
```

**Impacto estimado:** -70% tiempo de respuesta

**Prioridad:** 🔴 ALTA

---

#### 3. Traffic.js - ÍNDICES PARCIALMENTE OPTIMIZADOS

**Estado actual (post Sprint 1):**
```javascript
// src/models/Traffic.js
trafficSchema.index({ fecha: 1 });
trafficSchema.index({ puntoMedidaId: 1 });
trafficSchema.index({ 'distrito.nombre': 1 });
trafficSchema.index({ fecha: 1, puntoMedidaId: 1 }); // ✅ Añadido en Sprint 1
```

**Índices adicionales recomendados:**

```javascript
// Para análisis de congestión por distrito + fecha
trafficSchema.index({ 'distrito.nombre': 1, fecha: 1, intensidad: -1 });

// Para queries de top congestion
trafficSchema.index({ fecha: 1, ocupacion: -1 });
```

**Prioridad:** 🟡 MEDIA (ya mejorado pero optimizable)

---

#### 4. ScooterAssignment.js - ÍNDICES INSUFICIENTES

**Estado actual:**
```javascript
scooterAssignmentSchema.index({ fecha: 1 });
scooterAssignmentSchema.index({ 'distrito.nombre': 1 });
```

**Índices faltantes:**

```javascript
// Análisis de disponibilidad temporal
scooterAssignmentSchema.index({ fecha: 1, 'distrito.nombre': 1 });

// Búsqueda de patinetes disponibles
scooterAssignmentSchema.index({ disponibles: -1, fecha: 1 });

// Análisis de utilización
scooterAssignmentSchema.index({ 'distrito.nombre': 1, enUso: -1, fecha: 1 });
```

**Prioridad:** 🔴 ALTA

---

#### 5. BikeAvailability.js - ÍNDICES INSUFICIENTES

**Estado actual:**
```javascript
bikeAvailabilitySchema.index({ fecha: 1 });
bikeAvailabilitySchema.index({ estacion: 1 });
```

**Índices faltantes:**

```javascript
// Queries de disponibilidad en tiempo real
bikeAvailabilitySchema.index({ estacion: 1, fecha: -1 });

// Análisis de ocupación
bikeAvailabilitySchema.index({ estacion: 1, bicicletasDisponibles: 1 });

// Análisis temporal de estación
bikeAvailabilitySchema.index({ estacion: 1, fecha: 1, bicicletasDisponibles: 1 });
```

**Prioridad:** 🟡 MEDIA

---

#### 6. Container.js - ÍNDICES BÁSICOS

**Estado actual:**
```javascript
containerSchema.index({ tipoContenedor: 1 });
containerSchema.index({ 'ubicacion.coordinates': '2dsphere' });
```

**Índices faltantes:**

```javascript
// Búsqueda por distrito
containerSchema.index({ 'distrito.nombre': 1, tipoContenedor: 1 });

// Análisis geoespacial + tipo
containerSchema.index({ 'ubicacion.coordinates': '2dsphere', tipoContenedor: 1 });
```

**Prioridad:** 🟢 BAJA (queries simples)

---

#### 7. NoiseMonitoring.js - ÍNDICES INSUFICIENTES

**Estado actual:**
```javascript
noiseMonitoringSchema.index({ fecha: 1 });
noiseMonitoringSchema.index({ estacion: 1 });
```

**Índices faltantes:**

```javascript
// Análisis temporal por estación
noiseMonitoringSchema.index({ estacion: 1, fecha: 1 });

// Búsqueda de niveles críticos
noiseMonitoringSchema.index({ nivelRuido: -1, fecha: 1 });

// Análisis por zona + tiempo
noiseMonitoringSchema.index({ estacion: 1, fecha: 1, nivelRuido: -1 });
```

**Prioridad:** 🟡 MEDIA

---

## 📋 RESUMEN DE ÍNDICES FALTANTES

| Modelo | Índices Actuales | Índices Necesarios | Prioridad | Impacto |
|--------|------------------|-------------------|-----------|---------|
| Accident.js | 3 | +4 | 🔴 Crítica | -75% tiempo |
| AirQuality.js | 3 | +4 | 🔴 Alta | -70% tiempo |
| ScooterAssignment.js | 2 | +3 | 🔴 Alta | -65% tiempo |
| Traffic.js | 4 | +2 | 🟡 Media | -30% tiempo |
| BikeAvailability.js | 2 | +3 | 🟡 Media | -50% tiempo |
| NoiseMonitoring.js | 2 | +3 | 🟡 Media | -50% tiempo |
| BikeCapacity.js | 2 | +3 | 🟡 Media | -50% tiempo |
| ParkingOccupancy.js | 2 | +2 | 🟢 Baja | -40% tiempo |
| Container.js | 2 | +2 | 🟢 Baja | -30% tiempo |

**Total índices a añadir:** 26 índices compuestos

---

## 🟡 PROBLEMA: Validación Inconsistente

**Severidad:** MEDIA
**Impacto:** Integridad de datos

### Ejemplos de Inconsistencias

#### Problema #1: Validación de Fechas

**En Census.js (bien hecho):**
```javascript
censusSchema.path('fecha').validate(function(value) {
  return value <= new Date();
}, 'Fecha no puede ser futura');
```

**En Accident.js (falta validación):**
```javascript
fecha: {
  type: Date,
  required: [true, 'Fecha es obligatoria'],
  // ❌ Sin validación de fecha futura
}
```

**En AirQuality.js (falta validación):**
```javascript
fecha: {
  type: Date,
  required: true,
  // ❌ Sin validación de fecha futura
}
```

**Afecta a:** 6 modelos

---

#### Problema #2: Validación de Valores Numéricos

**En Fine.js (bien hecho):**
```javascript
importe: {
  type: Number,
  required: [true, 'Importe es obligatorio'],
  min: [0, 'Importe no puede ser negativo'],
  max: [10000, 'Importe no puede superar 10000€']
}
```

**En AirQuality.js (validación incompleta):**
```javascript
valor: {
  type: Number,
  required: true,
  // ❌ Sin validación de rango
  // Valor puede ser negativo o excesivamente alto
}
```

**En NoiseMonitoring.js (sin validación):**
```javascript
nivelRuido: {
  type: Number,
  required: true,
  // ❌ Sin min/max
  // Podría aceptar valores imposibles como -100 o 10000 dB
}
```

**Afecta a:** 7 modelos

---

#### Problema #3: Validación de Enumerados

**En Fine.js (bien hecho):**
```javascript
gravedad: {
  type: String,
  required: [true, 'Gravedad es obligatoria'],
  enum: {
    values: ['LEVE', 'GRAVE', 'MUY_GRAVE'],
    message: 'Gravedad debe ser: LEVE, GRAVE o MUY_GRAVE'
  }
}
```

**En Accident.js (sin enum):**
```javascript
gravedad: {
  type: String,
  required: true,
  // ❌ Sin enum validation
  // Podría aceptar valores como "muy grave" (minúsculas) o "severo"
}
```

**Afecta a:** 4 modelos

---

#### Problema #4: Validación de Referencias

**En Traffic.js (sin validación):**
```javascript
distrito: {
  nombre: { type: String },
  codigo: { type: String }
}
// ❌ No valida que distrito realmente exista
```

**Solución recomendada:**
```javascript
distrito: {
  type: mongoose.Schema.Types.ObjectId,
  ref: 'District',
  required: [true, 'Distrito es obligatorio'],
  validate: {
    validator: async function(v) {
      const district = await mongoose.model('District').findById(v);
      return !!district;
    },
    message: 'Distrito no existe'
  }
}
```

**Afecta a:** 8 modelos (todos los que tienen subdocumento distrito)

---

## 🟡 PROBLEMA: Falta de Métodos Estáticos

**Severidad:** MEDIA
**Impacto:** Duplicación de código en controllers

### Situación Actual

**Modelos CON métodos estáticos optimizados (Sprint 1):**
1. Census.js - 12 métodos estáticos
2. Fine.js - 8 métodos estáticos
3. Traffic.js - 10 métodos estáticos

**Modelos SIN métodos estáticos:**
4. Accident.js
5. AirQuality.js
6. ScooterAssignment.js
7. BikeAvailability.js
8. BikeCapacity.js
9. Container.js
10. NoiseMonitoring.js

### Ejemplos de Métodos Necesarios

#### Accident.js - Métodos Faltantes

```javascript
// Método actual en controller (accidentController.js línea 180)
// ❌ 90+ líneas de agregación en controller

// ✅ Debería ser un método estático en modelo
accidentSchema.statics.getHeatmapDataOptimized = async function(filters, options) {
  const pipeline = [
    {
      $match: filters
    },
    {
      $group: {
        _id: {
          lat: { $round: ['$ubicacion.coordinates.1', 3] },
          lng: { $round: ['$ubicacion.coordinates.0', 3] }
        },
        total: { $sum: 1 },
        graves: {
          $sum: { $cond: [{ $in: ['$gravedad', ['GRAVE', 'MORTAL']] }, 1, 0] }
        }
      }
    },
    {
      $project: {
        _id: 0,
        lat: '$_id.lat',
        lng: '$_id.lng',
        total: 1,
        graves: 1,
        intensidad: {
          $cond: [
            { $gte: ['$graves', 5] }, 'ALTA',
            { $cond: [{ $gte: ['$total', 3] }, 'MEDIA', 'BAJA'] }
          ]
        }
      }
    }
  ];

  return await this.aggregate(pipeline);
};

// Más métodos necesarios:
// - getAccidentTrendsByDistrict
// - getAccidentStatisticsByType
// - getAccidentSeverityAnalysis
// - getAccidentTimePatterns
```

**Métodos necesarios en Accident.js:** 5-8 métodos

---

#### AirQuality.js - Métodos Faltantes

```javascript
// Método para análisis de tendencias (actualmente 90+ líneas en controller)
airQualitySchema.statics.getTrendsOptimized = async function(filters, periodo, options) {
  let groupBy;

  switch (periodo) {
    case 'daily':
      groupBy = { $dateToString: { format: '%Y-%m-%d', date: '$fecha' } };
      break;
    case 'weekly':
      groupBy = { $dateToString: { format: '%Y-W%V', date: '$fecha' } };
      break;
    case 'monthly':
      groupBy = { $dateToString: { format: '%Y-%m', date: '$fecha' } };
      break;
  }

  const pipeline = [
    { $match: filters },
    {
      $group: {
        _id: {
          periodo: groupBy,
          estacion: '$estacion',
          magnitud: '$magnitud'
        },
        valorPromedio: { $avg: '$valor' },
        valorMinimo: { $min: '$valor' },
        valorMaximo: { $max: '$valor' },
        mediciones: { $sum: 1 }
      }
    },
    { $sort: { '_id.periodo': 1 } }
  ];

  return await this.aggregate(pipeline);
};

// Más métodos necesarios:
// - getStationComparisonOptimized
// - getPollutantAnalysisOptimized
// - getAirQualityIndexOptimized
// - getCriticalLevelsOptimized
```

**Métodos necesarios en AirQuality.js:** 6-8 métodos

---

#### ScooterAssignment.js - Métodos Faltantes

```javascript
// Método para distribución (actualmente 70+ líneas en controller)
scooterAssignmentSchema.statics.getDistributionOptimized = async function(filters, options) {
  const pipeline = [
    { $match: filters },
    {
      $group: {
        _id: {
          distrito: '$distrito.nombre',
          fecha: { $dateToString: { format: '%Y-%m-%d', date: '$fecha' } }
        },
        totalPatinetes: { $sum: '$numeroPatinetes' },
        disponibles: { $sum: '$disponibles' },
        enUso: { $sum: '$enUso' },
        tasaOcupacion: {
          $avg: {
            $multiply: [
              { $divide: ['$enUso', '$numeroPatinetes'] },
              100
            ]
          }
        }
      }
    },
    { $sort: { '_id.fecha': 1 } }
  ];

  return await this.aggregate(pipeline);
};

// Más métodos necesarios:
// - getAvailabilityPatternsOptimized
// - getUsageStatisticsOptimized
// - getOptimalDistributionOptimized
```

**Métodos necesarios en ScooterAssignment.js:** 4-6 métodos

---

## 📋 RESUMEN DE MÉTODOS ESTÁTICOS FALTANTES

| Modelo | Métodos Actuales | Métodos Necesarios | Líneas a Mover | Prioridad |
|--------|------------------|-------------------|----------------|-----------|
| Accident.js | 0 | 5-8 | ~350 líneas | 🔴 Alta |
| AirQuality.js | 0 | 6-8 | ~320 líneas | 🔴 Alta |
| ScooterAssignment.js | 0 | 4-6 | ~280 líneas | 🔴 Alta |
| BikeAvailability.js | 0 | 4-6 | ~250 líneas | 🟡 Media |
| BikeCapacity.js | 0 | 3-5 | ~220 líneas | 🟡 Media |
| NoiseMonitoring.js | 0 | 4-6 | ~240 líneas | 🟡 Media |
| ParkingOccupancy.js | 0 | 3-5 | ~180 líneas | 🟢 Baja |
| Container.js | 0 | 2-4 | ~150 líneas | 🟢 Baja |

**Total:** 31-48 métodos estáticos a implementar
**Total líneas a mover:** ~1,990 líneas desde controllers a models

---

## 🟢 PROBLEMA MENOR: Falta de Virtual Fields

**Severidad:** BAJA
**Impacto:** Cálculos repetitivos en controllers

### Ejemplos de Virtuals Útiles

#### Accident.js
```javascript
// Virtual para calcular días desde accidente
accidentSchema.virtual('diasDesdeAccidente').get(function() {
  const now = new Date();
  const diff = now - this.fecha;
  return Math.floor(diff / (1000 * 60 * 60 * 24));
});

// Virtual para determinar si es accidente grave
accidentSchema.virtual('esGrave').get(function() {
  return ['GRAVE', 'MORTAL'].includes(this.gravedad);
});
```

#### AirQuality.js
```javascript
// Virtual para categoría de calidad
airQualitySchema.virtual('categoriaCalidad').get(function() {
  if (this.magnitud === 'PM10') {
    if (this.valor <= 50) return 'BUENA';
    if (this.valor <= 100) return 'MODERADA';
    if (this.valor <= 150) return 'DAÑINA_GRUPOS_SENSIBLES';
    return 'DAÑINA';
  }
  // ... otros contaminantes
});
```

#### Traffic.js (ya implementado en Sprint 1) ✅
```javascript
trafficSchema.virtual('nivelCongestion').get(function() {
  if (this.ocupacion >= 80) return 'ALTA';
  if (this.ocupacion >= 50) return 'MEDIA';
  return 'BAJA';
});
```

---

## 🔵 PROBLEMA: Hooks Pre-save Inconsistentes

**Severidad:** BAJA
**Impacto:** Lógica de negocio inconsistente

### Census.js (bien implementado) ✅
```javascript
censusSchema.pre('save', function(next) {
  // Calcular total población
  this.totalPoblacion = this.hombres + this.mujeres;

  // Validar consistencia
  if (this.hombres < 0 || this.mujeres < 0) {
    return next(new Error('Población no puede ser negativa'));
  }

  next();
});
```

### Accident.js (sin hooks)
```javascript
// ❌ Sin pre-save hooks
// Debería validar:
// - Coordenadas dentro de rango de Cartagena
// - Fecha no futura
// - Gravedad vs descripción consistente
```

### Fine.js (parcial)
```javascript
fineSchema.pre('save', function(next) {
  // ✅ Calcula importe con descuento
  if (this.descuento > 0) {
    this.importeFinal = this.importe * (1 - this.descuento / 100);
  }
  next();
});

// ❌ Pero no valida:
// - Descuento máximo permitido
// - Fecha de pago dentro de plazo
```

---

## 🎯 PLAN DE MEJORA POR SPRINTS

### Sprint 2 (ALTA PRIORIDAD)
**Foco:** Índices críticos + Métodos estáticos urgentes

#### Tareas:
1. **Añadir índices a Accident.js**
   - 4 índices compuestos
   - Duración: 2 horas

2. **Añadir índices a AirQuality.js**
   - 4 índices compuestos
   - Duración: 2 horas

3. **Añadir índices a ScooterAssignment.js**
   - 3 índices compuestos
   - Duración: 1.5 horas

4. **Implementar métodos estáticos en Accident.js**
   - 5-8 métodos
   - Duración: 8-10 horas

5. **Implementar métodos estáticos en AirQuality.js**
   - 6-8 métodos
   - Duración: 8-10 horas

**Total Sprint 2:** 21.5-25.5 horas

---

### Sprint 3 (MEDIA PRIORIDAD)
**Foco:** Validación + Métodos estáticos medianos

#### Tareas:
1. **Mejorar validación en 6 modelos**
   - Fechas, rangos numéricos, enums
   - Duración: 6-8 horas

2. **Implementar métodos estáticos en ScooterAssignment.js**
   - 4-6 métodos
   - Duración: 6-8 horas

3. **Implementar métodos estáticos en BikeAvailability.js**
   - 4-6 métodos
   - Duración: 6-8 horas

4. **Implementar métodos estáticos en NoiseMonitoring.js**
   - 4-6 métodos
   - Duración: 6-8 horas

**Total Sprint 3:** 22-32 horas

---

### Sprint 4 (BAJA PRIORIDAD)
**Foco:** Completar modelos restantes + refinamiento

#### Tareas:
1. **Añadir índices restantes** (5 modelos)
   - Duración: 5 horas

2. **Implementar métodos estáticos restantes** (3 modelos)
   - Duración: 10-14 horas

3. **Añadir virtual fields** (todos los modelos)
   - Duración: 4-6 horas

4. **Mejorar hooks pre-save** (todos los modelos)
   - Duración: 3-4 horas

**Total Sprint 4:** 22-29 horas

---

## 📊 IMPACTO ESPERADO

### Performance
- **Queries con índices adecuados:** -60% tiempo promedio
- **Métodos estáticos optimizados:** -40% carga CPU en controllers
- **Caché en modelos:** -80% queries repetitivas

### Mantenibilidad
- **Código en controllers:** -1,990 líneas (-38%)
- **Código en models:** +2,500 líneas (+96%)
- **Duplicación de código:** -70%

### Calidad de Datos
- **Validación mejorada:** -90% datos inconsistentes
- **Integridad referencial:** +100%
- **Hooks automatizados:** -80% errores humanos
