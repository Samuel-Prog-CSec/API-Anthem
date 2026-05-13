# Threat Model — API-Anthem (Smart City 2051)

Documento de referencia sobre el modelo de amenazas y las decisiones de diseño de seguridad de la API. Sirve como complemento a `Auditoria_total_agente/03_Ciberseguridad/` y se actualiza cuando se introducen cambios estructurales.

---

## 1. Activos protegidos

| Activo | Sensibilidad | Notas |
|--------|--------------|-------|
| Credenciales de usuario (`users.password`) | **Alta** | Hash bcrypt (12 salt rounds), `select: false`. Nunca se expone via API. |
| Tokens JWT (access + refresh) | **Alta** | Firmados con HS256 sobre secretos >=32 chars validados al arranque. |
| Identidad de usuario autenticado | **Alta** | Cookies httpOnly + sameSite strict + secure en prod. |
| Datos del dataset (multas, accidentes, censo, trafico, etc.) | **Baja** | Datos sintéticos sin PII real. Por diseño, todos los usuarios autenticados los pueden leer. |
| Configuracion del servidor (`.env`) | **Alta** | Excluido por `.gitignore`. `.env.example` con placeholders neutros. |

---

## 2. Modelo de actores

| Actor | Capacidades | Confianza |
|-------|-------------|-----------|
| Anonimo (no autenticado) | Acceder a `/health` basico, registrarse, iniciar sesion | Baja (rate-limited) |
| Usuario autenticado (rol `USER`) | Leer cualquier registro del dataset, ver/refrescar su propio perfil, cambiar su password | Media |
| Administrador (rol `ADMIN`) | Todo lo anterior + endpoints `/admin/*` (cache stats, system health, performance, etag stats), gestion de usuarios | Alta (acciones logueadas) |
| Atacante externo | Sin credenciales validas; intenta brute force, inyeccion, XSS, escalada de privilegios | Hostil |

---

## 3. Decision: acceso abierto al dataset entre usuarios autenticados (BOLA por diseño)

### Contexto

Los endpoints `GET /api/v1/multas/:id`, `GET /api/v1/accidentes/:id`, etc. validan que `:id` sea un `ObjectId` valido y que el usuario este autenticado, pero **no comprueban ownership** del recurso. Cualquier usuario con un access token valido puede leer cualquier documento del dataset.

### Por que no es vulnerabilidad

- El dataset es **sintetico**, generado a partir de CSV historicos del Ayuntamiento de Madrid y reescritos para una ciudad ficticia en el año 2051.
- **Ningun registro contiene PII real** (no hay DNI, no hay nombre y apellidos identificables, no hay direcciones reales asociadas a personas vivas).
- El proposito del producto es un dashboard de Smart City donde la idea base es que **cualquier ciudadano autenticado puede consultar cualquier dato publico**. Es analogo a un portal de transparencia.
- La auditoria OWASP API1:2023 (BOLA) se considera **no aplicable** bajo esta premisa documentada.

### Que se verifica

- Que el `_id` (ObjectId) sea valido (formato hex 24 chars) antes de consultar.
- Que el usuario este autenticado via JWT (`middleware/auth.js`).
- Que las queries usen `.lean()` y `maxTimeMS` para evitar timeouts maliciosos.
- Que el `toJSON transform` de `User.js` filtre campos sensibles (`password`, `lockUntil`, `loginAttempts`).

### Que no se verifica (intencional)

- Ownership de cada registro (no aplica al dataset publico).

### Si en el futuro se anaden entidades por-usuario

Cuando se introduzcan entidades privadas (favoritos, dashboards personalizados, notas), se debera anadir:
- Campo `propietario: ObjectId` referenciando `User._id`.
- Middleware `validarOwnership(resourceField)` que rechace si `req.user._id !== resource[resourceField]`.
- Roles mas granulares (`viewer`, `editor`, `admin`) y `authorize(roles, ownershipChecks)`.

---

## 4. Modelo RBAC

### Roles

- `USER`: usuario estandar autenticado. Puede leer datos del dataset y gestionar su propio perfil.
- `ADMIN`: administrador. Acceso a `/admin/*` (cache, system health, performance, ETag stats).

### Aplicacion

- `middleware/auth.js#authenticate`: verifica JWT, comprueba estado del usuario (no bloqueado, no password rotada despues del token).
- `middleware/authorization.js#authorize(...roles)`: factory; rechaza con 403 si el usuario no tiene ninguno de los roles requeridos.
- `middleware/authorization.js#adminOnly`: atajo de `authorize('admin')`.

### Cobertura verificada

- `routes/admin.js`: TODOS los endpoints (`cache/stats`, `cache/clear`, `system/health`, `performance/stats`, `etag/stats`) llevan `authenticate, adminOnly`.
- `routes/auth.js`: endpoints publicos (`/login`, `/register`, `/refresh`) sin `authenticate`; endpoints privados (`/logout`, `/change-password`, `/verify-token`, `/me`) con `authenticate`.
- Rutas de dominio (`/multas`, `/accidentes`, `/trafico`, etc.): `authenticate` sin `adminOnly` (alineado con seccion 3).

### Pendiente v2

- Granularidad de roles para casos como `editor` (puede crear/modificar pero no borrar) o `viewer` (solo lectura, sin endpoints de mutacion). El v1.0.0 no introduce endpoints mutadores de dominio.

---

## 5. Decision: ejecucion sobre HTTP (sin TLS)

### Contexto

La API se ejecuta sobre HTTP plano en desarrollo y entorno universitario (proyecto TFG sin infraestructura de produccion).

### Implicaciones

- Riesgo de interceptacion en red local insegura (MITM).
- Cookies httpOnly + sameSite strict siguen mitigando XSS y CSRF, pero un atacante en la misma red puede leer tokens al pasar en claro.

### Mitigacion en v1.0.0

- HSTS deshabilitado intencionalmente en Helmet (`hsts: false`) porque no hay TLS.
- Documentado en `README.md` como limitacion conocida.

### Plan a futuro (despliegue real)

Antes de exponer la API a internet:
1. Terminar TLS en un proxy reverso (nginx, traefik, AWS ALB, etc.).
2. Reactivar HSTS en `middleware/security.js#helmetConfig` con `maxAge: 31536000`, `includeSubDomains: true`, `preload: true`.
3. Forzar redirect HTTP → HTTPS en el proxy reverso.
4. Revisar cookies para garantizar que `secure: true` esta activo (ya cubierto por `config.server.env === 'production'`).

---

## 6. Decision: MFA diferido a v2

### Contexto

v1.0.0 no implementa multi-factor authentication. Las credenciales son usuario + password.

### Justificacion para v1.0.0

- Alcance de TFG universitario, no produccion publica.
- Bcrypt 12 rounds + JWT con rotacion + rate limit + lockout tras N intentos + blacklist persistente ya proporcionan defensa razonable contra brute force.
- Aumento de complejidad UX no justificado para datos sinteticos sin PII.

### Plan para v2

- TOTP via aplicacion estandar (Google Authenticator, Authy) - libreria `speakeasy` u `otplib`.
- Codigos de recuperacion de un solo uso.
- Endpoint admin para forzar reseteo de MFA en caso de bloqueo.
- Auditoria de eventos MFA en `securityLogger`.

---

## 7. Vectores de ataque auditados (resumen tabla cruzada)

| Vector | Estado | Mecanismo de defensa |
|--------|--------|----------------------|
| NoSQL Injection | **Mitigado** | `express-mongo-sanitize` (`replaceWith: '_'`, `allowDots: false`) |
| SQL Injection | **N/A** | No se usa SQL |
| XSS backend | **Mitigado** | `xss()` recursivo con `MAX_DEPTH=5`, `MAX_KEYS=100`, `MAX_ARRAY=100` |
| XSS frontend | **Mitigado** | React escapa por defecto. Sin `dangerouslySetInnerHTML` (grep verificado) |
| CSRF | **Mitigado** | Cookies `httpOnly + sameSite strict` + access token en memoria |
| Path Traversal | **N/A** | No hay endpoints que reciban paths del usuario |
| SSRF | **Mitigado** | `scheduleBackgroundRefresh` usa `config.server.host:port`, no `req.get('host')` |
| ReDoS | **Mitigado** | `escapeRegex` + truncamiento a 200 chars en `queryHelper.js` |
| Prototype Pollution | **Mitigado** | `mongo-sanitize` + `xss` recursivo (sin `Object.assign` con input de usuario) |
| HPP (HTTP Parameter Pollution) | **Mitigado** | Whitelist explicita en `HPP_ARRAY_PARAMS_WHITELIST`; fuera de whitelist toma solo primer valor |
| Clickjacking | **Mitigado** | Helmet CSP `frame-ancestors 'none'` + `X-Frame-Options: DENY` legacy |
| MIME sniffing | **Mitigado** | Helmet `X-Content-Type-Options: nosniff` |
| Brute force credenciales | **Mitigado** | Rate limit estricto `/auth/*` + lockout tras N intentos en `User` |
| Algorithm Confusion JWT | **Mitigado** | `jwt.verify(token, secret, { algorithms: ['HS256'] })` explicito |
| Token replay | **Mitigado** | Blacklist persistente + rotacion de refresh + `passwordChangedAt` invalida tokens previos |
| Logs con secretos | **Confirmado limpio** | grep `logger.*(password\|token\|secret\|hash)` solo logea metadatos (ip, userId, error.message), nunca valores |

---

## 8. Headers de seguridad activos

| Header | Valor | Origen |
|--------|-------|--------|
| `Content-Security-Policy` | `default-src 'none'; frame-ancestors 'none'` | Helmet |
| `X-Frame-Options` | `DENY` | `customSecurityHeaders` |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=(), payment=(), usb=(), magnetometer=(), gyroscope=(), accelerometer=()` | `customSecurityHeaders` |
| `X-Content-Type-Options` | `nosniff` | Helmet |
| `X-Powered-By` | (removed) | `customSecurityHeaders` |
| `Referrer-Policy` | `no-referrer` | Helmet |
| `Strict-Transport-Security` | (disabled) | Helmet (no TLS en v1.0.0) |
| `Cross-Origin-Resource-Policy` | `cross-origin` | Helmet |
| `Cache-Control` (en `/auth*` y `/user*`) | `no-cache, no-store, must-revalidate` | `customSecurityHeaders` |

---

## 9. Resumen ejecutivo

- **CRITICOS resueltos**: TEST_MODE backdoor cerrado, cookie name mismatch corregido, query token bloqueado.
- **OWASP API Top 10 (2023)**: todas las categorias aplicables cubiertas o documentadas como N/A.
- **Hardening pendiente intencional**: MFA (v2), HSTS (cuando haya TLS), roles granulares (cuando haya entidades por-usuario).
- **Logs**: validados sin leaks de secretos (audit grep al cierre de v1.0.0).
- **Cumplimiento de reglas de idioma CLAUDE.md**: convenciones respetadas en este documento.
