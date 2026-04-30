# Aceleracion de la importacion masiva de datos (Opcion 1)

**Fecha:** 2026-04-30
**Alcance:** scripts de importacion en `scripts/importation/` y orquestador `scripts/importAll.js`.
**Objetivo medible:** reducir el tiempo del primer import limpio (`node scripts/importAll.js` con BD vacia) de las ~3h actuales a ~30-50 min, sin perder datos ni cambiar el modelo de dominio.

## 1. Contexto y motivacion

El dataset Smart City es fijo (no cambia entre re-imports) pero los schemas de Mongoose evolucionan durante el desarrollo. Cada cambio de schema fuerza dumpear la BD y re-ejecutar la importacion. Hoy ese ciclo dura mas de 3 horas, dominado por tres colecciones:

| Coleccion | Documentos | CSV | Indices secundarios |
|---|---|---|---|
| `traffic_measurements` | ~24M | 7.2 GB | 9 |
| `census` | ~2.7M | 249 MB | 13 |
| `fines` | ~2M | 497 MB | 16 |
| `bike_traffic_counts` | ~293K | 39 MB | varios |
| Resto | <100K c/u | <100 MB | varios |

Diagnostico de los scripts actuales (verificado en `scripts/importation/`):

- `importTrafficData.js:361-372` usa `bulkWrite` con `updateOne + upsert: true` para los 24M registros, incluso cuando la BD esta vacia. Cada operacion fuerza un lookup por el indice unico antes de insertar.
- `importarCenso.js:48` usa `batchSize: 500`, demasiado pequeno para Mongo (mas roundtrips de los necesarios).
- Los 11 importadores corren en `Promise.all` en Fase 2 (`importAll.js:329-331`); los pesados pelean con los ligeros por la misma BD local.
- 9-16 indices secundarios vivos durante el insert: cada documento paga el coste de actualizar todos los arboles B.
- `logger.warn` por cada fila rechazada: con datos sucios pueden ser cientos de miles de logs por corrida.
- `maxPoolSize: 20` en `database.js:26`, comun para servidor y scripts.

## 2. Decision arquitectonica

Ataque al cuello de botella sin reorganizar la arquitectura ni anadir dependencias:

1. Drop de indices secundarios antes del import de las colecciones pesadas, recreate al final.
2. Cambio del importador de Trafico a `insertMany` puro cuando detecta BD vacia; mantiene el modo upsert para `--force`.
3. Subir batch sizes y aplicar `bypassDocumentValidation: true` a todos los bulk writes.
4. Reordenar Fase 2 del orquestador: ligeros en paralelo, pesados en serie.
5. Pool de conexiones ampliado en modo script.
6. Logging muestreado por tipo de rechazo, contadores agregados intactos.

Lo que NO toca este spec:
- Schemas de Mongoose (campos, validators, definiciones de indices).
- Funciones de transformacion (`validateAndTransformRow`, `parseCensusRow`, `parseMultaRow`, derivados).
- Controllers, middleware, sistema de cache de la API.
- Datos crudos en `datos_hpe/`.

## 3. Componentes

### 3.1 Helper nuevo: gestor de indices

**Archivo:** `scripts/importation/helpers/gestorIndices.js` (nuevo).

API:

```javascript
async function dropIndicesSecundarios(Modelo)
async function recrearIndicesSecundarios(Modelo)
async function listarIndicesSecundarios(Modelo)
```

Reglas:

- Fuente de verdad para decidir que dropear: estado **real** en la coleccion (`Modelo.collection.indexes()`), no el schema. El schema puede haber cambiado entre runs y un indice viejo en disco no estaria reflejado alli.
- Se dropean todos los indices reales **excepto**:
  - El indice automatico `_id_` (Mongo no permite borrarlo).
  - Cualquier indice cuyo spec real tenga `unique: true` (protege contra duplicados durante el insert).
- Drop con `Modelo.collection.dropIndex(name)`. Errores capturados con try/catch y logueados (siguen el flujo).
- Recreate con `Modelo.createIndexes()`, que aplica todos los del schema. Es idempotente: si ya existen no los recrea.
- Mongoose 9 elimino la opcion `background` (`docs/migrating_to_9.md`); no se usa en este helper.

### 3.2 Cambios en cada importador

**Comun a todos:**

- `bypassDocumentValidation: true` en cada `bulkWrite` y `insertMany`. La validacion ya se ejecuta en JS antes del envio.
- Logging muestreado: contador en memoria por proceso de importador. Por cada `REJECTION_REASON`, los primeros 10 rechazos vistos en esa ejecucion van a `logger.warn`, el resto a `logger.debug`. El `RejectionTracker` sigue contando todo y emite el resumen agregado al final. La cota es global del proceso, no por archivo CSV.

**`importTrafficData.js`:**

- Deteccion automatica de modo al iniciar:
  - `await Traffic.countDocuments() === 0` → modo `insertMany` puro.
  - Caso contrario o flag `--force` → modo `bulkWrite + updateOne+upsert` actual.
- En modo `insertMany`: opciones `{ ordered: false, lean: true, bypassDocumentValidation: true }`. Si una fila viola el unique `puntoMedidaId+fecha` (duplicado dentro del CSV) la operacion individual falla, pero el resto del lote prosigue por `ordered: false`. Los errores se cuentan como rechazos.
- `BATCH_SIZE`: 10.000 (sin cambio).
- `LOG_INTERVAL`: 100.000 → 500.000.

**`importarCenso.js`:**

- `batchSize`: 500 → **5.000**.
- Mantiene `insertOne` (modo skipExisting). El unique compuesto ya filtra duplicados.
- `bypassDocumentValidation: true` en bulkWrite.

**`importarMultas.js`:**

- `batchSize`: 5.000 → **10.000**.
- `bypassDocumentValidation: true` en bulkWrite.
- Resto intacto.

**Importadores ligeros** (`importAirQuality.js`, `importNoise.js`, `importarAccidentes.js`, `importarPatinetes.js`, `importarBicicletas.js`, `importarAforoBicicletas.js`, `importarContenedores.js`):

- Solo cambios comunes (`bypassDocumentValidation: true` + logging muestreado).
- No se tocan batch sizes ni estructura.

### 3.3 Orquestador `scripts/importAll.js`

Reordenacion en tres fases:

- **Fase 1** (sin cambio): `locations` secuencial, requisito de FK para el resto.
- **Fase 2** ("ligeros" en paralelo): `air`, `noise`, `contenedores`, `accidents`, `scooters`, `bikes`, `bike-traffic`. `Promise.all` igual que hoy.
- **Fase 3** ("pesados" en serie): `traffic` → `censo` → `multas`. Cada uno usa toda la BD secuencialmente.

Para cada importador en Fase 3 el orquestador ejecuta este patron (en el **proceso padre** `importAll.js`, no en el hijo):

```
try {
  await dropIndicesSecundarios(Modelo)
  await runImporter(...)            // proceso hijo, igual que ahora
} finally {
  await recrearIndicesSecundarios(Modelo)
}
```

Como el padre conserva su propia conexion a Mongo (independiente de la del proceso hijo), el `finally` se ejecuta aunque el hijo termine con error o sea matado por SIGTERM. Para Ctrl+C en el padre se anade un handler de SIGINT que llama al `recrearIndicesSecundarios` antes de cerrar la conexion y salir; sin ese handler `process.exit()` saltaria el `finally`. Si el `recreate` falla a su vez, el orquestador imprime el comando manual de recuperacion: `node scripts/importAll.js --rebuild-indices=traffic`.

Flags nuevas:

- `--skip-indices-management`: desactiva drop/recreate (comportamiento legacy).
- `--rebuild-indices=traffic[,censo,multas]`: ejecuta solo el recreate de los modelos indicados, sin importar datos. Util como recovery tras crash.

Flag `--force`: comportamiento intacto (mantiene upsert en Trafico). El drop/recreate de indices tambien se ejecuta en `--force` porque el coste de tener indices vivos durante 24M upserts es similar al de inserts.

### 3.4 `src/config/database.js`

```
maxPoolSize: process.env.SCRIPT_MODE === 'true' ? 50 : 20
```

Resto intacto. La API en runtime productivo se queda con 20 (no afecta el comportamiento operativo).

## 4. Flujo de datos

Caso normal (`node scripts/importAll.js` sobre BD vacia):

1. Conexion a Mongo con `maxPoolSize: 50`.
2. Fase 1: `locations` secuencial.
3. Fase 2: 7 importadores ligeros en paralelo (`Promise.all`).
4. Fase 3, paso 1 (`traffic`):
   1. `dropIndicesSecundarios(Traffic)` → quedan `_id_` y `traffic_unique_measurement`.
   2. Importador detecta `countDocuments() === 0` → modo `insertMany`.
   3. Lee 12 CSVs de `datos_hpe/Trafico/` con `MAX_PARALLEL = 3`, transforma, insertMany por lotes de 10.000.
   4. `recrearIndicesSecundarios(Traffic)` → recrea los 9 indices secundarios sobre la coleccion ya poblada.
5. Fase 3, paso 2 (`censo`): igual con drop/recreate, batch 5.000, `insertOne`.
6. Fase 3, paso 3 (`multas`): igual con drop/recreate, batch 10.000, `insertOne`.
7. Resumen final.

Caso `--force` (BD con datos previos): identico al normal, pero Trafico mantiene `bulkWrite + updateOne+upsert`. El drop/recreate sigue ejecutandose.

Caso recovery (`--rebuild-indices=traffic`): salta importacion, solo recrea indices.

## 5. Manejo de errores

| Escenario | Comportamiento |
|---|---|
| `dropIndex` falla (indice no existe) | Capturado con try/catch, log warn, sigue. |
| `dropIndicesSecundarios` falla globalmente | Aborta el flujo de esa coleccion antes de importar. Mensaje claro. |
| Importador falla a mitad del insert | Bloque `finally` del orquestador ejecuta `recrearIndicesSecundarios` (la conexion del padre sigue abierta). La coleccion queda con datos parciales pero con indices vivos. |
| Ctrl+C en el padre durante el insert | Handler SIGINT en `importAll.js` llama a `recrearIndicesSecundarios` y luego cierra Mongo y sale. |
| Ctrl+C en un proceso hijo (raro: requiere senalar al hijo directamente) | Hijo termina con error, `runImporter` resuelve con `success: false`, padre ejecuta el `finally` igualmente. |
| `recrearIndicesSecundarios` falla | Log de error explicito + comando manual de recuperacion. Exit code 1. |
| Duplicate key en `insertMany` | `ordered: false` permite que el resto del lote continue. El error individual se cuenta como rechazo. |

## 6. Compatibilidad y rollback

- Todos los cambios son aditivos sobre los importadores existentes; no se elimina codigo de transformacion ni se renombran APIs.
- Las flags `--force` y `--only` mantienen su contrato.
- Para volver al comportamiento legacy: `--skip-indices-management` + restaurar `batchSize` y `bulkWrite+upsert` mediante git revert de los archivos afectados.
- No hay migraciones de datos. La BD queda en el mismo estado logico tras la optimizacion.

## 7. Ganancia esperada

Estimaciones conservadoras basadas en el numero de operaciones evitadas:

- Drop/recreate de indices en Trafico: ~5-10x speedup en la fase de insert (24M ops sin actualizar 9 arboles B en cada una).
- Cambio a `insertMany` en Trafico: ~2-3x speedup adicional (sin lookup por unique en cada upsert).
- Subida de `batchSize` en Censo (500→5000): ~2x speedup (menos roundtrips).
- `bypassDocumentValidation` y logging muestreado: ganancia menor pero acumulativa, ~10-20%.

Total esperado: **3h → 30-50 min** en el primer import limpio. Si los numeros reales se quedan cortos, el plan de Opcion 2 (snapshot binario reusable) queda como evolucion posterior.

## 8. Documentacion afectada

- `CLAUDE.md`: actualizar la seccion "Import Process" con el nuevo orden de fases y la flag `--rebuild-indices`.
- `docs/`: anadir un bloque corto describiendo el gestor de indices y el comando de recovery (puede ir en `Optimization_Documentation.md` existente o en archivo nuevo, a criterio del implementador).

## 9. Notas colaterales (fuera de alcance)

- Los modelos de Mongoose definen 74 indices con `background: true`. Mongoose 9 elimino esa opcion (`docs/migrating_to_9.md`). Se ignora sin error pero conviene limpiarlo en una tarea aparte. NO bloquea esta optimizacion.
- Si en el futuro se quiere ir mas rapido (Opcion 2: snapshots binarios reusables), el helper de indices de este spec se reutiliza tal cual.
