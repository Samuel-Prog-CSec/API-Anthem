# Documentación de Rutas de la API REST

> **Versión:** v0.1
> **Base URL:** `http://localhost:3000/api/v0.1`
> **Autenticación:** JWT Bearer Token (requerido en la mayoría de endpoints)

## Índice

1. [Rutas Básicas](#rutas-básicas)
2. [Autenticación](#autenticación)
3. [Calidad del Aire](#calidad-del-aire)
4. [Monitoreo de Ruido](#monitoreo-de-ruido)
5. [Multas](#multas)
6. [Censo](#censo)
7. [Ubicaciones](#ubicaciones)
8. [Tráfico](#tráfico)
9. [Accidentes](#accidentes)
10. [Asignación de Patinetes](#asignación-de-patinetes)
11. [Disponibilidad de Bicicletas](#disponibilidad-de-bicicletas)
12. [Contenedores de Residuos](#contenedores-de-residuos)
13. [Administración](#administración)

---

## Rutas Básicas

### GET /
**Descripción:** Información general de la API
**Autenticación:** No requerida
**Rate Limit:** General

**Respuesta exitosa (200):**
```json
{
  "success": true,
  "message": "API is running successfully",
  "data": {
    "api": {
      "name": "Professional REST API",
      "version": "v0.1",
      "environment": "development",
      "documentation": "http://localhost:3000/api/v0.1/docs"
    },
    "server": {
      "uptime": "2h 15m 30s",
      "timestamp": "2025-10-06T10:30:00.000Z"
    },
    "endpoints": { ... }
  }
}
```

### GET /health
**Descripción:** Estado de salud detallado de la API
**Autenticación:** No requerida
**Rate Limit:** General

**Respuesta exitosa (200):**
```json
{
  "success": true,
  "data": {
    "status": "healthy",
    "timestamp": "2025-10-06T10:30:00.000Z",
    "uptime": 8130,
    "system": {
      "platform": "win32",
      "nodeVersion": "v18.17.0",
      "memory": { "used": "45 MB", "total": "128 MB" }
    },
    "database": {
      "status": "connected",
      "readyState": 1
    }
  }
}
```

### GET /docs
**Descripción:** Documentación básica de la API
**Autenticación:** No requerida
**Rate Limit:** General

---

## Autenticación

Base path: `/auth`

### POST /auth/register
**Descripción:** Registrar un nuevo usuario
**Autenticación:** No requerida
**Rate Limit:** 10 req/15min

**Body:**
```json
{
  "username": "johndoe",
  "email": "john@example.com",
  "password": "SecurePass123!",
  "firstName": "John",
  "lastName": "Doe"
}
```

**Validaciones:**
- username: 3-30 caracteres alfanuméricos
- email: formato válido
- password: mínimo 6 caracteres
- firstName/lastName: 2-50 caracteres

**Respuesta exitosa (201):**
```json
{
  "success": true,
  "message": "Usuario registrado exitosamente",
  "data": {
    "user": {
      "id": "...",
      "username": "johndoe",
      "email": "john@example.com"
    },
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  }
}
```

### POST /auth/login
**Descripción:** Autenticar usuario y obtener token JWT
**Autenticación:** No requerida
**Rate Limit:** 10 req/15min

**Body:**
```json
{
  "identifier": "johndoe",  // username o email
  "password": "SecurePass123!"
}
```

**Respuesta exitosa (200):**
```json
{
  "success": true,
  "message": "Inicio de sesión exitoso",
  "data": {
    "user": { ... },
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  }
}
```

### POST /auth/logout
**Descripción:** Cerrar sesión (invalidar token)
**Autenticación:** Requerida
**Rate Limit:** General

**Respuesta exitosa (200):**
```json
{
  "success": true,
  "message": "Sesión cerrada exitosamente"
}
```

### GET /auth/me
**Descripción:** Obtener perfil del usuario actual
**Autenticación:** Requerida
**Rate Limit:** General

**Respuesta exitosa (200):**
```json
{
  "success": true,
  "data": {
    "user": {
      "id": "...",
      "username": "johndoe",
      "email": "john@example.com",
      "firstName": "John",
      "lastName": "Doe",
      "role": "user",
      "isActive": true,
      "createdAt": "2025-10-01T00:00:00.000Z"
    }
  }
}
```

### GET /auth/verify-token
**Descripción:** Verificar validez del token JWT actual
**Autenticación:** Requerida
**Rate Limit:** General

### PUT /auth/profile
**Descripción:** Actualizar perfil del usuario actual
**Autenticación:** Requerida
**Rate Limit:** General

**Body (todos opcionales):**
```json
{
  "firstName": "John",
  "lastName": "Smith",
  "email": "newmail@example.com"
}
```

---

## Calidad del Aire

Base path: `/air-quality`

### GET /air-quality
**Descripción:** Obtener mediciones de calidad del aire con filtros
**Autenticación:** Requerida
**Rate Limit:** 100 req/15min

**Query Parameters:**
- `page` (number): Número de página (default: 1)
- `limit` (number): Registros por página (default: 20, max: 100)
- `startDate` (date): Fecha inicio (YYYY-MM-DD)
- `endDate` (date): Fecha fin (YYYY-MM-DD)
- `provincia` (string): Código de provincia
- `municipio` (string): Código de municipio
- `estacion` (string): Código de estación
- `magnitud` (string): Código de magnitud (contaminante)
- `sortBy` (string): Campo de ordenamiento
- `sortOrder` (string): 'asc' o 'desc'

**Ejemplo:** `GET /air-quality?provincia=28&limit=10&startDate=2051-01-01`

**Respuesta exitosa (200):**
```json
{
  "success": true,
  "message": "Datos de calidad del aire obtenidos exitosamente",
  "data": [
    {
      "_id": "...",
      "provincia": "28",
      "municipio": "079",
      "estacion": "004",
      "magnitud": "01",
      "fecha": "2051-01-01T00:00:00.000Z",
      "valores": {
        "H01": 12.5,
        "H02": 13.2,
        ...
      },
      "promedioHorario": 14.3
    }
  ],
  "pagination": {
    "currentPage": 1,
    "totalPages": 50,
    "totalRecords": 1000,
    "recordsPerPage": 20,
    "hasNextPage": true,
    "hasPreviousPage": false
  }
}
```

### GET /air-quality/:id
**Descripción:** Obtener medición específica por ID
**Autenticación:** Requerida
**Rate Limit:** 100 req/15min

### GET /air-quality/statistics
**Descripción:** Estadísticas agregadas de calidad del aire
**Autenticación:** Requerida
**Rate Limit:** 50 req/15min

**Query Parameters:**
- `startDate`, `endDate`: Rango de fechas
- `provincia`, `municipio`, `estacion`, `magnitud`: Filtros

**Respuesta exitosa (200):**
```json
{
  "success": true,
  "data": {
    "totalMediciones": 5000,
    "promedioGeneral": 15.8,
    "valorMaximo": 45.2,
    "valorMinimo": 2.1,
    "desviacionEstandar": 8.3,
    "rangoFechas": {
      "inicio": "2051-01-01",
      "fin": "2051-12-31"
    },
    "distribucion": {
      "Q1": 10.5,
      "Q2": 15.8,
      "Q3": 21.2
    }
  }
}
```

### GET /air-quality/trends
**Descripción:** Tendencias temporales de calidad del aire
**Autenticación:** Requerida
**Rate Limit:** 50 req/15min

**Query Parameters:**
- `groupBy` (string): 'day', 'week', 'month' (default: 'day')
- `startDate`, `endDate`, filtros adicionales

**Respuesta exitosa (200):**
```json
{
  "success": true,
  "data": {
    "trends": [
      {
        "periodo": "2051-01",
        "promedio": 16.5,
        "minimo": 8.2,
        "maximo": 32.1,
        "mediciones": 1440
      }
    ],
    "tendenciaGeneral": "descendente",
    "cambioPromedio": -2.3
  }
}
```

---

## Monitoreo de Ruido

Base path: `/noise-monitoring`

### GET /noise-monitoring
**Descripción:** Obtener mediciones de ruido ambiental
**Autenticación:** Requerida
**Rate Limit:** 100 req/15min

**Query Parameters:**
- `page`, `limit`: Paginación
- `startDate`, `endDate`: Rango de fechas
- `estacion` (string): Nombre de estación (NMT seguido de número)
- `sortBy`, `sortOrder`: Ordenamiento

**Respuesta exitosa (200):**
```json
{
  "success": true,
  "data": [
    {
      "_id": "...",
      "estacion": "NMT013",
      "fecha": "2051-01-15T00:00:00.000Z",
      "valores": {
        "LAS01": 65.2,
        "LAS50": 58.3,
        "LAS90": 52.1
      },
      "promedioGeneral": 58.5
    }
  ],
  "pagination": { ... }
}
```

### GET /noise-monitoring/:id
**Descripción:** Obtener medición específica por ID
**Autenticación:** Requerida
**Rate Limit:** 100 req/15min

### GET /noise-monitoring/statistics
**Descripción:** Estadísticas de ruido y análisis de cumplimiento normativo
**Autenticación:** Requerida
**Rate Limit:** 50 req/15min

**Respuesta exitosa (200):**
```json
{
  "success": true,
  "data": {
    "totalMediciones": 2500,
    "promedioGeneral": 62.8,
    "nivelMaximo": 85.3,
    "nivelMinimo": 45.2,
    "cumplimientoNormativa": {
      "dentroDeLimite": 2100,
      "fueraDelLimite": 400,
      "porcentajeCumplimiento": 84.0
    },
    "estadisticasPorEstacion": [ ... ]
  }
}
```

### GET /noise-monitoring/ranking
**Descripción:** Ranking de estaciones por nivel de ruido
**Autenticación:** Requerida
**Rate Limit:** 50 req/15min

### GET /noise-monitoring/stations/search
**Descripción:** Buscar estaciones por nombre
**Autenticación:** Requerida
**Rate Limit:** 100 req/15min

**Query Parameters:**
- `q` (string, requerido): Término de búsqueda

---

## Multas

Base path: `/fines`

### GET /fines
**Descripción:** Obtener multas de tráfico con filtros
**Autenticación:** Requerida
**Rate Limit:** 100 req/15min

**Query Parameters:**
- `page`, `limit`: Paginación
- `startDate`, `endDate`: Rango de fechas
- `distrito` (number): Código de distrito
- `mes` (number): Mes (1-12)
- `anio` (number): Año
- `sortBy`, `sortOrder`: Ordenamiento

**Respuesta exitosa (200):**
```json
{
  "success": true,
  "data": {
    "multas": [
      {
        "_id": "...",
        "expediente": "2051-00123456",
        "fecha": "2051-03-15T00:00:00.000Z",
        "mes": 3,
        "anio": 2051,
        "distrito": 1,
        "importeMulta": 200.00,
        "puntos": 3,
        "tipoInfraccion": "Exceso de velocidad"
      }
    ],
    "totalMultas": 5000,
    "importeTotal": 1000000.00
  },
  "pagination": { ... }
}
```

### GET /fines/:id
**Descripción:** Obtener multa específica por ID
**Autenticación:** Requerida
**Rate Limit:** 100 req/15min

### GET /fines/expediente/:numero
**Descripción:** Buscar multa por número de expediente
**Autenticación:** Requerida
**Rate Limit:** 100 req/15min

### GET /fines/statistics
**Descripción:** Estadísticas generales de multas
**Autenticación:** Requerida
**Rate Limit:** 50 req/15min

**Query Parameters:**
- `startDate`, `endDate`: Rango de fechas
- `distrito`: Filtrar por distrito

**Respuesta exitosa (200):**
```json
{
  "success": true,
  "data": {
    "totalMultas": 125000,
    "importeTotal": 25000000.00,
    "promedioImporte": 200.00,
    "puntosTotal": 375000,
    "promedioPuntos": 3.0,
    "multaMasAlta": 3000.00,
    "multaMasBaja": 60.00,
    "distribucionPorMes": [ ... ],
    "topDistritosMultados": [ ... ]
  }
}
```

### GET /fines/locations/ranking
**Descripción:** Ranking de ubicaciones con más multas
**Autenticación:** Requerida
**Rate Limit:** 50 req/15min

### GET /fines/analysis/temporal
**Descripción:** Análisis temporal de multas (patrones por día, hora, mes)
**Autenticación:** Requerida
**Rate Limit:** 50 req/15min

### GET /fines/dashboard
**Descripción:** Datos consolidados para dashboard de multas
**Autenticación:** Requerida
**Rate Limit:** 50 req/15min

---

## Censo

Base path: `/census`

### GET /census
**Descripción:** Obtener datos de censo poblacional
**Autenticación:** Requerida
**Rate Limit:** 100 req/15min

**Query Parameters:**
- `page`, `limit`: Paginación
- `distrito` (number): Código de distrito
- `seccion` (number): Sección censal
- `mes` (number): Mes
- `anio` (number): Año
- `rangoEdadMin`, `rangoEdadMax` (number): Filtro por edad
- `sexo` (string): 'H' (Hombres) o 'M' (Mujeres)

**Respuesta exitosa (200):**
```json
{
  "success": true,
  "data": [
    {
      "_id": "...",
      "distrito": 1,
      "seccion": 5,
      "mes": 1,
      "anio": 2051,
      "rangoEdad": "25-29",
      "espaniolesHombres": 150,
      "espaniolesMujeres": 145,
      "extranjerosHombres": 30,
      "extranjerosMujeres": 25,
      "totalPersonas": 350
    }
  ],
  "pagination": { ... }
}
```

### GET /census/pyramid
**Descripción:** Datos para pirámide poblacional
**Autenticación:** Requerida
**Rate Limit:** 50 req/15min

**Query Parameters:**
- `distrito`, `mes`, `anio`: Filtros opcionales

**Respuesta exitosa (200):**
```json
{
  "success": true,
  "data": {
    "piramide": [
      {
        "rangoEdad": "0-4",
        "hombres": 5000,
        "mujeres": 4800,
        "total": 9800
      }
    ],
    "totalPoblacion": 3200000,
    "porcentajeHombres": 48.5,
    "porcentajeMujeres": 51.5
  }
}
```

### GET /census/districts/statistics
**Descripción:** Estadísticas demográficas por distrito
**Autenticación:** Requerida
**Rate Limit:** 50 req/15min

### GET /census/analysis/demographic
**Descripción:** Análisis demográfico completo (edad, nacionalidad, género)
**Autenticación:** Requerida
**Rate Limit:** 50 req/15min

### GET /census/evolution
**Descripción:** Evolución temporal de la población
**Autenticación:** Requerida
**Rate Limit:** 50 req/15min

**Query Parameters:**
- `groupBy` (string): 'month' o 'quarter' (default: 'month')
- `distrito`: Filtro opcional

### GET /census/dashboard
**Descripción:** Dashboard consolidado de censo
**Autenticación:** Requerida
**Rate Limit:** 50 req/15min

---

## Ubicaciones

Base path: `/locations`

### GET /locations
**Descripción:** Obtener ubicaciones geográficas (estaciones, paradas, etc.)
**Autenticación:** Requerida
**Rate Limit:** 100 req/15min

**Query Parameters:**
- `page`, `limit`: Paginación
- `tipo` (string): Tipo de ubicación
- `distrito`: Código de distrito

### GET /locations/puntos-medicion/acustica
**Descripción:** Puntos de medición de ruido (estaciones acústicas)
**Autenticación:** Requerida
**Rate Limit:** 100 req/15min

### GET /locations/puntos-medicion/trafico
**Descripción:** Puntos de medición de tráfico
**Autenticación:** Requerida
**Rate Limit:** 100 req/15min

### GET /locations/transporte/metro
**Descripción:** Ubicaciones de estaciones de metro
**Autenticación:** Requerida
**Rate Limit:** 100 req/15min

### GET /locations/transporte/autobus
**Descripción:** Ubicaciones de paradas de autobús
**Autenticación:** Requerida
**Rate Limit:** 100 req/15min

### GET /locations/proximidad
**Descripción:** Buscar ubicaciones cercanas a un punto (búsqueda geoespacial)
**Autenticación:** Requerida
**Rate Limit:** 100 req/15min

**Query Parameters (requeridos):**
- `x` (number): Longitud
- `y` (number): Latitud
- `radio` (number): Radio de búsqueda en metros
- `limit` (number): Límite de resultados

**Ejemplo:** `GET /locations/proximidad?x=-3.7038&y=40.4168&radio=1000&limit=10`

---

## Tráfico

Base path: `/traffic`

### GET /traffic
**Descripción:** Obtener mediciones de tráfico
**Autenticación:** Requerida
**Rate Limit:** 100 req/15min

**Query Parameters:**
- `page`, `limit`: Paginación
- `idelem` (number): ID del punto de medición
- `startDate`, `endDate`: Rango de fechas

### GET /traffic/punto/:id
**Descripción:** Datos históricos de un punto de medición específico
**Autenticación:** Requerida
**Rate Limit:** 100 req/15min

### GET /traffic/stats
**Descripción:** Estadísticas generales de tráfico
**Autenticación:** Requerida
**Rate Limit:** 50 req/15min

### GET /traffic/congestion-analysis
**Descripción:** Análisis de congestión por zonas y horarios
**Autenticación:** Requerida
**Rate Limit:** 50 req/15min

### GET /traffic/historical
**Descripción:** Datos históricos para gráficos de tendencias
**Autenticación:** Requerida
**Rate Limit:** 50 req/15min

**Query Parameters:**
- `startDate`, `endDate`: Rango de fechas
- `limit`: Límite de resultados

---

## Accidentes

Base path: `/accidents`

### GET /accidents
**Descripción:** Obtener registros de accidentes de tráfico
**Autenticación:** Requerida
**Rate Limit:** 100 req/15min

**Query Parameters:**
- `page`, `limit`: Paginación
- `startDate`, `endDate`: Rango de fechas
- `distrito` (string): Nombre del distrito
- `tipoAccidente` (string): Tipo de accidente
- `tipoVehiculo` (string): Tipo de vehículo involucrado

**Respuesta exitosa (200):**
```json
{
  "success": true,
  "data": {
    "accidentes": [
      {
        "_id": "...",
        "expediente": "2051-ACC-12345",
        "fecha": "2051-05-20T14:30:00.000Z",
        "distrito": "CENTRO",
        "tipoAccidente": "Colisión",
        "tipoVehiculo": "Turismo",
        "numeroVictimas": 2,
        "coordenadas": {
          "x": -3.7038,
          "y": 40.4168
        }
      }
    ],
    "totalAccidentes": 1500
  },
  "pagination": { ... }
}
```

### GET /accidents/expediente/:numero
**Descripción:** Buscar accidente por número de expediente
**Autenticación:** Requerida
**Rate Limit:** 100 req/15min

### GET /accidents/stats
**Descripción:** Estadísticas de accidentalidad
**Autenticación:** Requerida
**Rate Limit:** 50 req/15min

**Respuesta exitosa (200):**
```json
{
  "success": true,
  "data": {
    "totalAccidentes": 1500,
    "totalVictimas": 2100,
    "distribucionPorTipo": {
      "Colisión": 800,
      "Atropello": 300,
      "Vuelco": 150,
      "Otros": 250
    },
    "accidentesPorMes": [ ... ],
    "zonasConMasAccidentes": [ ... ]
  }
}
```

### GET /accidents/heatmap
**Descripción:** Datos para mapa de calor de accidentes
**Autenticación:** Requerida
**Rate Limit:** 50 req/15min

### GET /accidents/safety-analysis
**Descripción:** Análisis de seguridad vial
**Autenticación:** Requerida
**Rate Limit:** 50 req/15min

### GET /accidents/district-comparison
**Descripción:** Comparativa de accidentalidad entre distritos
**Autenticación:** Requerida
**Rate Limit:** 50 req/15min

---

## Asignación de Patinetes

Base path: `/scooter-assignments`

### GET /scooter-assignments
**Descripción:** Obtener asignaciones de patinetes eléctricos por zona
**Autenticación:** Requerida
**Rate Limit:** 100 req/15min

**Query Parameters:**
- `page`, `limit`: Paginación
- `distrito` (string): Nombre del distrito
- `barrio` (string): Nombre del barrio
- `proveedor` (string): Nombre del proveedor

**Respuesta exitosa (200):**
```json
{
  "success": true,
  "data": {
    "asignaciones": [
      {
        "_id": "...",
        "distrito": "CENTRO",
        "barrio": "SOL",
        "proveedor": "LIME",
        "numeroPatinetes": 150,
        "fecha": "2051-06-01T00:00:00.000Z"
      }
    ],
    "totalRegistros": 500
  },
  "pagination": { ... }
}
```

### GET /scooter-assignments/area/:distrito/:barrio
**Descripción:** Asignaciones en una zona específica (distrito/barrio)
**Autenticación:** Requerida
**Rate Limit:** 100 req/15min

### GET /scooter-assignments/statistics/districts
**Descripción:** Estadísticas de distribución por distrito
**Autenticación:** Requerida
**Rate Limit:** 50 req/15min

### GET /scooter-assignments/market-analysis/providers
**Descripción:** Análisis de cuota de mercado por proveedor
**Autenticación:** Requerida
**Rate Limit:** 50 req/15min

### GET /scooter-assignments/concentration-zones
**Descripción:** Zonas de mayor concentración de patinetes
**Autenticación:** Requerida
**Rate Limit:** 50 req/15min

### GET /scooter-assignments/dashboard
**Descripción:** Dashboard consolidado de patinetes
**Autenticación:** Requerida
**Rate Limit:** 50 req/15min

### GET /scooter-assignments/optimization-analysis
**Descripción:** Análisis de optimización de distribución
**Autenticación:** Requerida
**Rate Limit:** 50 req/15min

---

## Disponibilidad de Bicicletas

Base path: `/bikes`

### GET /bikes
**Descripción:** Obtener registros de disponibilidad de bicicletas eléctricas
**Autenticación:** Requerida
**Rate Limit:** 100 req/15min

**Query Parameters:**
- `page`, `limit`: Paginación
- `startDate`, `endDate`: Rango de fechas (formato: YYYY-MM-DD)
- `sortBy` (string): Campo de ordenamiento (ej: 'totalUsos', 'tasaOcupacion')
- `sortOrder` (string): 'asc' o 'desc'

**Respuesta exitosa (200):**
```json
{
  "success": true,
  "message": "Datos de disponibilidad de bicicletas obtenidos exitosamente",
  "data": [
    {
      "_id": "...",
      "fecha": "2051-01-15T00:00:00.000Z",
      "horasTotalesUsosBicicletas": 2450.5,
      "usosAbonadoAnual": 1500,
      "usosAbonadoOcasional": 800,
      "totalUsos": 2300,
      "tasaOcupacion": 0.68,
      "createdAt": "2025-10-06T10:00:00.000Z"
    }
  ],
  "pagination": {
    "currentPage": 1,
    "totalPages": 37,
    "totalRecords": 366,
    "recordsPerPage": 10
  }
}
```

### GET /bikes/date/:date
**Descripción:** Obtener datos de una fecha específica
**Autenticación:** Requerida
**Rate Limit:** 100 req/15min

**Parámetros de ruta:**
- `date` (string, requerido): Fecha en formato YYYY-MM-DD

**Ejemplo:** `GET /bikes/date/2051-03-15`

**Respuesta exitosa (200):**
```json
{
  "success": true,
  "data": {
    "fecha": "2051-03-15T00:00:00.000Z",
    "horasTotalesUsosBicicletas": 2680.25,
    "usosAbonadoAnual": 1650,
    "usosAbonadoOcasional": 950,
    "totalUsos": 2600,
    "tasaOcupacion": 0.75
  }
}
```

### GET /bikes/stats
**Descripción:** Estadísticas generales de uso de bicicletas
**Autenticación:** Requerida
**Rate Limit:** 100 req/15min

**Query Parameters (opcionales):**
- `startDate`, `endDate`: Rango de fechas para el cálculo

**Respuesta exitosa (200):**
```json
{
  "success": true,
  "data": {
    "totalRegistros": 366,
    "rangoFechas": {
      "inicio": "2051-01-01",
      "fin": "2051-12-31"
    },
    "promedios": {
      "horasUso": 2450.8,
      "usosAbonadoAnual": 1520.5,
      "usosAbonadoOcasional": 850.3,
      "totalUsos": 2370.8,
      "tasaOcupacion": 0.68
    },
    "maximos": {
      "horasUso": 3200.5,
      "totalUsos": 3500,
      "tasaOcupacion": 0.95,
      "fecha": "2051-07-15"
    },
    "minimos": {
      "horasUso": 1800.2,
      "totalUsos": 1650,
      "tasaOcupacion": 0.42,
      "fecha": "2051-12-25"
    },
    "totalAnual": {
      "horasUso": 896992.8,
      "usos": 867713
    }
  }
}
```

### GET /bikes/trends/monthly
**Descripción:** Tendencias mensuales de uso de bicicletas
**Autenticación:** Requerida
**Rate Limit:** 100 req/15min

**Query Parameters:**
- `year` (number): Año para el análisis (default: 2051)

**Respuesta exitosa (200):**
```json
{
  "success": true,
  "data": {
    "year": 2051,
    "tendenciasMensuales": [
      {
        "mes": 1,
        "nombreMes": "Enero",
        "promedioHorasUso": 2350.5,
        "promedioUsos": 2280.3,
        "promedioTasaOcupacion": 0.65,
        "totalDias": 31
      }
    ],
    "mejorMes": {
      "mes": 7,
      "nombreMes": "Julio",
      "promedioUsos": 2850.5
    },
    "peorMes": {
      "mes": 12,
      "nombreMes": "Diciembre",
      "promedioUsos": 2100.2
    }
  }
}
```

### GET /bikes/top-usage
**Descripción:** Días con mayor uso de bicicletas
**Autenticación:** Requerida
**Rate Limit:** 100 req/15min

**Query Parameters:**
- `limit` (number): Número de resultados (default: 10, max: 50)

**Respuesta exitosa (200):**
```json
{
  "success": true,
  "data": {
    "diasMayorUso": [
      {
        "fecha": "2051-07-15",
        "totalUsos": 3500,
        "horasUso": 3200.5,
        "tasaOcupacion": 0.95,
        "diaSemana": "Sábado"
      }
    ],
    "totalRegistros": 10
  }
}
```

### GET /bikes/subscription-comparison
**Descripción:** Comparación entre abonados anuales y ocasionales
**Autenticación:** Requerida
**Rate Limit:** 100 req/15min

**Query Parameters (opcionales):**
- `startDate`, `endDate`: Rango de fechas

**Respuesta exitosa (200):**
```json
{
  "success": true,
  "data": {
    "rangoFechas": {
      "inicio": "2051-01-01",
      "fin": "2051-12-31"
    },
    "abonadosAnuales": {
      "totalUsos": 556000,
      "promedioUsos": 1520.5,
      "porcentajeTotal": 64.1
    },
    "abonadosOcasionales": {
      "totalUsos": 311400,
      "promedioUsos": 850.3,
      "porcentajeTotal": 35.9
    },
    "comparativa": {
      "diferencia": 244600,
      "ratioAnualVsOcasional": 1.79
    }
  }
}
```

### GET /bikes/efficiency
**Descripción:** Análisis de eficiencia del sistema de bicicletas
**Autenticación:** Requerida
**Rate Limit:** 100 req/15min

**Respuesta exitosa (200):**
```json
{
  "success": true,
  "data": {
    "tasaOcupacionPromedio": 0.68,
    "diasAltoUso": 180,
    "diasBajoUso": 120,
    "diasNormales": 66,
    "eficienciaGeneral": "Alta",
    "recomendaciones": [
      "Mantener inventario actual durante alta temporada",
      "Considerar reducción temporal en baja temporada"
    ]
  }
}
```

### GET /bikes/historical
**Descripción:** Datos históricos con agregación temporal flexible
**Autenticación:** Requerida
**Rate Limit:** 100 req/15min

**Query Parameters:**
- `aggregation` (string): Tipo de agregación - 'day', 'week', 'month' (default: 'day')
- `startDate`, `endDate` (opcionales): Rango de fechas
- `limit` (number): Límite de resultados

**Ejemplo:** `GET /bikes/historical?aggregation=week&startDate=2051-01-01&endDate=2051-03-31`

**Respuesta exitosa (200):**
```json
{
  "success": true,
  "data": {
    "aggregation": "week",
    "rangoFechas": {
      "inicio": "2051-01-01",
      "fin": "2051-03-31"
    },
    "datos": [
      {
        "periodo": "2051-W01",
        "fechaInicio": "2051-01-01",
        "fechaFin": "2051-01-07",
        "promedioHorasUso": 2380.5,
        "promedioUsos": 2310.8,
        "promedioTasaOcupacion": 0.66,
        "totalDias": 7
      }
    ],
    "totalPeriodos": 13
  }
}
```

---

## Contenedores de Residuos

Base path: `/containers`

### GET /containers
**Descripción:** Obtener contenedores de residuos con filtros
**Autenticación:** Requerida
**Rate Limit:** 100 req/15min

**Query Parameters:**
- `page`, `limit`: Paginación
- `tipoContenedor` (string): Tipo - 'ORGANICA', 'RESTO', 'ENVASES', 'VIDRIO', 'PAPEL-CARTON'
- `distrito` (string): Nombre del distrito
- `barrio` (string): Nombre del barrio
- `lote` (number): Número de lote

**Respuesta exitosa (200):**
```json
{
  "success": true,
  "message": "Contenedores obtenidos exitosamente",
  "data": [
    {
      "_id": "...",
      "codigoInternoSituado": "179001",
      "tipoContenedor": "ORGANICA",
      "modelo": "O 3200 CL",
      "descripcionModelo": "Contenedor orgánica 3200L carga lateral",
      "cantidad": 1,
      "lote": 3,
      "distrito": "HORTALEZA",
      "barrio": "PINAR DEL REY",
      "direccion": {
        "tipoVia": "Calle",
        "nombre": "de Francisco Villaespesa",
        "numero": "6"
      },
      "coordenadas": {
        "x": 447205.23,
        "y": 4481942.56
      },
      "location": {
        "type": "Point",
        "coordinates": [-3.6375, 40.4685]
      }
    }
  ],
  "pagination": {
    "currentPage": 1,
    "totalPages": 1898,
    "totalRecords": 37954,
    "recordsPerPage": 20
  }
}
```

### GET /containers/nearby
**Descripción:** Buscar contenedores cercanos a una ubicación (búsqueda geoespacial)
**Autenticación:** Requerida
**Rate Limit:** 100 req/15min

**Query Parameters (requeridos):**
- `longitude` (number): Longitud (ej: -3.7038)
- `latitude` (number): Latitud (ej: 40.4168)
- `maxDistance` (number): Distancia máxima en metros (default: 500, max: 5000)

**Query Parameters (opcionales):**
- `tipoContenedor` (string): Filtrar por tipo
- `limit` (number): Límite de resultados (default: 20, max: 100)

**Ejemplo:** `GET /containers/nearby?longitude=-3.7038&latitude=40.4168&maxDistance=300&tipoContenedor=VIDRIO`

**Respuesta exitosa (200):**
```json
{
  "success": true,
  "message": "Contenedores cercanos encontrados",
  "data": {
    "puntoReferencia": {
      "longitude": -3.7038,
      "latitude": 40.4168
    },
    "distanciaMaxima": 300,
    "contenedores": [
      {
        "_id": "...",
        "tipoContenedor": "VIDRIO",
        "direccion": {
          "nombre": "Calle Mayor",
          "numero": "10"
        },
        "location": {
          "coordinates": [-3.7041, 40.4170]
        },
        "distancia": 45.8
      }
    ],
    "totalEncontrados": 5
  }
}
```

### GET /containers/stats
**Descripción:** Estadísticas generales de contenedores
**Autenticación:** Requerida
**Rate Limit:** 100 req/15min

**Respuesta exitosa (200):**
```json
{
  "success": true,
  "data": {
    "totalContenedores": 37954,
    "distribucionPorTipo": {
      "ENVASES": 7812,
      "ORGANICA": 7316,
      "PAPEL-CARTON": 7049,
      "RESTO": 8537,
      "VIDRIO": 7240
    },
    "porcentajePorTipo": {
      "ENVASES": 20.58,
      "ORGANICA": 19.27,
      "PAPEL-CARTON": 18.57,
      "RESTO": 22.49,
      "VIDRIO": 19.07
    },
    "totalDistritos": 21,
    "promedioContenedoresPorDistrito": 1807.3
  }
}
```

### GET /containers/stats/district
**Descripción:** Estadísticas de contenedores por distrito
**Autenticación:** Requerida
**Rate Limit:** 100 req/15min

**Query Parameters (opcional):**
- `distrito` (string): Filtrar por distrito específico

**Respuesta exitosa (200):**
```json
{
  "success": true,
  "data": {
    "estadisticasPorDistrito": [
      {
        "distrito": "CARABANCHEL",
        "totalContenedores": 4439,
        "distribucionPorTipo": {
          "ENVASES": 915,
          "ORGANICA": 860,
          "PAPEL-CARTON": 825,
          "RESTO": 980,
          "VIDRIO": 859
        },
        "porcentajeDelTotal": 11.69
      }
    ],
    "totalDistritos": 21
  }
}
```

### GET /containers/stats/neighborhood
**Descripción:** Estadísticas de contenedores por barrio
**Autenticación:** Requerida
**Rate Limit:** 100 req/15min

**Query Parameters (requerido):**
- `distrito` (string): Nombre del distrito

**Ejemplo:** `GET /containers/stats/neighborhood?distrito=HORTALEZA`

**Respuesta exitosa (200):**
```json
{
  "success": true,
  "data": {
    "distrito": "HORTALEZA",
    "estadisticasPorBarrio": [
      {
        "barrio": "PINAR DEL REY",
        "totalContenedores": 450,
        "distribucionPorTipo": {
          "ENVASES": 92,
          "ORGANICA": 88,
          "PAPEL-CARTON": 85,
          "RESTO": 98,
          "VIDRIO": 87
        }
      }
    ],
    "totalBarrios": 8,
    "totalContenedoresDistrito": 2565
  }
}
```

### GET /containers/count-by-type
**Descripción:** Conteo de contenedores por tipo
**Autenticación:** Requerida
**Rate Limit:** 100 req/15min

**Query Parameters (requerido):**
- `distrito` (string): Nombre del distrito

**Respuesta exitosa (200):**
```json
{
  "success": true,
  "data": {
    "distrito": "CENTRO",
    "conteoPorTipo": [
      {
        "tipo": "RESTO",
        "cantidad": 520,
        "porcentaje": 23.85
      },
      {
        "tipo": "ENVASES",
        "cantidad": 450,
        "porcentaje": 20.64
      }
    ],
    "totalContenedores": 2180
  }
}
```

### GET /containers/districts
**Descripción:** Listar todos los distritos disponibles
**Autenticación:** Requerida
**Rate Limit:** 100 req/15min

**Respuesta exitosa (200):**
```json
{
  "success": true,
  "data": {
    "distritos": [
      "CARABANCHEL",
      "CENTRO",
      "FUENCARRAL-EL PARDO",
      "HORTALEZA",
      "LATINA",
      ...
    ],
    "totalDistritos": 21
  }
}
```

### GET /containers/neighborhoods/:distrito
**Descripción:** Listar barrios de un distrito
**Autenticación:** Requerida
**Rate Limit:** 100 req/15min

**Parámetros de ruta:**
- `distrito` (string, requerido): Nombre del distrito

**Ejemplo:** `GET /containers/neighborhoods/HORTALEZA`

**Respuesta exitosa (200):**
```json
{
  "success": true,
  "data": {
    "distrito": "HORTALEZA",
    "barrios": [
      "PINAR DEL REY",
      "APÓSTOL SANTIAGO",
      "VALDEFUENTES",
      ...
    ],
    "totalBarrios": 8
  }
}
```

### GET /containers/search
**Descripción:** Buscar contenedores por dirección (nombre de vía)
**Autenticación:** Requerida
**Rate Limit:** 100 req/15min

**Query Parameters (requerido):**
- `q` (string): Término de búsqueda (nombre de vía)
- `limit` (number): Límite de resultados (default: 20, max: 100)

**Ejemplo:** `GET /containers/search?q=GRAN VIA&limit=10`

**Respuesta exitosa (200):**
```json
{
  "success": true,
  "data": {
    "terminoBusqueda": "GRAN VIA",
    "contenedores": [
      {
        "_id": "...",
        "tipoContenedor": "VIDRIO",
        "direccion": {
          "tipoVia": "Calle",
          "nombre": "Gran Vía",
          "numero": "25"
        },
        "distrito": "CENTRO",
        "location": {
          "coordinates": [-3.7045, 40.4200]
        }
      }
    ],
    "totalEncontrados": 12
  }
}
```

### GET /containers/heatmap
**Descripción:** Datos para generar mapa de calor de contenedores
**Autenticación:** Requerida
**Rate Limit:** 100 req/15min

**Query Parameters (opcional):**
- `tipoContenedor` (string): Filtrar por tipo específico
- `distrito` (string): Filtrar por distrito

**Ejemplo:** `GET /containers/heatmap?tipoContenedor=ORGANICA`

**Respuesta exitosa (200):**
```json
{
  "success": true,
  "data": {
    "tipo": "FeatureCollection",
    "features": [
      {
        "type": "Feature",
        "geometry": {
          "type": "Point",
          "coordinates": [-3.6375, 40.4685]
        },
        "properties": {
          "tipoContenedor": "ORGANICA",
          "distrito": "HORTALEZA",
          "cantidad": 1
        }
      }
    ],
    "totalPuntos": 7316,
    "filtros": {
      "tipoContenedor": "ORGANICA"
    }
  }
}
```

### GET /containers/coverage
**Descripción:** Análisis de cobertura de contenedores por zona
**Autenticación:** Requerida
**Rate Limit:** 100 req/15min

**Query Parameters (opcional):**
- `distrito` (string): Filtrar por distrito

**Respuesta exitosa (200):**
```json
{
  "success": true,
  "data": {
    "distrito": "HORTALEZA",
    "totalContenedores": 2565,
    "coberturaPorTipo": {
      "ORGANICA": {
        "cantidad": 498,
        "porcentajeCobertura": 19.42,
        "estado": "Adecuado"
      },
      "RESTO": {
        "cantidad": 528,
        "porcentajeCobertura": 20.58,
        "estado": "Adecuado"
      }
    },
    "ratioContenedoresPorKm2": 85.5,
    "evaluacionGeneral": "Cobertura adecuada en todas las categorías"
  }
}
```

---

## Administración

Base path: `/admin`

### GET /admin/cache/stats
**Descripción:** Estadísticas de caché del sistema
**Autenticación:** Requerida (rol admin recomendado)
**Rate Limit:** General

**Respuesta exitosa (200):**
```json
{
  "success": true,
  "data": {
    "cacheSize": 150,
    "hitRate": 85.5,
    "missRate": 14.5,
    "totalRequests": 10000
  }
}
```

### GET /admin/system/health
**Descripción:** Estado de salud del sistema (extendido)
**Autenticación:** Requerida (rol admin recomendado)
**Rate Limit:** General

**Respuesta exitosa (200):**
```json
{
  "success": true,
  "data": {
    "status": "healthy",
    "uptime": 86400,
    "database": {
      "status": "connected",
      "collections": 15,
      "indexes": 28
    },
    "memory": {
      "used": "256 MB",
      "available": "1024 MB"
    },
    "performance": {
      "avgResponseTime": 120,
      "requestsPerSecond": 50
    }
  }
}
```

---

## Códigos de Estado HTTP

### Exitosos (2xx)
- **200 OK**: Solicitud exitosa
- **201 Created**: Recurso creado exitosamente (ej: registro de usuario)

### Errores del Cliente (4xx)
- **400 Bad Request**: Datos de entrada inválidos o faltantes
- **401 Unauthorized**: No autenticado o token inválido/expirado
- **403 Forbidden**: Autenticado pero sin permisos suficientes
- **404 Not Found**: Recurso no encontrado
- **409 Conflict**: Conflicto (ej: email duplicado en registro)
- **422 Unprocessable Entity**: Error de validación de datos
- **429 Too Many Requests**: Límite de rate limit excedido

### Errores del Servidor (5xx)
- **500 Internal Server Error**: Error interno del servidor
- **503 Service Unavailable**: Servicio temporalmente no disponible

---

## Formato de Respuestas

### Respuesta Exitosa
```json
{
  "success": true,
  "message": "Mensaje descriptivo de la operación",
  "data": { ... },
  "pagination": {  // Solo en endpoints con paginación
    "currentPage": 1,
    "totalPages": 10,
    "totalRecords": 200,
    "recordsPerPage": 20,
    "hasNextPage": true,
    "hasPreviousPage": false
  }
}
```

### Respuesta de Error
```json
{
  "success": false,
  "error": {
    "message": "Descripción del error",
    "code": "ERROR_CODE",
    "details": { ... },  // Opcional: detalles adicionales
    "timestamp": "2025-10-06T10:30:00.000Z"
  }
}
```

---

## Autenticación

### Obtener Token
1. Registrarse: `POST /auth/register`
2. Iniciar sesión: `POST /auth/login`
3. Copiar el token recibido

### Usar Token en Requests
**Header de autorización:**
```
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

**O usar cookie HTTP-only** (se configura automáticamente al hacer login desde navegador)

---

## Rate Limiting

### Límites por Categoría
- **General**: 100 req/15min
- **Autenticación**: 10 req/15min (registro/login)
- **Consultas de datos**: 100 req/15min
- **Estadísticas/Agregaciones**: 50 req/15min

### Respuesta cuando se excede el límite (429)
```json
{
  "success": false,
  "error": {
    "message": "Demasiadas solicitudes. Por favor, intente más tarde.",
    "code": "RATE_LIMIT_EXCEEDED",
    "retryAfter": 900
  }
}
```

---

## Paginación

### Parámetros de Query
- `page` (number): Número de página (default: 1)
- `limit` (number): Registros por página (default: 20, max: 100)

### Ejemplo
```
GET /air-quality?page=2&limit=50
```

### Respuesta con información de paginación
```json
{
  "data": [ ... ],
  "pagination": {
    "currentPage": 2,
    "totalPages": 10,
    "totalRecords": 500,
    "recordsPerPage": 50,
    "hasNextPage": true,
    "hasPreviousPage": true
  }
}
```

---

## Filtros y Ordenamiento

### Filtros Comunes
- `startDate`, `endDate`: Rango de fechas (formato: YYYY-MM-DD)
- `distrito`: Código o nombre de distrito
- Campos específicos según el endpoint

### Ordenamiento
- `sortBy`: Campo por el que ordenar
- `sortOrder`: 'asc' (ascendente) o 'desc' (descendente)

**Ejemplo:**
```
GET /bikes?sortBy=totalUsos&sortOrder=desc&limit=10
```

---

## Notas Técnicas

### Fechas
- Formato de entrada: `YYYY-MM-DD`
- Formato de salida: ISO 8601 (`YYYY-MM-DDTHH:mm:ss.sssZ`)

### Coordenadas Geográficas
- Formato GeoJSON: `[longitude, latitude]`
- Sistema de referencia: WGS84 (EPSG:4326)
- Coordenadas UTM también disponibles en campo `coordenadas` (para contenedores)

### Búsquedas Geoespaciales
- Utilizan índices 2dsphere de MongoDB
- Distancias en metros
- Optimizadas para consultas rápidas

---

## Total de Endpoints por Módulo

- **Rutas Básicas**: 3
- **Autenticación**: 6
- **Calidad del Aire**: 5
- **Monitoreo de Ruido**: 5
- **Multas**: 7
- **Censo**: 7
- **Ubicaciones**: 6
- **Tráfico**: 5
- **Accidentes**: 6
- **Asignación de Patinetes**: 7
- **Disponibilidad de Bicicletas**: 13
- **Contenedores de Residuos**: 17
- **Administración**: 2

**Total: 89 endpoints**

---

**Última actualización:** 6 de octubre de 2025
**Versión de la API:** v0.1
