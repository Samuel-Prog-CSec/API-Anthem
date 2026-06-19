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
  // Se mantiene `token` por compatibilidad con entradas legacy (tokens emitidos
  // antes de la migracion a jti). Las nuevas entradas usan `jti` y dejan `token`
  // como string corto descriptivo (ej. "rev:<jti>") para satisfacer la unicidad.
  token: {
    type: String,
    required: true,
    unique: true
  },

  // jti (JWT ID): identificador unico por token (~36 bytes UUID v4).
  // Permite revocar tokens almacenando solo el id en lugar del payload completo.
  // Sparse: tokens legacy sin jti no rompen el indice unico.
  jti: {
    type: String,
    index: { unique: true, sparse: true }
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
tokenBlacklistSchema.statics.addToken = async function(token, userId, reason = 'rotation', expiresAt, jti = null) {
  if (!token || !userId || !expiresAt) {
    throw new Error('Token, userId, and expiresAt are required for blacklisting');
  }

  // Verificar que expiresAt sea una fecha válida en el futuro
  const expirationDate = new Date(expiresAt);
  if (isNaN(expirationDate.getTime()) || expirationDate <= new Date()) {
    throw new Error('expiresAt must be a valid future date');
  }

  try {
    const doc = {
      token,
      userId,
      reason,
      expiresAt: expirationDate
    };
    if (jti) {
      doc.jti = jti;
    }
    return await this.create(doc);
  } catch (error) {
    // Si es error de duplicado, el token ya está en blacklist (OK)
    if (error.code === 11000) {
      return jti ? this.findOne({ jti }) : this.findOne({ token });
    }
    throw error;
  }
};

/**
 * Agrega un token a la lista negra usando solo su jti.
 *
 * Variante liviana de `addToken`: no almacena el payload completo del token,
 * solo el identificador unico. Util cuando el verify ya validó el token y
 * el `jti` es suficiente para futuras comprobaciones.
 *
 * @param {string} jti - JWT ID unico del token a revocar
 * @param {string} userId - ID del usuario propietario
 * @param {string} reason - Razon de revocacion
 * @param {Date} expiresAt - Fecha de expiracion natural del token
 * @returns {Promise<Document>} Entrada creada
 */
tokenBlacklistSchema.statics.addJti = async function(jti, userId, reason = 'rotation', expiresAt) {
  if (!jti) {
    throw new Error('jti is required for blacklisting');
  }
  // `token` recibe un descriptor corto que satisface el indice unico
  // y no expone el JWT real en la BD.
  return this.addToken(`rev:${jti}`, userId, reason, expiresAt, jti);
};

/**
 * Reclama (claim) la revocacion de un jti de forma ATOMICA.
 *
 * A diferencia de `addJti`, NO traga el error de duplicado: usa el insert con
 * indice unico sobre `jti` como mecanismo de exclusion mutua. Devuelve
 * `{ claimed: true }` si esta llamada fue la PRIMERA en revocar el jti, o
 * `{ claimed: false }` si ya estaba revocado (otra peticion concurrente lo
 * rotó, o es un intento de reuso). Permite implementar rotacion "un solo uso"
 * sin la ventana de carrera del patron leer-luego-escribir.
 *
 * @param {string} jti - JWT ID unico del token a revocar
 * @param {string} userId - ID del usuario propietario
 * @param {string} reason - Razon de revocacion
 * @param {Date} expiresAt - Fecha de expiracion natural del token
 * @returns {Promise<{claimed: boolean}>}
 */
tokenBlacklistSchema.statics.claimJti = async function(jti, userId, reason = 'rotation', expiresAt) {
  if (!jti || !userId || !expiresAt) {
    throw new Error('jti, userId y expiresAt son obligatorios para reclamar la revocacion');
  }
  const expirationDate = new Date(expiresAt);
  if (isNaN(expirationDate.getTime()) || expirationDate <= new Date()) {
    throw new Error('expiresAt debe ser una fecha futura valida');
  }
  try {
    await this.create({ token: `rev:${jti}`, jti, userId, reason, expiresAt: expirationDate });
    return { claimed: true };
  } catch (error) {
    if (error.code === 11000) {
      return { claimed: false };
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

/**
 * Verifica si un jti esta en la lista negra.
 *
 * Mas eficiente que `isBlacklisted` porque consulta por un campo de tamano fijo
 * (UUID) en lugar del JWT completo. Preferir esta variante para tokens emitidos
 * tras la migracion a jti.
 *
 * @param {string} jti - JWT ID a verificar
 * @returns {Promise<boolean>} True si el jti esta revocado
 */
tokenBlacklistSchema.statics.isJtiBlacklisted = async function(jti) {
  if (!jti) {
    return false;
  }
  const entry = await this.findOne({ jti }).lean();
  return !!entry;
};

const TokenBlacklist = mongoose.model('TokenBlacklist', tokenBlacklistSchema);

module.exports = TokenBlacklist;
