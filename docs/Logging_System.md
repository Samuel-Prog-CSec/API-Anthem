# Sistema de Logging con PinoJS

Este documento describe el sistema de logging implementado en la API REST Smart City utilizando PinoJS.

## Características Principales

### 1. Separación de Logs

Los logs están completamente separados según el tipo de proceso:

- **Logs del Servidor** (`logs/server/`):
  - `combined.log`: Todos los logs del servidor API
  - `errors.log`: Solo errores (error, fatal) del servidor

- **Logs de Scripts** (`logs/scripts/`):
  - `combined.log`: Todos los logs de scripts de importación
  - `errors.log`: Solo errores (error, fatal) de los scripts

### 2. Dual Output (Desarrollo)

En modo desarrollo (`NODE_ENV=development`):
- **Consola**: Logs formateados con colores usando `pino-pretty`
- **Archivos**: Logs estructurados en JSON para análisis posterior

En modo producción (`NODE_ENV=production`):
- **Solo archivos**: Logs estructurados en JSON con redacción de datos sensibles

### 3. Creación Automática de Estructura

La carpeta `logs/` y sus subdirectorios se crean automáticamente al inicializar el logger, sin importar si ejecutas el servidor o un script de importación.

## Uso

### En el Servidor API

El servidor utiliza el logger principal configurado en `src/config/logger.js`:

```javascript
const logger = require('./config/logger');

logger.info('Servidor iniciado');
logger.error({ error: err }, 'Error en el servidor');
```

Los logs del servidor se identifican automáticamente y se escriben a `logs/server/`.

### En Scripts de Importación

Los scripts deben usar el `scriptLogger` configurado en `src/config/scriptLogger.js`:

```javascript
// Al inicio del script (primera línea)
process.env.SCRIPT_MODE = 'true';

// Importar el logger específico para el tipo de script
const { importAccidentsLogger: logger } = require('../src/config/scriptLogger');

logger.info('Iniciando importación de accidentes');
logger.error({ error: err }, 'Error en importación');
```

Los logs de scripts se identifican automáticamente y se escriben a `logs/scripts/`.

### Loggers Especializados Disponibles

Para scripts de importación:

- `importAccidentsLogger`: Importación de accidentes
- `importCensusLogger`: Importación de censo
- `importTrafficLogger`: Importación de tráfico
- `importFinesLogger`: Importación de multas
- `importNoiseLogger`: Importación de contaminación acústica
- `importLocationsLogger`: Importación de ubicaciones
- `importAirQualityLogger`: Importación de calidad del aire
- `importScootersLogger`: Importación de patinetes
- `importBikesLogger`: Importación de bicicletas
- `importContainersLogger`: Importación de contenedores
- `importAllLogger`: Script maestro de importación

Cada logger incluye un campo `scriptType` que permite filtrar logs por tipo de importación.

## Estructura de Archivos de Log

### Formato JSON Estructurado

Todos los logs en archivos están en formato JSON para facilitar el análisis:

```json
{
  "level": "info",
  "time": "2025-12-11T10:30:45.123Z",
  "env": "development",
  "app": "smart-city-api",
  "processType": "server",
  "msg": "Servidor iniciado exitosamente"
}
```

Para scripts:

```json
{
  "level": "info",
  "time": "2025-12-11T10:30:45.123Z",
  "env": "development",
  "app": "smart-city-api",
  "processType": "script",
  "scriptType": "import-accidents",
  "msg": "Importación completada"
}
```

### Formato en Consola (Desarrollo)

En consola, los logs se muestran formateados con colores:

```
[SERVER] INFO - Servidor iniciado exitosamente
[SCRIPT] INFO - Importación completada
```

## Configuración

### Variables de Entorno

- `NODE_ENV`: Determina el entorno (`development`, `production`, `test`)
- `LOG_LEVEL`: Nivel mínimo de logging (`debug`, `info`, `warn`, `error`, `fatal`)
- `SCRIPT_MODE`: Se establece automáticamente en scripts (`'true'`)

### Niveles de Log

De menor a mayor severidad:

1. `debug`: Información de depuración detallada
2. `info`: Información general de operaciones
3. `warn`: Advertencias que no impiden la ejecución
4. `error`: Errores que impiden completar una operación
5. `fatal`: Errores críticos que requieren detener el proceso

### TTL y Rotación

Actualmente los logs no tienen rotación automática. Para implementar rotación:

1. Usar `pino-rotating-file-stream` o similar
2. Configurar políticas de rotación por tamaño o tiempo
3. Implementar limpieza automática de logs antiguos

## Migración desde el Sistema Anterior

### Cambios Realizados

1. **Logger Principal** (`src/config/logger.js`):
   - Ahora usa transporte dual (consola + archivos)
   - Detecta automáticamente si es servidor o script

2. **Nuevo Logger de Scripts** (`src/config/scriptLogger.js`):
   - Logger especializado para scripts de importación
   - Incluye loggers hijo para cada tipo de importación

3. **Scripts de Importación**:
   - Todos actualizados para usar `scriptLogger`
   - Establecen `SCRIPT_MODE='true'` al inicio
   - Eliminadas las declaraciones de `importLogger` child

### Scripts Actualizados

Todos los scripts en `scripts/importation/` han sido actualizados:

- `importAccidentData.js`
- `importAirQuality.js`
- `importBikeAvailability.js`
- `importCensus.js`
- `importContainers.js`
- `importFines.js`
- `importLocations.js`
- `importNoise.js`
- `importScooterAssignments.js`
- `importTrafficData.js`
- `importAll.js`

## Ventajas del Nuevo Sistema

1. **Separación Clara**: Logs de servidor y scripts nunca se mezclan
2. **Trazabilidad**: Fácil identificar el origen de cada log
3. **Análisis**: Formato JSON estructurado permite herramientas de análisis
4. **Desarrollo**: Logs en consola con colores para mejor legibilidad
5. **Producción**: Logs solo en archivos con datos sensibles redactados
6. **Automatización**: Carpetas creadas automáticamente, sin configuración manual

## Análisis de Logs

### Buscar Errores en Logs de Servidor

```powershell
Get-Content logs\server\errors.log | Select-String "error"
```

### Buscar Errores en Logs de Scripts

```powershell
Get-Content logs\scripts\errors.log | Select-String "error"
```

### Filtrar por Tipo de Script

```powershell
Get-Content logs\scripts\combined.log | Select-String "import-accidents"
```

### Ver Logs en Tiempo Real

```powershell
Get-Content logs\server\combined.log -Wait -Tail 20
```

## Solución de Problemas

### La carpeta logs/ no se crea

**Causa**: Error de permisos o configuración incorrecta.

**Solución**: Verificar permisos de escritura en el directorio del proyecto.

### Los logs no se escriben en archivos

**Causa**: Transporte no configurado correctamente o modo test activo.

**Solución**: 
- Verificar que `NODE_ENV !== 'test'`
- Revisar configuración en `loggerTransport.js`

### Los logs se mezclan entre servidor y scripts

**Causa**: `SCRIPT_MODE` no está establecido en el script.

**Solución**: Asegurar que `process.env.SCRIPT_MODE = 'true';` está al inicio del script.

## Referencias

- [PinoJS Documentation](https://getpino.io/)
- [Pino Transports](https://getpino.io/#/docs/transports)
- [Pino Pretty](https://github.com/pinojs/pino-pretty)
