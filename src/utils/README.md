# Utilidades

Funciones de soporte reutilizables para caché, paginación, seguridad, respuestas y generación de claves. Se invocan desde controladores, middleware y modelos para mantener el código DRY.

## Archivos

- `cacheInvalidator.js`: invalidación selectiva de cachés por recurso y operación.
- `cacheKeyGenerator.js`: generador de claves consistentes para Node-Cache.
- `errorUtils.js`: utilidades para construir y normalizar errores controlados.
- `paginationHelper.js`: paginación consistente (limit, page, metadata).
- `passwordValidator.js`: validación de contraseñas según reglas de seguridad.
- `queryHelper.js`: construcción segura de filtros MongoDB (usa `.lean()` en lecturas).
- `responseHelper.js`: respuestas JSON estandarizadas y manejo de metadatos.
- `securityLogger.js`: logging especializado de eventos de seguridad.
- `tokenHelper.js`: emisión, verificación y refresco de JWT/refresh tokens.
