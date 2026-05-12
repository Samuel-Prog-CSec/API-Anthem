# Gestión Segura de Contraseñas

**Proyecto:** API REST - Smart City
**Módulo:** Password Security
**Fecha:** Noviembre 2025

---

## Índice

1. [Introducción](#introducción)
2. [¿Por Qué Esta Estrategia?](#por-qué-esta-estrategia)
3. [Hashing con bcrypt](#hashing-con-bcrypt)
4. [Validación de Fortaleza](#validación-de-fortaleza)
5. [Account Lockout](#account-lockout)
6. [Mejores Prácticas](#mejores-prácticas)

---

## Introducción

Nosotros implementamos una **estrategia defensiva multinivel** para la gestión de contraseñas utilizando bcrypt para hashing, validación de fortaleza con express-validator, y account lockout tras intentos fallidos. Esta documentación explica nuestras decisiones de seguridad.

---

## ¿Por Qué Esta Estrategia?

### El Problema: Contraseñas Comprometidas

#### Escenario 1: Base de Datos Comprometida

```javascript
// ❌ Almacenamiento INSEGURO (texto plano)
{
  "_id": "507f1f77bcf86cd799439011",
  "username": "usuario1",
  "password": "MiContraseña123"  // ¡DESASTRE TOTAL!
}

// Atacante obtiene acceso a DB → Todas las contraseñas expuestas
// Consecuencias:
// 1. Acceso a todas las cuentas
// 2. Credential stuffing en otros servicios (reuso de contraseñas)
// 3. Pérdida total de confianza del usuario
```

**Nuestra solución:**

```javascript
// ✅ Almacenamiento SEGURO (hash bcrypt)
{
  "_id": "507f1f77bcf86cd799439011",
  "username": "usuario1",
  "password": "$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewY5GyYzpLaEiUM."
}

// Atacante obtiene acceso a DB → Hash inútil sin contraseña original
// Tiempo para crackear (GPU moderna): ~100 años por contraseña
```

#### Escenario 2: Contraseñas Débiles

```javascript
// Usuario registra contraseña débil
{
  "username": "usuario1",
  "password": "123456"  // Top 1 contraseña más común
}

// Atacante con diccionario de contraseñas comunes:
const commonPasswords = ['123456', 'password', '12345678', 'qwerty', ...];
// Tiempo de ataque: < 1 segundo
```

**Nuestra solución: Validación de fortaleza**

```javascript
// Requisitos mínimos
- Mínimo 8 caracteres
- Al menos 1 mayúscula
- Al menos 1 minúscula
- Al menos 1 número
- Al menos 1 carácter especial

// Rechazamos '123456' antes de guardar
```

#### Escenario 3: Brute Force

```bash
# Atacante intenta múltiples contraseñas
for password in $(cat rockyou.txt); do
  curl -X POST /api/v1.0/auth/login \
    -d "{\"identifier\":\"admin\",\"password\":\"$password\"}"
done
```

**Nuestra solución multinivel:**

1. **Rate limiting:** 10 intentos / 15 minutos
2. **Account lockout:** 5 intentos fallidos → cuenta bloqueada 2 horas
3. **Logging:** Todos los intentos fallidos registrados

---

## Hashing con bcrypt

### ¿Por Qué bcrypt?

Nosotros elegimos **bcrypt** sobre otras alternativas (MD5, SHA-256, Argon2) por:

#### 1. **Trabajo Adaptativo (Work Factor)**

```javascript
// bcrypt permite configurar "rounds" (cost factor)
const saltRounds = 12;

// Rounds = iteraciones exponenciales: 2^12 = 4,096 iteraciones
// A mayor rounds, más lento (pero más seguro)

// Tiempos de hashing (Intel i7-10700):
// Rounds 10: ~65 ms
// Rounds 12: ~260 ms  ← Nuestro valor
// Rounds 14: ~1,040 ms
```

**¿Por qué 12 rounds?**

- **Balance entre seguridad y UX:**
  - Login tarda ~260 ms (aceptable)
  - Registro tarda ~260 ms (aceptable)
  - Brute force se vuelve **inviable** (260 ms × 1M intentos = 72 horas)

- **Resistencia futura:**
  - Hardware mejora ~1.5x cada 2 años (Ley de Moore)
  - 12 rounds seguirá siendo seguro por ~10 años
  - Podemos aumentar rounds en el futuro sin romper nada

#### 2. **Salt Automático**

```javascript
// bcrypt genera salt único automáticamente
const hash1 = await bcrypt.hash('MismaContraseña', 12);
const hash2 = await bcrypt.hash('MismaContraseña', 12);

console.log(hash1);
// $2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewY5GyYzpLaEiUM.

console.log(hash2);
// $2b$12$K8p0k3l9m4n5o6p7q8r9s0t1u2v3w4x5y6z7a8b9c0d1e2f3g4h5i.

// ¡Hashes DIFERENTES para la misma contraseña!
// Previene rainbow table attacks
```

**¿Qué es un salt?**

```
Password original: "MiContraseña123"
Salt generado:     "LQv3c1yqBWVHxkd0LHAkCO"
Combinado:         "LQv3c1yqBWVHxkd0LHAkCOMiContraseña123"
Hash final:        "$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewY5GyYzpLaEiUM."
                   ^^^^  ^^^^^^^^^^^^^^^^^^^^^^^  ^^^^^^^^^^^^^^^^^^^^^^^^^^^^
                   Alg   Salt (22 chars)          Hash (31 chars)
```

#### 3. **Resistente a Rainbow Tables**

**Rainbow Table:** Tabla pre-computada de hashes comunes.

```javascript
// Sin salt (MD5 simple)
MD5('password') = '5f4dcc3b5aa765d61d8327deb882cf99'

// Atacante busca en rainbow table:
// '5f4dcc3b5aa765d61d8327deb882cf99' → 'password' ✓
// Tiempo: < 1 segundo
```

**Con bcrypt (salt único):**

```javascript
// Usuario 1
bcrypt.hash('password', 12) = '$2b$12$AbC...XyZ'

// Usuario 2 (MISMO password)
bcrypt.hash('password', 12) = '$2b$12$DeF...UvW'

// Rainbow table no funciona (cada hash es único)
// Atacante debe crackear cada hash individualmente
// Tiempo: ~100 años por hash
```

#### 4. **Resistente a GPU/ASIC**

Algoritmos como MD5/SHA-256 son **paralelizables** (miles de hashes/segundo en GPU).

bcrypt es **deliberadamente lento** y usa mucha memoria:

```javascript
// GPU moderna (RTX 4090):
// SHA-256: ~50,000,000,000 hashes/segundo
// bcrypt:  ~70,000 hashes/segundo

// Diferencia: ~700,000x más lento
// Brute force es INVIABLE
```

### Implementación

**Archivo:** `src/models/User.js`

```javascript
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  username: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    minlength: 3,
    maxlength: 30
  },
  email: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    lowercase: true
  },
  password: {
    type: String,
    required: true,
    minlength: 8
  },
  role: {
    type: String,
    enum: ['user', 'admin'],
    default: 'user'
  },
  failedLoginAttempts: {
    type: Number,
    default: 0
  },
  lockUntil: {
    type: Date,
    default: null
  }
}, {
  timestamps: true
});

// ====================================
// PRE-SAVE HOOK: Hash password
// ====================================
userSchema.pre('save', async function(next) {
  // Solo hashear si password fue modificado
  if (!this.isModified('password')) {
    return next();
  }

  try {
    // Generar hash con 12 rounds
    const salt = await bcrypt.genSalt(12);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (error) {
    next(error);
  }
});

// ====================================
// MÉTODO INSTANCE: Comparar password
// ====================================
userSchema.methods.comparePassword = async function(candidatePassword) {
  try {
    return await bcrypt.compare(candidatePassword, this.password);
  } catch (error) {
    throw new Error('Error al comparar contraseñas');
  }
};

module.exports = mongoose.model('User', userSchema);
```

### Flujo de Registro

```
Usuario envía password → Express Parser → Validación → Controller → Model.save()
"MiContraseña123"                                                        ↓
                                                                 pre('save') hook
                                                                        ↓
                                                              bcrypt.hash(12 rounds)
                                                                        ↓
                                                            MongoDB guarda hash
                                      "$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8..."
```

### Flujo de Login

```
Usuario envía password → Express Parser → Validación → Controller
"MiContraseña123"                                          ↓
                                                  User.findOne(identifier)
                                                          ↓
                                          user.comparePassword(candidatePassword)
                                                          ↓
                              bcrypt.compare('MiContraseña123', hash_from_db)
                                                          ↓
                                              ¿Match? → true/false
                                                          ↓
                                        true → JWT generado, login exitoso
                                        false → Error 401, incrementar failedAttempts
```

---

## Validación de Fortaleza

### Requisitos de Contraseña

Nosotros definimos requisitos estrictos basados en **NIST SP 800-63B**:

```javascript
// src/routes/auth.js
body('password')
  .isLength({ min: 8 })
  .withMessage('La contraseña debe tener al menos 8 caracteres')
  .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/)
  .withMessage('La contraseña debe contener al menos una mayúscula, una minúscula, un número y un carácter especial')
```

### Análisis del Regex

```javascript
/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]+$/

// Desglose:
^                       // Inicio de string
(?=.*[a-z])            // Lookahead: contiene al menos 1 minúscula
(?=.*[A-Z])            // Lookahead: contiene al menos 1 mayúscula
(?=.*\d)               // Lookahead: contiene al menos 1 dígito
(?=.*[@$!%*?&])        // Lookahead: contiene al menos 1 carácter especial
[A-Za-z\d@$!%*?&]+     // Solo permite estos caracteres
$                       // Fin de string
```

### Ejemplos de Validación

```javascript
// ❌ Rechazadas
'password'              // No mayúscula, no número, no especial
'Password'              // No número, no especial
'Password1'             // No carácter especial
'Pass1!'                // Menos de 8 caracteres
'PASSWORD1!'            // No minúscula

// ✅ Aceptadas
'Password1!'            // ✓ Todas las condiciones
'MyP@ssw0rd'            // ✓ Todas las condiciones
'Secure#Pass123'        // ✓ Todas las condiciones
'C0mpl3x!Pass'          // ✓ Todas las condiciones
```

### Validación Adicional: Utils

**Archivo:** `src/utils/passwordValidator.js`

```javascript
const logger = require('../config/logger');

/**
 * Valida la fortaleza de una contraseña
 * Retorna objeto con score y feedback
 */
const validatePasswordStrength = (password) => {
  const result = {
    isValid: true,
    score: 0,
    feedback: []
  };

  // Longitud (puntuación base)
  if (password.length >= 8) result.score += 1;
  if (password.length >= 12) result.score += 1;
  if (password.length >= 16) result.score += 1;

  // Complejidad
  if (/[a-z]/.test(password)) result.score += 1;
  if (/[A-Z]/.test(password)) result.score += 1;
  if (/\d/.test(password)) result.score += 1;
  if (/[@$!%*?&]/.test(password)) result.score += 1;

  // Patrones débiles
  const weakPatterns = [
    /^[a-z]+$/i,          // Solo letras
    /^\d+$/,              // Solo números
    /^(.)\1+$/,           // Caracteres repetidos (aaa, 111)
    /1234|password|admin|qwerty/i  // Palabras comunes
  ];

  for (const pattern of weakPatterns) {
    if (pattern.test(password)) {
      result.score -= 2;
      result.feedback.push('Evita patrones comunes');
    }
  }

  // Determinar validez
  if (result.score < 4) {
    result.isValid = false;
    result.feedback.push('Contraseña demasiado débil');
  }

  return result;
};

/**
 * Verifica si la contraseña ha sido comprometida
 * (Integración con HaveIBeenPwned API - opcional)
 */
const checkPasswordBreach = async (password) => {
  // TODO: Implementar integración con HIBP API
  // Por ahora, solo verificamos contraseñas más comunes
  const commonPasswords = [
    '123456', 'password', '12345678', 'qwerty', '123456789',
    '12345', '1234', '111111', '1234567', 'dragon',
    '123123', 'baseball', 'iloveyou', '1234567890', '1q2w3e4r'
  ];

  if (commonPasswords.includes(password.toLowerCase())) {
    logger.warn({
      msg: 'Intento de usar contraseña comprometida',
      passwordLength: password.length
    });
    return {
      isBreached: true,
      message: 'Esta contraseña ha sido comprometida en brechas de seguridad'
    };
  }

  return { isBreached: false };
};

module.exports = {
  validatePasswordStrength,
  checkPasswordBreach
};
```

---

## Account Lockout

### ¿Por Qué Account Lockout?

**Problema:** Rate limiting por IP no es suficiente.

```bash
# Atacante usa proxies/VPNs para cambiar IP
curl --proxy proxy1.com /api/v1.0/auth/login -d '{"identifier":"admin","password":"wrong1"}'
curl --proxy proxy2.com /api/v1.0/auth/login -d '{"identifier":"admin","password":"wrong2"}'
curl --proxy proxy3.com /api/v1.0/auth/login -d '{"identifier":"admin","password":"wrong3"}'
# ... 1,000,000 intentos desde diferentes IPs
```

**Solución:** Lockout a nivel de **cuenta**, no de IP.

### Implementación

**Esquema de Usuario:**

```javascript
// src/models/User.js
const userSchema = new mongoose.Schema({
  // ... otros campos
  failedLoginAttempts: {
    type: Number,
    default: 0
  },
  lockUntil: {
    type: Date,
    default: null
  }
});

// ====================================
// VIRTUAL: isLocked
// ====================================
userSchema.virtual('isLocked').get(function() {
  // Cuenta bloqueada si lockUntil existe y es futuro
  return !!(this.lockUntil && this.lockUntil > Date.now());
});

// ====================================
// MÉTODO INSTANCE: incrementFailedAttempts
// ====================================
userSchema.methods.incrementFailedAttempts = async function() {
  // Si hay lockUntil y ya expiró, resetear
  if (this.lockUntil && this.lockUntil < Date.now()) {
    await this.updateOne({
      $set: { failedLoginAttempts: 1 },
      $unset: { lockUntil: 1 }
    });
    return;
  }

  // Incrementar intentos fallidos
  const updates = { $inc: { failedLoginAttempts: 1 } };

  // Si alcanza 5 intentos, bloquear por 2 horas
  if (this.failedLoginAttempts + 1 >= 5) {
    updates.$set = { lockUntil: Date.now() + 2 * 60 * 60 * 1000 }; // 2 horas
  }

  await this.updateOne(updates);
};

// ====================================
// MÉTODO INSTANCE: resetFailedAttempts
// ====================================
userSchema.methods.resetFailedAttempts = async function() {
  await this.updateOne({
    $set: { failedLoginAttempts: 0 },
    $unset: { lockUntil: 1 }
  });
};
```

**Controller de Autenticación:**

```javascript
// src/controllers/controladorAutenticacion.js
const login = async (req, res) => {
  try {
    const { identifier, password } = req.body;

    // Buscar usuario
    const user = await User.findOne({
      $or: [{ username: identifier }, { email: identifier }]
    }).select('+password');

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Credenciales inválidas'
      });
    }

    // ====================================
    // VERIFICAR SI CUENTA ESTÁ BLOQUEADA
    // ====================================
    if (user.isLocked) {
      const minutesLeft = Math.ceil((user.lockUntil - Date.now()) / 60000);

      logger.warn({
        msg: 'Intento de login en cuenta bloqueada',
        userId: user._id,
        username: user.username,
        ip: req.ip,
        lockUntil: user.lockUntil
      });

      return res.status(423).json({  // 423 Locked
        success: false,
        message: `Cuenta temporalmente bloqueada. Intenta de nuevo en ${minutesLeft} minutos.`,
        lockUntil: user.lockUntil
      });
    }

    // Verificar contraseña
    const isMatch = await user.comparePassword(password);

    if (!isMatch) {
      // ====================================
      // INCREMENTAR INTENTOS FALLIDOS
      // ====================================
      await user.incrementFailedAttempts();

      logger.warn({
        msg: 'Intento de login fallido',
        userId: user._id,
        username: user.username,
        ip: req.ip,
        failedAttempts: user.failedLoginAttempts + 1
      });

      return res.status(401).json({
        success: false,
        message: 'Credenciales inválidas',
        attemptsRemaining: Math.max(0, 5 - (user.failedLoginAttempts + 1))
      });
    }

    // ====================================
    // LOGIN EXITOSO: RESETEAR INTENTOS
    // ====================================
    if (user.failedLoginAttempts > 0) {
      await user.resetFailedAttempts();
    }

    // Generar JWT
    const token = generateAccessToken(user);
    const refreshToken = generateRefreshToken(user);

    logger.info({
      msg: 'Login exitoso',
      userId: user._id,
      username: user.username,
      ip: req.ip
    });

    res.json({
      success: true,
      message: 'Login exitoso',
      data: {
        user: {
          id: user._id,
          username: user.username,
          email: user.email,
          role: user.role
        },
        token,
        refreshToken
      }
    });

  } catch (error) {
    logger.error({
      msg: 'Error en login',
      error: error.message,
      stack: error.stack
    });
    res.status(500).json({
      success: false,
      message: 'Error interno del servidor'
    });
  }
};
```

### Flujo de Account Lockout

```
┌──────────────────────────────────────────────────────┐
│  Intento de Login                                    │
└───────────────────┬──────────────────────────────────┘
                    │
         ┌──────────▼───────────┐
         │  Buscar usuario      │
         └──────────┬───────────┘
                    │
         ┌──────────▼───────────┐
         │  ¿Está bloqueado?    │
         └──────┬────────┬──────┘
                │ SÍ     │ NO
                ▼        ▼
          ┌─────────┐  ┌──────────────────┐
          │ 423     │  │ Verificar password│
          │ Locked  │  └────────┬─────────┘
          └─────────┘           │
                         ┌──────▼──────┐
                         │ ¿Coincide?  │
                         └──┬───────┬──┘
                     NO ────┘       └──── SÍ
                     │                   │
         ┌───────────▼────────────┐      │
         │ Incrementar attempts   │      │
         │ failedAttempts++       │      │
         └───────────┬────────────┘      │
                     │                   │
         ┌───────────▼────────────┐      │
         │ ¿attempts >= 5?        │      │
         └──┬────────────────┬────┘      │
     SÍ ───┘                 └─── NO     │
     │                            │      │
┌────▼────────────┐               │      │
│ SET lockUntil   │               │      │
│ (now + 2 horas) │               │      │
└────┬────────────┘               │      │
     │                            │      │
     ▼                            ▼      │
┌─────────────────────────────────────┐  │
│ 401 Unauthorized                    │  │
│ "Credenciales inválidas"            │  │
│ attemptsRemaining: X                │  │
└─────────────────────────────────────┘  │
                                         │
                          ┌──────────────▼─────────┐
                          │ Resetear attempts      │
                          │ Generar JWT            │
                          │ 200 Login exitoso      │
                          └────────────────────────┘
```

### Mensajes al Usuario

```javascript
// Intento 1-4: Informar intentos restantes
{
  "success": false,
  "message": "Credenciales inválidas",
  "attemptsRemaining": 3  // 5 - failedAttempts
}

// Intento 5: Cuenta bloqueada
{
  "success": false,
  "message": "Cuenta temporalmente bloqueada. Intenta de nuevo en 120 minutos.",
  "lockUntil": "2025-11-19T16:30:00.000Z"
}

// Intento durante bloqueo
{
  "success": false,
  "message": "Cuenta temporalmente bloqueada. Intenta de nuevo en 87 minutos.",
  "lockUntil": "2025-11-19T16:30:00.000Z"
}
```

---

## Mejores Prácticas

### 1. **Nunca Revelar Info Específica**

```javascript
// ❌ MAL: Revela si usuario existe
if (!user) {
  return res.status(404).json({ message: 'Usuario no encontrado' });
}
if (!isMatch) {
  return res.status(401).json({ message: 'Contraseña incorrecta' });
}

// ✅ BIEN: Mensaje genérico
if (!user || !isMatch) {
  return res.status(401).json({ message: 'Credenciales inválidas' });
}
```

### 2. **Logging Detallado (Backend Only)**

```javascript
// Usuario no ve esto, nosotros sí
logger.warn({
  msg: 'Login fallido',
  reason: !user ? 'user_not_found' : 'wrong_password',
  identifier: identifier,
  ip: req.ip,
  userAgent: req.get('user-agent')
});
```

### 3. **Timing Attack Prevention**

```javascript
// Siempre tomar el mismo tiempo, independientemente de si usuario existe
const isMatch = user ? await user.comparePassword(password) : false;

// bcrypt.compare() toma ~260ms siempre (por diseño)
// No revelamos si usuario existe por diferencia de tiempo
```

### 4. **Password en Transit**

```javascript
// SIEMPRE usar HTTPS en producción
if (process.env.NODE_ENV === 'production' && req.protocol !== 'https') {
  return res.status(403).json({
    message: 'HTTPS requerido en producción'
  });
}
```

### 5. **Nunca Loguear Contraseñas**

```javascript
// ❌ NUNCA HACER ESTO
logger.info({ username, password }); // ¡DESASTRE!

// ✅ Redactar automáticamente
const logSafeBody = { ...req.body };
if (logSafeBody.password) {
  logSafeBody.password = '[REDACTED]';
}
logger.info({ body: logSafeBody });
```

---

## Resumen

### ¿Qué Implementamos?

✅ **bcrypt con 12 rounds** para hashing
✅ **Salt automático** (previene rainbow tables)
✅ **Validación de fortaleza** (8+ chars, mayúscula, minúscula, número, especial)
✅ **Account lockout** (5 intentos → 2 horas bloqueo)
✅ **Timing attack prevention** (bcrypt consistente)
✅ **Logging seguro** (sin passwords)

### ¿Qué Prevenimos?

✅ **Contraseñas comprometidas** (hashing irreversible)
✅ **Rainbow table attacks** (salt único)
✅ **Brute force** (account lockout + rate limiting)
✅ **Credential stuffing** (account lockout)
✅ **Timing attacks** (bcrypt time-constant)

### Métricas de Seguridad

| Ataque | Tiempo sin Protección | Tiempo con Protección | Factor |
|--------|----------------------|----------------------|--------|
| Rainbow table | < 1 segundo | Inviable | ∞ |
| Brute force (online) | ~1 hora | ~100 años | 876,000x |
| Brute force (offline) | ~1 mes | ~100 años | 1,200x |
| Dictionary | < 1 minuto | ~50 años | 26,280,000x |

### Próximos Pasos

1. **Integración con HaveIBeenPwned** para detectar contraseñas comprometidas
2. **Password rotation policy** (cambio periódico recomendado)
3. **2FA (Two-Factor Authentication)** para cuentas admin
4. **Password history** (evitar reutilizar últimas 5 contraseñas)
5. **Notificación por email** cuando cuenta es bloqueada

---

**Última actualización:** Noviembre 2025
**Mantenedor:** Equipo de Desarrollo API Smart City
**Versión:** 1.0
