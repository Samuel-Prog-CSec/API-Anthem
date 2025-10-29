# Lista de rutas realizadas de la API REST
- [X] Censo -> Demasiado tiempo procesando archivos, +200K lineas por documento | paralelismo? && no cierra conexion cuando termina
- [X] Multas -> No cierra la conexion al terminar
- [X] Contaminacion acustica
- [X] Calidad de aire -> No cierra conexion cuando termina
- [X] Ubicaciones
- [X] Trafico -> +1 millon de lineas por documento, problemas de velocidad | optimizar?
- [X] Accidentalidad
- [X] Asignación de patinetes
- [X] Contenedores

CONTROL DE DUPLICADOS???

---

# Semana del 6 de octubre al 12 de octubre
- [] Ocupación aparcamientos rotacionales
- [] Reserva paradas taxi

# Resto de rutas
- [] Peatones y bicicletas
- [] Callejero

---

# Prompt
Bien, la API REST que estamos diseniando esta tomando forma. Actualmente, vamos a pasar a desarrollar la seccion de Disponibilidad de bicicletas eléctricas y Contenedores. Para ello, tienes la carpeta de "datos_hpe" donde estan los .csv con los datos brutos que se deben importan en la BD, pueden consultar los .csv aunque algunos pueden ser muy largos, tienes tmb el archivo #file:dataset_information.md que he escrito para que tengas mayor contexto (para la parte de "Trafico", puedes consultar lo que ya hemos hecho en la de Ubicaciones, ya que se menciona "PuntoMedidaTrafico.csv").

Por supuesto, tmb hay que diseniar las rutas y controllers correspondientes (ademas de los modelos de Mongoose), a las rutas debes aplicarles las medidas de seguridad que ya hemos desarrollado y aplicado en otras rutas ya desarrolladas. Ademas, para desarrollar las funcionalidades y filtros del controller y los servicios que se van a exponer en las rutas, debes tener en cuenta el front-end (en ReactJS) que se va diseniar en el futuro y las necesidades que debe satisfacer la API para diseniar correctamente dicho dashboard de la ciudad inteligente. Sera un dashboard que muestre datos estaticos e historicos (nada de tiempo real), tmb como ya la API es bastante compleja y esta muy nutrida, no te compliques en exceso con las rutas y las funciones que se exponen para estas, vamos a lo elemental y funciones solidas y eficientes, sin entrar en cosas super complejas o excesivamente enrevesadas.

El proceso que debes seguir para desarrollar esto es el siguiente: primero el modelo de mongoose, despues el controller y las rutas que usaran dichas funciones y por ultimo el script de importacion (uno disntinto para Disponibilidad de bicicletas eléctricas y Contenedores). Tras haber diseniado todo esto, hay que probar que todo funcione correctamente, para ello, primero ejecutaremos los scripts de importacion (ejecucion normal para cargar todos los datos en la BD para tenerla lista en produccion), esto puede tardar, tmb hay que corregir todos los fallos y errores que ocurran en esta fase, cuando este todo listo pasaremos a probar las rutas y que devuelvan los resultados correctamente tanto en tiempo, como en forma.

Es importante que analices los .csv implicados para que puedas valorar si hay un numero muy elevado de lineas y por tanto, puedas aplicar alguna medida de optimizacion para que la ingesta en BD no sea un tiempo excesivo. Debes tener cuidado tmb que cuando termine el script de importacion se cierre la conexion correctamente y no se quede colgada y el script en un bucle infinito (te ha pasado otras veces). Asegurante de aplicar tmb un control de duplicados para obviar los lineas que ya se haya introducido en ejecuciones previas y SOLO introducir aaquellas que puedan formar documentos nuevos.

---

# Dificultad
2. Ocupación Aparcamientos Rotacionales
  Razón: Datos agregados mensuales, estructura sencilla
  Campos: Año/mes, ocupación porcentual, número de plazas
  Complejidad: Baja - Consultas por fecha y distrito
4. Reserva Paradas Taxi
  Razón: Datos estáticos con coordenadas y configuración
  Campos: Ubicación, tipo reserva, número plazas
  Complejidad: Media - Gestión de coordenadas y tipos
5. Peatones y Bicicletas Aforo
  Razón: Series temporales con ubicaciones fijas
  Campos: Fecha/hora, conteos, coordenadas estación
  Complejidad: Media - Agregaciones temporales y geoespaciales
6. Objetos Perdidos Taxi
  Razón: Flujo de trabajo complejo con estados y resoluciones
  Campos: Estados, fechas múltiples, tipos de iniciativa
  Complejidad: Media-Alta - Lógica de negocio compleja
7. Callejero (Mayor dificultad)
  Razón: Dataset masivo con múltiples relaciones jerárquicas
  Campos: Códigos complejos, jerarquía distrito/barrio, coordenadas
  Complejidad: Alta - Optimización de búsquedas, índices múltiples

---

# OPTIMIZACIÓN DE RUTAS

## Análisis de Rendimiento - Endpoints >1500ms

### Resultados del Test de Rendimiento
**Fecha:** 2025-10-05
**Endpoints totales probados:** 60
**Endpoints con tiempo >1500ms:** 10 (16.7%)
**Tiempo promedio general:** 892ms
**Tiempo máximo:** 12,180ms

---

## 🔴 CRÍTICO: Endpoints >5000ms

### 1. GET /census/analysis/demographic - 12,180ms
**Volumen de datos:** 2.7M registros de censo

**Problemas identificados:**
1. **Múltiples agregaciones secuenciales**: Se ejecutan 3-4 agregaciones diferentes (edad, nacionalidad, género) una tras otra
2. **Sin paginación**: Procesa todo el dataset completo sin límite
3. **Cálculos complejos en runtime**: Múltiples operaciones matemáticas ($divide, $multiply) sobre millones de registros
4. **Proyecciones nested**: Estructuras complejas con múltiples niveles de $addFields y $project
5. **Sin índices compuestos óptimos**: Los índices actuales no cubren todas las condiciones de filtrado combinadas

**Soluciones propuestas:**
- [ ] **Vistas materializadas**: Crear colección agregada pre-calculada que se actualice al importar datos
  ```javascript
  // Colección: census_demographic_cache
  // Actualización: Al finalizar importación o mediante job nocturno
  ```
- [ ] **Índice compuesto optimizado**:
  ```javascript
  db.census.createIndex({
    'año': 1,
    'distrito.codigo': 1,
    'clasificacionEdad.grupoEdad': 1
  })
  ```
- [ ] **Paralelización de agregaciones**: Ejecutar las 3 agregaciones (edad, nacionalidad, género) en paralelo con `Promise.all()`
- [ ] **Cache de resultados**: Implementar cache Redis/memoria con TTL de 24h para este endpoint
- [ ] **Limitar profundidad de análisis**: Ofrecer versión "light" del análisis con menos métricas calculadas

**Impacto esperado:** Reducción de 12s → 2-3s (75% mejora)

---

### 2. GET /census/dashboard - 9,161ms
**Volumen de datos:** 2.7M registros

**Problemas identificados:**
1. **Dashboard con múltiples queries**: Combina 5-6 consultas diferentes en una sola respuesta
2. **Sin cache**: Datos del dashboard raramente cambian pero se calculan cada vez
3. **Agregaciones complejas simultáneas**: Pirámide + estadísticas + evolución + tendencias
4. **Datos históricos completos**: Procesa datos de todos los meses del año

**Soluciones propuestas:**
- [ ] **Cache agresivo**: Redis con TTL de 6-12 horas (dashboard rara vez se actualiza)
- [ ] **Pre-cálculo programado**: Generar snapshot del dashboard cada 6 horas mediante cron job
- [ ] **Lazy loading**: Dividir dashboard en múltiples endpoints que el frontend puede cargar por separado
- [ ] **Datos resumidos**: Crear tabla `census_dashboard_summary` con datos agregados por distrito/mes
- [ ] **Índices de cobertura**: Añadir índices que cubran completamente las queries más frecuentes

**Impacto esperado:** Reducción de 9s → 500ms-1s (89% mejora)

---

### 3. GET /census/pyramid - 6,780ms
**Volumen de datos:** 2.7M registros

**Problemas identificados:**
1. **Doble agregación**: Ejecuta pirámide detallada + pirámide simplificada secuencialmente
2. **Agrupación por edad exacta**: 100+ grupos de edad generan overhead significativo
3. **Cálculos redundantes**: Mismos totales calculados múltiples veces
4. **Sin índice específico para edad**: Las consultas por edad no están optimizadas

**Soluciones propuestas:**
- [ ] **Eliminar pirámide detallada por defecto**: Solo retornar simplificada, ofrecer detallada como parámetro opcional
- [ ] **Índice compuesto para edad**:
  ```javascript
  db.census.createIndex({
    'año': 1,
    'edad': 1,
    'clasificacionEdad.grupoEdad': 1
  })
  ```
- [ ] **Cache por distrito**: Cachear resultado de cada distrito separadamente
- [ ] **Pre-agregación**: Tabla `census_pyramid_summary` actualizada en importación
- [ ] **Limitar granularidad**: Agrupar edades en rangos de 5 años en lugar de edad exacta

**Impacto esperado:** Reducción de 6.7s → 1-2s (70% mejora)

---

### 4. GET /census - 3,689ms
**Volumen de datos:** 2.7M registros, paginado a 50 por página

**Problemas identificados:**
1. **Paginación ineficiente**: Usa skip() sobre millones de documentos
2. **Estadísticas calculadas siempre**: Cada query calcula estadísticas del dataset completo
3. **Múltiples condiciones de filtrado**: Sin índice que las cubra todas
4. **Sort sobre campo no indexado**: Ordenamiento por 'totalPoblacion' no optimizado

**Soluciones propuestas:**
- [ ] **Paginación basada en cursor**: Usar `_id` o timestamp en lugar de skip()
  ```javascript
  // En lugar de: .skip(page * limit)
  // Usar: .find({ _id: { $gt: lastSeenId } })
  ```
- [ ] **Estadísticas opcionales**: Solo calcular si se solicita explícitamente con `includeStats=true`
- [ ] **Índice para sort común**:
  ```javascript
  db.census.createIndex({
    'estadisticas.totalPoblacion': -1,
    'fechaCenso': -1
  })
  ```
- [ ] **Límite de paginación**: Máximo 1000 documentos accesibles (20 páginas × 50)
- [ ] **Cache de páginas frecuentes**: Cachear página 1 con diferentes filtros

**Impacto esperado:** Reducción de 3.6s → 200-500ms (86% mejora)

---

### 5. GET /census/districts/statistics - 3,614ms
**Volumen de datos:** 2.7M registros agregados por 21 distritos

**Problemas identificados:**
1. **Agregación compleja por distrito**: Procesa todos los 2.7M registros cada vez
2. **Incluye barrios opcionales**: Si includeBarrios=true añade otra capa de agregación
3. **Sin cache**: Estadísticas por distrito cambian raramente
4. **$addToSet de barrios**: Operación costosa para contar barrios únicos

**Soluciones propuestas:**
- [ ] **Cache por distrito**: Redis con TTL de 24 horas
- [ ] **Tabla pre-agregada**: `census_district_stats` actualizada en importación
- [ ] **Índice de distrito optimizado**:
  ```javascript
  db.census.createIndex({
    'año': 1,
    'distrito.codigo': 1,
    'barrio.codigo': 1
  })
  ```
- [ ] **Separar endpoint de barrios**: Crear `/districts/:id/statistics` para análisis individual
- [ ] **Limitar cálculos**: Ofrecer versión básica vs completa de estadísticas

**Impacto esperado:** Reducción de 3.6s → 500ms-1s (72% mejora)

---

## 🟡 MEDIO: Endpoints entre 2000ms-5000ms

### 6. GET /fines/statistics - 2,834ms
**Volumen de datos:** 644K+ multas

**Problemas identificados:**
1. **Agregación por múltiples dimensiones**: Soporta groupBy por día/mes/año/tipo/lugar
2. **Sin índices para todas las agrupaciones**: Solo optimizado para fecha
3. **Cálculos estadísticos complejos**: Media, suma, count en cada grupo
4. **Sin límite efectivo**: Parámetro `limit` no siempre aplicado correctamente

**Soluciones propuestas:**
- [ ] **Índices por dimensión de agrupación**:
  ```javascript
  db.fines.createIndex({ 'metadatos.tipoInfraccion': 1, 'fecha': -1 })
  db.fines.createIndex({ 'lugar': 1, 'fecha': -1 })
  ```
- [ ] **Cache por tipo de agrupación**: Cachear resultados de agrupaciones más comunes
- [ ] **Limitar resultados**: Forzar límite máximo de 50 grupos
- [ ] **Pre-agregación mensual**: Tabla `fines_monthly_stats` con estadísticas pre-calculadas

**Impacto esperado:** Reducción de 2.8s → 500-800ms (71% mejora)

---

### 7. GET /census/evolution - 2,649ms
**Volumen de datos:** 2.7M registros × 12 meses

**Problemas identificados:**
1. **Series temporales largas**: Procesa evolución de 12 meses completos
2. **Múltiples agregaciones por periodo**: Una agregación por cada mes
3. **Cálculos de variación**: Comparaciones mes a mes requieren post-procesamiento
4. **Sin índice temporal optimizado**: Índice actual no cubre queries de evolución

**Soluciones propuestas:**
- [ ] **Tabla de series temporales**: `census_timeseries` con datos pre-agregados mensuales
- [ ] **Índice de serie temporal**:
  ```javascript
  db.census.createIndex({
    'año': 1,
    'mes': 1,
    'distrito.codigo': 1
  })
  ```
- [ ] **Cache de evoluciones**: Cachear evoluciones por distrito/año
- [ ] **Limitar rango temporal**: Máximo 12 meses de evolución
- [ ] **Cálculo incremental**: Actualizar solo el último mes en lugar de recalcular todo

**Impacto esperado:** Reducción de 2.6s → 400-700ms (73% mejora)

---

### 8. GET /fines/locations/ranking - 2,208ms
**Volumen de datos:** 644K+ multas agrupadas por ubicación

**Problemas identificados:**
1. **Agrupación por texto libre**: Campo `lugar` no normalizado genera miles de grupos
2. **Sin índice text**: Búsquedas y agrupaciones por lugar no optimizadas
3. **Sort sobre agregación**: Ordenar después de agrupar es costoso
4. **Coordenadas opcionales**: Lookup adicional a ubicaciones ralentiza query

**Soluciones propuestas:**
- [ ] **Normalizar ubicaciones**: Pre-procesar y categorizar lugares comunes en importación
- [ ] **Índice de texto completo**:
  ```javascript
  db.fines.createIndex({ 'lugar': 'text' })
  ```
- [ ] **Cache de rankings**: Redis con TTL de 12 horas (rankings cambian poco)
- [ ] **Tabla de rankings**: `fines_location_ranking` pre-calculada
- [ ] **Limitar resultados**: Máximo top 100 ubicaciones

**Impacto esperado:** Reducción de 2.2s → 300-600ms (73% mejora)

---

### 9. GET /fines (sin filtros) - 1,925ms
**Volumen de datos:** 644K+ multas, paginado a 50

**Problemas identificados:**
1. **Query sin filtros sobre dataset grande**: Sin WHERE clause eficiente
2. **Paginación con skip()**: Ineficiente sobre 644K documentos
3. **Estadísticas calculadas**: Agregación paralela de stats en cada request
4. **Proyección de muchos campos**: Retorna documentos completos sin proyección

**Soluciones propuestas:**
- [ ] **Paginación por cursor**: Usar `_id` en lugar de skip()
- [ ] **Estadísticas opcionales**: Solo calcular con parámetro `includeStats=true`
- [ ] **Proyección por defecto**: Limitar campos retornados a los esenciales
- [ ] **Índice para sort default**:
  ```javascript
  db.fines.createIndex({ 'fecha': -1, '_id': 1 })
  ```
- [ ] **Cache de primera página**: Cachear página 1 sin filtros

**Impacto esperado:** Reducción de 1.9s → 200-400ms (79% mejora)

---

## 🟢 MENOR PRIORIDAD: Endpoints entre 1500ms-2000ms

### 10. GET /fines (con filtros) - 1,469ms
**Volumen de datos:** 644K+ multas filtradas

**Problemas identificados:**
1. **Múltiples condiciones de filtrado**: No todos los índices compuestos disponibles
2. **Regex case-insensitive**: Búsquedas en `lugar` y `denunciante` no optimizadas
3. **Rango de fechas + otros filtros**: Índice compuesto no cubre todas las combinaciones

**Soluciones propuestas:**
- [ ] **Índices compuestos estratégicos**:
  ```javascript
  db.fines.createIndex({
    'fecha': -1,
    'calificacion': 1,
    'lugar': 1
  })
  db.fines.createIndex({
    'fecha': -1,
    'metadatos.tipoInfraccion': 1
  })
  ```
- [ ] **Text index para búsquedas**: Reemplazar regex con búsqueda full-text
- [ ] **Cache de filtros comunes**: Cachear combinaciones de filtros más usadas

**Impacto esperado:** Reducción de 1.4s → 300-500ms (66% mejora)

---

## Resumen de Optimizaciones Propuestas

### Por Estrategia:

#### 1. **Índices de Base de Datos** (10 endpoints afectados)
- Crear 15 índices compuestos nuevos
- Optimizar índices existentes
- **Impacto:** Mejora promedio del 40-60%

#### 2. **Caching** (8 endpoints afectados)
- Implementar Redis cache con TTL variable
- Cache de resultados agregados
- **Impacto:** Mejora del 70-90% en requests subsecuentes

#### 3. **Pre-agregación** (6 endpoints afectados)
- Crear 5 colecciones de datos agregados
- Actualizar en importación o mediante jobs
- **Impacto:** Mejora del 80-95%

#### 4. **Paginación Eficiente** (3 endpoints afectados)
- Reemplazar skip() por cursor-based pagination
- **Impacto:** Mejora del 50-70% en páginas avanzadas

#### 5. **Paralelización** (2 endpoints afectados)
- Promise.all() para agregaciones independientes
- **Impacto:** Mejora del 30-50%

#### 6. **Optimización de Queries** (10 endpoints afectados)
- Simplificar agregaciones
- Eliminar cálculos redundantes
- Proyecciones específicas
- **Impacto:** Mejora del 20-40%

---

## Priorización de Implementación

### FASE 1 - Crítica (Semana 1)
1. ✅ Cache Redis para endpoints de dashboard y estadísticas
2. ✅ Índices compuestos para Census (3 índices críticos)
3. ✅ Índices compuestos para Fines (2 índices críticos)
4. ✅ Paginación por cursor en Census y Fines

**Resultado esperado:** Reducir endpoints críticos de >5s a <2s

### FASE 2 - Alta (Semana 2)
1. ✅ Pre-agregación de dashboard de Census
2. ✅ Pre-agregación de estadísticas de Fines
3. ✅ Paralelización de agregaciones en demographic analysis
4. ✅ Text indexes para búsquedas en Fines

**Resultado esperado:** Todos los endpoints <1s

### FASE 3 - Media (Semana 3)
1. ✅ Vistas materializadas para análisis complejos
2. ✅ Jobs de actualización nocturna
3. ✅ Optimización de proyecciones
4. ✅ Lazy loading en dashboards

**Resultado esperado:** Optimización general del 80%

---

## Métricas de Éxito

**Estado actual:**
- ❌ 10 endpoints >1500ms (16.7%)
- ❌ 5 endpoints >5000ms (8.3%)
- ❌ Tiempo máximo: 12,180ms
- ❌ Tiempo promedio: 892ms

**Objetivo tras optimización:**
- ✅ 0 endpoints >1500ms
- ✅ Tiempo máximo <1000ms
- ✅ Tiempo promedio <300ms
- ✅ Cache hit rate >70%

---

## Notas Técnicas

### Consideraciones Importantes:
1. **Datos estáticos**: La mayoría de datos de censo y multas no cambian, ideales para cache agresivo
2. **Importación batch**: Pre-calcular agregaciones durante importación en lugar de runtime
3. **Dashboard principal**: Priorizar optimización de endpoints más usados por usuarios
4. **Monitoreo**: Implementar APM para identificar queries lentas en producción
5. **Índices vs Espacio**: Cada índice consume espacio, evaluar trade-off

### Herramientas Recomendadas:
- **MongoDB Compass**: Analizar explain() de queries lentas
- **Redis Commander**: Monitorear cache hit/miss rates
- **New Relic / DataDog**: APM para tracking de rendimiento en producción
- **Artillery / k6**: Load testing para validar mejoras

# Correcciones posibles
## MEDIA PRIORIDAD:
  - Implementar los TODOs en traffic.js o eliminarlos
  - Estandarizar nombres de campos (español vs inglés)
  - Considerar agregar validación de password en auth controller
  - Documentar mejor las variables de entorno requeridas

## BAJA PRIORIDAD:
  - Migrar de console.log a Winston/Pino
  - Implementar token blacklist con Redis
  - Añadir más tests unitarios (actualmente solo E2E)
  - Considerar clustering para escalabilidad
  - Añadir healthcheck de MongoDB en endpoint /health


# Probar
  - cambiar bcryptjs por argon2
