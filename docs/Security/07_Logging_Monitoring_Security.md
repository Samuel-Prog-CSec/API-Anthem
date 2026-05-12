# Logging y Monitoreo de Seguridad

**Proyecto:** API REST - Smart City
**Módulo:** Security Logging & Monitoring
**Fecha:** Noviembre 2025

---

## Índice

1. [Introducción](#introducción)
2. [¿Por Qué Pino?](#por-qué-pino)
3. [Arquitectura de Logging](#arquitectura-de-logging)
4. [Eventos de Seguridad](#eventos-de-seguridad)
5. [Redacción de Datos Sensibles](#redacción-de-datos-sensibles)
6. [Análisis y Monitoreo](#análisis-y-monitoreo)

---

## Introducción

Nosotros implementamos **Pino**, el logger de Node.js más rápido, para generar logs estructurados en JSON. Esta documentación explica nuestra estrategia de logging, qué eventos registramos, cómo protegemos datos sensibles y cómo analizamos los logs para detectar amenazas.

---

## ¿Por Qué Pino?

### Comparativa de Loggers

Nosotros evaluamos múltiples opciones antes de elegir Pino:

| Logger | Velocidad | Formato | Nivel de Detalle | Redacción |
|--------|-----------|---------|------------------|-----------|
| **Pino** | 🔥 Muy rápido | JSON | ✅ Alto | ✅ Built-in |
| Winston | 🐢 Lento | JSON/Text | ✅ Alto | ⚠️ Manual |
| Bunyan | 🟡 Medio | JSON | ✅ Alto | ⚠️ Manual |
| console.log | 🔥 Rápido | Text | ❌ Bajo | ❌ No |
| Morgan | 🟡 Medio | Text | ⚠️ Solo HTTP | ❌ No |

### Benchmarks de Rendimiento

```javascript
// Operaciones por segundo (más es mejor)
console.log:  ~1,000,000 ops/sec  (pero sin estructura)
Pino:          ~800,000 ops/sec  (con JSON estructurado)
Winston:       ~100,000 ops/sec  (8x más lento que Pino)
Bunyan:        ~200,000 ops/sec  (4x más lento que Pino)
```

**Conclusión:** Pino es **8x más rápido que Winston** sin sacrificar funcionalidades.

### Ventajas de Pino

#### 1. **JSON Estructurado**

```javascript
// console.log (no estructurado)
console.log('Login exitoso para usuario:', username, 'desde IP:', ip);
// Output: Login exitoso para usuario: juan123 desde IP: 192.168.1.100
// ❌ Difícil de parsear
// ❌ No hay timestamp preciso
// ❌ No hay contexto adicional

// Pino (estructurado)
logger.info({
  msg: 'Login exitoso',
  username: 'juan123',
  ip: '192.168.1.100',
  userAgent: 'Mozilla/5.0...'
});

// Output:
{
  "level": 30,
  "time": 1700000000000,
  "pid": 12345,
  "hostname": "api-server-01",
  "msg": "Login exitoso",
  "username": "juan123",
  "ip": "192.168.1.100",
  "userAgent": "Mozilla/5.0..."
}

// ✅ Fácil de parsear (JSON)
// ✅ Timestamp automático
// ✅ Contexto completo
// ✅ Indexable en sistemas de monitoreo
```

#### 2. **Niveles de Log Configurables**

```javascript
// Pino soporta 6 niveles estándar
logger.trace()  // 10 - Debugging extremo
logger.debug()  // 20 - Debugging
logger.info()   // 30 - Información general ← Default
logger.warn()   // 40 - Advertencias
logger.error()  // 50 - Errores
logger.fatal()  // 60 - Errores fatales

// Configurar nivel mínimo
const logger = pino({
  level: process.env.LOG_LEVEL || 'info'
});

// En producción: level='info' (solo info, warn, error, fatal)
// En desarrollo: level='debug' (todos excepto trace)
```

#### 3. **Child Loggers con Contexto**

```javascript
// Logger base
const logger = pino();

// Child logger para módulo específico
const authLogger = logger.child({ module: 'auth' });
const dbLogger = logger.child({ module: 'database' });

authLogger.info('Login exitoso');
// Output: { "module": "auth", "msg": "Login exitoso", ... }

dbLogger.warn('Query lenta');
// Output: { "module": "database", "msg": "Query lenta", ... }
```

#### 4. **Redacción Automática de Campos Sensibles**

```javascript
const logger = pino({
  redact: {
    paths: ['password', 'token', 'refreshToken', 'req.headers.authorization'],
    censor: '[REDACTED]'
  }
});

logger.info({ username: 'juan', password: 'secret123' });
// Output: { "username": "juan", "password": "[REDACTED]" }
```

---

## Arquitectura de Logging

### Configuración Global

**Archivo:** `src/config/logger.js`

```javascript
const pino = require('pino');
const path = require('path');

const isDevelopment = process.env.NODE_ENV === 'development';

/**
 * Configuración de Pino logger
 */
const logger = pino({
  // Nivel de logging
  level: process.env.LOG_LEVEL || (isDevelopment ? 'debug' : 'info'),

  // Formato de timestamp
  timestamp: pino.stdTimeFunctions.isoTime,

  // Redacción de campos sensibles
  redact: {
    paths: [
      'password',
      'req.body.password',
      'req.body.confirmPassword',
      'token',
      'refreshToken',
      'req.headers.authorization',
      'req.headers.cookie',
      'accessToken'
    ],
    censor: '[REDACTED]'
  },

  // Serializers personalizados
  serializers: {
    req: (req) => ({
      method: req.method,
      url: req.url,
      path: req.path,
      parameters: req.params,
      query: req.query,
      headers: {
        host: req.headers.host,
        userAgent: req.headers['user-agent'],
        referer: req.headers.referer
        // NO incluimos authorization ni cookie (sensibles)
      },
      remoteAddress: req.ip,
      remotePort: req.connection?.remotePort
    }),
    res: (res) => ({
      statusCode: res.statusCode,
      headers: res.getHeaders ? res.getHeaders() : {}
    }),
    err: pino.stdSerializers.err
  },

  // Transporte para desarrollo (pretty print)
  transport: isDevelopment ? {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'HH:MM:ss Z',
      ignore: 'pid,hostname'
    }
  } : undefined
});

module.exports = logger;
```

### Pretty Print en Desarrollo

```bash
# Sin pino-pretty (producción)
{"level":30,"time":"2025-11-19T10:30:00.000Z","pid":12345,"hostname":"api-server","msg":"Login exitoso"}

# Con pino-pretty (desarrollo)
[10:30:00] INFO: Login exitoso
    username: "juan123"
    ip: "192.168.1.100"
```

### Middleware de Request Logging

**Archivo:** `src/middleware/requestLogger.js`

```javascript
const logger = require('../config/logger');
const pinoHttp = require('pino-http');

/**
 * Middleware para logging automático de requests
 */
const requestLogger = pinoHttp({
  logger: logger,

  // Personalizar mensaje
  customLogLevel: function (req, res, err) {
    if (res.statusCode >= 500) return 'error';
    if (res.statusCode >= 400) return 'warn';
    if (res.statusCode >= 300) return 'info';
    return 'info';
  },

  // Personalizar mensaje de log
  customSuccessMessage: function (req, res) {
    return `${req.method} ${req.url} - ${res.statusCode}`;
  },

  customErrorMessage: function (req, res, err) {
    return `${req.method} ${req.url} - ${res.statusCode} - ${err.message}`;
  },

  // Añadir información adicional
  customAttributeKeys: {
    req: 'request',
    res: 'response',
    err: 'error',
    responseTime: 'duration'
  },

  // Excluir rutas de health check
  autoLogging: {
    ignore: function (req) {
      return req.url === '/health' || req.url === '/api/health';
    }
  }
});

module.exports = requestLogger;
```

**Uso en server.js:**

```javascript
// src/server.js
const requestLogger = require('./middleware/requestLogger');

// Logging automático de todos los requests
app.use(requestLogger);
```

**Output ejemplo:**

```json
{
  "level": 30,
  "time": "2025-11-19T10:30:00.000Z",
  "pid": 12345,
  "hostname": "api-server-01",
  "request": {
    "method": "POST",
    "url": "/api/v1.0/auth/login",
    "path": "/api/v1.0/auth/login",
    "parameters": {},
    "query": {},
    "headers": {
      "host": "api.smartcity.com",
      "userAgent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
      "referer": "https://smartcity.com/login"
    },
    "remoteAddress": "192.168.1.100",
    "remotePort": 54321
  },
  "response": {
    "statusCode": 200,
    "headers": {
      "content-type": "application/json; charset=utf-8",
      "content-length": "256"
    }
  },
  "duration": 265,
  "msg": "POST /api/v1.0/auth/login - 200"
}
```

---

## Eventos de Seguridad

Nosotros registramos **todos los eventos relacionados con seguridad** con contexto completo.

### 1. Autenticación

#### Login Exitoso

```javascript
// src/controllers/controladorAutenticacion.js
logger.info({
  event: 'auth.login.success',
  userId: user._id,
  username: user.username,
  ip: req.ip,
  userAgent: req.get('user-agent'),
  timestamp: new Date()
});
```

#### Login Fallido

```javascript
logger.warn({
  event: 'auth.login.failed',
  reason: !user ? 'user_not_found' : 'wrong_password',
  identifier: identifier,
  ip: req.ip,
  userAgent: req.get('user-agent'),
  failedAttempts: user?.failedLoginAttempts || 0,
  timestamp: new Date()
});
```

#### Cuenta Bloqueada

```javascript
logger.warn({
  event: 'auth.account.locked',
  userId: user._id,
  username: user.username,
  ip: req.ip,
  lockUntil: user.lockUntil,
  failedAttempts: user.failedLoginAttempts,
  severity: 'HIGH',
  timestamp: new Date()
});
```

#### Token Inválido

```javascript
logger.warn({
  event: 'auth.token.invalid',
  reason: 'expired',  // o 'malformed', 'blacklisted'
  ip: req.ip,
  path: req.path,
  timestamp: new Date()
});
```

### 2. Rate Limiting

#### Rate Limit Excedido

```javascript
// src/middleware/security.js
logger.warn({
  event: 'security.rate_limit.exceeded',
  type: 'general',  // o 'auth', 'heavy_query'
  ip: req.ip,
  path: req.path,
  method: req.method,
  userAgent: req.get('user-agent'),
  severity: 'MEDIUM',
  timestamp: new Date()
});
```

### 3. Inyecciones Detectadas

#### NoSQL Injection

```javascript
logger.warn({
  event: 'security.injection.nosql',
  ip: req.ip,
  path: req.path,
  payload: req.body,
  sanitizedKeys: ['username', 'password'],
  severity: 'HIGH',
  timestamp: new Date()
});
```

#### XSS Attempt

```javascript
logger.warn({
  event: 'security.injection.xss',
  ip: req.ip,
  path: req.path,
  field: 'username',
  originalValue: '<script>alert(1)</script>',
  sanitizedValue: '&lt;script&gt;alert(1)&lt;/script&gt;',
  severity: 'HIGH',
  timestamp: new Date()
});
```

#### HTTP Parameter Pollution

```javascript
logger.warn({
  event: 'security.hpp.detected',
  ip: req.ip,
  path: req.path,
  param: 'distrito',
  values: ['Centro', {'$ne': 'Centro'}, 'Sur'],
  takenValue: 'Centro',
  severity: 'MEDIUM',
  timestamp: new Date()
});
```

### 4. CORS Violations

```javascript
logger.warn({
  event: 'security.cors.violation',
  origin: req.get('origin'),
  ip: req.ip,
  path: req.path,
  method: req.method,
  severity: 'MEDIUM',
  timestamp: new Date()
});
```

### 5. Acceso No Autorizado

#### Sin Autenticación

```javascript
logger.warn({
  event: 'security.access.unauthenticated',
  path: req.path,
  method: req.method,
  ip: req.ip,
  requiredAuth: true,
  timestamp: new Date()
});
```

#### Sin Autorización (Forbidden)

```javascript
logger.warn({
  event: 'security.access.forbidden',
  userId: req.user.id,
  username: req.user.username,
  role: req.user.role,
  requiredRole: 'admin',
  path: req.path,
  method: req.method,
  ip: req.ip,
  severity: 'HIGH',
  timestamp: new Date()
});
```

### 6. Errores de Servidor

```javascript
logger.error({
  event: 'server.error',
  error: error.message,
  stack: error.stack,
  path: req.path,
  method: req.method,
  body: req.body,
  query: req.query,
  userId: req.user?.id,
  ip: req.ip,
  severity: 'CRITICAL',
  timestamp: new Date()
});
```

---

## Redacción de Datos Sensibles

### Campos Redactados Automáticamente

Nosotros configuramos Pino para **redactar automáticamente** campos sensibles:

```javascript
const logger = pino({
  redact: {
    paths: [
      // Contraseñas
      'password',
      'newPassword',
      'oldPassword',
      'confirmPassword',
      'req.body.password',
      'req.body.newPassword',
      'req.body.confirmPassword',

      // Tokens
      'token',
      'accessToken',
      'refreshToken',
      'req.headers.authorization',
      'req.headers.cookie',
      'res.headers.set-cookie',

      // Información personal
      'creditCard',
      'ssn',
      'dob'
    ],
    censor: '[REDACTED]',
    remove: false  // Mantener el campo, solo censurar valor
  }
});
```

### Ejemplo de Redacción

```javascript
// Código
logger.info({
  msg: 'Registro de usuario',
  username: 'juan123',
  email: 'juan@example.com',
  password: 'SuperSecret123!',
  token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...'
});

// Output en logs
{
  "level": 30,
  "time": "2025-11-19T10:30:00.000Z",
  "msg": "Registro de usuario",
  "username": "juan123",
  "email": "juan@example.com",
  "password": "[REDACTED]",
  "token": "[REDACTED]"
}
```

### Redacción Manual Adicional

Para casos especiales, nosotros también redactamos manualmente:

```javascript
const logSafeData = (obj) => {
  const safe = { ...obj };

  // Lista de campos a redactar
  const sensitiveFields = [
    'password', 'token', 'refreshToken',
    'accessToken', 'creditCard', 'ssn'
  ];

  for (const field of sensitiveFields) {
    if (safe[field]) {
      safe[field] = '[REDACTED]';
    }
  }

  return safe;
};

// Uso
logger.info({
  msg: 'Request procesado',
  body: logSafeData(req.body)
});
```

---

## Análisis y Monitoreo

### Análisis de Logs en Tiempo Real

#### 1. Buscar Eventos Específicos

```bash
# Buscar intentos de login fallidos
cat logs/app.log | grep "auth.login.failed" | jq '.'

# Buscar rate limit excedido
cat logs/app.log | grep "rate_limit.exceeded" | jq '.ip' | sort | uniq -c

# Output:
# 145 "203.0.113.50"  ← IP sospechosa
#  12 "192.168.1.100"
#   3 "10.0.0.1"
```

#### 2. Detectar Patrones de Ataque

```bash
# IPs con más de 10 eventos de seguridad en la última hora
cat logs/app.log | \
  grep -E "auth.login.failed|rate_limit.exceeded|injection" | \
  jq -r '.ip' | \
  sort | uniq -c | sort -rn | head -10

# Inyecciones detectadas en las últimas 24 horas
cat logs/app.log | \
  grep -E "injection.nosql|injection.xss" | \
  jq '{time: .time, event: .event, ip: .ip, path: .path}'
```

#### 3. Monitoreo de Errores Críticos

```bash
# Errores con severity=CRITICAL
cat logs/app.log | \
  jq 'select(.severity == "CRITICAL")'

# Errores 5xx
cat logs/app.log | \
  jq 'select(.response.statusCode >= 500)'
```

### Dashboards y Alertas

#### Métricas Clave

Nosotros monitoreamos las siguientes métricas:

```javascript
// Métricas de seguridad (últimas 24h)
const securityMetrics = {
  // Autenticación
  loginAttempts: 1234,
  loginSuccess: 1100,
  loginFailed: 134,
  accountsLocked: 3,

  // Rate limiting
  rateLimitViolations: 45,
  rateLimitIPs: 12,

  // Inyecciones
  nosqlInjectionAttempts: 8,
  xssAttempts: 5,

  // Acceso
  unauthorizedAccess: 23,
  forbiddenAccess: 7,

  // Errores
  errors5xx: 2,
  errorsCritical: 0
};
```

#### Alertas Automáticas

```javascript
// Configuración de alertas
const alertThresholds = {
  loginFailedPerIP: 20,        // 20 login fallidos de misma IP → alerta
  rateLimitPerIP: 10,          // 10 rate limits de misma IP → alerta
  injectionAttempts: 5,        // 5 intentos de inyección → alerta
  errors5xx: 10,               // 10 errores 5xx en 1 hora → alerta
  responseTimeP95: 3000        // P95 > 3s → alerta
};

// Ejemplo de alerta
if (loginFailedCountForIP > alertThresholds.loginFailedPerIP) {
  logger.fatal({
    alert: 'SECURITY_BREACH_SUSPECTED',
    ip: suspiciousIP,
    loginFailedCount: loginFailedCountForIP,
    timeWindow: '1 hour',
    action: 'IP_BLOCKED',
    timestamp: new Date()
  });

  // Enviar notificación (email, Slack, PagerDuty, etc.)
  notifySecurityTeam({
    type: 'BRUTE_FORCE_ATTACK',
    ip: suspiciousIP,
    details: `${loginFailedCountForIP} intentos de login fallidos en 1 hora`
  });
}
```

### Integración con Herramientas Externas

#### 1. ELK Stack (Elasticsearch, Logstash, Kibana)

```javascript
// Enviar logs a Elasticsearch
const logger = pino({
  transport: {
    target: 'pino-elasticsearch',
    options: {
      index: 'smartcity-api-logs',
      node: 'http://elasticsearch:9200',
      esVersion: 8,
      flushBytes: 1000
    }
  }
});

// Visualización en Kibana
// - Dashboard de seguridad en tiempo real
// - Gráficos de intentos de login
// - Mapa de IPs sospechosas
// - Alertas configurables
```

#### 2. Grafana + Loki

```bash
# docker-compose.yml
services:
  loki:
    image: grafana/loki:latest
    ports:
      - "3100:3100"

  grafana:
    image: grafana/grafana:latest
    ports:
      - "3001:3000"
```

```javascript
// Enviar logs a Loki
const logger = pino({
  transport: {
    target: 'pino-loki',
    options: {
      batching: true,
      interval: 5,
      host: 'http://loki:3100'
    }
  }
});
```

#### 3. Sentry (Error Tracking)

```javascript
const Sentry = require('@sentry/node');

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV,
  tracesSampleRate: 1.0
});

// Capturar errores críticos
app.use((err, req, res, next) => {
  if (err.statusCode >= 500) {
    Sentry.captureException(err, {
      user: { id: req.user?.id, username: req.user?.username },
      tags: { path: req.path, method: req.method },
      extra: { body: req.body, query: req.query }
    });
  }
  next(err);
});
```

---

## Mejores Prácticas

### 1. **Contexto Completo**

Siempre incluir contexto relevante:

```javascript
// ❌ Insuficiente
logger.warn('Login fallido');

// ✅ Completo
logger.warn({
  event: 'auth.login.failed',
  identifier: identifier,
  ip: req.ip,
  userAgent: req.get('user-agent'),
  path: req.path,
  timestamp: new Date()
});
```

### 2. **Niveles Apropiados**

```javascript
logger.trace()  // Debugging extremo (nunca en producción)
logger.debug()  // Debugging normal (solo desarrollo)
logger.info()   // Eventos normales (login exitoso, request procesado)
logger.warn()   // Eventos sospechosos (login fallido, rate limit)
logger.error()  // Errores recuperables (validación, 4xx)
logger.fatal()  // Errores críticos (5xx, crash inminente)
```

### 3. **Logs Estructurados**

```javascript
// ❌ No estructurado
logger.info(`Usuario ${username} hizo login desde ${ip}`);

// ✅ Estructurado
logger.info({
  msg: 'Login exitoso',
  username: username,
  ip: ip
});
```

### 4. **Performance**

```javascript
// Logs en producción tienen overhead mínimo
// Pino es asíncrono por defecto (no bloquea event loop)

// Para logging extremadamente pesado, usar streams
const logStream = pino.destination('/var/log/app.log');
const logger = pino(logStream);
```

### 5. **Rotación de Logs**

```bash
# Usar pino-roll o logrotate
npm install pino-roll

# pino-roll automáticamente rota logs
node app.js | pino-roll --size 10M --count 5
# Mantiene 5 archivos de máximo 10MB cada uno
```

---

## Resumen

### ¿Qué Implementamos?

✅ **Pino logger** (más rápido de Node.js)
✅ **JSON estructurado** para todos los logs
✅ **pino-http** para logging automático de requests
✅ **Redacción automática** de datos sensibles
✅ **Logging de eventos de seguridad** (login, rate limit, inyecciones, errores)
✅ **Niveles configurables** (trace, debug, info, warn, error, fatal)

### ¿Qué Ganamos?

✅ **Auditabilidad completa** (todos los eventos registrados)
✅ **Detección de amenazas** (análisis de patrones)
✅ **Debugging facilitado** (contexto completo)
✅ **Cumplimiento normativo** (GDPR, PCI-DSS requieren logging)
✅ **Respuesta a incidentes** (forense post-ataque)

### Eventos Registrados

| Categoría | Eventos | Ejemplos |
|-----------|---------|----------|
| Autenticación | 6 eventos | login.success, login.failed, account.locked, token.invalid, register, logout |
| Rate Limiting | 3 eventos | rate_limit.exceeded (general, auth, heavy_query) |
| Inyecciones | 3 eventos | injection.nosql, injection.xss, hpp.detected |
| Acceso | 3 eventos | access.unauthenticated, access.forbidden, cors.violation |
| Errores | 2 eventos | server.error, database.error |
| **TOTAL** | **17 eventos** | **Cobertura completa** |

### Próximos Pasos

1. **Integración con ELK** o Grafana+Loki para visualización
2. **Alertas automáticas** (email, Slack, PagerDuty)
3. **Machine Learning** para detección de anomalías
4. **Log shipping** a almacenamiento externo (S3, GCS)
5. **Compliance reports** automáticos (GDPR, SOC 2)

---

**Última actualización:** Noviembre 2025
**Mantenedor:** Equipo de Desarrollo API Smart City
**Versión:** 1.0
