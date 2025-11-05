/**
 * Token Blacklist Model
 *
 * Manages revoked refresh tokens to prevent reuse after rotation.
 * Tokens are automatically removed after expiration using TTL index.
 *
 * @author API Development Team
 * @version 1.0.0
 */

const mongoose = require('mongoose');

/**
 * TokenBlacklist Schema
 *
 * Stores invalidated refresh tokens with automatic expiration.
 */
const tokenBlacklistSchema = new mongoose.Schema({
  token: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Users',
    required: true,
    index: true
  },
  
  reason: {
    type: String,
    enum: ['rotation', 'logout', 'compromised', 'password_change'],
    default: 'rotation'
  },
  
  revokedAt: {
    type: Date,
    default: Date.now,
    index: true
  },
  
  expiresAt: {
    type: Date,
    required: true,
    index: true
  }
}, {
  timestamps: true,
  versionKey: false
});

/**
 * TTL Index - MongoDB automatically deletes documents after expiresAt
 * This keeps the blacklist clean and performant
 */
tokenBlacklistSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

/**
 * Static method to add token to blacklist
 *
 * @param {string} token - Refresh token to blacklist
 * @param {string} userId - User ID who owns the token
 * @param {string} reason - Reason for blacklisting
 * @param {Date} expiresAt - When the token naturally expires
 * @returns {Promise<Document>} Created blacklist entry
 * @throws {Error} If token or expiresAt is missing
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
 * Static method to check if token is blacklisted
 *
 * @param {string} token - Token to check
 * @returns {Promise<boolean>} True if token is blacklisted
 * @throws {Error} If token is not provided
 */
tokenBlacklistSchema.statics.isBlacklisted = async function(token) {
  if (!token) {
    throw new Error('Token is required for blacklist check');
  }
  
  const entry = await this.findOne({ token }).lean();
  return !!entry;
};

/**
 * Static method to blacklist all tokens for a user
 * Useful when password is changed or account is compromised
 *
 * @param {string} userId - User ID
 * @param {string} reason - Reason for blacklisting
 * @returns {Promise<void>}
 */
tokenBlacklistSchema.statics.blacklistUserTokens = async function(userId, reason = 'password_change') {
  // In practice, you'd need to track active refresh tokens
  // This is a placeholder - proper implementation would require storing active tokens
  // For now, we rely on rotation to invalidate old tokens
  return;
};

const TokenBlacklist = mongoose.model('TokenBlacklist', tokenBlacklistSchema);

module.exports = TokenBlacklist;
