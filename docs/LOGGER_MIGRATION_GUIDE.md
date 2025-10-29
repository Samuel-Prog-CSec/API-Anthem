# GUÍA DE MIGRACIÓN A PINO LOGGER

## ✅ Logger implementado

Se ha instalado e implementado PinoJS como logger profesional en:
- `/src/config/logger.js` - Configuración principal
- `/src/middleware/requestLogger.js` - Middleware HTTP

## 📝 Cómo usar el logger

### En Controllers

```javascript
// Al inicio del archivo
const logger = require('../config/logger');

// En funciones async con req disponible
const getAll = async (req, res, next) => {
  // Usar req.log que ya tiene contexto de request
  req.log.debug({ query: req.query }, 'Obteniendo datos');

  try {
    // ...
    req.log.info({ total: results.length }, 'Datos obtenidos exitosamente');
  } catch (error) {
    req.log.error({ error: error.message }, 'Error al obtener datos');
  }
};
```

### En Modelos, Utils, Config

```javascript
// Al inicio del archivo
const { dbLogger: logger } = require('../config/logger');

// En métodos estáticos o funciones
someFunction = async () => {
  logger.debug({ filters }, 'Ejecutando query');
  logger.info({ count }, 'Query completada');
  logger.error({ error: err.message }, 'Error en query');
};
```

### En Middleware de Auth

```javascript
const { authLogger: logger } = require('../config/logger');

// Usar authLogger para operaciones de autenticación
logger.info({ userId, action: 'login' }, 'Usuario autenticado');
logger.warn({ ip, attempts }, 'Intentos de login fallidos');
```

### En operaciones de Caché

```javascript
const { cacheLogger: logger } = require('../config/logger');

logger.debug({ key }, 'Cache hit');
logger.debug({ key }, 'Cache miss');
```

## 🔄 Patrones de Reemplazo

### console.log → logger.debug (en desarrollo) o logger.info

```javascript
// ❌ ANTES
console.log('Obteniendo datos', { filters });

// ✅ DESPUÉS (en controller con req)
req.log.debug({ filters }, 'Obteniendo datos');

// ✅ DESPUÉS (sin req)
logger.debug({ filters }, 'Obteniendo datos');
```

### console.error → logger.error

```javascript
// ❌ ANTES
console.error('Error al obtener datos:', error);

// ✅ DESPUÉS (en controller)
req.log.error({ error: error.message, stack: error.stack }, 'Error al obtener datos');

// ✅ DESPUÉS (sin req)
logger.error({ error: error.message }, 'Error al obtener datos');
```

### console.warn → logger.warn

```javascript
// ❌ ANTES
console.warn('Rate limit cercano', { current: 95 });

// ✅ DESPUÉS
logger.warn({ current: 95, max: 100 }, 'Rate limit cercano al máximo');
```

## 📋 TAREAS DE MIGRACIÓN MANUAL

Dado que hay 72+ ocurrencias de console.*, se requiere migración manual archivo por archivo.

### Controllers a migrar (Prioridad ALTA):

1. ✅ `server.js` - COMPLETADO
2. ⏳ `accidentController.js` - EN PROGRESO (12 ocurrencias)
3. ⏳ `trafficController.js` (9 ocurrencias)
4. ⏳ `authController.js` (8 ocurrencias)
5. ⏳ `bikeAvailabilityController.js` (8 ocurrencias)
6. ⏳ `containerController.js` (10 ocurrencias)
7. ⏳ `censusController.js` (6 ocurrencias)
8. ⏳ `fineController.js` (6 ocurrencias)
9. ⏳ `noiseMonitoringController.js` (5 ocurrencias)
10. ⏳ `airQualityController.js` (4 ocurrencias)
11. ⏳ `locationController.js` (4 ocurrencias)

### Proceso recomendado:

1. Abrir archivo
2. Buscar todos los `console.`
3. Para cada ocurrencia:
   - Si es debug/log: reemplazar por `req.log.debug()` o `logger.debug()`
   - Si es info: reemplazar por `req.log.info()` o `logger.info()`
   - Si es error: reemplazar por `req.log.error()` o `logger.error()`
   - Si es warn: reemplazar por `req.log.warn()` o `logger.warn()`
4. Añadir `const logger = require('../config/logger');` al inicio si no está
5. Verificar que compile sin errores

## 🎯 Niveles de Log

- **debug**: Información detallada de desarrollo (NO aparece en producción)
- **info**: Eventos importantes del flujo normal
- **warn**: Situaciones anómalas pero recuperables
- **error**: Errores que afectan la operación
- **fatal**: Errores críticos que pueden tumbar la app

## ⚠️ IMPORTANTE

- **NO** logear datos sensibles (passwords, tokens, credit cards)
- **SÍ** logear contexto útil (userId, filters, durations)
- En producción, el logger automáticamente oculta campos sensibles
- Los logs se muestran con colores en desarrollo
- En producción, los logs son JSON estructurado

## 🚀 Próximos pasos

1. Migrar todos los console.* a logger (manual, archivo por archivo)
2. Testear que la aplicación funciona correctamente
3. Revisar logs en desarrollo para asegurar que son útiles
4. Configurar rotación de logs en producción (opcional, futuro)

