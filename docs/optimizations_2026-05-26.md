# Auditoria de performance backend - 26 mayo 2026

Auditoria realizada con MongoDB MCP (`collection-indexes`, `explain executionStats`)
sobre la base local con datos completos del dataset Smart City 2051.

## Resumen ejecutivo

| Area | Estado | Accion sugerida |
|------|--------|-----------------|
| Indices | **44 indices redundantes** repartidos entre 4 colecciones grandes | Drops graduales tras revisar uso |
| TTL caches | Coherente (24h universal con SWR + L2 fallback) | Sin cambio |
| Connection pool | maxPoolSize 20 + minPoolSize 5 + monitor activo | `bufferCommands: false` en prod |
| Agregaciones pesadas | Usan `allowDiskUse` y `maxTimeMS` ya | Sin cambio |

## 1. Indices

### Tamano actual por coleccion

| Coleccion | Indices totales | Limite skill | Documentos | Storage |
|-----------|----------------|--------------|------------|---------|
| accidents | **34** | 20 | ~32K | 33 MB |
| fines | **27** | 20 | ~1.36M | 707 MB |
| censuses | **26** | 20 | ~? | 1.55 GB |
| traffic_measurements | **22** | 20 | ~? | 10.6 GB |

Cada indice consume RAM (debe caber en working set) y ralentiza INSERT/UPDATE
(write amplification). En `traffic_measurements` con 22 indices y 10.6 GB de
datos, esto puede impactar significativamente en re-imports.

### Patron de redundancia detectado

Validado con `explain executionStats`:
- En `accidents`, la query `{distrito, gravedad}` sort `{fecha:-1}` usa
  `ubicacion.nombreDistrito_1_fecha_-1` (compuesto). Los indices single-field
  sobre `ubicacion.nombreDistrito`, `circunstancias.gravedad`, `circunstancias.tipoAccidente`,
  etc. estan **cubiertos** por sus compuestos respectivos y nunca son la
  primera opcion del optimizer.
- En `fines`, la query `{año, mes, calificacion}` sort `{fecha:-1}` usa el
  compuesto `año_1_mes_1_calificacion_1`. Los single-field `año_1`, `mes_1`,
  `fecha_1`, `calificacion_1`, `lugar_1`, etc. son redundantes.

### Indices candidatos a drop (NO ejecutar sin revision)

**accidents** (drop ~11 indices, queda en ~23):
```
ubicacion.nombreDistrito_1     # cubierto por ubicacion.nombreDistrito_1_fecha_-1
circunstancias.gravedad_1       # cubierto por circunstancias.gravedad_1_fecha_-1
circunstancias.tipoAccidente_1  # cubierto por circunstancias.tipoAccidente_1_fecha_-1
vehiculo.tipo_1                 # cubierto por vehiculo.tipo_1_fecha_-1
numeroExpediente_1              # cubierto por numeroExpediente_1_fecha_-1
ubicacion.calle_1               # cubierto por ubicacion.calle_1_fecha_-1
franjaHoraria_1                 # cubierto por franjaHoraria_1_fecha_-1
mes_1                           # poco selectivo, cubierto por año_1_mes_1_dia_1
hora_1                          # poco selectivo
año_1                           # cubierto por año_1_mes_1_dia_1
fecha_1                         # cubierto por todos los compuestos con fecha
```

**fines** (drop ~10, queda en ~17):
```
mes_1, año_1, fecha_1, lugar_1, denunciante_1, tieneDescuento_1,
importeBoletín_1, calificacion_1, puntosDetraídos_1, hora_1
```

**censuses** (drop ~12, queda en ~14):
```
año_1, mes_1, edad_1, distrito.codigo_1, barrio.codigo_1,
seccionCensal.codigo_1, fechaCenso_1, barrio.descripcion_1,
distrito.descripcion_1, estadisticas.totalPoblacion_1,
seccionCensal.codigoDistritoSeccion_1, barrio.codigoDistritoBarrio_1
```

**traffic_measurements** (drop ~11, queda en ~11):
```
año_1, hora_1, mes_1, tipoElemento_1, metricas.intensidad_1,
analisis.nivelCongestion_1, puntoMedidaId_1, fecha_1,
analisis.periodoDia_1, analisis.clasificacionIntensidad_1,
analisis.tipoJornada_1
```

### Procedimiento sugerido (proxima iteracion)

1. Revisar query logs de produccion (si se llega a desplegar) durante 1-2 semanas
   con `db.setProfilingLevel(1, { slowms: 100 })` para confirmar que los indices
   single-field NO se usan en ninguna query real (incluyendo joins, sort, etc.).
2. Para cada indice candidato:
   - Quitar la linea correspondiente del schema Mongoose (`src/models/X.js`).
   - Ejecutar `db.collectionName.dropIndex('nombre_indice')` en MongoDB.
   - Verificar con explain que la query sigue usando el plan equivalente.
3. Reiniciar el servidor para que Mongoose no recree los indices al next sync.

**Riesgo**: si algun job de admin o agregacion ad-hoc usa un single-field, se
ralentizara tras el drop. Mitigacion: rollback rapido recreando el indice en
caliente (sin downtime).

## 2. Cache de aplicacion

### Configuracion actual

8 instancias de `node-cache` (ver [src/middleware/cache.js:39-49](../src/middleware/cache.js)):
- TTL: 24h universal
- maxKeys: 5K-50K segun volatilidad
- SWR con `STALE_GRACE_SECONDS=60` + revalidacion background si queda <20% TTL
- Thundering herd prevention via `pendingRequests` Map
- L2 fallback (`fallbackCache`) ante fallos de BD: sirve ultima respuesta
  conocida con header `X-Cache-Status: STALE_FALLBACK`

### Diagnostico

Apropiado para el perfil del dataset (estatico entre re-imports). El TTL de 24h
es razonable y SWR cubre la ventana de un re-import (1-2h). Cache warming
precalentaba 8 caches en 3-4s al arrancar el servidor.

**No se sugieren cambios.** Las invalidaciones manuales (cuando un controlador
de escritura propaga al cache) ya se hacen via `utils/cacheInvalidator.js`.

## 3. Connection pool

### Configuracion actual

Ver [src/config/database.js:54-79](../src/config/database.js):
- `maxPoolSize`: 20 (server), 50 (scripts)
- `minPoolSize`: 5 (pre-warm)
- `maxIdleTimeMS`: 60s
- `serverSelectionTimeoutMS`: 5s
- `socketTimeoutMS`: 60s (necesario para aggregations)
- `connectTimeoutMS`: 10s
- `heartbeatFrequencyMS`: 10s
- `appName`: distintivo server vs scripts
- `bufferCommands`: true (default Mongoose)

### Diagnostico

Apropiado para perfil OLTP + algunas OLAP segun skill `mongodb-connection`.
Con dataset de ~12M registros pero 1 instancia (`API-Anthem-server`) y 3 nodos
(replica set local de 1 = standalone), el calculo es:

```
1 instance × (20 + 2 monitoring) × 1 server = 22 conexiones max
```

Holgura suficiente para servidor local.

### Una sugerencia para futuro deploy

`bufferCommands: false` en produccion para fail-fast si MongoDB se cae, en
lugar de encolar queries hasta llenar memoria. En dev se mantiene true para
no romper hot-reload de nodemon mientras se reinicia MongoDB.

## 4. Agregaciones

Revisadas las llamadas a `aggregate()` en:
- [src/controllers/controladorAccidentes.js:125, 138, 421](../src/controllers/controladorAccidentes.js)
- [src/controllers/controladorAforoBicicletas.js:138](../src/controllers/controladorAforoBicicletas.js)
- Modelos con metodos estaticos en [src/models/](../src/models/)

Todas usan:
- `maxTimeMS: MONGODB_TIMEOUTS.AGGREGATE_TIMEOUT_MS` (timeout explicito)
- `allowDiskUse: true` en las pesadas (necesario para grupos grandes)
- `$limit` antes de `$group` donde aplica

Sin cambios sugeridos.

## 5. Items menores

- **Hallazgo Fase 0**: `/api/v1/ruido/ranking` y `/api/v1/ruido/tendencias/temporal`
  responden 200 pero la UI muestra estados vacios. Probable mismatch entre el
  shape del payload y el normalizador del frontend. Cargo en Fase 5
  (verificacion) o si urge mover al frontend.
- **Hallazgo Fase 0 (verificado)**: en `/accidentes`, "ACCIDENTES GRAVES: 0" y
  "MORTALES: 0" es **legitimo**, no es bug. Verificado con `db.accidents.count({"circunstancias.gravedad": "GRAVE"})` = 0 y
  `MORTAL` = 0. El dataset Smart City 2051 solo contiene accidentes `LEVE`
  (32421 documentos). La UI puede sugerir "Sin incidentes graves registrados
  este periodo" en lugar de un 0 a secas para que no parezca un bug de
  agregacion (mejora cosmetica para Fase 4).

## Conclusion

La Fase 2 no introduce cambios destructivos en BD ni codigo. Entrega:
1. Diagnostico documentado de los 44 indices redundantes (esperando revision
   del owner antes de drops graduales).
2. Confirmacion de que cache + pool + aggregations estan bien dimensionados.
3. Issues detectados en Fase 0 que requieren atencion en Fase 5.

La ganancia mayor potencial es la reduccion de indices: ~40% menos write
amplification en `traffic_measurements` y `fines`, las dos colecciones donde
mas impactan los re-imports.
