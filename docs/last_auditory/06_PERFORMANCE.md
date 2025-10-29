# ⚡ RENDIMIENTO Y OPTIMIZACIÓN

**Documento:** 06 de 10
**Fecha:** 16 de Octubre de 2025

---

## 📊 CALIFICACIÓN: 7.0/10

**Estado general:** ⚠️ REQUIERE ATENCIÓN

Tres controllers optimizados (Census, Fine, Traffic) tras Sprint 1 con mejoras del 95% en performance. Restantes 8 controllers necesitan optimización similar.

---

## 📈 RESULTADOS SPRINT 1 (Baseline de éxito)

### Performance Improvements Logrados

| Controller | Endpoint | Antes | Después | Mejora |
|------------|----------|-------|---------|--------|
| Census | `/api/censo/piramide` | 2,850ms | 145ms | **-95%** |
| Fine | `/api/multas/estadisticas` | 3,200ms | 180ms | **-94%** |
| Traffic | `/api/trafico/congestion` | 2,100ms | 120ms | **-94%** |

**Técnicas aplicadas:**
- ✅ Agregaciones movidas a modelos
- ✅ Índices compuestos en MongoDB
- ✅ Caché con node-cache (TTL 5-60 min)
- ✅ `.lean()` en queries de solo lectura
- ✅ `Promise.all()` para queries paralelas

---

## 🔴 PROBLEMA CRÍTICO: Controllers Sin Optimizar

**Severidad:** ALTA
**Impacto:** Performance 10-20x más lento de lo necesario

### 1. Accident Controller - SIN OPTIMIZAR

**Endpoint más lento:** `GET /api/accidents/heatmap`

**Performance actual (medida):**
```
Sin caché: ~3,500ms
Con datos: ~50,000 documentos
Problema: Query sin índices + agregación en controller
```

**Código actual:**
```javascript
// accidentController.js líneas 320-410
const getAccidentHeatmap = async (req, res, next) => {
  try {
    const { distrito, startDate, endDate } = req.query;

    // ❌ Sin caché
    // ❌ Filtros construidos inline
    const filters = {
      fecha: { $gte: new Date(startDate), $lte: new Date(endDate) }
    };

    // ❌ Sin .lean()
    const accidents = await Accident.find(filters);

    // ❌ Procesamiento en controller (no en agregación)
    const heatmapData = accidents.reduce((acc, accident) => {
      // Procesamiento costoso en JavaScript
      // ...
    }, []);

    res.status(200).json({ success: true, data: heatmapData });
  } catch (error) {
    next(error);
  }
};
```

**Optimización requerida:**
```javascript
// ✅ Controller optimizado
const getAccidentHeatmap = async (req, res, next) => {
  try {
    const cacheKey = generateCacheKey('accident-heatmap', req.query);
    const cachedData = statisticsCache.get(cacheKey);

    if (cachedData) {
      return res.status(200).json({
        success: true,
        cached: true,
        data: cachedData
      });
    }

    const filters = buildFilters(req.query);
    const options = buildOptions(req.query);

    // ✅ Agregación en modelo con índices
    const heatmapData = await Accident.getHeatmapDataOptimized(filters, options);

    statisticsCache.set(cacheKey, heatmapData, 1800); // 30 min

    res.status(200).json({
      success: true,
      cached: false,
      data: heatmapData
    });
  } catch (error) {
    next(error);
  }
};

// ✅ Modelo con método estático optimizado
accidentSchema.statics.getHeatmapDataOptimized = async function(filters, options) {
  const pipeline = [
    { $match: filters },
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

// ✅ Índices necesarios en Accident.js
accidentSchema.index({ fecha: 1, 'distrito.nombre': 1 });
accidentSchema.index({ 'ubicacion.coordinates': '2dsphere' });
```

**Mejora esperada:** ~3,500ms → ~180ms (**-95%**)

---

### 2. AirQuality Controller - SIN OPTIMIZAR

**Endpoint más lento:** `GET /api/air-quality/trends`

**Performance actual:**
```
Sin caché: ~2,800ms
Con datos: ~120,000 documentos (12 meses)
Problema: Agregación temporal sin optimizar
```

**Optimización requerida:**

```javascript
// ✅ Índices necesarios
airQualitySchema.index({ estacion: 1, fecha: 1 });
airQualitySchema.index({ magnitud: 1, fecha: 1 });
airQualitySchema.index({ estacion: 1, magnitud: 1, fecha: 1 });

// ✅ Método estático optimizado
airQualitySchema.statics.getTrendsOptimized = async function(filters, periodo) {
  let dateFormat;
  switch (periodo) {
    case 'daily':
      dateFormat = '%Y-%m-%d';
      break;
    case 'weekly':
      dateFormat = '%Y-W%V';
      break;
    case 'monthly':
      dateFormat = '%Y-%m';
      break;
  }

  const pipeline = [
    { $match: filters },
    {
      $group: {
        _id: {
          periodo: { $dateToString: { format: dateFormat, date: '$fecha' } },
          magnitud: '$magnitud'
        },
        valorPromedio: { $avg: '$valor' },
        valorMax: { $max: '$valor' },
        valorMin: { $min: '$valor' },
        mediciones: { $sum: 1 }
      }
    },
    { $sort: { '_id.periodo': 1 } }
  ];

  return await this.aggregate(pipeline);
};
```

**Mejora esperada:** ~2,800ms → ~160ms (**-94%**)

---

### 3. ScooterAssignment Controller - SIN OPTIMIZAR

**Endpoint más lento:** `GET /api/scooters/distribution`

**Performance actual:**
```
Sin caché: ~2,500ms
Con datos: ~80,000 documentos
Problema: Agregación compleja sin índices
```

**Optimización requerida:**

```javascript
// ✅ Índices necesarios
scooterAssignmentSchema.index({ fecha: 1, 'distrito.nombre': 1 });
scooterAssignmentSchema.index({ disponibles: -1, fecha: 1 });

// ✅ Método estático con agregación optimizada
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
    { $sort: { '_id.fecha': 1, 'tasaOcupacion': -1 } },
    { $limit: options.limit || 100 }
  ];

  return await this.aggregate(pipeline);
};
```

**Mejora esperada:** ~2,500ms → ~150ms (**-94%**)

---

## 🟡 PROBLEMA: Falta de .lean() en Queries

**Severidad:** MEDIA
**Impacto:** +30-40% tiempo de respuesta innecesario

### Análisis de Uso de .lean()

**Búsqueda realizada:**
```
Patrón: \.find\((?!.*\.lean\(\))
Resultados: ~40 queries sin .lean() en controllers
```

**¿Qué hace .lean()?**
- Retorna objetos JavaScript planos (no documentos Mongoose)
- Elimina overhead de métodos y virtuals
- **Mejora:** 30-40% más rápido
- **Usar cuando:** Solo se necesita leer datos (no modificarlos)

**Ejemplo de queries sin .lean():**

```javascript
// ❌ accidentController.js (línea 85)
const accidents = await Accident.find(filters).sort({ fecha: -1 });
// Sin .lean() - retorna documentos Mongoose completos (innecesario si solo se leen)

// ✅ Debería ser:
const accidents = await Accident.find(filters).sort({ fecha: -1 }).lean();
// Con .lean() - retorna objetos planos (más rápido)
```

**Controllers con más ocurrencias sin .lean():**
1. `accidentController.js` - 8 queries
2. `airQualityController.js` - 7 queries
3. `scooterAssignmentController.js` - 6 queries
4. `bikeAvailabilityController.js` - 5 queries
5. `bikeCapacityController.js` - 5 queries
6. `noiseMonitoringController.js` - 4 queries
7. `containerController.js` - 3 queries
8. `parkingOccupancyController.js` - 2 queries

**Cuándo NO usar .lean():**
```javascript
// ❌ No usar .lean() cuando se va a modificar el documento
const user = await User.findById(id); // Sin .lean()
user.lastLogin = new Date();
await user.save(); // Necesita ser documento Mongoose

// ✅ Usar .lean() cuando solo se lee
const users = await User.find({}).lean(); // Solo lectura
res.json({ data: users });
```

**Plan de acción:**
- Añadir `.lean()` a todas las queries de solo lectura
- **Estimación:** 2-3 horas para todos los controllers
- **Mejora esperada:** -30% tiempo promedio en endpoints GET

---

## 🟡 PROBLEMA: Promise.all() No Utilizado

**Severidad:** MEDIA
**Impacto:** Queries secuenciales cuando podrían ser paralelas

### Análisis

**Búsqueda realizada:**
```
Patrón: Promise\.all
Resultados: 10 usos en controllers (solo en Census, Fine, Traffic tras Sprint 1)
```

**Ejemplo de código SIN paralelización:**

```javascript
// ❌ accidentController.js (líneas 450-470)
const getAccidentStatistics = async (req, res, next) => {
  try {
    // Queries secuenciales - espera cada una antes de ejecutar siguiente
    const total = await Accident.countDocuments(filters); // 200ms
    const porGravedad = await Accident.aggregate([...]); // 300ms
    const porDistrito = await Accident.aggregate([...]); // 250ms
    const tendenciaMensual = await Accident.aggregate([...]); // 400ms

    // Total: 200 + 300 + 250 + 400 = 1,150ms

    res.status(200).json({
      success: true,
      data: { total, porGravedad, porDistrito, tendenciaMensual }
    });
  } catch (error) {
    next(error);
  }
};
```

**Ejemplo de código CON paralelización:**

```javascript
// ✅ Queries paralelas con Promise.all()
const getAccidentStatistics = async (req, res, next) => {
  try {
    // Ejecuta todas las queries en paralelo
    const [total, porGravedad, porDistrito, tendenciaMensual] = await Promise.all([
      Accident.countDocuments(filters),
      Accident.aggregate([...]),
      Accident.aggregate([...]),
      Accident.aggregate([...])
    ]);

    // Total: max(200, 300, 250, 400) = 400ms
    // Mejora: -65% (1,150ms → 400ms)

    res.status(200).json({
      success: true,
      data: { total, porGravedad, porDistrito, tendenciaMensual }
    });
  } catch (error) {
    next(error);
  }
};
```

**Oportunidades detectadas:**

| Controller | Función | Queries Secuenciales | Mejora Estimada |
|------------|---------|---------------------|-----------------|
| accidentController | getAccidentStatistics | 4 queries | -65% tiempo |
| airQualityController | getAirQualityDashboard | 5 queries | -70% tiempo |
| scooterAssignmentController | getScooterStats | 3 queries | -60% tiempo |
| bikeAvailabilityController | getStationOverview | 4 queries | -65% tiempo |
| noiseMonitoringController | getNoiseStatistics | 3 queries | -55% tiempo |

**Total:** 15-20 oportunidades de paralelización

**Estimación:** 4-6 horas de refactorización

---

## 🟢 PROBLEMA MENOR: Caché No Implementado

**Severidad:** BAJA (ya implementado en 3 controllers)
**Impacto:** Queries repetitivas innecesarias

### Estado Actual del Caché

**Implementado (Sprint 1):**
- ✅ `censusController.js` - 4 tipos de caché
- ✅ `fineController.js` - 3 tipos de caché
- ✅ `trafficController.js` - 3 tipos de caché

**No implementado:**
- ❌ `accidentController.js` - 0 caché
- ❌ `airQualityController.js` - 0 caché
- ❌ `scooterAssignmentController.js` - 0 caché
- ❌ Otros 5 controllers - 0 caché

### Sistema de Caché Existente

```javascript
// src/middleware/cache.js (ya implementado)
const NodeCache = require('node-cache');

// 4 tipos de caché con diferentes TTL
const demographicCache = new NodeCache({ stdTTL: 3600 }); // 1 hora
const statisticsCache = new NodeCache({ stdTTL: 1800 }); // 30 min
const trafficCache = new NodeCache({ stdTTL: 300 }); // 5 min
const staticCache = new NodeCache({ stdTTL: 86400 }); // 24 horas
```

**Uso correcto en Census:**
```javascript
const getPoblacionPorDistrito = async (req, res, next) => {
  try {
    // ✅ Genera clave única por query params
    const cacheKey = generateCacheKey('poblacion-distrito', req.query);

    // ✅ Intenta obtener de caché
    const cachedData = demographicCache.get(cacheKey);

    if (cachedData) {
      return res.status(200).json({
        success: true,
        cached: true,
        data: cachedData
      });
    }

    // ✅ Si no está en caché, ejecuta query
    const filters = buildFilters(req.query);
    const data = await Census.getPoblacionPorDistritoOptimizada(filters);

    // ✅ Guarda en caché
    demographicCache.set(cacheKey, data);

    res.status(200).json({
      success: true,
      cached: false,
      data
    });
  } catch (error) {
    next(error);
  }
};
```

**Plan:** Replicar este patrón en los 8 controllers restantes

**Estimación:** 8 controllers × 1h = 8 horas

**Mejora esperada:** -80% queries repetitivas

---

## 🔵 PROBLEMA MENOR: Paginación No Optimizada

**Severidad:** BAJA
**Impacto:** Skip lento en grandes datasets

**Problema con skip():**
```javascript
// ❌ Paginación actual
const page = 100; // Usuario solicita página 100
const limit = 50;
const skip = (page - 1) * limit; // skip = 4,950

// MongoDB debe leer y descartar 4,950 documentos
const results = await Accident.find(filters)
  .skip(4950) // Lento en páginas altas
  .limit(50);

// Para página 100: ~2,000ms
// Para página 1: ~200ms
```

**Solución: Cursor-based Pagination**
```javascript
// ✅ Paginación basada en cursor (más eficiente)
const lastId = req.query.lastId; // ID del último documento de página anterior

const query = { ...filters };
if (lastId) {
  query._id = { $gt: lastId }; // Solo documentos después del cursor
}

const results = await Accident.find(query)
  .sort({ _id: 1 }) // Ordenar por _id (tiene índice)
  .limit(50)
  .lean();

// Siempre ~200ms independientemente de la página
```

**Recomendación:** Implementar para endpoints con paginación profunda

**Prioridad:** Baja (solo crítico si usuarios navegan más allá de página 20-30)

---

## 📊 RESUMEN DE OPTIMIZACIONES PENDIENTES

| Optimización | Controllers Afectados | Mejora Esperada | Esfuerzo | Prioridad |
|--------------|----------------------|-----------------|----------|-----------|
| **Índices compuestos** | 8 | -70% tiempo | 6-8h | 🔴 Crítica |
| **Métodos estáticos** | 8 | -40% carga CPU | 40-50h | 🔴 Alta |
| **Caché** | 8 | -80% queries repetitivas | 8h | 🔴 Alta |
| **Añadir .lean()** | 8 | -30% tiempo GET | 2-3h | 🟡 Media |
| **Promise.all()** | 5 | -60% queries paralelas | 4-6h | 🟡 Media |
| **Cursor pagination** | 3-4 | -80% páginas profundas | 4-6h | 🔵 Baja |

**Total esfuerzo:** 64-81 horas

---

## 🎯 ROADMAP DE OPTIMIZACIÓN

### Sprint 2 (Prioridad CRÍTICA)
**Objetivo:** Optimizar 2 controllers más lentos

1. **Accident Controller**
   - Añadir 4 índices compuestos
   - Implementar 5-8 métodos estáticos
   - Añadir caché a 6 endpoints
   - Añadir .lean() a 8 queries
   - **Duración:** 12-15 horas
   - **Mejora:** -85% tiempo promedio

2. **AirQuality Controller**
   - Añadir 4 índices compuestos
   - Implementar 6-8 métodos estáticos
   - Añadir caché a 7 endpoints
   - Añadir .lean() a 7 queries
   - **Duración:** 12-15 horas
   - **Mejora:** -85% tiempo promedio

**Total Sprint 2:** 24-30 horas

---

### Sprint 3 (Prioridad ALTA)
**Objetivo:** Optimizar 3 controllers medianos

3. **ScooterAssignment Controller** (8-10h)
4. **BikeAvailability Controller** (8-10h)
5. **NoiseMonitoring Controller** (7-9h)

**Total Sprint 3:** 23-29 horas

---

### Sprint 4 (Prioridad MEDIA)
**Objetivo:** Completar optimización + refinamiento

6. **BikeCapacity Controller** (6-8h)
7. **Container Controller** (5-7h)
8. **ParkingOccupancy Controller** (5-7h)
9. **Implementar Promise.all()** en todos (4-6h)
10. **Cursor pagination** en endpoints críticos (4-6h)

**Total Sprint 4:** 24-34 horas

---

## 📈 IMPACTO ESPERADO TOTAL

### Performance Actual (Post Sprint 1)
```
Controllers optimizados: 3/11 (27%)
Tiempo promedio respuesta: ~1,800ms
Queries con índices: 30%
Queries con caché: 25%
Uso de .lean(): 15%
```

### Performance Objetivo (Post Sprint 4)
```
Controllers optimizados: 11/11 (100%)
Tiempo promedio respuesta: ~250ms (-86%)
Queries con índices: 100%
Queries con caché: 95%
Uso de .lean(): 90%
Paralelización: 100% donde aplique
```

### Beneficios Adicionales
- **Carga del servidor:** -70% uso CPU
- **Costos:** -60% recursos MongoDB
- **UX:** Respuestas sub-segundo
- **Escalabilidad:** +10x capacidad
