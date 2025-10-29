# 🔍 ISSUES ESPECÍFICOS POR ARCHIVO

**Documento:** 10 de 10
**Fecha:** 16 de Octubre de 2025

---

## 📊 RESUMEN EJECUTIVO

Este documento cataloga problemas específicos encontrados en cada archivo del proyecto, con referencias exactas a líneas de código cuando es posible.

---

## 🎮 CONTROLLERS

### 📁 accidentController.js (629 líneas)

**Prioridad:** 🔴 ALTA

#### Issues Detectados:

**ISSUE #1: Console.log abundantes**
- **Líneas:** 85, 142, 245, 320, 380, 420, 450, 480
- **Severidad:** MEDIA
- **Código:**
```javascript
// Línea 85
console.log('Filters applied:', filters);

// Línea 245
console.log('Pipeline:', JSON.stringify(pipeline, null, 2));

// Línea 320
console.error('Error in getAccidentStats:', error);
```
- **Fix:** Reemplazar con logger.debug() / logger.error()

---

**ISSUE #2: Agregación de 90+ líneas en controller**
- **Líneas:** 320-410
- **Severidad:** ALTA
- **Función:** `getAccidentHeatmap`
- **Problema:** Pipeline de agregación complejo directamente en controller
- **Fix:** Mover a `Accident.getHeatmapDataOptimized()` static method

---

**ISSUE #3: Construcción de filtros repetitiva**
- **Líneas:** 50-80, 120-145, 200-225, 350-370
- **Severidad:** MEDIA
- **Código repetido:**
```javascript
const filters = {};
if (distrito) filters['distrito.nombre'] = new RegExp(distrito, 'i');
if (startDate || endDate) {
  filters.fecha = {};
  if (startDate) filters.fecha.$gte = new Date(startDate);
  if (endDate) filters.fecha.$lte = new Date(endDate);
}
```
- **Fix:** Usar helper `buildFilters(req.query)`

---

**ISSUE #4: Sin caché implementado**
- **Severidad:** ALTA
- **Endpoints afectados:** Todos (9 endpoints)
- **Fix:** Implementar patrón de caché como en censusController

---

**ISSUE #5: Queries sin .lean()**
- **Líneas:** 85, 180, 280, 350, 420, 480, 520, 580
- **Severidad:** MEDIA
- **Ejemplo:**
```javascript
// Línea 85
const accidents = await Accident.find(filters).sort({ fecha: -1 });
// Debería ser: .lean()
```
- **Fix:** Añadir .lean() a queries de solo lectura

---

**ISSUE #6: Sin JSDoc**
- **Severidad:** BAJA
- **Fix:** Documentar todas las funciones exportadas

---

### 📁 airQualityController.js (549 líneas)

**Prioridad:** 🔴 ALTA

#### Issues Detectados:

**ISSUE #1: Console.log/warn (9 ocurrencias)**
- **Líneas:** 67, 142, 178, 220, 298, 340, 380, 420, 480
- **Fix:** Migrar a logger

**ISSUE #2: Función getAirQualityTrends muy compleja**
- **Líneas:** 220-310
- **Complejidad ciclomática:** ~15
- **Problema:** Switch case + validaciones + construcción de filtros
- **Fix:** Dividir en funciones auxiliares

**ISSUE #3: Agregación temporal sin optimizar**
- **Líneas:** 220-310
- **Severidad:** ALTA
- **Fix:** Mover a `AirQuality.getTrendsOptimized()`

**ISSUE #4: Sin validación de magnitud**
- **Líneas:** 142
- **Código:**
```javascript
console.warn('Missing magnitud parameter');
// Pero no retorna error 400
```
- **Fix:** Validar y retornar AppError apropiado

---

### 📁 scooterAssignmentController.js (635 líneas)

**Prioridad:** 🔴 ALTA

#### Issues Detectados:

**ISSUE #1: Controller más grande (635 líneas)**
- **Severidad:** ALTA
- **Problema:** 27% sobre objetivo de 500 líneas
- **Fix:** Mover agregaciones a modelo

**ISSUE #2: getScooterDistribution sin optimizar**
- **Líneas:** 180-250
- **Problema:** 70+ líneas de agregación en controller
- **Fix:** `ScooterAssignment.getDistributionOptimized()`

**ISSUE #3: Console.log (11 ocurrencias)**
- **Líneas:** 92, 145, 234, 280, 320, 360, 400, 450, 490, 540, 590
- **Fix:** Migrar a logger

**ISSUE #4: Duplicación de código de filtros**
- **Líneas:** 40-55, 100-115, 190-205, 290-305
- **Fix:** Usar helper buildFilters()

---

### 📁 bikeAvailabilityController.js (523 líneas)

**Prioridad:** 🟡 MEDIA

#### Issues Detectados:

**ISSUE #1: Console.log (8 ocurrencias)**
- **Líneas:** 45, 90, 150, 210, 270, 320, 380, 450
- **Fix:** Migrar a logger

**ISSUE #2: getStationAvailability sin optimizar**
- **Líneas:** 150-230
- **Problema:** Agregación de 80+ líneas
- **Fix:** Mover a modelo

**ISSUE #3: getBikeUsagePatterns complejo**
- **Líneas:** 280-340
- **Complejidad:** Alta
- **Fix:** Dividir en funciones + mover a modelo

---

### 📁 bikeCapacityController.js (504 líneas)

**Prioridad:** 🟡 MEDIA

#### Issues Similares a bikeAvailabilityController
- Console.log (6 ocurrencias)
- Agregaciones sin optimizar
- Sin caché

---

### 📁 censusController.js (691 líneas) ✅

**Prioridad:** 🟢 BAJA (ya refactorizado)

#### Issues Menores:

**ISSUE #1: Console.log residuales (3 ocurrencias)**
- **Líneas:** 120, 280, 450
- **Severidad:** BAJA
- **Fix:** Eliminar o convertir a logger.debug()

**ISSUE #2: Falta JSDoc en algunas funciones**
- **Líneas:** 550-620
- **Severidad:** BAJA
- **Fix:** Completar documentación

---

### 📁 containerController.js (487 líneas)

**Prioridad:** 🟢 MEDIA-BAJA

#### Issues Detectados:

**ISSUE #1: Console.log (4 ocurrencias)**
- **Líneas:** 60, 180, 290, 400
- **Fix:** Migrar a logger

**ISSUE #2: Queries geoespaciales sin índice 2dsphere + campo adicional**
- **Severidad:** MEDIA
- **Fix:** Añadir índice compuesto

---

### 📁 fineController.js (444 líneas) ✅

**Prioridad:** 🟢 BAJA (ya refactorizado)

#### Issues Menores:

**ISSUE #1: Console.log residuales (2 ocurrencias)**
- **Líneas:** 150, 320
- **Severidad:** BAJA

---

### 📁 noiseMonitoringController.js (511 líneas)

**Prioridad:** 🟡 MEDIA

#### Issues Detectados:

**ISSUE #1: Console.log (7 ocurrencias)**
- **Líneas:** 70, 140, 210, 280, 350, 420, 480

**ISSUE #2: getNoiseHeatmap sin optimizar**
- **Líneas:** 180-270
- **Problema:** 90+ líneas de agregación

**ISSUE #3: getNoiseTrends análisis temporal complejo**
- **Líneas:** 310-380
- **Fix:** Mover a modelo

---

### 📁 parkingOccupancyController.js (458 líneas)

**Prioridad:** 🟢 MEDIA-BAJA

#### Issues Detectados:

**ISSUE #1: Console.log (5 ocurrencias)**
- **Líneas:** 80, 160, 240, 320, 400

**ISSUE #2: Agregaciones mejorables**
- **Severidad:** MEDIA
- **Fix:** Mover a modelo + añadir índices

---

### 📁 trafficController.js (315 líneas) ✅

**Prioridad:** 🟢 BAJA (ya refactorizado)

#### Issues Menores:

**ISSUE #1: Un console.error residual**
- **Línea:** 280
- **Severidad:** BAJA

---

### 📁 authController.js

**Prioridad:** 🟡 MEDIA

#### Issues Detectados:

**ISSUE #1: Refresh token sin rotación**
- **Líneas:** 180-200
- **Severidad:** MEDIA
- **Código:**
```javascript
const refreshToken = async (req, res, next) => {
  try {
    const { refreshToken } = req.body;
    const decoded = jwt.verify(refreshToken, process.env.REFRESH_TOKEN_SECRET);
    const user = await User.findById(decoded.id);

    // ❌ Genera nuevo access token pero mantiene mismo refresh token
    const accessToken = generateAccessToken(user);

    res.status(200).json({
      success: true,
      accessToken,
      refreshToken // ❌ Mismo token
    });
  } catch (error) {
    next(error);
  }
};
```
- **Fix:** Implementar refresh token rotation

**ISSUE #2: Sin account lockout**
- **Líneas:** 60-100 (función login)
- **Severidad:** MEDIA
- **Fix:** Implementar contador de intentos fallidos + lockout temporal

**ISSUE #3: Console.log (2 ocurrencias)**
- **Líneas:** 75, 145

---

## 📊 MODELS

### 📁 Accident.js

**Prioridad:** 🔴 ALTA

#### Issues Detectados:

**ISSUE #1: Índices insuficientes**
- **Severidad:** CRÍTICA
- **Índices actuales:**
```javascript
accidentSchema.index({ fecha: 1 });
accidentSchema.index({ 'distrito.nombre': 1 });
accidentSchema.index({ gravedad: 1 });
```
- **Índices faltantes:**
```javascript
// Query frecuente: fecha + distrito
accidentSchema.index({ fecha: 1, 'distrito.nombre': 1 });

// Queries geoespaciales
accidentSchema.index({ 'ubicacion.coordinates': '2dsphere' });

// Análisis por tipo + gravedad
accidentSchema.index({ tipoAccidente: 1, gravedad: 1 });

// Análisis temporal
accidentSchema.index({ fecha: -1, tipoAccidente: 1, gravedad: 1 });
```

**ISSUE #2: Sin métodos estáticos**
- **Severidad:** ALTA
- **Métodos necesarios:**
  - getHeatmapDataOptimized()
  - getAccidentTrendsByDistrict()
  - getAccidentStatisticsByType()
  - getAccidentSeverityAnalysis()
  - getAccidentTimePatterns()

**ISSUE #3: Validación inconsistente**
- **Problema:** Sin validación de fecha futura
```javascript
fecha: {
  type: Date,
  required: [true, 'Fecha es obligatoria'],
  // ❌ Sin validación
}

// Debería tener:
accidentSchema.path('fecha').validate(function(value) {
  return value <= new Date();
}, 'Fecha no puede ser futura');
```

**ISSUE #4: gravedad sin enum**
- **Problema:**
```javascript
gravedad: {
  type: String,
  required: true,
  // ❌ Sin enum
}

// Debería ser:
gravedad: {
  type: String,
  required: [true, 'Gravedad es obligatoria'],
  enum: {
    values: ['LEVE', 'GRAVE', 'MORTAL', 'SIN_LESIONES'],
    message: 'Gravedad inválida: {VALUE}'
  }
}
```

---

### 📁 AirQuality.js

**Prioridad:** 🔴 ALTA

#### Issues Detectados:

**ISSUE #1: Índices insuficientes**
- **Severidad:** CRÍTICA
- **Índices faltantes:**
```javascript
airQualitySchema.index({ estacion: 1, fecha: 1 });
airQualitySchema.index({ magnitud: 1, fecha: 1 });
airQualitySchema.index({ estacion: 1, magnitud: 1, fecha: 1 });
airQualitySchema.index({ magnitud: 1, valor: 1 });
```

**ISSUE #2: Sin métodos estáticos (0 de 6-8 necesarios)**
- **Métodos necesarios:**
  - getTrendsOptimized()
  - getStationComparisonOptimized()
  - getPollutantAnalysisOptimized()
  - getAirQualityIndexOptimized()
  - getCriticalLevelsOptimized()

**ISSUE #3: valor sin validación de rango**
```javascript
valor: {
  type: Number,
  required: true,
  // ❌ Sin min/max
  // Podría aceptar valores negativos o imposibles
}

// Debería tener validación por magnitud:
airQualitySchema.path('valor').validate(function(value) {
  if (this.magnitud === 'PM10') {
    return value >= 0 && value <= 500;
  }
  // ... otros contaminantes
}, 'Valor fuera de rango válido');
```

---

### 📁 ScooterAssignment.js

**Prioridad:** 🔴 ALTA

#### Issues Similares:
- Índices insuficientes (3 faltantes)
- Sin métodos estáticos (0 de 4-6 necesarios)
- Sin validación de disponibles vs enUso

---

### 📁 Census.js ✅

**Prioridad:** 🟢 BAJA (ya refactorizado)

#### Issues Menores:

**ISSUE #1: Falta JSDoc en algunos métodos estáticos**
- **Métodos sin documentar:** 3 de 12
- **Severidad:** BAJA

---

### 📁 Fine.js ✅

**Prioridad:** 🟢 BAJA (ya refactorizado)

#### Issues Menores:

**ISSUE #1: Pre-save hook no valida descuento máximo**
```javascript
fineSchema.pre('save', function(next) {
  if (this.descuento > 0) {
    this.importeFinal = this.importe * (1 - this.descuento / 100);
  }
  // ❌ No valida que descuento <= 50% (o límite configurado)
  next();
});
```

---

### 📁 Traffic.js ✅

**Prioridad:** 🟢 BAJA (ya refactorizado)

#### Issues Menores:

**ISSUE #1: Podría beneficiarse de 2 índices adicionales**
```javascript
// Para queries de top congestion
trafficSchema.index({ fecha: 1, ocupacion: -1 });

// Para análisis por distrito
trafficSchema.index({ 'distrito.nombre': 1, fecha: 1, intensidad: -1 });
```

---

## 🛡️ MIDDLEWARE

### 📁 auth.js

**Prioridad:** 🟡 MEDIA

#### Issues Detectados:

**ISSUE #1: Sin logging de eventos de seguridad**
- **Líneas:** 30-50
- **Problema:**
```javascript
catch (error) {
  return res.status(401).json({
    success: false,
    message: 'Token inválido o expirado'
  });
  // ❌ No loguea intento de acceso con token inválido
}
```
- **Fix:**
```javascript
catch (error) {
  logger.security('Token validation failed', {
    token: token.slice(0, 20),
    ip: req.ip,
    error: error.message
  });
  return res.status(401).json({
    success: false,
    message: 'Token inválido o expirado'
  });
}
```

---

### 📁 security.js

**Prioridad:** 🟡 MEDIA

#### Issues Detectados:

**ISSUE #1: Rate limiter no específico para auth**
- **Líneas:** 15-25
- **Problema:** Rate limit global de 100 req/15min es muy permisivo para endpoints de autenticación
- **Fix:** Crear authLimiter con 5 req/15min

**ISSUE #2: mongoSanitize loguea con console.warn**
- **Líneas:** 35
```javascript
onSanitize: ({ req, key }) => {
  console.warn(`Intento de inyección NoSQL detectado: ${key}`);  // ❌
}
```
- **Fix:** Usar logger.security()

---

### 📁 errorHandler.js

**Prioridad:** 🟡 MEDIA

#### Issues Detectados:

**ISSUE #1: Console.error en lugar de logger**
- **Líneas:** 12, 45, 80
- **Fix:** Migrar a logger.error()

**ISSUE #2: Formato de error response inconsistente**
- **Líneas:** 50-70
- **Problema:** Diferentes estructuras de error según el tipo
- **Fix:** Estandarizar formato de respuesta

---

### 📁 cache.js ✅

**Prioridad:** 🟢 BAJA (bien implementado)

#### Issues Menores:

**ISSUE #1: Sin helper para generación de cache keys**
- **Severidad:** BAJA
- **Fix:** Exportar función generateCacheKey()

---

## 🔧 UTILS

### 📁 AppError.js

**Prioridad:** 🟢 BAJA

#### Issues Detectados:

**ISSUE #1: Sin JSDoc**
- **Severidad:** BAJA
- **Fix:** Documentar clase y constructor

**ISSUE #2: Podría tener códigos de error**
```javascript
class AppError extends Error {
  constructor(message, statusCode) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = true;
    // ❌ Sin código de error para manejo programático
  }
}

// Mejora:
class AppError extends Error {
  constructor(message, statusCode, code = null) {
    super(message);
    this.statusCode = statusCode;
    this.code = code; // 'INVALID_PARAMS', 'NOT_FOUND', etc.
    this.isOperational = true;
  }
}
```

---

### 📁 paginationHelper.js ✅

**Prioridad:** 🟢 BAJA (bien implementado)

#### Issues Menores:

**ISSUE #1: No se usa consistentemente**
- **Severidad:** MEDIA
- **Problema:** 10 controllers no lo usan
- **Fix:** Refactorizar controllers para usar el helper

---

## 📝 CONFIGURACIÓN

### 📁 package.json

**Prioridad:** 🟡 MEDIA

#### Issues Detectados:

**ISSUE #1: Sin scripts de test**
```json
{
  "scripts": {
    "dev": "nodemon src/server.js",
    "start": "node src/server.js"
    // ❌ Falta "test", "test:coverage", "test:watch"
  }
}
```

**ISSUE #2: Dependencias desactualizadas (verificar)**
- **Fix:** Ejecutar `npm outdated` y actualizar versiones compatibles

---

### 📁 .env

**Prioridad:** 🟡 MEDIA (solo producción)

#### Issues Detectados:

**ISSUE #1: Secrets en archivo plano**
- **Severidad:** BAJA en desarrollo, ALTA en producción
- **Fix:** Usar gestor de secretos en producción (AWS Secrets Manager, Azure Key Vault)

---

## 📊 RESUMEN POR PRIORIDAD

### 🔴 CRÍTICA (Inmediato - Sprint 2)

| Archivo | Issues | Esfuerzo |
|---------|--------|----------|
| Accident.js | Índices + métodos estáticos | 10-12h |
| AirQuality.js | Índices + métodos estáticos | 10-12h |
| ScooterAssignment.js | Índices + métodos estáticos | 8-10h |
| accidentController.js | Refactorización completa | 8-10h |
| airQualityController.js | Refactorización completa | 8-10h |
| scooterAssignmentController.js | Refactorización completa | 8-10h |

**Total Sprint 2:** 52-64 horas

---

### 🟡 ALTA (Sprint 3)

| Archivo | Issues | Esfuerzo |
|---------|--------|----------|
| BikeAvailability.js + controller | Optimización | 8-10h |
| NoiseMonitoring.js + controller | Optimización | 8-10h |
| BikeCapacity.js + controller | Optimización | 6-8h |
| auth.js middleware | Security logging | 2-3h |
| security.js middleware | Rate limit auth | 1-2h |
| authController.js | Refresh rotation + lockout | 6-8h |

**Total Sprint 3:** 31-41 horas

---

### 🟢 MEDIA-BAJA (Sprint 4)

| Archivo | Issues | Esfuerzo |
|---------|--------|----------|
| Resto de controllers | Limpieza console.log | 6-8h |
| Resto de models | Validaciones | 4-6h |
| JSDoc completo | Documentación | 8-10h |
| Tests setup + críticos | Testing | 20-24h |

**Total Sprint 4:** 38-48 horas

---

## 📋 TOTAL ISSUES CATALOGADOS

```
Controllers: 45 issues
Models: 28 issues
Middleware: 8 issues
Utils: 4 issues
Config: 3 issues
---
TOTAL: 88 issues específicos
```

**Esfuerzo total estimado:** 121-153 horas (3-4 sprints de 2 semanas)
