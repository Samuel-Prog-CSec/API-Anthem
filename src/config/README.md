# Configuración

Define la configuración central de la API (conexión a MongoDB, CORS, loggers y precalentamiento de caché). Ajusta variables de entorno en `.env` y reutiliza estos módulos desde `src/server.js`.

## Archivos

- `config.js`: carga y expone variables de entorno, opciones generales y configuración de servicio.
- `database.js`: inicializa la conexión a MongoDB con Mongoose y aplica `maxTimeMS` y opciones de rendimiento.
- `corsValidator.js`: reglas CORS y orígenes permitidos para los entornos.
- `logger.js`: instancia principal de Pino (producción) y pino-pretty (desarrollo).
- `loggerTransport.js`: transportes de log (formateo, destinos) y configuración de niveles.
- `scriptLogger.js`: logger especializado para scripts de importación.
- `cacheWarming.js`: rutinas de precalentamiento de caché al arrancar el servidor.
