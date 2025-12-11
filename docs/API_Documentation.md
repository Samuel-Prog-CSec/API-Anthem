# API REST - Documentación de Endpoints

**Versión:** 1.0.0
**Base URL:** `http://localhost:3000/api/v1`
**Autenticación:** JWT Bearer Token

## Tabla de Contenidos

1. [Introducción](#introducción)
2. [Autenticación](#autenticación)
3. [Formato de Respuestas](#formato-de-respuestas)
4. [Paginación](#paginación)
5. [Códigos de Estado](#códigos-de-estado)
6. [Rate Limiting](#rate-limiting)
7. [Endpoints por Recurso](#endpoints-por-recurso)
   - [Autenticación](#endpoints-autenticación)
   - [Tráfico](#endpoints-tráfico)
   - [Multas](#endpoints-multas)
   - [Accidentes](#endpoints-accidentes)
   - [Calidad del Aire](#endpoints-calidad-del-aire)
   - [Ruido Ambiental](#endpoints-ruido-ambiental)
   - [Bicicletas](#endpoints-bicicletas)
   - [Patinetes](#endpoints-patinetes)
   - [Contenedores](#endpoints-contenedores)
   - [Censo](#endpoints-censo)
   - [Ubicaciones](#endpoints-ubicaciones)
   - [Administración](#endpoints-administración)

---

## Introducción

Esta API REST proporciona acceso a los datos de la Smart City, incluyendo información sobre tráfico, calidad del aire, multas, accidentes, y otros servicios urbanos. Todos los endpoints están protegidos con autenticación JWT y rate limiting.

### Características Principales

- ✅ Autenticación JWT con refresh tokens
- ✅ Rate limiting inteligente
- ✅ Caché multinivel (TTL según volatilidad)
- ✅ Validación HTTP con ETags
- ✅ Paginación consistente
- ✅ Filtrado avanzado
- ✅ Proyecciones de campos
- ✅ Headers de performance (`X-Response-Time`)

---

## Autenticación

### Esquema de Autenticación

La API utiliza **JWT (JSON Web Tokens)** con sistema de refresh tokens.

#### Tipos de Tokens

1. **Access Token**
   - Duración: 1 hora
   - Uso: Autenticación de requests
   - Header: `Authorization: Bearer <access_token>`
   - Secreto: JWT_SECRET

2. **Refresh Token**
   - Duración: 7 días
   - Uso: Renovar access token
   - Secreto: JWT_REFRESH_SECRET (separado del access token)
   - Rotación: Se genera nuevo refresh token en cada renovación

#### Headers de Autenticación

```http
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

### Roles de Usuario

| Rol | Permisos |
|-----|----------|
| `user` | Lectura de todos los recursos públicos |
| `admin` | Lectura + Escritura + Endpoints admin |

---

## Formato de Respuestas

### Respuesta Exitosa

```json
{
  "success": true,
  "message": "Datos obtenidos exitosamente",
  "data": {
    // Datos del recurso
  },
  "pagination": {
    "currentPage": 1,
    "totalPages": 10,
    "totalItems": 500,
    "itemsPerPage": 50,
    "hasNextPage": true,
    "hasPrevPage": false
  }
}
```

### Respuesta de Error

```json
{
  "success": false,
  "message": "Descripción del error",
  "statusCode": 400,
  "errors": [
    {
      "field": "startDate",
      "message": "Fecha debe estar en formato ISO8601"
    }
  ]
}
```

---

## Paginación

Todos los endpoints de listado soportan paginación.

### Parámetros de Paginación

| Parámetro | Tipo | Default | Máximo | Descripción |
|-----------|------|---------|--------|-------------|
| `page` | Integer | 1 | - | Número de página |
| `limit` | Integer | 50 | 1000 | Elementos por página |

### Ejemplo

```http
GET /api/v1/traffic?page=2&limit=100
```

### Metadata de Paginación

```json
"pagination": {
  "currentPage": 2,
  "totalPages": 15,
  "totalItems": 1500,
  "itemsPerPage": 100,
  "hasNextPage": true,
  "hasPrevPage": true
}
```

---

## Códigos de Estado

| Código | Significado | Uso |
|--------|-------------|-----|
| `200` | OK | Request exitoso |
| `201` | Created | Recurso creado exitosamente |
| `204` | No Content | Operación exitosa sin contenido |
| `304` | Not Modified | ETag válido, usar caché cliente |
| `400` | Bad Request | Parámetros inválidos |
| `401` | Unauthorized | Sin autenticación o token inválido |
| `403` | Forbidden | Sin permisos para el recurso |
| `404` | Not Found | Recurso no encontrado |
| `422` | Unprocessable Entity | Validación fallida |
| `429` | Too Many Requests | Rate limit excedido |
| `500` | Internal Server Error | Error del servidor |

---

## Rate Limiting

### Límites por Endpoint

| Tipo | Ventana | Límite |
|------|---------|--------|
| **General** | 15 min | 1000 requests |
| **Autenticación** | 15 min | 10 intentos |
| **Admin** | 15 min | 100 requests |

### Headers de Rate Limit

```http
X-RateLimit-Limit: 1000
X-RateLimit-Remaining: 995
X-RateLimit-Reset: 1699876543
```

### Respuesta cuando se excede

```http
HTTP/1.1 429 Too Many Requests
Retry-After: 900

{
  "success": false,
  "message": "Demasiados requests. Intente nuevamente en 15 minutos",
  "statusCode": 429
}
```

---

## Endpoints por Recurso

Para ver la documentación detallada de cada recurso, consulte los documentos específicos:

- [Autenticación](./API_Auth.md)
- [Tráfico](./API_Traffic.md)
- [Multas](./API_Fines.md)
- [Accidentes](./API_Accidents.md)
- [Calidad del Aire](./API_AirQuality.md)
- [Ruido Ambiental](./API_Noise.md)
- [Bicicletas](./API_Bikes.md)
- [Patinetes](./API_Scooters.md)
- [Contenedores](./API_Containers.md)
- [Censo](./API_Census.md)
- [Ubicaciones](./API_Locations.md)
- [Administración](./API_Admin.md)

---

## Endpoints - Autenticación

### POST /auth/register

Registra un nuevo usuario en el sistema.

**Autenticación:** No requerida

**Rate Limit:** 10 requests / 15 min

#### Request Body

```json
{
  "username": "usuario123",
  "email": "usuario@example.com",
  "password": "Password123!",
  "fullName": "Juan Pérez"
}
```

#### Validaciones

| Campo | Tipo | Requerido | Validación |
|-------|------|-----------|------------|
| `username` | String | Sí | 3-30 caracteres, alfanumérico + guiones |
| `email` | String | Sí | Email válido |
| `password` | String | Sí | Mínimo 8 caracteres, 1 mayúscula, 1 minúscula, 1 número |
| `fullName` | String | Sí | 2-100 caracteres |

#### Response 201 Created

```json
{
  "success": true,
  "message": "Usuario registrado exitosamente",
  "data": {
    "user": {
      "id": "6472abc123def456789",
      "username": "usuario123",
      "email": "usuario@example.com",
      "role": "user"
    },
    "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  }
}
```

#### Errores Comunes

- `400`: Email o username ya existe
- `422`: Validación de campos fallida

---

### POST /auth/login

Autentica un usuario y retorna tokens JWT.

**Autenticación:** No requerida

**Rate Limit:** 10 requests / 15 min

#### Request Body

```json
{
  "email": "usuario@example.com",
  "password": "Password123!"
}
```

#### Response 200 OK

```json
{
  "success": true,
  "message": "Login exitoso",
  "data": {
    "user": {
      "id": "6472abc123def456789",
      "username": "usuario123",
      "email": "usuario@example.com",
      "role": "user"
    },
    "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  }
}
```

#### Errores Comunes

- `401`: Credenciales inválidas
- `429`: Demasiados intentos de login

---

### POST /auth/refresh

Renueva el access token usando el refresh token.

**Autenticación:** Refresh Token requerido

#### Request Body

```json
{
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

#### Response 200 OK

```json
{
  "success": true,
  "message": "Token renovado exitosamente",
  "data": {
    "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  }
}
```

---

### POST /auth/logout

Cierra sesión e invalida el refresh token.

**Autenticación:** Access Token requerido

#### Response 200 OK

```json
{
  "success": true,
  "message": "Logout exitoso"
}
```

---

## Endpoints - Tráfico

### GET /traffic

Obtiene listado de datos de tráfico con filtros.

**Autenticación:** Requerida

**Caché:** 5 minutos

**Rate Limit:** 1000 requests / 15 min

#### Query Parameters

| Parámetro | Tipo | Requerido | Descripción |
|-----------|------|-----------|-------------|
| `page` | Integer | No | Número de página (default: 1) |
| `limit` | Integer | No | Items por página (default: 50, max: 1000) |
| `startDate` | ISO8601 | No | Fecha inicio (YYYY-MM-DD) |
| `endDate` | ISO8601 | No | Fecha fin (YYYY-MM-DD) |
| `puntoMedidaId` | String | No | ID del punto de medición |
| `tipoElemento` | String | No | Tipo: `URB` o `M-30` |
| `intensidadMin` | Integer | No | Intensidad mínima (veh/h) |
| `intensidadMax` | Integer | No | Intensidad máxima (veh/h) |
| `sort` | String | No | Campo de ordenamiento (default: `-fecha`) |

#### Response 200 OK

```json
{
  "success": true,
  "message": "Datos de tráfico obtenidos exitosamente",
  "data": [
    {
      "_id": "6472abc123def456789",
      "puntoMedidaId": "1001",
      "fecha": "2025-11-15T10:30:00.000Z",
      "año": 2025,
      "mes": 11,
      "dia": 15,
      "hora": 10,
      "minutos": 30,
      "tipoElemento": "URB",
      "metricas": {
        "intensidad": 450,
        "ocupacion": 35,
        "carga": 65,
        "velocidadMedia": null
      },
      "estadoMedicion": {
        "error": "N",
        "periodoIntegracion": 4
      }
    }
  ],
  "pagination": {
    "currentPage": 1,
    "totalPages": 20,
    "totalItems": 1000,
    "itemsPerPage": 50,
    "hasNextPage": true,
    "hasPrevPage": false
  }
}
```

#### Headers de Respuesta

```http
X-Cache-Status: HIT | MISS
X-Response-Time: 45ms
ETag: "a1b2c3d4e5f6"
Cache-Control: public, max-age=300
```

---

### GET /traffic/stats

Obtiene estadísticas agregadas de tráfico.

**Autenticación:** Requerida

**Caché:** 30 minutos

#### Query Parameters

| Parámetro | Tipo | Requerido | Descripción |
|-----------|------|-----------|-------------|
| `startDate` | ISO8601 | Sí | Fecha inicio |
| `endDate` | ISO8601 | Sí | Fecha fin |
| `groupBy` | String | No | Agrupación: `hour`, `day`, `point` (default: `day`) |

#### Response 200 OK

```json
{
  "success": true,
  "message": "Estadísticas de tráfico obtenidas exitosamente",
  "data": {
    "summary": {
      "totalMediciones": 15000,
      "intensidadPromedio": 420,
      "intensidadMaxima": 1250,
      "intensidadMinima": 50,
      "ocupacionPromedio": 38.5,
      "cargaPromedio": 62.3
    },
    "byHour": [
      {
        "hora": 8,
        "intensidadPromedio": 850,
        "mediciones": 120
      },
      {
        "hora": 14,
        "intensidadPromedio": 650,
        "mediciones": 115
      }
    ],
    "topCongestedPoints": [
      {
        "puntoMedidaId": "1001",
        "intensidadPromedio": 980,
        "ocupacionPromedio": 85
      }
    ]
  }
}
```

---

## Endpoints - Multas

### GET /fines

Obtiene listado de multas con filtros.

**Autenticación:** Requerida

**Caché:** 30 minutos

#### Query Parameters

| Parámetro | Tipo | Requerido | Descripción |
|-----------|------|-----------|-------------|
| `page` | Integer | No | Número de página |
| `limit` | Integer | No | Items por página |
| `startDate` | ISO8601 | No | Fecha inicio |
| `endDate` | ISO8601 | No | Fecha fin |
| `calificacion` | String | No | `LEVE`, `GRAVE`, `MUY GRAVE` |
| `lugar` | String | No | Lugar de infracción (búsqueda parcial) |
| `denunciante` | String | No | Tipo de denunciante |
| `importeMin` | Number | No | Importe mínimo |
| `importeMax` | Number | No | Importe máximo |
| `tieneDescuento` | Boolean | No | `true` o `false` |

#### Response 200 OK

```json
{
  "success": true,
  "message": "Multas obtenidas exitosamente",
  "data": [
    {
      "_id": "6472abc123def456789",
      "fecha": "2025-11-15T00:00:00.000Z",
      "mes": 11,
      "año": 2025,
      "hora": "14:30",
      "calificacion": "GRAVE",
      "lugar": "Calle Mayor, 25",
      "importeBoletín": 200,
      "importeFinal": 100,
      "tieneDescuento": true,
      "puntosDetraídos": 4,
      "denunciante": "POLICIA_MUNICIPAL",
      "hechoInfraccion": "Estacionar en lugar prohibido",
      "metadatos": {
        "esInfraccionRadar": false,
        "esInfraccionGrave": true,
        "tipoInfraccion": "ESTACIONAMIENTO"
      }
    }
  ],
  "pagination": {
    "currentPage": 1,
    "totalPages": 50,
    "totalItems": 2500,
    "itemsPerPage": 50,
    "hasNextPage": true,
    "hasPrevPage": false
  }
}
```

---

### GET /fines/stats

Obtiene estadísticas agregadas de multas.

**Autenticación:** Requerida

**Caché:** 30 minutos

#### Query Parameters

| Parámetro | Tipo | Requerido | Descripción |
|-----------|------|-----------|-------------|
| `startDate` | ISO8601 | No | Fecha inicio (default: 30 días atrás) |
| `endDate` | ISO8601 | No | Fecha fin (default: hoy) |
| `groupBy` | String | No | `calificacion`, `lugar`, `denunciante`, `month` |

#### Response 200 OK

```json
{
  "success": true,
  "message": "Estadísticas de multas obtenidas exitosamente",
  "data": {
    "summary": {
      "totalMultas": 5000,
      "importeTotal": 850000,
      "importePromedio": 170,
      "multasConDescuento": 3200,
      "porcentajeDescuento": 64
    },
    "byCalificacion": [
      {
        "calificacion": "LEVE",
        "total": 2800,
        "porcentaje": 56,
        "importePromedio": 100
      },
      {
        "calificacion": "GRAVE",
        "total": 1800,
        "porcentaje": 36,
        "importePromedio": 200
      },
      {
        "calificacion": "MUY GRAVE",
        "total": 400,
        "porcentaje": 8,
        "importePromedio": 500
      }
    ],
    "topLugares": [
      {
        "lugar": "Gran Vía",
        "total": 350,
        "importeTotal": 52500
      }
    ]
  }
}
```

---

## Endpoints - Accidentes

### GET /accidents

Obtiene listado de accidentes con filtros.

**Autenticación:** Requerida

**Caché:** 30 minutos

#### Query Parameters

| Parámetro | Tipo | Requerido | Descripción |
|-----------|------|-----------|-------------|
| `page` | Integer | No | Número de página |
| `limit` | Integer | No | Items por página |
| `startDate` | ISO8601 | No | Fecha inicio |
| `endDate` | ISO8601 | No | Fecha fin |
| `distrito` | String | No | Nombre del distrito |
| `tipoAccidente` | String | No | Tipo de accidente |
| `gravedad` | String | No | `LEVE`, `GRAVE`, `MORTAL` |
| `estadoMeteorologico` | String | No | Estado meteorológico |

#### Response 200 OK

```json
{
  "success": true,
  "message": "Accidentes obtenidos exitosamente",
  "data": [
    {
      "_id": "6472abc123def456789",
      "numeroExpediente": "2025S001234",
      "fecha": "2025-11-15T16:45:00.000Z",
      "año": 2025,
      "mes": 11,
      "dia": 15,
      "hora": 16,
      "ubicacion": {
        "calle": "Calle Alcalá",
        "numero": "150",
        "codigoDistrito": "01",
        "nombreDistrito": "CENTRO"
      },
      "circunstancias": {
        "tipoAccidente": "COLISION_DOBLE",
        "estadoMeteorologico": "DESPEJADO",
        "gravedad": "LEVE"
      },
      "vehiculosInvolucrados": ["TURISMO", "MOTOCICLETA"],
      "personasAfectadas": [
        {
          "tipoPersona": "CONDUCTOR",
          "rangoEdad": "25-35",
          "sexo": "HOMBRE",
          "tipoLesion": "LEVE"
        }
      ]
    }
  ],
  "pagination": {
    "currentPage": 1,
    "totalPages": 30,
    "totalItems": 1500,
    "itemsPerPage": 50,
    "hasNextPage": true,
    "hasPrevPage": false
  }
}
```

---

### GET /accidents/analytics

Obtiene análisis avanzados de accidentes.

**Autenticación:** Requerida

**Caché:** 1 hora

#### Query Parameters

| Parámetro | Tipo | Requerido | Descripción |
|-----------|------|-----------|-------------|
| `startDate` | ISO8601 | Sí | Fecha inicio |
| `endDate` | ISO8601 | Sí | Fecha fin |

#### Response 200 OK

```json
{
  "success": true,
  "message": "Análisis de accidentes obtenido exitosamente",
  "data": {
    "hourlyPatterns": {
      "peakHours": [8, 14, 18],
      "distribution": [
        { "hora": 8, "accidentes": 45, "gravesPromedio": 5 },
        { "hora": 14, "accidentes": 38, "gravesPromedio": 4 }
      ]
    },
    "weeklyPatterns": {
      "peakDays": ["LUNES", "VIERNES"],
      "distribution": [
        { "dia": "LUNES", "accidentes": 180, "mortalidad": 2 }
      ]
    },
    "districtRanking": [
      {
        "distrito": "CENTRO",
        "accidentes": 350,
        "gravedad": "ALTA",
        "mortales": 3
      }
    ],
    "riskFactors": {
      "weather": [
        { "condicion": "LLUVIA_INTENSA", "accidentes": 85, "riesgo": "ALTO" }
      ],
      "vehicleTypes": [
        { "tipo": "MOTOCICLETA", "accidentes": 120, "lesionados": 95 }
      ]
    }
  }
}
```

---

## Endpoints - Calidad del Aire

### GET /air-quality

Obtiene mediciones de calidad del aire.

**Autenticación:** Requerida

**Caché:** 30 minutos

#### Query Parameters

| Parámetro | Tipo | Requerido | Descripción |
|-----------|------|-----------|-------------|
| `page` | Integer | No | Número de página |
| `limit` | Integer | No | Items por página |
| `startDate` | ISO8601 | No | Fecha inicio |
| `endDate` | ISO8601 | No | Fecha fin |
| `estacion` | Integer | No | Código de estación |
| `magnitud` | Integer | No | Código de magnitud (1, 6, 7, 8, 9, 10, 14) |
| `provincia` | Integer | No | Código de provincia |
| `municipio` | Integer | No | Código de municipio |

#### Códigos de Magnitud

| Código | Contaminante | Unidad |
|--------|--------------|--------|
| 1 | Dióxido de Azufre (SO2) | μg/m³ |
| 6 | Monóxido de Carbono (CO) | mg/m³ |
| 7 | Monóxido de Nitrógeno (NO) | μg/m³ |
| 8 | Dióxido de Nitrógeno (NO2) | μg/m³ |
| 9 | Partículas < 2.5 μm (PM2.5) | μg/m³ |
| 10 | Partículas < 10 μm (PM10) | μg/m³ |
| 14 | Ozono (O3) | μg/m³ |

#### Response 200 OK

```json
{
  "success": true,
  "message": "Datos de calidad del aire obtenidos exitosamente",
  "data": [
    {
      "_id": "6472abc123def456789",
      "provincia": 28,
      "municipio": 79,
      "estacion": 4,
      "magnitud": 8,
      "puntoMuestreo": "28079004_8_38",
      "fecha": "2025-11-15T00:00:00.000Z",
      "medicionesHorarias": {
        "H01": { "value": 42, "validationCode": "V" },
        "H02": { "value": 38, "validationCode": "V" },
        "H03": { "value": 35, "validationCode": "V" }
        // ... H04-H24
      },
      "processingMetadata": {
        "validMeasurements": 22,
        "dataQualityScore": 91.67
      }
    }
  ],
  "pagination": {
    "currentPage": 1,
    "totalPages": 15,
    "totalItems": 750,
    "itemsPerPage": 50,
    "hasNextPage": true,
    "hasPrevPage": false
  }
}
```

---

## Endpoints - Administración

### GET /admin/cache/stats

Obtiene estadísticas del sistema de caché.

**Autenticación:** Requerida (rol: admin)

**Rate Limit:** 100 requests / 15 min

#### Response 200 OK

```json
{
  "success": true,
  "message": "Estadísticas de caché obtenidas exitosamente",
  "data": {
    "overall": {
      "totalCaches": 8,
      "totalKeys": 1250,
      "globalHitRate": 87.5
    },
    "caches": {
      "static": {
        "keys": 50,
        "hits": 5000,
        "misses": 500,
        "hitRate": 90.9,
        "ksize": 50,
        "vsize": 50,
        "ttl": 86400
      },
      "traffic": {
        "keys": 320,
        "hits": 8500,
        "misses": 1200,
        "hitRate": 87.6,
        "ksize": 320,
        "vsize": 320,
        "ttl": 300
      }
      // ... otros cachés
    }
  }
}
```

---

### GET /admin/performance/stats

Obtiene estadísticas de rendimiento del sistema.

**Autenticación:** Requerida (rol: admin)

#### Response 200 OK

```json
{
  "success": true,
  "message": "Estadísticas de rendimiento obtenidas exitosamente",
  "data": {
    "thresholds": {
      "warning": 1000,
      "critical": 3000
    },
    "monitoring": {
      "header": "X-Response-Time",
      "unit": "milliseconds"
    },
    "recommendations": [
      "Revisar logs para requests con tiempo > 1000ms",
      "Investigar requests críticas (>3000ms)",
      "Considerar caché adicional para endpoints lentos"
    ]
  }
}
```

---

### DELETE /admin/cache/clear

Limpia caché del sistema.

**Autenticación:** Requerida (rol: admin)

#### Query Parameters

| Parámetro | Tipo | Requerido | Descripción |
|-----------|------|-----------|-------------|
| `type` | String | No | Tipo de caché a limpiar (`static`, `traffic`, etc.) |
| `pattern` | String | No | Patrón de keys a eliminar |

#### Sin Parámetros (limpiar todo)

```http
DELETE /admin/cache/clear
```

#### Response 200 OK

```json
{
  "success": true,
  "message": "Caché limpiado exitosamente",
  "data": {
    "cachesCleared": 8,
    "keysDeleted": 1250
  }
}
```

#### Con Tipo Específico

```http
DELETE /admin/cache/clear?type=traffic
```

#### Response 200 OK

```json
{
  "success": true,
  "message": "Caché 'traffic' limpiado exitosamente",
  "data": {
    "cacheType": "traffic",
    "keysDeleted": 320
  }
}
```

---

## Mejores Prácticas para Consumir la API

### 1. Usar ETags para Reducir Bandwidth

```javascript
// Primera request
const response1 = await fetch('/api/v1/traffic');
const etag = response1.headers.get('ETag');
localStorage.setItem('traffic-etag', etag);

// Segunda request con ETag
const response2 = await fetch('/api/v1/traffic', {
  headers: {
    'If-None-Match': localStorage.getItem('traffic-etag')
  }
});

if (response2.status === 304) {
  // Usar datos cacheados localmente
  console.log('Datos no modificados, usando caché local');
} else {
  // Actualizar datos y ETag
  const newData = await response2.json();
  localStorage.setItem('traffic-etag', response2.headers.get('ETag'));
}
```

### 2. Implementar Retry Logic

```javascript
async function fetchWithRetry(url, options = {}, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(url, options);

      if (response.status === 429) {
        // Rate limit - esperar según Retry-After
        const retryAfter = response.headers.get('Retry-After');
        await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
        continue;
      }

      return response;
    } catch (error) {
      if (i === retries - 1) throw error;
      await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, i)));
    }
  }
}
```

### 3. Usar Paginación Eficientemente

```javascript
async function fetchAllPages(endpoint, params = {}) {
  const allData = [];
  let currentPage = 1;
  let hasNextPage = true;

  while (hasNextPage) {
    const response = await fetch(
      `${endpoint}?${new URLSearchParams({ ...params, page: currentPage })}`
    );
    const json = await response.json();

    allData.push(...json.data);
    hasNextPage = json.pagination.hasNextPage;
    currentPage++;

    // Prevenir rate limiting
    if (hasNextPage) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  return allData;
}
```

### 4. Manejar Tokens JWT

```javascript
class APIClient {
  constructor(baseURL) {
    this.baseURL = baseURL;
    this.accessToken = localStorage.getItem('accessToken');
    this.refreshToken = localStorage.getItem('refreshToken');
  }

  async request(endpoint, options = {}) {
    // Añadir token a headers
    options.headers = {
      ...options.headers,
      'Authorization': `Bearer ${this.accessToken}`
    };

    let response = await fetch(`${this.baseURL}${endpoint}`, options);

    // Si token expiró, renovar
    if (response.status === 401) {
      await this.refreshAccessToken();
      options.headers['Authorization'] = `Bearer ${this.accessToken}`;
      response = await fetch(`${this.baseURL}${endpoint}`, options);
    }

    return response;
  }

  async refreshAccessToken() {
    const response = await fetch(`${this.baseURL}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: this.refreshToken })
    });

    const json = await response.json();
    this.accessToken = json.data.accessToken;
    this.refreshToken = json.data.refreshToken;

    localStorage.setItem('accessToken', this.accessToken);
    localStorage.setItem('refreshToken', this.refreshToken);
  }
}
```

---

## Soporte y Contacto

Para reportar problemas o solicitar nuevas funcionalidades:

- **Email:** soporte@smartcity-api.com
- **GitHub:** [API-Anthem Repository](https://github.com/Samuel-Prog-CSec/API-Anthem)
- **Documentación Completa:** [docs/](../docs/)

---

**Última Actualización:** Noviembre 2025
**Versión API:** 1.0.0
**Mantenedor:** Equipo Smart City
