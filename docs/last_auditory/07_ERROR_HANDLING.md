# ⚠️ MANEJO DE ERRORES Y LOGGING

**Documento:** 07 de 10
**Fecha:** 16 de Octubre de 2025

---

## 📊 CALIFICACIÓN: 6.5/10

**Estado general:** ⚠️ NECESITA MEJORA

Sistema de errores estructurado pero logging con `console.log` debe ser reemplazado urgentemente.

---

## 🔴 PROBLEMA CRÍTICO: Console.log en Producción

**Severidad:** CRÍTICA
**Impacto:** Performance, Debugging, Profesionalismo

### Estadísticas de Console.log

**Búsqueda exhaustiva realizada:**
```bash
Patrón: console\.(log|error|warn|info|debug)
Resultados totales: 60+ ocurrencias
```

**Distribución por archivo:**

| Archivo | console.log | console.error | console.warn | Total |
|---------|-------------|---------------|--------------|-------|
| accidentController.js | 8 | 3 | 1 | 12 |
| airQualityController.js | 6 | 2 | 1 | 9 |
| scooterAssignmentController.js | 7 | 3 | 1 | 11 |
| bikeAvailabilityController.js | 5 | 2 | 1 | 8 |
| bikeCapacityController.js | 4 | 2 | 0 | 6 |
| censusController.js | 2 | 1 | 0 | 3 |
| containerController.js | 3 | 1 | 0 | 4 |
| fineController.js | 1 | 1 | 0 | 2 |
| noiseMonitoringController.js | 4 | 2 | 1 | 7 |
| parkingOccupancyController.js | 3 | 2 | 0 | 5 |
| trafficController.js | 0 | 1 | 0 | 1 |
| authController.js | 1 | 1 | 0 | 2 |
| **TOTAL** | **44** | **21** | **5** | **70** |

---

### Ejemplos de Uso Problemático

#### Tipo 1: Debug Logging (44 ocurrencias)
```javascript
// ❌ accidentController.js (línea 85)
console.log('Filters applied:', filters);
console.log('Query params:', req.query);
console.log('Results found:', results.length);

// ❌ airQualityController.js (línea 142)
console.log('Pipeline:', JSON.stringify(pipeline, null, 2));
console.log('Aggregation starting...');
console.log('Aggregation completed in:', Date.now() - start, 'ms');

// ❌ scooterAssignmentController.js (línea 234)
console.log('Distribution data:', distribution);
console.log('Processing results...');
```

**Problemas:**
- Contamina stdout en producción
- No persiste logs (se pierden al reiniciar)
- No tiene niveles de severidad
- No tiene contexto (timestamp, usuario, endpoint)
- Imposible filtrar o buscar

---

#### Tipo 2: Error Logging (21 ocurrencias)
```javascript
// ❌ accidentController.js (línea 320)
catch (error) {
  console.error('Error in getAccidentStats:', error);
  next(error);
}

// ❌ airQualityController.js (línea 298)
catch (error) {
  console.error('Aggregation failed:', error.message);
  next(error);
}

// ❌ authController.js (línea 145)
catch (error) {
  console.error('Login error:', error);
  res.status(500).json({ success: false, message: 'Error en login' });
}
```

**Problemas:**
- No captura stack trace completo
- No registra contexto (usuario, IP, endpoint, params)
- No permite monitoring/alerting
- Dificulta debugging de producción

---

#### Tipo 3: Warning Logging (5 ocurrencias)
```javascript
// ❌ airQualityController.js (línea 142)
console.warn('Missing magnitud parameter');

// ❌ accidentController.js (línea 67)
console.warn('Date range exceeds 1 year, limiting results');

// ❌ mongoSanitize middleware (línea 23)
console.warn(`Intento de inyección NoSQL detectado: ${key}`);
```

**Problemas:**
- Warnings críticos de seguridad no se persisten
- No generan alertas
- Imposible análisis posterior

---

## ✅ SOLUCIÓN: Implementar Winston Logger

### Propuesta de Sistema de Logging Profesional

#### Estructura de Archivos
```
src/
  utils/
    logger.js          # Configuración principal de Winston
    loggerHelpers.js   # Funciones auxiliares
logs/
  app.log              # Logs generales
  error.log            # Solo errores
  combined.log         # Todo combinado
  security.log         # Eventos de seguridad
```

---

### Implementación Completa

#### 1. Instalación de Dependencias
```bash
npm install winston winston-daily-rotate-file
```

---

#### 2. Configuración de Winston

```javascript
// src/utils/logger.js
const winston = require('winston');
const path = require('path');

// Formato personalizado
const customFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.splat(),
  winston.format.json()
);

// Formato para consola (desarrollo)
const consoleFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({ format: 'HH:mm:ss' }),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    return `${timestamp} [${level}]: ${message} ${
      Object.keys(meta).length ? JSON.stringify(meta, null, 2) : ''
    }`;
  })
);

// Crear logger
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: customFormat,
  defaultMeta: { service: 'api-rest' },
  transports: [
    // Log de errores
    new winston.transports.File({
      filename: path.join(__dirname, '../../logs/error.log'),
      level: 'error',
      maxsize: 5242880, // 5MB
      maxFiles: 5,
    }),

    // Log de warnings
    new winston.transports.File({
      filename: path.join(__dirname, '../../logs/warn.log'),
      level: 'warn',
      maxsize: 5242880,
      maxFiles: 3,
    }),

    // Log combinado
    new winston.transports.File({
      filename: path.join(__dirname, '../../logs/combined.log'),
      maxsize: 10485760, // 10MB
      maxFiles: 5,
    }),

    // Log de seguridad
    new winston.transports.File({
      filename: path.join(__dirname, '../../logs/security.log'),
      level: 'warn',
      maxsize: 5242880,
      maxFiles: 10,
    }),
  ],
});

// En desarrollo, también logear a consola
if (process.env.NODE_ENV !== 'production') {
  logger.add(
    new winston.transports.Console({
      format: consoleFormat,
    })
  );
}

// Métodos auxiliares
logger.request = (req, message, meta = {}) => {
  logger.info(message, {
    ...meta,
    method: req.method,
    url: req.originalUrl,
    ip: req.ip,
    userId: req.user?.id,
  });
};

logger.requestError = (req, error, meta = {}) => {
  logger.error(error.message, {
    ...meta,
    method: req.method,
    url: req.originalUrl,
    ip: req.ip,
    userId: req.user?.id,
    stack: error.stack,
  });
};

logger.security = (event, data) => {
  logger.warn(`[SECURITY] ${event}`, data);
};

module.exports = logger;
```

---

### 3. Plan de Migración de console.log a logger

#### Fase 1: Reemplazar console.log (44 ocurrencias)

**Antes:**
```javascript
// ❌ accidentController.js
console.log('Filters applied:', filters);
console.log('Query params:', req.query);
console.log('Results found:', results.length);
```

**Después:**
```javascript
// ✅ Con Winston
logger.debug('Filters applied to accident query', {
  filters,
  endpoint: 'GET /api/accidents',
  userId: req.user?.id
});

// O simplemente eliminar si no es crítico:
// logger.debug se puede desactivar en producción con LOG_LEVEL=info
```

**Regla:**
- `console.log` de debug → `logger.debug()` (solo desarrollo)
- `console.log` importante → `logger.info()`
- La mayoría pueden eliminarse

---

#### Fase 2: Reemplazar console.error (21 ocurrencias)

**Antes:**
```javascript
// ❌ accidentController.js
catch (error) {
  console.error('Error in getAccidentStats:', error);
  next(error);
}
```

**Después:**
```javascript
// ✅ Con Winston
catch (error) {
  logger.requestError(req, error, {
    function: 'getAccidentStats',
    filters: filters,
  });
  next(error);
}

// O usando el método error directamente:
catch (error) {
  logger.error('Error obteniendo estadísticas de accidentes', {
    error: error.message,
    stack: error.stack,
    endpoint: 'GET /api/accidents/stats',
    userId: req.user?.id,
    filters: filters
  });
  next(error);
}
```

---

#### Fase 3: Reemplazar console.warn (5 ocurrencias)

**Antes:**
```javascript
// ❌ airQualityController.js
console.warn('Missing magnitud parameter');

// ❌ mongoSanitize middleware
console.warn(`Intento de inyección NoSQL detectado: ${key}`);
```

**Después:**
```javascript
// ✅ Con Winston
logger.warn('Parámetro magnitud faltante', {
  endpoint: 'GET /api/air-quality/trends',
  query: req.query,
  userId: req.user?.id
});

// ✅ Seguridad
logger.security('NoSQL Injection Attempt', {
  key: key,
  ip: req.ip,
  url: req.originalUrl,
  body: req.body
});
```

---

### 4. Integración con Middleware de Errores

**Antes:**
```javascript
// src/middleware/errorHandler.js
const errorHandler = (err, req, res, next) => {
  console.error('Error:', err);  // ❌

  res.status(err.statusCode || 500).json({
    success: false,
    message: err.message
  });
};
```

**Después:**
```javascript
// ✅ Con Winston
const logger = require('../utils/logger');

const errorHandler = (err, req, res, next) => {
  // Log con contexto completo
  logger.requestError(req, err, {
    statusCode: err.statusCode || 500,
    errorCode: err.code,
  });

  // En desarrollo, incluir stack trace en response
  const response = {
    success: false,
    message: err.message,
  };

  if (process.env.NODE_ENV === 'development') {
    response.stack = err.stack;
  }

  res.status(err.statusCode || 500).json(response);
};

module.exports = errorHandler;
```

---

### 5. Logging de Requests HTTP

**Crear middleware de logging:**

```javascript
// src/middleware/requestLogger.js
const logger = require('../utils/logger');

const requestLogger = (req, res, next) => {
  const start = Date.now();

  // Capturar respuesta
  res.on('finish', () => {
    const duration = Date.now() - start;
    const logLevel = res.statusCode >= 400 ? 'warn' : 'info';

    logger[logLevel]('HTTP Request', {
      method: req.method,
      url: req.originalUrl,
      statusCode: res.statusCode,
      duration: `${duration}ms`,
      ip: req.ip,
      userAgent: req.get('user-agent'),
      userId: req.user?.id,
    });
  });

  next();
};

module.exports = requestLogger;
```

**Aplicar en server.js:**
```javascript
// src/server.js
const requestLogger = require('./middleware/requestLogger');

// Después de parsers, antes de rutas
app.use(requestLogger);
```

---

### 6. Logging de Eventos de Seguridad

```javascript
// src/utils/securityLogger.js
const logger = require('./logger');

const securityEvents = {
  loginSuccess: (userId, ip) => {
    logger.security('Login exitoso', { userId, ip });
  },

  loginFailed: (email, ip, reason) => {
    logger.security('Login fallido', { email, ip, reason });
  },

  accountLocked: (userId, ip) => {
    logger.security('Cuenta bloqueada', { userId, ip });
  },

  passwordChanged: (userId, ip) => {
    logger.security('Contraseña cambiada', { userId, ip });
  },

  tokenInvalid: (token, ip) => {
    logger.security('Token JWT inválido', { token: token.slice(0, 20), ip });
  },

  noSqlInjection: (field, value, ip, url) => {
    logger.security('Intento inyección NoSQL', { field, value, ip, url });
  },

  rateLimitExceeded: (ip, endpoint) => {
    logger.security('Rate limit excedido', { ip, endpoint });
  },
};

module.exports = securityEvents;
```

**Uso en authController:**
```javascript
// src/controllers/authController.js
const securityLogger = require('../utils/securityLogger');

const login = async (req, res, next) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });

    if (!user) {
      securityLogger.loginFailed(email, req.ip, 'User not found');
      return res.status(401).json({
        success: false,
        message: 'Credenciales inválidas'
      });
    }

    if (user.isLocked) {
      securityLogger.accountLocked(user._id, req.ip);
      return res.status(423).json({
        success: false,
        message: 'Cuenta bloqueada temporalmente'
      });
    }

    const isPasswordCorrect = await user.comparePassword(password);

    if (!isPasswordCorrect) {
      await user.incLoginAttempts();
      securityLogger.loginFailed(email, req.ip, 'Invalid password');
      return res.status(401).json({
        success: false,
        message: 'Credenciales inválidas'
      });
    }

    // Login exitoso
    securityLogger.loginSuccess(user._id, req.ip);

    const token = generateToken(user);
    res.status(200).json({ success: true, token });
  } catch (error) {
    next(error);
  }
};
```

---

## 📋 PLAN DE MIGRACIÓN POR FASES

### Fase 1: Setup (Sprint 2) - 2 horas
1. Instalar winston y configurar logger.js
2. Crear middleware requestLogger.js
3. Crear securityLogger.js
4. Integrar en server.js

### Fase 2: Migración Controllers (Sprint 2-3) - 12 horas
**Orden de prioridad:**

1. **authController.js** (2 console → logger) - 0.5h
2. **censusController.js** (3 console → logger) - 0.5h
3. **fineController.js** (2 console → logger) - 0.5h
4. **trafficController.js** (1 console → logger) - 0.5h
5. **accidentController.js** (12 console → logger) - 1.5h
6. **airQualityController.js** (9 console → logger) - 1.5h
7. **scooterAssignmentController.js** (11 console → logger) - 1.5h
8. **bikeAvailabilityController.js** (8 console → logger) - 1h
9. **bikeCapacityController.js** (6 console → logger) - 1h
10. **noiseMonitoringController.js** (7 console → logger) - 1h
11. **parkingOccupancyController.js** (5 console → logger) - 1h
12. **containerController.js** (4 console → logger) - 0.5h

### Fase 3: Migración Middleware (Sprint 3) - 2 horas
- errorHandler.js
- security.js
- auth.js

### Fase 4: Testing y Refinamiento (Sprint 3) - 2 horas
- Verificar logs en desarrollo
- Verificar logs en producción
- Ajustar niveles de logging
- Documentar convenciones

**Total:** 18 horas

---

## 🟡 PROBLEMA: Error Handling Inconsistente

**Severidad:** MEDIA

### Inconsistencias Detectadas

#### Problema 1: Diferentes Formatos de Error Response

**Variación 1:**
```javascript
// accidentController.js
res.status(400).json({
  success: false,
  message: 'Parámetros inválidos'
});
```

**Variación 2:**
```javascript
// airQualityController.js
res.status(400).json({
  error: 'Parámetros inválidos'
});
```

**Variación 3:**
```javascript
// authController.js
res.status(400).json({
  success: false,
  error: {
    message: 'Parámetros inválidos',
    code: 'INVALID_PARAMS'
  }
});
```

**Solución: Estandarizar formato**
```javascript
// ✅ Formato estándar para toda la API
res.status(400).json({
  success: false,
  error: {
    message: 'Parámetros inválidos',
    code: 'INVALID_PARAMS',
    details: [] // Opcional: errores de validación específicos
  }
});
```

---

#### Problema 2: Uso Inconsistente de next(error)

**En algunos controllers:**
```javascript
// ✅ Correcto - delega a errorHandler
catch (error) {
  next(error);
}
```

**En otros controllers:**
```javascript
// ❌ Inconsistente - responde directamente
catch (error) {
  res.status(500).json({
    success: false,
    message: 'Error interno'
  });
}
```

**Solución:** Siempre usar `next(error)` para errores inesperados

---

#### Problema 3: AppError No Usado Consistentemente

**Existe AppError pero no se usa en todos lados:**

```javascript
// src/utils/AppError.js (existe)
class AppError extends Error {
  constructor(message, statusCode) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = true;
  }
}

// Uso inconsistente:

// ✅ Correcto (censusController)
if (!year) {
  return next(new AppError('Año es requerido', 400));
}

// ❌ Inconsistente (accidentController)
if (!startDate) {
  return res.status(400).json({
    success: false,
    message: 'Fecha de inicio requerida'
  });
}
```

**Solución:** Usar AppError en TODOS los errores operacionales

---

## 📊 RESUMEN DE PROBLEMAS

| # | Problema | Severidad | Ocurrencias | Esfuerzo | Prioridad |
|---|----------|-----------|-------------|----------|-----------|
| 1 | Console.log en producción | 🔴 Crítica | 70 | 18h | Sprint 2-3 |
| 2 | Error response inconsistente | 🟡 Media | 30+ | 4h | Sprint 3 |
| 3 | next(error) inconsistente | 🟡 Media | 20+ | 2h | Sprint 3 |
| 4 | AppError no usado | 🟡 Media | 25+ | 3h | Sprint 3 |

**Total:** 27 horas

---

## 🎯 RECOMENDACIONES

### Inmediato (Sprint 2)
1. **Implementar Winston logger** (2h)
2. **Migrar controllers prioritarios** (auth, census, fine, traffic) (3h)

### Corto plazo (Sprint 3)
3. **Migrar controllers restantes** (9h)
4. **Estandarizar error responses** (4h)
5. **Estandarizar uso de next(error) y AppError** (5h)

### Largo plazo (Sprint 4)
6. **Implementar log rotation automático** (2h)
7. **Configurar alertas por logs críticos** (4h)
8. **Dashboard de monitoring** (8h)

---

## ✅ BENEFICIOS ESPERADOS

### Performance
- **Console.log eliminado:** +5-10% performance en producción
- **Logging asíncrono:** No bloquea event loop

### Debugging
- **Logs persistentes:** Análisis post-mortem de errores
- **Contexto completo:** Usuario, IP, endpoint, parámetros
- **Búsqueda:** Filtrar por nivel, fecha, usuario, etc.

### Monitoring
- **Alertas:** Notificaciones automáticas de errores
- **Métricas:** Tasa de errores, endpoints más lentos
- **Auditoría:** Trazabilidad completa de eventos
