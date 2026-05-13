/**
 * Modelo de Lista Negra de Tokens
 *
 * Gestiona refresh tokens revocados para prevenir su reuso después de la rotación.
 * Los tokens se eliminan automáticamente después de su expiración usando índice TTL.
 *
 */

const mongoose = require('mongoose');
const { TOKEN_REVOCATION_REASONS } = require('../constants');

/**
 * Esquema de Lista Negra de Tokens
 *
 * Almacena refresh tokens invalidados con expiración automática.
 */
const tokenBlacklistSchema = new mongoose.Schema({
  // Nota: `unique: true` ya genera indice unico automaticamente, sin `index: true` redundante
  token: {
    type: String,
    required: true,
    unique: true
  },

  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Users',
    required: true,
    index: true
  },

  reason: {
    type: String,
    enum: Object.values(TOKEN_REVOCATION_REASONS),
    default: 'rotation'
  },

  revokedAt: {
    type: Date,
    default: Date.now,
    index: true
  },

  // Nota: el indice plano sobre `expiresAt` se omite porque el TTL declarado mas
  // abajo (`expireAfterSeconds: 0`) ya crea el indice necesario sobre este campo.
  expiresAt: {
    type: Date,
    required: true
  }
}, {
  timestamps: true,
  versionKey: false,
  collection: 'token_blacklist',
  toJSON: {
    transform: (_doc, ret) => {
      delete ret.createdAt;
      delete ret.updatedAt;
      return ret;
    }
  }
});

/**
 * Índice TTL - MongoDB elimina automáticamente documentos después de expiresAt
 * Esto mantiene la lista negra limpia y eficiente
 */
tokenBlacklistSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

/**
 * Método estático para agregar token a lista negra
 *
 * @param {string} token - Refresh token a agregar a lista negra
 * @param {string} userId - ID de usuario propietario del token
 * @param {string} reason - Razón para agregar a lista negra
 * @param {Date} expiresAt - Cuando el token expira naturalmente
 * @returns {Promise<Document>} Entrada de lista negra creada
 * @throws {Error} Si falta token o expiresAt
 */
tokenBlacklistSchema.statics.addToken = async function(token, userId, reason = 'rotation', expiresAt) {
  if (!token || !userId || !expiresAt) {
    throw new Error('Token, userId, and expiresAt are required for blacklisting');
  }

  // Verificar que expiresAt sea una fecha válida en el futuro
  const expirationDate = new Date(expiresAt);
  if (isNaN(expirationDate.getTime()) || expirationDate <= new Date()) {
    throw new Error('expiresAt must be a valid future date');
  }

  try {
    return await this.create({
      token,
      userId,
      reason,
      expiresAt: expirationDate
    });
  } catch (error) {
    // Si es error de duplicado, el token ya está en blacklist (OK)
    if (error.code === 11000) {
      return this.findOne({ token });
    }
    throw error;
  }
};

/**
 * Método estático para verificar si un token está en lista negra
 *
 * @param {string} token - Token a verificar
 * @returns {Promise<boolean>} True si el token está en lista negra
 * @throws {Error} Si no se proporciona el token
 */
tokenBlacklistSchema.statics.isBlacklisted = async function(token) {
  if (!token) {
    throw new Error('Token is required for blacklist check');
  }

  const entry = await this.findOne({ token }).lean();
  return !!entry;
};

const TokenBlacklist = mongoose.model('TokenBlacklist', tokenBlacklistSchema);

module.exports = TokenBlacklist;
