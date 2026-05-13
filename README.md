# API-Anthem · Smart City 2051

API REST para datos sintéticos de una Smart City año 2051. Construida con Node.js 22, Express 5.1 y MongoDB (Mongoose 8), con autenticación JWT, seguridad reforzada y optimizaciones de rendimiento (cachés especializados, compresión, ETags, límites de tiempo y agregaciones acotadas).

## Características clave

- **Autenticación JWT** con tokens de refresco y lista de bloqueo
- **Seguridad**: Helmet, rate limiting, sanitización NoSQL, XSS, validaciones
- **Rendimiento**: múltiples cachés TTL, `.lean()`, `Promise.all`, compresión y ETags
- **Observabilidad**: logging estructurado con Pino y métricas de latencia
- **Datos 2051**: dataset sintético completo (movilidad, aire, censos, multas, etc.)

## Estructura

- `src/`: servidor, rutas, controladores, modelos, middleware, utilidades y configuración
- `scripts/`: importadores CSV y tareas auxiliares
- `docs/`: documentación funcional, seguridad, optimización y dataset
- `datos_hpe/`: datasets CSV originales (año 2051)

## Puesta en marcha

1) `npm install`
2) Configura `.env` (usa `.env.example` como referencia)
3) `npm run dev` para desarrollo o `npm start` para producción

## Visualización de logs (Windows)

Los logs se escriben en UTF-8 en `logs/server/` y `logs/scripts/`. Para verlos correctamente sin caracteres rotos:

```powershell
# Ver logs del servidor (recomendado)
.\scripts\view-logs.ps1

# Seguir logs en tiempo real
.\scripts\view-logs.ps1 -Follow

# Ver logs de errores
.\scripts\view-logs.ps1 -LogFile errors
```

O configura tu terminal/editor para UTF-8 (ver [docs/Logging_System.md](docs/Logging_System.md)).

## Calidad y estilo

- ESLint v9 (ver `eslint.config.mjs`)
- Sin logs en consola: se usa Pino
- Comentarios y documentación en español | código en inglés

## Documentación complementaria

- [`docs/api-reference.md`](docs/api-reference.md): referencia completa de endpoints (método, ruta, auth, params, ejemplos de respuesta).
- [`docs/threat-model.md`](docs/threat-model.md): modelo de amenazas, decisiones de seguridad y matriz OWASP.
- [`docs/Logging_System.md`](docs/Logging_System.md): visualización de logs y configuración UTF-8.

## Limitaciones conocidas (v1.0.0)

### Ejecución sobre HTTP (sin TLS)

El proyecto v1.0.0 corre sobre HTTP plano. **Es seguro para desarrollo local y entorno universitario**, pero **NO debe desplegarse a producción pública** sin antes:

1. Terminar TLS en un proxy reverso (nginx, traefik, AWS ALB, Cloudflare).
2. Forzar redirect HTTP → HTTPS en el proxy.
3. Reactivar HSTS en `src/middleware/security.js#helmetConfig` (cambiar `hsts: false` por `hsts: { maxAge: 31536000, includeSubDomains: true, preload: true }`).
4. Verificar que las cookies se sirven con `Secure` (ya cubierto en producción por `config.server.env === 'production'`).

Razón actual: el proyecto es un TFG universitario sin infraestructura de despliegue. Detalles completos en [`docs/threat-model.md`](docs/threat-model.md) sección 5.

### Sin MFA en v1.0.0

Las credenciales son usuario + contraseña. Multi-factor authentication está diferido a v2 (ver `docs/threat-model.md` sección 6). En v1.0.0 las defensas activas son: bcrypt 12 salt rounds, rate limit estricto en `/auth/*`, lockout tras N intentos fallidos, blacklist persistente de tokens, rotación de refresh tokens, `passwordChangedAt` invalida tokens previos.

### Acceso abierto al dataset entre usuarios autenticados

Por diseño, cualquier usuario autenticado puede leer cualquier registro del dataset (no se valida ownership de recursos individuales). **No es vulnerabilidad** porque los datos son sintéticos sin PII real (ciudad ficticia en el año 2051). Detalle en [`docs/threat-model.md`](docs/threat-model.md) sección 3.
