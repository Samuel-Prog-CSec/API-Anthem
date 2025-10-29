# 🎮 ANÁLISIS DE CONTROLLERS

**Documento:** 03 de 10
**Fecha:** 16 de Octubre de 2025

---

## 📊 CALIFICACIÓN: 7.5/10

**Estado general:** ⚠️ REQUIERE ATENCIÓN

Tres controllers están optimizados (Census, Fine, Traffic) tras Sprint 1. Los restantes 8 necesitan refactorización similar.

---

## 📈 ESTADÍSTICAS GENERALES

```
Total de controllers: 11
Tamaño total: 161.3 KB
Líneas totales: ~5,150 líneas
Promedio por controller: 468 líneas

Refactorizados (Sprint 1): 3
Pendientes de refactorización: 8
```

---

## 🔴 PROBLEMA CRÍTICO: Controllers Sin Refactorizar

**Severidad:** ALTA
**Impacto:** Alto - Mantenibilidad, Performance, Escalabilidad

### Controllers Pendientes de Optimización

#### 1. scooterAssignmentController.js
**Tamaño:** 635 líneas (27% sobre objetivo)
**Prioridad:** 🔴 ALTA

**Problemas detectados:**

```javascript
// Líneas 180-250: Agregación compleja en controller
const getScooterDistribution = async (req, res, next) => {
  try {
    const { distrito, startDate, endDate } = req.query;

    // ❌ Agregación de 70+ líneas directamente en controller
    const pipeline = [
      {
        $match: {
          fecha: {
            $gte: new Date(startDate),
            $lte: new Date(endDate)
          }
        }
      },
      {
        $group: {
          _id: {
            distrito: '$distrito.nombre',
            fecha: { $dateToString: { format: '%Y-%m-%d', date: '$fecha' } }
          },
          totalPatinetes: { $sum: '$numeroPatinetes' },
          disponibles: { $sum: '$disponibles' },
          enUso: { $sum: '$enUso' }
        }
      },
      // ... 50+ líneas más de agregación
    ];

    const results = await ScooterAssignment.aggregate(pipeline);
    // ... procesamiento adicional en controller
  } catch (error) {
    next(error);
  }
};
```

**Solución requerida:**
```javascript
// Mover a src/models/ScooterAssignment.js
scooterAssignmentSchema.statics.getDistributionOptimized = async function(filters, options) {
  const pipeline = [
    // Pipeline completo aquí
  ];

  const results = await this.aggregate(pipeline);
  return this.processDistributionResults(results, options);
};

// Controller simplificado
const getScooterDistribution = async (req, res, next) => {
  try {
    const filters = buildFilters(req.query);
    const options = buildOptions(req.query);

    const distribution = await ScooterAssignment
      .getDistributionOptimized(filters, options);

    res.status(200).json({
      success: true,
      data: distribution
    });
  } catch (error) {
    next(error);
  }
};
```

**Estimación:** 6-8 horas de refactorización

---

#### 2. accidentController.js
**Tamaño:** 629 líneas (25% sobre objetivo)
**Prioridad:** 🔴 ALTA

**Problemas detectados:**

**2.1. Agregaciones complejas sin optimizar**

```javascript
// Líneas 320-410: getAccidentHeatmap
const getAccidentHeatmap = async (req, res, next) => {
  try {
    const { distrito, gravedad, tipoAccidente, startDate, endDate } = req.query;

    // ❌ 90+ líneas de agregación en controller
    const pipeline = [
      {
        $match: {
          fecha: {
            $gte: new Date(startDate),
            $lte: new Date(endDate)
          }
        }
      },
      {
        $lookup: {
          from: 'locations',
          localField: 'ubicacion',
          foreignField: '_id',
          as: 'ubicacionData'
        }
      },
      // ... múltiples stages más
    ];

    const heatmapData = await Accident.aggregate(pipeline);

    // ❌ Procesamiento complejo en controller
    const processedData = heatmapData.map(item => {
      // ... lógica de procesamiento
    });

    res.status(200).json({ success: true, data: processedData });
  } catch (error) {
    next(error);
  }
};
```

**2.2. Código duplicado de validación**

```javascript
// Líneas 50-80: Código repetido en múltiples endpoints
const filters = {};

if (distrito) {
  filters['distrito.nombre'] = new RegExp(distrito, 'i');
}

if (gravedad) {
  const gravedades = Array.isArray(gravedad) ? gravedad : [gravedad];
  filters.gravedad = { $in: gravedades };
}

if (tipoAccidente) {
  filters.tipoAccidente = new RegExp(tipoAccidente, 'i');
}

if (startDate || endDate) {
  filters.fecha = {};
  if (startDate) filters.fecha.$gte = new Date(startDate);
  if (endDate) filters.fecha.$lte = new Date(endDate);
}

// ❌ Este patrón se repite en 6+ endpoints
```

**Estimación:** 8-10 horas de refactorización

---

#### 3. airQualityController.js
**Tamaño:** 549 líneas (10% sobre objetivo)
**Prioridad:** 🟡 MEDIA

**Problemas detectados:**

```javascript
// Líneas 220-310: getAirQualityTrends
const getAirQualityTrends = async (req, res, next) => {
  try {
    const { estacion, magnitud, periodo, startDate, endDate } = req.query;

    // ❌ Agregación de 90+ líneas en controller
    let groupBy;
    switch (periodo) {
      case 'daily':
        groupBy = { $dateToString: { format: '%Y-%m-%d', date: '$fecha' } };
        break;
      case 'weekly':
        groupBy = {
          $dateToString: { format: '%Y-W%V', date: '$fecha' }
        };
        break;
      case 'monthly':
        groupBy = { $dateToString: { format: '%Y-%m', date: '$fecha' } };
        break;
    }

    const pipeline = [
      {
        $match: {
          fecha: { $gte: new Date(startDate), $lte: new Date(endDate) }
        }
      },
      {
        $group: {
          _id: groupBy,
          valorPromedio: { $avg: '$valor' },
          valorMinimo: { $min: '$valor' },
          valorMaximo: { $max: '$valor' },
          // ... más campos
        }
      },
      // ... múltiples stages adicionales
    ];

    const trends = await AirQuality.aggregate(pipeline);
    res.status(200).json({ success: true, data: trends });
  } catch (error) {
    next(error);
  }
};
```

**Estimación:** 6-8 horas de refactorización

---

#### 4. bikeAvailabilityController.js
**Tamaño:** 523 líneas
**Prioridad:** 🟡 MEDIA

**Problemas detectados:**

```javascript
// Líneas 150-230: getStationAvailability
// ❌ Agregación compleja sin optimizar (80+ líneas)

// Líneas 280-340: getBikeUsagePatterns
// ❌ Procesamiento de datos temporal en controller (60+ líneas)

// Líneas 400-450: getStationComparison
// ❌ Lógica de comparación compleja en controller (50+ líneas)
```

**Estimación:** 6-8 horas de refactorización

---

#### 5. bikeCapacityController.js
**Tamaño:** 504 líneas
**Prioridad:** 🟡 MEDIA

**Problemas similares:**
- Agregaciones complejas en controller (70+ líneas cada una)
- Procesamiento de datos de aforo sin optimizar
- Falta de métodos estáticos en modelo

**Estimación:** 6-8 horas de refactorización

---

#### 6. containerController.js
**Tamaño:** 487 líneas
**Prioridad:** 🟢 MEDIA-BAJA

**Problemas:**
- Controller relativamente simple pero con agregaciones mejorables
- Oportunidades de optimización con índices

**Estimación:** 4-6 horas de refactorización

---

#### 7. noiseMonitoringController.js
**Tamaño:** 511 líneas
**Prioridad:** 🟡 MEDIA

**Problemas:**
```javascript
// Líneas 180-270: getNoiseHeatmap
// ❌ 90+ líneas de agregación para generar mapa de calor

// Líneas 310-380: getNoiseTrends
// ❌ Análisis temporal complejo en controller

// Líneas 420-480: getNoiseStatsByZone
// ❌ Estadísticas por zona sin optimizar
```

**Estimación:** 6-8 horas de refactorización

---

#### 8. parkingOccupancyController.js
**Tamaño:** 458 líneas
**Prioridad:** 🟢 MEDIA-BAJA

**Problemas:**
- Agregaciones de ocupación de aparcamientos sin optimizar
- Cálculos de disponibilidad en tiempo real mejorables

**Estimación:** 4-6 horas de refactorización

---

## 📊 RESUMEN DE REFACTORIZACIÓN NECESARIA

| Controller | Líneas | Reducción Estimada | Prioridad | Esfuerzo |
|------------|--------|-------------------|-----------|----------|
| scooterAssignmentController.js | 635 | -150 (24%) | 🔴 Alta | 6-8h |
| accidentController.js | 629 | -180 (29%) | 🔴 Alta | 8-10h |
| airQualityController.js | 549 | -120 (22%) | 🟡 Media | 6-8h |
| bikeAvailabilityController.js | 523 | -130 (25%) | 🟡 Media | 6-8h |
| bikeCapacityController.js | 504 | -110 (22%) | 🟡 Media | 6-8h |
| noiseMonitoringController.js | 511 | -120 (23%) | 🟡 Media | 6-8h |
| containerController.js | 487 | -80 (16%) | 🟢 Baja | 4-6h |
| parkingOccupancyController.js | 458 | -70 (15%) | 🟢 Baja | 4-6h |
| **TOTAL** | **4,296** | **-960 (22%)** | - | **46-60h** |

---

## 🟡 PROBLEMA: Console.log en Controllers

**Severidad:** MEDIA
**Archivos afectados:** TODOS los controllers

**Búsqueda realizada:**
```
Patrón: console\.(log|error|warn)
Resultados: 60+ ocurrencias en controllers
```

**Distribución por controller:**

```javascript
// accidentController.js - 12 ocurrencias
console.log('Filters applied:', filters);  // Línea 85
console.error('Error in getAccidentStats:', error);  // Línea 320
console.log('Pipeline:', JSON.stringify(pipeline, null, 2));  // Línea 245

// airQualityController.js - 9 ocurrencias
console.log('Air quality query:', filters);  // Línea 67
console.warn('Missing magnitud parameter');  // Línea 142
console.error('Aggregation failed:', error);  // Línea 298

// scooterAssignmentController.js - 11 ocurrencias
console.log('Scooter filters:', filters);  // Línea 92
console.log('Distribution data:', distribution);  // Línea 234

// bikeAvailabilityController.js - 8 ocurrencias
// bikeCapacityController.js - 6 ocurrencias
// censusController.js - 3 ocurrencias (ya reducido tras Sprint 1)
// containerController.js - 4 ocurrencias
// fineController.js - 2 ocurrencias (ya reducido tras Sprint 1)
// noiseMonitoringController.js - 7 ocurrencias
// parkingOccupancyController.js - 5 ocurrencias
// trafficController.js - 1 ocurrencia (ya reducido tras Sprint 1)
```

**Plan de eliminación:**

### Fase 1: Reemplazar console.error
```javascript
// ❌ Antes
console.error('Error in getAccidentStats:', error);

// ✅ Después
logger.error('Error in getAccidentStats', {
  error: error.message,
  stack: error.stack,
  endpoint: 'GET /api/accidents/stats'
});
```

### Fase 2: Eliminar console.log de debug
```javascript
// ❌ Antes
console.log('Filters applied:', filters);
console.log('Pipeline:', JSON.stringify(pipeline, null, 2));

// ✅ Después
// Si es necesario mantener, usar logger
logger.debug('Filters applied', { filters });
logger.debug('Pipeline generated', { pipelineStages: pipeline.length });
```

### Fase 3: Convertir console.warn
```javascript
// ❌ Antes
console.warn('Missing magnitud parameter');

// ✅ Después
logger.warn('Missing required parameter', {
  parameter: 'magnitud',
  endpoint: 'GET /api/air-quality/trends'
});
```

**Estimación:** 3-4 horas para todos los controllers

---

## 🟡 PROBLEMA: Duplicación de Código

**Severidad:** MEDIA

### Patrón Duplicado #1: Construcción de Filtros

**Repetido en:** 8 controllers
**Líneas duplicadas:** ~30 líneas por controller = 240 líneas totales

```javascript
// Código repetido en múltiples controllers
const filters = {};

if (distrito) {
  filters['distrito.nombre'] = new RegExp(distrito, 'i');
}

if (startDate || endDate) {
  filters.fecha = {};
  if (startDate) filters.fecha.$gte = new Date(startDate);
  if (endDate) filters.fecha.$lte = new Date(endDate);
}

if (req.query.someField) {
  filters.someField = req.query.someField;
}
```

**Solución:** Usar helper `buildFilters` (propuesto en 02_ARCHITECTURE.md)

---

### Patrón Duplicado #2: Configuración de Paginación

**Repetido en:** 10 controllers
**Líneas duplicadas:** ~15 líneas por controller = 150 líneas totales

```javascript
// Código repetido
const page = parseInt(req.query.page) || 1;
const limit = parseInt(req.query.limit) || 50;
const skip = (page - 1) * limit;

if (limit > 100) {
  return next(new AppError('Límite máximo es 100', 400));
}

if (page < 1) {
  return next(new AppError('Página debe ser mayor a 0', 400));
}
```

**Solución:** Ya existe `paginationHelper.js` pero no se usa consistentemente

---

### Patrón Duplicado #3: Validación de Ordenamiento

**Repetido en:** 9 controllers
**Líneas duplicadas:** ~10 líneas por controller = 90 líneas totales

```javascript
// Código repetido
const validSortFields = ['fecha', 'nombre', 'valor'];
const sortField = validSortFields.includes(req.query.sortBy)
  ? req.query.sortBy
  : 'fecha';
const sortDirection = req.query.sortOrder === 'asc' ? 1 : -1;
const sortOptions = {};
sortOptions[sortField] = sortDirection;
```

**Solución:** Crear helper `buildSortOptions` (propuesto en 02_ARCHITECTURE.md)

---

## 📋 COMPARACIÓN: Controllers Refactorizados vs No Refactorizados

### ✅ Controllers Optimizados (Sprint 1)

#### censusController.js
```javascript
// ✅ Después de refactorización
const getPoblacionPorDistrito = async (req, res, next) => {
  try {
    const cacheKey = generateCacheKey('poblacion', req.query);
    const cachedData = cache.get(cacheKey);

    if (cachedData) {
      return res.status(200).json({
        success: true,
        cached: true,
        data: cachedData
      });
    }

    const filters = buildFilters(req.query);
    const options = buildOptions(req.query);

    const poblacion = await Census.getPoblacionPorDistritoOptimizada(filters, options);

    cache.set(cacheKey, poblacion);

    res.status(200).json({
      success: true,
      cached: false,
      data: poblacion
    });
  } catch (error) {
    next(error);
  }
};
```

**Características:**
- ✅ Lógica de agregación en modelo
- ✅ Caché implementado
- ✅ Helpers para filtros y opciones
- ✅ Controller simple y limpio
- ✅ Sin console.log
- ✅ Manejo de errores consistente

**Resultado:** 691 líneas (reducción del 30% vs versión original)

---

#### fineController.js
```javascript
// ✅ Después de refactorización
const getMultasEstadisticas = async (req, res, next) => {
  try {
    const cacheKey = generateCacheKey('multas-stats', req.query);
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

    const estadisticas = await Fine.getStatisticsOptimized(filters, options);

    statisticsCache.set(cacheKey, estadisticas);

    res.status(200).json({
      success: true,
      cached: false,
      data: estadisticas
    });
  } catch (error) {
    next(error);
  }
};
```

**Resultado:** 444 líneas (reducción del 35% vs versión original)

---

#### trafficController.js
```javascript
// ✅ Después de refactorización
const getAnalisisCongestion = async (req, res, next) => {
  try {
    const cacheKey = generateCacheKey('traffic-congestion', req.query);
    const cachedData = trafficCache.get(cacheKey);

    if (cachedData) {
      return res.status(200).json({
        success: true,
        cached: true,
        data: cachedData
      });
    }

    const filters = buildFilters(req.query);
    const options = buildOptions(req.query);

    const analisis = await Traffic.getCongestionAnalysisOptimized(filters, options);

    trafficCache.set(cacheKey, analisis);

    res.status(200).json({
      success: true,
      cached: false,
      data: analisis
    });
  } catch (error) {
    next(error);
  }
};
```

**Resultado:** 315 líneas (reducción del 40% vs versión original)

---

### ❌ Controllers No Optimizados (Ejemplo)

#### accidentController.js (Sin refactorizar)
```javascript
// ❌ Sin refactorizar (ejemplo simplificado)
const getAccidentStats = async (req, res, next) => {
  try {
    const { distrito, gravedad, startDate, endDate } = req.query;

    console.log('Getting accident stats for:', { distrito, gravedad });  // ❌

    // ❌ Construcción de filtros inline
    const filters = {};
    if (distrito) {
      filters['distrito.nombre'] = new RegExp(distrito, 'i');
    }
    if (gravedad) {
      const gravedades = Array.isArray(gravedad) ? gravedad : [gravedad];
      filters.gravedad = { $in: gravedades };
    }
    if (startDate || endDate) {
      filters.fecha = {};
      if (startDate) filters.fecha.$gte = new Date(startDate);
      if (endDate) filters.fecha.$lte = new Date(endDate);
    }

    // ❌ Agregación compleja de 80+ líneas en controller
    const pipeline = [
      {
        $match: filters
      },
      {
        $group: {
          _id: {
            distrito: '$distrito.nombre',
            gravedad: '$gravedad'
          },
          total: { $sum: 1 },
          // ... 15+ campos más
        }
      },
      {
        $lookup: {
          from: 'locations',
          localField: '_id.distrito',
          foreignField: 'nombre',
          as: 'ubicacionData'
        }
      },
      // ... 10+ stages más de agregación
    ];

    console.log('Pipeline generated:', pipeline.length, 'stages');  // ❌

    const results = await Accident.aggregate(pipeline);

    // ❌ Procesamiento de datos en controller
    const processedData = results.map(item => {
      return {
        distrito: item._id.distrito,
        gravedad: item._id.gravedad,
        total: item.total,
        porcentaje: (item.total / totalAccidents) * 100,
        // ... más procesamiento
      };
    });

    console.log('Results processed:', processedData.length, 'items');  // ❌

    res.status(200).json({
      success: true,
      data: processedData
    });
  } catch (error) {
    console.error('Error in getAccidentStats:', error);  // ❌
    next(error);
  }
};
```

**Problemas:**
- ❌ 3+ console.log
- ❌ Filtros construidos inline
- ❌ 80+ líneas de agregación en controller
- ❌ Procesamiento de datos en controller
- ❌ Sin caché
- ❌ Sin helpers

---

## 🎯 PLAN DE REFACTORIZACIÓN POR SPRINTS

### Sprint 2 (Prioridad ALTA)
**Objetivo:** Refactorizar 2 controllers más grandes

1. **scooterAssignmentController.js** (635 líneas)
   - Mover agregaciones a modelo
   - Implementar caché
   - Eliminar console.log
   - **Reducción esperada:** -150 líneas (24%)

2. **accidentController.js** (629 líneas)
   - Mover agregaciones a modelo
   - Implementar caché
   - Crear helpers específicos
   - Eliminar console.log
   - **Reducción esperada:** -180 líneas (29%)

**Duración:** 16-20 horas

---

### Sprint 3 (Prioridad MEDIA)
**Objetivo:** Refactorizar 3 controllers medianos

3. **airQualityController.js** (549 líneas)
4. **bikeAvailabilityController.js** (523 líneas)
5. **bikeCapacityController.js** (504 líneas)

**Reducción esperada total:** -360 líneas
**Duración:** 18-24 horas

---

### Sprint 4 (Prioridad MEDIA-BAJA)
**Objetivo:** Refactorizar 3 controllers restantes

6. **noiseMonitoringController.js** (511 líneas)
7. **containerController.js** (487 líneas)
8. **parkingOccupancyController.js** (458 líneas)

**Reducción esperada total:** -270 líneas
**Duración:** 14-18 horas

---

## 📊 IMPACTO ESPERADO POST-REFACTORIZACIÓN

### Situación Actual (Post Sprint 1)
```
Controllers refactorizados: 3/11 (27%)
Líneas de código: 5,150
Controllers > 500 líneas: 8
Console.log: 60+
Performance optimizada: 3 controllers
```

### Situación Esperada (Post Sprint 4)
```
Controllers refactorizados: 11/11 (100%)
Líneas de código: ~4,200 (-18%)
Controllers > 500 líneas: 0
Console.log: 0
Performance optimizada: 11 controllers
Tiempo de respuesta: -40% promedio
```

---

## ✅ RECOMENDACIONES FINALES

1. **Seguir el patrón de Sprint 1**
   - Mover agregaciones complejas a modelos
   - Implementar caché por tipo de dato
   - Usar helpers consistentemente

2. **Priorizar por impacto**
   - Sprint 2: Controllers con más tráfico
   - Sprint 3: Controllers de complejidad media
   - Sprint 4: Controllers más simples

3. **Mantener consistencia**
   - Mismo estilo de código que Census, Fine, Traffic
   - Mismos patterns de caché
   - Misma estructura de respuestas

4. **Documentar cambios**
   - Actualizar API_ROUTES.md
   - Documentar nuevos métodos del modelo
   - Añadir ejemplos de uso
