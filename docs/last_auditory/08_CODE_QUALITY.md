# 📝 CALIDAD DE CÓDIGO

**Documento:** 08 de 10
**Fecha:** 16 de Octubre de 2025

---

## 📊 CALIFICACIÓN: 7.5/10

**Estado general:** ⚠️ REQUIERE ATENCIÓN

Código generalmente limpio pero con áreas de mejora en documentación, duplicación y complejidad.

---

## 🟡 PROBLEMA: Documentación JSDoc Incompleta

**Severidad:** MEDIA
**Impacto:** Mantenibilidad

### Estado Actual

**Archivos con JSDoc:**
- `src/utils/paginationHelper.js` - ✅ Bien documentado
- `src/models/Census.js` (métodos estáticos) - ✅ Documentado
- `src/models/Fine.js` (métodos estáticos) - ✅ Documentado
- `src/models/Traffic.js` (métodos estáticos) - ✅ Documentado

**Archivos SIN JSDoc:**
- `src/controllers/*.js` (11 archivos) - ❌ Sin documentar
- `src/middleware/*.js` (5 archivos) - ❌ Parcialmente documentado
- `src/models/*.js` (8 modelos sin refactorizar) - ❌ Sin documentar
- `src/utils/AppError.js` - ❌ Sin documentar

### Ejemplos

#### ❌ Sin JSDoc (accidentController.js)
```javascript
const getAccidentStats = async (req, res, next) => {
  try {
    const { distrito, startDate, endDate } = req.query;
    // ... 50+ líneas sin documentación
  } catch (error) {
    next(error);
  }
};
```

#### ✅ Con JSDoc Completo
```javascript
/**
 * Obtiene estadísticas agregadas de accidentes
 *
 * @async
 * @function getAccidentStats
 * @param {Object} req - Request de Express
 * @param {Object} req.query - Query parameters
 * @param {string} [req.query.distrito] - Nombre del distrito para filtrar
 * @param {string} [req.query.startDate] - Fecha inicio (ISO 8601)
 * @param {string} [req.query.endDate] - Fecha fin (ISO 8601)
 * @param {string} [req.query.gravedad] - Gravedad: LEVE, GRAVE, MORTAL
 * @param {Object} res - Response de Express
 * @param {Function} next - Función next de Express
 * @returns {Promise<void>} JSON con estadísticas o error
 *
 * @throws {AppError} 400 - Si parámetros son inválidos
 * @throws {AppError} 500 - Si hay error en base de datos
 *
 * @example
 * GET /api/accidents/stats?distrito=Centro&startDate=2051-01-01
 * Response:
 * {
 *   "success": true,
 *   "data": {
 *     "total": 1250,
 *     "porGravedad": { "LEVE": 800, "GRAVE": 350, "MORTAL": 100 },
 *     "tendencia": [...]
 *   }
 * }
 */
const getAccidentStats = async (req, res, next) => {
  // ...
};
```

**Recomendación:** Documentar todas las funciones exportadas

**Esfuerzo:** 12-15 horas para todo el proyecto

---

## 🟡 PROBLEMA: Duplicación de Código

**Severidad:** MEDIA
**Impacto:** Mantenibilidad, Bug propagation

### Patrones Duplicados Detectados

#### 1. Construcción de Filtros (240 líneas duplicadas)

**Repetido en 8 controllers:**
```javascript
// Patrón repetido ~30 líneas por controller
const filters = {};

if (distrito) {
  filters['distrito.nombre'] = new RegExp(distrito, 'i');
}

if (startDate || endDate) {
  filters.fecha = {};
  if (startDate) filters.fecha.$gte = new Date(startDate);
  if (endDate) filters.fecha.$lte = new Date(endDate);
}

if (gravedad) {
  const gravedades = Array.isArray(gravedad) ? gravedad : [gravedad];
  filters.gravedad = { $in: gravedades };
}
```

**Solución:** Helper `buildFilters()` (ya propuesto en 02_ARCHITECTURE.md)

---

#### 2. Validación de Rangos de Fecha (120 líneas duplicadas)

**Repetido en 6 controllers:**
```javascript
if (startDate && endDate) {
  const start = new Date(startDate);
  const end = new Date(endDate);

  if (start > end) {
    return next(new AppError('Fecha inicio > fecha fin', 400));
  }

  const diffDays = Math.ceil((end - start) / (1000 * 60 * 60 * 24));
  if (diffDays > 365) {
    return next(new AppError('Rango no puede superar 1 año', 400));
  }
}
```

**Solución:** Helper `validateDateRange()` (ya propuesto en 02_ARCHITECTURE.md)

---

#### 3. Configuración de Paginación (150 líneas duplicadas)

**Repetido en 10 controllers:**
```javascript
const page = parseInt(req.query.page) || 1;
const limit = parseInt(req.query.limit) || 50;

if (limit > 100) {
  return next(new AppError('Límite máximo es 100', 400));
}

if (page < 1) {
  return next(new AppError('Página debe ser mayor a 0', 400));
}

const skip = (page - 1) * limit;
```

**Solución:** Ya existe `paginationHelper.js` pero no se usa consistentemente

---

#### 4. Generación de Claves de Caché (60 líneas duplicadas)

**Repetido en 3 controllers (Census, Fine, Traffic):**
```javascript
const generateCacheKey = (prefix, query) => {
  const sortedQuery = Object.keys(query)
    .sort()
    .reduce((acc, key) => {
      acc[key] = query[key];
      return acc;
    }, {});

  return `${prefix}:${JSON.stringify(sortedQuery)}`;
};
```

**Solución:** Mover a `src/utils/cacheHelper.js` y reutilizar

---

### Resumen de Duplicación

| Patrón | Líneas Duplicadas | Controllers | Solución |
|--------|------------------|-------------|----------|
| Construcción filtros | ~240 | 8 | buildFilters() |
| Validación fechas | ~120 | 6 | validateDateRange() |
| Paginación | ~150 | 10 | Usar paginationHelper |
| Cache keys | ~60 | 3 | cacheHelper.js |
| **TOTAL** | **~570** | - | **4 helpers** |

**Esfuerzo:** 6-8 horas

---

## 🟢 PROBLEMA MENOR: Nombres de Variables Inconsistentes

**Severidad:** BAJA
**Impacto:** Legibilidad

### Inconsistencias Detectadas

#### 1. Mezcla Español/Inglés
```javascript
// ❌ Mezclado
const obtenerStats = async () => {
  const results = await Model.find();
  const estadisticas = processResults(results);
  return estadisticas;
};

// ✅ Consistente (inglés)
const getStatistics = async () => {
  const results = await Model.find();
  const statistics = processResults(results);
  return statistics;
};
```

#### 2. Abreviaciones Inconsistentes
```javascript
// ❌ Inconsistente
const dist = distrito;
const distrito = req.query.distrito;
const distName = distrito.nombre;

// ✅ Consistente
const distrito = req.query.distrito;
const distritoNombre = distrito.nombre;
```

#### 3. Plurales Inconsistentes
```javascript
// ❌ Inconsistente
const accident = await Accident.find(); // Array pero singular
const results = await Fine.findOne(); // Objeto pero plural

// ✅ Consistente
const accidents = await Accident.find(); // Array = plural
const result = await Fine.findOne(); // Objeto = singular
```

**Recomendación:**
- **Código:** 100% inglés
- **Datos del dominio:** Español (nombres de campos en schemas)
- **Variables:** Plurales para arrays, singular para objetos

**Esfuerzo:** 2-3 horas de refactorización

---

## 🟢 PROBLEMA MENOR: Funciones Complejas (Cyclomatic Complexity)

**Severidad:** BAJA
**Impacto:** Testabilidad, Legibilidad

### Funciones con Alta Complejidad

**Análisis manual de complejidad ciclomática:**

| Función | Archivo | Líneas | Branches | Complejidad | Recomendado |
|---------|---------|--------|----------|-------------|-------------|
| getAccidentHeatmap | accidentController.js | 90 | 12 | Alta | < 10 |
| getAirQualityTrends | airQualityController.js | 95 | 15 | Muy Alta | < 10 |
| getScooterDistribution | scooterAssignmentController.js | 85 | 11 | Alta | < 10 |
| getBikeUsagePatterns | bikeAvailabilityController.js | 80 | 10 | Alta | < 10 |

**Ejemplo de función compleja:**

```javascript
// ❌ Complejidad ciclomática: 15
const getAirQualityTrends = async (req, res, next) => {
  try {
    const { estacion, magnitud, periodo, startDate, endDate } = req.query;

    // Branch 1-2
    if (!estacion) {
      return next(new AppError('Estación requerida', 400));
    }

    // Branch 3-4
    if (!periodo) {
      return next(new AppError('Periodo requerido', 400));
    }

    let groupBy;
    // Branch 5-7
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
      default:
        return next(new AppError('Periodo inválido', 400));
    }

    const filters = {};

    // Branch 8
    if (estacion) filters.estacion = estacion;
    // Branch 9
    if (magnitud) filters.magnitud = magnitud;
    // Branch 10-11
    if (startDate || endDate) {
      filters.fecha = {};
      if (startDate) filters.fecha.$gte = new Date(startDate);
      if (endDate) filters.fecha.$lte = new Date(endDate);
    }

    // Branch 12-13
    if (filters.fecha && filters.fecha.$gte > filters.fecha.$lte) {
      return next(new AppError('Fecha inicio > fecha fin', 400));
    }

    // ... más lógica (branches 14-15)

    res.status(200).json({ success: true, data: trends });
  } catch (error) {
    next(error);
  }
};
```

**Refactorización:**

```javascript
// ✅ Complejidad reducida dividiendo en funciones
const validateTrendsParams = (estacion, periodo, startDate, endDate) => {
  if (!estacion) throw new AppError('Estación requerida', 400);
  if (!periodo) throw new AppError('Periodo requerido', 400);
  // ... más validaciones
};

const buildGroupByExpression = (periodo) => {
  const formats = {
    daily: '%Y-%m-%d',
    weekly: '%Y-W%V',
    monthly: '%Y-%m',
  };

  if (!formats[periodo]) {
    throw new AppError('Periodo inválido', 400);
  }

  return { $dateToString: { format: formats[periodo], date: '$fecha' } };
};

const buildAirQualityFilters = ({ estacion, magnitud, startDate, endDate }) => {
  const filters = {};
  if (estacion) filters.estacion = estacion;
  if (magnitud) filters.magnitud = magnitud;
  // ... resto de filtros
  return filters;
};

// Controller simplificado
const getAirQualityTrends = async (req, res, next) => {
  try {
    const { estacion, magnitud, periodo, startDate, endDate } = req.query;

    // Validaciones en función separada
    validateTrendsParams(estacion, periodo, startDate, endDate);

    // Construcción en funciones separadas
    const groupBy = buildGroupByExpression(periodo);
    const filters = buildAirQualityFilters({ estacion, magnitud, startDate, endDate });

    // Lógica de negocio en modelo
    const trends = await AirQuality.getTrendsOptimized(filters, groupBy);

    res.status(200).json({ success: true, data: trends });
  } catch (error) {
    next(error);
  }
};
```

**Beneficios:**
- Complejidad reducida: 15 → 3-4 por función
- Funciones reutilizables
- Más fácil de testear
- Más legible

**Esfuerzo:** 8-10 horas para las 4 funciones más complejas

---

## 🔵 PROBLEMA MENOR: Comentarios Innecesarios

**Severidad:** BAJA

### Ejemplos de Comentarios Redundantes

```javascript
// ❌ Comentario obvio
// Obtener todos los accidentes
const accidents = await Accident.find();

// ❌ Comentario que repite el código
// Incrementar contador en 1
counter++;

// ❌ Código comentado sin eliminar (encontrado en 5+ archivos)
// const oldMethod = async () => {
//   // ... 50 líneas de código viejo
// };

// ✅ Comentario útil
// Agrupa por coordenadas redondeadas a 3 decimales (~110m precisión)
// para generar clusters en el mapa de calor
const grouped = await Accident.aggregate([
  {
    $group: {
      _id: {
        lat: { $round: ['$ubicacion.coordinates.1', 3] },
        lng: { $round: ['$ubicacion.coordinates.0', 3] }
      }
    }
  }
]);
```

**Recomendación:**
- Eliminar código comentado (usar Git para historial)
- Eliminar comentarios obvios
- Mantener comentarios que explican "por qué" no "qué"

**Esfuerzo:** 1-2 horas

---

## 📊 RESUMEN DE PROBLEMAS

| # | Problema | Severidad | Esfuerzo | Prioridad |
|---|----------|-----------|----------|-----------|
| 1 | JSDoc incompleto | 🟡 Media | 12-15h | Sprint 3 |
| 2 | Duplicación de código | 🟡 Media | 6-8h | Sprint 2 |
| 3 | Nombres inconsistentes | 🔵 Baja | 2-3h | Sprint 4 |
| 4 | Funciones complejas | 🔵 Baja | 8-10h | Sprint 3 |
| 5 | Comentarios innecesarios | 🔵 Baja | 1-2h | Sprint 4 |

**Total:** 29-38 horas

---

## 🎯 RECOMENDACIONES

### Sprint 2 (Prioridad ALTA)
1. **Crear helpers para código duplicado** (6-8h)
   - buildFilters()
   - validateDateRange()
   - cacheHelper.js
   - Estandarizar uso de paginationHelper

### Sprint 3 (Prioridad MEDIA)
2. **Documentar con JSDoc** (12-15h)
   - Todos los controllers
   - Todos los middleware
   - Modelos sin refactorizar

3. **Refactorizar funciones complejas** (8-10h)
   - getAirQualityTrends
   - getAccidentHeatmap
   - getScooterDistribution
   - getBikeUsagePatterns

### Sprint 4 (Prioridad BAJA)
4. **Estandarizar nomenclatura** (2-3h)
5. **Limpiar comentarios** (1-2h)

---

## ✅ MÉTRICAS DE ÉXITO

### Actual
```
Funciones documentadas: 15% (~12 de 80)
Código duplicado: ~570 líneas
Funciones complejas (> 10 branches): 8
Comentarios útiles vs redundantes: 60/40
```

### Objetivo (Post Sprint 4)
```
Funciones documentadas: 100% (80 de 80)
Código duplicado: < 50 líneas (helpers reutilizables)
Funciones complejas (> 10 branches): 0
Comentarios útiles vs redundantes: 95/5
```

### Herramientas Recomendadas
- **ESLint** con `eslint-plugin-jsdoc` - Forzar JSDoc
- **SonarQube** - Detectar code smells, duplicación, complejidad
- **Prettier** - Formateo consistente (ya usado ✅)
