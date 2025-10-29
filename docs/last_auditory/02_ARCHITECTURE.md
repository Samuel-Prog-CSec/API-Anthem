# 🏗️ ARQUITECTURA Y ESTRUCTURA

**Documento:** 02 de 10
**Fecha:** 16 de Octubre de 2025

---

## 📊 CALIFICACIÓN: 9.0/10

**Estado general:** ✅ EXCELENTE

La arquitectura MVC está bien implementada con separación clara de responsabilidades. Sin embargo, existen algunas áreas de mejora detectadas.

---

## ⚠️ PROBLEMAS IDENTIFICADOS

### 🟡 PROBLEMA #1: Middleware en Múltiples Ubicaciones

**Severidad:** MEDIA
**Ubicaciones:** `/src/middleware/` y `/src/routes/`

**Descripción:**
Existe middleware de validación definido tanto en archivos dedicados de middleware como inline en archivos de rutas.

**Ejemplo:**
```javascript
// En /src/routes/accidents.js
const validateDateRange = [
  query('startDate')
    .optional()
    .isISO8601()
    .withMessage('Fecha de inicio debe ser válida (ISO8601)')
    .toDate(),
  // ... más validaciones
];

// Debería estar en /src/middleware/validation.js
```

**Archivos afectados:**
- `src/routes/accidents.js` (líneas 60-90)
- `src/routes/containers.js`
- `src/routes/noiseMonitoring.js`
- `src/routes/scooterAssignments.js`
- `src/routes/traffic.js`

**Impacto:**
- Duplicación de código de validación
- Mantenimiento más complejo
- Inconsistencias entre rutas

**Recomendación:**
Mover todas las validaciones inline a `src/middleware/validation.js` o crear archivos de validación específicos por dominio.

**Ejemplo de solución:**
```javascript
// src/middleware/validation.js
const validateDateRange = [
  query('startDate')
    .optional()
    .isISO8601()
    .withMessage('Fecha de inicio debe ser válida (ISO8601)')
    .toDate()
    .custom((value) => {
      const now = new Date();
      if (value > now) {
        throw new Error('Fecha de inicio no puede ser futura');
      }
      return true;
    }),
  query('endDate')
    // ... validaciones
];

module.exports = {
  // ... otras validaciones
  validateDateRange,
  validatePagination,
  validateIdParam
};
```

---

### 🟡 PROBLEMA #2: Helpers Insuficientes

**Severidad:** MEDIA
**Ubicación:** `/src/utils/`

**Descripción:**
A pesar de tener `paginationHelper.js`, hay código repetitivo en controllers que podría estar en helpers.

**Código duplicado detectado:**

#### 2.1. Construcción de Filtros
**Repetido en:** 8+ controllers

```javascript
// Patrón repetido en múltiples controllers
const filters = {};

if (distrito) filters['distrito.nombre'] = new RegExp(distrito, 'i');
if (startDate || endDate) {
  filters.fecha = {};
  if (startDate) filters.fecha.$gte = new Date(startDate);
  if (endDate) filters.fecha.$lte = new Date(endDate);
}
```

**Ubicaciones:**
- `accidentController.js` (líneas 40-50)
- `airQualityController.js` (líneas 45-60)
- `containerController.js` (líneas 30-45)
- `noiseMonitoringController.js` (líneas 35-50)
- `scooterAssignmentController.js` (líneas 40-55)
- `bikeAvailabilityController.js` (líneas 30-45)

#### 2.2. Configuración de Ordenamiento
**Repetido en:** 10+ controllers

```javascript
// Patrón repetido
const validSortFields = ['fecha', 'nombre', 'valor'];
const sortField = validSortFields.includes(sortBy) ? sortBy : 'fecha';
const sortDirection = sortOrder === 'asc' ? 1 : -1;
const sortOptions = {};
sortOptions[sortField] = sortDirection;
```

#### 2.3. Validación de Rangos de Fecha
**Repetido en:** 6+ controllers

```javascript
// Patrón repetido
if (startDate && endDate) {
  const start = new Date(startDate);
  const end = new Date(endDate);
  if (start > end) {
    return next(new AppError('Fecha inicio no puede ser posterior a fecha fin', 400));
  }
  const diffTime = Math.abs(end - start);
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  if (diffDays > 365) {
    return next(new AppError('Rango no puede superar 1 año', 400));
  }
}
```

**Recomendación:**
Crear helpers adicionales:

```javascript
// src/utils/queryHelper.js
const buildFilters = (queryParams, filterConfig) => {
  const filters = {};

  filterConfig.forEach(({ field, type, transform }) => {
    const value = queryParams[field];
    if (!value) return;

    switch (type) {
      case 'regex':
        filters[field] = new RegExp(value, 'i');
        break;
      case 'exact':
        filters[field] = transform ? transform(value) : value;
        break;
      case 'array':
        filters[field] = { $in: Array.isArray(value) ? value : [value] };
        break;
    }
  });

  return filters;
};

const buildSortOptions = (sortBy, sortOrder, validFields, defaultField = 'createdAt') => {
  const sortField = validFields.includes(sortBy) ? sortBy : defaultField;
  const sortDirection = sortOrder === 'asc' ? 1 : -1;
  return { [sortField]: sortDirection };
};

const validateDateRange = (startDate, endDate, maxDays = 365) => {
  if (!startDate || !endDate) return { isValid: true };

  const start = new Date(startDate);
  const end = new Date(endDate);

  if (start > end) {
    return {
      isValid: false,
      error: 'Fecha de inicio no puede ser posterior a fecha de fin'
    };
  }

  const diffTime = Math.abs(end - start);
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

  if (diffDays > maxDays) {
    return {
      isValid: false,
      error: `El rango de fechas no puede superar ${maxDays} días`
    };
  }

  return { isValid: true };
};

module.exports = {
  buildFilters,
  buildSortOptions,
  validateDateRange
};
```

---

### 🟡 PROBLEMA #3: Falta de Service Layer

**Severidad:** MEDIA
**Ubicación:** Todo el proyecto

**Descripción:**
Actualmente la lógica está distribuida entre Controllers y Models. Para casos complejos, una capa de servicios mejoraría la arquitectura.

**Situación actual:**
```
Controller → Model → Database
```

**Situación recomendada para lógica compleja:**
```
Controller → Service → Model → Database
```

**Casos donde sería beneficioso:**

1. **Operaciones que involucran múltiples modelos:**
```javascript
// Ejemplo actual en accidentController.js (líneas 300-350)
const getAccidentStats = async (req, res, next) => {
  try {
    // Lógica compleja que involucra Accident + Location + otros datos
    const accidents = await Accident.find(filters);
    const locations = await Location.find({...});
    // Procesamiento complejo de datos de múltiples fuentes
    // ...
  } catch (error) {
    next(error);
  }
};
```

**Debería ser:**
```javascript
// src/services/accidentService.js
class AccidentService {
  async getAccidentStatistics(filters, options) {
    // Lógica compleja aquí
    const [accidents, locations, weather] = await Promise.all([
      Accident.find(filters),
      Location.find({...}),
      WeatherData.find({...})
    ]);

    // Procesamiento y agregación de datos
    return this.processStatistics(accidents, locations, weather);
  }

  processStatistics(accidents, locations, weather) {
    // Lógica de procesamiento
  }
}

// Controller simplificado
const getAccidentStats = async (req, res, next) => {
  try {
    const accidentService = new AccidentService();
    const stats = await accidentService.getAccidentStatistics(filters, options);
    res.status(200).json({ success: true, data: stats });
  } catch (error) {
    next(error);
  }
};
```

**Beneficios:**
- Controllers más simples y enfocados
- Lógica de negocio testeable independientemente
- Reutilización de lógica compleja
- Mejor separación de responsabilidades

**Recomendación:**
Implementar service layer para los siguientes casos:
- `accidentController`: Análisis complejos de accidentalidad
- `airQualityController`: Cálculos de índices de calidad de aire
- `scooterAssignmentController`: Análisis de optimización de distribución

---

### 🔵 PROBLEMA #4: Nomenclatura Inconsistente

**Severidad:** BAJA
**Ubicación:** Múltiples archivos

**Descripción:**
Mezcla de nombres en español e inglés en el código.

**Ejemplos:**
```javascript
// Español
const obtenerEstadisticas = async () => {};
const estadisticas = await Model.aggregate([]);

// Inglés
const getStatistics = async () => {};
const statistics = await Model.aggregate([]);

// Mezclado (encontrado en múltiples ubicaciones)
const getEstadisticas = async () => {}; // ❌ Inconsistente
```

**Archivos afectados:**
- Models: Nombres de campos en español (correcto, son datos del dominio)
- Controllers: Mix de español/inglés en nombres de variables
- Middleware: Principalmente inglés (correcto)

**Recomendación:**
**Código en inglés**, **datos del dominio en español** (como está actualmente pero más consistente).

```javascript
// ✅ CORRECTO
const statistics = await Census.getEstadisticasDistrito(year);
//     ^inglés^              ^método^        ^dato^

// ❌ EVITAR
const estadisticas = await Census.getDistrictStats(año);
//    ^español^              ^inglés^        ^español^
```

---

### 🔵 PROBLEMA #5: Organización de Constantes

**Severidad:** BAJA
**Ubicación:** Disperso en múltiples archivos

**Descripción:**
Valores constantes (enums, mensajes, configuraciones) están dispersos por el código.

**Ejemplos encontrados:**

```javascript
// En accidentController.js
const validSortFields = ['fecha', 'gravedad', 'distrito'];

// En airQualityController.js
const validSortFields = ['fecha', 'estacion', 'magnitud'];

// En routes/accidents.js
const validGravedades = ['LEVE', 'GRAVE', 'MORTAL'];
```

**Recomendación:**
Crear `/src/constants/index.js`:

```javascript
// src/constants/index.js
const SEVERITY_LEVELS = {
  ACCIDENT: ['LEVE', 'GRAVE', 'MORTAL', 'SIN_LESIONES'],
  FINE: ['LEVE', 'GRAVE', 'MUY_GRAVE'],
  AIR_QUALITY: ['BUENA', 'MODERADA', 'DAÑINA', 'PELIGROSA']
};

const SORT_FIELDS = {
  ACCIDENT: ['fecha', 'gravedad', 'distrito', 'tipoAccidente'],
  AIR_QUALITY: ['fecha', 'estacion', 'magnitud', 'valor'],
  TRAFFIC: ['fecha', 'puntoMedidaId', 'intensidad', 'ocupacion']
};

const ERROR_MESSAGES = {
  ES: {
    VALIDATION_FAILED: 'Error de validación',
    UNAUTHORIZED: 'No autorizado',
    NOT_FOUND: 'Recurso no encontrado',
    INTERNAL_ERROR: 'Error interno del servidor'
  },
  EN: {
    VALIDATION_FAILED: 'Validation failed',
    UNAUTHORIZED: 'Unauthorized',
    NOT_FOUND: 'Resource not found',
    INTERNAL_ERROR: 'Internal server error'
  }
};

const PAGINATION = {
  DEFAULT_PAGE: 1,
  DEFAULT_LIMIT: 50,
  MAX_LIMIT: 100,
  MAX_PAGE: 1000
};

module.exports = {
  SEVERITY_LEVELS,
  SORT_FIELDS,
  ERROR_MESSAGES,
  PAGINATION
};
```

---

## 📋 RESUMEN DE PROBLEMAS

| # | Problema | Severidad | Archivos Afectados | Esfuerzo |
|---|----------|-----------|-------------------|----------|
| 1 | Middleware inline en rutas | 🟡 Media | 5 archivos | 4-6 horas |
| 2 | Helpers insuficientes | 🟡 Media | 10+ controllers | 6-8 horas |
| 3 | Falta service layer | 🟡 Media | 3 controllers | 12-16 horas |
| 4 | Nomenclatura inconsistente | 🔵 Baja | Multiple | 2-3 horas |
| 5 | Constantes dispersas | 🔵 Baja | Multiple | 2-3 horas |

**Total estimado:** 26-36 horas de refactorización

---

## ✅ FORTALEZAS DETECTADAS

A pesar de los problemas, la arquitectura tiene puntos fuertes:

1. **Separación MVC clara** - Models, Views (JSON), Controllers bien definidos
2. **Middleware modular** - Bien organizado y reutilizable
3. **Rutas RESTful** - Diseño de API consistente
4. **Helpers existentes** - `paginationHelper` funciona bien
5. **Configuración centralizada** - `config/config.js` bien estructurado

---

## 🎯 RECOMENDACIONES PRIORITARIAS

### Inmediato (Sprint 2)
1. Consolidar validaciones inline en middleware dedicado
2. Crear `queryHelper.js` con funciones reutilizables

### Corto plazo (Sprint 3)
3. Implementar service layer para casos complejos
4. Crear `/src/constants/` con valores reutilizables

### Largo plazo (Sprint 4)
5. Estandarizar nomenclatura en todo el proyecto
6. Documentar decisiones arquitectónicas en `/docs/ARCHITECTURE.md`
