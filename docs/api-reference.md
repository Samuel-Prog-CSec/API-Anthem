# API Reference — Anthem Smart City v1.0.0

Referencia funcional de todos los endpoints de la API REST de Anthem.

- **Base URL desarrollo**: `http://localhost:3000/api/v1`
- **Versionado**: prefijo `/api/v1` (URL versioning)
- **Estructura de respuesta estandar**:
  ```json
  {
    "success": true,
    "message": "...",
    "version": "1.0.0",
    "timestamp": "2051-...",
    "data": { ... },
    "pagination": { ... }
  }
  ```
- **Paginacion**:
  - Modo **offset** (default): `{ currentPage, totalPages, totalDocuments, documentsPerPage, hasNextPage, hasPrevPage, nextPage, prevPage }`
  - Modo **cursor** (selectos endpoints): `{ mode: 'cursor', limit, hasNextPage, nextCursor }`
- **Autenticacion**: JWT con access token en cookie httpOnly + refresh token rotation
- **Rate limiting**: general 100/15min, auth 5/15min, heavy 5/5min
- **Codigos de estado**:
  - `200` OK, `201` Created, `204` No Content
  - `400` Bad Request (validacion), `401` Unauthorized, `403` Forbidden, `404` Not Found
  - `422` Unprocessable Entity (reservado), `429` Too Many Requests, `500` Internal Server Error

---

## Tabla de contenidos

- [Auth (`/auth`)](#auth)
- [Admin (`/admin`)](#admin)
- [Ubicaciones (`/ubicaciones`)](#ubicaciones)
- [Calidad del aire (`/calidad-aire`)](#calidad-aire)
- [Ruido (`/ruido`)](#ruido)
- [Accidentes (`/accidentes`)](#accidentes)
- [Bicicletas (`/bicicletas`)](#bicicletas)
- [Aforo de bicicletas (`/aforo-bicicletas`)](#aforo-bicicletas)
- [Censo (`/censo`)](#censo)
- [Contenedores (`/contenedores`)](#contenedores)
- [Multas (`/multas`)](#multas)
- [Patinetes (`/patinetes`)](#patinetes)
- [Trafico (`/trafico`)](#trafico)

---

## Auth

Base path: `/api/v1/auth`. Rate limit estricto `authLimiter` (5 req/15min).

| Metodo | Ruta | Auth | Descripcion |
|--------|------|------|-------------|
| POST | `/register` | publico | Registrar nuevo usuario |
| POST | `/login` | publico | Iniciar sesion |
| POST | `/refresh` | refresh-token | Renovar access token con rotacion |
| POST | `/logout` | authenticate | Cerrar sesion (revoca refresh token) |
| GET | `/me` | authenticate | Obtener perfil del usuario actual |
| GET | `/verify-token` | authenticate | Validar token actual |
| PUT | `/change-password` | authenticate | Cambiar contrasena |

### `POST /auth/register`
**Body:** `{ username, email, password }`. Password: ≥8 chars, mayuscula, minuscula, numero, caracter especial.
**Responses:** `201` (creado + cookies set), `400` (validation), `409` (email/username duplicado), `429`.

### `POST /auth/login`
**Body:** `{ identifier, password }` (`identifier` = email o username).
**Responses:** `200` (set cookies httpOnly + body con datos), `401` (credenciales o cuenta bloqueada), `429`.

### `POST /auth/refresh`
**Body:** `{ refreshToken }` o cookie automatica.
**Responses:** `200` (nuevo accessToken + nuevo refreshToken rotado), `401` (token invalido/expirado/blacklisted).

### `POST /auth/logout`, `GET /auth/me`, `GET /auth/verify-token`, `PUT /auth/change-password`
Comportamientos estandar. `change-password` requiere `{ currentPassword, newPassword }` y revoca tokens previos via `passwordChangedAt`.

---

## Admin

Base path: `/api/v1/admin`. Todos los endpoints con `authenticate + adminOnly`.

| Metodo | Ruta | Descripcion |
|--------|------|-------------|
| GET | `/cache/stats` | Estadisticas de los 8 cachess en memoria (hit rate, keys, size) |
| DELETE | `/cache/clear?type=&pattern=` | Limpiar cache (todo o filtrado por tipo/patron) |
| GET | `/system/health` | Salud del sistema (DB ping latency, memoria, hit rate global, issues) |
| GET | `/performance/stats` | Estadisticas de latencia por endpoint |
| GET | `/etag/stats` | Estadisticas de ETags (hits 304, misses) |

---

## Ubicaciones

Base path: `/api/v1/ubicaciones`. Rate limit permisivo (`generalLimiter * 3`) por ser consultas ligeras de datos estaticos.

| Metodo | Ruta | Auth | Descripcion |
|--------|------|------|-------------|
| GET | `/` | authenticate | Listar ubicaciones con filtros y bbox |
| GET | `/puntos-medicion/:measurementType` | authenticate | Puntos de medicion por tipo (acustica, trafico) |
| GET | `/transporte/:transportType` | authenticate | Rutas de transporte publico |
| GET | `/mapa` | authenticate | FeatureCollection GeoJSON con estaciones + rutas |

**Query params comunes:** `type` (LOCATION_TYPES), `distrito` (1-21), `nombre`, `limit`, `page`, `bbox` (minLng,minLat,maxLng,maxLat), `near` (lng,lat,radioMetros).

---

## Calidad del aire

Base path: `/api/v1/calidad-aire`. Rate limit normal + `heavyQueryLimiter` para estadisticas/tendencias.

| Metodo | Ruta | Descripcion |
|--------|------|-------------|
| GET | `/` | Listado de mediciones con filtros y paginacion |
| GET | `/estadisticas` | Estadisticas agregadas (groupBy: HOUR/DAY/MONTH/STATION) |
| GET | `/tendencias` | Tendencias temporales por contaminante |

**Filtros (todos GET):** `startDate`, `endDate`, `provincia` (cod), `municipio` (cod), `estacion` (cod), `magnitud` (cod contaminante), `page`, `limit`, `sortBy`, `sortOrder`, `includeInvalid`.

---

## Ruido

Base path: `/api/v1/ruido`. Rate limit personalizado `noiseDataLimiter`/`noiseStatisticsLimiter`.

| Metodo | Ruta | Descripcion |
|--------|------|-------------|
| GET | `/` | Datos de contaminacion acustica con filtros |
| GET | `/estadisticas` | Estadisticas + cumplimiento normativo (groupBy: station/month/year) |
| GET | `/ranking` | Ranking de estaciones por nivel |
| GET | `/cumplimiento/zona` | Cumplimiento normativo por zona (umbrales legales dB) |
| GET | `/tendencias/temporal` | Tendencias temporales (groupBy: day/month/year) |
| GET | `/mapa` | FeatureCollection con niveles promedio por estacion |

**Niveles agregados:** `laeq24`, `nivelDiurno`, `nivelVespertino`, `nivelNocturno`.

---

## Accidentes

Base path: `/api/v1/accidentes`. Rate limit `generalLimit` con bypass para admin.

| Metodo | Ruta | Descripcion |
|--------|------|-------------|
| GET | `/` | Listado con filtros (gravedad, tipoAccidente, distrito, fecha) |
| GET | `/expediente/:numero` | Detalle por numero de expediente |
| GET | `/estadisticas` | Estadisticas por periodo y distrito (cap 365 dias) |
| GET | `/comparativa-distritos` | Comparativa entre distritos |
| GET | `/mapa-calor` | Datos agrupados para heatmap (precision 50-500m) |
| GET | `/mapa` | FeatureCollection GeoJSON con accidentes georreferenciados |

**Paginacion:** soporta modo offset y cursor.

---

## Bicicletas

Base path: `/api/v1/bicicletas`. Datos de disponibilidad de bicicletas electricas BiciMAD.

| Metodo | Ruta | Descripcion |
|--------|------|-------------|
| GET | `/` | Disponibilidad con filtros |
| GET | `/estadisticas` | Estadisticas generales |
| GET | `/tendencias/mensual` | Tendencias por mes y año (`year`) |
| GET | `/mayor-uso` | Top N dias con mayor uso (`limit`) |
| GET | `/comparativa-suscripciones` | Comparativa por tipo de abonado |

---

## Aforo de bicicletas

Base path: `/api/v1/aforo-bicicletas`. Conteo de trafico ciclista por estacion.

| Metodo | Ruta | Descripcion |
|--------|------|-------------|
| GET | `/` | Conteos con filtros (identificador, distrito, hora) |
| GET | `/estadisticas` | Estadisticas generales |
| GET | `/distribucion-horaria` | Distribucion por franja horaria |
| GET | `/estaciones` | Ranking de estaciones (`limit`) |
| GET | `/tendencias/diario` | Tendencias diarias |
| GET | `/estacion/:identificador` | Datos detallados de una estacion |
| GET | `/mapa` | FeatureCollection con estaciones y volumen agregado |

---

## Censo

Base path: `/api/v1/censo`. Datos demograficos (poblacion total, extranjeros, grupos de edad).

| Metodo | Ruta | Descripcion |
|--------|------|-------------|
| GET | `/` | Datos de censo con filtros demograficos (distrito, barrio, grupoEdad, minEdad, maxEdad) |
| GET | `/piramide` | Piramide poblacional por año y distrito |
| GET | `/distritos/estadisticas` | Estadisticas por distritos (opcional incluirBarrios) |
| GET | `/analisis/demografico` | Analisis demografico completo (tipoAnalisis: completo/edad/nacionalidad/genero) |
| GET | `/evolucion` | Evolucion temporal (metrica: poblacionTotal/extranjeros/productiva) |
| GET | `/dashboard` | Metricas del dashboard demografico |
| GET | `/distritos/resumen` | Resumen ligero de distritos con poblacion total |

---

## Contenedores

Base path: `/api/v1/contenedores`. Ubicacion de contenedores de residuos.

| Metodo | Ruta | Descripcion |
|--------|------|-------------|
| GET | `/` | Listado con filtros |
| GET | `/cercanos` | Contenedores cercanos a coordenada (geoespacial) |
| GET | `/estadisticas` | Estadisticas generales |
| GET | `/estadisticas/distrito` | Estadisticas por distrito |
| GET | `/estadisticas/barrio` | Estadisticas por barrio (requiere `distrito`) |
| GET | `/conteo-por-tipo` | Conteo por tipo de contenedor |
| GET | `/distritos` | Lista de distritos unicos |
| GET | `/barrios/:distrito` | Barrios de un distrito |
| GET | `/buscar?q=` | Busqueda por direccion (min 3 chars) |
| GET | `/mapa-calor` | Datos para heatmap |
| GET | `/cobertura` | Analisis de cobertura |
| GET | `/mapa` | FeatureCollection GeoJSON (bbox, lote 1-3) |
| GET | `/analisis/densidad` | Analisis de densidad por distrito |

---

## Multas

Base path: `/api/v1/multas`. Multas de trafico.

| Metodo | Ruta | Descripcion |
|--------|------|-------------|
| GET | `/` | Listado con filtros (calificacion, lugar, tipoInfraccion, denunciante, rango importe/puntos) |
| GET | `/estadisticas` | Estadisticas agregadas (groupBy: day/month/year/type/location/severity) |
| GET | `/ubicaciones/ranking` | Top N ubicaciones con mas multas |
| GET | `/analisis/temporal` | Analisis temporal (granularity: day/week/month/year) |
| GET | `/dashboard` | Metricas del dashboard (periodo: 7days/30days/90days/year) |
| GET | `/mapa` | FeatureCollection GeoJSON con multas georreferenciadas |
| GET | `/:id` | Detalle de una multa por ObjectId |

**Optimizaciones:** `executeFacetPagination` con `statsPipeline` integrado (data + count + stats en una sola roundtrip).

---

## Patinetes

Base path: `/api/v1/patinetes`. Asignacion de patinetes electricos por distrito.

| Metodo | Ruta | Descripcion |
|--------|------|-------------|
| GET | `/` | Asignaciones con filtros (distrito, barrio, tipoZona, densidad, demanda, concentracion, proveedor) |
| GET | `/estadisticas/distritos` | Estadisticas por distrito |
| GET | `/analisis-mercado/proveedores` | Analisis de mercado por proveedor |
| GET | `/zonas-concentracion` | Top N zonas con mayor concentracion (`limite`) |
| GET | `/area/:distrito/:barrio` | Detalles de un area especifica |
| GET | `/mapa` | FeatureCollection con patinetes por distrito (centroides Madrid) |

**Filtros temporales:** `fecha` (cap 5 años atras).

---

## Trafico

Base path: `/api/v1/trafico`. Mediciones de intensidad/ocupacion/carga de la coleccion mas masiva del proyecto (~24-138M docs).

| Metodo | Ruta | Descripcion |
|--------|------|-------------|
| GET | `/` | Mediciones con filtros (cap 90 dias para forzar paginacion) |
| GET | `/punto/:id` | Datos de un punto de medida especifico |
| GET | `/estadisticas` | Estadisticas generales (heavyQueryLimiter) |
| GET | `/analisis-congestion` | Analisis de congestion por zonas (groupBy: distrito/tipoElemento) |
| GET | `/historico` | Datos historicos para graficos (aggregation: hour/day/week/month) |
| GET | `/mapa` | FeatureCollection GeoJSON (startDate + endDate obligatorios, rango max 7 dias) |

**Optimizaciones:** `executeFacetPagination` con `statsPipeline`. Modo cursor disponible para escaneos.

---

## Endpoints de mapa (GeoJSON RFC 7946)

Todos los endpoints `/mapa` devuelven un `FeatureCollection`:
```json
{
  "type": "FeatureCollection",
  "features": [
    {
      "type": "Feature",
      "geometry": { "type": "Point", "coordinates": [lng, lat] },
      "properties": { ... }
    }
  ]
}
```

Endpoints disponibles:
- `/ubicaciones/mapa`
- `/accidentes/mapa`, `/accidentes/mapa-calor`
- `/aforo-bicicletas/mapa`
- `/ruido/mapa`
- `/multas/mapa`
- `/patinetes/mapa`
- `/contenedores/mapa`, `/contenedores/mapa-calor`
- `/trafico/mapa`

---

## Headers de seguridad presentes

| Header | Valor |
|--------|-------|
| `X-Frame-Options` | `DENY` |
| `Content-Security-Policy` | `default-src 'none'; frame-ancestors 'none'` |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=(), ...` |
| `X-Content-Type-Options` | `nosniff` |
| `Referrer-Policy` | `no-referrer` |
| `X-Request-ID` | UUID por request |

---

## Headers de cache

| Header | Significado |
|--------|-------------|
| `X-Cache-Status: HIT` | Respuesta servida desde cache |
| `X-Cache-Status: MISS` | Cache miss, respuesta nueva |
| `X-Cache-Status: STALE` | Servida desde grace period (SWR) |
| `X-Cache-Status: STALE_FALLBACK` | Servida desde L2 fallback ante error de DB |
| `X-Cache-Type` | Tipo de cache (statistics/traffic/noise/airQuality/...) |
| `X-Cache-Age` | Antigüedad en segundos |
| `ETag` | Hash MD5 para 304 Not Modified |

---

## Notas de implementacion

- **Paginacion offset por defecto, cursor en endpoints masivos** (multas, accidentes, trafico, censo) cuando el cliente pasa `cursor=...`.
- **Filtros de fecha obligatorios o capeados** en endpoints sobre colecciones masivas:
  - Trafico mapa: cap 7 dias
  - Trafico general: cap 90 dias (`TRAFFIC_MAX_DAYS`)
  - Multas: cap 365 dias (`FINES_MAX_DAYS`)
  - Accidentes: cap 365 dias (`ACCIDENTS_MAX_DAYS`)
- **Cache TTL por tipo**: demographic 7d, statistics/traffic/noise/airQuality 24h, bikes 24h, containers permanente, fines 24h.
- **Refresh background SWR (stale-while-revalidate)** en cachess primarios cuando queda <20% del TTL.

Detalles arquitectonicos completos en [`docs/threat-model.md`](./threat-model.md).
