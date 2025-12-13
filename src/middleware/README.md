# Middleware

Capa transversal de seguridad, rendimiento y observabilidad. Se aplican en `src/routes` para proteger endpoints, validar peticiones y optimizar respuestas.

## Archivos

- `auth.js`: verifica tokens JWT y resuelve identidad del usuario.
- `authorization.js`: controla permisos por rol y ámbito.
- `cache.js`: lectura/escritura de caché en Node-Cache con claves especializadas.
- `errorHandler.js`: manejador centralizado de errores con respuesta JSON uniforme.
- `etag.js`: generación y validación de ETags para respuestas 304.
- `performanceMonitor.js`: mide latencia y añade cabeceras `X-Response-Time`.
- `requestLogger.js`: logging HTTP con Pino-HTTP.
- `security.js`: protecciones Helmet, rate limiting, sanitización NoSQL y XSS.
- `validation.js`: integra `express-validator` y sanea datos de entrada.
