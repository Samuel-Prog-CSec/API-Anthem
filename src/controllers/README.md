# Controladores

Coordinan las solicitudes HTTP: validan entrada, delegan la lógica de negocio a los modelos, aplican caché donde aplique y devuelven respuestas estandarizadas. Cada controlador es delgado; la lógica compleja vive en los métodos estáticos de los modelos.

## Archivos

- `accidentController.js`: gestión de accidentalidad y consultas por ubicaciones/fechas.
- `airQualityController.js`: endpoints de calidad del aire con agregaciones y paginación.
- `authController.js`: registro, login, refresco, revocación y blacklist de tokens.
- `bikeAvailabilityController.js`: disponibilidad y aforo de bicicletas compartidas.
- `censusController.js`: consultas demográficas y censos 2051.
- `containerController.js`: ubicaciones y tipos de contenedores urbanos.
- `fineController.js`: multas y sanciones de tráfico con filtros avanzados.
- `locationController.js`: callejero, distritos y puntos de interés. Soporta precalentamiento de caché.
- `noiseMonitoringController.js`: monitorización de contaminación acústica.
- `scooterAssignmentController.js`: asignación y control de patinetes eléctricos.
- `trafficController.js`: métricas y series de tráfico vehicular.
