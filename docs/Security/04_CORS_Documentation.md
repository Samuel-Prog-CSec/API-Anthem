# Documentación CORS - API REST Anthem

## Índice

1. [Introducción](#introducción)
2. [¿Qué es CORS y por qué lo necesitamos?](#qué-es-cors-y-por-qué-lo-necesitamos)
3. [Nuestra Implementación](#nuestra-implementación)
4. [Configuración de Seguridad](#configuración-de-seguridad)
5. [Configuración por Entorno](#configuración-por-entorno)
6. [Cookies y Autenticación Cross-Origin](#cookies-y-autenticación-cross-origin)
7. [Preflight Requests](#preflight-requests)
8. [Integración con el Frontend](#integración-con-el-frontend)
9. [Troubleshooting](#troubleshooting)
10. [Decisiones Técnicas](#decisiones-técnicas)

---

## Introducción

Este documento describe la implementación y configuración de CORS (Cross-Origin Resource Sharing) en nuestra API REST para el proyecto Anthem. Hemos diseñado una solución robusta que balancea la seguridad con la usabilidad, permitiendo que frontends legítimos accedan a nuestra API mientras bloqueamos accesos no autorizados.

CORS es una tecnología fundamental para nuestra arquitectura, ya que nuestra API está diseñada para ser consumida por aplicaciones frontend que se ejecutan en dominios diferentes al de la API.

---

## ¿Qué es CORS y por qué lo necesitamos?

### El Problema: Same-Origin Policy

Por defecto, los navegadores web implementan una política de seguridad llamada **Same-Origin Policy** (Política del Mismo Origen) que impide que una página web realice peticiones HTTP a un dominio diferente del que la sirvió. Esto significa que si nuestro frontend está en `https://app.ejemplo.com` y nuestra API en `https://api.ejemplo.com`, las peticiones serían bloqueadas por defecto.

**Ejemplo del problema:**
```
Frontend: https://app.ejemplo.com
API:      https://api.ejemplo.com

❌ Petición bloqueada por Same-Origin Policy
```

### La Solución: CORS

CORS es un mecanismo que permite a los servidores indicar explícitamente qué orígenes externos están autorizados para acceder a sus recursos. Utilizando headers HTTP específicos, le decimos al navegador: "Estas peticiones desde estos orígenes están permitidas".

**Con CORS configurado:**
```
Frontend: https://app.ejemplo.com
API:      https://api.ejemplo.com

✅ Petición permitida mediante headers CORS
```

### Por qué lo necesitamos en nuestro proyecto

Nuestra API Anthem está diseñada como un servicio independiente que puede ser consumido por:

1. **Aplicaciones frontend web** en dominios diferentes
2. **Aplicaciones móviles** que usan webviews
3. **Herramientas de testing** (Postman, cURL) durante el desarrollo
4. **Otras APIs o servicios** en arquitecturas de microservicios

Sin CORS, ninguna de estas aplicaciones podría comunicarse con nuestra API desde el navegador.

---

## Nuestra Implementación

Hemos implementado CORS utilizando el paquete `cors` de npm junto con una configuración personalizada que prioriza la seguridad sin sacrificar la funcionalidad.

### Ubicación del Código

La configuración principal se encuentra en:
```
src/server.js - líneas 88-245
```

### Arquitectura de la Solución

```
┌─────────────────────────────────────────────────────────┐
│                    Petición Entrante                     │
└───────────────────────┬─────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────┐
│              1. Extracción del Origin                    │
│           (Header: Origin del navegador)                 │
└───────────────────────┬─────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────┐
│           2. Validaciones de Seguridad                   │
│   • ¿Existe origin?                                      │
│   • ¿Longitud válida? (< 2048 caracteres)               │
│   • ¿Origin es 'null'? (ataque)                         │
│   • ¿Formato URL válido?                                │
│   • ¿Protocolo seguro? (HTTPS en producción)            │
└───────────────────────┬─────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────┐
│         3. Comparación con Lista Permitida               │
│   • Normalización (lowercase, trim)                      │
│   • Coincidencia exacta                                  │
│   • Patrón wildcard subdominios (*.dominio.com)         │
└───────────────────────┬─────────────────────────────────┘
                        │
                ┌───────┴────────┐
                │                 │
                ▼                 ▼
        ✅ PERMITIDO      ❌ BLOQUEADO
                │                 │
                ▼                 ▼
    Headers CORS         Error + Log
    añadidos a           de seguridad
    la respuesta
```

---

## Configuración de Seguridad

Hemos implementado múltiples capas de seguridad para proteger nuestra API contra vectores de ataque comunes relacionados con CORS.

### 1. Validación de Longitud de Origin

**¿Qué protege?** Ataques de Denial of Service (DoS) mediante origins extremadamente largos.

```javascript
if (normalizedOrigin.length > 2048) {
  logger.warn({ originLength: normalizedOrigin.length },
    'Origin demasiado largo rechazado - posible ataque DoS');
  return callback(new Error('Not allowed by CORS'));
}
```

**Justificación:** Las URLs válidas rara vez superan los 2048 caracteres (límite de IE). Un origin excesivamente largo es sospechoso y podría intentar causar problemas de memoria o procesamiento.

### 2. Protección contra 'null' Origin

**¿Qué protege?** Bypass de CORS mediante sandboxed iframes o redirecciones.

```javascript
if (normalizedOrigin === 'null') {
  logger.warn({ originalOrigin: origin },
    'Origen null bloqueado - posible ataque de CORS bypass');
  return callback(new Error('Not allowed by CORS'));
}
```

**Justificación:** El origin `'null'` (string literal) puede ser inyectado por atacantes usando iframes con el atributo `sandbox` o mediante ciertos esquemas de redirección. Este es un vector de ataque documentado en OWASP.

### 3. Validación de Formato URL

**¿Qué protege?** Origins malformados que podrían causar vulnerabilidades o comportamientos inesperados.

```javascript
try {
  const originUrl = new URL(normalizedOrigin);
  // Validaciones adicionales del protocolo
} catch (error) {
  logger.warn({ origin: normalizedOrigin, error: error.message },
    'Formato de origin inválido');
  return callback(new Error('Not allowed by CORS'));
}
```

**Justificación:** Solo aceptamos origins que sean URLs válidas. Esto previene inyección de strings arbitrarios y asegura que podemos procesar el origin de forma segura.

### 4. Rechazo de HTTP en Producción

**¿Qué protege?** Man-in-the-Middle attacks, downgrade attacks, y transmisión de credenciales en texto plano.

```javascript
if (config.server.env === 'production' && originUrl.protocol === 'http:') {
  logger.warn({ origin: normalizedOrigin },
    'Origen HTTP bloqueado en producción - solo HTTPS permitido');
  return callback(new Error('Not allowed by CORS'));
}
```

**Justificación:** En producción, todas las comunicaciones deben ser cifradas. Rechazar HTTP previene que las credenciales (JWT, cookies) viajen en texto plano, incluso si un atacante intenta forzar una conexión no segura.

### 5. Control de Peticiones sin Origin

**¿Qué protege?** Acceso no autorizado desde herramientas automatizadas o scripts maliciosos.

```javascript
if (!origin) {
  if (config.server.env === 'production') {
    logger.warn({ context: 'CORS validation' },
      'Petición sin origin bloqueada en producción');
    return callback(new Error('Not allowed by CORS'));
  }
  logger.debug('Petición sin origin permitida en desarrollo');
  return callback(null, true);
}
```

**Justificación:**

- **Desarrollo:** Permitimos peticiones sin origin para facilitar testing con Postman, cURL, y herramientas similares.
- **Producción:** Las bloqueamos porque las peticiones legítimas desde navegadores siempre incluyen el header Origin. Las peticiones sin origin en producción son sospechosas.

### 6. Protección contra Wildcard con Credentials

**¿Qué protege?** Configuración insegura que permitiría a cualquier origen acceder a credenciales.

```javascript
if (config.security.corsOrigins.includes('*')) {
  if (config.server.env === 'production') {
    logger.error({ origin, env: config.server.env },
      'CORS mal configurado: wildcard (*) no permitido en producción con credentials');
    return callback(new Error('CORS misconfiguration'));
  }
  // Advertencia en desarrollo
}
```

**Justificación:** Según RFC 6454, el wildcard `*` es incompatible con `credentials: true`. Esto es una medida de seguridad fundamental: no podemos permitir que **cualquier** origen acceda a las credenciales (cookies, JWT) de nuestros usuarios.

### 7. Normalización de Origins

**¿Qué protege?** Bypass mediante diferencias de capitalización o espacios.

```javascript
const normalizedOrigin = origin.trim().toLowerCase();
const normalizedAllowed = allowedOrigin.trim().toLowerCase();
```

**Justificación:** Los navegadores son case-insensitive para dominios. Un atacante podría intentar `HTTP://API.EJEMPLO.COM` vs `http://api.ejemplo.com`. Normalizamos para comparación segura.

### 8. Soporte para Wildcard Subdominios Seguro

**¿Qué protege?** Matches incorrectos que podrían permitir dominios no deseados.

```javascript
if (normalizedAllowed.startsWith('*.')) {
  const domain = normalizedAllowed.slice(2);
  const originUrl = new URL(normalizedOrigin);
  const hostname = originUrl.hostname;

  const endsWithDomain = hostname.endsWith(`.${domain}`) || hostname === domain;
  const hasValidSubdomainFormat = hostname.split('.').length >= domain.split('.').length;

  return endsWithDomain && hasValidSubdomainFormat;
}
```

**Justificación:** Implementamos wildcard subdominios de forma segura:

- `*.ejemplo.com` permite `app.ejemplo.com`, `admin.ejemplo.com`, etc.
- También permite `ejemplo.com` (dominio base)
- NO permite matches incorrectos como `malicioso-ejemplo.com`
- Valida que la estructura de subdominios sea correcta

---

## Configuración por Entorno

Hemos diseñado diferentes niveles de seguridad según el entorno de ejecución.

### Desarrollo (`NODE_ENV=development`)

**Configuración en `.env`:**
```env
NODE_ENV=development
CORS_ORIGINS=http://localhost:3030,http://localhost:3031,http://127.0.0.1:3000
```

**Características:**

| Característica | Estado | Justificación |
|----------------|--------|---------------|
| Peticiones sin origin | ✅ Permitidas | Facilita testing con Postman/cURL |
| HTTP origins | ✅ Permitidas | Desarrollo local no tiene HTTPS |
| Wildcard `*` | ⚠️ Advertencia | Permitido pero se registra advertencia |
| Múltiples puertos | ✅ Soportado | Múltiples frontends en desarrollo |

**Por qué es así:** En desarrollo priorizamos la velocidad de iteración y facilidad de testing. Los desarrolladores necesitan probar desde múltiples herramientas y puertos locales sin fricciones.

### Producción (`NODE_ENV=production`)

**Configuración en `.env`:**
```env
NODE_ENV=production
CORS_ORIGINS=https://app.ejemplo.com,https://admin.ejemplo.com
```

**Características:**

| Característica | Estado | Justificación |
|----------------|--------|---------------|
| Peticiones sin origin | ❌ Bloqueadas | Seguridad: peticiones legítimas siempre tienen origin |
| HTTP origins | ❌ Bloqueadas | Seguridad: solo HTTPS en producción |
| Wildcard `*` | ❌ Error fatal | Incompatible con credentials |
| Origins específicos | ✅ Obligatorio | Control granular de acceso |

**Por qué es así:** En producción la seguridad es prioritaria. Solo permitimos acceso desde origins específicos y verificados, todos usando HTTPS. Cualquier desviación de esta configuración genera errores y logs detallados.

### Wildcard Subdominios

**Configuración:**
```env
CORS_ORIGINS=https://*.ejemplo.com
```

**Uso:**

Esta configuración es útil cuando tenemos múltiples subdominios dinámicos:

- ✅ `https://app.ejemplo.com`
- ✅ `https://admin.ejemplo.com`
- ✅ `https://dashboard.ejemplo.com`
- ✅ `https://ejemplo.com` (dominio base incluido)
- ❌ `https://malicioso.com`
- ❌ `https://ejemplo.com.malicioso.com`

**Cuándo usarlo:**

- SaaS con subdominios por cliente (ej: `cliente1.ejemplo.com`)
- Múltiples aplicaciones en subdominios
- Arquitectura de microservicios con subdominios

**Precauciones:**

- Solo usar con dominios que controlamos completamente
- Todos los subdominios tendrán acceso a la API
- Considerar si realmente necesitamos wildcard o podemos listar subdominios específicos

---

## Cookies y Autenticación Cross-Origin

Una de las partes más complejas de CORS es el manejo de cookies y credenciales en contextos cross-origin. Nuestra API usa JWT almacenados en cookies HttpOnly, lo que requiere configuración específica.

### Configuración de CORS para Credentials

```javascript
credentials: true
```

Este flag indica que nuestra API acepta peticiones que incluyen credenciales (cookies, headers de autenticación).

**Implicaciones:**

1. **No podemos usar wildcard `*`** - RFC 6454 lo prohíbe explícitamente
2. **Debemos especificar el origin exacto** en la respuesta
3. **El navegador solo enviará cookies** si el frontend lo solicita explícitamente

### Configuración de Cookies en Producción

```javascript
if (config.server.env === 'production') {
  app.use((req, res, next) => {
    const originalCookie = res.cookie.bind(res);
    res.cookie = (name, value, options = {}) => {
      return originalCookie(name, value, {
        httpOnly: true,          // No accesible desde JavaScript
        secure: true,            // Solo HTTPS
        sameSite: 'none',        // Permite CORS con credentials
        ...options
      });
    };
    next();
  });
}
```

**Explicación de cada opción:**

#### `httpOnly: true`

**¿Qué hace?** Impide que JavaScript acceda a la cookie mediante `document.cookie`.

**¿Por qué?** Protección contra ataques XSS (Cross-Site Scripting). Incluso si un atacante logra inyectar JavaScript malicioso en nuestro frontend, no podrá robar el JWT de las cookies.

**Ejemplo de protección:**
```javascript
// ❌ Con httpOnly=true, esto devuelve una string vacía
console.log(document.cookie);
// El atacante NO puede robar el JWT
```

#### `secure: true`

**¿Qué hace?** La cookie solo se envía por conexiones HTTPS, nunca por HTTP.

**¿Por qué?** Previene que la cookie (con el JWT) viaje en texto plano por la red, donde podría ser interceptada por un atacante en un ataque Man-in-the-Middle.

**Requisito:** El servidor DEBE estar usando HTTPS, de lo contrario el navegador rechazará la cookie.

#### `sameSite: 'none'`

**¿Qué hace?** Permite que la cookie se envíe en contextos cross-origin (cuando el frontend está en un dominio diferente al de la API).

**¿Por qué?** Es necesario para nuestra arquitectura donde la API y el frontend están en dominios separados.

**Requisito CRÍTICO:** `sameSite: 'none'` REQUIERE `secure: true`. Los navegadores modernos rechazan cookies con `sameSite: 'none'` sin el flag `secure`.

**Valores posibles de sameSite:**

| Valor | Descripción | Uso en nuestro proyecto |
|-------|-------------|------------------------|
| `strict` | Cookie solo se envía en same-origin | ❌ No funciona con CORS |
| `lax` | Cookie se envía en navegación top-level | ❌ No funciona con API calls |
| `none` | Cookie se envía en todos los contextos | ✅ Necesario para CORS |

### Flujo Completo de Autenticación Cross-Origin

```
1. Usuario hace login desde frontend (https://app.ejemplo.com)
   │
   ▼
2. Frontend envía POST /api/v0.1/auth/login con credentials: 'include'
   │
   ▼
3. API valida credenciales y genera JWT
   │
   ▼
4. API envía JWT en cookie HttpOnly con sameSite='none', secure=true
   │
   ▼
5. Navegador guarda cookie asociada al dominio de la API
   │
   ▼
6. En próximas peticiones, frontend usa credentials: 'include'
   │
   ▼
7. Navegador envía automáticamente la cookie en cada petición
   │
   ▼
8. API valida JWT de la cookie y autoriza acceso
```

---

## Preflight Requests

Los preflight requests son un concepto fundamental de CORS que debemos entender para configurar correctamente nuestra API.

### ¿Qué son?

Son peticiones HTTP OPTIONS automáticas que el navegador envía **antes** de la petición real para verificar si el servidor permite la operación cross-origin.

**Ejemplo:**

```
Frontend quiere hacer: POST /api/v0.1/users

1. Navegador envía PRIMERO:
   OPTIONS /api/v0.1/users
   Origin: https://app.ejemplo.com
   Access-Control-Request-Method: POST
   Access-Control-Request-Headers: Content-Type, Authorization

2. Servidor responde:
   Access-Control-Allow-Origin: https://app.ejemplo.com
   Access-Control-Allow-Methods: POST, GET, PUT, DELETE
   Access-Control-Allow-Headers: Content-Type, Authorization
   Access-Control-Max-Age: 3600

3. Si la respuesta es válida, navegador envía la petición real:
   POST /api/v0.1/users
```

### Cuándo se disparan

No todas las peticiones requieren preflight. Solo las que cumplen **alguna** de estas condiciones:

**Métodos que requieren preflight:**
- PUT
- DELETE
- PATCH

**Content-Types que requieren preflight:**
- `application/json`
- Cualquier Content-Type que no sea:
  - `application/x-www-form-urlencoded`
  - `multipart/form-data`
  - `text/plain`

**Headers personalizados que requieren preflight:**
- `Authorization`
- Cualquier header que no sea:
  - `Accept`
  - `Accept-Language`
  - `Content-Language`
  - `Content-Type` (con los valores seguros)

**Peticiones que NO requieren preflight (Simple Requests):**
- GET con headers estándar
- POST con `application/x-www-form-urlencoded` y sin headers personalizados

### Nuestra Configuración de Preflight

```javascript
{
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: [
    'Origin',
    'X-Requested-With',
    'Content-Type',
    'Accept',
    'Authorization',
    'X-Request-ID'
  ],
  exposedHeaders: [
    'Content-Length',
    'Content-Type',
    'X-Request-ID',
    'X-RateLimit-Limit',
    'X-RateLimit-Remaining',
    'X-RateLimit-Reset'
  ],
  maxAge: 3600,
  preflightContinue: false
}
```

**Explicación de cada opción:**

#### `methods`

Headers HTTP que permitimos. Hemos incluido solo los necesarios para operaciones REST estándar. Notamos que **NO** incluimos `HEAD` porque no lo necesitamos en nuestra API.

#### `allowedHeaders`

Headers que el cliente puede enviar en la petición. Incluimos:

- **`Authorization`**: Para JWT en header (alternativa a cookies)
- **`Content-Type`**: Necesario para enviar JSON
- **`X-Request-ID`**: Para tracing y debugging
- **`X-Requested-With`**: Header estándar de peticiones AJAX

NO incluimos headers que no usamos como `X-API-Key` o `Cache-Control` para minimizar la superficie de ataque.

#### `exposedHeaders`

Headers de la respuesta que el código JavaScript del cliente puede leer. Por defecto, el navegador solo expone headers básicos. Si queremos que el frontend lea otros, debemos listarlos aquí.

Exponemos:
- **`X-Request-ID`**: Para que el frontend pueda mostrar/reportar el ID de petición en caso de error
- **`X-RateLimit-*`**: Para que el frontend pueda implementar lógica de rate limiting (ej: mostrar mensaje "demasiadas peticiones")

NO exponemos headers sensibles como tokens o información interna.

#### `maxAge: 3600`

Indica cuánto tiempo (en segundos) el navegador puede cachear la respuesta preflight.

**Decisión de diseño:** Usamos 1 hora (3600 segundos) en lugar de 24 horas.

**Justificación:**
- ✅ **Ventaja:** Reduce latencia al evitar preflights repetidos durante 1 hora
- ✅ **Ventaja:** Mayor flexibilidad - cambios en la configuración CORS se reflejan en 1 hora máximo
- ⚠️ **Trade-off:** Más preflights que con 24 horas, pero el impacto es mínimo
- 💡 **Conclusión:** El balance correcto entre performance y flexibilidad

#### `preflightContinue: false`

Indica que el middleware CORS debe responder directamente a las peticiones OPTIONS sin pasar al siguiente handler.

**Por qué:** Las peticiones OPTIONS son solo para validación CORS, no necesitan llegar a nuestros controladores. Esto mejora la performance.

### Optimización del Header Vary

```javascript
app.use((req, res, next) => {
  const varyHeaders = ['Origin'];

  if (req.method === 'OPTIONS') {
    varyHeaders.push('Access-Control-Request-Headers', 'Access-Control-Request-Method');
  }

  res.setHeader('Vary', varyHeaders.join(', '));
  next();
});
```

**¿Por qué es importante?**

El header `Vary` indica a CDNs, proxies y navegadores que la respuesta varía según ciertos headers de la petición. Sin esto, un CDN podría servir una respuesta con headers CORS incorrectos desde caché.

**Ejemplo del problema sin Vary:**

```
1. Usuario A desde https://app.ejemplo.com hace petición
   → CDN cachea respuesta con: Access-Control-Allow-Origin: https://app.ejemplo.com

2. Usuario B desde https://malicioso.com hace petición
   → CDN sirve la MISMA respuesta desde caché
   → Headers CORS incorrectos: Access-Control-Allow-Origin: https://app.ejemplo.com
   → Navegador permite la petición porque el header coincide (ERROR DE SEGURIDAD)
```

**Con Vary: Origin:**

```
1. Usuario A desde https://app.ejemplo.com
   → CDN cachea con key: "endpoint + Origin: https://app.ejemplo.com"

2. Usuario B desde https://malicioso.com
   → CDN ve Origin diferente → NO usa caché → hace nueva petición
   → API rechaza porque malicioso.com no está permitido
```

---

## Integración con el Frontend

Para que CORS funcione correctamente, el frontend debe configurarse apropiadamente.

### JavaScript Fetch API

```javascript
fetch('https://api.ejemplo.com/api/v0.1/users', {
  method: 'GET',
  credentials: 'include',  // ⚠️ CRÍTICO: envía cookies cross-origin
  headers: {
    'Content-Type': 'application/json'
  }
})
.then(response => response.json())
.then(data => console.log(data))
.catch(error => console.error('Error:', error));
```

**Punto clave:** `credentials: 'include'` es OBLIGATORIO para enviar cookies en peticiones cross-origin.

### Axios

```javascript
import axios from 'axios';

// Configuración global
axios.defaults.withCredentials = true;

// O por petición
axios.get('https://api.ejemplo.com/api/v0.1/users', {
  withCredentials: true  // ⚠️ CRÍTICO: envía cookies cross-origin
})
.then(response => console.log(response.data))
.catch(error => console.error('Error:', error));
```

### XMLHttpRequest

```javascript
const xhr = new XMLHttpRequest();
xhr.withCredentials = true;  // ⚠️ CRÍTICO
xhr.open('GET', 'https://api.ejemplo.com/api/v0.1/users');
xhr.onload = function() {
  console.log(JSON.parse(this.responseText));
};
xhr.send();
```

### Errores Comunes en el Frontend

#### 1. Olvidar `credentials: 'include'`

```javascript
// ❌ INCORRECTO - cookies no se envían
fetch('https://api.ejemplo.com/api/v0.1/users')

// ✅ CORRECTO
fetch('https://api.ejemplo.com/api/v0.1/users', {
  credentials: 'include'
})
```

**Síntoma:** Peticiones anónimas, usuario aparece como no autenticado.

#### 2. Origin incorrecto en configuración

```javascript
// Si el frontend está en https://app.ejemplo.com
// pero en .env tenemos:
CORS_ORIGINS=https://app.ejemplo.es  // ❌ INCORRECTO (.es en lugar de .com)
```

**Síntoma:** Error de CORS en consola del navegador.

#### 3. HTTP en producción

```javascript
// Frontend en HTTPS pero API en HTTP
fetch('http://api.ejemplo.com/api/v0.1/users', {  // ❌ HTTP
  credentials: 'include'
})
```

**Síntoma:** Navegadores modernos bloquean la petición (Mixed Content).

---

## Troubleshooting

### Error: "No 'Access-Control-Allow-Origin' header is present"

**Descripción completa del error en consola:**
```
Access to fetch at 'https://api.ejemplo.com/api/v0.1/users' from origin
'https://app.ejemplo.com' has been blocked by CORS policy:
No 'Access-Control-Allow-Origin' header is present on the requested resource.
```

**Causa:** El origin desde el que se hace la petición no está en nuestra lista permitida.

**Diagnóstico:**

1. **Verificar el origin exacto** en la consola del navegador:
   ```javascript
   console.log(window.location.origin);
   ```

2. **Revisar configuración del servidor:**
   ```bash
   # Verificar .env
   cat .env | grep CORS_ORIGINS
   ```

3. **Revisar logs del servidor** (buscamos la línea de origin bloqueado):
   ```
   [warn]: Solicitud CORS bloqueada desde origin no autorizado
   origin: "https://app.ejemplo.com"
   allowedOrigins: ["https://api.ejemplo.com"]
   ```

**Soluciones:**

1. **Añadir el origin a la lista permitida:**
   ```env
   CORS_ORIGINS=https://app.ejemplo.com,https://admin.ejemplo.com
   ```

2. **Reiniciar el servidor:**
   ```bash
   npm run dev
   ```

3. **Verificar que no hay espacios extra:**
   ```env
   # ❌ INCORRECTO
   CORS_ORIGINS=https://app.ejemplo.com , https://admin.ejemplo.com

   # ✅ CORRECTO
   CORS_ORIGINS=https://app.ejemplo.com,https://admin.ejemplo.com
   ```

---

### Error: "The value of 'Access-Control-Allow-Credentials' header is not 'true'"

**Descripción completa:**
```
Access to fetch at 'https://api.ejemplo.com/api/v0.1/users' from origin
'https://app.ejemplo.com' has been blocked by CORS policy:
The value of the 'Access-Control-Allow-Credentials' header in the response
is '' which must be 'true' when the request's credentials mode is 'include'.
```

**Causa:** El frontend está enviando `credentials: 'include'` pero nuestra API no tiene `credentials: true` en la configuración CORS.

**Diagnóstico:**

1. **Verificar configuración del servidor** en `src/server.js`:
   ```javascript
   credentials: true  // Debe estar presente
   ```

2. **Verificar que no estamos usando wildcard:**
   ```env
   # ❌ Esto causa el error con credentials
   CORS_ORIGINS=*
   ```

**Soluciones:**

1. **Asegurar que `credentials: true` está en corsOptions** (ya lo tenemos)

2. **Si usamos wildcard, cambiarlo a origins específicos:**
   ```env
   # Cambiar de:
   CORS_ORIGINS=*

   # A:
   CORS_ORIGINS=https://app.ejemplo.com
   ```

3. **O, si no necesitamos cookies, quitar del frontend:**
   ```javascript
   // Opción A: Usar auth por header en lugar de cookie
   fetch('https://api.ejemplo.com/api/v0.1/users', {
     headers: {
       'Authorization': `Bearer ${token}`
     }
   })
   ```

---

### Error: "The value of 'Access-Control-Allow-Origin' must not be '*'"

**Descripción completa:**
```
Access to fetch at 'https://api.ejemplo.com/api/v0.1/users' from origin
'https://app.ejemplo.com' has been blocked by CORS policy:
The value of the 'Access-Control-Allow-Origin' header in the response
must not be the wildcard '*' when the request's credentials mode is 'include'.
```

**Causa:** Tenemos `CORS_ORIGINS=*` en `.env` mientras usamos `credentials: true`. Esto es incompatible según RFC 6454.

**Solución:**

```env
# Cambiar de:
CORS_ORIGINS=*

# A origins específicos:
CORS_ORIGINS=https://app.ejemplo.com,https://admin.ejemplo.com
```

---

### Cookies no se envían en peticiones cross-origin

**Síntomas:**
- El usuario aparece como no autenticado
- JWT no llega al servidor
- En Network tab del navegador, las cookies no aparecen en la petición

**Diagnóstico:**

1. **Verificar que el frontend usa `credentials: 'include'`:**
   ```javascript
   // Verificar en el código del frontend
   fetch(url, { credentials: 'include' })
   ```

2. **Verificar en DevTools → Application → Cookies:**
   - ¿La cookie existe?
   - ¿Tiene `SameSite=None`?
   - ¿Tiene `Secure=true`?

3. **Verificar protocolo:**
   ```
   ✅ Frontend: HTTPS, API: HTTPS → OK
   ❌ Frontend: HTTPS, API: HTTP → FAIL
   ⚠️ Frontend: HTTP, API: HTTP → OK solo en desarrollo
   ```

**Soluciones:**

1. **Si falta `credentials: 'include'` en el frontend:**
   ```javascript
   // Axios
   axios.defaults.withCredentials = true;

   // Fetch
   fetch(url, { credentials: 'include' })
   ```

2. **Si la cookie no tiene los flags correctos**, verificar configuración del servidor (ya lo tenemos correcto):
   ```javascript
   sameSite: 'none',
   secure: true
   ```

3. **Si estamos en HTTP local**, usar este workaround temporal:
   ```javascript
   // Solo para desarrollo local
   sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
   secure: process.env.NODE_ENV === 'production'
   ```

---

### Preflight request falla (OPTIONS returns error)

**Síntomas:**
- La petición OPTIONS devuelve 404, 500, o cualquier código que no sea 2xx
- La petición real nunca se envía

**Causa común:** El route de la API no maneja correctamente OPTIONS.

**Diagnóstico:**

1. **Verificar en Network tab:**
   - Buscar la petición OPTIONS
   - Ver su status code
   - Ver si tiene los headers CORS correctos

2. **Verificar que cors middleware está antes de los routes:**
   ```javascript
   // ✅ CORRECTO - CORS antes de routes
   app.use(cors(corsOptions));
   app.use('/api/v0.1', routes);

   // ❌ INCORRECTO - routes antes de CORS
   app.use('/api/v0.1', routes);
   app.use(cors(corsOptions));
   ```

**Solución:**

Nuestra configuración ya es correcta, pero si aparece este error:

1. **Verificar orden de middlewares** en `server.js`
2. **Verificar que `preflightContinue: false`** está configurado
3. **Revisar logs del servidor** para ver qué está devolviendo la petición OPTIONS

---

## Decisiones Técnicas

Documentamos aquí las decisiones de diseño importantes y sus justificaciones.

### Decisión 1: `maxAge` de 1 hora en lugar de 24 horas

**Contexto:** El header `Access-Control-Max-Age` controla cuánto tiempo el navegador cachea la respuesta de una petición preflight.

**Opciones consideradas:**

| Opción | Ventajas | Desventajas |
|--------|----------|-------------|
| 5 min (300s) | Cambios muy rápidos | Demasiados preflights |
| 1 hora (3600s) | Balance | - |
| 24 horas (86400s) | Menos preflights | Cambios tardan 24h |

**Decisión:** 1 hora (3600 segundos)

**Justificación:**
- En desarrollo, permitimos cambiar la configuración CORS y que se refleje en 1 hora máximo
- En producción, rara vez cambiamos CORS, pero cuando lo hacemos queremos que se propague rápido
- El overhead de preflights adicionales es mínimo (pocos milisegundos)
- Mejor flexibilidad operacional

---

### Decisión 2: Bloquear peticiones sin origin en producción

**Contexto:** Las peticiones sin el header `Origin` pueden venir de Postman, cURL, apps móviles, o solicitudes servidor-a-servidor.

**Opciones consideradas:**

| Opción | Ventajas | Desventajas |
|--------|----------|-------------|
| Permitir siempre | Flexibilidad máxima | Posible vector de ataque |
| Bloquear siempre | Máxima seguridad | No podemos usar Postman |
| Depender del entorno | Balance | Complejidad |

**Decisión:** Permitir en desarrollo, bloquear en producción

**Justificación:**
- Las peticiones legítimas desde navegadores SIEMPRE incluyen `Origin`
- En desarrollo necesitamos flexibilidad para testing
- En producción, peticiones sin origin son sospechosas
- Si necesitamos APIs servidor-a-servidor, podemos crear endpoints específicos sin CORS

**Alternativas si necesitamos S2S en producción:**
1. Crear endpoints internos sin CORS (`/internal/*`)
2. Usar autenticación por API Key en lugar de cookies
3. Usar una allowlist de IPs para peticiones sin origin

---

### Decisión 3: No incluir método HEAD ni header Cache-Control

**Contexto:** La configuración original incluía más métodos y headers de los que realmente necesitamos.

**Métodos eliminados:**
- `HEAD`

**Headers eliminados:**
- `Cache-Control`
- `X-API-Key`

**Decisión:** Incluir solo lo que usamos activamente

**Justificación:**
- **Principio de mínimo privilegio**: Solo exponemos lo que necesitamos
- **HEAD**: No lo usamos en ningún endpoint de nuestra API
- **Cache-Control**: No necesitamos que el cliente lo envíe
- **X-API-Key**: No usamos este método de autenticación
- **Menor superficie de ataque**: Menos opciones = menos vectores de ataque potenciales

**Impacto:** Ninguno negativo, ya que no estábamos usando estos métodos/headers

---

### Decisión 4: Normalización case-insensitive de origins

**Contexto:** Los dominios son case-insensitive según RFC, pero JavaScript no lo es por defecto.

**Problema potencial:**
```javascript
'https://API.ejemplo.com' !== 'https://api.ejemplo.com'  // en JavaScript puro
```

Pero para el navegador, ambos son el mismo origin.

**Decisión:** Normalizar a lowercase tanto el origin recibido como los configurados

```javascript
const normalizedOrigin = origin.trim().toLowerCase();
const normalizedAllowed = allowedOrigin.trim().toLowerCase();
```

**Justificación:**
- Previene bypass por diferencias de capitalización
- Consistente con cómo funcionan los navegadores
- Mejor experiencia de developer (no tener que recordar capitalización exacta)
- También hacemos `.trim()` para eliminar espacios accidentales

---

### Decisión 5: Límite de 2048 caracteres para origins

**Contexto:** Necesitamos prevenir ataques de DoS mediante origins extremadamente largos.

**Opciones consideradas:**

| Límite | Justificación |
|--------|---------------|
| 256 | Demasiado restrictivo, algunos URLs legítimos podrían fallar |
| 2048 | Límite histórico de IE, suficiente para URLs reales |
| 4096 | Más generoso pero posible vector de ataque |
| Sin límite | Vulnerable a DoS |

**Decisión:** 2048 caracteres

**Justificación:**
- Internet Explorer históricamente tenía límite de 2048 caracteres para URLs
- URLs reales rara vez exceden 1000 caracteres
- Un origin de más de 2048 caracteres es altamente sospechoso
- Previene intentos de DoS con payloads enormes
- Balance entre seguridad y compatibilidad

---

### Decisión 6: Logging detallado de eventos CORS

**Contexto:** CORS puede ser difícil de debuggear cuando falla.

**Decisión:** Implementar logging exhaustivo con diferentes niveles

```javascript
// Origins bloqueados → WARN
logger.warn({ origin, allowedOrigins }, 'Solicitud CORS bloqueada...');

// Origins permitidos → DEBUG
logger.debug({ origin }, 'Solicitud CORS permitida...');

// Configuración incorrecta → ERROR
logger.error({ origin, env }, 'CORS mal configurado...');
```

**Justificación:**
- **Troubleshooting:** Los logs facilitan identificar por qué una petición fue bloqueada
- **Auditoría**: Podemos ver qué origins están intentando acceder
- **Detección de ataques**: Múltiples peticiones de origins sospechosos son visibles en logs
- **Diferentes niveles**: En producción podemos filtrar por nivel (ej: solo WARN y ERROR)

**Información incluida:**
- Origin exacto (para copiar/pegar a configuración)
- Lista de origins permitidos (para comparación)
- Contexto del error (longitud, formato, protocolo)

---

## Resumen de Configuración

Para referencia rápida, aquí está nuestra configuración completa de CORS:

```javascript
// src/server.js

const corsOptions = {
  origin: function (origin, callback) {
    // 1. Validar peticiones sin origin según entorno
    if (!origin) {
      return config.server.env === 'production'
        ? callback(new Error('Not allowed by CORS'))
        : callback(null, true);
    }

    // 2. Bloquear wildcard en producción
    if (config.security.corsOrigins.includes('*')) {
      return config.server.env === 'production'
        ? callback(new Error('CORS misconfiguration'))
        : callback(null, true);
    }

    // 3. Normalizar y validar longitud
    const normalizedOrigin = origin.trim().toLowerCase();
    if (normalizedOrigin.length > 2048) {
      return callback(new Error('Not allowed by CORS'));
    }

    // 4. Bloquear 'null' origin
    if (normalizedOrigin === 'null') {
      return callback(new Error('Not allowed by CORS'));
    }

    // 5. Validar formato URL y protocolo
    try {
      const originUrl = new URL(normalizedOrigin);
      if (config.server.env === 'production' && originUrl.protocol === 'http:') {
        return callback(new Error('Not allowed by CORS'));
      }
    } catch (error) {
      return callback(new Error('Not allowed by CORS'));
    }

    // 6. Comparar con lista permitida
    const isAllowed = config.security.corsOrigins.some(allowedOrigin => {
      const normalizedAllowed = allowedOrigin.trim().toLowerCase();

      // Soporte wildcard subdominios
      if (normalizedAllowed.startsWith('*.')) {
        const domain = normalizedAllowed.slice(2);
        const originUrl = new URL(normalizedOrigin);
        const hostname = originUrl.hostname;
        const endsWithDomain = hostname.endsWith(`.${domain}`) || hostname === domain;
        const hasValidSubdomainFormat = hostname.split('.').length >= domain.split('.').length;
        return endsWithDomain && hasValidSubdomainFormat;
      }

      return normalizedAllowed === normalizedOrigin;
    });

    return isAllowed
      ? callback(null, true)
      : callback(new Error('Not allowed by CORS'));
  },

  credentials: true,
  optionsSuccessStatus: 200,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Origin', 'X-Requested-With', 'Content-Type', 'Accept', 'Authorization', 'X-Request-ID'],
  exposedHeaders: ['Content-Length', 'Content-Type', 'X-Request-ID', 'X-RateLimit-Limit', 'X-RateLimit-Remaining', 'X-RateLimit-Reset'],
  maxAge: 3600,
  preflightContinue: false
};

app.use(cors(corsOptions));
```

---

## Testing de la Configuración

Hemos creado un test suite completo para validar nuestra configuración CORS.

**Ubicación:** `tests/test-cors-configuration.js`

**Ejecutar tests:**
```bash
npm run test:cors
```

**Tests incluidos:**

1. ✅ **Test de origin permitido** - Verifica que origins en la allowlist funcionan
2. ✅ **Test de origin bloqueado** - Verifica que origins no autorizados son rechazados
3. ✅ **Test de preflight request** - Valida que OPTIONS funciona correctamente
4. ✅ **Test de header Vary** - Verifica que el header Vary está presente
5. ✅ **Test de petición sin origin** - Valida comportamiento en desarrollo

**Ejemplo de salida:**
```
==============================================
  Tests de Configuración CORS
==============================================
API: http://localhost:3030/api/v0.1

Test 1: Origin permitido
✓ PASS - Origin permitido correctamente
  Access-Control-Allow-Origin: http://localhost:3030

Test 2: Origin no permitido
✓ PASS - Origin bloqueado correctamente
  Origin: http://malicious-site.com rechazado

Test 3: Preflight request (OPTIONS)
  ✓ Allow-Origin: http://localhost:3030
  ✓ Allow-Credentials: true
  ✓ Max-Age: 3600
  ✓ Allow-Methods incluye POST
✓ PASS - Preflight request configurado correctamente

Test 4: Header Vary
✓ PASS - Header Vary configurado correctamente
  Vary: Origin

Test 5: Petición sin origin (development)
✓ PASS - Petición sin origin permitida en desarrollo
  Status: 200

==============================================
  Resultados
==============================================
Total:   5
Pasados: 5
Fallados: 0

✓ Todos los tests pasaron correctamente
```

---

## Conclusión

Nuestra implementación de CORS representa un balance cuidadoso entre seguridad, usabilidad y mantenibilidad. Hemos implementado múltiples capas de validación y protección mientras mantenemos la flexibilidad necesaria para el desarrollo y la interoperabilidad con frontends legítimos.

**Aspectos clave de nuestra implementación:**

1. **Seguridad por capas**: Múltiples validaciones que se refuerzan mutuamente
2. **Configuración por entorno**: Diferentes niveles de seguridad para desarrollo y producción
3. **Logging exhaustivo**: Facilita debugging y detección de ataques
4. **Testing automatizado**: Validación continua de la configuración
5. **Documentación completa**: Este documento y comentarios en código

**Protecciones implementadas:**

- ✅ Validación de longitud de origin (anti-DoS)
- ✅ Prevención de 'null' origin (anti-bypass)
- ✅ Validación de formato URL
- ✅ Rechazo de HTTP en producción
- ✅ Normalización case-insensitive
- ✅ Soporte seguro para wildcard subdominios
- ✅ Bloqueo de wildcard con credentials
- ✅ Control de peticiones sin origin por entorno
- ✅ Headers Vary correctos para CDNs
- ✅ Configuración segura de cookies (HttpOnly, Secure, SameSite)

Esta configuración nos permite soportar arquitecturas modernas de frontend/backend separados mientras mantenemos los más altos estándares de seguridad. La configuración es flexible para permitir evolución futura del proyecto sin comprometer la seguridad.
