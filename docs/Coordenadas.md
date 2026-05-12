# Framework de Coordenadas

Este documento describe como se manejan las coordenadas geograficas en todos los modulos del proyecto. Existe un unico framework centralizado: `scripts/importation/helpers/coordenadas.js`.

## Resumen

El dataset de la Smart City mezcla varios formatos de coordenadas:

- **UTM ETRS89 zona 30N** (sistema oficial espanol, EPSG:25830) en metros (la mayoria de modulos).
- **UTM ETRS89 zona 30N** en *centimetros* (Contenedores, excepcion documentada en `dataset_information.md`).
- **WGS84 lat/lng** (EPSG:4326) directamente en algunos CSV.
- **GPX waypoints** que solo traen lat/lng en formato XML.

El framework unifica el parseo, valida rangos, normaliza unidades y construye geometrias GeoJSON RFC 7946 de forma consistente.

## Convencion interna del proyecto

Tras pasar por el framework, **todos los datos almacenados en MongoDB siguen estas reglas**:

| Campo | Tipo | Unidad / formato | Notas |
|---|---|---|---|
| `coordenadas.x` | Number | metros (UTM ETRS89 zona 30N) | Siempre en metros, aunque el CSV original viniera en cm |
| `coordenadas.y` | Number | metros | Idem |
| `geometry` (o `location`) | GeoJSON Point | `coordinates: [lon, lat]` en grados decimales WGS84 | Formato RFC 7946 estandar |

Esto permite que:
- Los validators de `coordinatesUTMSchema` (rangos en metros) funcionen para todos los modulos.
- Las queries `$near` / `$geoWithin` sobre indices `2dsphere` funcionen sin conversion.
- Los endpoints `/mapa` que devuelven `FeatureCollection` no necesiten transformaciones por modulo.

## Perfiles por modulo

Definidos en `helpers/coordenadas.js` como `PERFILES_COORDENADAS`. Cada perfil declara:

```js
{
  utm: {
    campos: { x: ['nombre1', 'nombre2'], y: ['nombre1', 'nombre2'] },
    unidades: 'm' | 'cm'
  },
  wgs84: {
    campos: { lon: [...], lat: [...] }
  } | null,
  fuentePrioritaria: 'wgs84' | 'utm',
  requerida: boolean
}
```

### Perfiles registrados

| Perfil | Campos UTM | Unidades UTM | Campos WGS84 | Prioridad | Requerida |
|---|---|---|---|---|---|
| `contenedores` | `COORDENADA X`, `COORDENADA Y` | **cm** (normaliza a m) | `LONGITUD`, `LATITUD` | WGS84 | si |
| `multas` | `COORDENADA_X`, `COORDENADA_Y` | m | n/a | UTM | no (radar fijo sin coords) |
| `accidentes` | `coordenada_x_utm`, `coordenada_y_utm` | m | n/a | UTM | no |
| `ubicaciones_estacion_acustica` | `Coordenada_X_ETRS89`, `Coordenada_Y_ETRS89` | m | `LONGITUD_WGS84`, `LATITUD_WGS84` | WGS84 | si |
| `ubicaciones_punto_trafico` | `utm_x`, `utm_y` | m | `longitud`, `latitud` | WGS84 | no (~92% del CSV es padding) |

Cada `campos.x` / `campos.y` es un array con nombres alternativos: el framework prueba en orden hasta encontrar un valor no vacio. Esto absorbe las inconsistencias de naming entre archivos del mismo dataset.

## API de uso

### En importers

```js
const { extraerCoordenadasModulo } = require('./helpers/coordenadas');

try {
  const coords = extraerCoordenadasModulo(row, 'multas');
  if (coords) {
    doc.coordenadas = coords.utm;       // {x, y} en metros, o null
    doc.location = coords.geometry;     // GeoJSON Point WGS84, o null
    // coords.advertencias contiene mensajes informativos (cross-check fallido, etc.)
  }
} catch (err) {
  // Solo lanza si el perfil tiene requerida=true y no se pudo extraer
  // err.code === 'COORDENADAS_FALTANTES'
}
```

### Anadir un nuevo modulo con coordenadas

1. Anadir entrada en `PERFILES_COORDENADAS` declarando los campos del CSV.
2. Llamar a `extraerCoordenadasModulo(row, 'mi_modulo')` en el importer.
3. Asegurarse de que el modelo tiene los campos `coordenadas` (UTM en metros) y `geometry` o `location` (GeoJSON Point).

No hay que tocar la logica de extraccion, validacion ni conversion: todo eso queda absorbido por el framework.

## Cross-check UTM vs WGS84

Cuando un CSV trae ambas representaciones (Contenedores, Ubicaciones), el framework cross-valida:

1. Convierte la UTM a WGS84 con proj4.
2. Compara con el WGS84 directo del CSV.
3. Si la diferencia excede `TOLERANCIA_DISCREPANCIA_GRADOS` (~0.01 grados, ~1.1 km), anade una advertencia al resultado.

Las advertencias no bloquean la importacion: el modulo decide en `coords.advertencias` que hacer (loggear como warn los primeros N, despues debug).

## Decisiones de diseno

### Por que normalizar Contenedores a metros internamente

El CSV documenta UTM en centimetros para Contenedores (ver `dataset_information.md`). Sin embargo, almacenarlo asi rompe:

- La validacion del schema (`coordinatesUTMSchema` espera metros).
- La comparacion con otros modulos (no se puede mezclar cm y m sin convertir).
- Los calculos de proximidad (`$near` espera radian/metros).

El framework convierte cm -> m al parsear (`x = x / 100`). El campo conserva `unidadOriginal: 'cm'` internamente pero se persiste en metros.

### Por que `fuentePrioritaria: 'wgs84'` cuando esta disponible

Convertir UTM a WGS84 con proj4 implica:

1. Coste de CPU en cada lectura.
2. Riesgo de error sistematico si el datum del CSV no fuera ETRS89 puro.

Si el CSV ya tiene lat/lng calculados por el productor del dato, son la fuente mas fiable. Solo se deriva via proj4 cuando el CSV no los provee.

### Por que aceptar valores 0 como invalidos

UTM real para Espana nunca es (0, 0). Algunos CSV usan (0, 0) como valor centinela para "sin datos". El framework los descarta para evitar coordenadas falsas en el mapa.

## Validacion en produccion

Pre-save hooks de los modelos (`Contenedor.js`, `Ubicacion.js`, etc.) tienen un cross-check defensivo: si las coordenadas UTM y la geometry GeoJSON no son coherentes (mas de 0.01 grados de diferencia), se loggea un warning sin bloquear el guardado. Esto detecta drift si alguien guarda manualmente un documento.

## Archivos relevantes

- `scripts/importation/helpers/coordenadas.js` - Framework principal.
- `scripts/importation/helpers/conversorCoordenadas.js` - Wrapper sobre proj4.
- `src/models/schemas/commonSchemas.js` - `coordinatesUTMSchema` con validators de rango.
- `src/utils/geoJsonHelper.js` - Construccion de FeatureCollection para endpoints `/mapa`.
- `dataset_information.md` - Documentacion del formato original de cada dataset.
