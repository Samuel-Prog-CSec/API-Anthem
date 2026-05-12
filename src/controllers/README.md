# Controladores

Coordinan las solicitudes HTTP: validan entrada, delegan la lógica de negocio a los modelos, aplican caché donde aplique y devuelven respuestas estandarizadas. Cada controlador es delgado; la lógica compleja vive en los métodos estáticos de los modelos.

## Archivos

- `controladorAccidentes.js`: gestión de accidentalidad y consultas por ubicaciones/fechas.
- `controladorAforoBicicletas.js`: disponibilidad y aforo de bicicletas compartidas.
- `controladorBicicletas.js`: disponibilidad de bicicletas compartidas.
- `controladorCalidadAire.js`: endpoints de calidad del aire con agregaciones y paginación.
- `controladorCenso.js`: consultas demográficas y censos 2051.
- `controladorContenedores.js`: ubicaciones y tipos de contenedores urbanos.
- `controladorMultas.js`: multas y sanciones de tráfico con filtros avanzados.
- `controladorPatinetes.js`: asignación y control de patinetes eléctricos.
- `controladorRuido.js`: monitorización de contaminación acústica.
- `controladorTrafico.js`: métricas y series de tráfico vehicular.
- `controladorUbicaciones.js`: callejero, distritos y puntos de interés. Soporta precalentamiento de caché.
- `controladorAutenticacion.js`: registro, login, refresco, revocación y blacklist de tokens.
