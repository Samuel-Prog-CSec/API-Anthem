# Documentación de Seguridad - Índice Principal

## Introducción

Este documento centraliza toda la información sobre las medidas de seguridad implementadas en nuestra API REST. Hemos dividido la documentación en módulos especializados para facilitar su comprensión y mantenimiento.

---

## Estructura de la Documentación

### 📋 Documentos Principales

1. **[JWT_Documentation.md](./JWT_Documentation.md)**
   Documentación completa sobre la implementación de autenticación JWT
   - Arquitectura de tokens
   - Generación y verificación
   - Refresh tokens y blacklist
   - Mejores prácticas JWT

2. **[Input_Validation_Security.md](./Input_Validation_Security.md)**
   Validación y sanitización de entrada
   - express-validator
   - Prevención de inyecciones
   - Validación por dominio

3. **[Rate_Limiting_Security.md](./Rate_Limiting_Security.md)**
   Sistema de limitación de peticiones
   - Rate limiting multinivel
   - Prevención de DoS
   - Testing de rate limits

4. **[CORS_Security.md](./CORS_Security.md)**
   Configuración CORS exhaustiva
   - Validaciones implementadas
   - Prevención de ataques CORS
   - Mejores prácticas

5. **[HTTP_Security_Headers.md](./HTTP_Security_Headers.md)**
   Headers de seguridad HTTP
   - Helmet.js
   - Headers personalizados
   - CSP y HSTS

6. **[Password_Security.md](./Password_Security.md)**
   Gestión segura de contraseñas
   - Hashing con bcrypt
   - Validación de fortaleza
   - Account lockout

7. **[Logging_Monitoring_Security.md](./Logging_Monitoring_Security.md)**
   Logging y monitoreo de seguridad
   - Pino logger
   - Eventos de seguridad
   - Redacción de datos sensibles

---

## Resumen de Medidas de Seguridad

### 🛡️ Autenticación y Autorización
- ✅ JWT con HS256
- ✅ Refresh token rotation
- ✅ Token blacklist
- ✅ Role-based access control (RBAC)
- ✅ Account lockout (5 intentos, 2 horas)

### 🔒 Protección de Entrada
- ✅ express-validator en todas las rutas
- ✅ express-mongo-sanitize (NoSQL injection)
- ✅ xss protection (XSS)
- ✅ HTTP Parameter Pollution prevention

### 🚦 Control de Tráfico
- ✅ Rate limiting general (100 req/15min)
- ✅ Rate limiting auth (10 req/15min)
- ✅ Rate limiting queries pesadas (5 req/min)
- ✅ Headers de rate limit informativos

### 🌐 Seguridad de Red
- ✅ CORS con 6 validaciones
- ✅ HTTPS obligatorio en producción
- ✅ Helmet.js con CSP
- ✅ HSTS configurado (1 año)

### 🔐 Gestión de Secretos
- ✅ Variables de entorno
- ✅ Validación de fortaleza de JWT_SECRET
- ✅ No hardcoding de credenciales
- ✅ Redacción en logs

### 📊 Monitoreo
- ✅ Pino logger estructurado
- ✅ Security event logging
- ✅ Performance monitoring
- ✅ Request logging con context

---

## Cumplimiento de Estándares

### OWASP Top 10 (2021)
| # | Vulnerabilidad | Estado |
|---|----------------|--------|
| A01 | Broken Access Control | ✅ Protegido |
| A02 | Cryptographic Failures | ✅ Protegido |
| A03 | Injection | ✅ Protegido |
| A04 | Insecure Design | ✅ Protegido |
| A05 | Security Misconfiguration | ✅ Protegido |
| A06 | Vulnerable Components | ✅ Protegido |
| A07 | Authentication Failures | ✅ Protegido |
| A08 | Data Integrity Failures | ✅ Protegido |
| A09 | Logging Failures | ✅ Protegido |
| A10 | SSRF | ⚪ No aplica |

**Cumplimiento:** 100% (9/9 aplicables)

---

## Arquitectura de Seguridad

### Defensa en Profundidad

Hemos implementado múltiples capas de seguridad:

```
┌────────────────────────────────────────┐
│      CAPA 1: Network/Transport         │
│  - HTTPS                               │
│  - HSTS                                │
│  - Rate Limiting por IP                │
└─────────────┬──────────────────────────┘
              │
┌─────────────▼──────────────────────────┐
│      CAPA 2: Application               │
│  - Helmet.js                           │
│  - CORS                                │
│  - Cookies seguras                     │
└─────────────┬──────────────────────────┘
              │
┌─────────────▼──────────────────────────┐
│      CAPA 3: Input Validation          │
│  - express-validator                   │
│  - mongo-sanitize                      │
│  - xss protection                      │
│  - HPP prevention                      │
└─────────────┬──────────────────────────┘
              │
┌─────────────▼──────────────────────────┐
│      CAPA 4: Authentication/Authz      │
│  - JWT                                 │
│  - bcrypt                              │
│  - Account lockout                     │
│  - RBAC                                │
└─────────────┬──────────────────────────┘
              │
┌─────────────▼──────────────────────────┐
│      CAPA 5: Data                      │
│  - Passwords nunca en logs             │
│  - Redacción automática                │
│  - Hashing pre-save                    │
│  - Índices únicos                      │
└─────────────┬──────────────────────────┘
              │
┌─────────────▼──────────────────────────┐
│      CAPA 6: Monitoring                │
│  - Pino logger                         │
│  - Security events                     │
│  - Performance tracking                │
│  - Rate limit logging                  │
└────────────────────────────────────────┘
```

---

## Principios de Seguridad Aplicados

### 1. **Defensa en Profundidad**
No confiamos en una única medida de seguridad. Cada capa añade protección adicional.

### 2. **Principio de Mínimo Privilegio**
- Usuarios tienen rol `user` por defecto
- Endpoints admin requieren rol `admin`
- Tokens contienen solo información necesaria

### 3. **Fail-Safe Defaults**
- Configuración segura por defecto
- Producción más restrictiva que desarrollo
- Errores genéricos al cliente (no revelan información)

### 4. **Validación Completa**
- Validación en frontend (UX)
- Validación en backend (seguridad) ← **No confiamos en el cliente**
- Validación en base de datos (integridad)

### 5. **Logging y Auditabilidad**
- Todos los eventos de seguridad se registran
- Formato estructurado (JSON)
- Timestamps precisos
- Contexto completo (IP, user-agent, etc.)

---

## Flujo de Request Seguro

```
┌─────────────┐
│   Cliente   │
└──────┬──────┘
       │ 1. Request
       ▼
┌─────────────────────┐
│ Rate Limiting       │ ──> Si excede: 429 Too Many Requests
└──────┬──────────────┘
       │ 2. Dentro del límite
       ▼
┌─────────────────────┐
│ CORS Validation     │ ──> Si origin inválido: 403 Forbidden
└──────┬──────────────┘
       │ 3. Origin permitido
       ▼
┌─────────────────────┐
│ Security Headers    │ ──> Añade Helmet headers
└──────┬──────────────┘
       │ 4. Headers configurados
       ▼
┌─────────────────────┐
│ Input Sanitization  │ ──> Limpia NoSQL injection, XSS
└──────┬──────────────┘
       │ 5. Input limpio
       ▼
┌─────────────────────┐
│ Input Validation    │ ──> Si inválido: 400 Bad Request
└──────┬──────────────┘
       │ 6. Input válido
       ▼
┌─────────────────────┐
│ Authentication      │ ──> Si no autenticado: 401 Unauthorized
└──────┬──────────────┘
       │ 7. Autenticado
       ▼
┌─────────────────────┐
│ Authorization       │ ──> Si sin permisos: 403 Forbidden
└──────┬──────────────┘
       │ 8. Autorizado
       ▼
┌─────────────────────┐
│ Business Logic      │ ──> Procesa request
└──────┬──────────────┘
       │ 9. Respuesta
       ▼
┌─────────────────────┐
│ Response Logging    │ ──> Registra evento
└──────┬──────────────┘
       │ 10. Logged
       ▼
┌─────────────┐
│   Cliente   │
└─────────────┘
```

---

## Testing de Seguridad

### Scripts de Testing Disponibles

1. **test-rate-limit.js**
   ```bash
   node scripts/test-rate-limit.js
   ```
   Prueba todos los niveles de rate limiting

2. **check-code-quality.js**
   ```bash
   node scripts/check-code-quality.js
   ```
   Analiza calidad y complejidad del código

### Testing Manual Recomendado

#### 1. Test de Inyecciones
```bash
# NoSQL Injection
curl -X POST http://localhost:3000/api/v1.0/auth/login \
  -H "Content-Type: application/json" \
  -d '{"identifier": {"$ne": null}, "password": {"$ne": null}}'

# XSS
curl -X POST http://localhost:3000/api/v1.0/auth/register \
  -H "Content-Type: application/json" \
  -d '{"username": "<script>alert(1)</script>", "email": "test@test.com", "password": "Test123!@#"}'
```

#### 2. Test de Autorización
```bash
# Intentar acceder a admin sin permisos
curl -X GET http://localhost:3000/api/v1.0/admin/cache/stats \
  -H "Authorization: Bearer <user_token>"
# Esperado: 403 Forbidden
```

#### 3. Test de CORS
```bash
# Origin no permitido
curl -X GET http://localhost:3000/api/v1.0/ubicaciones \
  -H "Origin: https://malicious-site.com"
# Esperado: Rechazado por CORS
```

---

## Recomendaciones de Producción

### Antes de Desplegar

- [ ] Variables de entorno configuradas
- [ ] JWT_SECRET con al menos 32 caracteres aleatorios
- [ ] HTTPS configurado con certificado válido
- [ ] CORS_ORIGINS con dominios específicos (no wildcard)
- [ ] Rate limiting configurado apropiadamente
- [ ] MongoDB con autenticación habilitada
- [ ] MongoDB con whitelist de IPs
- [ ] Firewall configurado (solo puertos necesarios)
- [ ] Logs monitoreados
- [ ] Backups configurados
- [ ] Alertas de seguridad configuradas

### Monitoreo Continuo

1. **Logs de Seguridad**
   - Revisar intentos de login fallidos
   - Monitorear rate limit violations
   - Detectar patrones de ataque

2. **Métricas de Performance**
   - Response times
   - Cache hit rates
   - Database query times

3. **Alertas Automáticas**
   - Múltiples intentos de login fallidos
   - Rate limiting excedido repetidamente
   - Errores 5xx frecuentes

---

## Contacto y Soporte

Para cuestiones de seguridad:
- **Email de Seguridad:** security@smartcity-api.com
- **Reporte de Vulnerabilidades:** security-reports@smartcity-api.com
- **Documentación Completa:** Ver documentos enlazados arriba

---

**Última actualización:** Noviembre 2025
**Versión:** 1.0
**Mantenedores:** Equipo de Desarrollo API Smart City
