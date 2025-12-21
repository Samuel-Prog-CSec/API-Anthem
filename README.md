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
