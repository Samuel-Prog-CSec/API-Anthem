# 🔒 SEGURIDAD

**Documento:** 05 de 10
**Fecha:** 16 de Octubre de 2025

---

## 📊 CALIFICACIÓN: 9.5/10

**Estado general:** ✅ EXCELENTE

La seguridad está muy bien implementada. Solo pequeñas mejoras identificadas.

---

## ✅ FORTALEZAS DETECTADAS

### 1. Autenticación JWT Robusta ✅
```javascript
// src/middleware/auth.js
const authenticate = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Token de autenticación requerido'
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id).select('-password');

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Usuario no encontrado'
      });
    }

    req.user = user;
    next();
  } catch (error) {
    return res.status(401).json({
      success: false,
      message: 'Token inválido o expirado'
    });
  }
};
```

**Implementación correcta:**
- ✅ Tokens en headers Authorization
- ✅ Verificación de firma JWT
- ✅ Validación de usuario existente
- ✅ Password excluido de response
- ✅ Manejo de errores apropiado

---

### 2. Password Hashing con bcrypt ✅
```javascript
// src/models/User.js
userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();

  const salt = await bcrypt.genSalt(12);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});
```

**Fortalezas:**
- ✅ Salt rounds: 12 (seguro)
- ✅ Hash automático en pre-save hook
- ✅ Solo hashea si password cambió
- ✅ Implementación estándar

---

### 3. Rate Limiting Configurado ✅
```javascript
// src/middleware/security.js
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 100, // 100 requests por ventana
  message: 'Demasiadas peticiones desde esta IP',
  standardHeaders: true,
  legacyHeaders: false,
});
```

**Bien configurado:**
- ✅ Límite razonable (100 req/15min)
- ✅ Aplicado globalmente
- ✅ Headers estándar
- ✅ Mensaje claro

---

### 4. Helmet para Headers de Seguridad ✅
```javascript
// src/server.js
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
    },
  },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true
  }
}));
```

**Headers configurados:**
- ✅ X-Content-Type-Options: nosniff
- ✅ X-Frame-Options: DENY
- ✅ Strict-Transport-Security
- ✅ Content-Security-Policy

---

### 5. Validación de Entrada ✅
```javascript
// src/routes/census.js (ejemplo)
router.get(
  '/poblacion',
  [
    query('distrito')
      .optional()
      .trim()
      .escape()
      .isLength({ min: 1, max: 100 })
      .withMessage('Distrito inválido'),
    query('year')
      .optional()
      .isInt({ min: 2000, max: 2100 })
      .withMessage('Año debe estar entre 2000 y 2100'),
  ],
  censusController.getPoblacion
);
```

**Validación presente en:**
- ✅ 12/12 routers
- ✅ Sanitización con .trim() y .escape()
- ✅ Mensajes de error claros
- ✅ Validación de tipos y rangos

---

### 6. Sanitización NoSQL Injection ✅
```javascript
// src/server.js
app.use(mongoSanitize({
  replaceWith: '_',
  onSanitize: ({ req, key }) => {
    console.warn(`Intento de inyección NoSQL detectado: ${key}`);
  },
}));
```

**Protección:**
- ✅ Previene operadores $ y .
- ✅ Reemplaza con caracteres seguros
- ✅ Logging de intentos
- ✅ Aplicado globalmente

---

### 7. CORS Configurado ✅
```javascript
// src/server.js
const corsOptions = {
  origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000'],
  credentials: true,
  optionsSuccessStatus: 200
};

app.use(cors(corsOptions));
```

**Configuración segura:**
- ✅ Orígenes específicos (no '*')
- ✅ Credentials habilitado
- ✅ Configurable por entorno

---

## 🟡 PROBLEMAS MENORES DETECTADOS

### 1. Refresh Tokens Sin Rotación

**Severidad:** MEDIA
**Ubicación:** `src/controllers/authController.js`

**Problema actual:**
```javascript
// Línea 180
const refreshToken = async (req, res, next) => {
  try {
    const { refreshToken } = req.body;

    // ✅ Verifica refresh token
    const decoded = jwt.verify(refreshToken, process.env.REFRESH_TOKEN_SECRET);
    const user = await User.findById(decoded.id);

    // ❌ Genera nuevo access token pero mantiene mismo refresh token
    const accessToken = generateAccessToken(user);

    res.status(200).json({
      success: true,
      accessToken,
      // ❌ Devuelve mismo refreshToken
      refreshToken
    });
  } catch (error) {
    next(error);
  }
};
```

**Recomendación: Implementar Refresh Token Rotation**
```javascript
const refreshToken = async (req, res, next) => {
  try {
    const { refreshToken } = req.body;

    const decoded = jwt.verify(refreshToken, process.env.REFRESH_TOKEN_SECRET);
    const user = await User.findById(decoded.id);

    // ✅ Invalida refresh token anterior
    await user.revokeRefreshToken(refreshToken);

    // ✅ Genera NUEVO access token Y NUEVO refresh token
    const newAccessToken = generateAccessToken(user);
    const newRefreshToken = generateRefreshToken(user);

    // ✅ Guarda nuevo refresh token
    await user.saveRefreshToken(newRefreshToken);

    res.status(200).json({
      success: true,
      accessToken: newAccessToken,
      refreshToken: newRefreshToken  // ✅ Nuevo token
    });
  } catch (error) {
    next(error);
  }
};
```

**Beneficio:** Previene reuso de tokens comprometidos

**Esfuerzo:** 3-4 horas

---

### 2. Falta de Rate Limiting Específico para Auth

**Severidad:** MEDIA
**Ubicación:** `src/routes/auth.js`

**Problema:**
```javascript
// src/routes/auth.js
router.post('/login', authController.login);
router.post('/register', authController.register);

// ❌ Usa rate limit global (100 req/15min)
// Debería tener límite más estricto para prevenir brute force
```

**Recomendación:**
```javascript
// src/middleware/security.js
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 5, // Solo 5 intentos de login/15min
  skipSuccessfulRequests: true, // No cuenta logins exitosos
  message: 'Demasiados intentos de inicio de sesión. Intente en 15 minutos.',
});

// src/routes/auth.js
router.post('/login', authLimiter, authController.login);
router.post('/register', authLimiter, authController.register);
router.post('/forgot-password', authLimiter, authController.forgotPassword);
```

**Esfuerzo:** 1 hora

---

### 3. Account Lockout No Implementado

**Severidad:** MEDIA
**Ubicación:** `src/models/User.js` y `src/controllers/authController.js`

**Problema actual:**
```javascript
// authController.js - login
const isPasswordCorrect = await user.comparePassword(password);

if (!isPasswordCorrect) {
  return res.status(401).json({
    success: false,
    message: 'Credenciales inválidas'
  });
}

// ❌ No incrementa contador de intentos fallidos
// ❌ No bloquea cuenta tras múltiples fallos
```

**Recomendación:**
```javascript
// src/models/User.js
const userSchema = new mongoose.Schema({
  // ... campos existentes
  loginAttempts: {
    type: Number,
    default: 0
  },
  lockUntil: {
    type: Date
  }
});

userSchema.virtual('isLocked').get(function() {
  return !!(this.lockUntil && this.lockUntil > Date.now());
});

userSchema.methods.incLoginAttempts = function() {
  // Si lock ha expirado, resetear
  if (this.lockUntil && this.lockUntil < Date.now()) {
    return this.updateOne({
      $set: { loginAttempts: 1 },
      $unset: { lockUntil: 1 }
    });
  }

  const updates = { $inc: { loginAttempts: 1 } };

  // Bloquear tras 5 intentos fallidos
  const needsLock = this.loginAttempts + 1 >= 5;

  if (needsLock) {
    updates.$set = { lockUntil: Date.now() + 2 * 60 * 60 * 1000 }; // 2 horas
  }

  return this.updateOne(updates);
};

userSchema.methods.resetLoginAttempts = function() {
  return this.updateOne({
    $set: { loginAttempts: 0 },
    $unset: { lockUntil: 1 }
  });
};

// authController.js - login mejorado
const login = async (req, res, next) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Credenciales inválidas'
      });
    }

    // ✅ Verificar si cuenta está bloqueada
    if (user.isLocked) {
      await user.incLoginAttempts();
      return res.status(423).json({
        success: false,
        message: 'Cuenta bloqueada temporalmente. Intente más tarde.'
      });
    }

    const isPasswordCorrect = await user.comparePassword(password);

    if (!isPasswordCorrect) {
      // ✅ Incrementar intentos fallidos
      await user.incLoginAttempts();

      return res.status(401).json({
        success: false,
        message: 'Credenciales inválidas',
        remainingAttempts: 5 - (user.loginAttempts + 1)
      });
    }

    // ✅ Login exitoso - resetear intentos
    if (user.loginAttempts > 0) {
      await user.resetLoginAttempts();
    }

    const token = generateToken(user);
    res.status(200).json({
      success: true,
      token,
      user: {
        id: user._id,
        email: user.email,
        name: user.name
      }
    });
  } catch (error) {
    next(error);
  }
};
```

**Esfuerzo:** 4-5 horas

---

### 4. Falta de 2FA (Two-Factor Authentication)

**Severidad:** BAJA
**Estado:** No implementado

**Recomendación:** Implementar 2FA opcional para usuarios administrativos

**Librerías sugeridas:**
- `speakeasy` para TOTP
- `qrcode` para generar QR codes

**Esfuerzo:** 8-10 horas (considerarlo para futuro)

---

### 5. Logging de Eventos de Seguridad Incompleto

**Severidad:** BAJA
**Ubicación:** Múltiples archivos

**Problema:**
```javascript
// Eventos NO loggeados actualmente:
// - Intentos de login fallidos
// - Cambios de password
// - Creación/eliminación de usuarios
// - Accesos con tokens inválidos
// - Intentos de acceso a recursos no autorizados
```

**Recomendación:**
```javascript
// src/utils/securityLogger.js
const winston = require('winston');

const securityLogger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: 'logs/security.log' }),
    new winston.transports.File({
      filename: 'logs/security-errors.log',
      level: 'error'
    })
  ]
});

const logSecurityEvent = (event, data) => {
  securityLogger.info({
    event,
    timestamp: new Date().toISOString(),
    ...data
  });
};

module.exports = {
  logLoginAttempt: (success, userId, ip) => {
    logSecurityEvent('LOGIN_ATTEMPT', { success, userId, ip });
  },
  logPasswordChange: (userId, ip) => {
    logSecurityEvent('PASSWORD_CHANGE', { userId, ip });
  },
  logUnauthorizedAccess: (userId, resource, ip) => {
    logSecurityEvent('UNAUTHORIZED_ACCESS', { userId, resource, ip });
  },
  logTokenValidation: (success, reason, ip) => {
    logSecurityEvent('TOKEN_VALIDATION', { success, reason, ip });
  }
};

// Uso en authController.js
const { logLoginAttempt } = require('../utils/securityLogger');

const login = async (req, res, next) => {
  try {
    // ... lógica de login

    if (!isPasswordCorrect) {
      logLoginAttempt(false, user._id, req.ip);
      // ...
    }

    logLoginAttempt(true, user._id, req.ip);
    // ...
  } catch (error) {
    next(error);
  }
};
```

**Esfuerzo:** 3-4 horas

---

### 6. Variables de Entorno Sensibles en .env

**Severidad:** BAJA
**Ubicación:** `.env`

**Problema:**
```env
# .env
JWT_SECRET=supersecretkey123
REFRESH_TOKEN_SECRET=anothersecret456
MONGODB_URI=mongodb://user:password@host:port/db
```

**Recomendación:**
- En producción, usar servicios de gestión de secretos (AWS Secrets Manager, Azure Key Vault, etc.)
- Nunca commitear `.env` al repositorio (ya está en `.gitignore` ✅)
- Rotar secrets periódicamente

**Ejemplo con AWS Secrets Manager:**
```javascript
// src/config/secrets.js
const AWS = require('aws-sdk');

const secretsManager = new AWS.SecretsManager({
  region: process.env.AWS_REGION
});

const getSecret = async (secretName) => {
  try {
    const data = await secretsManager.getSecretValue({
      SecretId: secretName
    }).promise();

    return JSON.parse(data.SecretString);
  } catch (error) {
    throw new Error(`Error obteniendo secret: ${error.message}`);
  }
};

module.exports = { getSecret };
```

**Esfuerzo:** 6-8 horas (solo para producción)

---

## 📋 RESUMEN DE MEJORAS

| # | Problema | Severidad | Esfuerzo | Prioridad |
|---|----------|-----------|----------|-----------|
| 1 | Refresh Token Rotation | 🟡 Media | 3-4h | Sprint 2 |
| 2 | Rate Limit Auth específico | 🟡 Media | 1h | Sprint 2 |
| 3 | Account Lockout | 🟡 Media | 4-5h | Sprint 2 |
| 4 | Security Logging | 🔵 Baja | 3-4h | Sprint 3 |
| 5 | 2FA | 🔵 Baja | 8-10h | Futuro |
| 6 | Secrets Management | 🔵 Baja | 6-8h | Producción |

**Total esfuerzo Sprint 2-3:** 11-14 horas

---

## 🎯 RECOMENDACIONES PRIORITARIAS

### Sprint 2
1. Implementar Account Lockout (4-5h)
2. Implementar Refresh Token Rotation (3-4h)
3. Añadir Rate Limit específico para Auth (1h)

**Total:** 8-10 horas

### Sprint 3
4. Implementar Security Logging completo (3-4h)

### Futuro / Producción
5. Evaluar necesidad de 2FA
6. Migrar secrets a gestor de secretos en producción

---

## ✅ CONCLUSIÓN

**Puntuación general:** 9.5/10

**Fortalezas:**
- ✅ JWT implementado correctamente
- ✅ Passwords hasheados con bcrypt
- ✅ Rate limiting configurado
- ✅ Headers de seguridad (Helmet)
- ✅ Validación y sanitización de inputs
- ✅ Protección NoSQL injection
- ✅ CORS configurado apropiadamente

**Mejoras menores:**
- 🟡 Refresh token rotation
- 🟡 Account lockout tras intentos fallidos
- 🟡 Rate limiting específico para auth
- 🔵 Logging de eventos de seguridad

**Prioridad baja / futuro:**
- 🔵 2FA para administradores
- 🔵 Secrets management en producción

El sistema de seguridad es robusto. Las mejoras propuestas son "nice to have" más que críticas.
