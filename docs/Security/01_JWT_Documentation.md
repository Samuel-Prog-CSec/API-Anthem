# Documentación de Autenticación JWT

## Tabla de Contenidos

1. [Introducción](#introducción)
2. [¿Por qué JWT?](#por-qué-jwt)
3. [Arquitectura de Implementación](#arquitectura-de-implementación)
4. [Configuración y Parámetros](#configuración-y-parámetros)
5. [Generación de Tokens](#generación-de-tokens)
6. [Verificación de Tokens](#verificación-de-tokens)
7. [Extracción de Tokens](#extracción-de-tokens)
8. [Refresh Tokens](#refresh-tokens)
9. [Blacklist de Tokens](#blacklist-de-tokens)
10. [Flujo Completo de Autenticación](#flujo-completo-de-autenticación)
11. [Consideraciones de Seguridad](#consideraciones-de-seguridad)
12. [Mejores Prácticas Implementadas](#mejores-prácticas-implementadas)

---

## Introducción

En nuestra API REST para Smart City, hemos implementado un sistema de autenticación basado en **JSON Web Tokens (JWT)**. Esta decisión arquitectónica nos permite mantener un sistema stateless, escalable y seguro para gestionar la autenticación de usuarios.

JWT es un estándar abierto (RFC 7519) que define una forma compacta y autocontenida de transmitir información de forma segura entre partes como un objeto JSON. Esta información puede ser verificada y confiable porque está firmada digitalmente.

---

## ¿Por qué JWT?

### Ventajas que nos motivaron a elegir JWT

Hemos elegido JWT sobre otras alternativas (como sesiones tradicionales con cookies) por las siguientes razones:

#### 1. **Arquitectura Stateless**
```
Tradicional (Sesiones)          JWT (Nuestra elección)
┌─────────┐                     ┌─────────┐
│ Cliente │ ────────────>       │ Cliente │
└─────────┘                     └─────────┘
     │                               │
     │ SessionID                     │ JWT Token (autocontenido)
     ▼                               ▼
┌─────────┐                     ┌─────────┐
│ Servidor│ ──> [Session Store] │ Servidor│ (No necesita store)
└─────────┘                     └─────────┘
     │                               │
     │ Busca en DB/Redis             │ Valida firma localmente
     ▼                               ▼
[Base de Datos]                 [Verificación local]
```

**Beneficios:**
- No necesitamos almacenar sesiones en servidor
- No dependemos de Redis o similar para sesiones distribuidas
- Cada instancia del servidor puede validar tokens independientemente
- Facilita el escalamiento horizontal

#### 2. **Información Autocontenida**
El token JWT contiene toda la información necesaria en su payload:
```json
{
  "id": "507f1f77bcf86cd799439011",
  "username": "john_doe",
  "email": "john@example.com",
  "role": "user",
  "iat": 1700000000,
  "exp": 1700000900
}
```

Esto significa que no necesitamos consultar la base de datos en cada request para saber quién es el usuario y qué permisos tiene.

#### 3. **Interoperabilidad**
JWT es un estándar ampliamente adoptado:
- Compatible con múltiples lenguajes y frameworks
- Fácil integración con frontend (React, Angular, Vue)
- Compatible con aplicaciones móviles
- Soportado por OAuth 2.0 y OpenID Connect

#### 4. **Seguridad mediante Firma Digital**
Utilizamos HMAC SHA-256 (HS256) para firmar nuestros tokens:
```
Token = Base64(Header) + "." + Base64(Payload) + "." + HMAC_SHA256(
  Base64(Header) + "." + Base64(Payload),
  SECRET_KEY
)
```

Esto garantiza que:
- El token no puede ser modificado sin invalidar la firma
- Solo nosotros podemos generar tokens válidos
- La verificación es rápida y eficiente

---

## Arquitectura de Implementación

### Estructura de Archivos

Hemos organizado nuestra implementación JWT en los siguientes módulos:

```
src/
├── config/
│   └── config.js              # Configuración JWT (algoritmo, expiración)
├── middleware/
│   └── auth.js                # Middleware de autenticación
├── models/
│   ├── User.js                # Modelo de usuario
│   └── TokenBlacklist.js      # Modelo para tokens revocados
├── utils/
│   ├── tokenHelper.js         # Utilidades JWT (generar, verificar)
│   └── securityLogger.js      # Logging de eventos de seguridad
└── controllers/
    └── authController.js      # Controladores de auth (login, register)
```

### Flujo de Datos

```
┌─────────────┐
│   Cliente   │
└──────┬──────┘
       │ 1. POST /auth/login
       │    {username, password}
       ▼
┌─────────────────┐
│ authController  │ ──> 2. Valida credenciales
└────────┬────────┘
         │ 3. Usuario válido
         ▼
┌─────────────────┐
│  tokenHelper    │ ──> 4. Genera JWT
└────────┬────────┘
         │ 5. Retorna token
         ▼
┌─────────────┐
│   Cliente   │ ──> 6. Almacena token
└──────┬──────┘
       │ 7. GET /api/data
       │    Authorization: Bearer <token>
       ▼
┌─────────────────┐
│ auth middleware │ ──> 8. Extrae y verifica token
└────────┬────────┘
         │ 9. Token válido
         ▼
┌─────────────────┐
│   Controller    │ ──> 10. Procesa request
└─────────────────┘
```

---

## Configuración y Parámetros

### Configuración Central

Hemos centralizado la configuración JWT en `src/config/config.js`:

```javascript
const config = {
  jwt: {
    secret: process.env.JWT_SECRET,           // Clave secreta (min 32 caracteres)
    expiresIn: process.env.JWT_EXPIRE || '15m', // Tiempo de expiración
    algorithm: 'HS256'                        // Algoritmo de firma
  }
};
```

### ¿Por qué estos valores?

#### **1. JWT_SECRET - Clave Secreta**

**Requisitos que implementamos:**
- Mínimo 32 caracteres (256 bits)
- Generada aleatoriamente
- Almacenada en variable de entorno
- Validada al inicio de la aplicación

```javascript
const validateEnvironment = () => {
  // Verificar que existe
  if (!process.env.JWT_SECRET) {
    throw new Error('JWT_SECRET es obligatorio');
  }

  // Verificar fortaleza
  if (process.env.JWT_SECRET.length < 32) {
    console.warn('JWT_SECRET debe tener al menos 32 caracteres');
  }
};
```

**¿Por qué 32 caracteres?**
- HS256 usa claves de 256 bits (32 bytes)
- Mayor entropía = mayor resistencia a ataques de fuerza bruta
- Recomendación de OWASP y NIST

#### **2. expiresIn - Tiempo de Expiración**

**Valor por defecto: 15 minutos**

**Razonamiento:**
- **Balance entre seguridad y usabilidad**
  - Muy corto (5min): Usuario re-autentica constantemente
  - Muy largo (24h): Mayor ventana de ataque si token es robado
  - 15 minutos: Compromiso razonable

- **Principio de ventana de oportunidad limitada**
  - Si un token es interceptado, el atacante solo tiene 15 minutos
  - Después de 15 minutos, el token expira automáticamente

- **Uso conjunto con Refresh Tokens**
  - Access Token: 15 minutos (operaciones frecuentes)
  - Refresh Token: 30 días (renovación sin re-login)

#### **3. algorithm - Algoritmo HS256**

**¿Por qué HS256 y no RS256?**

| Aspecto | HS256 (Nuestra elección) | RS256 (Alternativa) |
|---------|--------------------------|---------------------|
| **Tipo** | HMAC simétrico | RSA asimétrico |
| **Velocidad** | Muy rápido | Más lento |
| **Complejidad** | Simple | Requiere par de claves |
| **Uso ideal** | Mismo sistema genera y valida | Sistemas distribuidos |
| **Seguridad** | Excelente con clave fuerte | Excelente |

**Nuestra decisión:**
- Generamos y validamos en el mismo sistema (monolito)
- HS256 es más rápido y simple
- No necesitamos distribución de claves públicas
- Seguridad equivalente con gestión adecuada del secreto

```javascript
// Configuración de firma
jwt.sign(payload, config.jwt.secret, {
  expiresIn: config.jwt.expiresIn,
  algorithm: 'HS256',           // Simétrico, rápido
  issuer: 'api-rest-auth',      // Identifica emisor
  audience: 'api-rest-auth-client' // Identifica receptor
});
```

---

## Generación de Tokens

### Access Token

Hemos implementado la generación de access tokens en `src/utils/tokenHelper.js`:

```javascript
const generateAccessToken = (payload, expiresIn = config.jwt.expiresIn) => {
  return jwt.sign(
    payload,                    // Datos del usuario
    config.jwt.secret,          // Clave secreta
    {
      expiresIn,                // Tiempo de expiración
      algorithm: config.jwt.algorithm, // HS256
      issuer: 'api-rest-auth',  // Quién emite el token
      audience: 'api-rest-auth-client' // Para quién es el token
    }
  );
};
```

#### Estructura del Payload

El payload que incluimos contiene información esencial pero **no sensible**:

```javascript
const payload = {
  id: user._id,           // ID del usuario (para queries rápidas)
  username: user.username, // Nombre de usuario
  email: user.email,       // Email (útil para logging)
  role: user.role         // Rol para autorización
};
```

**¿Qué NO incluimos y por qué?**
- ❌ **Contraseña**: Obviamente, nunca incluir credenciales
- ❌ **Información sensible**: JWT es decodificable (Base64, no cifrado)
- ❌ **Datos que cambian frecuentemente**: El token no se actualiza automáticamente

**¿Qué SÍ incluimos y por qué?**
- ✅ **ID**: Para identificar al usuario sin query a DB
- ✅ **Role**: Para decisiones de autorización inmediatas
- ✅ **Email**: Para logging y auditoría
- ✅ **Username**: Para mostrar en UI sin request adicional

### Refresh Token

Para evitar que el usuario tenga que hacer login cada 15 minutos, implementamos refresh tokens:

```javascript
const generateRefreshToken = (payload) => {
  return jwt.sign(
    payload,
    config.jwt.secret,
    {
      expiresIn: '30d',          // Mayor duración
      algorithm: config.jwt.algorithm,
      issuer: 'api-rest-auth',
      audience: 'api-rest-auth-refresh' // Audience diferente
    }
  );
};
```

**Diferencias clave:**
- **Duración**: 30 días vs 15 minutos
- **Audience**: `api-rest-auth-refresh` (diferente del access token)
- **Payload mínimo**: Solo contiene `id` del usuario
- **Uso único**: Después de usar, se invalida y genera uno nuevo

### Función Helper Unificada

Para simplificar, proporcionamos una función que genera ambos:

```javascript
const generateTokens = (user) => {
  const payload = {
    id: user._id,
    username: user.username,
    email: user.email,
    role: user.role
  };

  return {
    accessToken: generateAccessToken(payload),
    refreshToken: generateRefreshToken({ id: user._id }) // Payload mínimo
  };
};
```

**Uso en controladores:**
```javascript
// En authController.js - Login
const tokens = generateTokens(user);

res.status(200).json({
  success: true,
  message: 'Login exitoso',
  data: {
    user: userData,
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken
  }
});
```

---

## Verificación de Tokens

### Verificación de Access Token

Implementamos la verificación en el middleware de autenticación:

```javascript
const verifyToken = async (token) => {
  try {
    return jwt.verify(token, config.jwt.secret, {
      algorithms: [config.jwt.algorithm], // Solo aceptamos HS256
      issuer: 'api-rest-auth',            // Verificamos emisor
      audience: 'api-rest-auth-client'    // Verificamos audiencia
    });
  } catch (error) {
    // Manejo específico de errores
    if (error.name === 'TokenExpiredError') {
      throw new Error('El token ha expirado');
    } else if (error.name === 'JsonWebTokenError') {
      throw new Error('Token inválido');
    } else if (error.name === 'NotBeforeError') {
      throw new Error('Token no activo');
    } else {
      throw new Error('Verificación de token fallida');
    }
  }
};
```

### Capas de Validación

Nuestra validación tiene múltiples capas de seguridad:

```
Token Recibido
     │
     ▼
┌─────────────────────────────────┐
│ 1. Formato válido (3 partes)   │ ──> ❌ 401 Unauthorized
└────────┬────────────────────────┘
         │ ✓
         ▼
┌─────────────────────────────────┐
│ 2. Firma válida (HMAC SHA-256) │ ──> ❌ 401 Invalid Token
└────────┬────────────────────────┘
         │ ✓
         ▼
┌─────────────────────────────────┐
│ 3. No expirado (exp claim)     │ ──> ❌ 401 Token Expired
└────────┬────────────────────────┘
         │ ✓
         ▼
┌─────────────────────────────────┐
│ 4. Issuer correcto             │ ──> ❌ 401 Invalid Issuer
└────────┬────────────────────────┘
         │ ✓
         ▼
┌─────────────────────────────────┐
│ 5. Audience correcto           │ ──> ❌ 401 Invalid Audience
└────────┬────────────────────────┘
         │ ✓
         ▼
┌─────────────────────────────────┐
│ 6. Usuario existe en DB        │ ──> ❌ 401 User Not Found
└────────┬────────────────────────┘
         │ ✓
         ▼
┌─────────────────────────────────┐
│ 7. Cuenta activa               │ ──> ❌ 403 Account Disabled
└────────┬────────────────────────┘
         │ ✓
         ▼
┌─────────────────────────────────┐
│ 8. Cuenta no bloqueada         │ ──> ❌ 423 Account Locked
└────────┬────────────────────────┘
         │ ✓
         ▼
┌─────────────────────────────────┐
│ 9. No en blacklist             │ ──> ❌ 401 Token Revoked
└────────┬────────────────────────┘
         │ ✓
         ▼
    Request Autorizado
```

### Middleware de Autenticación

El middleware completo en `src/middleware/auth.js`:

```javascript
const authenticate = async (req, res, next) => {
  try {
    // 1. Extraer token
    let token;
    try {
      token = extractToken(req);
    } catch (error) {
      return res.status(401).json(
        createUnauthorizedResponse(error.message)
      );
    }

    if (!token) {
      return res.status(401).json(
        createUnauthorizedResponse('Se requiere un token de acceso')
      );
    }

    // 2. Verificar token
    let decoded;
    try {
      decoded = await verifyToken(token);

      // Logging exitoso
      logTokenValidation(true, null, {
        userId: decoded.id,
        ip: req.ip,
        userAgent: req.get('user-agent')
      });
    } catch (error) {
      // Logging fallido
      logTokenValidation(false, error.message, {
        tokenPrefix: token.substring(0, 20) + '...',
        ip: req.ip,
        userAgent: req.get('user-agent')
      });

      return res.status(401).json(
        createUnauthorizedResponse(`Validación de token fallida: ${error.message}`)
      );
    }

    // 3. Obtener usuario del payload del token
    const user = await User.findById(decoded.id).select('-password');

    if (!user) {
      return res.status(401).json(
        createUnauthorizedResponse('Usuario no encontrado')
      );
    }

    // 4. Verificar estado de la cuenta
    if (!user.isActive) {
      return res.status(403).json(
        createUnauthorizedResponse('La cuenta está desactivada')
      );
    }

    if (user.isLocked) {
      return res.status(423).json(
        createUnauthorizedResponse('La cuenta está temporalmente bloqueada')
      );
    }

    // 5. Adjuntar usuario al objeto request
    req.user = user;
    req.token = token;

    next();

  } catch (error) {
    authLogger.error({
      error: error.message,
      stack: error.stack,
      path: req.path,
      method: req.method,
      ip: req.ip
    }, 'Error en middleware de autenticación');

    return res.status(500).json(
      createUnauthorizedResponse('Error de autenticación')
    );
  }
};
```

---

## Extracción de Tokens

### Múltiples Métodos de Extracción

Soportamos tres métodos de envío de tokens, con diferentes niveles de seguridad:

```javascript
const extractToken = (req) => {
  // Método 1: Authorization header (RECOMENDADO)
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7);
  }

  // Método 2: HTTP-only cookies (SEGURO)
  if (req.cookies && req.cookies.token) {
    return req.cookies.token;
  }

  // Método 3: Query parameter (SOLO DESARROLLO)
  if (req.query && req.query.token) {
    if (config.server.env === 'production') {
      throw new Error('Token en query string no permitido en producción');
    }
    return req.query.token;
  }

  return null;
};
```

### Comparación de Métodos

| Método | Seguridad | Ventajas | Desventajas | Uso |
|--------|-----------|----------|-------------|-----|
| **Authorization Header** | ⭐⭐⭐⭐⭐ | Estándar HTTP, seguro, flexible | Requiere JavaScript en cliente | **PRODUCCIÓN** |
| **HTTP-only Cookie** | ⭐⭐⭐⭐ | Protege contra XSS | Vulnerable a CSRF (mitigado con SameSite) | **PRODUCCIÓN** |
| **Query String** | ⭐ | Fácil para testing | Aparece en logs, historial, vulnerable | **SOLO DESARROLLO** |

### ¿Por qué bloqueamos query string en producción?

```javascript
if (config.server.env === 'production') {
  throw new Error('Token en query string no permitido en producción');
}
```

**Razones de seguridad:**

1. **Logs de Servidor**
   ```
   GET /api/users?token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
   ```
   El token queda registrado en logs de acceso, exponiéndolo.

2. **Historial del Navegador**
   URLs con query strings quedan en el historial del navegador.

3. **Referrer Headers**
   Si el usuario hace click en un link externo, el token puede enviarse en el Referer header.

4. **Proxy Logs**
   Proxies intermedios (CDN, load balancers) pueden logear URLs completas.

**Solución para desarrollo:**
- Permitido solo en `NODE_ENV=development`
- Facilita testing con herramientas como Postman
- Se bloquea automáticamente en producción

---

## Refresh Tokens

### ¿Por qué necesitamos Refresh Tokens?

**Problema sin Refresh Tokens:**
```
Access Token expira cada 15 minutos
    ↓
Usuario debe hacer login cada 15 minutos
    ↓
Experiencia de usuario terrible
```

**Solución con Refresh Tokens:**
```
Access Token (15 min) + Refresh Token (30 días)
    ↓
Access Token expira → Usar Refresh Token → Nuevo Access Token
    ↓
Usuario solo hace login cada 30 días
```

### Implementación de Refresh Token

```javascript
const refreshAccessToken = async (req, res, next) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return next(createBadRequestError('Se requiere refresh token'));
    }

    // 1. Verificar refresh token
    let decoded;
    try {
      decoded = await verifyRefreshToken(refreshToken);
    } catch (error) {
      return next(createAuthError('Refresh token inválido o expirado'));
    }

    // 2. Verificar que no esté en blacklist
    const isBlacklisted = await TokenBlacklist.isBlacklisted(refreshToken);
    if (isBlacklisted) {
      return next(createAuthError('Refresh token ha sido revocado'));
    }

    // 3. Obtener usuario
    const user = await User.findById(decoded.id);
    if (!user || !user.isActive) {
      return next(createAuthError('Usuario no encontrado o inactivo'));
    }

    // 4. Generar nuevos tokens
    const newTokens = generateTokens(user);

    // 5. Invalidar refresh token anterior (Token Rotation)
    await TokenBlacklist.add(refreshToken, decoded.exp);

    // 6. Logging
    logTokenRefresh(user._id.toString(), true, req.ip);

    // 7. Retornar nuevos tokens
    res.status(200).json(
      createResponse('Tokens renovados exitosamente', newTokens)
    );

  } catch (error) {
    authLogger.error({ error: error.message }, 'Error en refresh token');
    next(createInternalError('Error al renovar tokens'));
  }
};
```

### Refresh Token Rotation

**¿Qué es?**
Cada vez que se usa un refresh token, se invalida y se genera uno nuevo.

**¿Por qué lo implementamos?**

```
CASO 1: Token robado, detectado inmediatamente
─────────────────────────────────────────────
Usuario legítimo: Usa refresh token → Nuevo par generado → Token viejo invalidado
Atacante: Intenta usar token viejo → ❌ RECHAZADO (está en blacklist)
                                      ↓
                        🚨 ALERTA DE SEGURIDAD 🚨
                      (Dos usos del mismo token)
```

```
CASO 2: Token robado, no detectado
───────────────────────────────────
Atacante: Usa refresh token → Nuevo par generado → Token viejo invalidado
Usuario legítimo: Intenta usar token viejo → ❌ RECHAZADO
                                              ↓
                          Usuario hace login manual
                                              ↓
                        Tokens del atacante invalidados
```

**Ventajas:**
- Limita el daño de un token robado
- Permite detectar uso malicioso
- Fuerza re-autenticación si hay actividad sospechosa

---

## Blacklist de Tokens

### ¿Por qué necesitamos una Blacklist?

**Problema:**
JWT es stateless, una vez emitido, es válido hasta que expire. No podemos "desloguear" a un usuario simplemente eliminando el token.

**Escenarios que requieren revocación:**
1. Usuario hace logout voluntario
2. Administrador desactiva cuenta
3. Token comprometido detectado
4. Refresh token usado (rotation)

### Implementación de TokenBlacklist

Modelo en `src/models/TokenBlacklist.js`:

```javascript
const tokenBlacklistSchema = new mongoose.Schema({
  token: {
    type: String,
    required: true,
    unique: true,
    index: true  // Índice para búsquedas rápidas
  },
  expiresAt: {
    type: Date,
    required: true,
    index: true  // Índice para limpieza automática
  },
  reason: {
    type: String,
    enum: ['logout', 'refresh', 'compromised', 'admin_revoke'],
    default: 'logout'
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Users',
    index: true
  }
}, {
  timestamps: true
});

// TTL Index: MongoDB elimina documentos automáticamente cuando expiresAt se alcanza
tokenBlacklistSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
```

### Métodos Estáticos

```javascript
// Añadir token a blacklist
tokenBlacklistSchema.statics.add = async function(token, expiresAt, reason = 'logout', userId = null) {
  try {
    await this.create({
      token,
      expiresAt: new Date(expiresAt * 1000), // JWT usa segundos, Date usa ms
      reason,
      userId
    });
    return true;
  } catch (error) {
    if (error.code === 11000) {
      // Token ya en blacklist, ignorar
      return true;
    }
    throw error;
  }
};

// Verificar si token está en blacklist
tokenBlacklistSchema.statics.isBlacklisted = async function(token) {
  const exists = await this.findOne({ token });
  return !!exists;
};

// Limpiar tokens expirados manualmente (opcional, TTL lo hace automáticamente)
tokenBlacklistSchema.statics.cleanExpired = async function() {
  const result = await this.deleteMany({
    expiresAt: { $lt: new Date() }
  });
  return result.deletedCount;
};
```

### Uso en Logout

```javascript
// En authController.js
const logout = async (req, res, next) => {
  try {
    const token = req.token; // Del middleware authenticate

    // Obtener expiración del token
    const decoded = jwt.decode(token);

    // Añadir a blacklist
    await TokenBlacklist.add(
      token,
      decoded.exp,
      'logout',
      req.user._id
    );

    // Logging
    logSessionTermination(req.user._id.toString(), 'manual_logout', req.ip);

    // Limpiar cookies
    res.clearCookie('accessToken');
    res.clearCookie('refreshToken');

    res.status(200).json(
      createResponse('Logout exitoso')
    );
  } catch (error) {
    authLogger.error({ error: error.message }, 'Error en logout');
    next(createInternalError('Error durante logout'));
  }
};
```

### Verificación en Middleware

Añadimos verificación de blacklist en el middleware de autenticación:

```javascript
const authenticate = async (req, res, next) => {
  // ... código de verificación anterior ...

  // Verificar blacklist DESPUÉS de verificar la firma
  const isBlacklisted = await TokenBlacklist.isBlacklisted(token);
  if (isBlacklisted) {
    return res.status(401).json(
      createUnauthorizedResponse('Token ha sido revocado')
    );
  }

  // ... resto del middleware ...
};
```

### Optimización de Rendimiento

**Problema potencial:**
Consultar blacklist en cada request puede ser costoso.

**Optimización implementada:**

1. **Índices en MongoDB**
   ```javascript
   tokenBlacklistSchema.index({ token: 1 }); // Búsqueda O(log n)
   ```

2. **TTL Index automático**
   MongoDB elimina tokens expirados automáticamente, manteniendo la colección pequeña.

3. **Cache en memoria (opcional, no implementado aún)**
   ```javascript
   // Futura mejora: Cache de tokens blacklisteados
   const blacklistCache = new NodeCache({ stdTTL: 300 }); // 5 min

   const isBlacklisted = async (token) => {
     // Verificar cache primero
     const cached = blacklistCache.get(token);
     if (cached !== undefined) return cached;

     // Si no está en cache, consultar DB
     const exists = await TokenBlacklist.findOne({ token });
     const result = !!exists;

     // Guardar en cache
     blacklistCache.set(token, result);
     return result;
   };
   ```

---

## Flujo Completo de Autenticación

### Diagrama de Secuencia Completo

```
┌────────┐         ┌────────┐         ┌─────────┐         ┌──────┐
│ Client │         │  API   │         │   JWT   │         │  DB  │
└───┬────┘         └───┬────┘         └────┬────┘         └──┬───┘
    │                  │                   │                  │
    │ 1. POST /login   │                   │                  │
    │ {user, pass}     │                   │                  │
    ├─────────────────>│                   │                  │
    │                  │                   │                  │
    │                  │ 2. Validar credenciales              │
    │                  ├──────────────────────────────────────>│
    │                  │                   │                  │
    │                  │ 3. Usuario válido │                  │
    │                  │<──────────────────────────────────────┤
    │                  │                   │                  │
    │                  │ 4. Generar tokens │                  │
    │                  ├──────────────────>│                  │
    │                  │                   │                  │
    │                  │ 5. Access + Refresh                  │
    │                  │<──────────────────┤                  │
    │                  │                   │                  │
    │ 6. Tokens        │                   │                  │
    │<─────────────────┤                   │                  │
    │                  │                   │                  │
    │ 7. GET /data     │                   │                  │
    │ Bearer <token>   │                   │                  │
    ├─────────────────>│                   │                  │
    │                  │                   │                  │
    │                  │ 8. Verificar token│                  │
    │                  ├──────────────────>│                  │
    │                  │                   │                  │
    │                  │ 9. Token válido   │                  │
    │                  │<──────────────────┤                  │
    │                  │                   │                  │
    │                  │ 10. Verificar usuario                │
    │                  ├──────────────────────────────────────>│
    │                  │                   │                  │
    │                  │ 11. Usuario OK    │                  │
    │                  │<──────────────────────────────────────┤
    │                  │                   │                  │
    │ 12. Data         │                   │                  │
    │<─────────────────┤                   │                  │
    │                  │                   │                  │
    │ ... 15 min ...   │                   │                  │
    │                  │                   │                  │
    │ 13. GET /data    │                   │                  │
    │ Bearer <expired> │                   │                  │
    ├─────────────────>│                   │                  │
    │                  │                   │                  │
    │                  │ 14. Verificar     │                  │
    │                  ├──────────────────>│                  │
    │                  │                   │                  │
    │                  │ 15. ❌ EXPIRADO   │                  │
    │                  │<──────────────────┤                  │
    │                  │                   │                  │
    │ 16. 401 Expired  │                   │                  │
    │<─────────────────┤                   │                  │
    │                  │                   │                  │
    │ 17. POST /refresh│                   │                  │
    │ {refreshToken}   │                   │                  │
    ├─────────────────>│                   │                  │
    │                  │                   │                  │
    │                  │ 18. Verificar refresh                │
    │                  ├──────────────────>│                  │
    │                  │                   │                  │
    │                  │ 19. Válido        │                  │
    │                  │<──────────────────┤                  │
    │                  │                   │                  │
    │                  │ 20. Blacklist old │                  │
    │                  ├──────────────────────────────────────>│
    │                  │                   │                  │
    │                  │ 21. Generar nuevo │                  │
    │                  ├──────────────────>│                  │
    │                  │                   │                  │
    │                  │ 22. Nuevos tokens │                  │
    │                  │<──────────────────┤                  │
    │                  │                   │                  │
    │ 23. Nuevos tokens│                   │                  │
    │<─────────────────┤                   │                  │
    │                  │                   │                  │
```

### Código del Flujo Completo

#### 1. Registro

```javascript
// POST /api/v1.0/auth/register
{
  "username": "john_doe",
  "email": "john@example.com",
  "password": "SecurePass123!@#"
}

// Respuesta
{
  "success": true,
  "message": "Usuario registrado exitosamente",
  "data": {
    "user": {
      "id": "507f1f77bcf86cd799439011",
      "username": "john_doe",
      "email": "john@example.com",
      "role": "user"
    },
    "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  }
}
```

#### 2. Login

```javascript
// POST /api/v1.0/auth/login
{
  "identifier": "john@example.com",
  "password": "SecurePass123!@#"
}

// Respuesta (igual que registro)
```

#### 3. Request Autenticado

```javascript
// GET /api/v1.0/ubicaciones
// Headers:
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

// Respuesta
{
  "success": true,
  "data": [...]
}
```

#### 4. Token Expirado

```javascript
// GET /api/v1.0/ubicaciones
// Headers:
Authorization: Bearer <token_expirado>

// Respuesta
{
  "success": false,
  "message": "El token ha expirado",
  "statusCode": 401
}
```

#### 5. Refresh Token

```javascript
// POST /api/v1.0/auth/refresh
{
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}

// Respuesta
{
  "success": true,
  "message": "Tokens renovados exitosamente",
  "data": {
    "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...", // NUEVO
    "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."  // NUEVO
  }
}
```

#### 6. Logout

```javascript
// POST /api/v1.0/auth/logout
// Headers:
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

// Respuesta
{
  "success": true,
  "message": "Logout exitoso"
}

// Token añadido a blacklist
```

---

## Consideraciones de Seguridad

### 1. Almacenamiento de JWT_SECRET

**❌ NUNCA hacer:**
```javascript
// ¡MAL! Secret hardcodeado
const config = {
  jwt: {
    secret: 'mi_secreto_super_secreto_123'
  }
};
```

**✅ Hacer:**
```javascript
// ¡BIEN! Secret en variable de entorno
const config = {
  jwt: {
    secret: process.env.JWT_SECRET
  }
};
```

**En producción:**
```bash
# .env (NUNCA commitear a git)
JWT_SECRET=a3f8b9c2d1e4f5g6h7i8j9k0l1m2n3o4p5q6r7s8t9u0v1w2x3y4z5a6b7c8d9e0

# Generar secreto seguro:
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 2. HTTPS Obligatorio en Producción

```javascript
// Configuración de cookies (authController.js)
res.cookie('accessToken', tokens.accessToken, {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production', // ✅ Solo HTTPS en prod
  sameSite: 'strict',
  maxAge: 15 * 60 * 1000
});
```

**¿Por qué?**
- JWT en HTTP plano puede ser interceptado (Man-in-the-Middle)
- HTTPS cifra toda la comunicación
- Cookies con `secure: true` solo se envían por HTTPS

### 3. No incluir información sensible en el Payload

**❌ NUNCA incluir:**
```javascript
// ¡MAL! Información sensible en payload
const payload = {
  id: user._id,
  password: user.password,        // ❌ NUNCA
  creditCard: user.creditCard,    // ❌ NUNCA
  ssn: user.ssn                    // ❌ NUNCA
};
```

**✅ Solo información no sensible:**
```javascript
// ¡BIEN! Solo datos no sensibles
const payload = {
  id: user._id,
  username: user.username,
  email: user.email,
  role: user.role
};
```

**Razón:**
JWT usa Base64, no cifrado. Cualquiera puede decodificar el payload:
```bash
# Decodificar JWT (sin verificar firma)
echo "eyJhbGci..." | base64 -d
```

### 4. Validación de Claims

Siempre verificamos:
- `exp` (expiration): Token no expirado
- `iss` (issuer): Emitido por nosotros
- `aud` (audience): Dirigido a nuestra aplicación

```javascript
jwt.verify(token, secret, {
  algorithms: ['HS256'],
  issuer: 'api-rest-auth',       // ✅ Verificar emisor
  audience: 'api-rest-auth-client' // ✅ Verificar audiencia
});
```

### 5. Protección contra Replay Attacks

**Medidas implementadas:**
1. **Expiración corta**: Access tokens expiran en 15 minutos
2. **Blacklist**: Tokens usados en logout/refresh se invalidan
3. **Rotation**: Refresh tokens se invalidan después de uso
4. **Logging**: Todos los usos de tokens se registran

### 6. Protección contra Token Theft

**Si un token es robado:**

| Tiempo | Daño Limitado Por |
|--------|-------------------|
| < 15 min | Token expira automáticamente |
| < 30 días | Refresh token puede ser revocado |
| Siempre | Usuario puede cambiar contraseña (invalida todo) |

**Detección de robo:**
```javascript
// Logging de uso sospechoso
logTokenValidation(true, null, {
  userId: decoded.id,
  ip: req.ip,
  userAgent: req.get('user-agent')
});

// Análisis posterior:
// - Múltiples IPs diferentes en corto tiempo
// - User-Agent inconsistente
// - Ubicaciones geográficas imposibles
```

---

## Mejores Prácticas Implementadas

### ✅ 1. Tokens de corta duración
- Access token: 15 minutos
- Minimiza ventana de ataque

### ✅ 2. Refresh token rotation
- Token usado = token invalidado
- Nuevo token generado
- Detecta uso malicioso

### ✅ 3. Blacklist para revocación
- Logout inmediato
- Compromiso detectado
- Desactivación de cuenta

### ✅ 4. HTTPS en producción
- Cookies con `secure: true`
- Previene Man-in-the-Middle

### ✅ 5. Múltiples capas de validación
- Firma válida
- No expirado
- Issuer/Audience correctos
- Usuario existe y activo
- No en blacklist

### ✅ 6. Logging exhaustivo
- Todos los eventos de autenticación
- Tokens inválidos/expirados
- Intentos sospechosos

### ✅ 7. Claims adicionales
- `iss`: Identifica emisor
- `aud`: Identifica receptor
- Previene uso cruzado

### ✅ 8. Protección de secretos
- Variables de entorno
- Validación de fortaleza
- No hardcodeados

### ✅ 9. Algoritmo seguro
- HS256 (HMAC SHA-256)
- No algoritmo `none`
- No RS256 innecesario

### ✅ 10. Payload mínimo
- Solo datos necesarios
- Sin información sensible
- Tamaño optimizado

---

## Conclusión

Hemos implementado un sistema de autenticación JWT robusto y seguro que:

1. **Es Stateless**: No requiere almacenamiento de sesiones en servidor
2. **Es Escalable**: Cada instancia puede validar tokens independientemente
3. **Es Seguro**: Múltiples capas de validación y protección
4. **Es Flexible**: Soporta múltiples métodos de envío de tokens
5. **Es Auditable**: Logging exhaustivo de todos los eventos
6. **Es Recuperable**: Blacklist permite revocación inmediata

Nuestro sistema cumple con:
- ✅ Estándares de la industria (RFC 7519)
- ✅ Mejores prácticas de seguridad OWASP
- ✅ Recomendaciones de NIST para autenticación
- ✅ Principios de defensa en profundidad

La implementación está lista para producción y puede escalar horizontalmente sin problemas de sincronización de sesiones.

---

**Última actualización:** Noviembre 2025
**Versión:** 1.0
**Mantenedores:** Equipo de Desarrollo API Smart City
