/**
 * Modelo de Usuario
 *
 * Esquema de Mongoose para la autenticación de usuarios y la gestión de perfiles.
 * Implementa hashing seguro de contraseñas, validación y gestión de tokens JWT.
 */

const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const config = require('../config/config');
const { generateAccessToken } = require('../utils/tokenHelper');
const { USER_SECURITY, USER_ROLES } = require('../constants');

/**
 * Esquema de Usuario
 *
 * Define la estructura de los documentos de usuario con validación,
 * medidas de seguridad y métodos auxiliares.
 */
const userSchema = new mongoose.Schema(
  {
    // Información básica del usuario
    // Nota: `unique: true` ya genera un indice unico automaticamente.
    // No se anade `index: true` redundante para evitar duplicar la escritura
    // del indice en cada save.
    username: {
      type: String,
      required: [true, 'Nombre de usuario obligatorio'],
      unique: true,
      trim: true,
      minlength: [
        USER_SECURITY.MIN_USERNAME_LENGTH,
        `El nombre de usuario debe tener al menos ${USER_SECURITY.MIN_USERNAME_LENGTH} caracteres`,
      ],
      maxlength: [
        USER_SECURITY.MAX_USERNAME_LENGTH,
        `El nombre de usuario no puede exceder ${USER_SECURITY.MAX_USERNAME_LENGTH} caracteres`,
      ],
      match: [
        /^[a-zA-Z0-9_-]+$/,
        'El nombre de usuario solo puede contener letras, numeros, guiones y guiones bajos',
      ],
    },

    email: {
      type: String,
      required: [true, 'Email necesario'],
      unique: true,
      trim: true,
      lowercase: true,
      // Regex lineal (sin quantifiers anidados sobre clases solapadas) para
      // evitar backtracking catastrofico (ReDoS) del patron anterior. Acepta
      // TLDs de cualquier longitud (.com, .test, .online, .museum): el patron
      // previo exigia \w{2,3} y rechazaba emails validos con TLD de 4+ letras.
      // El formato estricto lo valida express-validator isEmail() en la ruta;
      // este match es solo un suelo de seguridad a nivel de schema.
      match: [
        /^[\w.+-]+@[\w-]+(\.[\w-]+)+$/,
        'Por favor, ingrese un email valido',
      ],
    },

    /**
     * Contrasena del usuario (se almacena hasheada)
     *
     * VALIDACION:
     * - La validacion minlength aplica a la contrasena en TEXTO PLANO
     * - El hook pre('save') hashea la contrasena DESPUES de la validacion
     * - El controlador NO debe hashear la contrasena (se hace aqui)
     * - Validaciones de fortaleza adicionales se hacen en el controlador
     *
     * PROCESO:
     * 1. Controller recibe contrasena en texto plano
     * 2. Mongoose valida longitud minima (texto plano)
     * 3. Hook pre('save') hashea la contrasena
     * 4. Se guarda el hash en BD
     */
    password: {
      type: String,
      required: [true, 'Contraseña obligatoria'],
      minlength: [
        USER_SECURITY.MIN_PASSWORD_LENGTH,
        `La contraseña debe tener al menos ${USER_SECURITY.MIN_PASSWORD_LENGTH} caracteres`,
      ],
      select: false, // NO se devuelve por defecto en consultas
    },

    // Estado de la cuenta y seguridad
    isActive: {
      type: Boolean,
      default: true,
    },

    role: {
      type: String,
      enum: Object.values(USER_ROLES),
      default: USER_ROLES.USER,
    },

    // Campos de tracking de actividad
    lastLogin: {
      type: Date,
      default: null,
    },

    loginAttempts: {
      // Número de intentos fallidos de login
      type: Number,
      default: 0,
    },

    lockUntil: {
      // Timestamp hasta cuando la cuenta está bloqueada
      type: Date,
      default: null,
    },

    passwordChangedAt: {
      type: Date,
      select: false,
    },
  },
  {
    timestamps: true, // Agrega campos createdAt y updatedAt
    versionKey: false, // Elimina el campo __v
    collection: 'users',
    toJSON: {
      transform: (_doc, ret) => {
        delete ret.password;
        delete ret.lockUntil;
        delete ret.loginAttempts;
        delete ret.passwordChangedAt;
        delete ret.createdAt;
        delete ret.updatedAt;
        return ret;
      }
    }
  }
);

/**
 * Propiedad virtual 'isLocked'
 * Determina si la cuenta está actualmente bloqueada debido a intentos fallidos de inicio de sesión
 */
userSchema.virtual('isLocked').get(function () {
  return !!(this.lockUntil && this.lockUntil > Date.now()); // Doble negación para convertir a booleano
});

/**
 * Middleware pre-save para hashing de contraseñas
 * Usa bcrypt con un número configurable de rondas de salt
 */
userSchema.pre('save', async function () {
  // Solo hash la contraseña si ha sido modificada (o es nueva)
  if (!this.isModified('password')) {
    return;
  }

  // Mongoose gestiona la propagación de errores al usar async; no usar next aquí
  const salt = await bcrypt.genSalt(config.security.bcryptSaltRounds);
  this.password = await bcrypt.hash(this.password, salt);
});

/**
 * Middleware pre-update para auto-actualización de timestamps
 * Se ejecuta en operaciones findOneAndUpdate, updateOne, updateMany
 */
userSchema.pre('findOneAndUpdate', async function () {
  const update = this.getUpdate();
  if (update) {
    if (!update.$set) {
      update.$set = {};
    }
    update.$set.updatedAt = new Date();
  }
});

userSchema.pre('updateOne', async function () {
  const update = this.getUpdate();
  if (update) {
    if (!update.$set) {
      update.$set = {};
    }
    update.$set.updatedAt = new Date();
  }
});

userSchema.pre('updateMany', async function () {
  const update = this.getUpdate();
  if (update) {
    if (!update.$set) {
      update.$set = {};
    }
    update.$set.updatedAt = new Date();
  }
});

/**
 * Compara una contraseña candidata con la contraseña hasheada almacenada
 *
 * @param {string} candidatePassword - Contraseña a verificar
 * @returns {Promise<boolean>} True si la contraseña coincide, false en caso contrario
 */
userSchema.methods.comparePassword = async function (candidatePassword) {
  if (!candidatePassword) {
    return false;
  }
  return bcrypt.compare(candidatePassword, this.password);
};

/**
 * Generar un token JWT para el usuario
 *
 * @returns {string} Token JWT firmado
 */
userSchema.methods.generateAuthToken = function () {
  const payload = {
    id: this._id,
    username: this.username,
    email: this.email,
    role: this.role,
  };

  return generateAccessToken(payload);
};

/**
 * Manejar login fallido
 * Incrementa los intentos de login y bloquea la cuenta si es necesario
 */
userSchema.methods.handleFailedLogin = async function () {
  // Si la cuenta ya está bloqueada y el período de bloqueo ha expirado, reiniciar
  if (this.lockUntil && this.lockUntil < Date.now()) {
    return this.updateOne({
      $unset: { lockUntil: 1 },
      $set: { loginAttempts: 1 },
    });
  }

  const updates = { $inc: { loginAttempts: 1 } };

  // Bloquear la cuenta si se alcanzan los intentos fallidos máximos y no está ya bloqueada
  if (
    this.loginAttempts + 1 >= USER_SECURITY.MAX_LOGIN_ATTEMPTS &&
    !this.isLocked
  ) {
    updates.$set = { lockUntil: Date.now() + USER_SECURITY.LOCK_TIME_MS };
  }

  return this.updateOne(updates);
};

/**
 * Manejar login exitoso
 * Resetea los intentos de login y actualiza el último login
 */
userSchema.methods.handleSuccessfulLogin = async function () {
  // Eliminar intentos de login y lock si existen
  if (this.loginAttempts > 0 || this.lockUntil) {
    return this.updateOne({
      $unset: { loginAttempts: 1, lockUntil: 1 },
      $set: { lastLogin: Date.now() },
    });
  }

  // Solo actualizar el último login
  return this.updateOne({ $set: { lastLogin: Date.now() } });
};

/**
 * Verificar si el usuario cambió su contraseña después de que se emitió el token
 *
 * @param {number} JWTTimestamp - Timestamp de emisión del token (iat)
 * @returns {boolean} True si la contraseña cambió después
 */
userSchema.methods.changedPasswordAfter = function(JWTTimestamp) {
  if (this.passwordChangedAt) {
    const changedTimestamp = parseInt(this.passwordChangedAt.getTime() / 1000, 10);
    return JWTTimestamp < changedTimestamp;
  }

  // False significa que NO ha cambiado
  return false;
};

/**
 * Metodo estático para encontrar usuario por email o username
 *
 * @param {string} identifier - Email o username
 * @returns {Promise<Document|null>} Documento del usuario o null si no se encuentra
 */
userSchema.statics.findByEmailOrUsername = function (identifier) {
  if (!identifier) {
    return null;
  }
  return this.findOne({
    $or: [{ email: identifier.toLowerCase() }, { username: identifier }],
  }).select('+password'); // Incluir password para verificación
};

/**
 * Índices para mejorar el rendimiento de las consultas
 */

// ========================================
// NOTA SOBRE INDICES DE CREDENCIALES
// ========================================
// `email` y `username` ya tienen indice unico automatico via `unique: true` en
// la definicion del campo. Se removio el indice compuesto `idx_user_credentials`
// porque `findByEmailOrUsername` usa `$or: [{email}, {username}]` y MongoDB
// NO aprovecha un indice compuesto para queries `$or`: usa cada indice
// individual por separado. El compuesto era una escritura extra inutil.

// ========================================
// ÍNDICES TEMPORALES
// ========================================

// Índice para ordenar usuarios por fecha de creación (descendente)
// Usado en: Queries administrativas de listado de usuarios
// Soporta: GET /api/admin/users?sortBy=createdAt&sortOrder=desc
userSchema.index(
  { createdAt: -1 },
  {
    name: 'idx_user_created_timeline',
  }
);

// Índice para consultas por último login (descendente)
// Usado en: Queries de auditoría y análisis de actividad
// Usado en: controladorAutenticacion.js - actualización de lastLogin en login
// Soporta: Identificación de usuarios inactivos, análisis de engagement
userSchema.index(
  { lastLogin: -1 },
  {
    name: 'idx_user_last_login',
    sparse: true, // SPARSE: lastLogin puede ser null para usuarios que nunca han iniciado sesión
  }
);

// Crear y exportar el modelo de usuario
const User = mongoose.model('Users', userSchema);

module.exports = User;
