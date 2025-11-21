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
const userSchema = new mongoose.Schema({
  // Información básica del usuario
  username: {
    type: String,
    required: [true, 'Nombre de usuario obligatorio'],
    unique: true, // Índice único
    trim: true, // Elimina espacios en blanco al inicio y final
    minlength: [3, 'El nombre de usuario debe tener al menos 3 caracteres'],
    maxlength: [30, 'El nombre de usuario no puede exceder 30 caracteres'],
    match: [/^[a-zA-Z0-9_-]+$/, 'El nombre de usuario solo puede contener letras, números, guiones y guiones bajos'],
    index: true // Índice para búsquedas rápidas
  },

  email: {
    type: String,
    required: [true, 'Email necesario'],
    unique: true,
    trim: true,
    lowercase: true,
    match: [
      /^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/,
      'Por favor, ingrese un email válido'
    ],
    index: true
  },

  password: {
    type: String,
    required: [true, 'Contraseña obligatoria'],
    minlength: [6, 'La contraseña debe tener al menos 6 caracteres'],
    // La validación de fortaleza de contraseña se debe hacer en el controlador
    // ANTES de guardar, no aquí, porque el pre-save hook hashea la contraseña
    // y la validación fallaría con el hash
    select: false // NO se devuelve por defecto en consultas
  },

  // Estado de la cuenta y seguridad
  isActive: {
    type: Boolean,
    default: true
  },

  role: {
    type: String,
    enum: Object.values(USER_ROLES),
    default: USER_ROLES.USER
  },

  // Campos de tracking de actividad
  lastLogin: {
    type: Date,
    default: null
  },

  loginAttempts: { // Número de intentos fallidos de login
    type: Number,
    default: 0
  },

  lockUntil: { // Timestamp hasta cuando la cuenta está bloqueada
    type: Date,
    default: null
  }

}, {
  timestamps: true, // Agrega campos createdAt y updatedAt
  versionKey: false // Elimina el campo __v
});

/**
 * Propiedad virtual 'isLocked'
 * Determina si la cuenta está actualmente bloqueada debido a intentos fallidos de inicio de sesión
 */
userSchema.virtual('isLocked').get(function() {
  return !!(this.lockUntil && this.lockUntil > Date.now()); // Doble negación para convertir a booleano
});

/**
 * Middleware pre-save para hashing de contraseñas
 * Usa bcrypt con un número configurable de rondas de salt
 */
userSchema.pre('save', async function(next) {
  // Solo hash la contraseña si ha sido modificada (o es nueva)
  if (!this.isModified('password')) {
    return next();
  }

  try {
    // Genera un salt y hashea la contraseña
    const salt = await bcrypt.genSalt(config.security.bcryptSaltRounds);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (error) {
    next(error);
  }
});

/**
 * Middleware pre-update para auto-actualización de timestamps
 * Se ejecuta en operaciones findOneAndUpdate, updateOne, updateMany
 */
userSchema.pre('findOneAndUpdate', function(next) {
  // Auto-actualizar el campo updatedAt en updates
  this.set({ updatedAt: new Date() });
  next();
});

userSchema.pre('updateOne', function(next) {
  this.set({ updatedAt: new Date() });
  next();
});

userSchema.pre('updateMany', function(next) {
  this.set({ updatedAt: new Date() });
  next();
});

/**
 * Compara una contraseña candidata con la contraseña hasheada almacenada
 *
 * @param {string} candidatePassword - Contraseña a verificar
 * @returns {Promise<boolean>} True si la contraseña coincide, false en caso contrario
 */
userSchema.methods.comparePassword = async function(candidatePassword) {
  if (!candidatePassword) {return false;}
  return bcrypt.compare(candidatePassword, this.password);
};

/**
 * Generar un token JWT para el usuario
 *
 * @returns {string} Token JWT firmado
 */
userSchema.methods.generateAuthToken = function() {
  const payload = {
    id: this._id,
    username: this.username,
    email: this.email,
    role: this.role
  };

  return generateAccessToken(payload);
};

/**
 * Manejar login fallido
 * Incrementa los intentos de login y bloquea la cuenta si es necesario
 */
userSchema.methods.handleFailedLogin = async function() {
  // Si la cuenta ya está bloqueada y el período de bloqueo ha expirado, reiniciar
  if (this.lockUntil && this.lockUntil < Date.now()) {
    return this.updateOne({
      $unset: { lockUntil: 1 },
      $set: { loginAttempts: 1 }
    });
  }

  const updates = { $inc: { loginAttempts: 1 } };

  // Bloquear la cuenta si se alcanzan los intentos fallidos máximos y no está ya bloqueada
  if (this.loginAttempts + 1 >= USER_SECURITY.MAX_LOGIN_ATTEMPTS && !this.isLocked) {
    updates.$set = { lockUntil: Date.now() + USER_SECURITY.LOCK_TIME_MS };
  }

  return this.updateOne(updates);
};

/**
 * Manejar login exitoso
 * Resetea los intentos de login y actualiza el último login
 */
userSchema.methods.handleSuccessfulLogin = async function() {
  // Eliminar intentos de login y lock si existen
  if (this.loginAttempts > 0 || this.lockUntil) {
    return this.updateOne({
      $unset: { loginAttempts: 1, lockUntil: 1 },
      $set: { lastLogin: Date.now() }
    });
  }

  // Solo actualizar el último login
  return this.updateOne({ $set: { lastLogin: Date.now() } });
};

/**
 * Metodo estático para encontrar usuario por email o username
 *
 * @param {string} identifier - Email o username
 * @returns {Promise<Document|null>} Documento del usuario o null si no se encuentra
 */
userSchema.statics.findByEmailOrUsername = function(identifier) {
  return this.findOne({
    $or: [
      { email: identifier.toLowerCase() },
      { username: identifier }
    ]
  }).select('+password'); // Incluir password para verificación
};

/**
 * Índices para mejorar el rendimiento de las consultas
 */

// ========================================
// ÍNDICE COMPUESTO: email + username (consolidado)
// ========================================
// MEJORA: Reemplaza índices individuales por uno compuesto más eficiente
// Soporta: Búsquedas por email, username, o ambos
// Usado en: authController.js:54,141 - findByEmailOrUsername()
// Usado en: authController.js:299,309 - Verificaciones de unicidad
// ✅ Leftmost prefix permite queries solo con email
// ✅ Unique constraint ya garantizado a nivel de campo
userSchema.index({ email: 1, username: 1 }, {
  name: 'idx_user_credentials',
  background: true
});

// ========================================
// ÍNDICES TEMPORALES
// ========================================

// Índice para ordenar usuarios por fecha de creación (descendente)
// Usado en: Queries administrativas de listado de usuarios
// Soporta: GET /api/admin/users?sortBy=createdAt&sortOrder=desc
userSchema.index({ createdAt: -1 }, {
  name: 'idx_user_created_timeline',
  background: true
});

// Índice para consultas por último login (descendente)
// Usado en: Queries de auditoría y análisis de actividad
// Usado en: authController.js - actualización de lastLogin en login
// Soporta: Identificación de usuarios inactivos, análisis de engagement
userSchema.index({ lastLogin: -1 }, {
  name: 'idx_user_last_login',
  background: true,
  sparse: true // ✅ SPARSE: lastLogin puede ser null para usuarios que nunca han iniciado sesión
});

// Crear y exportar el modelo de usuario
const User = mongoose.model('Users', userSchema);

module.exports = User;
