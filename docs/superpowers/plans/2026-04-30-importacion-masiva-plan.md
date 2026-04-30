# Aceleracion de Importacion Masiva - Plan de Implementacion

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reducir el tiempo del primer import limpio (`node scripts/importAll.js` con BD vacia) de ~3h a ~30-50 min, sin perder datos ni cambiar el modelo de dominio.

**Architecture:** Drop de indices secundarios antes del import de las colecciones pesadas (Trafico/Censo/Multas) y recreate al final; cambio de Trafico a `insertMany` puro cuando detecta BD vacia; subida de batch sizes; `bypassDocumentValidation` global; reordenacion de fases (ligeros en paralelo, pesados en serie); pool de conexiones ampliado en modo script; logging muestreado para evitar spam.

**Tech Stack:** Node.js v22, Mongoose 9.0.2, MongoDB local, Pino logger, csv-parser. Sin testing (decision del usuario - se verifica con ejecuciones controladas y `npm run lint`).

**Spec:** `docs/superpowers/specs/2026-04-30-importacion-masiva-design.md`

**Convencion de commits:** mensaje en espanol, sin `Co-Authored-By` de Claude (preferencia del usuario).

---

## Task 1: Helper gestorIndices.js

Crear el helper que dropea y recrea indices secundarios sobre cualquier modelo de Mongoose.

**Files:**
- Create: `scripts/importation/helpers/gestorIndices.js`

- [ ] **Step 1: Crear el helper**

Contenido completo del archivo:

```javascript
/**
 * Gestor de indices para importacion masiva
 *
 * Encapsula el drop y recreate de indices secundarios para acelerar la
 * insercion de grandes volumenes de datos. Mantener vivos los 9-16 indices
 * de las colecciones pesadas durante la insercion masiva multiplica el coste
 * de cada documento; es mas rapido dropearlos y recrearlos al final.
 *
 * Reglas:
 * - Fuente de verdad: estado real de la coleccion via collection.indexes(),
 *   no el schema (puede haber divergencia entre runs).
 * - Se conserva siempre _id_ y cualquier indice unique:true (protege contra
 *   duplicados durante el insert).
 * - Idempotente: errores de "indice no existe" se ignoran.
 */

'use strict';

/**
 * Listar indices secundarios reales de la coleccion
 * @param {mongoose.Model} Modelo
 * @returns {Promise<Array>} - Indices excluyendo _id_ y unique:true
 */
async function listarIndicesSecundarios(Modelo) {
  const indicesReales = await Modelo.collection.indexes();
  return indicesReales.filter(idx => idx.name !== '_id_' && idx.unique !== true);
}

/**
 * Dropear indices secundarios. _id_ y unique:true se conservan.
 * @param {mongoose.Model} Modelo
 * @param {Object} logger - Pino logger
 * @returns {Promise<Array>} - Nombres de los indices dropeados
 */
async function dropIndicesSecundarios(Modelo, logger) {
  const indicesADropear = await listarIndicesSecundarios(Modelo);

  if (indicesADropear.length === 0) {
    logger.info({ coleccion: Modelo.collection.name }, 'No hay indices secundarios que dropear');
    return [];
  }

  logger.info({
    coleccion: Modelo.collection.name,
    cantidad: indicesADropear.length,
    nombres: indicesADropear.map(i => i.name)
  }, 'Dropeando indices secundarios');

  const dropeados = [];
  for (const idx of indicesADropear) {
    try {
      await Modelo.collection.dropIndex(idx.name);
      dropeados.push(idx.name);
    } catch (error) {
      logger.warn({
        coleccion: Modelo.collection.name,
        indice: idx.name,
        error: error.message
      }, 'Error dropeando indice (se ignora y sigue)');
    }
  }

  logger.info({
    coleccion: Modelo.collection.name,
    dropeados: dropeados.length
  }, 'Indices secundarios dropeados');

  return dropeados;
}

/**
 * Recrear indices secundarios desde la definicion del schema.
 * Mongoose.createIndexes() es idempotente: ignora los que ya existen.
 *
 * @param {mongoose.Model} Modelo
 * @param {Object} logger - Pino logger
 * @returns {Promise<void>}
 */
async function recrearIndicesSecundarios(Modelo, logger) {
  const inicio = Date.now();
  logger.info({ coleccion: Modelo.collection.name }, 'Recreando indices secundarios');

  try {
    await Modelo.createIndexes();
  } catch (error) {
    logger.error({
      coleccion: Modelo.collection.name,
      error: error.message,
      stack: error.stack
    }, 'Error recreando indices secundarios');
    throw error;
  }

  const duracion = Date.now() - inicio;
  logger.info({
    coleccion: Modelo.collection.name,
    duracionMs: duracion
  }, 'Indices secundarios recreados');
}

module.exports = {
  listarIndicesSecundarios,
  dropIndicesSecundarios,
  recrearIndicesSecundarios
};
```

- [ ] **Step 2: Lint**

Run: `cd API-Anthem && npx eslint scripts/importation/helpers/gestorIndices.js`
Expected: sin errores ni warnings.

- [ ] **Step 3: Smoke test - listar indices reales**

Crear archivo temporal `_smoke_indices.js` en la raiz de `API-Anthem/`:

```javascript
process.env.SCRIPT_MODE = 'true';
const mongoose = require('mongoose');
const { connectDB } = require('./src/config/database');
const config = require('./src/config/config');
const Trafico = require('./src/models/Trafico');
const { listarIndicesSecundarios } = require('./scripts/importation/helpers/gestorIndices');

(async () => {
  await connectDB(config.database.uri);
  const indices = await listarIndicesSecundarios(Trafico);
  console.log('Indices secundarios de traffic_measurements:', indices.map(i => i.name));
  await mongoose.connection.close();
  process.exit(0);
})();
```

Run: `cd API-Anthem && node _smoke_indices.js`
Expected: imprime una lista de nombres de indices secundarios (no incluye `_id_` ni `traffic_unique_measurement` si esta marcado unique).

Borrar `_smoke_indices.js` despues de verificar.

- [ ] **Step 4: Commit**

```bash
cd API-Anthem
git add scripts/importation/helpers/gestorIndices.js
git commit -m "feat(import): anadir helper gestorIndices para drop/recreate de indices secundarios"
```

---

## Task 2: Refactor RejectionTracker con logging muestreado

Anadir un metodo `shouldLogWarn(reason)` que devuelve `true` solo las primeras 10 veces por razon. Permite usar `logger.warn` en los primeros casos (visibles) y `logger.debug` en el resto (silencioso por defecto).

**Files:**
- Modify: `scripts/importation/helpers/importHelpers.js`

- [ ] **Step 1: Anadir constante y metodo a RejectionTracker**

Editar `scripts/importation/helpers/importHelpers.js`. Cambiar la clase `RejectionTracker`:

```javascript
/** Maximo de warnings por tipo de rechazo antes de degradar a debug */
const MAX_WARN_POR_RAZON = 10;

class RejectionTracker {
  constructor() {
    this.stats = {};
    this.totalRejected = 0;
  }

  /**
   * Registrar un rechazo
   * @param {string} reason - Razon del rechazo (de REJECTION_REASONS)
   */
  track(reason) {
    if (!this.stats[reason]) {
      this.stats[reason] = 0;
    }
    this.stats[reason]++;
    this.totalRejected++;
  }

  /**
   * Decidir si esta razon debe loggearse como warn (primeras N veces) o
   * como debug (silencioso por defecto). Llama a track() internamente para
   * mantener el contador sincronizado.
   *
   * Uso tipico:
   *   const nivel = rejectionTracker.shouldLogWarn(reason) ? 'warn' : 'debug';
   *   logger[nivel]({ ... }, mensaje);
   *
   * @param {string} reason - Razon del rechazo
   * @returns {boolean} - true si debe ser warn, false si debe ser debug
   */
  shouldLogWarn(reason) {
    this.track(reason);
    return this.stats[reason] <= MAX_WARN_POR_RAZON;
  }

  getStats() {
    return {
      total: this.totalRejected,
      porTipo: { ...this.stats }
    };
  }

  getSortedSummary() {
    return Object.entries(this.stats)
      .sort((a, b) => b[1] - a[1])
      .map(([reason, count]) => ({
        razon: reason,
        cantidad: count,
        porcentaje: this.totalRejected > 0
          ? ((count / this.totalRejected) * 100).toFixed(2)
          : '0.00'
      }));
  }

  reset() {
    this.stats = {};
    this.totalRejected = 0;
  }
}
```

Y exportar la constante anadiendola al `module.exports` final del archivo:

```javascript
module.exports = {
  extractDateFromFileName,
  isValidMonthYear,
  RejectionTracker,
  MAX_WARN_POR_RAZON,
  parseNumber,
  parseInteger,
  cleanString,
  isValidUTMCoordinate,
  formatDuration,
  calculateProcessingSpeed
};
```

- [ ] **Step 2: Lint**

Run: `cd API-Anthem && npx eslint scripts/importation/helpers/importHelpers.js`
Expected: sin errores.

- [ ] **Step 3: Smoke test - validar metodo**

Crear `_smoke_tracker.js` temporal en la raiz de `API-Anthem/`:

```javascript
const { RejectionTracker } = require('./scripts/importation/helpers/importHelpers');
const t = new RejectionTracker();
let warnCount = 0;
for (let i = 0; i < 25; i++) {
  if (t.shouldLogWarn('TEST_REASON')) warnCount++;
}
console.log('warnCount:', warnCount, '(esperado: 10)');
console.log('total rejected:', t.totalRejected, '(esperado: 25)');
process.exit(warnCount === 10 && t.totalRejected === 25 ? 0 : 1);
```

Run: `cd API-Anthem && node _smoke_tracker.js`
Expected: `warnCount: 10 (esperado: 10)`, `total rejected: 25 (esperado: 25)`, exit code 0.

Borrar `_smoke_tracker.js`.

- [ ] **Step 4: Commit**

```bash
cd API-Anthem
git add scripts/importation/helpers/importHelpers.js
git commit -m "feat(import): muestreo de logging en RejectionTracker (primeras 10 ocurrencias por razon)"
```

---

## Task 3: Ampliar pool de conexiones en SCRIPT_MODE

`maxPoolSize` de 20 → 50 cuando `SCRIPT_MODE=true`. Servidor en runtime no se ve afectado.

**Files:**
- Modify: `src/config/database.js:24-35`

- [ ] **Step 1: Cambiar maxPoolSize**

Editar `src/config/database.js`. Reemplazar el bloque `const options = { ... }` actual por:

```javascript
    const esScriptMode = process.env.SCRIPT_MODE === 'true';
    const options = {
      // Configuraciones optimizadas de conexion para alto rendimiento
      maxPoolSize: esScriptMode ? 50 : 20, // Mas slots paralelos durante imports masivos
      minPoolSize: 5,
      maxIdleTimeMS: 60000,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 60000,

      // Configuraciones adicionales de performance
      connectTimeoutMS: 10000,
      heartbeatFrequencyMS: 10000,
    };
```

- [ ] **Step 2: Lint**

Run: `cd API-Anthem && npx eslint src/config/database.js`
Expected: sin errores.

- [ ] **Step 3: Smoke test - verificar log de conexion**

Run: `cd API-Anthem && SCRIPT_MODE=true node -e "const { connectDB } = require('./src/config/database'); const config = require('./src/config/config'); connectDB(config.database.uri).then(() => { console.log('OK'); process.exit(0); }).catch(e => { console.error(e); process.exit(1); });"`
Expected: el log de conexion debe incluir `"poolSize":50`.

- [ ] **Step 4: Commit**

```bash
cd API-Anthem
git add src/config/database.js
git commit -m "perf(db): ampliar maxPoolSize a 50 en SCRIPT_MODE para acelerar imports"
```

---

## Task 4: Optimizar importTrafficData.js

Aplicar deteccion automatica de modo (insertMany vs upsert), `bypassDocumentValidation`, logging muestreado y reduccion de `LOG_INTERVAL`.

**Files:**
- Modify: `scripts/importation/importTrafficData.js`

- [ ] **Step 1: Aumentar LOG_INTERVAL y anadir variable de modo**

Localizar la linea `const LOG_INTERVAL = 100000;` (alrededor de la linea 42) y reemplazarla:

```javascript
const LOG_INTERVAL = 500000;
```

Justo despues, anadir despues de las constantes de configuracion:

```javascript
// Modo de insercion: 'insert' (BD vacia, mas rapido) o 'upsert' (BD con datos o --force)
let modoInsercion = 'upsert';
```

- [ ] **Step 2: Reemplazar processBatch con logica dual**

Localizar la funcion `processBatch` (linea ~355). Reemplazar el cuerpo entero por:

```javascript
async function processBatch(batch) {
  if (batch.length === 0) {
    return { nuevos: 0, actualizados: 0, errores: 0 };
  }

  try {
    if (modoInsercion === 'insert') {
      // Modo insertMany: BD vacia, sin lookup por unique en cada documento
      const result = await Traffic.insertMany(batch, {
        ordered: false,
        lean: true,
        rawResult: true,
        bypassDocumentValidation: true
      });

      const nuevos = result.insertedCount || 0;
      totalInserted += nuevos;
      return { nuevos, actualizados: 0, errores: 0 };
    }

    // Modo upsert: BD con datos previos o --force
    const bulkOperations = batch.map(record => ({
      updateOne: {
        filter: {
          puntoMedidaId: record.puntoMedidaId,
          fecha: record.fecha
        },
        update: { $set: record },
        upsert: true
      }
    }));

    const result = await Traffic.bulkWrite(bulkOperations, {
      ordered: false,
      bypassDocumentValidation: true
    });

    const nuevos = result.upsertedCount || 0;
    const actualizados = result.modifiedCount || 0;
    totalInserted += nuevos;
    totalUpdated += actualizados;

    return { nuevos, actualizados, errores: 0 };

  } catch (error) {
    // En modo insertMany, ordered:false hace que algunos errores no aborten;
    // los exitosos quedan reflejados en error.result.insertedCount.
    if (modoInsercion === 'insert' && error.writeErrors) {
      const exitosos = (error.insertedDocs && error.insertedDocs.length) ||
                       (error.result && error.result.nInserted) ||
                       (batch.length - error.writeErrors.length);
      totalInserted += exitosos;
      totalErrors += error.writeErrors.length;
      return { nuevos: exitosos, actualizados: 0, errores: error.writeErrors.length };
    }

    const mongoError = handleMongoError(error);
    logger.error({
      error: mongoError.message,
      tipo: mongoError.type,
      loteSize: batch.length,
      modo: modoInsercion
    }, 'Error procesando lote de trafico');

    totalErrors += batch.length;
    return { nuevos: 0, actualizados: 0, errores: batch.length };
  }
}
```

- [ ] **Step 3: Detectar modo en main()**

Localizar `main()` (linea ~523). Justo despues de `await connectDB(...)` y antes de `await loadTrafficPoints()`, anadir la deteccion:

```javascript
    // Detectar modo de insercion automaticamente
    const forceMode = process.argv.includes('--force');
    const countActual = await Traffic.countDocuments().maxTimeMS(10000);
    modoInsercion = (countActual === 0 && !forceMode) ? 'insert' : 'upsert';

    logger.info({
      modo: modoInsercion,
      registrosExistentes: countActual.toLocaleString(),
      force: forceMode
    }, `Modo de insercion: ${modoInsercion}`);
```

Y eliminar la linea redundante posterior (`const countAntes = await Traffic.countDocuments()...`) reemplazandola por:

```javascript
    const countAntes = countActual;
```

- [ ] **Step 4: Aplicar logging muestreado en validateAndTransformRow**

En la funcion `validateAndTransformRow` (linea ~158), reemplazar cada `logger.warn({...}, '...')` por la version muestreada. Hay 6 ocurrencias en validaciones (lineas ~165, 175, 187, 198, 221).

Patron de reemplazo:

ANTES:
```javascript
    rejectionTracker.track(REJECTION_REASONS.ID_PUNTO_FALTANTE);
    logger.warn({
      fila: rowIndex,
      razon: REJECTION_REASONS.ID_PUNTO_FALTANTE,
      datosOriginales: { id: row.id }
    }, 'Fila rechazada: ID de punto faltante');
    throw new Error(REJECTION_REASONS.ID_PUNTO_FALTANTE);
```

DESPUES:
```javascript
    const razon = REJECTION_REASONS.ID_PUNTO_FALTANTE;
    const nivel = rejectionTracker.shouldLogWarn(razon) ? 'warn' : 'debug';
    logger[nivel]({
      fila: rowIndex,
      razon,
      datosOriginales: { id: row.id }
    }, 'Fila rechazada: ID de punto faltante');
    throw new Error(razon);
```

Aplicar el mismo patron a las otras 5 ocurrencias en la funcion (cada una con su `REJECTION_REASONS.X` y su `datosOriginales` correspondientes). El `rejectionTracker.track(...)` original se elimina porque `shouldLogWarn` ya hace `track` internamente.

- [ ] **Step 5: Lint**

Run: `cd API-Anthem && npx eslint scripts/importation/importTrafficData.js`
Expected: sin errores.

- [ ] **Step 6: Smoke test - dry run sintactico**

Run: `cd API-Anthem && node -c scripts/importation/importTrafficData.js`
Expected: sin output (sintaxis valida).

- [ ] **Step 7: Commit**

```bash
cd API-Anthem
git add scripts/importation/importTrafficData.js
git commit -m "perf(import-trafico): modo insertMany automatico, bypass validation, logging muestreado"
```

---

## Task 5: Optimizar importarCenso.js

Subir `batchSize` a 5.000, anadir `bypassDocumentValidation`, aplicar logging muestreado.

**Files:**
- Modify: `scripts/importation/importarCenso.js`

- [ ] **Step 1: Cambiar batchSize**

En `IMPORT_CONFIG` (linea ~45), cambiar:

```javascript
const IMPORT_CONFIG = {
  dataDirectory: path.join(__dirname, '..', '..', 'datos_hpe', 'Censo'),
  batchSize: 5000,
  skipExisting: true,
  logInterval: 50000,
  maxParallel: 3
};
```

(`batchSize: 500 → 5000`, `logInterval: 10000 → 50000`).

- [ ] **Step 2: Anadir bypassDocumentValidation a processBatchInsert**

Localizar `processBatchInsert` (linea ~515). Cambiar las opciones del `bulkWrite`:

```javascript
async function processBatchInsert(batch, stats) {
  const operations = batch.map(censusData => ({
    insertOne: { document: censusData }
  }));

  try {
    const result = await Censo.bulkWrite(operations, {
      ordered: false,
      bypassDocumentValidation: true
    });
    stats.insertedRecords += result.insertedCount || 0;
  } catch (bulkError) {
    processBulkWriteErrors(bulkError, batch, stats);

    if (bulkError.result) {
      stats.insertedRecords += bulkError.result.nInserted || 0;
    }
  }
}
```

Y en `processBatchUpsert` (linea ~542), anadir tambien `bypassDocumentValidation: true`:

```javascript
  const result = await Censo.bulkWrite(operations, {
    ordered: false,
    bypassDocumentValidation: true
  });
```

- [ ] **Step 3: Aplicar logging muestreado en parseCensusRow**

En `parseCensusRow` (linea ~213), reemplazar las 4 ocurrencias de `logger.warn` por la version muestreada (mismo patron que Task 4 Step 4).

Ejemplo del primer reemplazo:

ANTES:
```javascript
  if (!dateInfo) {
    rejectionTracker.track(REJECTION_REASONS.ARCHIVO_SIN_FECHA);
    logger.warn({
      fila: rowIndex,
      razon: REJECTION_REASONS.ARCHIVO_SIN_FECHA,
      datosOriginales: { archivo: sourceFile }
    }, 'Fila rechazada: no se pudo extraer fecha del archivo');
    return null;
  }
```

DESPUES:
```javascript
  if (!dateInfo) {
    const razon = REJECTION_REASONS.ARCHIVO_SIN_FECHA;
    const nivel = rejectionTracker.shouldLogWarn(razon) ? 'warn' : 'debug';
    logger[nivel]({
      fila: rowIndex,
      razon,
      datosOriginales: { archivo: sourceFile }
    }, 'Fila rechazada: no se pudo extraer fecha del archivo');
    return null;
  }
```

Repetir para las 3 ocurrencias restantes (POBLACION_CERO, CODIGO_DISTRITO_INVALIDO, EDAD_INVALIDA).

- [ ] **Step 4: Lint y dry run sintactico**

Run: `cd API-Anthem && npx eslint scripts/importation/importarCenso.js && node -c scripts/importation/importarCenso.js`
Expected: sin output.

- [ ] **Step 5: Commit**

```bash
cd API-Anthem
git add scripts/importation/importarCenso.js
git commit -m "perf(import-censo): batchSize 500->5000, bypass validation, logging muestreado"
```

---

## Task 6: Optimizar importarMultas.js

Subir `batchSize` a 10.000, anadir `bypassDocumentValidation`, logging muestreado.

**Files:**
- Modify: `scripts/importation/importarMultas.js`

- [ ] **Step 1: Cambiar batchSize**

En `IMPORT_CONFIG` (linea ~36), cambiar:

```javascript
const IMPORT_CONFIG = {
  dataDirectory: path.join(__dirname, '..', '..', 'datos_hpe', 'Multas'),
  batchSize: 10000,
  skipExisting: true,
  logInterval: 50000,
  maxParallel: 3
};
```

(`batchSize: 5000 → 10000`).

- [ ] **Step 2: Anadir bypassDocumentValidation**

En `processBatchInsert` (linea ~504), cambiar las opciones del `bulkWrite`:

```javascript
    const result = await Fine.bulkWrite(operations, {
      ordered: false,
      bypassDocumentValidation: true
    });
```

En `processBatchUpsert` (linea ~531) anadir lo mismo:

```javascript
    const result = await Fine.bulkWrite(operations, {
      ordered: false,
      bypassDocumentValidation: true
    });
```

- [ ] **Step 3: Aplicar logging muestreado en parseMultaRow**

En `parseMultaRow` (linea ~136), localizar las ocurrencias de `logger.warn` con `rejectionTracker.track(...)` (hay ~7: ARCHIVO_SIN_FECHA, COORDENADA_X_INVALIDA, COORDENADA_Y_INVALIDA, VELOCIDAD_LIMITE_INVALIDA, VELOCIDAD_CIRCULACION_INVALIDA, IMPORTE_NEGATIVO, PUNTOS_FUERA_RANGO, CALIFICACION_INVALIDA).

Aplicar el mismo patron de reemplazo de Task 4 Step 4 a cada una.

- [ ] **Step 4: Lint y dry run**

Run: `cd API-Anthem && npx eslint scripts/importation/importarMultas.js && node -c scripts/importation/importarMultas.js`
Expected: sin output.

- [ ] **Step 5: Commit**

```bash
cd API-Anthem
git add scripts/importation/importarMultas.js
git commit -m "perf(import-multas): batchSize 5000->10000, bypass validation, logging muestreado"
```

---

## Task 7: Aplicar bypassDocumentValidation y logging muestreado a importadores ligeros

Cambios uniformes en los 7 importadores ligeros: anadir `bypassDocumentValidation: true` a todos los `bulkWrite`/`insertMany` y aplicar logging muestreado en las funciones de parseo/validacion.

**Files:**
- Modify: `scripts/importation/importAirQuality.js`
- Modify: `scripts/importation/importNoise.js`
- Modify: `scripts/importation/importarAccidentes.js`
- Modify: `scripts/importation/importarPatinetes.js`
- Modify: `scripts/importation/importarBicicletas.js`
- Modify: `scripts/importation/importarAforoBicicletas.js`
- Modify: `scripts/importation/importarContenedores.js`

- [ ] **Step 1: Localizar y modificar bulkWrite/insertMany en cada archivo**

Para cada uno de los 7 importadores:

```bash
cd API-Anthem
grep -n "bulkWrite\|insertMany" scripts/importation/importAirQuality.js scripts/importation/importNoise.js scripts/importation/importarAccidentes.js scripts/importation/importarPatinetes.js scripts/importation/importarBicicletas.js scripts/importation/importarAforoBicicletas.js scripts/importation/importarContenedores.js
```

En cada llamada que tenga un objeto de opciones (segundo argumento), anadir `bypassDocumentValidation: true`. Si la llamada no tiene opciones, anadir el objeto.

Patron de reemplazo:

ANTES:
```javascript
await Modelo.bulkWrite(operations, { ordered: false });
```

DESPUES:
```javascript
await Modelo.bulkWrite(operations, { ordered: false, bypassDocumentValidation: true });
```

ANTES:
```javascript
await Modelo.insertMany(docs);
```

DESPUES:
```javascript
await Modelo.insertMany(docs, { ordered: false, bypassDocumentValidation: true });
```

- [ ] **Step 2: Aplicar logging muestreado en cada parser**

Para cada importador, localizar las llamadas `logger.warn({...}, 'Fila rechazada: ...')` que tienen un `rejectionTracker.track(...)` adyacente. Aplicar el patron de reemplazo de Task 4 Step 4.

Si algun importador no usa `RejectionTracker` o no tiene logs por fila rechazada, omitirlo.

```bash
cd API-Anthem
grep -nB1 "logger.warn" scripts/importation/importAirQuality.js scripts/importation/importNoise.js scripts/importation/importarAccidentes.js scripts/importation/importarPatinetes.js scripts/importation/importarBicicletas.js scripts/importation/importarAforoBicicletas.js scripts/importation/importarContenedores.js | grep -B1 "rejectionTracker.track"
```

- [ ] **Step 3: Lint y dry run de los 7 archivos**

```bash
cd API-Anthem
npx eslint scripts/importation/importAirQuality.js scripts/importation/importNoise.js scripts/importation/importarAccidentes.js scripts/importation/importarPatinetes.js scripts/importation/importarBicicletas.js scripts/importation/importarAforoBicicletas.js scripts/importation/importarContenedores.js
node -c scripts/importation/importAirQuality.js
node -c scripts/importation/importNoise.js
node -c scripts/importation/importarAccidentes.js
node -c scripts/importation/importarPatinetes.js
node -c scripts/importation/importarBicicletas.js
node -c scripts/importation/importarAforoBicicletas.js
node -c scripts/importation/importarContenedores.js
```

Expected: sin output / sin errores.

- [ ] **Step 4: Smoke test - ejecutar uno ligero sobre BD limpia**

Vaciar la coleccion de contenedores (la mas chica del set ligero, <50K docs) y reimportar:

```bash
cd API-Anthem
SCRIPT_MODE=true node -e "const m=require('mongoose'); const {connectDB}=require('./src/config/database'); const c=require('./src/config/config'); (async()=>{await connectDB(c.database.uri); await m.connection.db.collection('containers').deleteMany({}); console.log('Cleared'); await m.connection.close();})();"
node scripts/importation/importarContenedores.js
```

Expected: el importador termina sin errores; en el log no aparecen miles de `warn` por filas rechazadas (gracias al muestreo); el resumen final del `RejectionTracker` sigue mostrando los counts agregados.

- [ ] **Step 5: Commit**

```bash
cd API-Anthem
git add scripts/importation/importAirQuality.js scripts/importation/importNoise.js scripts/importation/importarAccidentes.js scripts/importation/importarPatinetes.js scripts/importation/importarBicicletas.js scripts/importation/importarAforoBicicletas.js scripts/importation/importarContenedores.js
git commit -m "perf(import): bypass validation y logging muestreado en importadores ligeros"
```

---

## Task 8: Reordenar fases en importAll.js

Separar Fase 2 actual en Fase 2 (ligeros, paralelo) y Fase 3 (pesados, secuencial). Aun sin hooks de indices (van en Task 9).

**Files:**
- Modify: `scripts/importAll.js`

- [ ] **Step 1: Marcar la fase de cada importador**

Editar el objeto `IMPORTERS` (linea ~40). Cambiar el campo `fase` de `traffic`, `censo`, `multas` de `2` a `3`. Resto se queda en `2`.

```javascript
  traffic: {
    script: 'importation/importTrafficData.js',
    nombre: 'Datos de Trafico',
    fase: 3,
    descripcion: 'Intensidad y carga de trafico por punto de medicion'
  },
  // ... el resto sin cambio salvo:
  censo: {
    script: 'importation/importarCenso.js',
    nombre: 'Censo',
    fase: 3,
    descripcion: 'Datos censales por seccion'
  },
  multas: {
    script: 'importation/importarMultas.js',
    nombre: 'Multas',
    fase: 3,
    descripcion: 'Datos de multas de trafico'
  },
```

- [ ] **Step 2: Reescribir la logica de orquestacion en main()**

Localizar el bloque que arranca con `// Fase 2: Datos independientes` (linea ~322). Reemplazar todo el bloque de Fase 2 hasta `process.exit(1)` final del catch por:

```javascript
  // Fase 2: Datos ligeros en paralelo (todos los del modelo de fase 2)
  const FASE_TIMEOUT_MS = 30 * 60 * 1000;
  const fase2 = importersToRun.filter(([, config]) => config.fase === 2);
  if (fase2.length > 0) {
    imprimir('\n--- Fase 2: Datos ligeros (paralelo) ---\n');

    const fase2Promise = Promise.all(
      fase2.map(([key, config]) => runImporter(key, config, options))
    );

    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(
        () => reject(new Error(`Timeout global de Fase 2 (${FASE_TIMEOUT_MS / 60000}min) alcanzado`)),
        FASE_TIMEOUT_MS
      )
    );

    try {
      const fase2Results = await Promise.race([fase2Promise, timeoutPromise]);
      for (const result of fase2Results) {
        results.push(result);
        imprimir(`  ${result.success ? '[OK]' : '[ERROR]'} ${result.nombre} (${result.duration})`);
      }
    } catch (error) {
      logger.error({ error: error.message }, 'Fase 2 abortada por timeout o error');
      imprimir(`\n  ERROR Fase 2: ${error.message}\n`);
      process.exit(1);
    }
  }

  // Fase 3: Datos pesados en serie (uno usa toda la BD)
  const fase3 = importersToRun.filter(([, config]) => config.fase === 3);
  if (fase3.length > 0) {
    imprimir('\n--- Fase 3: Datos pesados (secuencial) ---\n');

    for (const [key, config] of fase3) {
      const result = await runImporter(key, config, options);
      results.push(result);
      imprimir(`  ${result.success ? '[OK]' : '[ERROR]'} ${result.nombre} (${result.duration})`);
    }
  }
```

- [ ] **Step 3: Lint y dry run**

Run: `cd API-Anthem && npx eslint scripts/importAll.js && node -c scripts/importAll.js`
Expected: sin output.

- [ ] **Step 4: Smoke test - help y --only**

```bash
cd API-Anthem
node scripts/importAll.js --help
```
Expected: muestra ayuda con las nuevas fases (traffic/censo/multas con `Fase 3`).

```bash
node scripts/importAll.js --only=contenedores
```
Expected: ejecuta solo Fase 2 con contenedores. Funciona sin Fase 3.

- [ ] **Step 5: Commit**

```bash
cd API-Anthem
git add scripts/importAll.js
git commit -m "refactor(import): separar fase 2 ligeros (paralelo) de fase 3 pesados (secuencial)"
```

---

## Task 9: Hooks drop/recreate de indices en Fase 3

Anadir el patron `dropIndicesSecundarios` antes y `recrearIndicesSecundarios` despues de cada importador de Fase 3, con bloque `finally` y handler SIGINT.

**Files:**
- Modify: `scripts/importAll.js`

- [ ] **Step 1: Importar gestor de indices y modelos**

En la cabecera de `scripts/importAll.js`, justo despues de los `require` actuales, anadir:

```javascript
const mongoose = require('mongoose');
const { connectDB } = require('../src/config/database');
const config = require('../src/config/config');
const {
  dropIndicesSecundarios,
  recrearIndicesSecundarios
} = require('./importation/helpers/gestorIndices');

const Trafico = require('../src/models/Trafico');
const Censo = require('../src/models/Censo');
const Multa = require('../src/models/Multa');

const MODELOS_FASE3 = {
  traffic: Trafico,
  censo: Censo,
  multas: Multa
};
```

- [ ] **Step 2: Anadir conexion a Mongo en el padre**

Justo antes del bloque de `// Fase 1` en `main()`, anadir:

```javascript
  // El padre mantiene su propia conexion a Mongo para gestionar indices.
  // Los procesos hijos (importadores) abren la suya por separado.
  process.env.SCRIPT_MODE = 'true';
  await connectDB(config.database.uri);
```

Y al final de `main()`, antes del `if (fallidos > 0) { process.exit(1); }`, anadir el cierre:

```javascript
  // Cerrar conexion del padre
  if (mongoose.connection.readyState === 1) {
    await mongoose.connection.close();
  }
```

- [ ] **Step 3: Envolver cada importador de Fase 3 con drop/recreate**

Localizar el bloque de Fase 3 escrito en Task 8. Reemplazar el `for` interno por:

```javascript
    for (const [key, config] of fase3) {
      const Modelo = MODELOS_FASE3[key];

      if (!options.skipIndicesManagement && Modelo) {
        try {
          await dropIndicesSecundarios(Modelo, logger);
        } catch (error) {
          logger.error({
            importador: key,
            error: error.message
          }, 'Error dropeando indices, abortando esta coleccion');
          results.push({
            key,
            nombre: config.nombre,
            success: false,
            duration: '0s',
            error: `Error en drop de indices: ${error.message}`
          });
          continue;
        }
      }

      let result;
      try {
        result = await runImporter(key, config, options);
        results.push(result);
        imprimir(`  ${result.success ? '[OK]' : '[ERROR]'} ${result.nombre} (${result.duration})`);
      } finally {
        if (!options.skipIndicesManagement && Modelo) {
          try {
            await recrearIndicesSecundarios(Modelo, logger);
          } catch (error) {
            logger.error({
              importador: key,
              error: error.message
            }, `Error recreando indices. Recuperar manualmente: node scripts/importAll.js --rebuild-indices=${key}`);
            imprimirError(`\n  ERROR recreando indices de ${config.nombre}.`);
            imprimirError(`  Recuperar manualmente: node scripts/importAll.js --rebuild-indices=${key}\n`);
          }
        }
      }
    }
```

- [ ] **Step 4: Anadir handler de SIGINT**

Justo antes de `// Ejecutar` (linea final del archivo), anadir:

```javascript
// Handler de SIGINT en el padre: si el usuario hace Ctrl+C entre drop y recreate,
// intentamos recrear todos los indices de Fase 3 antes de salir para no dejar
// la BD sin indices secundarios.
let cerrandoPorSenal = false;
process.on('SIGINT', async () => {
  if (cerrandoPorSenal) {
    process.exit(130);
  }
  cerrandoPorSenal = true;

  imprimir('\n[SIGINT] Intentando recrear indices antes de salir...');

  for (const [key, Modelo] of Object.entries(MODELOS_FASE3)) {
    try {
      await recrearIndicesSecundarios(Modelo, logger);
    } catch (error) {
      logger.error({
        importador: key,
        error: error.message
      }, `Error recreando indices en SIGINT. Recuperar: node scripts/importAll.js --rebuild-indices=${key}`);
    }
  }

  if (mongoose.connection.readyState === 1) {
    await mongoose.connection.close();
  }
  process.exit(130);
});
```

- [ ] **Step 5: Lint y dry run**

Run: `cd API-Anthem && npx eslint scripts/importAll.js && node -c scripts/importAll.js`
Expected: sin output.

- [ ] **Step 6: Smoke test - drop y recreate manual sobre coleccion pequena**

Forzar un mini-flow apuntando a `traffic` pero sin importar (estaria dentro de Task 10). Aqui solo verificamos que el codigo se carga y conecta:

```bash
cd API-Anthem
node -e "process.env.SCRIPT_MODE='true'; const m=require('mongoose'); const {connectDB}=require('./src/config/database'); const c=require('./src/config/config'); const T=require('./src/models/Trafico'); const {listarIndicesSecundarios,dropIndicesSecundarios,recrearIndicesSecundarios}=require('./scripts/importation/helpers/gestorIndices'); const log=require('./src/config/logger').dbLogger; (async()=>{await connectDB(c.database.uri); console.log('Antes:',(await listarIndicesSecundarios(T)).length); await dropIndicesSecundarios(T,log); console.log('Tras drop:',(await listarIndicesSecundarios(T)).length); await recrearIndicesSecundarios(T,log); console.log('Tras recreate:',(await listarIndicesSecundarios(T)).length); await m.connection.close();})();"
```

Expected: imprime tres numeros. El primero >= 9 (indices originales de Trafico). El segundo es 0. El tercero igual al primero.

- [ ] **Step 7: Commit**

```bash
cd API-Anthem
git add scripts/importAll.js
git commit -m "feat(import): drop/recreate de indices en Fase 3 con handler SIGINT"
```

---

## Task 10: Flags --skip-indices-management y --rebuild-indices

**Files:**
- Modify: `scripts/importAll.js`

- [ ] **Step 1: Parsear las flags nuevas**

En `parseArguments()` (linea ~113), anadir:

```javascript
function parseArguments() {
  const args = process.argv.slice(2);
  const options = {
    force: false,
    only: null,
    showHelp: false,
    skipIndicesManagement: false,
    rebuildIndices: null
  };

  for (const arg of args) {
    if (arg === '--force') {
      options.force = true;
    } else if (arg.startsWith('--only=')) {
      options.only = arg.replace('--only=', '').split(',').map(s => s.trim());
    } else if (arg === '--help') {
      options.showHelp = true;
    } else if (arg === '--skip-indices-management') {
      options.skipIndicesManagement = true;
    } else if (arg.startsWith('--rebuild-indices=')) {
      options.rebuildIndices = arg.replace('--rebuild-indices=', '').split(',').map(s => s.trim());
    }
  }

  return options;
}
```

- [ ] **Step 2: Anadir las flags a la ayuda**

En `showHelp()` (linea ~137), reemplazar el bloque de "Opciones" por:

```javascript
  imprimir(`
Script Maestro de Importacion de Datos - Smart City Anthem 2051

Uso: node scripts/importAll.js [opciones]

Opciones:
  --force                       Forzar sobrescritura de datos existentes
  --only=x,y,z                  Ejecutar solo importadores especificos
  --skip-indices-management     No dropear/recrear indices en Fase 3 (legacy)
  --rebuild-indices=x[,y,z]     Solo recrear indices (sin importar). Recovery tras crash.
                                Valores: traffic, censo, multas
  --help                        Mostrar esta ayuda

Importadores disponibles:`);
```

- [ ] **Step 3: Implementar el modo --rebuild-indices**

Al inicio de `main()`, justo despues de `parseArguments()` y `if (options.showHelp) { showHelp(); return; }`, anadir:

```javascript
  // Modo recovery: solo recrear indices, sin importar
  if (options.rebuildIndices) {
    process.env.SCRIPT_MODE = 'true';
    await connectDB(config.database.uri);

    const colecciones = options.rebuildIndices.filter(k => MODELOS_FASE3[k]);
    const invalidas = options.rebuildIndices.filter(k => !MODELOS_FASE3[k]);

    if (invalidas.length > 0) {
      imprimirError(`Modelos no reconocidos para rebuild-indices: ${invalidas.join(', ')}`);
      imprimirError(`Validos: ${Object.keys(MODELOS_FASE3).join(', ')}`);
      process.exit(1);
    }

    imprimir(`\n=== Rebuild de indices: ${colecciones.join(', ')} ===\n`);
    let huboError = false;
    for (const key of colecciones) {
      try {
        await recrearIndicesSecundarios(MODELOS_FASE3[key], logger);
        imprimir(`  [OK] ${key}`);
      } catch (error) {
        imprimirError(`  [ERROR] ${key}: ${error.message}`);
        huboError = true;
      }
    }

    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.close();
    }
    process.exit(huboError ? 1 : 0);
  }
```

- [ ] **Step 4: Conectar `options.skipIndicesManagement` con el bloque de Task 9**

El bloque de Fase 3 escrito en Task 9 ya consulta `options.skipIndicesManagement`. Verificar grep:

```bash
cd API-Anthem
grep -n "skipIndicesManagement" scripts/importAll.js
```
Expected: aparece en `parseArguments` y al menos en dos sitios del bloque de Fase 3.

- [ ] **Step 5: Lint y dry run**

Run: `cd API-Anthem && npx eslint scripts/importAll.js && node -c scripts/importAll.js`
Expected: sin output.

- [ ] **Step 6: Smoke test - --help y --rebuild-indices**

```bash
cd API-Anthem
node scripts/importAll.js --help
```
Expected: la ayuda incluye `--skip-indices-management` y `--rebuild-indices`.

```bash
node scripts/importAll.js --rebuild-indices=multas
```
Expected: ejecuta solo el recreate de indices de multas y sale con codigo 0. No importa datos.

- [ ] **Step 7: Commit**

```bash
cd API-Anthem
git add scripts/importAll.js
git commit -m "feat(import): flags --skip-indices-management y --rebuild-indices para control y recovery"
```

---

## Task 11: Documentacion

Actualizar `CLAUDE.md` con el nuevo flujo de fases y anadir un bloque al `Optimization_Documentation.md`.

**Files:**
- Modify: `CLAUDE.md` (raiz del repo)
- Modify: `API-Anthem/docs/Optimization_Documentation.md`

- [ ] **Step 1: Actualizar CLAUDE.md**

Localizar la seccion `### Import Process` (aproximadamente bajo `## Data`). Reemplazar el bloque por:

```markdown
### Import Process

- Script principal: `scripts/importAll.js`
- 11 importadores individuales en `scripts/importation/`
- Validacion de datos en los schemas del modelo
- Procesamiento por fases:
  - **Fase 1** (secuencial): `locations` (datos de referencia)
  - **Fase 2** (paralelo): importadores ligeros (<300K docs c/u)
  - **Fase 3** (secuencial): importadores pesados (`traffic`, `censo`, `multas`). Cada uno
    dropea sus indices secundarios antes del insert y los recrea al final.
- Trafico detecta automaticamente si la BD esta vacia y usa `insertMany` puro
  (mas rapido que upsert).
- Manejo de errores y logging muestreado durante importacion (primeros 10 warns
  por tipo, resto en debug).

**Flags utiles:**

- `--force`: sobrescribir datos existentes (modo upsert).
- `--only=x,y,z`: ejecutar solo importadores especificos.
- `--skip-indices-management`: desactivar drop/recreate de indices (comportamiento legacy).
- `--rebuild-indices=traffic[,censo,multas]`: recovery — solo recrear indices, sin importar.
  Util si el script crashea entre drop e import y la BD queda sin indices secundarios.
```

- [ ] **Step 2: Anadir bloque al Optimization_Documentation.md**

Anadir al final de `API-Anthem/docs/Optimization_Documentation.md` (o como nueva seccion):

```markdown

## Optimizacion de la Importacion Masiva

### Estrategia

El primer import limpio se redujo de ~3h a ~30-50 min mediante:

1. **Drop/recreate de indices secundarios** en Trafico, Censo y Multas alrededor del bloque
   de inserts. Mantener vivos 9-16 indices durante 24M inserts multiplica el coste por
   documento; es mas rapido reconstruirlos al final con `Modelo.createIndexes()`.
2. **Modo `insertMany` puro en Trafico** cuando la BD esta vacia (deteccion automatica).
   Evita el lookup por unique index que cada `bulkWrite + updateOne+upsert` realiza.
3. **`bypassDocumentValidation: true`** en todos los `bulkWrite`/`insertMany`. La validacion
   ya se hace en JS antes del envio (`validateAndTransformRow`, `parseCensusRow`, etc.).
4. **Batch sizes ampliados**: Censo 500→5000, Multas 5000→10000.
5. **Reordenacion de fases**: ligeros en paralelo (Fase 2), pesados en serie (Fase 3).
   Antes los pesados peleaban entre si por la misma BD local.
6. **Logging muestreado**: primeros 10 warns por tipo de rechazo, el resto en debug.
   Evita spam de cientos de miles de logs en datasets con datos sucios.
7. **Pool de conexiones ampliado** (`maxPoolSize: 50` en `SCRIPT_MODE`).

### Flujo de un import pesado

```
para cada importador en [traffic, censo, multas]:
  drop indices secundarios (conserva _id_ y unique:true)
  ejecutar importador
  recrear indices secundarios (Modelo.createIndexes())
```

Si el script crashea o se interrumpe (Ctrl+C), un handler SIGINT en el padre
intenta recrear los indices antes de salir. Como red de seguridad adicional,
`node scripts/importAll.js --rebuild-indices=traffic[,censo,multas]` permite
recrear indices manualmente sin volver a importar.

### Spec y plan

- Spec: `docs/superpowers/specs/2026-04-30-importacion-masiva-design.md`
- Plan: `docs/superpowers/plans/2026-04-30-importacion-masiva-plan.md`
```

- [ ] **Step 3: Verificar que los archivos compilan en markdown**

Run: `cd API-Anthem && grep -c "^## " docs/Optimization_Documentation.md`
Expected: numero de secciones (aumentado en 1).

- [ ] **Step 4: Commit**

`CLAUDE.md` esta en la raiz `Practica/`, fuera del repo `API-Anthem/`. Solo se commitea
el cambio de `docs/Optimization_Documentation.md`. La actualizacion de `CLAUDE.md` queda
en el workspace pero sin commit (es archivo de instrucciones del workspace de Claude Code).

```bash
cd API-Anthem
git add docs/Optimization_Documentation.md
git commit -m "docs(import): documentar nuevo flujo de fases y flags de gestion de indices"
```

---

## Verificacion final (ejecucion controlada del flujo completo)

Tras completar las 11 tareas, ejecutar el flujo end-to-end con Tracking de tiempos:

- [ ] **Step F1: Vaciar la BD y reimportar todo**

```bash
cd API-Anthem
SCRIPT_MODE=true node -e "const m=require('mongoose'); const {connectDB}=require('./src/config/database'); const c=require('./src/config/config'); (async()=>{await connectDB(c.database.uri); await m.connection.db.dropDatabase(); console.log('DB dropped'); await m.connection.close();})();"

time node scripts/importAll.js
```

Expected: termina con todos los importadores en `[OK]`. Duracion total < 1h (objetivo: 30-50 min).

- [ ] **Step F2: Verificar conteos finales**

```bash
SCRIPT_MODE=true node -e "const m=require('mongoose'); const {connectDB}=require('./src/config/database'); const c=require('./src/config/config'); (async()=>{await connectDB(c.database.uri); const cols=['traffic_measurements','census','fines','bike_traffic_counts','locations','air_quality_measurements','noise_measurements','accidents','scooter_assignments','bike_availabilities','containers']; for (const col of cols) { const n=await m.connection.db.collection(col).countDocuments(); console.log(col+': '+n.toLocaleString()); } await m.connection.close();})();"
```

Expected: trafico ~24M, census ~2.7M, fines ~2M, bike_traffic_counts ~293K, resto <100K.

- [ ] **Step F3: Verificar que los indices estan recreados**

```bash
SCRIPT_MODE=true node -e "const m=require('mongoose'); const {connectDB}=require('./src/config/database'); const c=require('./src/config/config'); const {listarIndicesSecundarios}=require('./scripts/importation/helpers/gestorIndices'); const T=require('./src/models/Trafico'); const C=require('./src/models/Censo'); const Mu=require('./src/models/Multa'); (async()=>{await connectDB(c.database.uri); console.log('Trafico:',(await listarIndicesSecundarios(T)).length); console.log('Censo:',(await listarIndicesSecundarios(C)).length); console.log('Multa:',(await listarIndicesSecundarios(Mu)).length); await m.connection.close();})();"
```

Expected: Trafico >= 8, Censo >= 12, Multa >= 15 (los conteos exactos dependen de cuales sean unique).

- [ ] **Step F4: Smoke test de la API**

```bash
cd API-Anthem
npm start &
sleep 5
curl -s http://localhost:3000/api/v1/trafico?limit=1 | head -c 500
curl -s http://localhost:3000/api/v1/censo?limit=1 | head -c 500
curl -s http://localhost:3000/api/v1/multas?limit=1 | head -c 500
kill %1
```

Expected: cada endpoint devuelve un objeto con `success: true` y `data` no vacio.

- [ ] **Step F5: Anotar el tiempo en el commit final**

Si la duracion real bajo de las 3h pero quedo por encima de 50 min, anotar en el commit final el numero real para evaluar si es necesario pasar a Opcion 2 (snapshots binarios).

```bash
cd API-Anthem
git log --oneline | head -15
```

Expected: 11 commits del plan en orden.

---

## Notas finales

- Este plan es Opcion 1 del spec. Si tras la verificacion final el tiempo sigue siendo
  inaceptable, hay que volver al spec y considerar Opcion 2 (snapshot binario reusable
  con `mongoimport`).
- Los 74 `background: true` en los schemas de Mongoose son notados pero fuera de alcance
  de este plan. Se pueden limpiar en una tarea aparte.
- Convencion: commits sin `Co-Authored-By` (preferencia del usuario).
